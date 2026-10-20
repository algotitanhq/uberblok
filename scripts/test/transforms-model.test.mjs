// Tests for the model of the compression, dedup and encryption room
// (src/lib/transforms.ts), against cases worked by hand from the code at
// zfs-2.4.4 (ANALYSIS.md, room "Compression, dedup, encryption", "Hand-checked
// cases"): zio_get_compression_max_size at every size and ashift of the figure,
// ZLE included; the four outcomes of zio_write_compress and the rounding;
// zio_ddt_write's miss, hit and over-quota paths with their refcounts; the
// word layouts of spa.h; scrub with the key unloaded.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const M = await import("../../src/lib/transforms.ts");
const KiB = 1024;
const c = (lsize, ashift, out, algo = "lz4", extra = {}) => M.compress({ lsize, ashift, algo, zero: false, out, ...extra });

test("the limit: seven eighths, snapped to the sector, or BPE_PAYLOAD_SIZE", () => {
  const sec = (a) => 2 ** a;
  const want = {
    [128 * KiB]: [114688, 114688, 114688],
    [16 * KiB]: [14336, 12288, 8192],
    [8 * KiB]: [7168, 4096, 112],
    [4 * KiB]: [3584, 112, 112],
  };
  for (const [lsize, w] of Object.entries(want))
    [9, 12, 13].forEach((a, i) => assert.equal(M.maxSize("lz4", sec(a), sec(a), Number(lsize)), w[i], `${lsize} ashift ${a}`));
  // ZLE is exempt from the snap (zio.c L1800-L1802).
  for (const a of [9, 12, 13]) {
    assert.equal(M.maxSize("zle", sec(a), sec(a), 4 * KiB), 3584);
    assert.equal(M.maxSize("zle", sec(a), sec(a), 8 * KiB), 7168);
  }
  assert.equal(M.BPE_PAYLOAD_SIZE, 112);
});

test("zio_roundup_alloc_size", () => {
  assert.equal(M.roundupAlloc(90, 4096, 4096), 4096);
  assert.equal(M.roundupAlloc(4096, 4096, 4096), 4096);
  assert.equal(M.roundupAlloc(4097, 4096, 4096), 8192);
  assert.equal(M.roundupAlloc(50000, 512, 512), 50176);
});

test("compression, LZ4, ashift 12: the four outcomes", () => {
  let r = c(128 * KiB, 12, 50000);
  assert.deepEqual([r.limit, r.outcome, r.psize, r.sectors, r.compress], [114688, "compressed", 53248, 13, "lz4"]);
  r = c(128 * KiB, 12, 114000);
  assert.deepEqual([r.outcome, r.psize], ["compressed", 114688]);
  r = c(128 * KiB, 12, 120000);
  assert.deepEqual([r.returned, r.outcome, r.psize, r.sectors, r.compress], [131072, "uncompressed", 131072, 32, "off"]);
  r = M.compress({ lsize: 128 * KiB, ashift: 12, algo: "lz4", zero: true, out: 0 });
  assert.deepEqual([r.outcome, r.psize, r.asize, r.sectors], ["hole", 0, 0, 0]);
  r = c(128 * KiB, 12, 90);
  assert.deepEqual([r.outcome, r.psize, r.asize, r.compress], ["embedded", 90, 0, "lz4"]);
  r = c(4 * KiB, 12, 2000);
  assert.deepEqual([r.limit, r.returned, r.outcome, r.psize], [112, 4096, "uncompressed", 4096]);
  r = c(4 * KiB, 12, 90);
  assert.equal(r.outcome, "embedded");
  r = c(4 * KiB, 12, 112);
  assert.equal(r.outcome, "embedded");
  r = c(4 * KiB, 12, 113);
  assert.equal(r.outcome, "uncompressed");
  r = c(8 * KiB, 12, 5000);
  assert.deepEqual([r.limit, r.outcome, r.psize], [4096, "uncompressed", 8192]);
  r = c(16 * KiB, 12, 12000);
  assert.deepEqual([r.limit, r.outcome, r.psize, r.sectors], [12288, "compressed", 12288, 3]);
});

test("compression, LZ4, ashift 9", () => {
  let r = c(128 * KiB, 9, 50000);
  assert.deepEqual([r.outcome, r.psize, r.sectors], ["compressed", 50176, 98]);
  r = c(4 * KiB, 9, 2000);
  assert.deepEqual([r.limit, r.outcome, r.psize, r.sectors], [3584, "compressed", 2048, 4]);
});

test("compression, ZLE, ashift 12: unsnapped limit, then the rounding decides", () => {
  let r = c(8 * KiB, 12, 5000, "zle");
  assert.deepEqual([r.limit, r.returned, r.rounded, r.outcome, r.psize, r.why], [7168, 5000, 8192, "uncompressed", 8192, "rounded-lsize"]);
  r = c(4 * KiB, 12, 3000, "zle");
  assert.deepEqual([r.limit, r.rounded, r.outcome], [3584, 4096, "uncompressed"]);
  r = c(16 * KiB, 12, 12000, "zle");
  assert.deepEqual([r.outcome, r.psize, r.compress], ["compressed", 12288, "zle"]);
});

test("compression off: zeros are written like anything else", () => {
  const r = M.compress({ lsize: 128 * KiB, ashift: 12, algo: "off", zero: true, out: 0 });
  assert.deepEqual([r.outcome, r.psize, r.sectors, r.limit], ["written", 131072, 32, null]);
});

test("an encrypted block is never embedded", () => {
  let r = c(4 * KiB, 12, 90, "lz4", { encrypt: true });
  assert.deepEqual([r.rounded, r.outcome, r.psize, r.why], [4096, "uncompressed", 4096, "noembed-rounded"]);
  r = c(128 * KiB, 12, 90, "lz4", { encrypt: true });
  assert.deepEqual([r.outcome, r.psize, r.sectors], ["compressed", 4096, 1]);
});

test("dedup: miss, miss, hit, then over quota", () => {
  let s = M.dedupStart();
  s = M.dedupWrite(s, "A", false);
  s = M.dedupWrite(s, "B", false);
  s = M.dedupWrite(s, "A", false);
  s = M.dedupWrite(s, "C", true);
  s = M.dedupWrite(s, "A", true);
  s = M.dedupWrite(s, "C", true);
  const st = s.steps;
  assert.deepEqual(st.map((x) => x.outcome), ["miss", "miss", "hit", "overquota", "hit", "overquota"]);
  assert.deepEqual(st.map((x) => x.txg), [100, 101, 102, 103, 104, 105]);
  assert.deepEqual(st.map((x) => x.refcnt), [1, 1, 2, null, 3, null]);
  const [d1, d2] = [st[0].wrote, st[1].wrote];
  assert.ok(d1 && d2 && d1 !== d2);
  // The hit: the entry's DVA, logical birth now, physical birth the entry's; nothing written.
  assert.deepEqual([st[2].bp.dva, st[2].bp.logical, st[2].bp.physical, st[2].bp.dedup, st[2].wrote], [d1, 102, 100, true, null]);
  // Over quota: D bit cleared, an ordinary write, no entry; a second C is a second copy.
  assert.deepEqual([st[3].bp.dedup, st[5].bp.dedup], [false, false]);
  assert.ok(st[3].wrote && st[5].wrote && st[3].wrote !== st[5].wrote);
  assert.equal(st[4].bp.dva, d1);
  assert.equal(s.lookups, 6);
  assert.equal(s.disk.length, 4);
  assert.deepEqual(s.entries.map((e) => [e.content, e.refcnt, e.dva, e.birth]), [["A", 3, d1, 100], ["B", 1, d2, 101]]);
  assert.deepEqual(s.disk.map((d) => d.content), ["A", "B", "C", "C"]);
});

test("dedup: the quota lifted, a block seen only over quota is a miss", () => {
  let s = M.dedupStart();
  s = M.dedupWrite(s, "C", true);
  s = M.dedupWrite(s, "C", false);
  assert.deepEqual(s.steps.map((x) => x.outcome), ["overquota", "miss"]);
  assert.equal(s.disk.length, 2);
  assert.deepEqual(s.entries.map((e) => [e.content, e.refcnt]), [["C", 1]]);
});

test("block pointer words, as spa.h draws them", () => {
  const roles = (k) => M.bpWords(k).sort((a, b) => a.i - b.i).map((w) => w.role);
  assert.deepEqual(roles("plain"), [
    "dva-vdev", "dva-offset", "dva-vdev", "dva-offset", "dva-vdev", "dva-offset",
    "prop", "prop2", "pad", "pbirth", "lbirth", "fill", "cksum", "cksum", "cksum", "cksum",
  ]);
  assert.deepEqual(roles("encrypted"), [
    "dva-vdev", "dva-offset", "dva-vdev", "dva-offset", "salt", "iv1",
    "prop", "prop2", "pad", "pbirth", "lbirth", "iv2-fill", "cksum", "cksum", "mac", "mac",
  ]);
  assert.deepEqual(roles("authenticated").slice(0, 6), roles("plain").slice(0, 6));
  assert.deepEqual(roles("authenticated").slice(12), ["cksum", "cksum", "mac", "mac"]);
  assert.deepEqual(roles("indirect").slice(12), ["cksum", "cksum", "macmac", "macmac"]);
  assert.equal(roles("indirect")[11], "fill");
  const emb = roles("embedded");
  assert.equal(emb[6], "prop");
  assert.equal(emb[10], "lbirth");
  assert.equal(emb.filter((r) => r === "payload").length, 14);
  assert.deepEqual(roles("hole").slice(0, 6), Array(6).fill("zero"));
  for (const k of ["plain", "encrypted", "authenticated", "indirect", "embedded", "hole"]) assert.equal(M.bpWords(k).length, 16);
  assert.deepEqual(["plain", "encrypted", "authenticated", "indirect"].map(M.maxCopies), [3, 2, 3, 3]);
  assert.deepEqual(["plain", "encrypted", "authenticated", "indirect"].map(M.usesCrypt), [false, true, true, true]);
});

test("key unloaded: scrub verifies every block, reads of data fail with EACCES", () => {
  const f = M.cryptFile(["one", "two", "three"], "type: file", "attributes");
  assert.deepEqual(M.scrub(f).map((x) => x.ok), [true, true, true, true, true]);
  assert.deepEqual(f.data.map((b) => M.readBlock(b, false)), Array(3).fill({ ok: false, err: "EACCES" }));
  assert.deepEqual(M.readBlock(f.data[1], true), { ok: true, text: "two" });
  assert.equal(M.readBlock(f.indirect, false).ok, true);
  // The ciphertext on disk is not the plaintext.
  assert.notDeepEqual(Array.from(f.data[0].disk.slice(0, 3)), [111, 110, 101]);
  // The stored checksum is the fletcher-4 folded on words 0-1, the MAC in 2-3 (zio_checksum.c L324-L341).
  for (const b of f.data) assert.equal(M.verifies(b), true);
});

test("a flipped bit on disk is caught by scrub, with or without the key", () => {
  const f = M.cryptFile(["one", "two", "three"], "type: file", "attributes");
  const bad = { ...f, data: [f.data[0], M.flipped(f.data[1]), f.data[2]] };
  assert.deepEqual(M.scrub(bad).map((x) => x.ok), [true, true, true, false, true]);
  assert.deepEqual(M.readBlock(bad.data[1], true), { ok: false, err: "ECKSUM" });
  assert.deepEqual(M.readBlock(bad.data[1], false), { ok: false, err: "ECKSUM" });
});

test("the truncated comparison, by hand: fletcher-4 of two words, folded, MAC words ignored", () => {
  // Two 32-bit words, 1 and 2: a = 1, 3; b = 1, 4; c = 1, 5; d = 1, 6. Fletcher-4 = [3, 4, 5, 6].
  const disk = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]);
  const plain = { id: "p", kind: "plain", disk, plain: "", cksum: [3n, 4n, 5n, 6n] };
  assert.equal(M.verifies(plain), true);
  // An ordinary block pointer compares all four words.
  assert.equal(M.verifies({ ...plain, cksum: [3n, 4n, 5n, 7n] }), false);
  // With the X bit, words 2 and 3 are folded into 0 and 1 (3 ^ 5 = 6, 4 ^ 6 = 2), and the MAC words are not compared.
  for (const kind of ["encrypted", "authenticated", "indirect"]) {
    assert.equal(M.verifies({ ...plain, kind, cksum: [6n, 2n, 0xdeadn, 0xbeefn] }), true, kind);
    assert.equal(M.verifies({ ...plain, kind, cksum: [6n, 2n, 0n, 0n] }), true, kind);
    assert.equal(M.verifies({ ...plain, kind, cksum: [3n, 4n, 5n, 6n] }), false, kind);
  }
});

test("scrub reads what is on disk only: the same result with any key state", () => {
  // scrub() takes no key, by construction (dsl_scan.c L4841: raw reads). What the
  // key changes is the read: the same blocks give EACCES without it and text with it.
  const f = M.cryptFile(["one", "two", "three"], "core", "attributes");
  assert.equal(M.scrub.length, 1);
  assert.deepEqual(f.data.map((b) => M.readBlock(b, true).ok), [true, true, true]);
  assert.deepEqual(f.data.map((b) => M.readBlock(b, false).ok), [false, false, false]);
  // The MAC of each data block sits in words 2 and 3 of its checksum, and differs between blocks.
  assert.notEqual(f.data[0].cksum[2], f.data[1].cksum[2]);
});
