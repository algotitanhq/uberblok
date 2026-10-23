// The model of the Snapshots and clones room: one filesystem, its snapshots
// and one clone, each a ds_bp pointing to a root block over four data blocks,
// with the deadlists of the code. Every decision is a transcription of
// OpenZFS zfs-2.4.4 (ANALYSIS.md, room "Snapshots and clones"):
//   kill         dsl_dataset_block_kill        dsl_dataset.c L294-L346
//   dlInsert     dsl_deadlist_insert           dsl_deadlist.c L487-L501
//   snapshot     dsl_dataset_snapshot_sync_impl dsl_dataset.c L1760-L1884
//   clone        dsl_dataset_create_sync_dd    dsl_dataset.c L1213-L1265
//   destroy      dsl_destroy_snapshot_sync_impl dsl_destroy.c L387-L479
//   sync order   dsl_pool_sync                 dsl_pool.c L747-L854
// What it leaves out: DECISIONS.md D5.2. Pure data, no DOM: the page renders
// it at build time and in the browser, and scripts/test/snapshots-model.test.mjs
// checks it.

export const SLOTS = ["A", "B", "C", "D"] as const;
export const MAX_SNAPSHOTS = 4;
/** `$ORIGIN` is created with crtxg = 1 (dsl_dataset.c L1752-L1758). */
export const ORIGIN_TXG = 1;

export type Dir = "fs" | "clone";

export interface Block {
  id: number;
  /** 0-3 for a data block, -1 for a root (the objset block ds_bp points to). */
  slot: number;
  /** BP_GET_BIRTH: the txg the block was allocated in (metaslab.c L6061). */
  birth: number;
  /** The dataset directory whose head wrote it. */
  dir: Dir;
  /** Txg in which each head killed it (overwrite or delete). */
  killed: Partial<Record<Dir, number>>;
  /** Txg in which it was freed, if it was. */
  freed?: number;
}

export interface Entry {
  /** dle_mintxg: the entry holds blocks born after key, up to the next key. */
  key: number;
  blocks: number[];
}

export interface Dataset {
  id: string;
  name: string;
  /** A head is writable (fs, clone); a snapshot is not. */
  snapshot: boolean;
  dir: Dir;
  creationTxg: number;
  /** ds_prev_snap_obj: a dataset id, or "$ORIGIN". */
  prevSnap: string;
  prevSnapTxg: number;
  /** ds_next_snap_obj, for snapshots: the next snapshot or the head. */
  nextSnap?: string;
  /** ds_num_children: 1 + number of clones, for snapshots. */
  numChildren: number;
  /** ds_bp: the root block id. */
  bp: number;
  deadlist: Entry[];
}

export type Change = "write" | "delete";
export type Task = { kind: "snapshot" } | { kind: "clone"; origin: string } | { kind: "destroy"; snap: string };

export interface State {
  /** The open txg. */
  txg: number;
  blocks: Block[];
  /** Root block id -> data block id per slot. */
  roots: Record<number, (number | null)[]>;
  /** fs first, then its snapshots oldest first, then the clone. */
  datasets: Dataset[];
  /** dd_origin_txg per directory (dsl_dir.c L269-L270). */
  originTxg: Partial<Record<Dir, number>>;
  /** Changes and sync tasks waiting in the open txg. */
  pending: { changes: Partial<Record<Dir, Record<number, Change>>>; tasks: Task[] };
  snapSeq: number;
}

export type Event =
  | { k: "born"; ds: string; block: number }
  | { k: "kill"; ds: string; block: number; birth: number; prevSnapTxg: number; freed: boolean; key?: number; panic?: boolean }
  | { k: "snapshot"; snap: string; bp: number; oldPrev: number; keys: number[] }
  | { k: "clone"; clone: string; origin: string; bp: number; keys: number[] }
  | { k: "destroy"; snap: string; name: string; next: string; prevSnapTxg: number; freed: number[]; merged: number[]; removedKey: number; removedFrom: string[] }
  | { k: "refused"; task: Task; err: "EAGAIN" | "EEXIST" | "ENOENT" }
  | { k: "synced"; txg: number };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function ds(s: State, id: string): Dataset {
  const d = s.datasets.find((x) => x.id === id);
  if (!d) throw new Error(`no dataset ${id}`);
  return d;
}
export const head = (s: State, dir: Dir) => s.datasets.find((d) => !d.snapshot && d.dir === dir);
export const snapshots = (s: State) => s.datasets.filter((d) => d.snapshot);
export const block = (s: State, id: number) => s.blocks[id];

// ---------------------------------------------------------------- deadlists

/**
 * dsl_deadlist_insert, L487-L501: the entry before the exact key, or the
 * nearest entry before the insertion point. A birth at or below every key is
 * zfs_panic_recover and goes to the first entry.
 */
export function dlInsert(dl: Entry[], b: Block): { entry: Entry; panic: boolean } {
  const birth = b.birth;
  const exact = dl.findIndex((e) => e.key === birth);
  let i: number;
  if (exact < 0) {
    i = -1;
    for (let j = 0; j < dl.length; j++) if (dl[j].key < birth) i = j; // avl_nearest(AVL_BEFORE)
  } else i = exact - 1; // AVL_PREV
  const panic = i < 0;
  const entry = dl[panic ? 0 : i];
  entry.blocks.push(b.id);
  return { entry, panic };
}

/** dsl_deadlist_clone, dsl_deadlist.c L727-L737: the keys below maxtxg, each with an empty bpobj. */
export const dlClone = (dl: Entry[], maxtxg: number): Entry[] =>
  dl.filter((e) => e.key < maxtxg).map((e) => ({ key: e.key, blocks: [] }));

/** dsl_deadlist_add_key: "must be > all current entries" (L521-L524). */
export function dlAddKey(dl: Entry[], key: number) {
  if (dl.some((e) => e.key >= key)) throw new Error(`add_key ${key} not above every key`);
  dl.push({ key, blocks: [] });
}

/** dsl_deadlist_remove_key, L553-L577: merge the entry into the one before it. */
export function dlRemoveKey(dl: Entry[], key: number) {
  const i = dl.findIndex((e) => e.key === key);
  if (i < 1) throw new Error(`remove_key ${key}: ${i < 0 ? "no such key" : "no previous entry"}`);
  dl[i - 1].blocks.push(...dl[i].blocks);
  dl.splice(i, 1);
}

/** dsl_deadlist_move_bpobj, L930-L989: remove the entries at or after mintxg, return their blocks. */
export function dlMoveBpobj(dl: Entry[], mintxg: number): number[] {
  const i = dl.findIndex((e) => e.key >= mintxg); // avl_find, else avl_nearest(AVL_AFTER)
  if (i < 0) return [];
  return dl.splice(i).flatMap((e) => e.blocks);
}

/** dsl_deadlist_merge -> dsl_deadlist_insert_bpobj, L828-L832: each entry into the same key, or the nearest below. */
export function dlMerge(dl: Entry[], from: Entry[]): number[] {
  const moved: number[] = [];
  for (const e of from) {
    let t: Entry | undefined;
    for (const x of dl) if (x.key <= e.key) t = x;
    if (!t) throw new Error(`merge: no entry at or below ${e.key}`);
    t.blocks.push(...e.blocks);
    moved.push(...e.blocks);
  }
  return moved;
}

// ---------------------------------------------------------------- the state

function newBlock(s: State, slot: number, birth: number, dir: Dir): Block {
  const b: Block = { id: s.blocks.length, slot, birth, dir, killed: {} };
  s.blocks.push(b);
  return b;
}

/**
 * A pool where fs was created from $ORIGIN: ds_prev_snap_txg 1, deadlist keys
 * {0} (ANALYSIS.md, "Where the keys start"), an empty root, open txg `txg`.
 */
export function create(txg = 8): State {
  const s: State = {
    txg,
    blocks: [],
    roots: {},
    datasets: [],
    originTxg: { fs: ORIGIN_TXG },
    pending: { changes: {}, tasks: [] },
    snapSeq: 0,
  };
  const r = newBlock(s, -1, txg - 1, "fs");
  s.roots[r.id] = [null, null, null, null];
  s.datasets.push({
    id: "fs", name: "fs", snapshot: false, dir: "fs", creationTxg: txg - 1,
    prevSnap: "$ORIGIN", prevSnapTxg: ORIGIN_TXG, numChildren: 0, bp: r.id,
    deadlist: [{ key: 0, blocks: [] }],
  });
  return s;
}

/** The data block in a slot of a dataset's tree. */
export const slotBlock = (s: State, d: Dataset, slot: number) => s.roots[d.bp][slot];

/** Why a change cannot be queued, or null. */
export function changeRefusal(s: State, dir: Dir, slot: number, c: Change): string | null {
  const h = head(s, dir);
  if (!h) return "no-dataset";
  if (s.pending.changes[dir]?.[slot]) return "pending";
  if (c === "delete" && slotBlock(s, h, slot) === null) return "empty";
  return null;
}

export function change(s: State, dir: Dir, slot: number, c: Change) {
  const why = changeRefusal(s, dir, slot, c);
  if (why) throw new Error(`change refused: ${why}`);
  (s.pending.changes[dir] ??= {})[slot] = c;
}

export function cancelChange(s: State, dir: Dir, slot: number) {
  delete s.pending.changes[dir]?.[slot];
}

/** Why a sync task cannot be asked for, or null. The figure's limits, then the code's checks. */
export function taskRefusal(s: State, t: Task): string | null {
  const queued = s.pending.tasks;
  if (t.kind === "snapshot") {
    if (queued.some((q) => q.kind === "snapshot")) return "EAGAIN"; // L1538-L1539, a second one this txg
    if (snapshots(s).length >= MAX_SNAPSHOTS) return "limit";
    return null;
  }
  if (t.kind === "clone") {
    if (head(s, "clone") || queued.some((q) => q.kind === "clone")) return "limit";
    if (!s.datasets.some((d) => d.id === t.origin && d.snapshot && d.dir === "fs")) return "ENOENT";
    if (queued.some((q) => q.kind === "destroy" && q.snap === t.origin)) return "pending";
    return null;
  }
  const d = s.datasets.find((x) => x.id === t.snap);
  if (!d || !d.snapshot) return "ENOENT";
  if (queued.some((q) => q.kind === "destroy" && q.snap === t.snap)) return "pending";
  if (queued.some((q) => q.kind === "clone" && q.origin === t.snap)) return "pending";
  if (d.numChildren > 1) return "EEXIST"; // dsl_destroy.c L83-L86
  return null;
}

export function ask(s: State, t: Task) {
  const why = taskRefusal(s, t);
  if (why) throw new Error(`task refused: ${why}`);
  s.pending.tasks.push(t);
}

export function cancelTask(s: State, i: number) {
  s.pending.tasks.splice(i, 1);
}

/**
 * dsl_dataset_block_kill, L294-L346: free the block if it was born after the
 * dataset's latest snapshot, else put it on the dataset's deadlist.
 */
export function kill(s: State, d: Dataset, id: number, txg: number): Event {
  const b = s.blocks[id];
  b.killed[d.dir] = txg;
  if (b.birth > d.prevSnapTxg) {
    b.freed = txg; // dsl_free, L312-L315
    return { k: "kill", ds: d.id, block: id, birth: b.birth, prevSnapTxg: d.prevSnapTxg, freed: true };
  }
  const { entry, panic } = dlInsert(d.deadlist, b); // L344
  return { k: "kill", ds: d.id, block: id, birth: b.birth, prevSnapTxg: d.prevSnapTxg, freed: false, key: entry.key, panic };
}

/** dsl_dataset_snapshot_sync_impl, with the check of L1538-L1539. */
function snapshot(s: State, txg: number, ev: Event[]) {
  const h = head(s, "fs")!;
  if (h.prevSnapTxg >= txg) return ev.push({ k: "refused", task: { kind: "snapshot" }, err: "EAGAIN" });
  const n = ++s.snapSeq;
  const snap: Dataset = {
    id: `s${n}`, name: `fs@s${n}`, snapshot: true, dir: "fs", creationTxg: txg,
    prevSnap: h.prevSnap, prevSnapTxg: h.prevSnapTxg, // L1770-L1771
    nextSnap: h.id, numChildren: 1, // L1772-L1773
    bp: h.bp, // L1783: the one block pointer copied
    deadlist: h.deadlist, // L1776: the head's deadlist, as it is
  };
  const prev = s.datasets.find((d) => d.id === h.prevSnap);
  if (prev && prev.nextSnap === h.id) prev.nextSnap = snap.id; // L1802-L1807
  const oldPrev = h.prevSnapTxg;
  h.deadlist = dlClone(snap.deadlist, Infinity); // L1831-L1833, maxtxg UINT64_MAX
  dlAddKey(h.deadlist, oldPrev); // L1837-L1838, still the previous snapshot's txg
  h.prevSnap = snap.id; // L1882
  h.prevSnapTxg = txg; // L1883
  s.datasets.splice(1 + snapshots(s).length, 0, snap); // after fs and the older snapshots
  ev.push({ k: "snapshot", snap: snap.id, bp: snap.bp, oldPrev, keys: h.deadlist.map((e) => e.key) });
}

/** dsl_dataset_create_sync_dd with an origin, L1213-L1265. */
function makeClone(s: State, originId: string, txg: number, ev: Event[]) {
  const o = s.datasets.find((d) => d.id === originId);
  if (!o) return ev.push({ k: "refused", task: { kind: "clone", origin: originId }, err: "ENOENT" });
  const ohds = head(s, o.dir)!; // the head of the origin snapshot
  const c: Dataset = {
    id: "clone", name: "clone", snapshot: false, dir: "clone", creationTxg: txg,
    prevSnap: o.id, prevSnapTxg: o.creationTxg, // L1216-L1218
    numChildren: 0,
    bp: o.bp, // L1226
    deadlist: dlClone(ohds.deadlist, o.creationTxg), // L1249-L1250
  };
  o.numChildren++; // L1244
  s.originTxg.clone = o.creationTxg; // dd_origin_obj L1265, dd_origin_txg dsl_dir.c L269-L270
  s.datasets.push(c);
  ev.push({ k: "clone", clone: c.id, origin: o.id, bp: c.bp, keys: c.deadlist.map((e) => e.key) });
}

/** dsl_destroy_snapshot_sync_impl, the keyed-deadlist path (dsl_destroy.c L387-L479). */
function destroy(s: State, snapId: string, txg: number, ev: Event[]) {
  const S = s.datasets.find((d) => d.id === snapId);
  if (!S) return ev.push({ k: "refused", task: { kind: "destroy", snap: snapId }, err: "ENOENT" });
  if (S.numChildren > 1) return ev.push({ k: "refused", task: { kind: "destroy", snap: snapId }, err: "EEXIST" }); // L85-L86
  const prev = s.datasets.find((d) => d.id === S.prevSnap);
  if (prev && prev.nextSnap === S.id) prev.nextSnap = S.nextSnap; // L371-L374
  const N = ds(s, S.nextSnap!);
  N.prevSnap = S.prevSnap; // L388-L389
  N.prevSnapTxg = S.prevSnapTxg; // L390-L391
  const freed = dlMoveBpobj(N.deadlist, S.prevSnapTxg); // L416-L418, to dp_free_bpobj
  for (const id of freed) s.blocks[id].freed = txg;
  const merged = dlMerge(N.deadlist, S.deadlist); // L423-L424
  const removedFrom: string[] = [];
  const c = head(s, "clone");
  if (c && s.originTxg.clone! > S.creationTxg) {
    dlRemoveKey(c.deadlist, S.creationTxg); // L441-L445, dsl_dir_remove_clones_key L230-L232
    removedFrom.push(c.id);
  }
  if (N.snapshot) {
    dlRemoveKey(head(s, S.dir)!.deadlist, S.creationTxg); // L475-L479
    removedFrom.push(head(s, S.dir)!.id);
  }
  s.datasets.splice(s.datasets.indexOf(S), 1);
  ev.push({ k: "destroy", snap: S.id, name: S.name, next: N.id, prevSnapTxg: S.prevSnapTxg, freed, merged, removedKey: S.creationTxg, removedFrom });
}

/**
 * Sync the open txg (dsl_pool_sync, L747-L854): the changes of every dataset
 * first, each kill against ds_prev_snap_txg as it is before this txg's
 * snapshots; then the sync tasks in the order they were asked for.
 */
export function sync(s: State): Event[] {
  const T = s.txg;
  const ev: Event[] = [];
  for (const dir of ["fs", "clone"] as Dir[]) {
    const ch = s.pending.changes[dir];
    const h = head(s, dir);
    if (!ch || !h || !Object.keys(ch).length) continue;
    const slots = [...s.roots[h.bp]];
    for (let slot = 0; slot < SLOTS.length; slot++) {
      const c = ch[slot];
      if (!c) continue;
      const old = slots[slot];
      if (c === "write") {
        const b = newBlock(s, slot, T, dir);
        slots[slot] = b.id;
        ev.push({ k: "born", ds: h.id, block: b.id });
      } else slots[slot] = null;
      if (old !== null) ev.push(kill(s, h, old, T)); // dbuf_write_done / free_blocks
    }
    const r = newBlock(s, -1, T, dir);
    s.roots[r.id] = slots;
    ev.push({ k: "born", ds: h.id, block: r.id });
    const oldRoot = h.bp;
    h.bp = r.id;
    ev.push(kill(s, h, oldRoot, T)); // dmu_objset_write_done
  }
  for (const t of s.pending.tasks) {
    if (t.kind === "snapshot") snapshot(s, T, ev);
    else if (t.kind === "clone") makeClone(s, t.origin, T, ev);
    else destroy(s, t.snap, T, ev);
  }
  s.pending = { changes: {}, tasks: [] };
  ev.push({ k: "synced", txg: T });
  s.txg = T + 1;
  return ev;
}

/** The sequence the room opens on (ANALYSIS.md, the hand-checked sequence, txgs 8 to 10). */
export function opening(): State {
  const s = create(8);
  for (const i of [0, 1, 2]) change(s, "fs", i, "write");
  sync(s); // txg 8: A, B, C
  ask(s, { kind: "snapshot" });
  sync(s); // txg 9: @s1
  change(s, "fs", 0, "write");
  sync(s); // txg 10: overwrite A
  return s;
}

export const copy = clone;

// ---------------------------------------------------------------- ownership

/** The tree of a dataset: its root and the data blocks under it. */
export const tree = (s: State, d: Dataset): number[] => [d.bp, ...s.roots[d.bp].filter((x): x is number => x !== null)];

/** Ground truth: every dataset whose tree holds the block. */
export const referencedBy = (s: State, id: number): string[] =>
  s.datasets.filter((d) => tree(s, d).includes(id)).map((d) => d.id);

/**
 * The answer from birth txgs alone, as the code would derive it: the
 * snapshots of the block's filesystem taken from its birth txg up to the txg
 * before it was killed there (sync tasks run after the kills), the head if it
 * has not killed it, and the clone if its origin is in that range and the
 * clone has not killed it.
 */
export function owners(s: State, id: number): { birth: number; snaps: string[]; heads: string[] } {
  const b = s.blocks[id];
  if (b.freed !== undefined) return { birth: b.birth, snaps: [], heads: [] };
  const heads: string[] = [];
  if (b.dir === "clone") return { birth: b.birth, snaps: [], heads: b.killed.clone === undefined ? ["clone"] : [] };
  const until = b.killed.fs ?? Infinity;
  const held = (t: number) => t >= b.birth && t < until;
  const snaps = snapshots(s).filter((d) => d.dir === "fs" && held(d.creationTxg)).map((d) => d.id);
  if (b.killed.fs === undefined) heads.push("fs");
  const c = head(s, "clone");
  if (c && held(s.originTxg.clone!) && b.killed.clone === undefined) heads.push("clone");
  return { birth: b.birth, snaps, heads };
}

/** What dsl_dataset_block_kill would do with this block in this head now. */
export function wouldKill(s: State, d: Dataset, id: number): { freed: boolean; key?: number } {
  const b = s.blocks[id];
  if (b.birth > d.prevSnapTxg) return { freed: true };
  const dl = clone(d.deadlist);
  return { freed: false, key: dlInsert(dl, b).entry.key };
}

/** Blocks still on disk: not freed. */
export const onDisk = (s: State) => s.blocks.filter((b) => b.freed === undefined);

/**
 * Blocks only this snapshot holds: on disk and in no other dataset's tree. They are
 * what destroying it would free (the entries dsl_destroy.c L415-L418 moves), when
 * nothing else changes in that txg; the tests check the two agree.
 */
export const heldOnlyBy = (s: State, id: string): number[] =>
  onDisk(s)
    .filter((b) => {
      const r = referencedBy(s, b.id);
      return r.length === 1 && r[0] === id;
    })
    .map((b) => b.id);

/** A block kept only for snapshots: on disk, and in no head's tree. */
export const pinned = (s: State, id: number): boolean => {
  if (s.blocks[id].freed !== undefined) return false;
  const r = referencedBy(s, id);
  return r.length > 0 && r.every((x) => ds(s, x).snapshot);
};
