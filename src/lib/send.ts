// The model of the send / receive room: one filesystem whose history makes
// four snapshots, the traversal of the newest one from a chosen
// from-snapshot, the stream of records it produces, and the receiver that
// checks and replays it. Every decision is a transcription of OpenZFS
// zfs-2.4.4 (ANALYSIS.md, room "send / receive"):
//   visitbp      traverse_visitbp, the birth test  dmu_traverse.c L249-L279
//   visitDnode   traverse_dnode, TRAVERSE_PRE      dmu_traverse.c L534-L550
//   sendCb       send_cb                           dmu_send.c L1098-L1146
//   dump*        do_dump, dump_dnode, dump_free,   dmu_send.c L883-L1035,
//                dump_freeobjects, dmu_dump_write  L713-L799, L331-L403, L650-L710, L462-L493
//   dumpRecord   dump_record                       dmu_send.c L257-L283
//   receive      receive_read_payload_and_next_header, the END check,
//                receive_process_record            dmu_recv.c L2843-L2868, L3000-L3007, L3188-L3240
// What it leaves out, and why it stays faithful: DECISIONS.md D9.2. Pure data,
// no DOM: the page renders it at build time and in the browser, and
// scripts/test/send-model.test.mjs checks it.
import { fletcher4Inc, type Cksum } from "./fletcher4";

/** Data block size of the figure's files (512 bytes, SPA_MINBLOCKSIZE: a small stream). */
export const BLKSZ = 512;
/** Block pointers in a file's indirect block, dnodes in a dnode block, blocks in a file: four each in the figure. */
export const FANOUT = 4;
/** Dnode blocks under the meta-dnode's indirect block: two, the ones the history uses. */
export const DNODE_BLOCKS = 2;
/** sizeof (dmu_replay_record_t); the checksum is its last 32 bytes (zfs_ioctl.h L380-L387, dmu_send.c L266-L267). */
export const RECORD_SIZE = 312;
export const CKSUM_OFFSET = RECORD_SIZE - 32;
/** DMU_BACKUP_MAGIC, zfs_ioctl.h L171. */
export const DMU_BACKUP_MAGIC = 0x2f5bacbacn;
/** DMU_OBJECT_END, dmu.h L853: "to the end of the object". */
export const OBJECT_END = -1;
/** The pool's hole_birth feature was enabled in txg 1, before any block of the figure. */
export const HOLE_BIRTH_TXG = 1;

/** drr_type values, in the enum's order (zfs_ioctl.h L247-L252). */
export const DRR = { BEGIN: 0, OBJECT: 1, FREEOBJECTS: 2, WRITE: 3, FREE: 4, END: 5 } as const;
export type RecType = keyof typeof DRR;
const TYPE_NAME = Object.fromEntries(Object.entries(DRR).map(([k, v]) => [v, k])) as Record<number, RecType>;

// dmu_object_type_t and dmu_objset_type_t values (dmu.h L174-L199, zfs.h L68-L71).
const DMU_OT_PLAIN_FILE_CONTENTS = 19;
const DMU_OST_ZFS = 2;

// ---------------------------------------------------------------- the tree

export type Kind = "objset" | "meta" | "dnodes" | "indirect" | "data";

export interface Bp {
  /** Stable name: "os", "meta", "dn0", "o1.L1", "o1.2". */
  id: string;
  kind: Kind;
  /** zb_object: 0 (the meta-dnode) for the objset's own blocks. */
  object: number;
  /** zb_level: ZB_ROOT_LEVEL (-1) for the objset, 1 for indirect blocks, 0 for dnode and data blocks. */
  level: number;
  blkid: number;
  /** Logical birth txg (BP_GET_LOGICAL_BIRTH); 0 for a hole that was never written. */
  birth: number;
  hole: boolean;
  /** A data block's contents, shown as text. */
  data?: string;
  /** Indirect blocks and the objset: the block pointers under them. */
  kids?: Bp[];
  /** Dnode blocks: their dnodes. */
  dnodes?: Dnode[];
}

export interface Dnode {
  object: number;
  /** "none": a free slot (DMU_OT_NONE); "reserved": object 0, the meta-dnode's own number. */
  type: "file" | "none" | "reserved";
  name?: string;
  /** dn_maxblkid of a file. */
  maxblkid: number;
  /** A file's one block pointer, to its indirect block (dn_nlevels 2). */
  bp?: Bp;
}

export interface Snapshot {
  name: string;
  txg: number;
  /** ds_guid, carried in drr_toguid / drr_fromguid. */
  guid: bigint;
  root: Bp;
}

export type Change =
  | { k: "create"; object: number; name: string; data: string[] }
  | { k: "write"; object: number; blkid: number; data: string }
  | { k: "punch"; object: number; blkid: number; count: number }
  | { k: "delete"; object: number };

/** The figure's history: one txg per line, and a snapshot taken in that txg. */
export const HISTORY: { txg: number; snap: string; changes: Change[] }[] = [
  {
    txg: 10, snap: "s1", changes: [
      { k: "create", object: 1, name: "a", data: ["a0", "a1", "a2", "a3"] },
      { k: "create", object: 2, name: "b", data: ["b0", "b1", "b2", "b3"] },
      { k: "create", object: 3, name: "c", data: ["c0", "c1", "c2", "c3"] },
    ],
  },
  { txg: 20, snap: "s2", changes: [{ k: "write", object: 1, blkid: 2, data: "a2′" }] },
  {
    txg: 30, snap: "s3", changes: [
      { k: "punch", object: 2, blkid: 1, count: 2 },
      { k: "create", object: 4, name: "d", data: ["d0", "d1", "d2", "d3"] },
    ],
  },
  { txg: 40, snap: "s4", changes: [{ k: "delete", object: 3 }] },
];

const hole = (id: string, kind: Kind, object: number, level: number, blkid: number, birth = 0): Bp =>
  ({ id, kind, object, level, blkid, birth, hole: true });
const clone = <T>(x: T): T => structuredClone(x);

function emptyDnodeBlock(blkid: number, birth: number): Bp {
  const dnodes: Dnode[] = [];
  for (let i = 0; i < FANOUT; i++) {
    const object = blkid * FANOUT + i;
    dnodes.push({ object, type: object === 0 ? "reserved" : "none", maxblkid: 0 });
  }
  return { id: `dn${blkid}`, kind: "dnodes", object: 0, level: 0, blkid, birth, hole: false, dnodes };
}

/** An empty filesystem: the objset, the meta-dnode's indirect block, no dnode block yet. */
function emptyFs(): Bp {
  const kids = Array.from({ length: DNODE_BLOCKS }, (_, i) => hole(`dn${i}`, "dnodes", 0, 0, i));
  return {
    id: "os", kind: "objset", object: 0, level: -1, blkid: 0, birth: 1, hole: false,
    kids: [{ id: "meta", kind: "meta", object: 0, level: 1, blkid: 0, birth: 1, hole: false, kids }],
  };
}

export const metaOf = (root: Bp) => root.kids![0];
export const dnodeBlocks = (root: Bp) => metaOf(root).kids!;
export function dnode(root: Bp, object: number): Dnode | undefined {
  const blk = dnodeBlocks(root)[Math.floor(object / FANOUT)];
  return blk?.dnodes?.[object % FANOUT];
}
/** dn_maxblkid of the meta-dnode: the last dnode block that exists. */
export const metaMaxblkid = (root: Bp) => dnodeBlocks(root).reduce((m, b, i) => (b.hole ? m : i), 0);

/**
 * Apply one txg's changes, copy-on-write: every changed block is born in this
 * txg, and so is every block above it, up to the objset (a txg's sync
 * rewrites the path to the root, as in the Copy-on-write room).
 */
function applyTxg(root: Bp, txg: number, changes: Change[]): Bp {
  const r = clone(root);
  const dirty = new Set<number>(); // dnode blocks touched
  for (const c of changes) {
    const bi = Math.floor(c.object / FANOUT);
    let blk = dnodeBlocks(r)[bi];
    if (blk.hole) blk = dnodeBlocks(r)[bi] = emptyDnodeBlock(bi, txg);
    const dn = blk.dnodes![c.object % FANOUT];
    if (c.k === "create") {
      const kids = c.data.map((d, i): Bp => ({ id: `o${c.object}.${i}`, kind: "data", object: c.object, level: 0, blkid: i, birth: txg, hole: false, data: d }));
      Object.assign(dn, { type: "file", name: c.name, maxblkid: c.data.length - 1 });
      dn.bp = { id: `o${c.object}.L1`, kind: "indirect", object: c.object, level: 1, blkid: 0, birth: txg, hole: false, kids };
    } else if (c.k === "write") {
      dn.bp!.kids![c.blkid] = { id: `o${c.object}.${c.blkid}`, kind: "data", object: c.object, level: 0, blkid: c.blkid, birth: txg, hole: false, data: c.data };
      dn.bp!.birth = txg;
    } else if (c.k === "punch") {
      // A freed range becomes holes that carry the txg of the free (hole_birth).
      for (let i = c.blkid; i < c.blkid + c.count; i++) dn.bp!.kids![i] = hole(`o${c.object}.${i}`, "data", c.object, 0, i, txg);
      dn.bp!.birth = txg;
    } else {
      Object.assign(dn, { type: "none", name: undefined, maxblkid: 0, bp: undefined });
    }
    dirty.add(bi);
  }
  for (const bi of dirty) dnodeBlocks(r)[bi].birth = txg;
  metaOf(r).birth = txg;
  r.birth = txg;
  return r;
}

/** The four snapshots of the history, oldest first. */
export function snapshots(): Snapshot[] {
  let root = emptyFs();
  return HISTORY.map((h, i) => {
    root = applyTxg(root, h.txg, h.changes);
    return { name: h.snap, txg: h.txg, guid: 0x5e0d00000000a000n + BigInt(i + 1) * 0x1111n, root: clone(root) };
  });
}

/** Every block pointer of a tree, depth first, as the traversal meets them. */
export function allBps(root: Bp): Bp[] {
  const out: Bp[] = [];
  const walk = (b: Bp) => {
    out.push(b);
    for (const k of b.kids ?? []) walk(k);
    for (const d of b.dnodes ?? []) if (d.bp) walk(d.bp);
  };
  walk(root);
  return out;
}

// ---------------------------------------------------------------- what a filesystem holds

/** Object -> its blocks' contents (null for a hole), trailing holes dropped. */
export type Content = Record<number, { name?: string; blocks: (string | null)[] }>;

const trim = (xs: (string | null)[]) => {
  const out = [...xs];
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
};

export function contentOf(root: Bp): Content {
  const c: Content = {};
  for (const blk of dnodeBlocks(root))
    for (const d of blk.dnodes ?? [])
      if (d.type === "file") c[d.object] = { name: d.name, blocks: trim(d.bp!.kids!.map((k) => (k.hole ? null : k.data!))) };
  return c;
}

export function sameContent(x: Content, y: Content): boolean {
  const kx = Object.keys(x).sort().join();
  if (kx !== Object.keys(y).sort().join()) return false;
  return Object.keys(x).every((o) => JSON.stringify(trim(x[+o].blocks)) === JSON.stringify(trim(y[+o].blocks)));
}

// ---------------------------------------------------------------- records

export interface Rec {
  type: RecType;
  object?: number;
  offset?: number;
  /** FREE: bytes, or OBJECT_END. */
  length?: number;
  firstobj?: number;
  numobjs?: number;
  /** WRITE: the block's text. */
  data?: string;
  header: Uint8Array;
  payload: Uint8Array;
  /** drr_checksum as dump_record filled it in; null for BEGIN. */
  cksum: Cksum | null;
  /** END: drr_end.drr_checksum, the checksum of the stream before END. */
  endCksum?: Cksum;
  /** The traversal step that emitted it (-1 before the traversal, BEGIN; steps.length after it). */
  step: number;
}

const u64 = (v: DataView, at: number, x: number | bigint) =>
  v.setBigUint64(at, typeof x === "bigint" ? x : x < 0 ? 0xffffffffffffffffn : BigInt(x), true);
const putCksum = (v: DataView, at: number, k: Cksum) => k.forEach((w, i) => v.setBigUint64(at + 8 * i, w, true));
const getCksum = (v: DataView, at: number): Cksum => [0, 1, 2, 3].map((i) => v.getBigUint64(at + 8 * i, true)) as Cksum;
const isZero = (k: Cksum) => k.every((w) => w === 0n);

/** A block's 512 bytes: its text, then zeros. */
export function blockBytes(text: string): Uint8Array {
  const out = new Uint8Array(BLKSZ);
  out.set(new TextEncoder().encode(text).slice(0, BLKSZ));
  return out;
}
const blockText = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, b.indexOf(0) < 0 ? b.length : b.indexOf(0)));

/** The header of a record, laid out as dmu_replay_record_t (zfs_ioctl.h L235-L311); unused fields stay zero. */
function header(r: Omit<Rec, "header" | "payload" | "cksum" | "step">, toguid: bigint, fromguid: bigint, payloadLen: number): Uint8Array {
  const h = new Uint8Array(RECORD_SIZE);
  const v = new DataView(h.buffer);
  v.setUint32(0, DRR[r.type], true);
  v.setUint32(4, r.type === "WRITE" ? 0 : payloadLen, true); // drr_payloadlen: not used by WRITE, whose size is drr_logical_size
  switch (r.type) {
    case "BEGIN":
      u64(v, 8, DMU_BACKUP_MAGIC);
      v.setUint32(32, DMU_OST_ZFS, true);
      u64(v, 40, toguid);
      u64(v, 48, fromguid);
      h.set(new TextEncoder().encode("tank/fs"), 56);
      break;
    case "OBJECT":
      u64(v, 8, r.object!);
      v.setUint32(16, DMU_OT_PLAIN_FILE_CONTENTS, true);
      v.setUint32(24, BLKSZ, true);
      u64(v, 40, toguid);
      break;
    case "FREEOBJECTS":
      u64(v, 8, r.firstobj!);
      u64(v, 16, r.numobjs!);
      u64(v, 24, toguid);
      break;
    case "WRITE":
      u64(v, 8, r.object!);
      v.setUint32(16, DMU_OT_PLAIN_FILE_CONTENTS, true);
      u64(v, 24, r.offset!);
      u64(v, 32, BLKSZ);
      u64(v, 40, toguid);
      break;
    case "FREE":
      u64(v, 8, r.object!);
      u64(v, 16, r.offset!);
      u64(v, 24, r.length!);
      u64(v, 32, toguid);
      break;
    case "END":
      putCksum(v, 8, r.endCksum!);
      u64(v, 40, toguid);
      break;
  }
  return h;
}

// ---------------------------------------------------------------- the traversal

/** One test of traverse_visitbp, or one dnode met by traverse_dnode, in the order of the code. */
export interface Step {
  k: "test" | "dnode";
  /** test: the block pointer. */
  bp?: Bp;
  /** test: born after td_min_txg (or a hole that must be visited), so visited. */
  visit?: boolean;
  /** test: a hole with birth 0 (never in the figure, covered by the tests). */
  zeroHole?: boolean;
  /** dnode: the dnode met. */
  dn?: Dnode;
  /** What send_cb queued for it. */
  range?: "OBJECT" | "OBJECT_RANGE" | "DATA" | "HOLE" | null;
  /** Ids of the block pointers below a skipped one: never read. */
  pruned?: string[];
  /** Records dump_record wrote during this step (indices into the stream). */
  emitted: number[];
}

export interface Options {
  /** send_holes_without_birth_time (dmu_traverse.c L44), 1 by default. */
  sendHolesWithoutBirthTime?: boolean;
  /** The txg in which hole_birth was enabled; UINT64_MAX if it is not active (L662-L667). */
  holeBirthTxg?: number;
}

export interface Send {
  to: Snapshot;
  from: Snapshot | null;
  /** td_min_txg: the from-snapshot's creation txg, 0 for a full stream (dmu_send.c L2370). */
  minTxg: number;
  steps: Step[];
  records: Rec[];
  /** The stream checksum before END, the value END carries. */
  total: Cksum;
  /** Block pointers traverse_visitbp went past its birth test for. */
  visited: number;
  /** Block pointers it returned at, and those below them, never read. */
  skipped: number;
  pruned: number;
  bytes: number;
}

/**
 * zfs send [-i @from] @to: send_traverse_thread (traverse_dataset from
 * fromtxg with TRAVERSE_PRE | TRAVERSE_LOGICAL) feeding send_cb, each range
 * turned into records by do_dump, each record checksummed by dump_record.
 * The code runs these in threads joined by queues that keep the order; the
 * model runs them one after the other, which gives the same records.
 */
export function send(to: Snapshot, from: Snapshot | null, opts: Options = {}): Send {
  const sendHolesWithoutBirthTime = opts.sendHolesWithoutBirthTime ?? true;
  const holeBirthTxg = opts.holeBirthTxg ?? HOLE_BIRTH_TXG;
  const minTxg = from ? from.txg : 0;
  const toguid = to.guid;
  const fromguid = from ? from.guid : 0n;
  const records: Rec[] = [];
  const steps: Step[] = [];
  let zc: Cksum = [0n, 0n, 0n, 0n];
  let stepNo = -1;
  let bytes = 0;

  // dump_record, L263-L299: the checksum of everything before drr_checksum,
  // stored there (not for BEGIN), then summed itself, then the payload.
  function dumpRecord(r: Omit<Rec, "header" | "payload" | "cksum" | "step">, payload: Uint8Array = new Uint8Array(0)) {
    const h = header(r, toguid, fromguid, payload.length);
    zc = fletcher4Inc(zc, h.subarray(0, CKSUM_OFFSET));
    let cksum: Cksum | null = null;
    if (r.type !== "BEGIN") {
      cksum = zc;
      putCksum(new DataView(h.buffer), CKSUM_OFFSET, zc);
    }
    zc = fletcher4Inc(zc, h.subarray(CKSUM_OFFSET));
    if (payload.length) zc = fletcher4Inc(zc, payload);
    bytes += RECORD_SIZE + payload.length;
    records.push({ ...r, header: h, payload, cksum, step: stepNo });
    steps[stepNo]?.emitted.push(records.length - 1);
  }

  // The pending FREE or FREEOBJECTS that dump_free / dump_freeobjects aggregate.
  let pending: Omit<Rec, "header" | "payload" | "cksum" | "step"> | null = null;
  const flush = () => {
    if (pending) dumpRecord(pending);
    pending = null;
  };

  // dump_free, L331-L403.
  function dumpFree(object: number, offset: number, length: number) {
    if (pending && pending.type !== "FREE") flush();
    if (pending) {
      if (pending.object === object && pending.offset! + pending.length! === offset) {
        pending.length = length === OBJECT_END ? OBJECT_END : pending.length! + length;
        return;
      }
      flush();
    }
    const r = { type: "FREE" as const, object, offset, length };
    if (length === OBJECT_END) dumpRecord(r); // L396-L398: sent at once
    else pending = r;
  }

  // dump_freeobjects, L650-L710, with the clamp to the objects that can exist.
  function dumpFreeobjects(firstobj: number, numobjs: number) {
    const maxobj = FANOUT * (metaMaxblkid(to.root) + 1);
    if (maxobj <= firstobj) return;
    if (maxobj < firstobj + numobjs) numobjs = maxobj - firstobj;
    if (pending && pending.type !== "FREEOBJECTS") flush();
    if (pending) {
      if (pending.firstobj! + pending.numobjs! === firstobj) {
        pending.numobjs! += numobjs;
        return;
      }
      flush();
    }
    pending = { type: "FREEOBJECTS", firstobj, numobjs };
  }

  // do_dump, L883-L1035, for the ranges send_cb makes in a plain (not raw) stream.
  function doDump(range: "OBJECT" | "OBJECT_RANGE" | "DATA" | "HOLE", object: number, blkid: number, dn?: Dnode, bp?: Bp) {
    if (range === "OBJECT") {
      // dump_dnode, L713-L799.
      if (dn!.type !== "file") return dumpFreeobjects(object, 1);
      flush();
      dumpRecord({ type: "OBJECT", object });
      dumpFree(object, (dn!.maxblkid + 1) * BLKSZ, OBJECT_END); // L796-L799
    } else if (range === "OBJECT_RANGE") {
      return; // L894-L898: only for raw streams
    } else if (range === "DATA") {
      flush(); // dmu_dump_write, L482-L486
      dumpRecord({ type: "WRITE", object, offset: blkid * BLKSZ, data: bp!.data }, blockBytes(bp!.data!));
    } else if (object === 0) dumpFreeobjects(blkid * FANOUT, FANOUT); // L1012-L1017, a hole among the dnode blocks
    else dumpFree(object, blkid * BLKSZ, BLKSZ); // L1018-L1034, a level-0 hole
  }

  let reallocPossible = minTxg !== 0; // traverse_impl, L660
  let visited = 0, skipped = 0, pruned = 0;

  // send_cb, L1071-L1170: which range a callback makes.
  function sendCb(bp: Bp, dn?: Dnode, dnodeLevel = false): Step["range"] {
    if (dnodeLevel) return dn!.object === 0 ? null : "OBJECT"; // L1098-L1108
    if (bp.level === 0 && bp.object === 0 && !bp.hole) return "OBJECT_RANGE"; // L1109-L1116
    if (bp.level < 0 || (bp.level > 0 && !bp.hole)) return null; // L1117-L1118
    if (bp.object === 0 && !bp.hole) return null; // L1119-L1120
    if (bp.object !== 0 && bp.blkid > dn!.maxblkid) return null; // L1130-L1135: past the end of the file
    return bp.hole ? "HOLE" : "DATA"; // L1140-L1146
  }

  const below = (b: Bp) => allBps(b).slice(1).map((x) => x.id);

  // traverse_visitbp, L231-L460, TRAVERSE_PRE.
  function visitbp(bp: Bp, dn?: Dnode) {
    let skip: boolean;
    let zeroHole = false;
    if (bp.birth === 0) {
      zeroHole = true;
      skip = !sendHolesWithoutBirthTime && (!reallocPossible || bp.object === 0) && holeBirthTxg <= minTxg;
    } else skip = bp.birth <= minTxg;
    steps.push({ k: "test", bp, visit: !skip, zeroHole, emitted: [] });
    stepNo = steps.length - 1;
    const st = steps[stepNo];
    if (skip) {
      skipped++;
      st.pruned = below(bp);
      pruned += st.pruned.length;
      return;
    }
    visited++;
    st.range = sendCb(bp, dn);
    if (st.range) doDump(st.range, bp.object, bp.blkid, dn, bp);
    if (bp.hole) return; // L328-L333: the callback, no children
    if (bp.kind === "objset") {
      if (metaMaxblkid(bp) === 0) reallocPossible = false; // L430-L431
      visitDnode({ object: 0, type: "reserved", maxblkid: metaMaxblkid(bp), bp: metaOf(bp) }, true);
    } else if (bp.kids) for (const k of bp.kids) visitbp(k, dn);
    else if (bp.dnodes) for (const d of bp.dnodes) visitDnode(d);
  }

  // traverse_dnode, L524-L568: the dnode's callback first, then its block pointers.
  function visitDnode(dn: Dnode, meta = false) {
    if (!meta) {
      steps.push({ k: "dnode", dn, emitted: [] });
      stepNo = steps.length - 1;
      steps[stepNo].range = sendCb({ id: "", kind: "data", object: dn.object, level: -3, blkid: 0, birth: 0, hole: false }, dn, true);
      if (steps[stepNo].range) doDump("OBJECT", dn.object, 0, dn);
    }
    if (dn.bp) visitbp(dn.bp, dn);
  }

  dumpRecord({ type: "BEGIN" }); // dmu_send_impl, L2556
  visitbp(to.root);
  stepNo = steps.length;
  flush(); // L2604-L2606
  const total = zc;
  dumpRecord({ type: "END", endCksum: total }); // L2620-L2625
  return { to, from, minTxg, steps, records, total, visited, skipped, pruned, bytes };
}

// ---------------------------------------------------------------- the receiver

export interface Dispatch {
  /** Index of the record in the stream. */
  i: number;
  type: RecType;
  /** The function receive_process_record hands it to, or the check it passes. */
  fn: string;
  /** The receiver's check of drr_checksum: the value it computed, and whether it matched. */
  computed: Cksum | null;
  ok: boolean;
  /** What changed in the receiver's tree. */
  effect: string;
  /** The receiver's contents once it is applied. */
  after: Content;
}

export interface Received {
  start: Content;
  content: Content;
  dispatched: Dispatch[];
  /** null on success; else the record whose check failed. */
  error: null | { i: number; err: "ECKSUM" };
}

/** The stream as bytes, record after record: what `zfs send` writes to its pipe. */
export const streamBytes = (recs: Rec[]): { header: Uint8Array; payload: Uint8Array }[] =>
  recs.map((r) => ({ header: r.header.slice(), payload: r.payload.slice() }));

/**
 * zfs receive into a filesystem that holds `start` (the from-snapshot's
 * contents, or nothing for a full stream). Reads each header from the bytes,
 * checks its drr_checksum against the running checksum
 * (receive_read_payload_and_next_header, dmu_recv.c L2843-L2868), and hands it
 * to receive_process_record (L3188-L3240); END is checked against
 * drr_end.drr_checksum in receive_read_record (L3000-L3007). A record is applied only once the next
 * header has been checked, as the reader thread reads them (L3500-L3513).
 */
export function receive(start: Content, stream: { header: Uint8Array; payload: Uint8Array }[]): Received {
  const content: Content = clone(start);
  const dispatched: Dispatch[] = [];
  let zc: Cksum = [0n, 0n, 0n, 0n];
  let prev: Cksum = zc;
  const pend: Dispatch[] = [];
  for (let i = 0; i < stream.length; i++) {
    const { header: h, payload } = stream[i];
    const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
    const type = TYPE_NAME[v.getUint32(0, true)];
    let computed: Cksum | null = null;
    let ok = true;
    if (type === "BEGIN") {
      zc = fletcher4Inc(zc, h); // dmu_recv_begin, L1304-L1306: the whole record
    } else {
      zc = fletcher4Inc(zc, h.subarray(0, CKSUM_OFFSET));
      const stored = getCksum(v, CKSUM_OFFSET);
      computed = zc;
      ok = isZero(stored) || stored.every((w, j) => w === zc[j]);
      // L2861-L2866; on the error the receive is undone (L3582-L3588): the receiver keeps what it started with.
      if (!ok) return { start, content: clone(start), dispatched, error: { i, err: "ECKSUM" } };
      zc = fletcher4Inc(zc, h.subarray(CKSUM_OFFSET));
    }
    // The header just read checks the record before it: that one may now be applied.
    for (const d of pend.splice(0)) dispatched.push(d);
    if (payload.length) zc = fletcher4Inc(zc, payload);
    const d: Dispatch = { i, type, fn: "", computed, ok, effect: "", after: {} };
    switch (type) {
      case "BEGIN":
        d.fn = "dmu_recv_begin";
        break;
      case "OBJECT": {
        const o = Number(v.getBigUint64(8, true));
        d.fn = "receive_object";
        if (content[o]) d.effect = "exists";
        else {
          content[o] = { blocks: [] };
          d.effect = "created";
        }
        break;
      }
      case "FREEOBJECTS": {
        const first = Number(v.getBigUint64(8, true));
        const n = Number(v.getBigUint64(16, true));
        d.fn = "receive_freeobjects";
        const gone: number[] = [];
        for (let o = first === 0 ? 1 : first; o < first + n; o++) if (content[o]) { delete content[o]; gone.push(o); } // L2208-L2215
        d.effect = gone.join(",");
        break;
      }
      case "WRITE": {
        const o = Number(v.getBigUint64(8, true));
        const off = Number(v.getBigUint64(24, true));
        d.fn = "receive_process_write_record";
        const blocks = content[o].blocks;
        while (blocks.length < off / BLKSZ) blocks.push(null);
        blocks[off / BLKSZ] = blockText(payload);
        d.effect = String(off / BLKSZ);
        break;
      }
      case "FREE": {
        const o = Number(v.getBigUint64(8, true));
        const off = Number(v.getBigUint64(16, true));
        const raw = v.getBigUint64(24, true);
        d.fn = "receive_free";
        const blocks = content[o].blocks;
        const first = off / BLKSZ;
        const end = raw === 0xffffffffffffffffn ? blocks.length : first + Number(raw) / BLKSZ;
        const freed: number[] = [];
        for (let b = first; b < Math.min(end, blocks.length); b++) if (blocks[b] !== null) { blocks[b] = null; freed.push(b); }
        content[o].blocks = trim(blocks);
        d.effect = freed.join(",");
        break;
      }
      case "END": {
        d.fn = "receive_read_record";
        computed = prev;
        ok = getCksum(v, 8).every((w, j) => w === prev[j]);
        d.computed = computed;
        d.ok = ok;
        if (!ok) return { start, content: clone(start), dispatched, error: { i, err: "ECKSUM" } };
        break;
      }
    }
    prev = zc;
    d.after = clone(content);
    if (type === "END" || type === "BEGIN") dispatched.push(d);
    else pend.push(d);
  }
  return { start, content, dispatched, error: null };
}

/** Flip one bit of a WRITE's payload in a copy of the stream, as a bad cable would. */
export function flipBit(stream: { header: Uint8Array; payload: Uint8Array }[], i: number) {
  const s = stream.map((r) => ({ header: r.header.slice(), payload: r.payload.slice() }));
  if (s[i].payload.length) s[i].payload[0] ^= 0x01;
  else s[i].header[8] ^= 0x01;
  return s;
}

/** Names the room uses: "@s2". */
export const at = (s: Snapshot | null) => (s ? `@${s.name}` : "");
