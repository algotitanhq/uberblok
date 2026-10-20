// Tests for the RAID-Z model of the RAID-Z room (src/lib/raidz.ts, loaded with
// Node's type stripping). Hand-checked layouts, worked through the integer
// arithmetic of vdev_raidz_map_alloc (vdev_raidz.c L612-L740) and
// vdev_raidz_psize_to_asize (L2306-L2317) at zfs-2.4.4, then properties that
// must hold for every input, then the read path and vdev_raidz_combrec.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapAlloc, psizeToAsize, footprint, readBlock, needResilver } from "../../src/lib/raidz.ts";

const K = 1024;
const shape = (L) => L.cols.map((c) => `${c.name || "-"}:${c.dev}@${c.off}x${c.size}${c.skip ? "+s" : ""}`).join(" ");
const nums = (L) => ({ s: L.s, q: L.q, r: L.r, bc: L.bc, tot: L.tot, acols: L.acols, scols: L.scols, nskip: L.nskip, asize: L.asize });

test("raidz2, 6 children, 4K sectors, 20K block (ANALYSIS.md worked example): no skip", () => {
  const L = mapAlloc(20 * K, 12, 6, 2);
  // s = 5, q = 5/4 = 1, r = 1, bc = r + 2 = 3, tot = 5 + 2*(1+1) = 9; asize = 5 + 2*ceil(5/4) = 9, roundup(9,3) = 9
  assert.deepEqual(nums(L), { s: 5, q: 1, r: 1, bc: 3, tot: 9, acols: 6, scols: 6, nskip: 0, asize: 9 * 4 * K });
  assert.equal(shape(L), "P:0@0x2 Q:1@0x2 D0:2@0x2 D1:3@0x1 D2:4@0x1 D3:5@0x1");
  // Data columns are contiguous runs of the block, not round-robin by sector.
  assert.deepEqual(L.cols.filter((c) => !c.parity).map((c) => c.data), [0, 2, 3, 4]);
});

test("raidz1, 5 children, 8K block (ANALYSIS.md worked example): narrower than the vdev, one skip sector", () => {
  const L = mapAlloc(8 * K, 12, 5, 1);
  // s = 2, q = 2/4 = 0, r = 2, bc = 3, tot = 2 + 1*(0+1) = 3; acols = 3, scols = min(5, roundup(3,2)) = 4
  // nskip = roundup(3,2) - 3 = 1, at column 3 (rc_size 0); asize = 2 + ceil(2/4) = 3 -> 4 sectors
  assert.deepEqual(nums(L), { s: 2, q: 0, r: 2, bc: 3, tot: 3, acols: 3, scols: 4, nskip: 1, asize: 16 * K });
  assert.equal(shape(L), "P:0@0x1 D0:1@0x1 D1:2@0x1 -:3@0x0+s");
});

test("a small write on a wide raidz2: 4K on 12 children costs 3 sectors, 8K costs 6", () => {
  const a = mapAlloc(4 * K, 12, 12, 2);
  // s = 1, q = 0, r = 1, bc = 3, tot = 3, scols = min(12, roundup(3,3)) = 3, nskip = 0; asize = 1 + 2*ceil(1/10) = 3
  assert.deepEqual(nums(a), { s: 1, q: 0, r: 1, bc: 3, tot: 3, acols: 3, scols: 3, nskip: 0, asize: 12 * K });
  assert.equal(shape(a), "P:0@0x1 Q:1@0x1 D0:2@0x1");
  const b = mapAlloc(8 * K, 12, 12, 2);
  // s = 2, bc = 4, tot = 4, scols = min(12, roundup(4,3) = 6) = 6, nskip = 2; asize = 2 + 2 = 4 -> 6 sectors
  assert.deepEqual(nums(b), { s: 2, q: 0, r: 2, bc: 4, tot: 4, acols: 4, scols: 6, nskip: 2, asize: 24 * K });
  assert.equal(shape(b), "P:0@0x1 Q:1@0x1 D0:2@0x1 D1:3@0x1 -:4@0x0+s -:5@0x0+s");
});

test("a write that is not a multiple of the data width: raidz2, 6 children, 24K", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  // s = 6, q = 1, r = 2, bc = 4, tot = 6 + 2*2 = 10, nskip = roundup(10,3) - 10 = 2 from column 4
  assert.deepEqual(nums(L), { s: 6, q: 1, r: 2, bc: 4, tot: 10, acols: 6, scols: 6, nskip: 2, asize: 12 * 4 * K });
  assert.equal(shape(L), "P:0@0x2 Q:1@0x2 D0:2@0x2 D1:3@0x2 D2:4@0x1+s D3:5@0x1+s");
  assert.deepEqual(L.cols.slice(2).map((c) => c.data), [0, 2, 4, 5]);
});

test("skip sectors that wrap onto a parity column (vdev_raidz_map_alloc_write L511-L516)", () => {
  // raidz2, 4 children, 12K: s = 3, q = 1, r = 1, bc = 3, tot = 7, nskip = 2, skipstart 3,
  // scols 4 < 3 + 2: nwrapped = 5 % 4 = 1, so P carries a skip sector too.
  const L = mapAlloc(12 * K, 12, 4, 2);
  assert.deepEqual(nums(L), { s: 3, q: 1, r: 1, bc: 3, tot: 7, acols: 4, scols: 4, nskip: 2, asize: 9 * 4 * K });
  assert.equal(L.nwrapped, 1);
  assert.equal(shape(L), "P:0@0x2+s Q:1@0x2 D0:2@0x2 D1:3@0x1+s");
  // r = 0, but tot is not a multiple of nparity + 1: skipstart 0 < firstdatacol, all skips on parity.
  const M = mapAlloc(12 * K, 12, 5, 2); // s = 3, q = 1, r = 0, bc = 0, tot = 5, nskip = 1
  assert.deepEqual(nums(M), { s: 3, q: 1, r: 0, bc: 0, tot: 5, acols: 5, scols: 5, nskip: 1, asize: 6 * 4 * K });
  assert.equal(shape(M), "P:0@0x1+s Q:1@0x1 D0:2@0x1 D1:3@0x1 D2:4@0x1");
});

test("the block starts on child b % dcols and wraps to child 0 one sector lower (L677-L696)", () => {
  const L = mapAlloc(20 * K, 12, 6, 2, 10 * 4 * K); // b = 10: f = 4, o = 1
  assert.equal(L.f, 4);
  assert.equal(L.o, 1);
  assert.equal(shape(L), "P:4@1x2 Q:5@1x2 D0:0@2x2 D1:1@2x1 D2:2@2x1 D3:3@2x1");
});

test("raidz1 swaps parity and the first data column in every odd megabyte (L725-L734)", () => {
  const even = mapAlloc(16 * K, 12, 3, 1, 0);
  assert.equal(shape(even), "P:0@0x2 D0:1@0x2 D1:2@0x2");
  const odd = mapAlloc(16 * K, 12, 3, 1, 1 << 20); // b = 256: f = 1, o = 85
  assert.equal(odd.swapped, true);
  assert.equal(shape(odd), "P:2@85x2 D0:1@85x2 D1:0@86x2");
  assert.equal(mapAlloc(16 * K, 12, 3, 2, 1 << 20).swapped, false, "only single parity");
});

test("psize below a sector, ashift 9, raidz3; asize of one sector is nparity + 1 whatever the width (L2302-L2303)", () => {
  assert.equal(psizeToAsize(512, 12, 8, 2), 3 * 4 * K);
  assert.equal(mapAlloc(512, 12, 8, 2).s, 1);
  for (let w = 4; w <= 16; w++) assert.equal(psizeToAsize(512, 9, w, 3), 4 * 512);
  const L = mapAlloc(6 * K, 12, 7, 3); // 6K at 4K sectors pads to 2 sectors
  assert.deepEqual(nums(L), { s: 2, q: 0, r: 2, bc: 5, tot: 5, acols: 5, scols: 7, nskip: 3, asize: 8 * 4 * K });
  assert.equal(L.nwrapped, 1, "roundup(5, 4) = 8 > 7 children: one skip wraps to P");
  assert.equal(shape(L), "P:0@0x1+s Q:1@0x1 R:2@0x1 D0:3@0x1 D1:4@0x1 -:5@0x0+s -:6@0x0+s");
});

test("for every input: tot + nskip = asize, and the block fills one contiguous run of the vdev's sectors", () => {
  let n = 0;
  for (const nparity of [1, 2, 3])
    for (let dcols = nparity + 1; dcols <= 16; dcols++)
      for (const ashift of [9, 12, 13])
        for (let sectors = 1; sectors <= 40; sectors++)
          for (const b of [0, 1, 5, 256, 257, 1000]) {
            const psize = sectors * 2 ** ashift - (sectors > 1 ? 512 : 0);
            const offset = b * 2 ** ashift;
            const L = mapAlloc(psize, ashift, dcols, nparity, offset);
            assert.equal((L.tot + L.nskip) * 2 ** ashift, L.asize, JSON.stringify(nums(L)));
            assert.equal(L.asize % ((nparity + 1) * 2 ** ashift), 0);
            // child d, sector k is sector k * dcols + d of the raidz vdev
            const addrs = [...footprint(L)].flatMap(([d, ks]) => ks.map((k) => k * dcols + d)).sort((x, y) => x - y);
            const want = Array.from({ length: L.asize / 2 ** ashift }, (_, i) => b + i);
            assert.deepEqual(addrs, want, `${psize} ${ashift} ${dcols} ${nparity} ${b}`);
            // the first bc columns are q + 1 tall, parity among them; data covers the block once
            assert.equal(L.cols.filter((c) => !c.parity).reduce((a, c) => a + c.size, 0), L.s);
            for (const c of L.cols.slice(0, nparity)) assert.equal(c.size, L.cols[nparity].size);
            n++;
          }
  assert.equal(n, 30240);
});

const H = (dcols, bad) => Array.from({ length: dcols }, (_, d) => bad[d] ?? "ok");

test("a healthy read reads the data columns only, and the checksum passes", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const r = readBlock(L, H(6, {}));
  assert.deepEqual(r.firstRead, [2, 3, 4, 5]);
  assert.equal(r.firstCksum, true);
  assert.deepEqual(r.attempts, []);
});

test("a missing child: parity is read and the column rebuilt from P (vdev_raidz_reconstruct_row)", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const r = readBlock(L, H(6, { 3: "missing" }));
  assert.deepEqual(r.firstRead, [0, 1, 2, 4, 5]);
  assert.deepEqual(r.known, { parity: ["P"], ok: true });
  assert.equal(r.firstCksum, true);
  assert.equal(r.parityVerified, true, "Q was read and not used: it is checked");
  assert.deepEqual(r.repaired, []);
  const two = readBlock(L, H(6, { 3: "missing", 0: "missing" }));
  assert.deepEqual(two.known, { parity: ["Q"], ok: true });
  const three = readBlock(L, H(6, { 3: "missing", 0: "missing", 5: "missing" }));
  assert.equal(three.ok, false);
  assert.equal(three.tooMany, true);
});

test("silent damage: the checksum fails, everything is read, combrec finds the culprit", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const r = readBlock(L, H(6, { 3: "corrupt" }));
  assert.equal(r.firstCksum, false);
  assert.deepEqual(r.readAll, [0, 1]);
  assert.deepEqual(r.attempts.map((a) => [a.tgts.join(","), a.outcome, a.parity.join("")]), [
    ["0", "cksum", ""], // only P: nothing to rebuild, the data is still wrong
    ["1", "cksum", ""],
    ["2", "cksum", "P"], // D0 rebuilt from P and the bad D1: wrong
    ["3", "ok", "P"],
  ]);
  assert.deepEqual(r.repaired, [3]);
  assert.deepEqual(r.undetected, []);
});

test("bad P and bad D1 on a raidz2: one failure is not enough, the pair (P, D1) rebuilds D1 from Q", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const r = readBlock(L, H(6, { 0: "corrupt", 3: "corrupt" }));
  const seq = r.attempts.map((a) => a.tgts.join(","));
  assert.deepEqual(seq, ["0", "1", "2", "3", "4", "5", "0,1", "0,2", "1,2", "0,3"]);
  assert.equal(r.attempts.at(-1).parity.join(""), "Q");
  assert.equal(r.ok, true);
  // D1 is marked ECKSUM; then parity_verify = (0 + 0) < (2 - 1): P is regenerated, differs, and is rewritten.
  assert.equal(r.parityVerified, true);
  assert.deepEqual(r.repaired.sort(), [0, 3]);
});

test("a bad parity column alone is not seen by a normal read: the data checksum passes", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const r = readBlock(L, H(6, { 1: "corrupt" }));
  assert.equal(r.firstCksum, true);
  assert.equal(r.parityVerified, false);
  assert.deepEqual(r.undetected, [1]);
});

test("combrec's order is the one in the comment above it (6-wide RAIDZ3, L3467-L3490)", () => {
  const L = mapAlloc(12 * K, 12, 6, 3); // s = 3: one sector on each of the 6 children
  assert.equal(L.acols, 6);
  const r = readBlock(L, H(6, { 0: "corrupt", 1: "corrupt", 2: "corrupt", 3: "corrupt", 4: "corrupt", 5: "corrupt" }));
  assert.equal(r.ok, false);
  const three = r.attempts.filter((a) => a.tgts.length === 3).map((a) => a.tgts.join(" "));
  assert.deepEqual(three, [
    "0 1 2", "0 1 3", "0 2 3", "1 2 3", "0 1 4", "0 2 4", "1 2 4", "0 3 4", "1 3 4", "2 3 4",
    "0 1 5", "0 2 5", "1 2 5", "0 3 5", "1 3 5", "2 3 5", "0 4 5", "1 4 5", "2 4 5", "3 4 5",
  ]);
  assert.equal(r.attempts.length, 6 + 15 + 20);
});

test("a known missing child plus a target on another child is too many for raidz1: EINVAL ends the search", () => {
  const L = mapAlloc(16 * K, 12, 3, 1); // P D0 D1
  const r = readBlock(L, H(3, { 1: "missing", 2: "corrupt" }));
  assert.equal(r.known.ok, false, "D0 rebuilt from P and the bad D1");
  assert.deepEqual(r.attempts.map((a) => [a.tgts.join(","), a.outcome]), [["0", "einval"]]);
  assert.equal(r.ok, false);
});

test("vdev_raidz_need_resilver: a narrow block on clean children is skipped (L4021-L4035)", () => {
  const L = mapAlloc(4 * K, 12, 12, 2); // children 0, 1, 2
  assert.equal(needResilver(L, [7]), false);
  assert.equal(needResilver(L, [2]), true);
  assert.equal(needResilver(mapAlloc(40 * K, 12, 12, 2), [7]), true, "s + nparity >= dcols: always");
});
