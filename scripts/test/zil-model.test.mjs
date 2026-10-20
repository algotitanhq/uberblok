// Tests for the model of the ZIL and SLOG room (src/lib/zil.ts, loaded with
// Node's type stripping), against cases worked by hand from the code at
// zfs-2.4.4 (ANALYSIS.md, room "ZIL and SLOG", "Hand-checked cases"):
// zil_write_state (zil.c L2212-L2246) with the downgrade of zfs_log_write
// (zfs_log.c L645-L649) for every log device x logbias x size x O_DSYNC x
// O_DIRECT case; zio_alloc_zil's class order (zio.c L4561-L4595); the lwb
// states (zil_impl.h L83-L92) and packing (zil.c L2334-L2387); zil_sync
// (L4206-L4224); zil_claim (L1232-L1253) and zil_replay_log_record
// (L4696-L4712); then properties over random sequences. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  empty, write, fsync, sync, crash, importPool, mount, toReplay, chainRecords, zilWriteState, logWrite, allocZil, stateInput,
  KIB, BLOCKSIZE, LWB_ROOM, MAX_LOG_DATA, MAX_COPIED_DATA, MAX_WASTE_SPACE, ZIL_CHAIN_SIZE, LR_WRITE_SIZE, LWB_STATES, SIZES, CLASSES,
} from "../../src/lib/zil.ts";

const F = { dsync: false, direct: false };
const DSYNC = { dsync: true, direct: false };
const DIRECT = { dsync: false, direct: true };
const at = (slog = "none", logbias = "latency") => {
  const s = empty();
  s.pool = { slog };
  s.logbias = logbias;
  return s;
};
/** The state of the first record of a write, with the downgrade. */
const stateOf = (slog, logbias, size, f) => logWrite(stateInput(at(slog, logbias), size, f), 0)[0].state;

test("sizes: lr_write_t 192 bytes, zil_chain_t 184, 130,888 bytes of records per 128 KiB block, 130,696 of data", () => {
  assert.equal(LR_WRITE_SIZE, 192);
  assert.equal(ZIL_CHAIN_SIZE, 184);
  assert.equal(LWB_ROOM, 130888);
  assert.equal(MAX_LOG_DATA, 130696);
  assert.equal(MAX_COPIED_DATA, 7680);
  assert.equal(MAX_WASTE_SPACE, 8168);
});

test("zil_write_state with the zfs_log_write downgrade, every case of the figure, by hand", () => {
  // [log device, logbias, size KiB, O_DSYNC, O_DIRECT] -> state. 128 KiB file blocks, no special vdev.
  const want = {};
  for (const slog of ["none", "slog", "full"])
    for (const lb of ["latency", "throughput"])
      for (const kib of [4, 16, 48, 128])
        for (const dsync of [false, true])
          for (const direct of [false, true]) {
            let st;
            // O_DIRECT is the Direct I/O path only for a whole block (zfs_vnops.c L296-L299).
            if (lb === "throughput" || (direct && kib >= 128)) st = "WR_INDIRECT"; // L2216-L2217
            else if (!dsync) st = kib >= 32 && slog === "none" ? "WR_INDIRECT" : "WR_NEED_COPY"; // >= 32 KiB and !commit
            else if (kib >= 64 && slog === "none") st = "WR_INDIRECT"; // >= 32 KiB and >= half a block
            else st = kib * KIB <= 7680 ? "WR_COPIED" : "WR_NEED_COPY"; // copied, or downgraded over 7680 bytes
            want[`${slog} ${lb} ${kib} ${dsync} ${direct}`] = st;
          }
  let n = 0;
  for (const [k, st] of Object.entries(want)) {
    const [slog, lb, kib, dsync, direct] = k.split(" ");
    assert.equal(stateOf(slog, lb, Number(kib) * KIB, { dsync: dsync === "true", direct: direct === "true" }), st, k);
    n++;
  }
  assert.equal(n, 96);
  // The named cases of ANALYSIS.md.
  assert.equal(stateOf("none", "latency", 4 * KIB, F), "WR_NEED_COPY");
  assert.equal(stateOf("none", "latency", 4 * KIB, DSYNC), "WR_COPIED");
  assert.equal(stateOf("none", "latency", 16 * KIB, DSYNC), "WR_NEED_COPY");
  assert.equal(stateOf("none", "latency", 48 * KIB, F), "WR_INDIRECT");
  assert.equal(stateOf("none", "latency", 48 * KIB, DSYNC), "WR_NEED_COPY");
  assert.equal(stateOf("none", "latency", 128 * KIB, DSYNC), "WR_INDIRECT");
  assert.equal(stateOf("slog", "latency", 128 * KIB, F), "WR_NEED_COPY");
  assert.equal(stateOf("slog", "latency", 128 * KIB, DSYNC), "WR_NEED_COPY");
  assert.equal(stateOf("slog", "throughput", 4 * KIB, DSYNC), "WR_INDIRECT");
  assert.equal(stateOf("slog", "latency", 128 * KIB, DIRECT), "WR_INDIRECT");
  // A short O_DIRECT write goes through the ARC: not the Direct I/O path.
  assert.equal(stateOf("slog", "latency", 4 * KIB, DIRECT), "WR_NEED_COPY");
  assert.equal(stateOf("none", "latency", 4 * KIB, { dsync: true, direct: true }), "WR_COPIED");
  assert.equal(stateOf("full", "latency", 128 * KIB, F), "WR_NEED_COPY");
});

test("zil_write_state on its own: boundaries, the downgrade, and the special-vdev branch", () => {
  const base = { hasSlogs: false, logbias: "latency", blocksize: BLOCKSIZE, oDirect: false };
  // 32 KiB exactly is indirect without commit; one byte less is not.
  assert.equal(zilWriteState({ ...base, size: 32768, commit: false }).state, "WR_INDIRECT");
  assert.equal(zilWriteState({ ...base, size: 32767, commit: false }).state, "WR_NEED_COPY");
  // With commit: half a block (64 KiB) is the threshold.
  assert.equal(zilWriteState({ ...base, size: 65536, commit: true }).state, "WR_INDIRECT");
  assert.equal(zilWriteState({ ...base, size: 65535, commit: true }).state, "WR_COPIED");
  // The downgrade is zfs_log_write's: 7680 stays copied, 7681 does not.
  assert.equal(logWrite({ ...base, size: 7680, commit: true }, 0)[0].state, "WR_COPIED");
  assert.equal(logWrite({ ...base, size: 7681, commit: true }, 0)[0].state, "WR_NEED_COPY");
  assert.equal(logWrite({ ...base, size: 7681, commit: true }, 0)[0].downgraded, true);
  // Special vdevs, no SLOG: indirect only when the file's blocks go to special, or zil_special_is_slog is 0.
  const sp = { ...base, hasSpecial: true, size: 128 * KIB, commit: false };
  assert.equal(zilWriteState({ ...sp, onSpecial: false }).state, "WR_NEED_COPY");
  assert.equal(zilWriteState({ ...sp, onSpecial: true }).state, "WR_INDIRECT");
  assert.equal(zilWriteState({ ...sp, onSpecial: false, specialIsSlog: false }).state, "WR_INDIRECT");
  // A SLOG wins over special.
  assert.equal(zilWriteState({ ...sp, hasSlogs: true, onSpecial: true }).state, "WR_NEED_COPY");
  // WR_INDIRECT covers at most one file block per record (zfs_log.c L648-L649).
  const r = logWrite({ ...base, size: 128 * KIB, commit: false }, 64 * KIB);
  assert.deepEqual(r.map((x) => [x.off / KIB, x.len / KIB]), [[64, 64], [128, 64]]);
});

test("zio_alloc_zil: log class first, then special embedded log, special, embedded log, normal", () => {
  assert.deepEqual([...CLASSES], ["log", "special_embedded_log", "special", "embedded_log", "normal"]);
  const s = allocZil({ slog: "slog" });
  assert.equal(s.cls, "log");
  assert.equal(s.slog, true);
  assert.deepEqual(s.tried.map((t) => t.cls), ["log"]);
  const n = allocZil({ slog: "none" });
  assert.equal(n.cls, "embedded_log");
  assert.equal(n.slog, false);
  assert.deepEqual(n.tried.map((t) => `${t.cls}:${t.why}`), ["log:absent", "special_embedded_log:absent", "special:absent", "embedded_log:taken"]);
  const f = allocZil({ slog: "full" });
  assert.equal(f.cls, "embedded_log");
  assert.equal(f.slog, false);
  assert.equal(f.tried[0].why, "full");
  assert.equal(allocZil({ slog: "full", special: true }).cls, "special_embedded_log");
  const last = allocZil({ slog: "full", embeddedFull: true });
  assert.equal(last.cls, "normal");
  assert.deepEqual(last.tried.map((t) => t.why), ["full", "absent", "absent", "full", "taken"]);
});

/** The chain exists: a first fsync has created it (and paid the txg wait), so txg 101 is open. */
const primed = (slog = "none", logbias = "latency") => {
  const s = at(slog, logbias);
  write(s, 4 * KIB, F);
  fsync(s);
  return s;
};
const EMB = [{ cls: "log", ok: false, why: "absent" }, { cls: "special_embedded_log", ok: false, why: "absent" }, { cls: "special", ok: false, why: "absent" }, { cls: "embedded_log", ok: true, why: "taken" }];

test("first commit on an empty log: zil_create takes a 4 KiB block, waits for txg 100 to sync, logs no record", () => {
  // Hand-derived from zil_create (L1011-L1056) and zil_process_commit_list (L3157-L3164, L3209, L3256, L3280-L3283).
  const s = at();
  assert.deepEqual(write(s, 4 * KIB, F), [{ k: "itx", write: 1, size: 4096, state: "WR_NEED_COPY", recs: 1, txg: 100 }]);
  assert.equal(s.lwbs.length, 0);
  const ev = fsync(s);
  assert.deepEqual(ev, [
    { k: "create", blk: { id: 1, cls: "embedded_log", txg: 100, size: 4096 }, tried: EMB },
    { k: "lwb", lwb: 1, state: "NEW" },
    { k: "createWait", txg: 100 },
    { k: "sync", txg: 100, writes: 1, dropped: 0 },
    { k: "head", blk: 1 },
    { k: "dropSynced", itxs: 1, txg: 100 },
    { k: "lwb", lwb: 1, state: "OPENED" },
    { k: "waiter", lwb: 1 },
    { k: "lwb", lwb: 1, state: "CLOSED" },
    { k: "lwb", lwb: 2, state: "NEW" },
    { k: "lwb", lwb: 1, state: "READY" },
    { k: "alloc", lwb: 1, next: 2, blk: { id: 2, cls: "embedded_log", txg: 101, size: 131072 }, tried: EMB },
    { k: "lwb", lwb: 1, state: "ISSUED" },
    { k: "lwb", lwb: 1, state: "WRITE_DONE" },
    { k: "lwb", lwb: 1, state: "FLUSH_DONE" },
    { k: "returns", how: "fsync", via: "sync" },
  ]);
  // lwb 1 went through every state, in order, with no record: only the commit waiter.
  assert.deepEqual(ev.filter((e) => e.k === "lwb" && e.lwb === 1).map((e) => e.state), [...LWB_STATES]);
  assert.ok(!ev.some((e) => e.k === "assign"));
  assert.deepEqual([s.synced, s.txg, s.header.log, s.lrSeq], [100, 101, 1, 0]);
  assert.equal(s.writes[0].status, "synced");
  assert.deepEqual(s.lwbs.map((l) => [l.id, l.state, l.blk.id, l.size, l.recs.length]), [[1, "FLUSH_DONE", 1, 4096, 0], [2, "NEW", 2, 131072, 0]]);
  // O_DSYNC on an empty log: write() returns the same way, and a WR_INDIRECT itx is dropped before any dmu_sync.
  const t = at("slog", "throughput");
  const et = write(t, 4 * KIB, DSYNC);
  assert.equal(et[0].state, "WR_INDIRECT");
  assert.deepEqual(et.at(-1), { k: "returns", how: "write", via: "sync" });
  assert.deepEqual([t.writes[0].status, t.writes[0].inPlace], ["synced", false]);
  assert.equal(et.find((e) => e.k === "create").blk.cls, "log");
});

test("second commit, on the existing chain: the record goes into lwb 2, fsync returns from the log", () => {
  const s = primed();
  write(s, 4 * KIB, F);
  const ev = fsync(s);
  assert.ok(!ev.some((e) => e.k === "create" || e.k === "createWait"));
  const rec = ev.filter((e) => e.k === "assign");
  assert.deepEqual(rec.map((e) => [e.lwb, e.seq, e.write, e.len, e.bytes, e.split]), [[2, 1, 2, 4096, 192 + 4096, false]]);
  // lwb 2 became NEW in the first commit; now it goes through the rest.
  assert.deepEqual(ev.filter((e) => e.k === "lwb" && e.lwb === 2).map((e) => e.state), LWB_STATES.slice(1));
  // Issuing lwb 2 allocates block 3 for lwb 3, before the issued state.
  const alloc = ev.findIndex((e) => e.k === "alloc");
  assert.ok(alloc < ev.findIndex((e) => e.k === "lwb" && e.lwb === 2 && e.state === "ISSUED"));
  assert.deepEqual([ev[alloc].next, ev[alloc].blk.id, ev[alloc].blk.cls], [3, 3, "embedded_log"]);
  assert.deepEqual(ev.at(-1), { k: "returns", how: "fsync", via: "log" });
  assert.deepEqual(ev.at(-2), { k: "lwb", lwb: 2, state: "FLUSH_DONE" });
  assert.equal(s.header.log, 1);
  assert.deepEqual(s.writes.map((w) => w.status), ["synced", "logged"]);
  assert.deepEqual(s.lwbs.map((l) => [l.id, l.state, l.blk.id]), [[1, "FLUSH_DONE", 1], [2, "FLUSH_DONE", 2], [3, "NEW", 3]]);
});

test("crash before txg 101 syncs: claim txg 101, 3 blocks, 1 record, replay brings the write back; the next commit waits again", () => {
  const s = primed();
  write(s, 4 * KIB, F);
  fsync(s);
  assert.deepEqual(crash(s), [{ k: "crash", lost: 0 }]);
  assert.deepEqual(importPool(s), [{ k: "claim", first: 101, blocks: 3, recs: 1, needed: true }]);
  assert.deepEqual(toReplay(s).map((r) => r.seq), [1]);
  assert.deepEqual(mount(s), [{ k: "replay", seq: 1, write: 2, txg: 101 }, { k: "destroy", kept: null }]);
  assert.deepEqual(s.writes.map((w) => w.status), ["synced", "replayed"]);
  assert.equal(s.header.log, null);
  // zh_log is a hole again: the next commit pays the create wait again.
  write(s, 4 * KIB, F);
  const ev = fsync(s);
  assert.ok(ev.some((e) => e.k === "createWait"));
  assert.deepEqual(ev.at(-1), { k: "returns", how: "fsync", via: "sync" });
});

test("crash right after the first commit: 2 blocks, no record, ZIL_REPLAY_NEEDED (more than one block), nothing replayed", () => {
  const s = primed();
  crash(s);
  // zil_claim, L1245-L1246: zl_parse_blk_count > 1.
  assert.deepEqual(importPool(s), [{ k: "claim", first: 101, blocks: 2, recs: 0, needed: true }]);
  assert.deepEqual(mount(s), [{ k: "destroy", kept: null }]);
  assert.equal(s.header.log, null);
  assert.equal(s.writes[0].status, "synced");
});

test("sync then crash: lwbs 1 and 2 freed, zh_log on block 3, claim txg 102, nothing to replay; block 3 is kept and reused", () => {
  const s = primed();
  write(s, 4 * KIB, F);
  fsync(s);
  const ev = sync(s);
  assert.deepEqual(ev, [
    { k: "sync", txg: 101, writes: 1, dropped: 0 },
    { k: "free", blk: { id: 1, cls: "embedded_log", txg: 100, size: 4096 } },
    { k: "free", blk: { id: 2, cls: "embedded_log", txg: 101, size: 131072 } },
    { k: "head", blk: 3 },
  ]);
  assert.equal(s.writes[1].status, "synced");
  crash(s);
  assert.deepEqual(importPool(s), [{ k: "claim", first: 102, blocks: 1, recs: 0, needed: false }]);
  assert.deepEqual(toReplay(s), []);
  // Nothing to replay: zil_destroy keeps the first block, b3, and zh_log names it again.
  assert.deepEqual(mount(s), [{ k: "destroy", kept: 3 }]);
  assert.equal(s.header.log, 3);
  // The next commit reuses it: no allocation, no txg wait, and its record is logged.
  write(s, 4 * KIB, F);
  const ev2 = fsync(s);
  assert.equal(s.writes[2].txg, 103);
  assert.deepEqual(ev2.slice(0, 2), [{ k: "reuse", blk: { id: 3, cls: "embedded_log", txg: 101, size: 131072 } }, { k: "lwb", lwb: 4, state: "NEW" }]);
  assert.ok(!ev2.some((e) => e.k === "create" || e.k === "createWait"));
  assert.deepEqual(ev2.at(-1), { k: "returns", how: "fsync", via: "log" });
  assert.deepEqual(s.lwbs.map((l) => [l.id, l.state, l.blk.id]), [[4, "FLUSH_DONE", 3], [5, "NEW", 4]]);
  assert.equal(s.writes[2].status, "logged");
  // And a crash right after the kept block's mount: the walk follows that one block.
  const t = primed();
  sync(t);
  crash(t);
  importPool(t);
  assert.deepEqual(mount(t), [{ k: "destroy", kept: 2 }]);
  crash(t);
  assert.deepEqual(importPool(t), [{ k: "claim", first: 103, blocks: 1, recs: 0, needed: false }]);
});

test("large write: WR_INDIRECT without SLOG (one 192-byte record, block in place before READY); split WR_NEED_COPY with SLOG", () => {
  const a = primed();
  write(a, 128 * KIB, F);
  const ea = fsync(a);
  assert.deepEqual(ea.filter((e) => e.k === "assign").map((e) => [e.state, e.bytes]), [["WR_INDIRECT", 192]]);
  // zil_lwb_commit (the dmu_sync) runs before LWB_STATE_READY (L1950-L1972).
  const ip = ea.findIndex((e) => e.k === "inplace" && e.write === 2);
  assert.ok(ip >= 0 && ip < ea.findIndex((e) => e.k === "lwb" && e.lwb === 2 && e.state === "READY"));
  assert.equal(a.writes[1].inPlace, true);

  const b = primed("slog");
  assert.deepEqual(b.lwbs.map((l) => [l.blk.cls, l.slog]), [["log", true], ["log", true]]);
  write(b, 128 * KIB, F);
  const eb = fsync(b);
  // 131,072 bytes of data: 130,696 into lwb 2 (full: 192 + 130,696 = 130,888), the 376 left into lwb 3.
  assert.deepEqual(eb.filter((e) => e.k === "assign").map((e) => [e.lwb, e.seq, e.len, e.bytes]), [[2, 1, 130696, 130888], [3, 2, 376, 568]]);
  assert.ok(!eb.some((e) => e.k === "inplace"));
  assert.deepEqual(eb.find((e) => e.k === "waiter"), { k: "waiter", lwb: 3 });
  assert.deepEqual(eb.filter((e) => e.k === "alloc").map((e) => [e.lwb, e.next, e.blk.id, e.blk.cls]), [[2, 3, 3, "log"], [3, 4, 4, "log"]]);
  assert.deepEqual(eb.filter((e) => e.k === "lwb" && e.lwb === 2).map((e) => e.state), LWB_STATES.slice(1));
  assert.deepEqual(eb.filter((e) => e.k === "lwb" && e.lwb === 3).map((e) => e.state), [...LWB_STATES]);
  assert.deepEqual(eb.at(-2), { k: "lwb", lwb: 3, state: "FLUSH_DONE" });
  crash(b);
  assert.deepEqual(importPool(b)[0], { k: "claim", first: 101, blocks: 4, recs: 2, needed: true });
  assert.deepEqual(mount(b).filter((e) => e.k === "replay").map((e) => e.seq), [1, 2]);
  assert.equal(b.writes[1].status, "replayed");
});

test("SLOG full: the write state of a SLOG, the blocks of the embedded log", () => {
  const s = primed("full");
  write(s, 128 * KIB, F);
  const ev = fsync(s);
  assert.equal(s.writes[1].state, "WR_NEED_COPY");
  assert.deepEqual(ev.filter((e) => e.k === "alloc").map((e) => e.tried.map((t) => t.why)), [["full", "absent", "absent", "taken"], ["full", "absent", "absent", "taken"]]);
  assert.ok(s.lwbs.every((l) => !l.slog && l.blk.cls === "embedded_log"));
});

test("logbias=throughput with O_DSYNC on the existing chain: WR_INDIRECT, committed by write() itself", () => {
  const s = primed("slog", "throughput");
  const ev = write(s, 4 * KIB, DSYNC);
  assert.equal(ev[0].state, "WR_INDIRECT");
  assert.deepEqual(ev.at(-1), { k: "returns", how: "write", via: "log" });
  assert.equal(s.writes[1].status, "logged");
  assert.equal(s.writes[1].inPlace, true);
  // The log block itself still comes from the SLOG (zio.c L4561-L4565).
  assert.equal(ev.find((e) => e.k === "alloc").blk.cls, "log");
});

test("write without fsync, then crash: lost, and nothing replayed; then sync without fsync: dropped from memory", () => {
  const s = at();
  write(s, 4 * KIB, F);
  assert.deepEqual(crash(s), [{ k: "crash", lost: 1 }]);
  assert.deepEqual(importPool(s), [{ k: "claim", first: 100, blocks: 0, recs: 0, needed: false }]);
  assert.deepEqual(mount(s), [{ k: "destroy", kept: null }]);
  assert.equal(s.writes[0].status, "lost");

  const t = at();
  write(t, 4 * KIB, F);
  assert.deepEqual(sync(t)[0], { k: "sync", txg: 100, writes: 1, dropped: 1 });
  assert.equal(t.pending.length, 0);
  assert.equal(t.writes[0].status, "synced");
  // An fsync after the sync has nothing to log, and does not create a log.
  assert.deepEqual(fsync(t), [{ k: "nothing" }, { k: "returns", how: "fsync", via: "log" }]);
  assert.equal(t.lwbs.length, 0);
});

test("small writes pack into one lwb per commit; WR_COPIED carries its data in the header", () => {
  const s = primed("slog");
  write(s, 4 * KIB, F);
  write(s, 4 * KIB, F);
  const ev = fsync(s);
  assert.deepEqual(ev.filter((e) => e.k === "assign").map((e) => [e.lwb, e.seq, e.bytes]), [[2, 1, 4288], [2, 2, 4288]]);
  assert.equal(s.lwbs[1].nused, 8576);
  const e2 = write(s, 4 * KIB, DSYNC);
  // Next commit: lwb 3, already holding its block from lwb 2's issue.
  assert.deepEqual(e2.filter((e) => e.k === "assign").map((e) => [e.lwb, e.seq, e.state, e.bytes]), [[3, 3, "WR_COPIED", 192 + 4096]]);
});

test("a record that does not fit closes the lwb; WR_NEED_COPY is split, WR_COPIED never is", () => {
  const s = primed("slog");
  write(s, 128 * KIB, F);
  write(s, 4 * KIB, DSYNC); // WR_COPIED 4288 bytes: goes to lwb 3 after the 568-byte tail.
  assert.deepEqual(chainRecords(s).map((r) => [r.seq, r.bytes]), [[1, 130888], [2, 568], [3, 4288]]);
  const t = primed("slog");
  for (let i = 0; i < 31; i++) write(t, 4 * KIB, F);
  write(t, 4 * KIB, DSYNC);
  // 30 records of 4288 bytes fill 128,640; the 31st is not split into the 2,248 bytes left (under zil_max_waste_space): next lwb.
  const lwbOf = new Map(t.lwbs.flatMap((l) => l.recs.map((r) => [r.seq, l.id])));
  assert.equal(lwbOf.get(30), 2);
  assert.equal(lwbOf.get(31), 3);
  assert.ok(chainRecords(t).every((r) => r.state !== "WR_COPIED" || r.bytes === 192 + 4096));
});

test("refusals: nothing runs while crashed or before mount; import and mount only in order", () => {
  const s = at();
  assert.equal(importPool(s)[0].k, "refused");
  assert.equal(mount(s)[0].k, "refused");
  crash(s);
  assert.equal(write(s, 4 * KIB, F)[0].k, "refused");
  assert.equal(sync(s)[0].k, "refused");
  assert.equal(mount(s)[0].k, "refused");
  importPool(s);
  assert.equal(fsync(s)[0].k, "refused");
  assert.equal(importPool(s)[0].k, "refused");
  mount(s);
  assert.equal(write(s, 4 * KIB, F)[0].k, "itx");
});

test("replay restores exactly the logged writes of txgs not yet synced, over 300 random sequences", () => {
  let seed = 8;
  const rnd = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let run = 0; run < 300; run++) {
    const s = at(["none", "slog", "full"][rnd(3)], rnd(4) ? "latency" : "throughput");
    const steps = 1 + rnd(14);
    for (let i = 0; i < steps; i++) {
      const a = rnd(10);
      if (a < 5) write(s, SIZES[rnd(4)], { dsync: rnd(3) === 0, direct: rnd(6) === 0 });
      else if (a < 8) {
        const ev = fsync(s);
        if (ev.some((e) => e.k === "createWait")) {
          // zil_create waited for the open txg: every write up to it is in the tree, none was logged, zh_log names a block.
          assert.ok(!ev.some((e) => e.k === "assign"), `run ${run}: a record logged by a create commit`);
          assert.ok(s.writes.every((w) => w.txg > s.synced || w.status === "synced"), `run ${run}: a write of a synced txg not synced`);
          assert.notEqual(s.header.log, null);
          assert.equal(s.pending.length, 0);
        }
      }
      else sync(s);
      if (rnd(5) === 0) s.pool = { slog: ["none", "slog", "full"][rnd(3)] };
    }
    // Invariants before the crash: lwb states never go backwards along the list; records in order.
    const order = s.lwbs.map((l) => LWB_STATES.indexOf(l.state));
    for (let i = 1; i < order.length; i++) assert.ok(order[i] <= order[i - 1], `run ${run}: lwb states ${order}`);
    const seqs = chainRecords(s).map((r) => r.seq);
    assert.deepEqual(seqs, [...seqs].sort((x, y) => x - y));
    // Every log block came from the first class that had room.
    for (const l of s.lwbs) if (l.blk && l.slog) assert.equal(l.blk.cls, "log");
    const synced = s.synced;
    const expect = new Set(s.writes.filter((w) => w.status === "logged" && w.txg > synced).map((w) => w.id));
    const before = s.writes.map((w) => w.status);
    crash(s);
    importPool(s);
    const replayed = new Set(toReplay(s).map((r) => r.write));
    assert.deepEqual([...replayed].sort(), [...expect].sort(), `run ${run}`);
    mount(s);
    s.writes.forEach((w, i) => {
      if (before[i] === "synced") assert.equal(w.status, "synced");
      else if (before[i] === "logged") assert.equal(w.status, "replayed");
      else assert.equal(w.status, "lost");
    });
  }
});
