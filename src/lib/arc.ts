// Model of the ARC room: a transcription of arc_access, arc_evict, arc_evict_adj
// and arc_evict_hdr (module/zfs/arc.c at zfs-2.4.4), run on whatever the visitor
// reads. Line numbers are in arc.c unless named. What it simplifies, and why it
// stays faithful: DECISIONS.md D6.2. Refs: ANALYSIS.md, room "The ARC".
//
// - Data blocks only, all of one size (128 KiB, uncompressed): the metadata
//   lists are empty, so every metadata term of arc_evict is zero and the code's
//   arithmetic is run with them at zero. arc_pd is the one fraction that moves.
// - One list per state, head = most recently released (multilist_insert puts a
//   header at the head, multilist.c L183; eviction walks from the tail, L3922).
// - A read is arc_read: a hit calls arc_access (L6025); a miss, new or ghost,
//   calls arc_access before the data is allocated (L6204-L6208). The reader
//   holds the block (add_reference L2334-L2338) and releases it at once, which
//   puts it at the head of its state's list (remove_reference L2369).
// - Eviction: one arc_evict pass as soon as the cache is over arc_c, while the
//   reader still holds the block it just read. arc_c is fixed (arc_adapt
//   returns once arc_c is at arc_c_max, L5069-L5070).
// - Logical clock in ms; ARC_MINTIME is hz >> 4, "62 ms" (L1318).

export const BLOCK = 128 * 1024;
export const CAPACITY = 16; // arc_c, in blocks
export const ARC_C = CAPACITY * BLOCK;
export const ARC_MINTIME = 62;
const ONE = 1n << 32n;
const U64 = (1n << 64n) - 1n;

export type Live = "mru" | "mfu";
export type Ghost = "mru_ghost" | "mfu_ghost";
export type St = Live | Ghost;
export const STATES: St[] = ["mru", "mfu", "mru_ghost", "mfu_ghost"];

export interface Hdr {
  id: string;
  state: St;
  /** b_arc_access, ms */
  access: number;
  mruHits: number;
  mfuHits: number;
  mruGhostHits: number;
  mfuGhostHits: number;
}

export interface Arc {
  now: number;
  hdrs: Record<string, Hdr>;
  /** Evictable headers of each state, head (most recent) first. */
  lists: Record<St, string[]>;
  /** arc_pd: MRU share of data, fixed point 2^32 (arc_init L8039). */
  pd: bigint;
  /** arc_mru_ghost / arc_mfu_ghost ->arcs_hits[ARC_BUFC_DATA], bytes (L5440, L5469). */
  hits: { mru: number; mfu: number };
  /** Static ogrd, ogfd of arc_evict (L4466). */
  og: { mru: number; mfu: number };
  /** Static gsrd, gsfd: ghost targets from the previous pass (L4569, L4579). */
  gs: { mru: number; mfu: number };
  /** Headers destroyed from a ghost list, newest first (for the figure only). */
  forgotten: string[];
  passes: number;
  /** Counters for the visitor's names. */
  seq: { N: number; S: number };
}

export type Ev =
  | { k: "new"; id: string; forgotten: boolean }
  | { k: "ghost"; id: string; from: Ghost; bytes: number }
  | { k: "hit"; id: string; from: Live; to: Live; dt: number }
  | {
      k: "pass";
      over: number;
      grd: number;
      gfd: number;
      total: number;
      pdBefore: bigint;
      pd: bigint;
      mru: number;
      mfu: number;
      target: number;
      adj: "small" | "none" | "moved";
    }
  | { k: "evict"; id: string; from: Live; to: Ghost; why: "target" | "rest" }
  | { k: "forget"; id: string; from: Ghost; cap: number };

export function empty(): Arc {
  return {
    now: 0,
    hdrs: {},
    lists: { mru: [], mfu: [], mru_ghost: [], mfu_ghost: [] },
    pd: ONE / 2n,
    hits: { mru: 0, mfu: 0 },
    og: { mru: 0, mfu: 0 },
    gs: { mru: 0, mfu: 0 },
    forgotten: [],
    passes: 0,
    seq: { N: 0, S: 0 },
  };
}

export const HOT = ["H1", "H2", "H3", "H4", "H5", "H6"];

/** The figure's opening state: a hot set of six blocks, each read twice, a second apart. */
export function opening(): Arc {
  const s = empty();
  s.now = 1000;
  readAll(s, HOT, 1);
  s.now += 1000;
  readAll(s, HOT, 1);
  return s;
}

export function clone(s: Arc): Arc {
  return structuredClone(s);
}

const highbit64 = (x: bigint) => (x === 0n ? 0 : x.toString(2).length);

/** arc_evict_adj, L4405-L4442, in uint64 arithmetic. */
export function evictAdj(frac: bigint, total: bigint, up: bigint, down: bigint, balance: bigint): bigint {
  if (total < 32n || up + down === 0n) return frac;
  if (up + down >= total / 16n) {
    const scale = (up + down) / (total / 32n);
    up /= scale;
    down /= scale;
  }
  let s = highbit64(total);
  s = Math.min(64 - s, 32);
  const S = BigInt(s);
  const ofrac = ONE - frac;
  if (frac >= 4n * ofrac) up /= frac / (2n * ofrac + 1n);
  up = ((up << S) & U64) / (total >> (32n - S));
  if (ofrac >= 4n * frac) down /= ofrac / (2n * frac + 1n);
  down = ((down << S) & U64) / (total >> (32n - S));
  down = (down * 100n) / balance;
  return frac + up - down;
}

/** MRU data target of arc_evict, L4545: w = wt * (arc_pd >> 16) >> 16, with wt = arc_c here. */
export const mruTarget = (pd: bigint, wt = ARC_C) => Number((BigInt(wt) * (pd >> 16n)) >> 16n);

export const size = (s: Arc, st: St) => s.lists[st].length * BLOCK;
export const cached = (s: Arc) => size(s, "mru") + size(s, "mfu");

const remove = (s: Arc, st: St, id: string) => {
  const i = s.lists[st].indexOf(id);
  if (i >= 0) s.lists[st].splice(i, 1);
};

/**
 * arc_evict_impl + arc_evict_state on one list: evict from the tail while
 * fewer than `bytes` are evicted, at most the evictable size (L4386-L4398,
 * L3922-L3924). arc_evict_hdr sends a live header to its ghost (L3829-L3830,
 * L3876-L3882) and destroys a ghost header (L3824 path without L2ARC).
 */
function evictImpl(s: Arc, st: St, bytes: number, ev: Ev[], cap = 0, why: "target" | "rest" = "rest"): number {
  const esize = size(s, st);
  if (!(bytes > 0 && esize > 0)) return 0;
  const delta = Math.min(esize, bytes);
  let evicted = 0;
  while (evicted < delta && s.lists[st].length) {
    const id = s.lists[st].pop()!;
    const h = s.hdrs[id];
    evicted += BLOCK;
    if (st === "mru" || st === "mfu") {
      const to: Ghost = st === "mru" ? "mru_ghost" : "mfu_ghost";
      h.state = to;
      s.lists[to].unshift(id);
      ev.push({ k: "evict", id, from: st, to, why });
    } else {
      delete s.hdrs[id];
      s.forgotten = [id, ...s.forgotten.filter((x) => x !== id)].slice(0, 8);
      ev.push({ k: "forget", id, from: st, cap });
    }
  }
  return evicted;
}

/**
 * arc_evict, L4460-L4590, with the metadata lists empty (mrum = mfum = 0).
 * `held` is the block the reader still holds: counted in its state's size
 * (arcs_size), not evictable (arcs_esize), as add_reference makes it.
 */
function evict(s: Arc, held: Hdr, ev: Ev[]) {
  s.passes++;
  const heldIn = (st: Live) => (held.state === st ? BLOCK : 0);
  let mrud = size(s, "mru") + heldIn("mru");
  let mfud = size(s, "mfu") + heldIn("mfu");
  const t = mrud + mfud;

  // Ghost hits since the last pass, L4479-L4491.
  const grd = s.hits.mru - s.og.mru;
  s.og.mru = s.hits.mru;
  const gfd = s.hits.mfu - s.og.mfu;
  s.og.mfu = s.hits.mfu;

  // L4496: arc_pd moves up with MRU-ghost hits, down with MFU-ghost hits.
  const total = s.gs.mru + s.gs.mfu;
  const pdBefore = s.pd;
  s.pd = evictAdj(s.pd, BigInt(total), BigInt(grd), BigInt(gfd), 100n);
  const adj = total < 32 ? "small" : grd + gfd === 0 ? "none" : "moved";

  let asize = t;
  const ac = ARC_C;
  const wt = t - (asize - ac); // L4501
  // L4527-L4541: the metadata steps evict nothing (mrum - w and m - w are <= 0),
  // and L4544 leaves wt as it is (m - total_evicted = 0).
  const w = mruTarget(s.pd, wt);
  ev.push({ k: "pass", over: asize - ac, grd, gfd, total, pdBefore, pd: s.pd, mru: mrud, mfu: mfud, target: w, adj });

  // Evict MRU data, L4543-L4550.
  let e = Math.min(asize - ac, mrud - w);
  let bytes = evictImpl(s, "mru", e, ev, 0, "target");
  mrud -= bytes;
  asize -= bytes;

  // Evict MFU data, L4552-L4556.
  e = asize - ac;
  bytes = evictImpl(s, "mfu", e, ev);
  mfud -= bytes;

  // Ghost lists, L4569-L4587: each at most half of the three other live lists.
  s.gs.mru = Math.floor(mfud / 2);
  evictImpl(s, "mru_ghost", size(s, "mru_ghost") - s.gs.mru, ev, s.gs.mru);
  s.gs.mfu = Math.floor(mrud / 2);
  evictImpl(s, "mfu_ghost", size(s, "mfu_ghost") - s.gs.mfu, ev, s.gs.mfu);
}

/** One read of block `id` at s.now: arc_read's hit or miss path, then eviction if over arc_c. */
export function read(s: Arc, id: string): Ev[] {
  const ev: Ev[] = [];
  const now = s.now;
  let h = s.hdrs[id];
  if (h && (h.state === "mru" || h.state === "mfu")) {
    // Hit (L6025). add_reference takes it off its list; arc_access; release puts it at the head.
    const from = h.state;
    remove(s, from, id);
    const dt = now - h.access;
    if (from === "mru") {
      h.mruHits++;
      // L5423-L5428: promote only if more than ARC_MINTIME since b_arc_access.
      if (now > h.access + ARC_MINTIME) {
        h.access = now;
        h.state = "mfu";
      }
    } else {
      h.mfuHits++;
      h.access = now; // L5450-L5459
    }
    s.lists[h.state].unshift(id);
    ev.push({ k: "hit", id, from, to: h.state as Live, dt });
    return ev; // no allocation, nothing to evict
  }
  // Miss (L6204-L6208): add_reference (off the ghost list), arc_access, then the data.
  if (h) {
    const from = h.state as Ghost;
    remove(s, from, id);
    h.access = now;
    if (from === "mru_ghost") {
      h.mruGhostHits++; // L5437-L5449: counted, to MFU
      s.hits.mru += BLOCK;
    } else {
      h.mfuGhostHits++; // L5466-L5472: counted, to MFU
      s.hits.mfu += BLOCK;
    }
    h.state = "mfu";
    ev.push({ k: "ghost", id, from, bytes: BLOCK });
  } else {
    // L5381-L5397: anon -> MRU.
    h = { id, state: "mru", access: now, mruHits: 0, mfuHits: 0, mruGhostHits: 0, mfuGhostHits: 0 };
    s.hdrs[id] = h;
    const forgotten = s.forgotten.includes(id);
    s.forgotten = s.forgotten.filter((x) => x !== id);
    ev.push({ k: "new", id, forgotten });
  }
  if (cached(s) + BLOCK > ARC_C) evict(s, h, ev);
  s.lists[h.state].unshift(id);
  return ev;
}

/** Reads `ids` in order, `step` ms apart, starting at s.now. */
export function readAll(s: Arc, ids: string[], step = 1): Ev[] {
  const ev: Ev[] = [];
  ids.forEach((id, i) => {
    if (i) s.now += step;
    ev.push(...read(s, id));
  });
  return ev;
}

/** The next `n` names of a series ("S" for a scan, "N" for single reads). */
export function next(s: Arc, series: "N" | "S", n = 1): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(`${series}${++s.seq[series]}`);
  return out;
}

export const pct = (pd: bigint) => Number((pd * 10000n) / ONE) / 100;
