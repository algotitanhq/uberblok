// Tests for the words and drawing of the tree and the uberblock room
// (src/lib/tree-view.ts with src/lib/tree-strings.ts): EN, FR and ES have the
// same keys and placeholders; every state of the figure is drawn in all three
// languages with no placeholder left unfilled; counts are singular for 1 in
// English and Spanish and for 0 and 1 in French (DECISIONS.md D7.4); no elision before a
// code name and no space after an apostrophe in French; the drawing agrees
// with the model.
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
const V = await import("../../src/lib/tree-view.ts");
const M = await import("../../src/lib/tree.ts");
const { TREE_STRINGS } = await import("../../src/lib/tree-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(TREE_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  refs: new Proxy({}, { get: () => "#" }),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("EN, FR and ES have the same keys and the same placeholders", () => {
  const en = TREE_STRINGS.en;
  for (const lang of ["fr", "es"]) {
    const f = TREE_STRINGS[lang];
    assert.deepEqual(Object.keys(f), Object.keys(en), lang);
    for (const k of Object.keys(en)) assert.deepEqual(holes(f[k]), holes(en[k]), `${lang}: ${k}`);
  }
});

test("no elision before a code name, no space after an apostrophe, in French", () => {
  for (const [k, v] of Object.entries(TREE_STRINGS.fr)) {
    assert.doesNotMatch(v, /[dlj]’<code>/i, k);
    assert.doesNotMatch(v, /’ /, `${k}: no space after an apostrophe`);
  }
});

/** spa_sync writes the open txg's blocks, one height per step: beat 0 done. */
const writeAll = (p) => {
  while (p.open.beat === null) p = M.step(p);
  return p;
};

/** Every state the figure reaches: each step, each cut, each import, config on and off. */
function states() {
  const out = [];
  for (const dirty of [true, false]) {
    let p = { ...M.createPool(), configDirty: dirty };
    p = M.writeLeaf(p, 2).pool;
    out.push({ p });
    out.push({ p: M.writeLeaf(p, 3).pool, write: [3, M.writeLeaf(p, 3).rewritten] });
    // Each height spa_sync writes, then the four beats; a cut before each step.
    for (let k = 0; k < M.HEIGHTS + 4; k++) {
      const beat = p.open.beat === 2 ? 2 : -1;
      const cutAt = M.pullPlug(p, beat === 2 ? 1 : 0);
      out.push({ p: cutAt, cut: true });
      const imp = M.importPool(cutAt);
      out.push({ p: imp.pool, last: imp.result });
      for (const landed of [0, 1, 2, 3]) {
        if (beat !== 2) break;
        const c = M.pullPlug(p, landed);
        out.push({ p: c, cut: true }, { p: M.importPool(c).pool, last: M.importPool(c).result });
      }
      p = M.step(p);
      out.push({ p, stepped: true });
    }
    out.push({ p: M.writeLeaf(p, 0).pool });
  }
  const idle = M.pullPlug(M.createPool());
  out.push({ p: idle, cut: true }, { p: M.importPool(idle).pool, last: M.importPool(idle).result });
  const open = M.pullPlug(M.writeLeaf(M.createPool(), 1).pool);
  out.push({ p: open, cut: true }, { p: M.importPool(open).pool, last: M.importPool(open).result });
  return out;
}

test("every state is drawn in every language with no placeholder left", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const st of states()) {
      const { p, last } = st;
      const parts = [V.treeSvg(S, p), V.diskSvg(S, p), V.diskHtml(S, p), V.beatsHtml(S, p), V.importHtml(S, last ?? null), V.describe(S, p, last ?? null)];
      if (st.cut) parts.push(V.plugLine(S, p));
      if (st.stepped) parts.push(V.stepLine(S, p));
      if (last) parts.push(V.importLine(S, last));
      if (st.write) parts.push(V.writeLine(S, p, st.write[0], st.write[1]));
      for (const w of ["cut", "syncing", "nothingToSync", "notCut", "cfgLocked"]) parts.push(V.whyLine(S, p, w));
      for (const h of parts) assert.doesNotMatch(h, /\{\w+\}/, `${lang}: ${h.slice(0, 160)}`);
    }
  }
});

test("counts: singular for 1 in English and Spanish, for 0 and 1 in French", () => {
  const en = strings("en");
  const f = strings("fr");
  assert.equal(V.plural(en, 1, "write1", "writeN"), "1 uberblock write");
  assert.equal(V.plural(en, 0, "write1", "writeN"), "0 uberblock writes");
  assert.equal(V.plural(f, 0, "write1", "writeN"), "0 écriture d’uberblock");
  assert.equal(V.plural(f, 1, "copy1", "copyN"), "1 copie");
  assert.equal(V.plural(f, 2, "copy1", "copyN"), "2 copies");
  assert.equal(V.list(f, ["a", "b", "c"]), "a, b et c");
  const es = strings("es");
  assert.equal(V.plural(es, 0, "write1", "writeN"), "0 escrituras de uberblock");
  assert.equal(V.plural(es, 1, "write1", "writeN"), "1 escritura de uberblock");
  assert.equal(V.plural(es, 2, "copy1", "copyN"), "2 copias");
  assert.equal(V.list(es, ["a", "b", "c"]), "a, b y c");
});

test("the drawing agrees with the model", () => {
  const S = strings("en");
  let p = M.writeLeaf(M.createPool(), 2).pool;
  // Old and new copies side by side; the shared blocks once.
  const svg = V.treeSvg(S, p);
  const blocks = [...svg.matchAll(/data-block="([^"]+)" data-state="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(blocks.filter((b) => b.endsWith(":mem")).map((b) => b.split("@")[0]).sort(), ["D2", "DN", "L1-1", "L2-0", "OS"]);
  assert.deepEqual(blocks.filter((b) => b.endsWith(":old")).map((b) => b.split(":")[0]).sort(), ["D2@4180", "DN@4210", "L1-1@4210", "L2-0@4210", "OS@4210"]);
  assert.deepEqual(blocks.filter((b) => b.endsWith(":live")).map((b) => b.split(":")[0]).sort(), ["D0@4190", "D1@4120", "D3@4210", "L1-0@4190"]);
  assert.match(svg, /data-root="OS@4210"/);
  // Nothing written yet: the new copies' pointers to each other are not filled in.
  assert.deepEqual([...svg.matchAll(/class="edge e-wait" data-edge="([^"]+)"/g)].map((m) => m[1]), ["OS@4211>DN@4211", "DN@4211>L2-0@4211", "L2-0@4211>L1-1@4211", "L1-1@4211>D2@4211"]);
  // Two heights written: D2 and L1 #1 are on the disk, L2 #0 holds the new pointer to L1 #1.
  let h2 = M.step(M.step(p));
  const svg2 = V.treeSvg(S, h2);
  const st2 = Object.fromEntries([...svg2.matchAll(/data-block="([^"]+)" data-state="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(["D2", "L1-1", "L2-0", "DN", "OS"].map((k) => st2[`${k}@4211`]), ["unflushed", "unflushed", "mem", "mem", "mem"]);
  assert.match(svg2, /class="edge e-mem" data-edge="L2-0@4211>L1-1@4211"/);
  assert.match(svg2, /class="edge e-wait" data-edge="DN@4211>L2-0@4211"/);
  assert.equal(text(V.stepLine(S, h2)), "L1 #1 is written to a new place. Its new address and checksum are now in L2 #0, which the next step writes. code");
  assert.match(text(V.beatsHtml(S, h2)), /from the data up: 2 of 5 levels written/);
  h2 = M.step(M.step(M.step(h2)));
  assert.match(text(V.stepLine(S, h2)), /^The objset is written: the 5 blocks of txg 4211 are on the disk, not flushed yet\./);
  // Both data blocks in one step when two leaves share the txg.
  const two = M.step(M.writeLeaf(M.writeLeaf(M.createPool(), 0).pool, 3).pool);
  assert.equal(text(V.stepLine(S, two)), "D0 and D3 are written, each to a new place. Their new addresses and checksums are now in L1 #0 and L1 #1, which the next step writes. code");
  p = writeAll(p);
  for (let i = 0; i < 3; i++) p = M.step(p);
  assert.match(V.treeSvg(S, p), /data-root="OS@4211"/);
  assert.match(V.diskSvg(S, p), /L0 txg 4211, L1 txg 4211, L2 txg 4211, L3 txg 4211/);
  // The announcement of a write names the copies; of beat 3, the slot.
  const w = M.writeLeaf(M.createPool(), 2);
  assert.equal(text(V.writeLine(S, w.pool, 2, w.rewritten)), "D2 written in txg 4211: new copies of D2, L1 #1, L2 #0, dnodes and objset. The old tree is intact. code");
  let q = writeAll(w.pool);
  for (let i = 0; i < 3; i++) q = M.step(q);
  assert.match(text(V.stepLine(S, q)), /^Beat 3: the uberblock of txg 4211 is in slot 115 of the four labels\./);
  // A cut in beat 3 with nothing landed, then the import: case (1), config from L1.
  const c = M.pullPlug(M.step(M.step(writeAll(w.pool))), 0);
  assert.match(text(V.plugLine(S, c)), /during beat 3: 0 uberblock writes before the cut, the one to L0 torn/);
  const r = M.importPool(c).result;
  const h = text(V.importHtml(S, r));
  assert.match(h, /Torn, so skipped: slot 115 of L0\./);
  assert.match(h, /Winner: txg 4210, slot 114, found in L0, L1, L2 and L3\./);
  assert.match(h, /Config: label L1, txg 4200/);
  assert.match(h, /L0 passed over: its config of txg 4211 is newer than the uberblock\./);
  assert.match(h, /Case \(1\)/);
  // The disk table: label offsets of a 1 GiB disk.
  const tbl = text(V.diskHtml(S, M.createPool()));
  for (const x of ["0 MiB", "0.25 MiB", "1023.5 MiB", "1023.75 MiB"]) assert.ok(tbl.includes(x), x);
  assert.match(text(V.diskHtml(strings("fr"), M.createPool())), /1023,75 Mio/);
  assert.match(text(V.diskHtml(strings("es"), M.createPool())), /1023,75 MiB/);
});

test("the import's reason says which labels a cut txg wrote, and none when the config did not change", () => {
  const S = strings("en");
  const cutAt = (beats, landed, dirty) => {
    let p = { ...M.createPool(), configDirty: dirty };
    p = writeAll(M.writeLeaf(p, 2).pool);
    for (let i = 0; i < beats; i++) p = M.step(p);
    return M.importPool(M.pullPlug(p, landed)).result;
  };
  assert.match(text(V.importVerdict(S, cutAt(2, 1, true))), /even labels, written at beat 2, are valid/);
  assert.match(text(V.importVerdict(S, cutAt(2, 1, false))), /no label was written in this txg/);
  assert.match(text(V.importVerdict(S, cutAt(3, 0, true))), /the new uberblock and the even labels suffice/);
  assert.match(text(V.importVerdict(S, cutAt(3, 0, false))), /the new uberblock suffices; no label was written/);
  assert.match(text(V.importVerdict(S, cutAt(1, 0, false))), /Beat 2 had nothing to write/);
  const open = M.importPool(M.pullPlug(M.writeLeaf(M.createPool(), 1).pool)).result;
  assert.match(text(V.importVerdict(S, open)), /^The pool opens on the old tree, txg 4210\. Txg 4211 was still in memory: nothing of it was on the disk\./);
});
