// Tests for the txg pipeline model of the Transaction groups room
// (src/lib/txg.ts, loaded with Node's type stripping). They check the
// invariants the code guarantees and that each path of the figure happens as
// txg.c says. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { create, advance, step, write, zpoolSync, longFree, holds, TXG_TIMEOUT, DIRTY_SYNC } from "../../src/lib/txg.ts";

// One txg per stage at most, the open txg always there and newest, and the
// quiescing/quiesced and syncing txgs in order behind it.
function invariants(m) {
  assert.ok(m.open > 0);
  assert.ok(!(m.quiescing && m.quiesced), "one txg quiescing or quiesced, never both (txg.c L632-L636)");
  const behind = [m.quiescing || m.quiesced, m.syncing].filter(Boolean);
  for (const t of behind) assert.ok(t < m.open);
  if (m.syncing && (m.quiescing || m.quiesced)) assert.ok(m.syncing < (m.quiescing || m.quiesced));
  assert.ok(m.synced < m.open);
  for (const row of m.count) for (const c of row) assert.ok(c >= 0);
  assert.ok(m.ub <= m.synced);
}

function run(m, seconds, dt = 0.05) {
  const evs = [];
  for (let t = 0; t < seconds; t += dt) {
    evs.push(...advance(m, dt));
    invariants(m);
  }
  return evs;
}

test("an idle pool still syncs every zfs_txg_timeout, and an empty txg writes no uberblock", () => {
  const m = create(41);
  const evs = run(m, TXG_TIMEOUT + 2);
  const wake = evs.find((e) => e.kind === "wake-timeout");
  assert.ok(wake && Math.abs(wake.t - TXG_TIMEOUT) < 1e-9);
  assert.deepEqual(
    evs.filter((e) => e.major).map((e) => e.kind),
    ["quiesce", "handoff", "sync", "noop", "no-uberblock", "synced"],
  );
  assert.equal(m.synced, 41);
  assert.equal(m.open, 42);
  assert.equal(m.ub, 40, "uberblock on disk unchanged");
});

test("writes land in the open txg; the txg quiesces only when every hold is released", () => {
  const m = create(41);
  write(m);
  write(m);
  assert.equal(holds(m, 41), 2);
  assert.deepEqual(m.count.map((c) => c[41 & 3]), [1, 1, 0, 0]);
  zpoolSync(m);
  const evs = [];
  // Walk event by event: the quiesce comes first, holds are still there.
  for (let i = 0; i < 6; i++) evs.push(...step(m));
  const q = evs.findIndex((e) => e.kind === "quiesce");
  const h = evs.findIndex((e) => e.kind === "handoff");
  const rel = evs.map((e, i) => (e.kind === "rele" ? i : -1)).filter((i) => i >= 0);
  assert.ok(q >= 0 && h > q);
  assert.ok(rel.every((i) => i > q && i < h), "holders finish in the quiescing txg, then the hand-off");
  assert.equal(m.open, 42, "the next txg opened at the quiesce, before the drain ended");
});

test("past zfs_dirty_data_sync_percent, txg_kick syncs before the timeout", () => {
  const m = create(41);
  const evs = [];
  for (let i = 0; i <= DIRTY_SYNC; i++) evs.push(...write(m));
  assert.ok(evs.some((e) => e.kind === "kick"));
  evs.push(...run(m, 4));
  assert.ok(evs.some((e) => e.kind === "wake-waiter"));
  assert.ok(!evs.some((e) => e.kind === "wake-timeout"));
  assert.equal(m.ub, 41, "a txg with data writes its uberblock");
  assert.equal(m.synced, 41);
});

test("zpool sync waits for tx_open_txg + TXG_DEFER_SIZE", () => {
  const m = create(41);
  write(m);
  const e = zpoolSync(m);
  assert.equal(e.txg, 43);
  run(m, 6);
  assert.equal(m.synced, 43);
  assert.equal(m.ub, 41, "41 had data; 42 and 43 were empty");
});

test("only txg_wait_open fills all three stages: open, quiescing, syncing", () => {
  const m = create(41);
  for (let i = 0; i < 3; i++) write(m);
  zpoolSync(m);
  let seen = false;
  for (let i = 0; i < 400 && !seen; i++) {
    advance(m, 0.02);
    invariants(m);
    if (m.syncing && !m.quiescing && !m.quiesced) {
      write(m); // a holder in the open txg, so its quiesce has to drain
      longFree(m);
    }
    if (m.syncing && (m.quiescing || m.quiesced)) seen = true;
  }
  assert.ok(seen);
});

test("without txg_wait_open the next txg stays open while one syncs", () => {
  const m = create(41, 0.4); // a write every 0.4 s
  const both = [];
  for (let i = 0; i < 1500; i++) {
    advance(m, 0.02);
    invariants(m);
    if (m.syncing && (m.quiescing || m.quiesced)) both.push(m.t);
  }
  assert.equal(both.length, 0);
  assert.ok(m.synced >= 43);
});

test("synced txgs are consecutive and every hold is released", () => {
  const m = create(41, 0.3);
  const evs = run(m, 30, 0.1);
  const synced = evs.filter((e) => e.kind === "synced").map((e) => e.txg);
  synced.forEach((t, i) => assert.equal(t, 42 + i - 1));
  m.steady = 0;
  run(m, 3);
  for (const row of m.count) for (let g = 0; g < 4; g++) if (g !== (m.open & 3)) assert.equal(row[g], 0);
});
