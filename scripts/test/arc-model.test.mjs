// Tests for the model of the ARC room (src/lib/arc.ts, loaded with Node's type
// stripping). First the sequence worked by hand in ANALYSIS.md ("Hand-checked
// sequence"), through arc_access (arc.c L5381-L5472), arc_evict (L4460-L4590),
// arc_evict_adj (L4405-L4442) and arc_evict_hdr (L3828-L3891) at zfs-2.4.4;
// then arc_evict_adj on hand-computed values; then properties over random
// sequences. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  empty, opening, read, readAll, next, evictAdj, mruTarget, cached, clone, HOT, BLOCK, ARC_C, ARC_MINTIME,
} from "../../src/lib/arc.ts";

const ONE = 1n << 32n;
const L = (s) => ({
  mru: s.lists.mru.join(" "),
  mfu: s.lists.mfu.join(" "),
  mru_ghost: s.lists.mru_ghost.join(" "),
  mfu_ghost: s.lists.mfu_ghost.join(" "),
});
const kinds = (ev) => ev.map((e) => (e.k === "evict" || e.k === "forget" ? `${e.k}:${e.id}` : e.k === "pass" ? `pass:${e.adj}` : `${e.k}:${e.id}`));

// The hand-checked sequence, step by step (ANALYSIS.md, room The ARC).
function sequence() {
  const s = opening();
  const steps = {};
  s.now += 1000;
  steps.scan = readAll(s, next(s, "S", 12));
  steps.afterScan = { ...L(s), pd: s.pd, gs: { ...s.gs } };
  s.now += 1000;
  steps.s2 = read(s, "S2");
  steps.afterS2 = { ...L(s), pd: s.pd, gs: { ...s.gs } };
  s.now += 1000;
  steps.promote = readAll(s, ["S12", "S11", "S10"]);
  steps.afterPromote = L(s);
  s.now += 1000;
  steps.n1 = read(s, "N1");
  steps.afterN1 = { ...L(s), gs: { ...s.gs } };
  s.now += 1000;
  steps.h1 = read(s, "H1");
  steps.afterH1 = { ...L(s), pd: s.pd };
  return { s, steps };
}

test("opening: a hot set read twice, a second apart, is in MFU; nothing evicted, arc_pd 1/2", () => {
  const s = opening();
  assert.deepEqual(L(s), { mru: "", mfu: "H6 H5 H4 H3 H2 H1", mru_ghost: "", mfu_ghost: "" });
  assert.equal(s.pd, ONE / 2n); // arc_init L8039
  assert.equal(s.passes, 0);
  for (const id of HOT) assert.equal(s.hdrs[id].mruHits, 1);
});

test("a one-off scan over the hot set: the scan goes through MRU, the hot set stays in MFU", () => {
  const { steps } = sequence();
  assert.deepEqual(kinds(steps.scan.filter((e) => e.k !== "new")), ["pass:small", "evict:S1", "pass:none", "evict:S2"]);
  // First pass: no ghost target yet (total < 32), arc_pd unchanged.
  const p1 = steps.scan.find((e) => e.k === "pass");
  assert.equal(p1.total, 0);
  assert.equal(p1.over, BLOCK);
  assert.equal(p1.mru, 11 * BLOCK);
  assert.equal(p1.target, 8 * BLOCK);
  assert.equal(steps.afterScan.mru, "S12 S11 S10 S9 S8 S7 S6 S5 S4 S3");
  assert.equal(steps.afterScan.mfu, "H6 H5 H4 H3 H2 H1");
  assert.equal(steps.afterScan.mru_ghost, "S2 S1");
  assert.equal(steps.afterScan.pd, ONE / 2n);
  // Ghost targets: half of the other live lists (L4569, L4579).
  assert.deepEqual(steps.afterScan.gs, { mru: 3 * BLOCK, mfu: 5 * BLOCK });
});

test("an MRU-ghost hit: back in MFU, 128 KiB of ghost hits, arc_pd up by 1/32, the MRU target to 8.5 blocks", () => {
  const { s, steps } = sequence();
  const [g, pass, ev] = steps.s2;
  assert.deepEqual(g, { k: "ghost", id: "S2", from: "mru_ghost", bytes: BLOCK });
  assert.equal(pass.grd, BLOCK);
  assert.equal(pass.gfd, 0);
  assert.equal(pass.total, 8 * BLOCK);
  assert.equal(pass.pdBefore, ONE / 2n);
  assert.equal(pass.pd, ONE / 2n + ONE / 32n); // 2^31 + 2^27
  assert.equal(pass.target, 8 * BLOCK + BLOCK / 2);
  assert.deepEqual(ev, { k: "evict", id: "S3", from: "mru", to: "mru_ghost", why: "target" });
  assert.equal(steps.afterS2.mfu, "S2 H6 H5 H4 H3 H2 H1");
  assert.equal(steps.afterS2.mru_ghost, "S3 S1");
  assert.equal(s.hdrs.S2.mruGhostHits, 1);
});

test("re-reads after more than ARC_MINTIME promote MRU to MFU, without a pass", () => {
  const { steps } = sequence();
  assert.deepEqual(steps.promote.map((e) => `${e.k}:${e.id}:${e.from}->${e.to}`), [
    "hit:S12:mru->mfu",
    "hit:S11:mru->mfu",
    "hit:S10:mru->mfu",
  ]);
  assert.equal(steps.afterPromote.mru, "S9 S8 S7 S6 S5 S4");
  assert.equal(steps.afterPromote.mfu, "S10 S11 S12 S2 H6 H5 H4 H3 H2 H1");
});

test("MRU under its target: MFU gives up its tail, to the MFU ghost list", () => {
  const { steps } = sequence();
  const pass = steps.n1.find((e) => e.k === "pass");
  assert.equal(pass.mru, 7 * BLOCK);
  assert.equal(pass.target, 8 * BLOCK + BLOCK / 2);
  assert.deepEqual(kinds(steps.n1), ["new:N1", "pass:none", "evict:H1"]);
  assert.equal(steps.afterN1.mfu_ghost, "H1");
  assert.deepEqual(steps.afterN1.gs, { mru: 4 * BLOCK + BLOCK / 2, mfu: 3 * BLOCK + BLOCK / 2 });
});

test("an MFU-ghost hit: back in MFU, arc_pd down by the same step, back to 1/2", () => {
  const { s, steps } = sequence();
  const [g, pass, ev] = steps.h1;
  assert.deepEqual(g, { k: "ghost", id: "H1", from: "mfu_ghost", bytes: BLOCK });
  assert.equal(pass.grd, 0);
  assert.equal(pass.gfd, BLOCK);
  assert.equal(pass.pdBefore, ONE / 2n + ONE / 32n);
  assert.equal(pass.pd, ONE / 2n);
  assert.deepEqual(ev, { k: "evict", id: "H2", from: "mfu", to: "mfu_ghost", why: "rest" });
  assert.equal(steps.afterH1.mfu, "H1 S10 S11 S12 S2 H6 H5 H4 H3");
  assert.equal(s.hdrs.H1.mfuGhostHits, 1);
});

test("ARC_MINTIME: a re-read within 62 ms of b_arc_access stays in MRU, and b_arc_access is not refreshed", () => {
  const s = empty();
  s.now = 5000;
  read(s, "N1");
  s.now += 10;
  let [e] = read(s, "N1");
  assert.deepEqual(e, { k: "hit", id: "N1", from: "mru", to: "mru", dt: 10 });
  s.now += 52; // 62 ms after the first access: not after it (ddi_time_after is strict)
  [e] = read(s, "N1");
  assert.equal(e.to, "mru");
  assert.equal(e.dt, ARC_MINTIME);
  assert.equal(s.hdrs.N1.access, 5000);
  assert.equal(s.hdrs.N1.mruHits, 2);
  s.now += 1;
  [e] = read(s, "N1");
  assert.equal(e.to, "mfu");
  assert.equal(s.hdrs.N1.access, 5063);
});

test("an MFU hit stays in MFU, moves to the head, refreshes b_arc_access", () => {
  const s = opening();
  s.now += 500;
  const [e] = read(s, "H1");
  assert.deepEqual(e, { k: "hit", id: "H1", from: "mfu", to: "mfu", dt: 505 });
  assert.equal(L(s).mfu, "H1 H6 H5 H4 H3 H2");
  assert.equal(s.hdrs.H1.access, s.now);
});

test("a header trimmed from a ghost list is gone: reading the block again is a new MRU block", () => {
  const s = opening();
  s.now += 1000;
  readAll(s, next(s, "S", 20));
  assert.ok(s.forgotten.includes("S1"));
  assert.equal(s.hdrs.S1, undefined);
  s.now += 1000;
  const ev = read(s, "S1");
  assert.deepEqual(ev[0], { k: "new", id: "S1", forgotten: true });
  assert.equal(s.hdrs.S1.state, "mru");
  assert.equal(s.hdrs.S1.mruGhostHits, 0);
});

test("arc_evict_adj on hand-computed values", () => {
  const M = 1n << 20n; // a ghost total of 8 blocks of 128 KiB
  // total < 32 or no hits: unchanged (L4409-L4410).
  assert.equal(evictAdj(ONE / 2n, 31n, 1000n, 0n, 100n), ONE / 2n);
  assert.equal(evictAdj(ONE / 2n, M, 0n, 0n, 100n), ONE / 2n);
  // up = 2^17 >= total/16: scaled by (2^17)/(2^15) = 4 to 2^15; s = 32; up = 2^47 / 2^20 = 2^27.
  assert.equal(evictAdj(ONE / 2n, M, 1n << 17n, 0n, 100n), ONE / 2n + (1n << 27n));
  assert.equal(evictAdj(ONE / 2n, M, 0n, 1n << 17n, 100n), ONE / 2n - (1n << 27n));
  // Below total/16, no scaling: up = 2^12 -> 2^44 / 2^20 = 2^24.
  assert.equal(evictAdj(ONE / 2n, M, 1n << 12n, 0n, 100n), ONE / 2n + (1n << 24n));
  // Balance 500 (zfs_arc_meta_balance): a downward step is divided by 5. arc_meta = 1/4.
  assert.equal(evictAdj(ONE / 4n, M, 0n, 1n << 17n, 500n), ONE / 4n - (1n << 27n) / 5n);
  // Near the top (frac >= 4 * ofrac), an upward step is divided by frac / (2 * ofrac + 1).
  const f = (ONE * 9n) / 10n; // 3865470566, ofrac 429496730, divisor 3865470566 / 858993461 = 4
  assert.equal(evictAdj(f, M, 1n << 17n, 0n, 100n), f + (1n << 27n) / 4n);
  // A large total: s = min(64 - highbit, 32) < 32.
  const T = 1n << 40n; // highbit 41, s = 23; up 2^30 (< T/16) -> 2^53 / (2^40 >> 9) = 2^22
  assert.equal(evictAdj(ONE / 2n, T, 1n << 30n, 0n, 100n), ONE / 2n + (1n << 22n));
});

test("the MRU target is arc_c * arc_pd, in the code's fixed point", () => {
  assert.equal(mruTarget(ONE / 2n), ARC_C / 2);
  assert.equal(mruTarget(ONE / 2n + ONE / 32n), 8 * BLOCK + BLOCK / 2);
});

// Random sequences: single reads, re-reads (now or later), scans, hot-set loops.
function rng(seed) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

test("properties over 300 random sequences of 80 actions", () => {
  let ghostHits = { mru: 0, mfu: 0 };
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed);
    const s = r() < 0.5 ? opening() : empty();
    for (let a = 0; a < 80; a++) {
      s.now += r() < 0.3 ? 10 : 1000;
      const known = [...Object.keys(s.hdrs), ...s.forgotten];
      const x = r();
      let ids;
      if (x < 0.15) ids = next(s, "S", 1 + Math.floor(r() * 12));
      else if (x < 0.3) ids = next(s, "N");
      else if (x < 0.4) ids = HOT;
      else ids = [known[Math.floor(r() * known.length)] ?? next(s, "N")[0]];
      const before = clone(s);
      ids.forEach((id, i) => {
        if (i) s.now += 1;
        const prev = s.hdrs[id] ? { ...s.hdrs[id] } : undefined;
        const pdBefore = s.pd;
        const ev = read(s, id);
        const h = s.hdrs[id];
        // The block just read is cached, at the head of its list.
        assert.ok(h && (h.state === "mru" || h.state === "mfu"), `${seed}/${a}: ${id} cached`);
        assert.equal(s.lists[h.state][0], id);
        // Transitions as arc_access.
        if (!prev) assert.equal(h.state, "mru");
        else if (prev.state === "mru_ghost" || prev.state === "mfu_ghost") assert.equal(h.state, "mfu");
        else if (prev.state === "mfu") assert.equal(h.state, "mfu");
        else assert.equal(h.state, s.now > prev.access + ARC_MINTIME ? "mfu" : "mru");
        // A hit allocates nothing: no pass, arc_pd unchanged.
        if (prev && (prev.state === "mru" || prev.state === "mfu")) {
          assert.equal(ev.length, 1);
          assert.equal(s.pd, pdBefore);
        }
        for (const p of ev.filter((e) => e.k === "pass")) {
          // Direction: MRU-ghost hits only can only raise arc_pd; MFU-ghost hits only can only lower it.
          if (p.grd > 0 && p.gfd === 0) assert.ok(p.pd >= p.pdBefore);
          if (p.gfd > 0 && p.grd === 0) assert.ok(p.pd <= p.pdBefore);
          if (p.grd > 0 && p.gfd === 0 && p.adj === "moved") ghostHits.mru++;
          if (p.gfd > 0 && p.grd === 0 && p.adj === "moved") ghostHits.mfu++;
          assert.ok(p.pd >= 0n && p.pd <= ONE);
        }
        // Never over arc_c after a read; ghosts within their caps.
        assert.ok(cached(s) <= ARC_C);
        if (ev.some((e) => e.k === "pass")) {
          assert.ok(s.lists.mru_ghost.length * BLOCK <= s.gs.mru);
          assert.ok(s.lists.mfu_ghost.length * BLOCK <= s.gs.mfu);
        }
        // Evicted headers keep their identity in the matching ghost list; data gone.
        for (const e of ev.filter((e) => e.k === "evict")) {
          assert.equal(e.to, e.from === "mru" ? "mru_ghost" : "mfu_ghost");
        }
      });
      // Every header in exactly one list, of its state.
      const seen = new Map();
      for (const [st, list] of Object.entries(s.lists)) for (const id of list) {
        assert.ok(!seen.has(id), `${id} twice`);
        seen.set(id, st);
        assert.equal(s.hdrs[id].state, st);
      }
      assert.equal(seen.size, Object.keys(s.hdrs).length);
      assert.ok(before.passes <= s.passes);
    }
  }
  // The random walk exercised both directions.
  assert.ok(ghostHits.mru > 100 && ghostHits.mfu > 100, JSON.stringify(ghostHits));
});
