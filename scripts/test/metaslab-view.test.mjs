// Tests for the words of the Metaslabs and space maps room (src/lib/metaslab-view.ts
// with src/lib/metaslab-strings.ts): every count agrees with its number, singular
// for 1 in English and Spanish and for 0 and 1 in French (DECISIONS.md D7.4). Every log line
// is drawn with counts 0, 1 and 2 and read for a noun that disagrees. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// metaslab-view.ts imports "./metaslab" as Astro's bundler does, without the
// extension; Node's loader needs it.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const { eventLine, bits, tape, tapeMeta, summary, describe, changes, entryRange } = await import("../../src/lib/metaslab-view.ts");
const { MS_STRINGS } = await import("../../src/lib/metaslab-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");
const { opening, clone, write, del, sync, load, churn, condenseNow, MIB, MS_START, BLOCK, SM_ALLOC, SM_FREE } = await import("../../src/lib/metaslab.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(MS_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const seg = (i) => [i * 2 * BLOCK, (i * 2 + 1) * BLOCK];
const check = { yes: false, empty: false, object: 96, optimal: 32, t1: 64, t2: 65536, segs: 1 };

/** Every log line, with every count set to n. */
function lines(S, n) {
  const exts = Array.from({ length: 3 + n }, (_, i) => seg(i));
  const evs = [
    { k: "write", id: "C", size: 4 * 1024 * 1024, exts, picks: { cursor: n, size: n, bestfit: 0 }, cursor: 0 },
    { k: "write", id: "C", size: 4 * 1024 * 1024, exts: exts.slice(0, Math.max(n, 1)), picks: { cursor: 32, size: 0, bestfit: 0 }, cursor: 0 },
    { k: "full", size: 160 * 1024 * 1024, free: n },
    { k: "delete", id: "C", exts },
    { k: "rewrite", id: "db", n, txg: 12, freed: [], allocated: [] },
    { k: "append", txg: 12, type: SM_ALLOC, entries: n, words: n, from: 4, two: n, pad: n },
    { k: "append", txg: 12, type: SM_FREE, entries: n, words: n, from: 4, two: 0, pad: 0 },
    { k: "deferBack", txg: 13, freed: 11, bytes: n },
    { k: "defer", txg: 13, bytes: n, back: 15 },
    { k: "synced", txg: 13, length: n, alloc: n },
    { k: "load", entries: n, words: n, segs: n, same: true, deferred: n },
    { k: "load", entries: n, words: n, segs: n, same: false, deferred: n },
    { k: "churn", txgs: n, from: 13, stopped: false, blocks: n },
    { k: "churn", txgs: n, from: 13, stopped: true, blocks: n },
  ];
  return evs.map((e) => text(eventLine(S, e)));
}

// Nouns of the room's counts, singular and plural.
const NOUNS = {
  en: [["byte", "bytes"], ["word", "words"], ["unit", "units"], ["segment", "segments"], ["extent", "extents"], ["entry", "entries"], ["txg", "txgs"], ["block", "blocks"], ["more", "more"], ["padding word", "padding words"]],
  fr: [["octet", "octets"], ["mot", "mots"], ["unité", "unités"], ["segment", "segments"], ["extent", "extents"], ["entrée", "entrées"], ["bloc", "blocs"], ["autre", "autres"], ["mot de remplissage", "mots de remplissage"]],
  es: [["byte", "bytes"], ["palabra", "palabras"], ["unidad", "unidades"], ["segmento", "segmentos"], ["extent", "extents"], ["entrada", "entradas"], ["bloque", "bloques"], ["palabra de relleno", "palabras de relleno"]],
};

for (const lang of ["en", "fr", "es"]) {
  const S = strings(lang);
  const singular = (n) => (lang === "fr" ? n < 2 : n === 1);
  for (const n of [0, 1, 2]) {
    test(`${lang}: every count in the log agrees with ${n}`, () => {
      for (const line of lines(S, n)) {
        for (const [one, many] of NOUNS[lang]) {
          if (one === many) continue;
          const bad = singular(n) ? many : one;
          const re = new RegExp(`(^|[^\\d,.])${n} ${bad}(?![\\p{L}])`, "u");
          assert.doesNotMatch(line, re, line);
        }
      }
    });
  }
}

test("fr: no adjective or participle that has to agree with a count", () => {
  const S = strings("fr");
  for (const n of [0, 1, 2]) {
    for (const line of lines(S, n)) {
      assert.doesNotMatch(line, /\d+ (octets?|entrées?) (libres|rejouées)/, line);
    }
  }
});

test("fr: the regressions QA found on ALG-91", () => {
  const S = strings("fr");
  const all = [0, 1, 2].flatMap((n) => lines(S, n)).join("\n");
  assert.doesNotMatch(all, /et 1 autres/);
  assert.doesNotMatch(all, /1 entrée rejouées/);
  assert.doesNotMatch(all, /0 octet libres/);
  assert.doesNotMatch(all, /2 mot de remplissage/);
  assert.match(all, /2 mots de remplissage/);
  // The text version lists six free segments, then counts the rest.
  const s = opening();
  s.allocatable = Array.from({ length: 7 }, (_, i) => [MS_START + i * 2 * BLOCK, MS_START + (i * 2 + 1) * BLOCK]);
  assert.match(text(describe(s, S)), /et 1 autre\b/);
  assert.doesNotMatch(text(describe(s, S)), /et 1 autres/);
});

test("es: singular for 1 only, plural for 0 and 2", () => {
  const S = strings("es");
  const all = [0, 1, 2].flatMap((n) => lines(S, n)).join("\n");
  assert.match(all, /1 palabra de relleno\b/);
  assert.match(all, /2 palabras de relleno/);
  assert.match(all, /1 entrada\b/);
  assert.match(all, /0 entradas/);
  assert.doesNotMatch(all, /\b0 (byte|palabra|unidad|segmento|entrada|bloque)(?![\p{L}])/u);
});

test("the bit layout of every opening entry, the tape and the summary: no count disagrees", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const s = opening();
    const out = [tapeMeta(s, S), summary(s, S), ...s.tape.map((_, i) => bits(s, S, i))].map(text).join("\n");
    assert.doesNotMatch(out, /0x0 unités/);
    assert.doesNotMatch(out, /(^|[^\d,.])1 (bytes|words|units|segments|entries|blocks)\b/);
    assert.doesNotMatch(out, /(^|[^\d,.])[01] (octets|mots|unités|segments|entrées|blocs)\b/);
    assert.doesNotMatch(out, /(^|[^\d,.])1 (bytes|palabras|unidades|segmentos|entradas|bloques)\b/);
  }
});

test("the rewrite range names its txgs without a count to agree with", () => {
  for (const lang of ["en", "fr", "es"]) {
    const line = text(eventLine(strings(lang), { k: "churn", txgs: 1, from: 13, stopped: true, blocks: 128 }));
    assert.doesNotMatch(line, /txgs 13/, line);
    assert.match(line, { en: /1 txg \(from txg 13 to txg 13\)/, fr: /1 txg \(du txg 13 au txg 13\)/, es: /1 txg \(del txg 13 al txg 13\)/ }[lang], line);
  }
});

test("EN, FR and ES have the same keys and the same placeholders, and no placeholder is left unfilled", () => {
  const ph = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  for (const lang of ["fr", "es"]) {
    assert.deepEqual(Object.keys(MS_STRINGS[lang]), Object.keys(MS_STRINGS.en), lang);
    for (const k of Object.keys(MS_STRINGS.en)) assert.equal(ph(MS_STRINGS[lang][k]), ph(MS_STRINGS.en[k]), `${lang} ${k}`);
  }
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const s = opening();
    const out = [...[0, 1, 2].flatMap((n) => lines(S, n)), tapeMeta(s, S), summary(s, S), ...s.tape.map((_, i) => bits(s, S, i))].map(text);
    for (const o of out) assert.doesNotMatch(o, /\{\w+\}/, o);
  }
});

test("no line of the figure links to the code: the links live in the Source notes (D21.1)", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const s = opening();
    const out = [...[0, 1, 2].flatMap((n) => lines(S, n)), describe(s, S), ...s.tape.map((_, i) => bits(s, S, i))].join("\n");
    assert.doesNotMatch(out, /<a\b|github\.com/);
  }
});

const run = (f) => {
  const s = opening();
  return (g) => {
    f(s);
    const before = clone(s);
    g(s);
    return { s, c: changes(before, s) };
  };
};
const inside = (segs, [a, b]) => segs.some(([x, y]) => x <= a && b <= y);

test("changes: a write outlines its new extent, the free tree, the cursor and the file", () => {
  const { s, c } = run(() => {})((s) => write(s, 4 * MIB));
  assert.deepEqual(c.segs, [[0x42400000, 0x42800000]]);
  assert.deepEqual(c.trees.sort(), ["allocatable", "allocating", "cursor"]);
  assert.deepEqual(c.files, ["C"]);
  assert.equal(c.fresh, null);
  assert.equal(s.files.at(-1).id, "C");
});

test("changes: a delete outlines A; its sync outlines the new words and A, now deferred", () => {
  const A = [0x40000000, 0x42000000];
  const d = run(() => {})((s) => del(s, "A"));
  assert.ok(inside(d.c.segs, A));
  assert.deepEqual(d.c.trees, ["freeing"]);
  assert.deepEqual(d.c.files, ["A"]);
  const y = run((s) => del(s, "A"))((s) => sync(s));
  assert.ok(inside(y.c.segs, A));
  assert.ok(y.c.trees.includes("defer") && y.c.trees.includes("freeing"));
  assert.equal(y.c.fresh, 4);
  assert.equal(y.s.tape.length, 6);
});

test("changes: two syncs later A comes back to the free tree, and only A is outlined", () => {
  const { c } = run((s) => {
    del(s, "A");
    sync(s);
    sync(s);
  })((s) => sync(s));
  assert.deepEqual(c.segs, [[0x40000000, 0x42000000]]);
  assert.deepEqual(c.trees.sort(), ["allocatable", "defer"]);
  assert.equal(c.fresh, null);
});

test("changes: a load changes nothing; a condense outlines the whole new map", () => {
  const l = run(() => {})((s) => load(s));
  assert.deepEqual(l.c, { segs: [], trees: [], files: [], fresh: null });
  const k = run((s) => {
    for (let i = 0; i < 4 && !churn(s).some((e) => e.k === "churn" && e.stopped); i++);
  })((s) => condenseNow(s));
  assert.equal(k.c.fresh, 0);
  assert.ok(k.s.tape[0].condense);
});

test("the selected entry's range on the bar starts where its bits say, and debug words have none", () => {
  const s = opening();
  write(s, 160 * MIB);
  sync(s);
  const S = strings("en");
  for (let i = 0; i < s.tape.length; i++) {
    const e = s.tape[i];
    const r = entryRange(s, i);
    if (e.kind === "debug") assert.equal(r, null);
    else {
      assert.equal(r[0], MS_START + e.offset * 4096);
      assert.match(text(bits(s, S, i)), new RegExp(`vdev offset 0x${r[0].toString(16).toUpperCase()}`));
    }
  }
  assert.equal(entryRange(s, s.tape.length + 3), null);
  assert.equal(entryRange(s, null), null);
});

test("the words an action wrote are one outlined run on the tape, and none without a change", () => {
  const S = strings("en");
  const s = opening();
  const n = s.tape.length;
  write(s, 160 * MIB);
  sync(s);
  const html = tape(s, S, true, null, n);
  assert.equal(html.match(/class="chgrun"/g)?.length, 1);
  const run = html.slice(html.indexOf('class="chgrun"'));
  for (let i = 0; i < s.tape.length; i++) assert.equal(run.includes(`data-e="${i}"`), i >= n, `word ${i}`);
  assert.doesNotMatch(tape(s, S, true, null, null), /chgrun/);
});
