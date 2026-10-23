// Tests for the words and drawing of the vdevs room (src/lib/vdevs-view.ts
// with src/lib/vdevs-strings.ts): EN, FR and ES have the same keys and
// placeholders; every state of the figure is drawn in every language with no
// placeholder left unfilled; counts are singular for 1 in English and Spanish
// and for 0 and 1 in French (DECISIONS.md D7.4); no elision before a code name
// in French; the drawing agrees with the model.
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
const V = await import("../../src/lib/vdevs-view.ts");
const M = await import("../../src/lib/vdevs.ts");
const { VDEVS_STRINGS } = await import("../../src/lib/vdevs-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(VDEVS_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  refs: new Proxy({}, { get: () => "#" }),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("EN, FR and ES have the same keys and the same placeholders", () => {
  const en = VDEVS_STRINGS.en;
  for (const lang of ["fr", "es"]) {
    const other = VDEVS_STRINGS[lang];
    assert.deepEqual(Object.keys(other), Object.keys(en), lang);
    for (const k of Object.keys(en)) assert.deepEqual(holes(other[k]), holes(en[k]), `${lang}: ${k}`);
  }
});

test("no elision before a code name in French", () => {
  for (const [k, v] of Object.entries(VDEVS_STRINGS.fr)) {
    assert.doesNotMatch(v, /[dlj]’<code>/i, k);
    assert.doesNotMatch(v, /’ /, `${k}: no space after an apostrophe`);
  }
});

/** Every state the figure can reach in a few steps. */
function states() {
  const out = [];
  for (const o of [
    M.DEFAULT_OPTIONS,
    { log: false, special: false, dedup: false, smallblk: 0, specialFill: "low" },
    { log: false, special: true, dedup: true, smallblk: 16384, specialFill: "over75" },
    { log: true, special: true, dedup: false, smallblk: 16384, specialFill: "full" },
  ]) {
    let p = M.createPool(o);
    for (const k of M.KINDS) {
      const r = M.writeBlock(p, k);
      p = r.pool;
      out.push({ p, io: { block: r.block, trace: r.trace, type: "write" } });
      out.push({ p, io: { block: r.block, trace: M.ioTrace(p, r.block, "read"), type: "read" } });
    }
    for (const [disk, by] of [["sdd", "new"], ["sda", "spare"], ["sdf", "dspare"]]) {
      const r = M.replace(p, disk, by);
      const w = M.writeBlock(r.pool, "large");
      out.push({ p: w.pool, io: { block: w.block, trace: w.trace, type: "write" }, node: r.node });
      const done = M.resilverDone(w.pool);
      out.push({ p: done.pool, io: null });
    }
  }
  return out;
}

test("every state is drawn in every language with no placeholder left", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const { p, io, node } of states()) {
      const parts = [
        V.treeSvg(S, p, io?.trace ?? null, node ?? "sdd"), V.lastHtml(S, p, io), V.classesHtml(S, p), V.auxHtml(S, p),
        V.nodeOptions(S, p, "root"), V.describe(S, p, io), V.poolLine(S, p),
        ...Object.keys(p.vdevs).map((id) => V.opsHtml(S, p, id)),
      ];
      if (io?.type === "write") parts.push(V.dropLine(S, p, io.block, io.trace));
      if (io?.type === "read") parts.push(V.readLine(S, p, io.block, io.trace));
      for (const h of parts) assert.doesNotMatch(h, /\{\w+\}/, `${lang}: ${h.slice(0, 120)}`);
    }
  }
});

test("counts: singular for 1 in English and Spanish, for 0 and 1 in French", () => {
  const en = strings("en");
  const f = strings("fr");
  assert.equal(V.plural(en, 1, "disk1", "diskN"), "1 disk");
  assert.equal(V.plural(en, 0, "disk1", "diskN"), "0 disks");
  assert.equal(V.plural(f, 0, "disk1", "diskN"), "0 disque");
  assert.equal(V.plural(f, 1, "sector1", "sectorN"), "1 secteur");
  assert.equal(V.plural(f, 2, "sector1", "sectorN"), "2 secteurs");
  assert.equal(V.list(f, ["a", "b", "c"]), "a, b et c");
  const es = strings("es");
  assert.equal(V.plural(es, 0, "disk1", "diskN"), "0 discos");
  assert.equal(V.plural(es, 1, "disk1", "diskN"), "1 disco");
  assert.equal(V.plural(es, 2, "disk1", "diskN"), "2 discos");
  assert.equal(V.plural(es, 1, "sector1", "sectorN"), "1 sector");
  assert.equal(V.plural(es, 0, "sector1", "sectorN"), "0 sectores");
  assert.equal(V.plural(es, 3, "child1", "childN"), "3 hijos");
  assert.equal(V.list(es, ["a", "b", "c"]), "a, b y c");
});

test("the drawing agrees with the model", () => {
  const S = strings("en");
  let p = M.createPool(M.DEFAULT_OPTIONS);
  const r = M.writeBlock(p, "meta");
  p = r.pool;
  const svg = V.treeSvg(S, p, r.trace, "sdd");
  // Every vdev the I/O reaches is lit, and nothing else.
  const lit = [...svg.matchAll(/<g class="n [^"]*\bon\b[^"]*" data-node="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(lit, [...new Set(M.reached(r.trace).slice(1))].sort());
  // The walk lists every leaf written, with its io_start.
  const walk = V.walkHtml(S, p, r.block, r.trace, "write");
  for (const leaf of M.leavesOf(r.trace)) assert.match(walk, new RegExp(`<code>${leaf}</code>`));
  assert.match(walk, /vdev_disk_io_start/);
  // The announcement names the class, the DVAs and the disks.
  assert.equal(text(V.dropLine(S, p, r.block, r.trace)), "A metadata block (dnode) goes to the special class: 2 copies on mirror-4, written to 2 disks.");
  // The ops panel of a replacing node shows the mirror's functions.
  const rep = M.replace(p, "sdd", "new");
  const ops = V.opsHtml(S, rep.pool, rep.node);
  assert.match(ops, /&amp;vdev_replacing_ops|&vdev_replacing_ops/);
  assert.match(ops, /vdev_mirror_io_start/);
  // A read back, in French.
  const fr = strings("fr");
  assert.equal(text(V.readLine(fr, p, r.block, M.ioTrace(p, r.block, "read"))), "Relu : DVA 0 sur mirror-4, depuis sdm.");
  // And in Spanish.
  const es = strings("es");
  assert.equal(text(V.readLine(es, p, r.block, M.ioTrace(p, r.block, "read"))), "Releído: DVA 0 en mirror-4, desde sdm.");
  assert.equal(text(V.dropLine(es, p, r.block, r.trace)), "Un bloque de metadatos (dnode) va a la clase special: 2 copias en mirror-4, escrito en 2 discos.");
  // A read of a block with one DVA says so, and one with two picks one.
  const big = M.writeBlock(p, "large");
  const head = (S, b, pool) => text(V.walkHtml(S, pool, b.block, M.ioTrace(pool, b.block, "read"), "read").match(/<p class="walk-head">(.*?)<\/p>/)[1]);
  assert.match(head(S, big, big.pool), /A read of the only copy:/);
  assert.match(head(fr, big, big.pool), /Une lecture de la seule copie\s:/);
  assert.match(head(es, big, big.pool), /Una lectura de la única copia:/);
  assert.match(head(S, r, p), /needs only one of the 2 copies:/);
});

test("the last block's vdevs and class are marked, and the figure carries no code link", () => {
  const S = { ...strings("en"), refs: {} };
  const r = M.writeBlock(M.createPool(M.DEFAULT_OPTIONS), "meta");
  const svg = V.treeSvg(S, r.pool, r.trace, "sdd", V.topsOf(r.block));
  const hit = [...svg.matchAll(/<g class="n [^"]*\bhit\b[^"]*" data-node="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hit.map((id) => r.pool.vdevs[id].name), ["mirror-4"]);
  assert.match(svg, /<g class="landed last">/);
  const cls = V.classesHtml(S, r.pool, r.block.cls);
  assert.deepEqual([...cls.matchAll(/<tr class="cl-(\w+)[^"]*\bhit\b/g)].map((m) => m[1]), ["special"]);
  // Nothing is marked before a write.
  assert.doesNotMatch(V.treeSvg(S, r.pool, null, "sdd"), /\bhit\b|landed last/);
  // The key lists every look from the start.
  assert.equal((V.legendHtml(S).match(/<li>/g) ?? []).length, 6);
  // With no refs (the component passes none, D26.1), no line carries a link.
  const html = V.lastHtml(S, r.pool, { block: r.block, trace: r.trace, type: "write" }) + V.auxHtml(S, r.pool) + V.opsHtml(S, r.pool, "sdd");
  assert.doesNotMatch(html, /<a /);
});
