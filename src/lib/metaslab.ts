// Model of the Metaslabs and space maps room: one metaslab of one top-level
// vdev, its in-core trees and its on-disk space map, transcribed from
// metaslab.c, space_map.c and space_map.h at zfs-2.4.4. Line numbers are in
// metaslab.c unless named. What it simplifies, and why it stays faithful:
// DECISIONS.md D7.2. Refs: ANALYSIS.md, room "Metaslabs and space maps".
//
// - A vdev of vdev_asize 8 GiB, ashift 12: 16 metaslabs of 512 MiB
//   (vdev_metaslab_set_size, vdev.c L3021-L3026). The figure writes to
//   metaslab 2 only; its space map has sm_shift = ashift (L2920-L2921) and
//   blocks of zfs_metaslab_sm_blksz_no_log = 16 KiB (L74): the pool has no log
//   space map, so metaslab_sync appends to the metaslab's own map (L4397-L4404).
// - spacemap_v2 is active (activated on enable, zfeature_common.c L427-L431).
// - Every allocation is one 128 KiB block through metaslab_df_alloc
//   (L1895-L1957); one txg in flight, synced in one pass.
// - Range trees are sorted arrays of merged [start, end) segments, in bytes,
//   as zfs_range_tree_add / zfs_range_tree_remove keep them.

export const ASHIFT = 12;
export const SM_SHIFT = ASHIFT;
export const MS_SHIFT = 29;
export const MS_SIZE = 2 ** MS_SHIFT;
export const VDEV_ASIZE = 2 ** 33;
export const MS_COUNT = VDEV_ASIZE / MS_SIZE;
export const MS_ID = 2;
export const MS_START = MS_ID * MS_SIZE;
export const MS_END = MS_START + MS_SIZE;
export const BLOCK = 128 * 1024;
export const MIB = 1024 * 1024;
/** zfs_metaslab_sm_blksz_no_log, L74. */
export const SM_BLKSZ = 1 << 14;
const BLOCK_WORDS = SM_BLKSZ / 8;
/** txg.h L42, L49. */
export const TXG_SIZE = 4;
export const TXG_DEFER_SIZE = 2;
/** zfs_condense_pct L89, zfs_metaslab_condense_block_threshold L104. */
export const ZFS_CONDENSE_PCT = 200;
export const CONDENSE_BLOCK_THRESHOLD = 4;
/** metaslab_df_alloc_threshold (SPA_OLD_MAXBLOCKSIZE) L169, metaslab_df_free_pct L177, metaslab_df_max_search L192, metaslab_min_search_count L199. */
export const DF_ALLOC_THRESHOLD = 1 << 17;
export const DF_FREE_PCT = 4;
const DF_MAX_SEARCH = 16 * MIB;
const MIN_SEARCH_COUNT = 100;
/** space_map.h L163-L173, spa.h L103. */
export const SPA_VDEVBITS = 24;
export const SM_NO_VDEVID = 2 ** SPA_VDEVBITS;
export const SM_DEBUG_PREFIX = 2;
export const SM_OFFSET_BITS = 47;
export const SM_RUN_BITS = 15;
export const SM2_PREFIX = 3;
export const SM2_OFFSET_BITS = 63;
export const SM2_RUN_BITS = 36;
export const SM_RUN_MAX = 2 ** SM_RUN_BITS;
export const SM2_RUN_MAX = 2 ** SM2_RUN_BITS;
export const SM_ALLOC = 0;
export const SM_FREE = 1;
/** The figure's file sizes, and the rewrite workload. */
export const SIZES = [4 * MIB, 32 * MIB, 160 * MIB];
export const DB_SIZE = 64 * MIB;
export const REWRITES_PER_TXG = 128;
export const REWRITE_TXGS = 40;

// ---------- Bit fields (bitops.h L46-L48, space_map.h L175-L203) ----------

const P2PHASE = (x: bigint, align: bigint) => x & (align - 1n);
export const BF64_ENCODE = (x: bigint | number, low: number, len: number) => P2PHASE(BigInt(x), 1n << BigInt(len)) << BigInt(low);
export const BF64_DECODE = (x: bigint, low: number, len: number) => P2PHASE(x >> BigInt(low), 1n << BigInt(len));

/** One-word entry, space_map_write_seg L636-L638. */
export function smOneWord(offset: number, type: number, run: number): bigint {
  return BF64_ENCODE(offset, 16, SM_OFFSET_BITS) | BF64_ENCODE(type, 15, 1) | BF64_ENCODE(run - 1, 0, SM_RUN_BITS);
}
/** Two-word entry, space_map_write_seg L643-L651. */
export function smTwoWords(offset: number, type: number, run: number, vdev = SM_NO_VDEVID): [bigint, bigint] {
  return [
    BF64_ENCODE(SM2_PREFIX, 62, 2) | BF64_ENCODE(run - 1, SPA_VDEVBITS, SM2_RUN_BITS) | BF64_ENCODE(vdev, 0, SPA_VDEVBITS),
    BF64_ENCODE(type, SM2_OFFSET_BITS, 1) | BF64_ENCODE(offset, 0, SM2_OFFSET_BITS),
  ];
}
/** Debug entry, space_map_write_intro_debug L534-L537 (all zero for padding, L623-L626). */
export function smDebug(action: number, pass: number, txg: number): bigint {
  return BF64_ENCODE(SM_DEBUG_PREFIX, 62, 2) | BF64_ENCODE(action, 60, 2) | BF64_ENCODE(pass, 50, 10) | BF64_ENCODE(txg, 0, 50);
}

export type Decoded =
  | { kind: "debug"; action: number; pass: number; txg: number }
  | { kind: "one"; offset: number; type: number; run: number }
  | { kind: "two"; run: number; vdev: number };

/** sm_entry_is_* (space_map.c L63-L80) and the decode macros. */
export function decode(w: bigint): Decoded {
  const prefix = Number(BF64_DECODE(w, 62, 2));
  if (prefix === SM_DEBUG_PREFIX)
    return { kind: "debug", action: Number(BF64_DECODE(w, 60, 2)), pass: Number(BF64_DECODE(w, 50, 10)), txg: Number(BF64_DECODE(w, 0, 50)) };
  if (prefix === SM2_PREFIX) return { kind: "two", run: Number(BF64_DECODE(w, SPA_VDEVBITS, SM2_RUN_BITS)) + 1, vdev: Number(BF64_DECODE(w, 0, SPA_VDEVBITS)) };
  return { kind: "one", offset: Number(BF64_DECODE(w, 16, SM_OFFSET_BITS)), type: Number(BF64_DECODE(w, 15, 1)), run: Number(BF64_DECODE(w, 0, SM_RUN_BITS)) + 1 };
}

export const hex = (w: bigint) => "0x" + w.toString(16).toUpperCase().padStart(16, "0");

// ---------- Range trees ----------

export type Seg = [number, number];

export const space = (rt: Seg[]) => rt.reduce((a, [s, e]) => a + e - s, 0);

/** First index whose segment ends after x. */
function after(rt: Seg[], x: number): number {
  let lo = 0;
  let hi = rt.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (rt[m][1] <= x) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** zfs_range_tree_add: the range must be absent; merged with its neighbours (range_tree.c L387-L394). */
export function rtAdd(rt: Seg[], start: number, size: number): void {
  const end = start + size;
  const i = after(rt, start);
  if (i < rt.length && rt[i][0] < end) throw new Error(`add ${start}+${size} overlaps a segment`);
  const before = i > 0 && rt[i - 1][1] === start;
  const next = i < rt.length && rt[i][0] === end;
  if (before && next) {
    rt[i - 1][1] = rt[i][1];
    rt.splice(i, 1);
  } else if (before) rt[i - 1][1] = end;
  else if (next) rt[i][0] = start;
  else rt.splice(i, 0, [start, end]);
}

/** zfs_range_tree_remove: the range must be inside one segment. */
export function rtRemove(rt: Seg[], start: number, size: number): void {
  const end = start + size;
  const i = after(rt, start);
  const seg = rt[i];
  if (!seg || seg[0] > start || seg[1] < end) throw new Error(`remove ${start}+${size} is not in one segment`);
  if (seg[0] === start && seg[1] === end) rt.splice(i, 1);
  else if (seg[0] === start) seg[0] = end;
  else if (seg[1] === end) seg[1] = start;
  else rt.splice(i, 1, [seg[0], start], [end, seg[1]]);
}

const highbit64 = (x: number) => (x === 0 ? 0 : x.toString(2).length);

/** rt_histogram: idx = highbit64(size) - 1 (range_tree.c L131-L132). */
export function histogram(rt: Seg[]): number[] {
  const h = new Array(64).fill(0);
  for (const [s, e] of rt) h[highbit64(e - s) - 1]++;
  return h;
}

/** space_map_estimate_optimal_size, space_map.c L1033-L1085, for SM_NO_VDEVID with spacemap_v2 enabled. */
export function optimalSize(rt: Seg[]): number {
  const h = histogram(rt);
  let size = 0;
  let idx = 0;
  const single = SM_RUN_BITS + SM_SHIFT - 1;
  for (; idx <= single; idx++) size += h[idx] * 8;
  const double = SM2_RUN_BITS + SM_SHIFT - 1;
  for (; idx <= double; idx++) size += h[idx] * 16;
  for (; idx < 64; idx++) size += h[idx] * 2 ** (idx - double) * 16;
  size += (Math.floor(size / SM_BLKSZ) + 1) * 8;
  return size;
}

// ---------- The metaslab ----------

export interface Entry {
  kind: "debug" | "one" | "two";
  /** Index of its first word in the map. */
  at: number;
  words: bigint[];
  /** For entries: SM_ALLOC or SM_FREE, offset and run in sm_shift units. Debug: action, txg (0: padding). */
  type: number;
  offset: number;
  run: number;
  txg: number;
  /** The txg whose sync wrote it, and whether it was written by a condense. */
  wrote: number;
  condense: boolean;
}

export interface File {
  id: string;
  /** Block offsets on the vdev, in file order. */
  blocks: number[];
  /** Txg of the last change not yet synced (write, rewrite, delete), or null. */
  pending: number | null;
  deleting: boolean;
}

export interface Ms {
  txg: number;
  allocatable: Seg[];
  /** ms_allocating[txg & TXG_MASK] of the open txg (the only one in flight). */
  allocating: Seg[];
  freeing: Seg[];
  defer: [Seg[], Seg[]];
  /** ms_lbas[17], the cursor of 128 KiB allocations. */
  cursor: number;
  loaded: boolean;
  tape: Entry[];
  /** smp_length, bytes; smp_alloc, bytes; ms_synced_length. */
  length: number;
  alloc: number;
  synced: number;
  files: File[];
  seq: number;
  rng: number;
  /** ms_condense_wanted (L3851-L3852); the figure never sets it, the tests do. */
  condenseWanted: boolean;
}

export type Pick = "cursor" | "size" | "bestfit";

export type Ev =
  | { k: "write"; id: string; size: number; exts: Seg[]; picks: Record<Pick, number>; cursor: number }
  | { k: "full"; size: number; free: number }
  | { k: "delete"; id: string; exts: Seg[] }
  | { k: "busy"; id: string }
  | { k: "rewrite"; id: string; n: number; txg: number; freed: Seg[]; allocated: Seg[] }
  | { k: "condense"; txg: number; before: number; after: number; check: Check }
  | { k: "append"; txg: number; type: number; entries: number; words: number; from: number; two: number; pad: number }
  | { k: "nothing"; txg: number }
  | { k: "deferBack"; txg: number; freed: number; bytes: number }
  | { k: "defer"; txg: number; bytes: number; back: number }
  | { k: "synced"; txg: number; length: number; alloc: number }
  | { k: "load"; entries: number; words: number; segs: number; same: boolean; deferred: number }
  | { k: "notClean"; txg: number }
  | { k: "refuse"; check: Check }
  | { k: "idle"; check: Check }
  | { k: "churn"; txgs: number; from: number; stopped: boolean; blocks: number };

export interface Check {
  yes: boolean;
  empty: boolean;
  object: number;
  optimal: number;
  /** optimal_size * zfs_condense_pct / 100, and zfs_metaslab_condense_block_threshold * record_size. */
  t1: number;
  t2: number;
  segs: number;
}

export function empty(): Ms {
  return {
    txg: 10,
    allocatable: [[MS_START, MS_END]],
    allocating: [],
    freeing: [],
    defer: [[], []],
    cursor: 0,
    loaded: true,
    tape: [],
    length: 0,
    alloc: 0,
    synced: 0,
    files: [],
    seq: 0,
    rng: 7,
    condenseWanted: false,
  };
}

/** The figure's opening state: A (32 MiB) written and synced in txg 10, B (4 MiB) in txg 11. */
export function opening(): Ms {
  const s = empty();
  write(s, 32 * MIB);
  sync(s);
  write(s, 4 * MIB);
  sync(s);
  return s;
}

export const clone = (s: Ms): Ms => structuredClone(s);

const largest = (rt: Seg[]) => rt.reduce((a, [s, e]) => Math.max(a, e - s), 0);

/** metaslab_block_picker, L1771-L1802, for a request of one size. */
function picker(rt: Seg[], s: Ms, size: number): number {
  if (s.cursor === 0) s.cursor = MS_START;
  let i = after(rt, s.cursor);
  const first = rt[i]?.[0];
  let count = 0;
  while (i < rt.length && (rt[i][0] - first <= DF_MAX_SEARCH || count < MIN_SEARCH_COUNT)) {
    const [start, end] = rt[i];
    if (start + size <= end) {
      s.cursor = start + Math.min(end - start, size);
      return start;
    }
    i++;
    count++;
  }
  s.cursor = 0;
  return -1;
}

/** metaslab_df_alloc, L1895-L1957, with size == max_size. */
export function dfAlloc(s: Ms, size: number): { offset: number; pick: Pick } {
  const rt = s.allocatable;
  const freePct = Math.floor((space(rt) * 100) / MS_SIZE);
  let offset = -1;
  let pick: Pick = "bestfit";
  if (!(largest(rt) < DF_ALLOC_THRESHOLD || freePct < DF_FREE_PCT)) {
    offset = picker(rt, s, size);
    pick = "cursor";
  }
  if (offset === -1) {
    if (pick === "cursor") pick = "size";
    // ms_allocatable_by_size: by size, then offset; a segment of this size or the next larger.
    let best: Seg | undefined;
    for (const seg of rt) if (seg[1] - seg[0] >= size && (!best || seg[1] - seg[0] < best[1] - best[0])) best = seg;
    if (best) {
      offset = best[0];
      s.cursor = offset + Math.min(best[1] - best[0], size);
    }
  }
  return { offset, pick };
}

/** Segments of a list of blocks, merged. */
export function extents(blocks: number[]): Seg[] {
  const rt: Seg[] = [];
  for (const b of [...blocks].sort((x, y) => x - y)) rtAdd(rt, b, BLOCK);
  return rt;
}

/** metaslab_block_alloc, L4863-L4890: carve one block, record it in ms_allocating. */
function allocBlock(s: Ms, picks: Record<Pick, number>): number {
  if (!s.loaded) throw new Error("allocation from an unloaded metaslab");
  const { offset, pick } = dfAlloc(s, BLOCK);
  if (offset < 0) throw new Error("no space");
  rtRemove(s.allocatable, offset, BLOCK);
  rtAdd(s.allocating, offset, BLOCK);
  picks[pick]++;
  return offset;
}

/** Free one block in syncing context: ms_freeing (L5527). */
const freeBlock = (s: Ms, b: number) => rtAdd(s.freeing, b, BLOCK);

const name = (n: number) => (n < 26 ? String.fromCharCode(65 + n) : `F${n + 1}`);

/** Write a file of `size` bytes (a multiple of 128 KiB) in the open txg. */
export function write(s: Ms, size: number, id?: string): Ev[] {
  if (space(s.allocatable) < size) return [{ k: "full", size, free: space(s.allocatable) }];
  const picks: Record<Pick, number> = { cursor: 0, size: 0, bestfit: 0 };
  const blocks: number[] = [];
  for (let i = 0; i < size / BLOCK; i++) blocks.push(allocBlock(s, picks));
  const f: File = { id: id ?? name(s.seq++), blocks, pending: s.txg, deleting: false };
  s.files.push(f);
  return [{ k: "write", id: f.id, size, exts: extents(blocks), picks, cursor: s.cursor }];
}

export const file = (s: Ms, id: string) => s.files.find((f) => f.id === id);

/** Delete a synced file: its blocks are freed in this txg's sync. */
export function del(s: Ms, id: string): Ev[] {
  const f = file(s, id);
  if (!f) return [];
  if (f.pending !== null) return [{ k: "busy", id }];
  for (const b of f.blocks) freeBlock(s, b);
  f.pending = s.txg;
  f.deleting = true;
  return [{ k: "delete", id, exts: extents(f.blocks) }];
}

/** mulberry32, for the rewrite workload. */
function random(s: Ms): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Copy-on-write rewrite of n random blocks of a file: free the old block, allocate a new one. */
export function rewrite(s: Ms, id: string, n: number): Ev[] {
  const f = file(s, id);
  if (!f || f.deleting) return [];
  const idx = new Set<number>();
  while (idx.size < Math.min(n, f.blocks.length)) idx.add(Math.floor(random(s) * f.blocks.length));
  const picks: Record<Pick, number> = { cursor: 0, size: 0, bestfit: 0 };
  const freed: number[] = [];
  const allocated: number[] = [];
  for (const i of [...idx].sort((a, b) => a - b)) {
    if (space(s.allocatable) < BLOCK) break;
    freed.push(f.blocks[i]);
    freeBlock(s, f.blocks[i]);
    f.blocks[i] = allocBlock(s, picks);
    allocated.push(f.blocks[i]);
  }
  f.pending = s.txg;
  return [{ k: "rewrite", id, n: freed.length, txg: s.txg, freed: extents(freed), allocated: extents(allocated) }];
}

/** metaslab_should_condense, L3836-L3861. */
export function shouldCondense(s: Ms): Check {
  const segs = s.allocatable.length;
  const object = s.length;
  const optimal = optimalSize(s.allocatable);
  const record = Math.max(SM_BLKSZ, 1 << ASHIFT);
  const t1 = Math.floor((optimal * ZFS_CONDENSE_PCT) / 100);
  const t2 = CONDENSE_BLOCK_THRESHOLD * record;
  const isEmpty = segs === 0;
  return { yes: isEmpty || s.condenseWanted || (object >= t1 && object > t2), empty: isEmpty, object, optimal, t1, t2, segs };
}

/** L4279-L4284: metaslab_sync does nothing for a metaslab without allocations or frees (or a requested condense) in this txg. */
export const dirty = (s: Ms) => s.allocating.length > 0 || s.freeing.length > 0 || (s.loaded && s.condenseWanted);

function push(s: Ms, e: Omit<Entry, "at">) {
  s.tape.push({ ...e, at: s.length / 8 });
  s.length += e.words.length * 8;
}

/** space_map_write (space_map.c L760-L796) of one tree to the metaslab's map, without a vdev id. */
function smWrite(s: Ms, rt: Seg[], type: number, condense: boolean): Ev | null {
  if (rt.length === 0) return null;
  if (type === SM_ALLOC) s.alloc += space(rt);
  else s.alloc -= space(rt);
  const from = s.length / 8;
  const base = { wrote: s.txg, condense };
  // space_map_write_intro_debug, L529-L543: sync pass 1.
  push(s, { ...base, kind: "debug", words: [smDebug(type, 1, s.txg)], type, offset: 0, run: 0, txg: s.txg });
  let entries = 0;
  let two = 0;
  let pad = 0;
  for (const [a, b] of rt) {
    // space_map_write_impl, L704-L739.
    let start = (a - MS_START) / 2 ** SM_SHIFT;
    let size = (b - a) / 2 ** SM_SHIFT;
    const words = start >= 2 ** SM_OFFSET_BITS || size > SM_RUN_MAX ? 2 : 1;
    const runMax = words === 2 ? SM2_RUN_MAX : SM_RUN_MAX;
    // space_map_write_seg, L588-L663.
    while (size !== 0) {
      if (words === 2 && (s.length / 8) % BLOCK_WORDS === BLOCK_WORDS - 1) {
        push(s, { ...base, kind: "debug", words: [smDebug(0, 0, 0)], type: 0, offset: 0, run: 0, txg: 0 });
        pad++;
        continue;
      }
      const run = Math.min(size, runMax);
      if (words === 1) push(s, { ...base, kind: "one", words: [smOneWord(start, type, run)], type, offset: start, run, txg: s.txg });
      else {
        push(s, { ...base, kind: "two", words: smTwoWords(start, type, run), type, offset: start, run, txg: s.txg });
        two++;
      }
      entries++;
      start += run;
      size -= run;
    }
  }
  return { k: "append", txg: s.txg, type, entries, words: s.length / 8 - from, from, two, pad };
}

/** metaslab_condense, L3873-L4022, in sync pass 1 of the open txg. */
function condense(s: Ms): void {
  s.condenseWanted = false;
  const ct: Seg[] = [];
  for (const d of s.defer) for (const [a, b] of d) rtAdd(ct, a, b - a);
  for (const [a, b] of s.allocating) rtAdd(ct, a, b - a);
  // space_map_truncate, space_map.c L908-L910.
  s.tape = [];
  s.length = 0;
  s.alloc = 0;
  smWrite(s, [[MS_START, MS_END]], SM_ALLOC, true);
  smWrite(s, s.allocatable, SM_FREE, true);
  smWrite(s, ct, SM_FREE, true);
}

/** Sync the open txg: metaslab_sync (L4245-L4522) then metaslab_sync_done (L4546-L4674). */
export function sync(s: Ms): Ev[] {
  const ev: Ev[] = [];
  const txg = s.txg;
  if (dirty(s)) {
    // L4363-L4365: sync pass 1, loaded, and metaslab_should_condense.
    const check = shouldCondense(s);
    if (s.loaded && check.yes) {
      const before = s.length;
      condense(s);
      ev.push({ k: "condense", txg, before, after: s.length, check });
    }
    for (const e of [smWrite(s, s.allocating, SM_ALLOC, false), smWrite(s, s.freeing, SM_FREE, false)]) if (e) ev.push(e);
  } else ev.push({ k: "nothing", txg });
  // L4493-L4501: ms_freeing becomes ms_freed; this txg's allocations are done.
  const freed = s.freeing;
  s.freeing = [];
  s.allocating = [];
  // metaslab_sync_done, L4630-L4633.
  const d = txg % TXG_DEFER_SIZE;
  const back = s.defer[d];
  if (back.length) {
    for (const [a, b] of back) if (s.loaded) rtAdd(s.allocatable, a, b - a);
    ev.push({ k: "deferBack", txg, freed: txg - TXG_DEFER_SIZE, bytes: space(back) });
  }
  s.defer[d] = freed;
  if (freed.length) ev.push({ k: "defer", txg, bytes: space(freed), back: txg + TXG_DEFER_SIZE });
  s.synced = s.length;
  s.files = s.files.filter((f) => !(f.deleting && f.pending !== null));
  for (const f of s.files) f.pending = null;
  ev.push({ k: "synced", txg, length: s.length, alloc: s.alloc });
  s.txg++;
  return ev;
}

/** The Condense button: metaslab_should_condense now; if yes, the open txg's sync, which condenses first. */
export function condenseNow(s: Ms): Ev[] {
  const check = shouldCondense(s);
  if (!check.yes) return [{ k: "refuse", check }];
  if (!dirty(s)) return [{ k: "idle", check }];
  return sync(s);
}

/** space_map_load_length (space_map.c L423-L443) with space_map_load_callback (L401-L416), up to `upTo` entries. */
export function replay(tape: Entry[], upTo = tape.length): Seg[] {
  const rt: Seg[] = [[MS_START, MS_END]];
  for (let i = 0; i < upTo; i++) {
    const e = tape[i];
    if (e.kind === "debug") continue;
    const at = MS_START + e.offset * 2 ** SM_SHIFT;
    const run = e.run * 2 ** SM_SHIFT;
    if (e.type === SM_FREE) rtAdd(rt, at, run);
    else rtRemove(rt, at, run);
  }
  return rt;
}

/** metaslab_unload then metaslab_load_impl (L2482-L2652), on a clean txg. */
export function load(s: Ms): Ev[] {
  if (dirty(s)) return [{ k: "notClean", txg: s.txg }];
  const before = JSON.stringify(s.allocatable);
  s.allocatable = [];
  s.loaded = false;
  const rt = replay(s.tape.filter((e) => e.at * 8 < s.synced));
  let deferred = 0;
  for (const d of s.defer) for (const [a, b] of d) {
    rtRemove(rt, a, b - a);
    deferred += b - a;
  }
  s.allocatable = rt;
  s.loaded = true;
  const entries = s.tape.filter((e) => e.kind !== "debug").length;
  return [{ k: "load", entries, words: s.length / 8, segs: rt.length, same: JSON.stringify(rt) === before, deferred }];
}

/** The rewrite workload: up to 40 txgs of 128 rewrites each, synced, stopping before a sync that would condense. */
export function churn(s: Ms): Ev[] {
  const ev: Ev[] = [];
  // Sync pending changes first, so a db being deleted is gone and the range starts at the open txg.
  if (dirty(s)) ev.push(...sync(s));
  if (!file(s, "db")) {
    const w = write(s, DB_SIZE, "db");
    if (w[0].k === "full") return [...ev, ...w];
    ev.push(...w, ...sync(s));
  }
  const from = s.txg;
  let txgs = 0;
  let blocks = 0;
  for (let i = 0; i < REWRITE_TXGS; i++) {
    const r = rewrite(s, "db", REWRITES_PER_TXG);
    if (r[0]?.k === "rewrite") blocks += r[0].n;
    txgs++;
    if (shouldCondense(s).yes) {
      ev.push({ k: "churn", txgs, from, stopped: true, blocks });
      return ev;
    }
    sync(s);
  }
  ev.push({ k: "churn", txgs, from, stopped: false, blocks });
  return ev;
}

/** Every byte of the metaslab in exactly one place (a check for the tests and the figure). */
export function accounted(s: Ms): number {
  return space(s.allocatable) + space(s.allocating) + space(s.freeing) + space(s.defer[0]) + space(s.defer[1]);
}
