// A model of the txg pipeline of OpenZFS zfs-2.4.4, module/zfs/txg.c. It runs
// the two threads' wait conditions as the code writes them, over the same
// state variables (tx_state_t, tx_cpu_t), so the figure can only show states
// the code has. Each event names the code it stands for (`ref`, resolved to a
// permalink by the component); ANALYSIS.md, room "Transaction groups", lists
// them. What is simplified is in DECISIONS.md D3.1. No imports: the unit tests
// in scripts/test/ load this file with Node's type stripping.

export const TXG_SIZE = 4; // include/sys/txg.h L42
export const TXG_MASK = TXG_SIZE - 1; // L43
export const TXG_DEFER_SIZE = 2; // L49
export const CPUS = 4; // max_ncpus, drawn as 4
export const TXG_TIMEOUT = 5; // zfs_txg_timeout, txg.c L116, seconds
export const DIRTY_MAX = 20; // zfs_dirty_data_max in this model, in blocks
export const SYNC_PERCENT = 20; // zfs_dirty_data_sync_percent, dsl_pool.c L120
export const DIRTY_SYNC = (DIRTY_MAX * SYNC_PERCENT) / 100; // dsl_pool.c L983-L987

// Illustrative durations (simulated seconds). Real holds last microseconds and
// a sync from milliseconds to seconds; the figure slows everything down.
const HOLD = 0.9;
const PER_BLOCK = 0.12;
const MIN_PASS = 0.35;
const CONFIG = 0.6;

export type EvKind =
  | "hold" // dmu_tx_assign -> txg_hold_open
  | "kick" // dsl_pool_dirty_space -> txg_kick
  | "rele" // dmu_tx_commit -> txg_rele_to_sync
  | "drained" // the last hold on a quiescing txg is released
  | "wait-synced" // zpool sync -> txg_wait_synced(dp, 0)
  | "wait-open" // dmu_free_long_range -> txg_wait_open(dp, 0, B_TRUE)
  | "wake-timeout" // sync thread: zfs_txg_timeout reached
  | "wake-waiter" // sync thread: tx_sync_txg_waiting > tx_synced_txg
  | "wake-handoff" // sync thread: a quiesced txg is waiting
  | "want-quiesce" // sync thread raises tx_quiesce_txg_waiting
  | "quiesce" // quiesce thread: tx_open_txg++, drain begins
  | "handoff" // quiesce thread: tx_quiesced_txg = txg
  | "sync" // sync thread takes the quiesced txg
  | "pass" // spa_sync: one pass of spa_sync_iterate_to_convergence
  | "noop" // pass 1 found nothing: the txg is a no-op
  | "converged" // a pass left the MOS clean
  | "uberblock" // vdev_config_sync wrote the new uberblock
  | "no-uberblock" // vdev_config_sync: nothing changed, nothing written
  | "synced"; // tx_synced_txg = txg

export interface Ev {
  t: number;
  kind: EvKind;
  txg: number;
  cpu?: number;
  n?: number; // pass number, or dirty blocks
  major: boolean; // a stage changes
}

export interface Writer {
  id: number;
  cpu: number;
  txg: number;
  end: number;
}

export interface Sync {
  txg: number;
  data: number; // dirty blocks of the txg (dp_dirty_pertxg)
  passes: number[]; // blocks written by each pass
  pass: number; // 1-based, 0 before pass 1
  phase: "passes" | "config" | "done";
  until: number;
  noop: boolean;
}

export interface Model {
  t: number;
  // tx_state_t, include/sys/txg_impl.h L94-L103
  open: number;
  quiescing: number;
  quiesced: number;
  syncing: number;
  synced: number;
  syncWaiting: number;
  quiesceWaiting: number;
  // tx_cpu_t.tc_count, per CPU, indexed by txg & TXG_MASK (txg_impl.h L75)
  count: number[][];
  dirty: number[]; // dp_dirty_pertxg, dsl_pool.c L995
  writers: Writer[];
  // threads
  syncState: "wait" | "want" | "sync" | "done";
  quiesceState: "wait" | "drain";
  start: number; // txg_sync_thread's `start`, txg.c L601
  sync?: Sync;
  ub: number; // ub_txg of the newest uberblock on disk
  steady: number; // seconds between background writes, 0 = off
  nextSteady: number;
  nextCpu: number;
  nextId: number;
  log: Ev[];
}

export function create(txg = 41, steady = 0): Model {
  return {
    t: 0,
    open: txg,
    quiescing: 0,
    quiesced: 0,
    syncing: 0,
    synced: txg - 1,
    syncWaiting: 0,
    quiesceWaiting: 0,
    count: Array.from({ length: CPUS }, () => new Array(TXG_SIZE).fill(0)),
    dirty: new Array(TXG_SIZE).fill(0),
    writers: [],
    syncState: "wait",
    quiesceState: "wait",
    start: 0,
    ub: txg - 1,
    steady,
    nextSteady: steady,
    nextCpu: 0,
    nextId: 1,
    log: [],
  };
}

const MAJOR: EvKind[] = ["quiesce", "handoff", "sync", "uberblock", "no-uberblock", "synced", "noop", "converged"];

function emit(m: Model, kind: EvKind, txg: number, extra: Partial<Ev> = {}): Ev {
  const e: Ev = { t: m.t, kind, txg, major: MAJOR.includes(kind), ...extra };
  m.log.push(e);
  if (m.log.length > 200) m.log.splice(0, m.log.length - 200);
  return e;
}

export const holds = (m: Model, txg: number) => m.count.reduce((a, c) => a + c[txg & TXG_MASK], 0);
export const timeLeft = (m: Model) => Math.max(0, TXG_TIMEOUT - (m.t - m.start));

// --- actions of the visitor (they happen at the current time) ---

/** A write: dmu_tx_assign takes a hold on the open txg on this CPU. */
export function write(m: Model): Ev[] {
  const cpu = m.nextCpu;
  m.nextCpu = (cpu + 1) % CPUS;
  const txg = m.open; // txg_hold_open, txg.c L334
  m.count[cpu][txg & TXG_MASK]++; // L337
  m.dirty[txg & TXG_MASK]++; // dsl_pool_dirty_space, dsl_pool.c L995
  m.writers.push({ id: m.nextId++, cpu, txg, end: m.t + HOLD });
  const out = [emit(m, "hold", txg, { cpu })];
  // dsl_pool.c L997-L1002: past the sync threshold, txg_kick(dp, txg).
  if (m.dirty[txg & TXG_MASK] > DIRTY_SYNC && m.syncWaiting < txg) {
    m.syncWaiting = txg; // txg.c L830-L831
    out.push(emit(m, "kick", txg, { n: m.dirty[txg & TXG_MASK] }));
  }
  return out;
}

/** zpool sync: zfs_ioc_pool_sync -> txg_wait_synced(dp, 0). */
export function zpoolSync(m: Model): Ev {
  const txg = m.open + TXG_DEFER_SIZE; // txg.c L714-L715
  if (m.syncWaiting < txg) m.syncWaiting = txg; // L716-L717
  return emit(m, "wait-synced", txg);
}

/** A long free fills its txg: dmu_free_long_range_impl -> txg_wait_open(dp, 0, B_TRUE). */
export function longFree(m: Model): Ev {
  // The chunk's tx was assigned and committed just before (dmu.c L1104):
  // it dirtied the open txg and holds nothing any more.
  m.dirty[m.open & TXG_MASK]++;
  const txg = m.open + 1; // txg.c L791-L792
  if (m.quiesceWaiting < txg) m.quiesceWaiting = txg; // L793-L794
  return emit(m, "wait-open", txg);
}

// --- the two threads: one instantaneous transition at a time ---

function instant(m: Model): Ev | null {
  // txg_quiesce_thread, txg.c L638-L641: wait while nobody asks for a txg
  // past the open one, or while a quiesced txg has not been taken yet.
  if (m.quiesceState === "wait" && m.open < m.quiesceWaiting && !m.quiesced) {
    const txg = m.open;
    m.quiescing = txg; // L651
    m.open++; // txg_quiesce L402: the next txg opens at once
    m.quiesceState = "drain";
    return emit(m, "quiesce", txg);
  }
  // txg_quiesce L422-L428: every CPU's tc_count for this txg back to 0.
  if (m.quiesceState === "drain" && holds(m, m.quiescing) === 0) {
    const txg = m.quiescing;
    m.quiescing = 0; // L662
    m.quiesced = txg; // L663
    m.quiesceState = "wait";
    return emit(m, "handoff", txg);
  }
  // txg_sync_thread, L542-L553: wait for the timeout, a waiter, or a hand-off.
  if (m.syncState === "wait") {
    const kind: EvKind | null = m.quiesced
      ? "wake-handoff"
      : m.synced < m.syncWaiting
        ? "wake-waiter"
        : timeLeft(m) <= 0
          ? "wake-timeout"
          : null;
    if (kind) {
      m.syncState = "want";
      return emit(m, kind, m.quiesced || m.open, kind === "wake-waiter" ? { n: m.syncWaiting } : {});
    }
  }
  if (m.syncState === "want") {
    // L589-L593: consume the quiesced txg.
    if (m.quiesced) {
      const txg = m.quiesced;
      m.quiesced = 0;
      m.syncing = txg;
      m.syncState = "sync";
      m.start = m.t; // L601
      const data = m.dirty[txg & TXG_MASK];
      // Pass 1 writes the user data and the metadata above it; the next passes
      // write only metadata dirtied by the previous pass's allocations, less
      // each time (sizes are illustrative, DECISIONS.md D3.1).
      const passes = data ? [data + 3, 2, 1] : [0];
      m.sync = { txg, data, passes, pass: 1, phase: "passes", until: m.t + dur(passes[0]), noop: data === 0 };
      return emit(m, "sync", txg, { n: data });
    }
    // L568-L577: none quiesced; unless one is quiescing, ask for the open one.
    if (!m.quiescing && m.quiesceWaiting < m.open + 1) {
      m.quiesceWaiting = m.open + 1; // L574-L575
      return emit(m, "want-quiesce", m.open);
    }
  }
  if (m.syncState === "done" && m.sync) {
    // L606-L610
    const txg = m.sync.txg;
    m.synced = txg;
    m.syncing = 0;
    m.dirty[txg & TXG_MASK] = 0;
    m.sync = undefined;
    m.syncState = "wait";
    return emit(m, "synced", txg);
  }
  return null;
}

const dur = (blocks: number) => Math.max(MIN_PASS, blocks * PER_BLOCK);

/** The next timed event: a hold released, a pass or the label write done, the timeout. */
function nextAt(m: Model): number {
  let t = Infinity;
  for (const w of m.writers) t = Math.min(t, w.end);
  if (m.sync && m.syncState === "sync") t = Math.min(t, m.sync.until);
  if (m.syncState === "wait") t = Math.min(t, m.start + TXG_TIMEOUT);
  if (m.steady) t = Math.min(t, m.nextSteady);
  return t;
}

function timed(m: Model): Ev[] {
  const out: Ev[] = [];
  // dmu_tx_commit -> txg_rele_to_sync, txg.c L372-L375
  for (const w of m.writers.filter((x) => x.end <= m.t)) {
    m.writers.splice(m.writers.indexOf(w), 1);
    const g = w.txg & TXG_MASK;
    m.count[w.cpu][g]--;
    out.push(emit(m, "rele", w.txg, { cpu: w.cpu }));
    if (w.txg === m.quiescing && holds(m, w.txg) === 0) out.push(emit(m, "drained", w.txg));
  }
  const s = m.sync;
  if (s && m.syncState === "sync" && s.until <= m.t) {
    if (s.phase === "passes") {
      // The last pass and an empty pass 1 are told by "converged" and "noop".
      if (!s.noop && s.pass < s.passes.length) out.push(emit(m, "pass", s.txg, { n: s.pass }));
      if (s.noop) {
        out.push(emit(m, "noop", s.txg)); // spa.c L10749-L10764
        s.phase = "config";
        s.until = m.t + MIN_PASS;
      } else if (s.pass < s.passes.length) {
        s.pass++;
        s.until = m.t + dur(s.passes[s.pass - 1]);
      } else {
        out.push(emit(m, "converged", s.txg, { n: s.pass })); // spa.c L10765
        s.phase = "config";
        s.until = m.t + CONFIG;
      }
    } else if (s.phase === "config") {
      // spa_sync_rewrite_vdev_config, spa.c L10958 -> vdev_config_sync
      if (s.noop) out.push(emit(m, "no-uberblock", s.txg)); // vdev_label.c L2071-L2077
      else {
        m.ub = s.txg;
        out.push(emit(m, "uberblock", s.txg));
      }
      s.phase = "done";
      m.syncState = "done";
    }
  }
  if (m.steady && m.nextSteady <= m.t) {
    m.nextSteady = m.t + m.steady;
    out.push(...write(m));
  }
  return out;
}

/** Run the model for dt simulated seconds. Returns the events, in order. */
export function advance(m: Model, dt: number): Ev[] {
  const end = m.t + dt;
  const out: Ev[] = [];
  for (let guard = 0; guard < 10000; guard++) {
    const e = instant(m);
    if (e) {
      out.push(e);
      continue;
    }
    const t = nextAt(m);
    if (t > end) break;
    m.t = Math.max(m.t, t);
    out.push(...timed(m));
  }
  m.t = Math.max(m.t, end);
  return out;
}

/** Jump to the next thing that happens (one transition, or one instant of time). */
export function step(m: Model): Ev[] {
  const e = instant(m);
  if (e) return [e];
  const t = nextAt(m);
  if (!isFinite(t)) return [];
  m.t = Math.max(m.t, t);
  const out = timed(m);
  return out.length ? out : step(m);
}
