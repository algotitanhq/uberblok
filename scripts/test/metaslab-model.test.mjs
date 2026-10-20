// Tests for the model of the Metaslabs and space maps room (src/lib/metaslab.ts,
// loaded with Node's type stripping). First the entry encoding against values
// computed by hand from the space_map.h macros (L175-L203) and bitops.h
// BF64_ENCODE (L46-L48) at zfs-2.4.4; then the sequence worked by hand in
// ANALYSIS.md ("Hand-checked sequence"): dynamic fit (metaslab.c L1771-L1957),
// the words metaslab_sync appends (L4397-L4404, space_map.c L529-L739), the
// deferred frees (L4624-L4638), the load (space_map.c L401-L443, L2649-L2652),
// metaslab_should_condense (L3836-L3861) with space_map_estimate_optimal_size
// (space_map.c L1033-L1085), metaslab_condense (L3949-L4012); then properties
// over random sequences. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  empty, opening, write, del, sync, load, replay, churn, condenseNow, shouldCondense, optimalSize, dfAlloc, rewrite, clone,
  smOneWord, smTwoWords, smDebug, decode, hex, space, extents, dirty, rtAdd,
  MIB, MS_START, MS_END, MS_SIZE, MS_COUNT, BLOCK, SM_ALLOC, SM_FREE, SM_RUN_MAX, SM2_RUN_MAX, SM_NO_VDEVID,
} from "../../src/lib/metaslab.ts";

const H = (s) => s.map(([a, b]) => [a.toString(16), b.toString(16)]);
const words = (s, from = 0) => s.tape.slice(from).flatMap((e) => e.words.map(hex));

test("16 metaslabs of 512 MiB on a vdev of 8 GiB; metaslab 2 starts at 1 GiB", () => {
  assert.equal(MS_COUNT, 16);
  assert.equal(MS_SIZE, 512 * MIB);
  assert.equal(MS_START, 0x40000000);
});

test("one-word entries: offset at bit 16, type at bit 15, run - 1 in bits 0-14", () => {
  assert.equal(hex(smOneWord(0, SM_ALLOC, 8192)), "0x0000000000001FFF");
  assert.equal(hex(smOneWord(0x2000, SM_ALLOC, 1024)), "0x00000000200003FF");
  assert.equal(hex(smOneWord(0, SM_FREE, 8192)), "0x0000000000009FFF");
  assert.equal(hex(smOneWord(0x400, SM_FREE, 7168)), "0x0000000004009BFF");
  // SM_RUN_MAX = SM_RUN_DECODE(~0ULL) = 2^15: the largest one-word run, stored as 0x7FFF.
  assert.equal(SM_RUN_MAX, 32768);
  assert.equal(hex(smOneWord(1, SM_ALLOC, SM_RUN_MAX)), "0x0000000000017FFF");
  // The top bit is 0: decoded as a one-word entry, the run back to its value.
  assert.deepEqual(decode(smOneWord(0x2000, SM_FREE, 1024)), { kind: "one", offset: 0x2000, type: SM_FREE, run: 1024 });
});

test("two-word entries: prefix 3, run - 1 at bit 24, vdev in bits 0-23; type at bit 63, offset below", () => {
  const [a, b] = smTwoWords(0x2400, SM_ALLOC, 40960);
  assert.equal(hex(a), "0xC000009FFF000000");
  assert.equal(hex(b), "0x0000000000002400");
  assert.deepEqual(smTwoWords(0x2400, SM_FREE, 40960).map(hex), ["0xC000009FFF000000", "0x8000000000002400"]);
  // SM_NO_VDEVID is 1 << 24: masked to 24 bits by BF64_ENCODE, the field is 0.
  assert.equal(SM_NO_VDEVID, 1 << 24);
  assert.equal(decode(a).vdev, 0);
  assert.equal(decode(a).run, 40960);
  assert.equal(hex(smTwoWords(0, SM_ALLOC, 131072)[0]), "0xC00001FFFF000000");
  assert.equal(hex(smTwoWords(0x5, SM_FREE, 1, 7)[0]), "0xC000000000000007");
  assert.equal(SM2_RUN_MAX, 2 ** 36);
  assert.equal(hex(smTwoWords(0, SM_ALLOC, SM2_RUN_MAX)[0]), "0xCFFFFFFFFF000000");
});

test("debug entries: prefix 2, action at bit 60, sync pass at bit 50, txg below; padding is all zero fields", () => {
  assert.equal(hex(smDebug(SM_ALLOC, 1, 10)), "0x800400000000000A");
  assert.equal(hex(smDebug(SM_FREE, 1, 12)), "0x900400000000000C");
  assert.equal(hex(smDebug(0, 0, 0)), "0x8000000000000000");
  assert.deepEqual(decode(smDebug(SM_FREE, 1, 16)), { kind: "debug", action: 1, pass: 1, txg: 16 });
});

// The hand-checked sequence (ANALYSIS.md, room Metaslabs and space maps).
test("hand-checked: A and B at the cursor, one ALLOC word each, after a debug word", () => {
  const s = empty();
  assert.equal(s.txg, 10);
  const [w] = write(s, 32 * MIB);
  assert.deepEqual(H(w.exts), [["40000000", "42000000"]]);
  assert.equal(w.picks.cursor, 256);
  assert.equal(s.cursor, 0x42000000);
  const check = shouldCondense(s);
  assert.equal(check.object, 0);
  assert.equal(optimalSize(s.allocatable), 24); // one 480 MiB segment: 16 + 8
  assert.equal(check.yes, false);
  sync(s);
  assert.deepEqual(words(s), ["0x800400000000000A", "0x0000000000001FFF"]);
  assert.equal(s.length, 16);
  assert.equal(s.alloc, 32 * MIB);
  write(s, 4 * MIB);
  assert.deepEqual(H(s.allocating), [["42000000", "42400000"]]);
  sync(s);
  assert.deepEqual(words(s, 2), ["0x800400000000000B", "0x00000000200003FF"]);
  assert.equal(s.length, 32);
  const j = (x) => JSON.stringify(x, (_, v) => (typeof v === "bigint" ? hex(v) : v));
  assert.equal(j(opening()), j(s));
});

test("hand-checked: delete A, FREE word; deferred two txgs; the load agrees", () => {
  const s = opening();
  del(s, "A");
  const ev = sync(s);
  assert.deepEqual(words(s, 4), ["0x900400000000000C", "0x0000000000009FFF"]);
  assert.equal(s.alloc, 4 * MIB);
  assert.deepEqual(H(s.defer[0]), [["40000000", "42000000"]]);
  assert.deepEqual(ev.find((e) => e.k === "defer"), { k: "defer", txg: 12, bytes: 32 * MIB, back: 14 });
  assert.deepEqual(H(s.allocatable), [["42400000", "60000000"]]);
  assert.deepEqual(H(replay(s.tape)), [["40000000", "42000000"], ["42400000", "60000000"]]);
  const l = clone(s);
  const [e] = load(l);
  assert.equal(e.same, true);
  assert.deepEqual(H(l.allocatable), [["42400000", "60000000"]]);
  assert.deepEqual(sync(s).map((e) => e.k), ["nothing", "synced"]); // txg 13
  assert.equal(s.length, 48);
  const back = sync(s); // txg 14 = 12 + TXG_DEFER_SIZE
  assert.deepEqual(back.find((e) => e.k === "deferBack"), { k: "deferBack", txg: 14, freed: 12, bytes: 32 * MIB });
  assert.deepEqual(H(s.allocatable), [["40000000", "42000000"], ["42400000", "60000000"]]);
});

function toTxg16() {
  const s = opening();
  del(s, "A");
  sync(s);
  sync(s);
  sync(s);
  return s;
}

test("hand-checked: C, 160 MiB, past A's hole; a run over SM_RUN_MAX is one two-word entry", () => {
  const s = toTxg16();
  assert.equal(s.txg, 15);
  const [w] = write(s, 160 * MIB);
  assert.deepEqual(H(w.exts), [["42400000", "4c400000"]]);
  sync(s);
  assert.deepEqual(words(s, 6), ["0x800400000000000F", "0xC000009FFF000000", "0x0000000000002400"]);
  assert.equal(s.tape.at(-1).kind, "two");
  assert.equal(s.length, 72);
  del(s, "C");
  sync(s);
  assert.deepEqual(words(s, 8), ["0x9004000000000010", "0xC000009FFF000000", "0x8000000000002400"]);
  assert.equal(s.length, 96);
});

test("hand-checked: condense refused at 96 bytes (not over 4 blocks of 16 KiB)", () => {
  const s = toTxg16();
  write(s, 160 * MIB);
  sync(s);
  del(s, "C");
  sync(s);
  const [r] = condenseNow(s);
  assert.equal(r.k, "refuse");
  assert.deepEqual(r.check, { yes: false, empty: false, object: 96, optimal: 32, t1: 64, t2: 65536, segs: 2 });
  assert.equal(s.txg, 17);
});

test("hand-checked: D at the cursor, E to the end, then F falls back to the smallest segment, A", () => {
  const s = toTxg16();
  write(s, 160 * MIB);
  sync(s);
  del(s, "C");
  sync(s);
  assert.deepEqual(H(write(s, 4 * MIB)[0].exts), [["4c400000", "4c800000"]]);
  const [e] = write(s, 312 * MIB);
  assert.deepEqual(H(e.exts), [["4c800000", "60000000"]]);
  assert.equal(s.cursor, 0x60000000);
  const [f] = write(s, 4 * MIB);
  assert.deepEqual(H(f.exts), [["40000000", "40400000"]]);
  assert.deepEqual(f.picks, { cursor: 31, size: 1, bestfit: 0 });
  assert.equal(s.cursor, 0x40400000);
});

test("hand-checked: the condensed map, word by word, replays to the same free tree", () => {
  const s = toTxg16();
  write(s, 160 * MIB);
  sync(s);
  del(s, "C");
  sync(s);
  write(s, 4 * MIB);
  write(s, 312 * MIB);
  write(s, 4 * MIB);
  const before = clone(s);
  // metaslab_should_condense says no here; a requested condense (ms_condense_wanted,
  // L3851-L3852) makes the same sync condense.
  s.condenseWanted = true;
  const ev = sync(s);
  assert.equal(ev[0].k, "condense");
  assert.deepEqual(words(s), [
    "0x8004000000000011", "0xC00001FFFF000000", "0x0000000000000000",
    "0x9004000000000011", "0x0000000004009BFF",
    "0x9004000000000011", "0x00000000000083FF", "0xC00001DBFF000000", "0x8000000000002400",
    "0x8004000000000011", "0x00000000000003FF", "0xC000013BFF000000", "0x000000000000C400",
  ]);
  assert.equal(s.length, 13 * 8);
  assert.equal(s.alloc, (512 - 28 - 480 + 320) * MIB); // B, D, E and F: 324 MiB
  assert.equal(s.condenseWanted, false);
  // Replayed: the free tree plus the deferred C; the load removes C.
  assert.deepEqual(H(replay(s.tape)), [["40400000", "42000000"], ["42400000", "4c400000"]]);
  const [l] = load(s);
  assert.equal(l.same, true);
  assert.deepEqual(H(s.allocatable), H(before.allocatable));
});

test("the condense test: 200 % of optimal and over 4 records; an empty free tree always condenses", () => {
  const s = empty();
  write(s, 512 * MIB);
  assert.equal(s.allocatable.length, 0);
  const c = shouldCondense(s);
  assert.equal(c.yes, true);
  assert.equal(c.empty, true);
  // Long enough, but not twice the optimal size: no.
  const t = opening();
  t.length = 65544;
  t.allocatable = Array.from({ length: 4200 }, (_, i) => [MS_START + i * 8192, MS_START + i * 8192 + 4096]);
  const opt = optimalSize(t.allocatable); // 4200 one-word entries + padding
  assert.equal(opt, 33600 + (Math.floor(33600 / 16384) + 1) * 8);
  assert.equal(shouldCondense(t).yes, false);
  t.length = 2 * opt;
  assert.equal(shouldCondense(t).yes, true);
  t.length = 65536; // twice the optimal size, but not over the block threshold
  t.allocatable = t.allocatable.slice(0, 10);
  assert.equal(shouldCondense(t).yes, false);
});

test("optimal size: one word under 128 MiB, two words from 128 MiB, one padding word per block plus one", () => {
  assert.equal(optimalSize([[MS_START, MS_START + 128 * MIB - BLOCK]]), 8 + 8);
  assert.equal(optimalSize([[MS_START, MS_START + 128 * MIB]]), 16 + 8);
  assert.equal(optimalSize([]), 8);
});

test("dynamic fit switches to best fit under 4 % free", () => {
  const s = empty();
  write(s, 480 * MIB);
  write(s, 12 * MIB);
  // 20 MiB free, 3 %: no offset search, the smallest segment that fits.
  assert.equal(dfAlloc(clone(s), BLOCK).pick, "bestfit");
  const t = empty();
  write(t, 476 * MIB);
  assert.equal(dfAlloc(clone(t), BLOCK).pick, "cursor"); // 36 MiB, 7 %
});

test("a delete or a load waits for the txg to sync", () => {
  const s = opening();
  write(s, 4 * MIB);
  assert.equal(del(s, "C")[0].k, "busy");
  assert.equal(load(s)[0].k, "notClean");
  sync(s);
  assert.equal(del(s, "C")[0].k, "delete");
});

test("the rewrite workload stops before the sync that condenses, and that sync condenses", () => {
  const s = opening();
  let stopped;
  for (let i = 0; i < 5 && !stopped; i++) stopped = churn(s).find((e) => e.k === "churn" && e.stopped);
  assert.ok(stopped, "the workload reaches the condense threshold");
  assert.equal(shouldCondense(s).yes, true);
  assert.equal(dirty(s), true);
  const before = s.length;
  assert.ok(before > 65536);
  const ev = condenseNow(s);
  const c = ev.find((e) => e.k === "condense");
  assert.ok(c && c.after < before / 10);
  const [l] = load(s);
  assert.equal(l.same, true);
});

// Properties over random sequences of the visitor's actions.
function rng(seed) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
  };
}

test("properties over 200 random sequences: accounting, replay = free tree, encoding round trip", () => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed);
    const s = empty();
    for (let step = 0; step < 60; step++) {
      const x = r();
      if (x < 0.35) write(s, [4, 32, 160][Math.floor(r() * 3)] * MIB);
      else if (x < 0.55) {
        const ok = s.files.filter((f) => f.pending === null);
        if (ok.length) del(s, ok[Math.floor(r() * ok.length)].id);
      } else if (x < 0.62 && s.files.some((f) => f.id === "db")) rewrite(s, "db", 64);
      else if (x < 0.64) write(s, 64 * MIB, "db");
      else if (x < 0.7) condenseNow(s);
      else if (x < 0.75) {
        const ok = !dirty(s);
        const [e] = load(s);
        if (ok) assert.equal(e.same, true, `seed ${seed} step ${step}: load differs`);
      } else sync(s);

      // Every byte in one place: free, allocating, freeing, deferred, or a live block.
      const live = extents(s.files.filter((f) => !f.deleting).flatMap((f) => f.blocks));
      const freeish = space(s.allocatable) + space(s.freeing) + space(s.defer[0]) + space(s.defer[1]);
      assert.equal(freeish + space(live), MS_SIZE, `seed ${seed} step ${step}: accounting`);
      // On a clean txg, the map replays to the free tree plus the deferred frees.
      if (!dirty(s)) {
        const rt = replay(s.tape);
        const expect = s.allocatable.map(([a, b]) => [a, b]);
        for (const d of s.defer) for (const [a, b] of d) rtAdd(expect, a, b - a);
        assert.deepEqual(rt, expect, `seed ${seed} step ${step}: replay`);
        assert.equal(MS_SIZE - space(rt), s.alloc, `seed ${seed} step ${step}: smp_alloc`);
      }
      // Each entry decodes to what it says, and no two-word entry straddles a 16 KiB block.
      for (const e of s.tape.slice(-6)) {
        const d = decode(e.words[0]);
        assert.equal(d.kind, e.kind);
        if (e.kind === "one") assert.deepEqual([d.offset, d.type, d.run], [e.offset, e.type, e.run]);
        if (e.kind === "two") {
          assert.equal(d.run, e.run);
          assert.notEqual(e.at % 2048, 2047);
          assert.ok(e.run > SM_RUN_MAX);
        }
      }
      assert.ok(s.allocatable.every(([a, b]) => a >= MS_START && b <= MS_END && a < b));
    }
  }
});

test("a two-word entry never straddles a 16 KiB block: the last word is padded (space_map.c L615-L631)", () => {
  const s = opening();
  s.length = 2046 * 8; // as if the map already held 2046 words
  write(s, 160 * MIB);
  sync(s);
  const [d, pad, two] = s.tape.slice(-3);
  assert.deepEqual([d.at, d.kind, d.txg], [2046, "debug", 12]);
  assert.deepEqual([pad.at, pad.kind, pad.txg, hex(pad.words[0])], [2047, "debug", 0, "0x8000000000000000"]);
  assert.deepEqual([two.at, two.kind], [2048, "two"]);
  assert.equal(s.length, 2050 * 8);
});

test("the rewrite workload syncs pending changes first: its range starts at the open txg", () => {
  const s = opening();
  churn(s);
  write(s, 4 * MIB);
  const ev = churn(s);
  const c = ev.find((e) => e.k === "churn");
  assert.ok(c.stopped, "stops before a sync that would condense");
  assert.equal(c.from + c.txgs - 1, s.txg, "the last txg it names is the open one");
});

test("rewrite right after deleting db: db is removed, then written again", () => {
  const s = opening();
  churn(s);
  del(s, "db");
  const ev = churn(s);
  assert.ok(ev.some((e) => e.k === "write" && e.id === "db"));
  const c = ev.find((e) => e.k === "churn");
  assert.ok(c.blocks > 0);
});

test("the rewrite workload's numbers, as the page and ANALYSIS.md give them", () => {
  const s = opening();
  const a = churn(s).find((e) => e.k === "churn");
  assert.deepEqual([a.txgs, a.stopped], [40, false]);
  const b = churn(s).find((e) => e.k === "churn");
  assert.deepEqual([b.txgs, b.stopped], [28, true], "about 70 txgs in all");
  const c = shouldCondense(s);
  assert.deepEqual([c.object, c.segs, c.optimal], [65840, 189, 1528], "past 64 KiB; about two hundred segments, under 2 KiB");
  const cond = sync(s).find((e) => e.k === "condense");
  assert.equal(cond.after, 3256);
});
