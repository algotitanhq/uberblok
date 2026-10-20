// Tests for the model of the Snapshots and clones room (src/lib/snapshots.ts,
// loaded with Node's type stripping). First the sequence worked by hand in
// ANALYSIS.md ("Hand-checked sequence"), through dsl_dataset_block_kill
// (dsl_dataset.c L294), dsl_deadlist_insert (dsl_deadlist.c L487-L501), the
// snapshot hand-off (dsl_dataset.c L1830-L1839, L1883), clone creation
// (L1213-L1251) and snapshot destroy (dsl_destroy.c L387-L479) at zfs-2.4.4;
// then the edge cases; then properties over random sequences, checked against
// the actual references of every dataset's tree. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  create, opening, change, ask, sync, ds, head, snapshots, referencedBy, owners, wouldKill, taskRefusal,
  changeRefusal, dlInsert, tree, SLOTS,
} from "../../src/lib/snapshots.ts";

// A block by slot letter and birth txg, among blocks of a directory.
const find = (s, name, birth, dir = "fs") => {
  const slot = name === "R" ? -1 : SLOTS.indexOf(name);
  const b = s.blocks.find((x) => x.slot === slot && x.birth === birth && x.dir === dir);
  assert.ok(b, `block ${name}${birth} (${dir})`);
  return b.id;
};
const label = (s, id) => {
  const b = s.blocks[id];
  return `${b.slot < 0 ? "R" : SLOTS[b.slot]}${b.birth}${b.dir === "clone" ? "c" : ""}`;
};
const dl = (s, id) => Object.fromEntries(ds(s, id).deadlist.map((e) => [e.key, e.blocks.map((b) => label(s, b)).sort().join(" ")]));
const kills = (ev, s) => ev.filter((e) => e.k === "kill").map((e) => `${label(s, e.block)}:${e.freed ? "free" : `dl${e.key}`}`);

test("a new filesystem: ds_prev_snap_txg 1 ($ORIGIN) and deadlist keys {0}", () => {
  const s = create(8);
  const fs = ds(s, "fs");
  assert.equal(fs.prevSnapTxg, 1);
  assert.deepEqual(fs.deadlist.map((e) => e.key), [0]);
  assert.equal(s.originTxg.fs, 1);
});

test("the hand-checked sequence of ANALYSIS.md, txg by txg", () => {
  const s = create(8);
  // txg 8: write A, B, C. No snapshot yet: the empty root, born 7 > 1, is freed.
  for (const i of [0, 1, 2]) change(s, "fs", i, "write");
  let ev = sync(s);
  assert.deepEqual(kills(ev, s), ["R7:free"]);
  // txg 9: snapshot @s1. Only ds_bp is copied; the head gets keys {0, 1}.
  ask(s, { kind: "snapshot" });
  ev = sync(s);
  const s1 = ds(s, "s1");
  assert.equal(s1.bp, find(s, "R", 8));
  assert.equal(s1.bp, ds(s, "fs").bp);
  assert.equal(s1.creationTxg, 9);
  assert.equal(s1.prevSnapTxg, 1);
  assert.deepEqual(s1.deadlist.map((e) => e.key), [0]);
  assert.deepEqual(ds(s, "fs").deadlist.map((e) => e.key), [0, 1]);
  assert.equal(ds(s, "fs").prevSnapTxg, 9);
  assert.equal(s.blocks.length, 5, "a snapshot writes no block");
  // txg 10: overwrite A. A8 and R8: 8 > 9 is false -> entry 1.
  change(s, "fs", 0, "write");
  ev = sync(s);
  assert.deepEqual(kills(ev, s).sort(), ["A8:dl1", "R8:dl1"]);
  // txg 11: write D and snapshot @s2 in the same txg.
  change(s, "fs", 3, "write");
  ask(s, { kind: "snapshot" });
  ev = sync(s);
  assert.deepEqual(kills(ev, s), ["R10:free"], "10 > 9: R10 is freed");
  const s2 = ds(s, "s2");
  assert.equal(s2.bp, find(s, "R", 11), "the snapshot of txg 11 holds the root born in txg 11");
  assert.ok(tree(s, s2).includes(find(s, "D", 11)), "and D11, born in the same txg");
  assert.deepEqual(dl(s, "s2"), { 0: "", 1: "A8 R8" });
  assert.deepEqual(ds(s, "fs").deadlist.map((e) => e.key), [0, 1, 9]);
  assert.equal(ds(s, "fs").prevSnapTxg, 11);
  assert.equal(ds(s, "s1").nextSnap, "s2");
  assert.equal(s2.nextSnap, "fs");
  // txg 12: overwrite D. D11 and R11: 11 > 11 is false -> entry 9.
  change(s, "fs", 3, "write");
  ev = sync(s);
  assert.deepEqual(kills(ev, s).sort(), ["D11:dl9", "R11:dl9"]);
  const D11 = find(s, "D", 11);
  assert.deepEqual(owners(s, D11), { birth: 11, snaps: ["s2"], heads: [] });
  assert.deepEqual(referencedBy(s, D11), ["s2"]);
  // txg 13: destroy @s1. @s2's entries at or above key 1 are freed: A8, R8.
  ask(s, { kind: "destroy", snap: "s1" });
  ev = sync(s);
  const d = ev.find((e) => e.k === "destroy");
  assert.deepEqual(d.freed.map((b) => label(s, b)).sort(), ["A8", "R8"]);
  assert.deepEqual(dl(s, "s2"), { 0: "" });
  assert.equal(ds(s, "s2").prevSnapTxg, 1);
  assert.equal(ds(s, "s2").prevSnap, "$ORIGIN");
  assert.deepEqual(dl(s, "fs"), { 0: "", 1: "D11 R11" }, "key 9 removed from the head, merged into entry 1");
  assert.deepEqual(d.removedFrom, ["fs"]);
  // txg 14: clone @s2.
  ask(s, { kind: "clone", origin: "s2" });
  sync(s);
  const c = ds(s, "clone");
  assert.equal(c.bp, ds(s, "s2").bp);
  assert.equal(c.prevSnapTxg, 11);
  assert.deepEqual(c.deadlist.map((e) => e.key), [0, 1]);
  assert.equal(ds(s, "s2").numChildren, 2);
  // txg 15: overwrite C in the clone: C8 and R11 go to the clone's entry 1.
  change(s, "clone", 2, "write");
  ev = sync(s);
  assert.deepEqual(kills(ev, s).sort(), ["C8:dl1", "R11:dl1"]);
  assert.ok(!s.blocks[find(s, "C", 8)].freed);
  const C15 = find(s, "C", 15, "clone");
  assert.deepEqual(referencedBy(s, C15), ["clone"]);
  assert.deepEqual(owners(s, C15), { birth: 15, snaps: [], heads: ["clone"] });
  // Destroying the origin of a clone is refused.
  assert.equal(taskRefusal(s, { kind: "destroy", snap: "s2" }), "EEXIST");
});

test("the opening state of the room: txgs 8 to 10", () => {
  const s = opening();
  assert.equal(s.txg, 11);
  assert.deepEqual(dl(s, "fs"), { 0: "", 1: "A8 R8" });
  assert.deepEqual(owners(s, find(s, "A", 8)), { birth: 8, snaps: ["s1"], heads: [] });
  assert.deepEqual(owners(s, find(s, "B", 8)), { birth: 8, snaps: ["s1"], heads: ["fs"] });
  assert.deepEqual(owners(s, find(s, "A", 10)), { birth: 10, snaps: [], heads: ["fs"] });
});

test("a block born in the same txg as a snapshot is held by it: killed later, it goes on the deadlist", () => {
  const s = create(20);
  change(s, "fs", 0, "write");
  ask(s, { kind: "snapshot" });
  sync(s); // txg 20: A20, then @s1 of txg 20
  const A20 = find(s, "A", 20);
  assert.ok(tree(s, ds(s, "s1")).includes(A20));
  assert.deepEqual(wouldKill(s, ds(s, "fs"), A20), { freed: false, key: 1 }, "20 > 20 is false");
  change(s, "fs", 0, "delete");
  const ev = sync(s);
  assert.deepEqual(kills(ev, s).sort(), ["A20:dl1", "R20:dl1"]);
  assert.deepEqual(owners(s, A20).snaps, ["s1"]);
});

test("a block killed in the txg of a snapshot is not in that snapshot: kills run before sync tasks", () => {
  const s = create(30);
  change(s, "fs", 0, "write");
  sync(s); // txg 30: A30
  const A30 = find(s, "A", 30);
  change(s, "fs", 0, "write");
  ask(s, { kind: "snapshot" });
  const ev = sync(s); // txg 31: A30 killed (30 > 1, freed), then @s1
  assert.deepEqual(kills(ev, s).sort(), ["A30:free", "R30:free"]);
  assert.equal(s.blocks[A30].freed, 31);
  assert.ok(!tree(s, ds(s, "s1")).includes(A30));
  assert.ok(tree(s, ds(s, "s1")).includes(find(s, "A", 31)));
});

test("a second snapshot in the same txg is refused (EAGAIN, dsl_dataset.c L1538-L1539)", () => {
  const s = opening();
  ask(s, { kind: "snapshot" });
  assert.equal(taskRefusal(s, { kind: "snapshot" }), "EAGAIN");
});

test("an overwrite inside a clone: shared blocks go to the clone's deadlist, the clone's own are freed", () => {
  const s = opening(); // @s1 of txg 9 holds A8 B8 C8 R8
  ask(s, { kind: "clone", origin: "s1" });
  sync(s); // txg 11
  const c = ds(s, "clone");
  assert.equal(c.prevSnapTxg, 9);
  assert.deepEqual(c.deadlist.map((e) => e.key), [0, 1], "the head's keys below 9: {0, 1}");
  change(s, "clone", 1, "write");
  let ev = sync(s); // txg 12: B8 and R8 killed in the clone, 8 > 9 false
  assert.deepEqual(kills(ev, s).sort(), ["B8:dl1", "R8:dl1"]);
  // The same B8 is still live in fs and held by @s1.
  const B8 = find(s, "B", 8);
  assert.deepEqual(referencedBy(s, B8).sort(), ["fs", "s1"]);
  assert.deepEqual(owners(s, B8), { birth: 8, snaps: ["s1"], heads: ["fs"] });
  // Overwrite again in the clone: B12 was born after the origin, 12 > 9, freed.
  const B12 = find(s, "B", 12, "clone");
  change(s, "clone", 1, "write");
  ev = sync(s);
  assert.deepEqual(kills(ev, s).sort(), ["B12c:free", "R12c:free"]);
  assert.equal(s.blocks[B12].freed, 13);
  // fs is untouched by the clone's writes.
  assert.deepEqual(dl(s, "fs"), { 0: "", 1: "A8 R8" });
});

test("destroying the latest snapshot: the head's entry above the previous snapshot is freed", () => {
  const s = opening();
  // fs deadlist {1: A8, R8}; @s1 prev 1. Destroy @s1: entries >= 1 freed.
  ask(s, { kind: "destroy", snap: "s1" });
  const ev = sync(s);
  const d = ev.find((e) => e.k === "destroy");
  assert.equal(d.next, "fs");
  assert.deepEqual(d.freed.map((b) => label(s, b)).sort(), ["A8", "R8"]);
  assert.deepEqual(d.removedFrom, [], "the head's key is not removed when the next dataset is the head");
  assert.deepEqual(dl(s, "fs"), { 0: "" });
  assert.equal(ds(s, "fs").prevSnapTxg, 1);
  // Now nothing holds B8: killing it frees it.
  assert.deepEqual(wouldKill(s, ds(s, "fs"), find(s, "B", 8)), { freed: true });
});

test("destroying a middle snapshot older than a clone's origin removes its key from the clone", () => {
  const s = opening(); // @s1 (9)
  change(s, "fs", 1, "write");
  sync(s); // txg 11: B8 -> fs entry 1, R10 (10 > 9) freed
  ask(s, { kind: "snapshot" });
  sync(s); // txg 12: @s2; fs keys {0, 1, 9}
  ask(s, { kind: "clone", origin: "s2" });
  sync(s); // txg 13: clone keys below 12: {0, 1, 9}
  assert.deepEqual(ds(s, "clone").deadlist.map((e) => e.key), [0, 1, 9]);
  change(s, "clone", 0, "write");
  sync(s); // txg 14: A10 (born 10 <= 12) -> clone entry 9
  assert.deepEqual(dl(s, "clone"), { 0: "", 1: "", 9: "A10 R11" });
  ask(s, { kind: "destroy", snap: "s1" });
  const ev = sync(s); // txg 15
  const d = ev.find((e) => e.k === "destroy");
  assert.deepEqual(d.removedFrom.sort(), ["clone", "fs"]);
  assert.deepEqual(dl(s, "clone"), { 0: "", 1: "A10 R11" });
  assert.deepEqual(d.freed.map((b) => label(s, b)).sort(), ["A8", "B8", "R8"], "only @s1 held them");
});

test("dsl_deadlist_insert: an exact key takes the entry before it; a birth below every key panics into the first", () => {
  const dl1 = [{ key: 0, blocks: [] }, { key: 5, blocks: [] }, { key: 9, blocks: [] }];
  assert.equal(dlInsert(dl1, { id: 1, birth: 9 }).entry.key, 5);
  assert.equal(dlInsert(dl1, { id: 2, birth: 10 }).entry.key, 9);
  assert.equal(dlInsert(dl1, { id: 3, birth: 6 }).entry.key, 5);
  assert.equal(dlInsert(dl1, { id: 4, birth: 5 }).entry.key, 0);
  const r = dlInsert(dl1, { id: 5, birth: 0 });
  assert.equal(r.panic, true);
  assert.equal(r.entry.key, 0);
});

test("a block cannot change twice in one txg in the figure", () => {
  const s = opening();
  change(s, "fs", 1, "write");
  assert.equal(changeRefusal(s, "fs", 1, "delete"), "pending");
  assert.equal(changeRefusal(s, "fs", 3, "delete"), "empty");
});

// ------------------------------------------------------------ properties

// A small deterministic PRNG, so a failure can be replayed.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) / 2 ** 32);
}

function invariants(s, where) {
  const refs = new Map(s.blocks.map((b) => [b.id, referencedBy(s, b.id)]));
  for (const b of s.blocks) {
    const r = refs.get(b.id);
    if (b.freed !== undefined) assert.deepEqual(r, [], `${where}: ${label(s, b.id)} freed but referenced by ${r}`);
    else assert.ok(r.length > 0, `${where}: ${label(s, b.id)} on disk but referenced by nobody (leak)`);
    if (b.freed === undefined) {
      const o = owners(s, b.id);
      assert.deepEqual([...o.snaps, ...o.heads].sort(), [...r].sort(), `${where}: owners of ${label(s, b.id)}`);
    }
  }
  const onDeadlist = new Set();
  for (const d of s.datasets) {
    const keys = d.deadlist.map((e) => e.key);
    assert.deepEqual(keys, [...keys].sort((a, b) => a - b), `${where}: keys of ${d.id} sorted`);
    assert.equal(keys[0], 0, `${where}: ${d.id} keeps key 0`);
    d.deadlist.forEach((e, i) => {
      const hi = d.deadlist[i + 1]?.key ?? Infinity;
      for (const id of e.blocks) {
        const b = s.blocks[id];
        assert.ok(b.birth > e.key && b.birth <= hi, `${where}: ${label(s, id)} in entry ${e.key} of ${d.id} (next ${hi})`);
        assert.ok(b.birth <= d.prevSnapTxg, `${where}: ${label(s, id)} on ${d.id}'s deadlist, born after its previous snapshot`);
        assert.equal(b.freed, undefined, `${where}: freed block ${label(s, id)} still on a deadlist`);
        // A deadlist holds blocks the previous snapshot references and this dataset does not.
        const r = refs.get(id);
        assert.ok(!r.includes(d.id), `${where}: ${label(s, id)} on the deadlist of ${d.id}, which references it`);
        assert.ok(r.includes(d.prevSnap), `${where}: ${label(s, id)} on ${d.id}'s deadlist, not held by ${d.prevSnap}`);
        assert.ok(!onDeadlist.has(`${d.id}:${id}`));
        onDeadlist.add(`${d.id}:${id}`);
      }
    });
    if (d.snapshot && d.nextSnap) assert.equal(ds(s, d.nextSnap).prevSnap, d.id, `${where}: chain ${d.id} -> ${d.nextSnap}`);
  }
}

test("random sequences: no block freed while referenced, none leaked, owners = references, deadlists well formed", () => {
  let txgs = 0;
  let outcomes = { free: 0, dl: 0, destroy: 0, clone: 0, eexist: 0, sameTxgSnapshotBirth: 0 };
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const s = seed % 2 ? opening() : create(5);
    for (let step = 0; step < 30; step++) {
      // A handful of changes and tasks in the open txg, then sync.
      const n = Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const dir = head(s, "clone") && r() < 0.4 ? "clone" : "fs";
        const slot = Math.floor(r() * 4);
        const c = r() < 0.7 ? "write" : "delete";
        if (!changeRefusal(s, dir, slot, c)) change(s, dir, slot, c);
      }
      const x = r();
      if (x < 0.3) {
        if (!taskRefusal(s, { kind: "snapshot" })) ask(s, { kind: "snapshot" });
      } else if (x < 0.4) {
        const snaps = snapshots(s);
        if (snaps.length) {
          const t = { kind: "clone", origin: snaps[Math.floor(r() * snaps.length)].id };
          if (!taskRefusal(s, t)) ask(s, t);
        }
      } else if (x < 0.55) {
        const snaps = snapshots(s);
        if (snaps.length) {
          const t = { kind: "destroy", snap: snaps[Math.floor(r() * snaps.length)].id };
          const why = taskRefusal(s, t);
          if (why === "EEXIST") outcomes.eexist++;
          if (!why) ask(s, t);
        }
      }
      const pendingWrites = Object.keys(s.pending.changes.fs ?? {}).length > 0;
      const snapNow = s.pending.tasks.some((t) => t.kind === "snapshot");
      const ev = sync(s);
      txgs++;
      if (pendingWrites && snapNow && ev.some((e) => e.k === "snapshot")) outcomes.sameTxgSnapshotBirth++;
      for (const e of ev) {
        if (e.k === "kill") {
          outcomes[e.freed ? "free" : "dl"]++;
          assert.equal(e.freed, e.birth > e.prevSnapTxg, "the one comparison of L294");
          assert.ok(!e.panic, `seed ${seed}: deadlist insert below every key`);
        }
        if (e.k === "destroy") outcomes.destroy++;
        if (e.k === "clone") outcomes.clone++;
        assert.notEqual(e.k, "refused", `seed ${seed}: a task the figure allowed was refused`);
      }
      invariants(s, `seed ${seed} txg ${s.txg - 1}`);
    }
  }
  assert.ok(txgs === 12000);
  for (const [k, v] of Object.entries(outcomes)) assert.ok(v > 20, `${k} exercised (${v})`);
});
