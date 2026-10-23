// Tests for the model of the tree and the uberblock room (src/lib/tree.ts),
// against the cases worked by hand from the code at zfs-2.4.4 (ANALYSIS.md,
// room "The tree and the uberblock", "Hand-checked cases"): the slot of each
// txg, the label offsets, the ancestors rewritten for a leaf, and which
// uberblock and which label config win the import after the plug is pulled
// at each beat of vdev_config_sync.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../../src/lib/tree.ts");

test("slot = ub_txg % VDEV_UBERBLOCK_COUNT: 128 slots at ashift 9, 32 at ashift 12", () => {
  assert.equal(M.ubCount(9), 128);
  assert.equal(M.ubCount(10), 128);
  assert.equal(M.ubCount(11), 64);
  assert.equal(M.ubCount(12), 32);
  assert.equal(M.ubCount(13), 16);
  assert.equal(M.ubCount(16), 16);
  for (const [txg, slot] of [[4210, 114], [4211, 115], [4223, 127], [4224, 0], [4338, 114], [4083, 115]]) assert.equal(M.slotOf(txg, 9), slot, `txg ${txg}`);
  assert.equal(M.slotOf(4211, 12), 19);
  // Multihost keeps the last slot for MMP: the ring turns on 127.
  assert.equal(M.slotOf(4211, 9, true), 4211 % 127);
});

test("vdev_label_offset: two labels at the front, two at the back of a 1 GiB disk", () => {
  const ps = 2 ** 30;
  assert.deepEqual([0, 1, 2, 3].map((l) => M.labelOffset(ps, l, 0)), [0, 262144, 1073217536, 1073479680]);
  assert.deepEqual([0, 1, 2, 3].map((l) => M.labelOffset(ps, l, M.PHYS_OFFSET)), [16384, 278528, 1073233920, 1073496064]);
  assert.equal(M.ubOffset(115, 9), 248832);
  assert.deepEqual([0, 1, 2, 3].map((l) => M.labelOffset(ps, l, M.ubOffset(115, 9))), [248832, 510976, 1073466368, 1073728512]);
  assert.throws(() => M.labelOffset(ps + 512, 0, 0));
  assert.throws(() => M.labelOffset(ps, 0, M.LABEL_SIZE));
});

test("ancestors: the parent is blkid >> epbs, level by level", () => {
  assert.deepEqual(M.ancestors(2, 3, 10), [{ level: 1, blkid: 0 }, { level: 2, blkid: 0 }]);
  assert.deepEqual(M.ancestors(5000, 3, 10), [{ level: 1, blkid: 4 }, { level: 2, blkid: 0 }]);
  assert.deepEqual(M.ancestors(2 ** 20, 3, 10), [{ level: 1, blkid: 1024 }, { level: 2, blkid: 1 }]);
  assert.deepEqual(M.ancestors(7, 1, 10), []);
  // The figure's tree: two pointers per indirect block.
  assert.deepEqual(M.pathOf(2), ["D2", "L1-1", "L2-0", "DN", "OS"]);
  assert.deepEqual(M.pathOf(0), ["D0", "L1-0", "L2-0", "DN", "OS"]);
});

test("a leaf write copies the leaf and every ancestor; the old tree is intact", () => {
  const p0 = M.createPool();
  const { pool: p1, rewritten } = M.writeLeaf(p0, 2);
  assert.deepEqual(rewritten, ["D2", "L1-1", "L2-0", "DN", "OS"]);
  const v = p1.open.version;
  assert.equal(p1.open.txg, 4211);
  assert.equal(v.D2, "D2@4211");
  assert.equal(v.D3, "D3@4210", "the sibling is shared");
  assert.equal(v["L1-0"], "L1-0@4190", "the other subtree is shared");
  assert.deepEqual(p1.blocks["L1-1@4211"].kids, ["D2@4211", "D3@4210"]);
  assert.deepEqual(p1.blocks["L2-0@4211"].kids, ["L1-0@4190", "L1-1@4211"]);
  // The old tree still hangs from the old uberblock, unchanged.
  assert.deepEqual(p1.blocks["L1-1@4210"].kids, ["D2@4180", "D3@4210"]);
  assert.equal(M.newestOnDisk(p1).root, "OS@4210");
  // A second leaf in the same txg: only the blocks not yet copied are new.
  const r2 = M.writeLeaf(p1, 3);
  assert.deepEqual(r2.rewritten, ["D3"]);
  const r3 = M.writeLeaf(M.writeLeaf(p0, 0).pool, 3);
  assert.deepEqual(r3.rewritten, ["D3", "L1-1"]);
  assert.equal(Object.values(r3.pool.blocks).filter((b) => b.birth === 4211).length, 7);
});

/** spa_sync writes the open txg's blocks, one height per step: beat 0 done. */
const writeAll = (p) => {
  while (p.open.beat === null) p = M.step(p);
  return p;
};
const atBeat = (beat, dirty = true) => {
  let p = M.createPool();
  p = { ...p, configDirty: dirty };
  p = writeAll(M.writeLeaf(p, 2).pool); // beat 0 = blocks written
  for (let i = 0; i < beat; i++) p = M.step(p);
  return p;
};

test("spa_sync writes the new tree bottom up, one height per step", () => {
  let p = M.writeLeaf(M.createPool(), 2).pool;
  assert.equal(M.HEIGHTS, 5);
  assert.deepEqual(M.pathOf(2).map(M.height), [0, 1, 2, 3, 4]);
  const order = [];
  for (let h = 0; h < M.HEIGHTS; h++) {
    assert.equal(p.open.beat, null);
    p = M.step(p);
    assert.equal(p.open.wrote, h + 1);
    order.push(M.pathOf(2).filter((k) => M.height(k) === h));
  }
  assert.deepEqual(order, [["D2"], ["L1-1"], ["L2-0"], ["DN"], ["OS"]]);
  assert.equal(p.open.beat, 0, "beat 0 is done when the objset is written");
  assert.equal(M.newestOnDisk(p).txg, 4210, "no uberblock points to the new tree yet");
  // A cut halfway up: the blocks written so far are lost, the old tree wins.
  let q = M.writeLeaf(M.createPool(), 2).pool;
  for (let i = 0; i < 3; i++) q = M.step(q);
  assert.equal(M.canWrite(q), "syncing");
  assert.equal(M.canSetConfig(q), "cfgLocked");
  const cut = M.pullPlug(q);
  assert.equal(cut.cut.during, 0);
  const r = M.importPool(cut);
  assert.deepEqual([r.result.winner.txg, r.result.tree], [4210, "old"]);
  assert.equal(r.pool.blocks["D2@4211"], undefined);
});
const afterCut = (beatsDone, landed = 0, dirty = true) => M.importPool(M.pullPlug(atBeat(beatsDone, dirty), landed)).result;

test("the four beats: even labels, uberblocks in slot txg % 128 of all four labels, odd labels", () => {
  let p = atBeat(0);
  assert.equal(p.open.beat, 0);
  p = M.step(p); // flush
  assert.deepEqual(p.labels.map((l) => l.config), [4200, 4200, 4200, 4200]);
  p = M.step(p); // even labels
  assert.deepEqual(p.labels.map((l) => l.config), [4211, 4200, 4211, 4200]);
  assert.equal(M.newestOnDisk(p).txg, 4210);
  p = M.step(p); // uberblocks
  assert.deepEqual(p.labels.map((l) => l.ring[115].txg), [4211, 4211, 4211, 4211]);
  assert.deepEqual(p.labels.map((l) => l.ring[114].txg), [4210, 4210, 4210, 4210], "the previous uberblock is not touched");
  assert.equal(M.newestOnDisk(p).root, "OS@4211", "the root arrow swings at beat 3");
  p = M.step(p); // odd labels
  assert.deepEqual(p.labels.map((l) => l.config), [4211, 4211, 4211, 4211]);
  assert.equal(M.canStep(p), "nothingToSync");
  // The next txg goes to the next slot.
  p = writeAll(M.writeLeaf(p, 0).pool);
  assert.equal(p.open.txg, 4212);
  for (let i = 0; i < 3; i++) p = M.step(p);
  assert.equal(p.labels[0].ring[116].txg, 4212);
});

test("the plug pulled at each beat: the winner and the config label", () => {
  // During beat 1 (flush): old tree, config L0.
  let r = afterCut(0);
  assert.deepEqual([r.winner.txg, r.slot, r.configLabel, r.tree], [4210, 114, 0, "old"]);
  // During beat 2: L0 at 4211 passed over, L2 torn, L1 chosen.
  r = afterCut(1);
  assert.deepEqual([r.winner.txg, r.configLabel, r.tree], [4210, 1, "old"]);
  assert.deepEqual(r.labelReads.map((x) => x.verdict), ["tooNew", "chosen", "torn", "equal"]);
  // During beat 3, none landed (L0 torn): case (1).
  r = afterCut(2, 0);
  assert.deepEqual([r.winner.txg, r.slot, r.configLabel, r.tree, r.landedCopies], [4210, 114, 1, "old", 0]);
  assert.deepEqual(r.tornSlots.map((s) => [s.label, s.slot]), [[0, 115]]);
  assert.deepEqual(r.foundIn, [0, 1, 2, 3]);
  // During beat 3, one landed (L1 torn): case (2).
  r = afterCut(2, 1);
  assert.deepEqual([r.winner.txg, r.slot, r.configLabel, r.tree, r.landedCopies], [4211, 115, 0, "new", 1]);
  assert.deepEqual(r.foundIn, [0]);
  for (const n of [2, 3]) assert.deepEqual([afterCut(2, n).winner.txg, afterCut(2, n).tree], [4211, "new"]);
  // During beat 4: L1 at 4211, L3 torn; config L0.
  r = afterCut(3);
  assert.deepEqual([r.winner.txg, r.configLabel, r.tree], [4211, 0, "new"]);
  assert.deepEqual(r.foundIn, [0, 1, 2, 3]);
  // After beat 4.
  r = afterCut(4);
  assert.deepEqual([r.winner.txg, r.configLabel], [4211, 0]);
  // Before spa_sync wrote anything.
  const open = M.importPool(M.pullPlug(M.writeLeaf(M.createPool(), 1).pool)).result;
  assert.deepEqual([open.winner.txg, open.tree], [4210, "old"]);
});

test("config not changed: beats 2 and 4 write nothing, the labels stay at 4200", () => {
  const p = atBeat(4, false);
  assert.deepEqual(p.labels.map((l) => l.config), [4200, 4200, 4200, 4200]);
  for (const [beats, landed, txg] of [[1, 0, 4210], [2, 0, 4210], [2, 1, 4211], [3, 0, 4211]]) {
    const r = afterCut(beats, landed, false);
    assert.deepEqual([r.winner.txg, r.configLabel], [txg, 0], `beats ${beats} landed ${landed}`);
  }
});

test("after the import: the old tree wins and the next txg reuses the same slot", () => {
  const cut = M.pullPlug(atBeat(2), 0);
  const { pool } = M.importPool(cut);
  assert.equal(pool.synced, 4210);
  assert.equal(pool.version.OS, "OS@4210");
  assert.equal(pool.blocks["D2@4211"], undefined, "the new blocks are reachable from nothing");
  assert.equal(pool.labels[0].ring[115].torn, true, "the torn slot stays garbage until rewritten");
  let p = writeAll(M.writeLeaf(pool, 2).pool);
  assert.equal(p.open.txg, 4211);
  for (let i = 0; i < 3; i++) p = M.step(p);
  assert.equal(p.labels[0].ring[115].torn, undefined);
  assert.equal(p.labels[0].ring[115].txg, 4211);
  // The new tree wins: the pool goes on from 4211.
  const won = M.importPool(M.pullPlug(atBeat(2), 1)).pool;
  assert.equal(won.version.OS, "OS@4211");
  assert.equal(M.writeLeaf(won, 0).pool.open.txg, 4212);
});

test("vdev_uberblock_compare: txg first, then timestamp", () => {
  assert.equal(M.compareUb({ txg: 5, timestamp: 1 }, { txg: 4, timestamp: 9 }), 1);
  assert.equal(M.compareUb({ txg: 5, timestamp: 1000 }, { txg: 5, timestamp: 1001 }), -1);
  assert.equal(M.compareUb({ txg: 5, timestamp: 1 }, { txg: 5, timestamp: 1 }), 0);
});

test("refusals: no write while a txg syncs, no step without a write, nothing after the cut", () => {
  const p0 = M.createPool();
  assert.equal(M.canStep(p0), "nothingToSync");
  assert.equal(M.canImport(p0), "notCut");
  const p1 = M.step(M.writeLeaf(p0, 1).pool);
  assert.equal(M.canWrite(p1), "syncing");
  const c = M.pullPlug(p1);
  assert.equal(M.canWrite(c), "cut");
  assert.equal(M.canStep(c), "cut");
  assert.equal(M.canImport(c), null);
});

test("an import marks every vdev dirty: the next txg rewrites the four labels, torn ones included", () => {
  // Cut during beat 2 (L2 torn), import, then a txg with the switch off before the cut.
  let p = { ...M.createPool(), configDirty: false };
  p = M.writeLeaf(p, 2).pool;
  p = writeAll({ ...p, configDirty: true });
  p = M.step(p);
  const { pool } = M.importPool(M.pullPlug(p));
  assert.equal(pool.configDirty, true);
  assert.equal(M.canSetConfig(pool), "cfgForced");
  let q = writeAll(M.writeLeaf(pool, 1).pool);
  for (let i = 0; i < 4; i++) q = M.step(q);
  assert.deepEqual(q.labels.map((l) => [l.config, l.configTorn]), [[4211, false], [4211, false], [4211, false], [4211, false]]);
  assert.equal(M.canSetConfig(q), null, "free again after that commit");
  assert.equal(M.canSetConfig(M.step(M.writeLeaf(q, 0).pool)), "cfgLocked");
});
