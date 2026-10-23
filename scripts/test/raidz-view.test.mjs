// Tests for the read steps of the RAID-Z figure (src/lib/raidz-view.ts): the
// first step says what each damaged child holds of the block, so a read that
// rebuilds nothing still says why (design review of ALG-187). Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// raidz-view.ts imports "./raidz" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const { holds, roles, readPlan } = await import("../../src/lib/raidz-view.ts");
const { mapAlloc, readBlock } = await import("../../src/lib/raidz.ts");

// Only the keys these tests read; every other key fills as its own name.
const S = new Proxy(
  {
    childN: "child {d}",
    holdsData: "Child {d} holds {cols} of block {name}.",
    holdsParity: "Child {d} holds only parity of block {name} ({cols}).",
    holdsSkip: "Child {d} holds only a skip sector of block {name}.",
    holdsNone: "Child {d} holds nothing of block {name}.",
    roles: "Block {name}: data on {data}; parity on {parity}.",
    oneChild: "child {list}",
    manyChildren: "children {list}",
  },
  { get: (o, k) => (k in o ? o[k] : String(k)) },
);
const K = 1024;

test("raidz2, 6 children, 24K: P and Q on children 0 and 1, data on 2 to 5", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  assert.equal(roles(L, S, "A"), "Block A: data on children 2, 3, 4, 5; parity on children 0, 1.");
  assert.equal(holds(L, S, 0, "A"), "Child 0 holds only parity of block A (P).");
  assert.match(holds(L, S, 2, "A"), /^Child 2 holds D0 of block A\.$/);
});

test("a narrow block: a child with a skip sector only, and a child with nothing", () => {
  // raidz1 on 5 children, 8K at 4K sectors: P:0 D0:1 D1:2, a skip on 3, nothing on 4.
  const L = mapAlloc(8 * K, 12, 5, 1);
  assert.equal(holds(L, S, 3, "D"), "Child 3 holds only a skip sector of block D.");
  assert.equal(holds(L, S, 4, "D"), "Child 4 holds nothing of block D.");
  assert.equal(roles(L, S, "D"), "Block D: data on children 1, 2; parity on child 0.");
});

test("the first step of a damaged read names what each damaged child holds", () => {
  const L = mapAlloc(24 * K, 12, 6, 2);
  const health = ["missing", "ok", "ok", "ok", "ok", "corrupt"];
  const plan = readPlan(L, readBlock(L, health), S, health, "A");
  assert.equal(plan[0].html, `Child 0 holds only parity of block A (P). ${holds(L, S, 5, "A")}`);
  const healthy = readPlan(L, readBlock(L, Array(6).fill("ok")), S, Array(6).fill("ok"), "A");
  assert.ok(!healthy[0].html.includes("holds"), "no holds line when nothing is damaged");
});
