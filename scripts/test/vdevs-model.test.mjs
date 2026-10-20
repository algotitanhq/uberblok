// Tests for the model of the vdevs room (src/lib/vdevs.ts), against the cases
// worked by hand from the code at zfs-2.4.4 (ANALYSIS.md, room "The vdevs",
// "Hand-checked cases"): block kind to class with and without log, special and
// dedup vdevs, special_small_blocks and a special class over 75% or full;
// ditto copies; fan-out per node type (mirror, raidz, dRAID, distributed
// spare); the shapes of replacing and spare nodes and the end of a resilver;
// the dRAID permutation map against the checksum stored in vdev_draid.c.
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
const M = await import("../../src/lib/vdevs.ts");
const KiB = 1024;
const pool = (o = {}) => M.createPool({ ...M.DEFAULT_OPTIONS, ...o });
const bare = () => pool({ log: false, special: false, dedup: false });
const write = (p, kind) => M.writeBlock(p, kind);
const tops = (b) => b.dvas.map((d) => d.top);
const kids = (p, id) => p.vdevs[id].kids;

test("the tree: root, top-level vdevs with their bias, leaves; spares and cache beside it", () => {
  const p = pool({ dedup: true });
  assert.deepEqual(kids(p, "root"), ["mirror", "raidz", "draid", "log", "special", "sdo"]);
  assert.deepEqual(M.topLevels(p).map((v) => v.name), ["mirror-0", "raidz1-1", "draid1:2d:5c:1s-2", "mirror-3", "mirror-4", "sdo"]);
  assert.deepEqual(M.topLevels(p).map((v) => v.bias), ["none", "none", "none", "log", "special", "dedup"]);
  assert.deepEqual(kids(p, "mirror"), ["sda", "sdb"]);
  assert.deepEqual(kids(p, "raidz"), ["sdc", "sdd", "sde"]);
  assert.deepEqual(kids(p, "draid"), ["sdf", "sdg", "sdh", "sdi", "sdj"]);
  // Spares: the hot spare, then the distributed spare named draid<parity>-<vdev id>-<spare id>.
  assert.deepEqual(p.spares, ["sdp", "draid1-2-0"]);
  assert.deepEqual(p.l2cache, ["sdq"]);
  for (const id of [...p.spares, ...p.l2cache]) assert.equal(p.vdevs[id].parent, null);
  assert.equal(M.topOf(p, "sdd").id, "raidz");
  assert.equal(M.topOf(p, "sdo").id, "sdo");
  // A type is its ops table: replacing and spare reuse the mirror's functions.
  for (const t of ["replacing", "spare"]) for (const k of ["ioStart", "ioDone", "asize", "needResilver"]) assert.equal(M.OPS[t][k], M.OPS.mirror[k]);
  assert.equal(M.OPS.root.ioStart, null);
  assert.equal(M.OPS.disk.leaf, true);
  assert.equal(M.OPS.dspare.leaf, true);
  assert.equal(M.OPS.raidz.ioStart, "vdev_raidz_io_start");
});

test("classes without log, special or dedup: embedded log, then normal", () => {
  let p = bare();
  const zil = write(p, "zil");
  assert.equal(zil.block.cls, "embedded_log");
  assert.deepEqual(zil.block.decision.map((s) => s.key), ["zilNone", "zilNone", "zilNone", "zilTake"]);
  assert.equal(zil.block.dvas.length, 1);
  p = zil.pool;
  const meta = write(p, "meta");
  assert.equal(meta.block.cls, "normal");
  assert.equal(meta.block.dvas.length, 2);
  // Two DVAs on consecutive vdevs of the class (mg_next).
  const [a, b] = tops(meta.block);
  const normal = M.classVdevs(p, "normal");
  assert.equal(normal.indexOf(b), (normal.indexOf(a) + 1) % normal.length);
  const ddt = write(meta.pool, "ddt");
  assert.equal(ddt.block.cls, "normal");
  assert.deepEqual([...tops(ddt.block)].sort(), ["draid", "mirror", "raidz"]);
  for (const k of ["small", "large"]) {
    const r = write(p, k);
    assert.equal(r.block.cls, "normal");
    assert.equal(r.block.dvas.length, 1);
  }
});

test("classes with a log mirror and a special mirror, special_small_blocks=0", () => {
  const p = pool();
  assert.equal(write(p, "zil").block.cls, "log");
  const meta = write(p, "meta").block;
  assert.equal(meta.cls, "special");
  assert.deepEqual(tops(meta), ["special", "special"]); // one vdev in the class: mg_next is itself
  const ddt = write(p, "ddt").block;
  assert.equal(ddt.cls, "special");
  assert.deepEqual(tops(ddt), ["special", "special", "special"]);
  assert.equal(write(p, "small").block.cls, "normal"); // 4096 <= 0 is false
  assert.equal(write(p, "large").block.cls, "normal");
  // Without the log: the special embedded log class, on the special mirror.
  const z = write(pool({ log: false }), "zil").block;
  assert.equal(z.cls, "special_embedded_log");
  assert.deepEqual(tops(z), ["special"]);
});

test("special_small_blocks=16K: small blocks to special under 75%, then normal; a full special falls back", () => {
  const o = { smallblk: 16 * KiB };
  assert.equal(write(pool(o), "small").block.cls, "special");
  assert.equal(write(pool(o), "large").block.cls, "normal");
  const over = pool({ ...o, specialFill: "over75" });
  const s = write(over, "small").block;
  assert.equal(s.cls, "normal");
  assert.deepEqual(s.decision.map((x) => x.key), ["pcSmallOver75"]); // not tried
  assert.equal(write(over, "meta").block.cls, "special"); // the reserve is for metadata
  const fullP = pool({ ...o, specialFill: "full" });
  const m = write(fullP, "meta").block;
  assert.equal(m.cls, "normal");
  assert.deepEqual(m.decision.map((x) => x.key), ["pcMeta", "enospc", "pcTriedSpecial"]);
  const d = write(fullP, "ddt").block;
  assert.equal(d.cls, "normal");
  assert.deepEqual(d.decision.map((x) => x.key), ["pcDdtSpecial", "enospc", "pcDdtNormalTried"]);
  // With a dedup vdev, DDT goes to dedup first and the full special does not matter.
  const dd = write(pool({ ...o, specialFill: "full", dedup: true }), "ddt").block;
  assert.equal(dd.cls, "dedup");
  assert.deepEqual(tops(dd), ["sdo", "sdo", "sdo"]);
  // A ZIL block with a full special and no log: the special embedded log, its own space (D11.2).
  assert.equal(write(pool({ log: false, specialFill: "full" }), "zil").block.cls, "special_embedded_log");
});

test("fan-out: a mirror writes to every child and reads one", () => {
  const p = bare();
  const b = { n: 1, kind: "large", txg: 100, psize: 128 * KiB, cls: "normal", dvas: [{ top: "mirror", offset: 0 }], decision: [] };
  assert.deepEqual(M.leavesOf(M.ioTrace(p, b, "write")), ["sda", "sdb"]);
  const r = M.ioTrace(p, b, "read");
  assert.equal(M.leavesOf(r).length, 1);
  assert.equal(r.kids[0].rule, "one");
  // The logical zio: the mirror's function over the DVAs.
  assert.equal(r.fn, "vdev_mirror_io_start");
  assert.equal(r.rule, "dvas");
});

test("fan-out: raidz1 of three, 128 KiB at offset 0, then 4 KiB", () => {
  const p = bare();
  const b = (psize, offset) => ({ n: 1, kind: "large", txg: 100, psize, cls: "normal", dvas: [{ top: "raidz", offset }], decision: [] });
  const w = M.ioTrace(p, b(128 * KiB, 0), "write").kids[0];
  assert.equal(w.fn, "vdev_raidz_io_start");
  assert.deepEqual(w.kids.map((k) => [k.vdev, k.role, k.sectors]), [["sdc", "P", 16], ["sdd", "D0", 16], ["sde", "D1", 16]]);
  assert.deepEqual(M.leavesOf(M.ioTrace(p, b(128 * KiB, 0), "read")), ["sdd", "sde"]);
  // 1 sector: q 0, r 1, bc 2: two columns.
  const s = M.ioTrace(p, b(4 * KiB, 0), "write").kids[0];
  assert.deepEqual(s.kids.filter((k) => k.role !== "skip").map((k) => k.role), ["P", "D0"]);
});

test("dRAID: the generated map matches the checksum of vdev_draid.c, and the groups land as worked by hand", () => {
  const perms = M.draidPerms(5);
  assert.equal(M.draidPermsChecksum(perms), 0x2a1648d74n);
  assert.deepEqual([...perms.slice(0, 15)], [2, 3, 1, 4, 0, 0, 3, 4, 1, 2, 1, 2, 4, 0, 3]);
  // The other maps of the table come out the same (vdev_draid.c L172-L176).
  for (const c of [2, 3, 4, 6]) assert.equal(M.draidPermsChecksum(M.draidPerms(c)), M.DRAID_MAPS[c].checksum);
  assert.equal(M.draidNgroups(), 4);
  const cols = (g) => M.draidColumns(g, 128 * KiB).cols.map((c) => [c.name, c.dev]);
  assert.deepEqual(cols(0), [["P", 2], ["D0", 3], ["D1", 1]]);
  assert.deepEqual(M.draidColumns(0, 128 * KiB).spareDev, [0]);
  assert.deepEqual(cols(1), [["P", 4], ["D0", 2], ["D1", 3]]);
  assert.deepEqual(M.draidColumns(1, 128 * KiB).cols.map((c) => c.row), [0, 1, 1]); // wraps after one column
  assert.deepEqual(cols(4), [["P", 3], ["D0", 4], ["D1", 2]]);
  assert.deepEqual(M.draidColumns(4, 128 * KiB).spareDev, [1]);
  assert.deepEqual(cols(5), [["P", 0], ["D0", 3], ["D1", 4]]);
  // 4 KiB: P and D0 one sector, D1 a skip sector; written to all three, read from D0's only.
  const small = M.draidColumns(0, 4 * KiB).cols.map((c) => c.sectors);
  assert.deepEqual(small, [1, 1, 0]);
  const p = bare();
  const b = { n: 1, kind: "small", txg: 100, psize: 4 * KiB, cls: "normal", dvas: [{ top: "draid", offset: 0, group: 0 }], decision: [] };
  const w = M.ioTrace(p, b, "write").kids[0];
  assert.deepEqual(w.kids.map((k) => [k.vdev, k.role, k.sectors]), [["sdh", "P", 1], ["sdi", "D0", 1], ["sdg", "skip", 1]]);
  assert.deepEqual(M.leavesOf(M.ioTrace(p, b, "read")), ["sdi"]);
});

test("replace sdd in the raidz: a replacing node, mirror ops, old blocks read from the old disk, collapse after the resilver", () => {
  let p = bare();
  const old = write(p, "large");
  p = old.pool;
  const r = M.replace(p, "sdd", "new");
  p = r.pool;
  assert.deepEqual(kids(p, "raidz"), ["sdc", r.node, "sde"]);
  assert.equal(p.vdevs[r.node].type, "replacing");
  assert.equal(p.vdevs[r.node].name, "replacing-1");
  assert.deepEqual(kids(p, r.node), ["sdd", r.added]);
  assert.equal(p.vdevs.sdd.vdevId, 0);
  assert.equal(p.vdevs[r.added].vdevId, 1);
  // DTL_MISSING of the new disk: TXG_INITIAL to the txg plus TXG_CONCURRENT_STATES.
  assert.equal(p.vdevs[r.added].missingTo, p.txg + 3);
  // A write to the raidz: the column on child 1 goes to the replacing node, then to both disks.
  const b = { ...old.block, dvas: [{ top: "raidz", offset: 0 }] };
  const col = M.ioTrace(p, b, "write").kids[0].kids.find((k) => k.vdev === r.node);
  assert.equal(col.fn, "vdev_mirror_io_start");
  assert.deepEqual(col.kids.map((k) => k.vdev), ["sdd", r.added]);
  // A block born before: read from sdd, the new disk skipped.
  const rd = M.ioTrace(p, b, "read").kids[0].kids.find((k) => k.vdev === r.node);
  assert.deepEqual(rd.kids.map((k) => k.vdev), ["sdd"]);
  assert.deepEqual(rd.skipped, [{ vdev: r.added, why: "missing" }]);
  // One replacement per disk in the figure.
  assert.equal(M.canReplace(p, "sdd", "new"), "busy");
  const done = M.resilverDone(p);
  assert.deepEqual(kids(done.pool, "raidz"), ["sdc", r.added, "sde"]);
  assert.equal(done.pool.vdevs[r.added].vdevId, 1);
  assert.equal(done.pool.vdevs.sdd, undefined);
  assert.equal(done.pool.vdevs[r.node], undefined);
  assert.deepEqual(done.collapsed, [r.node]);
});

test("hot spare for sda: a spare node that stays after the resilver", () => {
  const r = M.replace(bare(), "sda", "spare");
  assert.deepEqual(kids(r.pool, "mirror"), [r.node, "sdb"]);
  assert.equal(r.pool.vdevs[r.node].type, "spare");
  assert.equal(r.pool.vdevs[r.node].name, "spare-0");
  assert.deepEqual(kids(r.pool, r.node), ["sda", "sdp"]);
  assert.equal(r.pool.spareInUse.sdp, true);
  assert.equal(M.canReplace(r.pool, "sdc", "spare"), "spareTaken");
  const done = M.resilverDone(r.pool);
  assert.deepEqual(done.kept, [r.node]);
  assert.deepEqual(kids(done.pool, r.node), ["sda", "sdp"]);
  assert.equal(done.pool.vdevs.sdp.missingTo, undefined);
});

test("replace the dedup disk: the replacing node becomes the top-level vdev", () => {
  let p = pool({ dedup: true });
  const r = M.replace(p, "sdo", "new");
  p = r.pool;
  assert.equal(kids(p, "root")[5], r.node);
  assert.equal(p.vdevs[r.node].bias, "dedup");
  assert.equal(p.vdevs[r.node].name, "replacing-5");
  assert.equal(p.vdevs.sdo.bias, undefined);
  const d = write(p, "ddt");
  assert.equal(d.block.cls, "dedup");
  assert.deepEqual(tops(d.block), [r.node, r.node, r.node]);
  const done = M.resilverDone(p).pool;
  assert.equal(kids(done, "root")[5], r.added);
  assert.equal(done.vdevs[r.added].bias, "dedup");
});

test("the distributed spare for sdf: writes to its column go to the child with the spare space", () => {
  assert.equal(M.canReplace(bare(), "sda", "dspare"), "dspareElsewhere");
  const r = M.replace(bare(), "sdf", "dspare");
  const p = r.pool;
  assert.deepEqual(kids(p, "draid")[0], r.node);
  assert.deepEqual(kids(p, r.node), ["sdf", "draid1-2-0"]);
  // Group 5 has its P column on child 0.
  const b = { n: 1, kind: "large", txg: p.txg, psize: 128 * KiB, cls: "normal", dvas: [{ top: "draid", offset: 0, group: 5 }], decision: [] };
  const col = M.ioTrace(p, b, "write").kids[0].kids.find((k) => k.vdev === r.node);
  assert.equal(col.role, "P");
  const ds = col.kids.find((k) => k.vdev === "draid1-2-0");
  assert.equal(ds.fn, "vdev_draid_spare_io_start");
  assert.equal(ds.rule, "redirect");
  assert.deepEqual(ds.kids.map((k) => k.vdev), ["sdg"]);
  // After the resilver, a read prefers the distributed spare (vdev_mirror.c L561-L565).
  const done = M.resilverDone(p).pool;
  const rd = M.ioTrace(done, { ...b, txg: 90 }, "read").kids[0].kids;
  assert.equal(rd.some((k) => k.vdev === r.node), false); // P is not read
  const b2 = { ...b, dvas: [{ top: "draid", offset: 0, group: 6 }] };
  const g6 = M.draidColumns(6, 128 * KiB).cols;
  // Group 6: permutation 1, start 2, D0 on child 0.
  assert.deepEqual(g6.find((c) => c.dev === 0)?.name, "D0");
  const h = M.ioTrace(done, { ...b2, txg: 90 }, "read").kids[0].kids.find((k) => k.vdev === r.node);
  assert.deepEqual(h.kids.map((k) => k.vdev), ["draid1-2-0"]);
});

test("writes walk every node they reach with its own io_start", () => {
  let p = pool({ dedup: true });
  for (const k of M.KINDS) {
    const r = write(p, k);
    p = r.pool;
    const seen = M.reached(r.trace);
    for (const id of seen.slice(1)) assert.ok(p.vdevs[id], `${k}: ${id} is in the pool`);
    for (const leaf of M.leavesOf(r.trace)) assert.equal(M.isLeaf(p.vdevs[leaf]), true);
  }
  assert.equal(p.txg, M.FIRST_TXG + M.KINDS.length);
});

test("spares stand in for normal vdevs only; the embedded log skips a dedup vdev", () => {
  // spa.c L8280-L8285 (excerpt 17): a spare is refused under log, special and dedup vdevs.
  const p = pool({ dedup: true });
  for (const top of ["log", "special", "sdo"]) {
    const leaf = p.vdevs[top].kids.length ? p.vdevs[top].kids[0] : top;
    assert.equal(M.canReplace(p, leaf, "spare"), "spareBias");
    assert.equal(M.canReplace(p, leaf, "new"), null);
  }
  assert.equal(M.canReplace(p, "sda", "spare"), null);
  // vdev.c L1689-L1696: only normal and special vdevs get the embedded slog metaslab.
  const q = pool({ log: false, special: false, dedup: true });
  assert.deepEqual(M.classVdevs(q, "embedded_log"), ["mirror", "raidz", "draid"]);
  assert.notEqual(tops(write(q, "zil").block)[0], "sdo");
});

test("a second resilver keeps nothing that was not waiting", () => {
  const r = M.replace(bare(), "sda", "spare");
  const once = M.resilverDone(r.pool);
  assert.deepEqual(once.kept, [r.node]);
  assert.deepEqual(M.resilverDone(once.pool).kept, []);
});

test("read it back after a replacement: the DVA follows the vdev_id", () => {
  let p = pool({ dedup: true });
  const d = write(p, "ddt");
  p = d.pool;
  const r = M.replace(p, "sdo", "new");
  const b = M.sameBlock(p, r.pool, d.block);
  assert.deepEqual(tops(b), [r.node, r.node, r.node]);
  // Born before the replacement: read from sdo, the new disk skipped.
  const rd = M.ioTrace(r.pool, b, "read").kids[0];
  assert.deepEqual(M.leavesOf(rd), ["sdo"]);
  const done = M.resilverDone(r.pool);
  assert.deepEqual(tops(M.sameBlock(r.pool, done.pool, b)), [r.added, r.added, r.added]);
});
