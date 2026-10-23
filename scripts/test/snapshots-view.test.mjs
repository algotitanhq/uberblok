// Tests for the figure of the Snapshots and clones room (src/lib/snapshots-view.ts):
// the ring marks only the blocks the last sync touched and does not outlive the
// call, the hatching marks the blocks kept only for snapshots, and the line under
// the controls names what a sync freed and kept (D28.1). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// snapshots-view.ts imports "./snapshots" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const { board, didLine, touched, describe } = await import("../../src/lib/snapshots-view.ts");
const { opening, ask, change, sync, SLOTS } = await import("../../src/lib/snapshots.ts");

// Every key fills as its own name, with its placeholders kept, so the tests read the structure.
const S = new Proxy({ and: "and", dSynced: "Txg {txg} is synced.", dFreed: "Freed: {list}.", dFreed1: "Freed: {list}.", dKept: "Kept: {list}.", dKept1: "Kept: {list}.", dDestroy: "{snap} is gone.", onlyHolds: "frees ({n}):", onlyNone: "frees nothing" }, { get: (t, k) => (k in t ? t[k] : String(k)) });
const name = (s, id) => `${s.blocks[id].slot < 0 ? "R" : SLOTS[s.blocks[id].slot]}${s.blocks[id].birth}`;
const chipsWith = (html, cls) => [...html.matchAll(/<(?:button|span) type="button" class="chip([^"]*)" data-b="(\d+)"|<span class="chip([^"]*)" data-b="(\d+)"/g)]
  .filter((m) => (m[1] ?? m[3]).split(" ").includes(cls))
  .map((m) => Number(m[2] ?? m[4]));

test("the ring goes on the touched blocks only, and the next board has none", () => {
  const s = opening();
  change(s, "fs", 1, "write");
  const ev = sync(s);
  const last = touched(ev);
  const freed = ev.flatMap((e) => (e.k === "kill" && e.freed ? [e.block] : []));
  const ringed = new Set(chipsWith(board(s, S, true, freed, last), "hit"));
  assert.deepEqual([...ringed].sort(), [...last].sort());
  assert.deepEqual(chipsWith(board(s, S, true), "hit"), []);
});

test("the opening hatches A8 and R8, kept only for fs@s1, and says destroying it frees them", () => {
  const s = opening();
  const html = board(s, S, false);
  const pins = new Set(chipsWith(html, "pin").map((id) => name(s, id)));
  assert.deepEqual([...pins].sort(), ["A8", "R8"]);
  assert.match(html, /frees \(2\):/);
  assert.match(describe(s, S), /frees \(2\):/);
});

test("the line under the controls names what a destroy freed", () => {
  const s = opening();
  ask(s, { kind: "destroy", snap: "s1" });
  const ev = sync(s);
  const line = didLine(s, S, ev).replace(/<[^>]+>/g, "");
  assert.equal(line, "Txg 11 is synced. fs@s1 is gone. Freed: A8 and R8.");
});
