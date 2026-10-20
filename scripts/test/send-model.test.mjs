// Tests for the model of the send / receive room (src/lib/send.ts, loaded with
// Node's type stripping), against cases worked by hand from the code at
// zfs-2.4.4 (ANALYSIS.md, room "send / receive", "Hand-checked cases"): the
// births copy-on-write gives the history; traverse_visitbp's birth test
// (dmu_traverse.c L249-L279) at every from-snapshot, none included, and its
// birth-0 holes; the range send_cb makes for each visited block (dmu_send.c
// L1098-L1146) and the records do_dump writes, merged as dump_free and
// dump_freeobjects do; BEGIN ... END; drr_checksum on every record but BEGIN
// (dump_record, L257-L283) recomputed from the bytes; the receiver's checks
// (dmu_recv.c L2843-L2868, L3000-L3007) and its result, equal to @s4.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// send.ts imports "./fletcher4" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const M = await import("../../src/lib/send.ts");
const { fletcher4, fletcher4Inc } = await import("../../src/lib/fletcher4.ts");

const S = M.snapshots();
const [s1, s2, s3, s4] = S;
const FROMS = [null, s1, s2, s3];
const name = (f) => (f ? f.name : "full");
const bp = (root, id) => M.allBps(root).find((b) => b.id === id);
const END = M.OBJECT_END;

/** A record as the hand-checked cases write it. */
const short = (r) => {
  switch (r.type) {
    case "OBJECT": return `OBJECT ${r.object}`;
    case "WRITE": return `WRITE ${r.object}@${r.offset}`;
    case "FREE": return `FREE ${r.object}@${r.offset}+${r.length === END ? "end" : r.length}`;
    case "FREEOBJECTS": return `FREEOBJECTS ${r.firstobj}x${r.numobjs}`;
    default: return r.type;
  }
};

test("the history: births of @s4 as copy-on-write gives them", () => {
  const want = {
    os: 40, meta: 40, dn0: 40, dn1: 30,
    "o1.L1": 20, "o1.0": 10, "o1.1": 10, "o1.2": 20, "o1.3": 10,
    "o2.L1": 30, "o2.0": 10, "o2.1": 30, "o2.2": 30, "o2.3": 10,
    "o4.L1": 30, "o4.0": 30, "o4.1": 30, "o4.2": 30, "o4.3": 30,
  };
  const all = M.allBps(s4.root);
  assert.equal(all.length, 19);
  for (const b of all) assert.equal(b.birth, want[b.id], b.id);
  assert.ok(bp(s4.root, "o2.1").hole && bp(s4.root, "o2.2").hole, "the punched blocks are holes");
  assert.equal(M.dnode(s4.root, 3).type, "none", "c is deleted");
  for (const o of [5, 6, 7]) assert.equal(M.dnode(s4.root, o).type, "none");
  assert.equal(M.dnode(s4.root, 0).type, "reserved");
  assert.deepEqual(S.map((s) => s.txg), [10, 20, 30, 40]);
  // Earlier snapshots keep their own blocks.
  assert.equal(bp(s1.root, "o1.2").data, "a2");
  assert.equal(bp(s2.root, "o1.2").data, "a2′");
  assert.ok(bp(s2.root, "dn1").hole, "no second dnode block before d");
});

test("traverse_visitbp: visited exactly when birth > td_min_txg, at every from-snapshot", () => {
  for (const from of FROMS) {
    const r = M.send(s4, from);
    const F = from ? from.txg : 0;
    assert.equal(r.minTxg, F);
    for (const st of r.steps.filter((x) => x.k === "test")) assert.equal(st.visit, st.bp.birth > F, `${name(from)} ${st.bp.id}`);
    // Every block pointer is tested, or lies under one that was skipped: never both.
    const tested = new Set(r.steps.filter((x) => x.k === "test").map((x) => x.bp.id));
    const pruned = new Set(r.steps.flatMap((x) => x.pruned ?? []));
    for (const b of M.allBps(s4.root)) assert.ok(tested.has(b.id) !== pruned.has(b.id), `${name(from)} ${b.id}`);
    // A skipped pointer's subtree is never read: no step below it.
    for (const id of pruned) assert.ok(!tested.has(id));
  }
});

test("visited and skipped counts, by hand: 19/0/0, 14/5/0, 12/3/4, 3/3/13", () => {
  const want = { full: [19, 0, 0], s1: [14, 5, 0], s2: [12, 3, 4], s3: [3, 3, 13] };
  for (const from of FROMS) {
    const r = M.send(s4, from);
    assert.deepEqual([r.visited, r.skipped, r.pruned], want[name(from)], name(from));
  }
  const v = FROMS.map((f) => M.send(s4, f).visited);
  for (let i = 1; i < v.length; i++) assert.ok(v[i] < v[i - 1], "the count shrinks as F grows");
});

test("the records of each stream, by hand", () => {
  const dataOf = (o) => [0, 512, 1024, 1536].map((x) => `WRITE ${o}@${x}`);
  const want = {
    full: ["BEGIN", "OBJECT 1", "FREE 1@2048+end", ...dataOf(1), "OBJECT 2", "FREE 2@2048+end", "WRITE 2@0", "FREE 2@512+1024", "WRITE 2@1536",
      "FREEOBJECTS 3x1", "OBJECT 4", "FREE 4@2048+end", ...dataOf(4), "FREEOBJECTS 5x3", "END"],
    s1: ["BEGIN", "OBJECT 1", "FREE 1@2048+end", "WRITE 1@1024", "OBJECT 2", "FREE 2@2048+end", "FREE 2@512+1024", "FREEOBJECTS 3x1",
      "OBJECT 4", "FREE 4@2048+end", ...dataOf(4), "FREEOBJECTS 5x3", "END"],
    s2: ["BEGIN", "OBJECT 1", "FREE 1@2048+end", "OBJECT 2", "FREE 2@2048+end", "FREE 2@512+1024", "FREEOBJECTS 3x1",
      "OBJECT 4", "FREE 4@2048+end", ...dataOf(4), "FREEOBJECTS 5x3", "END"],
    s3: ["BEGIN", "OBJECT 1", "FREE 1@2048+end", "OBJECT 2", "FREE 2@2048+end", "FREEOBJECTS 3x1", "END"],
  };
  for (const from of FROMS) {
    const r = M.send(s4, from);
    assert.deepEqual(r.records.map(short), want[name(from)], name(from));
    assert.equal(r.records.length, { full: 21, s1: 16, s2: 15, s3: 7 }[name(from)]);
  }
  assert.equal(M.send(s4, s1).records.find((x) => x.type === "WRITE").data, "a2′");
});

test("send_cb: the range for each visited block pointer and dnode, from (level, object, hole) as L1098-L1146 decide", () => {
  // Every stream of @s4, and full streams of @s1 and @s2, whose second dnode block is a hole.
  const cases = [...FROMS.map((f) => [s4, f]), [s1, null], [s2, null], [s2, s1]];
  for (const [to, from] of cases) {
    for (const st of M.send(to, from).steps) {
      if (st.k === "dnode") {
        assert.equal(st.range, st.dn.object === 0 ? null : "OBJECT", `dnode ${st.dn.object}`);
        continue;
      }
      if (!st.visit) {
        assert.equal(st.range, undefined);
        continue;
      }
      const b = st.bp;
      let want;
      if (b.level === 0 && b.object === 0 && !b.hole) want = "OBJECT_RANGE"; // L1109-L1116
      else if (b.level < 0 || (b.level > 0 && !b.hole)) want = null; // L1117-L1118
      else want = b.hole ? "HOLE" : "DATA"; // L1140-L1146 (no block of the figure is past its file's end)
      assert.equal(st.range, want, `${to.name} from ${name(from)} ${b.id}`);
    }
  }
});

test("each visited data block is one WRITE; each visited hole is inside one FREE; nothing else writes", () => {
  for (const from of FROMS) {
    const r = M.send(s4, from);
    const F = from ? from.txg : 0;
    const writes = r.records.filter((x) => x.type === "WRITE").map((x) => `${x.object}.${x.offset / M.BLKSZ}`);
    const want = M.allBps(s4.root).filter((b) => b.kind === "data" && !b.hole && b.birth > F && r.steps.some((s) => s.bp === b)).map((b) => `${b.object}.${b.blkid}`);
    assert.deepEqual(writes, want, name(from));
    const holes = M.allBps(s4.root).filter((b) => b.kind === "data" && b.hole && r.steps.some((s) => s.bp === b && s.visit));
    for (const h of holes)
      assert.ok(
        r.records.some((x) => x.type === "FREE" && x.object === h.object && x.offset <= h.blkid * M.BLKSZ && (x.length === END || x.offset + x.length >= (h.blkid + 1) * M.BLKSZ)),
        `${name(from)} hole ${h.id}`,
      );
  }
});

test("records in order: one BEGIN first, one END last; the header layout", () => {
  for (const from of FROMS) {
    const r = M.send(s4, from);
    const types = r.records.map((x) => x.type);
    assert.equal(types[0], "BEGIN");
    assert.equal(types.at(-1), "END");
    assert.equal(types.filter((t) => t === "BEGIN").length, 1);
    assert.equal(types.filter((t) => t === "END").length, 1);
    for (const x of r.records) {
      assert.equal(x.header.length, 312);
      const v = new DataView(x.header.buffer);
      assert.equal(v.getUint32(0, true), M.DRR[x.type]);
    }
    const b = new DataView(r.records[0].header.buffer);
    assert.equal(b.getBigUint64(8, true), 0x2f5bacbacn, "DMU_BACKUP_MAGIC");
    assert.equal(b.getBigUint64(40, true), s4.guid, "drr_toguid");
    assert.equal(b.getBigUint64(48, true), from ? from.guid : 0n, "drr_fromguid");
    // Records come out in increasing object order, as dump_free's comment requires.
    const objs = r.records.filter((x) => x.object !== undefined).map((x) => x.object);
    assert.deepEqual(objs, [...objs].sort((p, q) => p - q));
    // Bytes: 312 per header, 512 per WRITE payload.
    assert.equal(r.bytes, r.records.length * 312 + r.records.filter((x) => x.type === "WRITE").length * 512);
  }
});

test("dump_record: drr_checksum on every record but BEGIN, the fletcher-4 of every byte before it", () => {
  for (const from of FROMS) {
    const r = M.send(s4, from);
    const parts = [];
    for (const x of r.records) {
      const before = concat([...parts, x.header.subarray(0, 280)]);
      const stored = [0, 1, 2, 3].map((i) => new DataView(x.header.buffer).getBigUint64(280 + 8 * i, true));
      if (x.type === "BEGIN") {
        assert.equal(x.cksum, null);
        assert.deepEqual(stored, [0n, 0n, 0n, 0n]);
      } else {
        assert.deepEqual(stored, fletcher4(before), `${name(from)} ${short(x)}`);
        assert.deepEqual(x.cksum, stored);
      }
      if (x.type === "END") {
        const endCk = [0, 1, 2, 3].map((i) => new DataView(x.header.buffer).getBigUint64(8 + 8 * i, true));
        assert.deepEqual(endCk, fletcher4(concat(parts)), "drr_end.drr_checksum: the stream before END");
        assert.deepEqual(endCk, r.total);
      }
      parts.push(x.header, x.payload);
    }
  }
});

test("fletcher_4_incremental: carrying the sums on equals fletcher_4_incremental_combine (zfs_fletcher.c L549-L569)", () => {
  const M64 = (x) => BigInt.asUintN(64, x);
  const combine = (z, size, n) => {
    const c1 = BigInt(size / 4), c2 = (c1 * (c1 + 1n)) / 2n, c3 = (c2 * (c1 + 2n)) / 3n;
    return [M64(z[0] + n[0]), M64(z[1] + n[1] + c1 * z[0]), M64(z[2] + n[2] + c1 * z[1] + c2 * z[0]), M64(z[3] + n[3] + c1 * z[2] + c2 * z[1] + c3 * z[0])];
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
  for (let t = 0; t < 50; t++) {
    const a = new Uint8Array(4 * (1 + (rnd() % 200))).map(() => rnd() & 255);
    const b = new Uint8Array(4 * (1 + (rnd() % 200))).map(() => rnd() & 255);
    const za = fletcher4(a);
    assert.deepEqual(fletcher4Inc(za, b), combine(za, b.length, fletcher4(b)));
    assert.deepEqual(fletcher4Inc(za, b), fletcher4(concat([a, b])));
  }
});

test("the receiver: every stream ends with the files of @s4", () => {
  const want = M.contentOf(s4.root);
  assert.deepEqual(Object.keys(want), ["1", "2", "4"]);
  assert.deepEqual(want[2].blocks, ["b0", null, null, "b3"]);
  for (const from of FROMS) {
    const start = from ? M.contentOf(from.root) : {};
    const r = M.send(s4, from);
    const got = M.receive(start, M.streamBytes(r.records));
    assert.equal(got.error, null, name(from));
    assert.ok(M.sameContent(got.content, want), name(from));
    assert.deepEqual(got.dispatched.map((d) => d.i), r.records.map((_, i) => i), "every record, in order");
    const fn = { BEGIN: "dmu_recv_begin", OBJECT: "receive_object", FREEOBJECTS: "receive_freeobjects", WRITE: "receive_process_write_record", FREE: "receive_free", END: "receive_read_record" };
    for (const d of got.dispatched) {
      assert.equal(d.fn, fn[d.type]);
      assert.ok(d.ok);
    }
  }
  // Without the stream, the from-snapshots differ from @s4.
  for (const from of [s1, s2, s3]) assert.ok(!M.sameContent(M.contentOf(from.root), want));
});

test("the receiver, step by step from @s1: a gets block 2, b loses 1 and 2, c is freed, d is created", () => {
  const got = M.receive(M.contentOf(s1.root), M.streamBytes(M.send(s4, s1).records));
  const eff = got.dispatched.map((d) => `${d.type}:${d.effect}`);
  assert.deepEqual(eff, [
    "BEGIN:", "OBJECT:exists", "FREE:", "WRITE:2", "OBJECT:exists", "FREE:", "FREE:1,2", "FREEOBJECTS:3",
    "OBJECT:created", "FREE:", "WRITE:0", "WRITE:1", "WRITE:2", "WRITE:3", "FREEOBJECTS:", "END:",
  ]);
  assert.equal(got.dispatched[3].after[1].blocks[2], "a2′");
  assert.equal(got.dispatched[7].after[3], undefined);
});

test("a flipped bit: ECKSUM at the next header, the damaged record never applied", () => {
  const r = M.send(s4, null);
  const w = r.records.findIndex((x) => x.type === "WRITE");
  assert.equal(w, 3);
  const got = M.receive({}, M.flipBit(M.streamBytes(r.records), w));
  assert.deepEqual(got.error, { i: 4, err: "ECKSUM" });
  assert.deepEqual(got.dispatched.map((d) => d.type), ["BEGIN", "OBJECT", "FREE"]);
  assert.deepEqual(got.content, {}, "the receive is undone: nothing of the stream stays");
  const inc = M.receive(M.contentOf(s1.root), M.flipBit(M.streamBytes(M.send(s4, s1).records), 3));
  assert.equal(inc.error.err, "ECKSUM");
  assert.deepEqual(inc.content, M.contentOf(s1.root), "the receiver still holds @s1");
  // A flip in a header is caught at that header.
  const h = M.receive(M.contentOf(s3.root), M.flipBit(M.streamBytes(M.send(s4, s3).records), 1));
  assert.deepEqual(h.error, { i: 1, err: "ECKSUM" });
  assert.deepEqual(h.dispatched.map((d) => d.type), ["BEGIN"]);
  // A flip in END's drr_end.drr_checksum alone: caught by its header check too.
  const e = M.streamBytes(r.records);
  e.at(-1).header[8] ^= 1;
  assert.equal(M.receive({}, e).error.i, r.records.length - 1);
});

test("other targets: a hole among the dnode blocks is FREEOBJECTS (dropped past the last block), never a FREE of object 0", () => {
  for (const [to, from] of [[s1, null], [s2, null], [s2, s1], [s3, s1]]) {
    const r = M.send(to, from);
    assert.ok(!r.records.some((x) => x.object === 0), `${to.name} from ${name(from)}`);
    const hole = r.steps.find((s) => s.bp?.id === "dn1");
    if (to === s1 || to === s2) {
      assert.equal(hole.range, "HOLE");
      assert.ok(!r.records.some((x) => x.type === "FREEOBJECTS" && x.firstobj >= 4), "objects 4-7 cannot exist: dropped (L653-L666)");
    }
    const got = M.receive(from ? M.contentOf(from.root) : {}, M.streamBytes(r.records));
    assert.equal(got.error, null);
    assert.ok(M.sameContent(got.content, M.contentOf(to.root)), `${to.name} from ${name(from)}`);
  }
});

test("holes of birth 0: visited by default (send_holes_without_birth_time = 1), skipped only as L272-L276 say", () => {
  // @s2 has one dnode block (dn_maxblkid 0, so no object can have been reallocated);
  // make block 3 of a a hole of birth 0 and send @s2 from @s1.
  const to = structuredClone(s2);
  const b = bp(to.root, "o1.3");
  Object.assign(b, { hole: true, birth: 0, data: undefined });
  const step = (opts, from = s1) => M.send(to, from, opts).steps.find((s) => s.bp === undefined ? false : s.bp.id === "o1.3");
  assert.equal(step({}).visit, true, "default: visited");
  assert.equal(step({}).range, "HOLE");
  assert.equal(step({ sendHolesWithoutBirthTime: false }).visit, false, "no realloc possible, hole_birth enabled before F: skipped");
  assert.equal(step({ sendHolesWithoutBirthTime: false, holeBirthTxg: Infinity }).visit, true, "hole_birth not active: visited");
  assert.equal(step({ sendHolesWithoutBirthTime: false }, null).visit, true, "full stream: F = 0 < enabled txg, visited");
  // With two dnode blocks (@s4), an object number may have been reused: visited.
  const to4 = structuredClone(s4);
  Object.assign(bp(to4.root, "o4.3"), { hole: true, birth: 0, data: undefined });
  const st = M.send(to4, s2, { sendHolesWithoutBirthTime: false }).steps.find((s) => s.bp?.id === "o4.3");
  assert.equal(st.visit, true);
});

function concat(arrs) {
  const n = arrs.reduce((a, x) => a + x.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of arrs) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
