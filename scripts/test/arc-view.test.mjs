// Tests for what the ARC room's figure outlines and says after a read
// (src/lib/arc-view.ts, DECISIONS.md D25.1): marks() outlines the block read
// and the blocks it pushed out, the last event on a block winning; narrate()
// names the block read and each block pushed out, with no markup; queueLine()
// says what Next read reads. The words themselves live in ArcLab.astro and are
// checked in the page by scripts/verify-arc.mjs. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// arc-view.ts imports "./arc" as Astro's bundler does, without the extension;
// Node's loader needs it.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const { marks, narrate, queueLine } = await import("../../src/lib/arc-view.ts");
const A = await import("../../src/lib/arc.ts");

// Each string is its own key followed by its placeholders, so a test can read which was used.
const S = new Proxy({ lang: "en", percent: "{n}%" }, { get: (t, k) => (k in t ? t[k] : `[${String(k)} {id} {ghost} {before} {after} {dt} {i} {total}]`) });

/** The opening state, then the scan of the room, one block per read, 1 ms apart. */
function scanned() {
  const s = A.opening();
  const ids = A.next(s, "S", 12);
  const reads = ids.map((id, i) => {
    s.now += i ? 1 : 1000;
    return A.read(s, id);
  });
  return { s, reads };
}

test("a read outlines the block read and what it pushed out", () => {
  const { reads } = scanned();
  assert.deepEqual(marks(reads[0]), { hit: ["S1"], out: [], balance: false });
  // S11 is the first read over the cache's 16 blocks: S1 goes to the MRU ghost list.
  assert.deepEqual(marks(reads[10]), { hit: ["S11"], out: ["S1"], balance: false });
  assert.deepEqual(marks(reads[11]), { hit: ["S12"], out: ["S2"], balance: false });
});

test("a ghost hit outlines the balance when arc_pd moves", () => {
  const { s } = scanned();
  s.now += 1000;
  const m = marks(A.read(s, "S2"));
  assert.deepEqual(m, { hit: ["S2"], out: ["S3"], balance: true });
});

test("the last event on a block wins: read, then pushed out in the same batch", () => {
  const { reads } = scanned();
  // Read the rest after the scan's first block: S2 is read, then pushed out by S12.
  const m = marks(reads.slice(1).flat());
  assert.ok(m.out.includes("S2") && m.out.includes("S1"));
  assert.ok(!m.hit.includes("S2") && !m.hit.includes("S1"));
  assert.ok(m.hit.includes("S12"));
});

test("the narration names the block read and each block pushed out, plain", () => {
  const { reads } = scanned();
  const n = narrate(S, reads[10]);
  assert.match(n, /^\[nNew S11 /);
  assert.match(n, /\[nOutMru S1 /);
  assert.doesNotMatch(n, /<|>/);
  const { s } = scanned();
  s.now += 1000;
  const g = narrate(S, A.read(s, "S2"));
  assert.match(g, /\[nGhostMru S2 /);
  assert.match(g, /\[nShare .*50% 53\.1%/s);
  assert.match(g, /\[nOutMru S3 /);
});

test("the queue line says what Next read reads", () => {
  assert.match(queueLine(S, [], null, 0, "N3"), /^\[qNew N3 /);
  assert.match(queueLine(S, ["S2", "S3"], "scan", 12, "N1"), /^\[qScan S2 .* 11 12\]$/);
  assert.match(queueLine(S, ["H6"], "hot", 6, "N1"), /^\[qHot H6 .* 6 6\]$/);
});
