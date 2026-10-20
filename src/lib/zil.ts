// Model of the ZIL and SLOG room: one file of one dataset, its in-memory
// itxs, its chain of log write blocks (lwbs) and the zil_header_t, through
// write(), fsync(), txg sync, a crash, the claim at import and the replay at
// mount. Transcribed from zil.c, zfs_log.c, zfs_vnops.c and zio.c at
// zfs-2.4.4; line numbers are in zil.c unless named. What it simplifies, and
// why it stays faithful: DECISIONS.md D8.2. Refs: ANALYSIS.md, room "ZIL and SLOG".
//
// - The file already spans several records, so its blocks are 128 KiB
//   (z_blksz = recordsize; a file of one block smaller than recordsize has a
//   smaller block, zfs_vnops.c L808-L821); each write() starts at the
//   beginning of a file block (so a WR_INDIRECT write is one record).
// - O_DIRECT takes the Direct I/O path only for a write of at least a block;
//   a shorter one goes through the ARC (zfs_setup_direct, zfs_vnops.c L296-L299).
// - The first block of a new chain is ZIL_MIN_BLKSZ, 4 KiB (zil_create,
//   L1022-L1023); every later log block is 128 KiB (zil_maxblocksize, L1783),
//   where the code sizes it from the burst (zil_lwb_plan, L1789).
// - A commit on an empty log (zh_log a hole) waits for the open txg to sync
//   (zil_create, L1034-L1056) before it assigns the itxs, so the itxs of that
//   txg are dropped as synced (L3209, L3280-L3283) and only the commit waiter
//   goes into the first lwb.
// - One file, one writer (!zl_parallel): a commit closes and issues its last
//   lwb at once (L3375-L3379); no I/O error.
// - One txg in flight; Sync syncs it and opens the next.

export const KIB = 1024;
/** z_blksz of the figure's file: recordsize 128 KiB. */
export const BLOCKSIZE = 128 * KIB;
/** zfs_immediate_write_sz, L2191. */
export const ZFS_IMMEDIATE_WRITE_SZ = 32768;
/** zil_maxcopied, L2186. */
export const ZIL_MAXCOPIED = 7680;
/** zil_maxblocksize = SPA_OLD_MAXBLOCKSIZE, L1783. */
export const ZIL_MAX_BLOCK_SIZE = 128 * KIB;
/** ZIL_MIN_BLKSZ, zil.h L99: the size of the block zil_create allocates (L1022-L1023). */
export const ZIL_MIN_BLKSZ = 4 * KIB;
/** sizeof (zil_chain_t): zc_pad, zc_next_blk (blkptr_t, 128), zc_nused, zc_eck (40). zil.h L92-L97. */
export const ZIL_CHAIN_SIZE = 8 + 128 + 8 + 40;
/** sizeof (lr_write_t): lr_t (32), four uint64_t, lr_blkptr (128). zil.h L217-L222, L353-L362. */
export const LR_WRITE_SIZE = 32 + 32 + 128;
/** Room for records in a log block of `size` bytes: lwb_nmax - lwb_nused at open, L1769-L1775. */
export const lwbRoom = (size: number) => size - ZIL_CHAIN_SIZE;
/** Room for records in a 128 KiB log block. */
export const LWB_ROOM = lwbRoom(ZIL_MAX_BLOCK_SIZE);
/** zil_max_log_data(zilog, sizeof (lr_write_t)), L2164-L2167. */
export const MAX_LOG_DATA = ZIL_MAX_BLOCK_SIZE - ZIL_CHAIN_SIZE - LR_WRITE_SIZE;
/** zil_max_copied_data, L2202-L2206. */
export const MAX_COPIED_DATA = Math.min(MAX_LOG_DATA, ZIL_MAXCOPIED);
/** zil_max_waste_space, L2173-L2177. */
export const MAX_WASTE_SPACE = Math.floor(MAX_LOG_DATA / 16);
/** The figure's write sizes. */
export const SIZES = [4 * KIB, 16 * KIB, 48 * KIB, 128 * KIB];
export const FIRST_TXG = 100;

export type WrState = "WR_COPIED" | "WR_NEED_COPY" | "WR_INDIRECT";
export type Logbias = "latency" | "throughput";
export type SlogMode = "none" | "slog" | "full";
/** The metaslab classes zio_alloc_zil tries, in order (zio.c L4561-L4595). */
export const CLASSES = ["log", "special_embedded_log", "special", "embedded_log", "normal"] as const;
export type AllocClass = (typeof CLASSES)[number];

/** The lwb states, in order (zil_impl.h L83-L92). */
export const LWB_STATES = ["NEW", "OPENED", "CLOSED", "READY", "ISSUED", "WRITE_DONE", "FLUSH_DONE"] as const;
export type LwbState = (typeof LWB_STATES)[number];

// ---------- zil_write_state and zfs_log_write ----------

export interface StateInput {
  hasSlogs: boolean;
  hasSpecial?: boolean;
  /** blocksize <= os_zpl_special_smallblock: the file's blocks go to the special class. */
  onSpecial?: boolean;
  /** zil_special_is_slog, L2199 (default 1). */
  specialIsSlog?: boolean;
  logbias: Logbias;
  size: number;
  blocksize: number;
  oDirect: boolean;
  commit: boolean;
}

/** Why zil_write_state chose what it chose, for the panel and the log. */
export type Reason = "throughput" | "direct" | "small" | "halfBlock" | "indirect" | "slog" | "special" | "copied" | "needCopy";

/** zil_write_state, L2212-L2246, line for line. */
export function zilWriteState(i: StateInput): { state: WrState; reasons: Reason[] } {
  const reasons: Reason[] = [];
  if (i.logbias === "throughput" || i.oDirect) {
    reasons.push(i.logbias === "throughput" ? "throughput" : "direct");
    return { state: "WR_INDIRECT", reasons };
  }
  let indirect = i.size >= ZFS_IMMEDIATE_WRITE_SZ && (i.size >= i.blocksize / 2 || !i.commit);
  if (i.size < ZFS_IMMEDIATE_WRITE_SZ) reasons.push("small");
  else if (!indirect) reasons.push("halfBlock");
  else reasons.push("indirect");
  if (i.hasSlogs) {
    if (indirect) reasons.push("slog");
    indirect = false;
  } else if (i.hasSpecial) {
    const before = indirect;
    indirect = indirect && (!!i.onSpecial || !(i.specialIsSlog ?? true));
    if (before && !indirect) reasons.push("special");
  }
  if (indirect) return { state: "WR_INDIRECT", reasons };
  if (i.commit) return { state: "WR_COPIED", reasons: [...reasons, "copied"] };
  return { state: "WR_NEED_COPY", reasons: [...reasons, "needCopy"] };
}

export interface RecordPlan {
  state: WrState;
  off: number;
  len: number;
  /** zil_write_state's choice, before the WR_COPIED downgrade. */
  chosen: WrState;
  downgraded: boolean;
}

/** zfs_log_write, zfs_log.c L627-L649: the records of one write() at offset off. */
export function logWrite(i: StateInput, off: number): RecordPlan[] {
  const chosen = zilWriteState(i).state;
  const out: RecordPlan[] = [];
  let resid = i.size;
  while (resid > 0) {
    let state = chosen;
    let len = resid;
    let downgraded = false;
    if (state === "WR_COPIED" && resid > MAX_COPIED_DATA) {
      state = "WR_NEED_COPY";
      downgraded = true;
    } else if (state === "WR_INDIRECT") len = Math.min(i.blocksize - (off % i.blocksize), resid);
    out.push({ state, off, len, chosen, downgraded });
    off += len;
    resid -= len;
  }
  return out;
}

// ---------- zio_alloc_zil ----------

export interface Pool {
  slog: SlogMode;
  special?: boolean;
  /** No room left in the embedded log class (for the tests). */
  embeddedFull?: boolean;
}

export type Try = { cls: AllocClass; ok: boolean; why: "taken" | "absent" | "full" };

/** zio_alloc_zil, zio.c L4561-L4595: the classes tried, in order, until one gives a block. */
export function allocZil(p: Pool): { cls: AllocClass; slog: boolean; tried: Try[] } {
  const tried: Try[] = [];
  for (const cls of CLASSES) {
    let why: Try["why"];
    if (cls === "log") why = p.slog === "none" ? "absent" : p.slog === "full" ? "full" : "taken";
    else if (cls === "special_embedded_log" || cls === "special") why = p.special ? "taken" : "absent";
    else if (cls === "embedded_log") why = p.embeddedFull ? "full" : "taken";
    else why = "taken";
    tried.push({ cls, ok: why === "taken", why });
    if (why === "taken") return { cls, slog: cls === "log", tried };
  }
  throw new Error("unreachable: the normal class always gives a block here");
}

/** spa_has_slogs, spa_misc.c L2741-L2744: the log class has a group, full or not. */
export const hasSlogs = (p: Pool) => p.slog !== "none";

// ---------- The state ----------

export type WriteStatus = "memory" | "logged" | "synced" | "lost" | "replayed";

export interface Write {
  id: number;
  size: number;
  off: number;
  txg: number;
  state: WrState;
  dsync: boolean;
  direct: boolean;
  status: WriteStatus;
  /** WR_INDIRECT: the file's block has been written in place (dmu_sync or the Direct I/O write). */
  inPlace: boolean;
}

export interface Itx {
  write: number;
  txg: number;
  state: WrState;
  off: number;
  len: number;
}

export interface Rec {
  seq: number;
  write: number;
  txg: number;
  state: WrState;
  off: number;
  len: number;
  /** Bytes taken in the block: header (with the data for WR_COPIED) plus copied data. */
  bytes: number;
}

export interface Block {
  id: number;
  cls: AllocClass;
  txg: number;
  /** Bytes: ZIL_MIN_BLKSZ for a block from zil_create, ZIL_MAX_BLOCK_SIZE otherwise. */
  size: number;
}

export interface Lwb {
  id: number;
  blk: Block | null;
  state: LwbState;
  recs: Rec[];
  nused: number;
  maxTxg: number;
  allocTxg: number;
  slog: boolean;
  waiters: number;
  /** lwb_sz: the size of its block (L834, L850). */
  size: number;
}

export type Phase = "running" | "crashed" | "imported";

export interface Header {
  /** zh_log: the block the chain starts at, or null for a hole. */
  log: number | null;
  claimTxg: number;
  replaySeq: number;
  replayNeeded: boolean;
}

export interface Zil {
  pool: Pool;
  logbias: Logbias;
  txg: number;
  synced: number;
  phase: Phase;
  writes: Write[];
  pending: Itx[];
  /** zl_lwb_list, oldest first. */
  lwbs: Lwb[];
  /** Freed log blocks, drawn greyed. */
  freed: Block[];
  /** Blocks written but lost from memory by a crash, as the chain on disk: written lwbs plus the allocated tail. */
  disk: { blk: Block; recs: Rec[]; written: boolean }[];
  header: Header;
  lrSeq: number;
  nextBlock: number;
  nextLwb: number;
  /** Data blocks of the file written in place for WR_INDIRECT records. */
  inPlace: number[];
  /** The first block of a chain kept by zil_destroy(keep_first) (L4181-L4192), reused by zil_create (L1004-L1011). */
  kept: Block | null;
}

export type Ev =
  | { k: "itx"; write: number; size: number; state: WrState; recs: number; txg: number }
  | { k: "create"; blk: Block; tried: Try[] }
  | { k: "createWait"; txg: number }
  | { k: "dropSynced"; itxs: number; txg: number }
  | { k: "reuse"; blk: Block }
  | { k: "lwb"; lwb: number; state: LwbState }
  | { k: "assign"; lwb: number; seq: number; write: number; state: WrState; len: number; split: boolean; bytes: number }
  | { k: "waiter"; lwb: number }
  | { k: "inplace"; write: number }
  | { k: "alloc"; lwb: number; next: number; blk: Block; tried: Try[] }
  | { k: "returns"; how: "fsync" | "write"; via: "log" | "sync" }
  | { k: "nothing" }
  | { k: "sync"; txg: number; writes: number; dropped: number }
  | { k: "free"; blk: Block }
  | { k: "head"; blk: number | null }
  | { k: "crash"; lost: number }
  | { k: "claim"; first: number; blocks: number; recs: number; needed: boolean }
  | { k: "replay"; seq: number; write: number; txg: number }
  | { k: "skip"; seq: number; txg: number; why: "seq" | "txg" }
  | { k: "destroy"; kept: number | null }
  | { k: "refused"; why: "crashed" | "imported" | "running" | "notCrashed" | "notImported" };

export function empty(): Zil {
  return {
    pool: { slog: "none" },
    logbias: "latency",
    txg: FIRST_TXG,
    synced: FIRST_TXG - 1,
    phase: "running",
    writes: [],
    pending: [],
    lwbs: [],
    freed: [],
    disk: [],
    header: { log: null, claimTxg: 0, replaySeq: 0, replayNeeded: false },
    lrSeq: 0,
    nextBlock: 1,
    nextLwb: 1,
    inPlace: [],
    kept: null,
  };
}

export const clone = (s: Zil): Zil => structuredClone(s);

const newLwb = (s: Zil, blk: Block | null, slog: boolean, allocTxg: number): Lwb => {
  const size = blk ? blk.size : ZIL_MAX_BLOCK_SIZE;
  const l: Lwb = { id: s.nextLwb++, blk, state: "NEW", recs: [], nused: 0, maxTxg: 0, allocTxg, slog, waiters: 0, size };
  s.lwbs.push(l);
  return l;
};

const block = (s: Zil, cls: AllocClass, size = ZIL_MAX_BLOCK_SIZE): Block => ({ id: s.nextBlock++, cls, txg: s.txg, size });

export interface Flags {
  dsync: boolean;
  direct: boolean;
}

/** The input of zil_write_state for a write of `size` bytes with the figure's settings. */
/** zfs_setup_direct, zfs_vnops.c L296-L299: O_DIRECT sets UIO_DIRECT only for a write of at least one file block. */
export const directPath = (size: number, f: Flags) => f.direct && size >= BLOCKSIZE;

export const stateInput = (s: Zil, size: number, f: Flags): StateInput => ({
  hasSlogs: hasSlogs(s.pool),
  hasSpecial: !!s.pool.special,
  logbias: s.logbias,
  size,
  blocksize: BLOCKSIZE,
  oDirect: directPath(size, f),
  commit: f.dsync,
});

/** write(): zfs_write logs the write (zfs_log_write), then commits if O_DSYNC (zfs_vnops.c L1042-L1092). */
export function write(s: Zil, size: number, f: Flags): Ev[] {
  if (s.phase !== "running") return [{ k: "refused", why: s.phase }];
  const id = s.writes.length + 1;
  const off = s.writes.length * BLOCKSIZE;
  const plan = logWrite(stateInput(s, size, f), off);
  s.writes.push({ id, size, off, txg: s.txg, state: plan[0].state, dsync: f.dsync, direct: f.direct, status: "memory", inPlace: false });
  for (const r of plan) s.pending.push({ write: id, txg: s.txg, state: r.state, off: r.off, len: r.len });
  const ev: Ev[] = [{ k: "itx", write: id, size, state: plan[0].state, recs: plan.length, txg: s.txg }];
  if (f.dsync) ev.push(...commit(s, "write"));
  return ev;
}

/** fsync(): zfs_fsync calls zil_commit (zfs_vnops.c L117-L120). */
export function fsync(s: Zil): Ev[] {
  if (s.phase !== "running") return [{ k: "refused", why: s.phase }];
  return commit(s, "fsync");
}

/** zil_lwb_assign, L2334-L2387: one itx into the lwbs, split if WR_NEED_COPY does not fit. */
function assign(s: Zil, lwb: Lwb, itx: Itx, ev: Ev[], closed: Lwb[]): Lwb {
  if (lwb.state === "NEW") {
    lwb.state = "OPENED";
    ev.push({ k: "lwb", lwb: lwb.id, state: "OPENED" });
  }
  const reclen = LR_WRITE_SIZE + (itx.state === "WR_COPIED" ? itx.len : 0);
  let dlen = itx.state === "WR_NEED_COPY" ? itx.len : 0;
  let off = itx.off;
  for (;;) {
    let sp = lwbRoom(lwb.size) - lwb.nused;
    if (
      reclen > sp ||
      (reclen + dlen > sp && sp < MAX_WASTE_SPACE && (dlen % MAX_LOG_DATA === 0 || sp < reclen + (dlen % MAX_LOG_DATA)))
    ) {
      closed.push(lwb);
      lwb = close(s, lwb, ev);
      lwb.state = "OPENED";
      ev.push({ k: "lwb", lwb: lwb.id, state: "OPENED" });
      sp = lwbRoom(lwb.size) - lwb.nused;
    }
    const dnow = Math.min(dlen, sp - reclen);
    const split = dlen > dnow;
    const len = itx.state === "WR_NEED_COPY" ? dnow : itx.len;
    const rec: Rec = { seq: ++s.lrSeq, write: itx.write, txg: itx.txg, state: itx.state, off, len, bytes: reclen + dnow };
    lwb.recs.push(rec);
    lwb.nused += reclen + dnow;
    lwb.maxTxg = Math.max(lwb.maxTxg, itx.txg);
    ev.push({ k: "assign", lwb: lwb.id, seq: rec.seq, write: itx.write, state: itx.state, len, split: split || off !== itx.off, bytes: rec.bytes });
    off += dnow;
    dlen -= dnow;
    if (dlen <= 0) return lwb;
  }
}

/** zil_lwb_write_close, L1873-L1931: closed, and the next lwb created, empty and without a block. */
function close(s: Zil, lwb: Lwb, ev: Ev[]): Lwb {
  lwb.state = "CLOSED";
  ev.push({ k: "lwb", lwb: lwb.id, state: "CLOSED" });
  const n = newLwb(s, null, false, 0);
  ev.push({ k: "lwb", lwb: n.id, state: "NEW" });
  return n;
}

/** zil_commit_impl (L4067) with zil_commit_writer and zil_commit_waiter, for one writer. */
function commit(s: Zil, how: "fsync" | "write"): Ev[] {
  const ev: Ev[] = [];
  if (s.pending.length === 0) {
    // zil_prune_commit_list: nothing to log, the waiter is done at once (L3040-L3062).
    ev.push({ k: "nothing" }, { k: "returns", how, via: "log" });
    return ev;
  }
  // zil_create, L984-L1030: a chain needs a first block.
  let lwb = s.lwbs.find((l) => l.state === "NEW" || l.state === "OPENED");
  let via: "log" | "sync" = "log";
  if (!lwb && s.kept && s.header.log === s.kept.id) {
    // zh_log already names a block, kept by the last zil_destroy: zil_create uses it (L1004-L1011, L1032).
    lwb = newLwb(s, s.kept, false, 0);
    ev.push({ k: "reuse", blk: s.kept }, { k: "lwb", lwb: lwb.id, state: "NEW" });
    s.kept = null;
  }
  if (!lwb) {
    // zh_log is a hole: a first block of ZIL_MIN_BLKSZ, allocated in a tx of the open txg
    // (L1011-L1027); the commit then waits for that txg to sync, so that zil_sync puts the
    // block into zh_log (L1034-L1056). The itxs were already on the commit list: their txg is
    // now synced, so they are dropped rather than logged (L3209, L3280-L3283).
    const a = allocZil(s.pool);
    const blk = block(s, a.cls, ZIL_MIN_BLKSZ);
    lwb = newLwb(s, blk, a.slog, s.txg);
    ev.push({ k: "create", blk, tried: a.tried }, { k: "lwb", lwb: lwb.id, state: "NEW" }, { k: "createWait", txg: s.txg });
    ev.push(...syncTxg(s, true));
    via = "sync";
  }
  const closed: Lwb[] = [];
  const synced = s.pending.filter((i) => i.txg <= s.synced).length;
  if (synced) ev.push({ k: "dropSynced", itxs: synced, txg: s.synced });
  for (const itx of s.pending) {
    if (itx.txg <= s.synced) continue;
    lwb = assign(s, lwb, itx, ev, closed);
    s.writes[itx.write - 1].status = "logged";
  }
  s.pending = [];
  // The commit itx: zil_lwb_assign opens the lwb for it too (L2301), and its waiter goes on the
  // last lwb (L2318-L2322), which is closed at once (L3375-L3379).
  if (lwb.state === "NEW") {
    lwb.state = "OPENED";
    ev.push({ k: "lwb", lwb: lwb.id, state: "OPENED" });
  }
  lwb.waiters++;
  ev.push({ k: "waiter", lwb: lwb.id });
  closed.push(lwb);
  close(s, lwb, ev);
  // zil_lwb_write_issue for each closed lwb, in order (L1938-L2113), then their completion.
  for (const l of closed) {
    // zil_lwb_commit for each itx (the dmu_sync of a WR_INDIRECT record) runs before READY (L1950-L1972).
    for (const r of l.recs)
      if (r.state === "WR_INDIRECT" && !s.writes[r.write - 1].inPlace) {
        s.writes[r.write - 1].inPlace = true;
        s.inPlace.push(r.write);
        ev.push({ k: "inplace", write: r.write });
      }
    l.state = "READY";
    ev.push({ k: "lwb", lwb: l.id, state: "READY" });
    const next = s.lwbs[s.lwbs.indexOf(l) + 1];
    const a = allocZil(s.pool);
    const blk = block(s, a.cls);
    next.blk = blk;
    next.slog = a.slog;
    next.allocTxg = s.txg;
    ev.push({ k: "alloc", lwb: l.id, next: next.id, blk, tried: a.tried });
    l.state = "ISSUED";
    ev.push({ k: "lwb", lwb: l.id, state: "ISSUED" });
  }
  for (const l of closed) {
    l.state = "WRITE_DONE";
    ev.push({ k: "lwb", lwb: l.id, state: "WRITE_DONE" });
  }
  for (const l of closed) {
    l.state = "FLUSH_DONE";
    ev.push({ k: "lwb", lwb: l.id, state: "FLUSH_DONE" });
  }
  ev.push({ k: "returns", how, via });
  return ev;
}

/** The open txg syncs: its writes are in the tree, zil_clean (L2862) drops its pending itxs, zil_sync (L4206-L4224) frees log blocks. */
export function sync(s: Zil): Ev[] {
  if (s.phase !== "running") return [{ k: "refused", why: s.phase }];
  return syncTxg(s);
}

/** `commitList`: the pending itxs are on a commit list already, so zil_clean does not see them. */
function syncTxg(s: Zil, commitList = false): Ev[] {
  const txg = s.txg;
  const ev: Ev[] = [];
  let n = 0;
  for (const w of s.writes)
    if (w.txg <= txg && (w.status === "memory" || w.status === "logged")) {
      w.status = "synced";
      n++;
    }
  const dropped = commitList ? 0 : s.pending.filter((i) => i.txg <= txg).length;
  if (!commitList) s.pending = s.pending.filter((i) => i.txg > txg);
  ev.push({ k: "sync", txg, writes: n, dropped });
  let l: Lwb | undefined;
  while ((l = s.lwbs[0]) !== undefined) {
    if (l.blk) s.header.log = l.blk.id;
    if (l.state !== "FLUSH_DONE" || l.allocTxg > txg || l.maxTxg > txg) break;
    s.lwbs.shift();
    if (l.blk) {
      s.freed.push(l.blk);
      ev.push({ k: "free", blk: l.blk });
    }
    if (s.lwbs.length === 0) s.header.log = null;
  }
  ev.push({ k: "head", blk: s.header.log });
  s.synced = txg;
  s.txg = txg + 1;
  return ev;
}

/** The power fails: memory is gone; the header and the written blocks stay. */
export function crash(s: Zil): Ev[] {
  if (s.phase !== "running") return [{ k: "refused", why: s.phase }];
  let lost = 0;
  for (const w of s.writes)
    if (w.status === "memory") {
      w.status = "lost";
      lost++;
    }
  s.pending = [];
  // The chain on disk from zh_log: written blocks, then the allocated block where the chain ends.
  s.disk = [];
  if (!s.lwbs.length && s.kept) s.disk.push({ blk: s.kept, recs: [], written: false });
  for (const l of s.lwbs) {
    if (!l.blk) break;
    const written = l.state === "FLUSH_DONE";
    s.disk.push({ blk: l.blk, recs: written ? l.recs : [], written });
    if (!written) break;
  }
  s.lwbs = [];
  s.phase = "crashed";
  return [{ k: "crash", lost }];
}

/** Import: zil_claim (L1232-L1253) in the pool's first txg, the last synced plus one. */
export function importPool(s: Zil): Ev[] {
  if (s.phase !== "crashed") return [{ k: "refused", why: s.phase === "running" ? "notCrashed" : "imported" }];
  const first = s.synced + 1;
  let blocks = 0;
  let recs = 0;
  if (s.header.log !== null)
    for (const d of s.disk) {
      blocks++;
      if (!d.written) break;
      recs += d.recs.length;
    }
  const needed = recs > 0 || blocks > 1;
  s.header.claimTxg = first;
  s.header.replayNeeded = needed;
  s.txg = first;
  s.phase = "imported";
  return [{ k: "claim", first, blocks, recs, needed }];
}

/** Mount: zil_replay (L4794-L4825) with zil_replay_log_record (L4696-L4712), then zil_destroy. */
export function mount(s: Zil): Ev[] {
  if (s.phase !== "imported") return [{ k: "refused", why: s.phase === "running" ? "notCrashed" : "notImported" }];
  const ev: Ev[] = [];
  const claim = s.header.claimTxg;
  const done = new Map<number, number>();
  if (s.header.replayNeeded) {
    for (const d of s.disk) {
      if (!d.written) break;
      for (const r of d.recs) {
        if (r.seq <= s.header.replaySeq) {
          ev.push({ k: "skip", seq: r.seq, txg: r.txg, why: "seq" });
          continue;
        }
        if (r.txg < claim) {
          ev.push({ k: "skip", seq: r.seq, txg: r.txg, why: "txg" });
          continue;
        }
        ev.push({ k: "replay", seq: r.seq, write: r.write, txg: r.txg });
        done.set(r.write, (done.get(r.write) ?? 0) + 1);
      }
    }
  }
  for (const [id] of done) {
    const w = s.writes[id - 1];
    if (w.status === "logged") w.status = "replayed";
  }
  // Logged writes the replay did not bring back would be lost; with no I/O error there are none.
  for (const w of s.writes) if (w.status === "logged") w.status = "lost";
  // zil_destroy (L1085): after a replay, the chain is freed (keep_first false, L4822); with nothing
  // to replay, zil_replay keeps the first block (L4801-L4803), and zil_sync names it again in the
  // emptied header, under a new chain GUID (L4181-L4192).
  const keep = !s.header.replayNeeded && s.header.log !== null && s.disk.length ? s.disk[0].blk : null;
  for (const d of s.disk) if (d.blk !== keep) s.freed.push(d.blk);
  s.disk = [];
  s.kept = keep;
  s.header = { log: keep ? keep.id : null, claimTxg: 0, replaySeq: 0, replayNeeded: false };
  ev.push({ k: "destroy", kept: keep ? keep.id : null });
  s.synced = s.txg;
  s.txg = s.txg + 1;
  s.phase = "running";
  return ev;
}

/** Records on disk that the replay will apply: in the chain, not older than the claim txg. */
export function toReplay(s: Zil): Rec[] {
  const out: Rec[] = [];
  if (!s.header.replayNeeded) return out;
  for (const d of s.disk) {
    if (!d.written) break;
    for (const r of d.recs) if (r.seq > s.header.replaySeq && r.txg >= s.header.claimTxg) out.push(r);
  }
  return out;
}

/** Every record of the chain, for drawing and tests. */
export const chainRecords = (s: Zil): Rec[] =>
  s.phase === "running" ? s.lwbs.flatMap((l) => l.recs) : s.disk.flatMap((d) => d.recs);
