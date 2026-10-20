// Tests for the words of the compression, dedup and encryption room
// (src/lib/transforms-view.ts with src/lib/transforms-strings.ts): EN, FR and
// ES have the same keys and placeholders; every state of the three figures is
// drawn in every language with no placeholder left unfilled; counts are
// singular for 1 in English and Spanish and for 0 and 1 in French (DECISIONS.md D7.4);
// the drawing agrees with the model.
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
const V = await import("../../src/lib/transforms-view.ts");
const M = await import("../../src/lib/transforms.ts");
const { TRANSFORMS_STRINGS } = await import("../../src/lib/transforms-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(TRANSFORMS_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  refs: new Proxy({}, { get: () => "#" }),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const BAD = /\{\w+\}|undefined|NaN|null/;

test("EN, FR and ES: same keys, same placeholders", () => {
  const en = TRANSFORMS_STRINGS.en;
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const lang of ["fr", "es"]) {
    const other = TRANSFORMS_STRINGS[lang];
    assert.deepEqual(Object.keys(other), Object.keys(en), lang);
    for (const k of Object.keys(en)) assert.equal(ph(other[k]), ph(en[k]), `${lang} ${k}`);
  }
});

test("compression: every block, sector, compression and data, every language", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const lsize of V.LSIZES)
      for (const ashift of V.ASHIFTS)
        for (const algo of V.ALGOS)
          for (const enc of [false, true]) {
            const outs = [...V.PRESETS.map((p) => [p === "zero", V.presetOut(p, lsize)]), [false, 1], [false, 112], [false, 113], [false, lsize - 1], [false, lsize]];
            for (const [zero, out] of outs) {
              const x = { lsize, ashift, algo, zero, out, encrypt: enc };
              const r = M.compress(x);
              const html = [V.compressBars(S, x, r), V.compressPath(S, x, r), V.compressResult(S, x, r), V.compressLine(S, x, r), V.compressTable(S, x)].join("");
              const where = `${lang} ${lsize} a${ashift} ${algo} zero=${zero} out=${out} enc=${enc}`;
              assert.doesNotMatch(html, BAD, where);
              // Exactly one branch decides, and it is the outcome's.
              assert.equal((V.compressPath(S, x, r).match(/class="taken"/g) ?? []).length, 1, where);
              assert.ok(text(V.compressResult(S, x, r)).includes(text(S[`o_${r.outcome}`])), where);
            }
          }
  }
});

test("dedup: every sequence of three writes with or without quota, every language", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    assert.doesNotMatch(V.dedupView(S, M.dedupStart()) + V.dedupDescribe(S, M.dedupStart()), BAD);
    const writes = [];
    for (const a of ["A", "B", "C"]) for (const q of [false, true]) writes.push([a, q]);
    for (const w1 of writes)
      for (const w2 of writes)
        for (const w3 of writes) {
          let s = M.dedupStart();
          for (const [c, q] of [w1, w2, w3]) {
            s = M.dedupWrite(s, c, q);
            const html = V.dedupView(S, s) + V.dedupDescribe(S, s) + V.dedupLine(S, s.steps[s.steps.length - 1]);
            assert.doesNotMatch(html, BAD);
          }
          // The drawing agrees with the model: one row per entry, one item per block pointer and per block on disk.
          const html = V.dedupView(S, s);
          assert.equal((html.match(/<tr/g) ?? []).length - (s.entries.length ? 1 : 0), s.entries.length);
          assert.equal((html.match(/class="bpn"/g) ?? []).length, s.bps.length);
          assert.equal((html.match(/class="refs"/g) ?? []).length, s.disk.length);
        }
  }
});

test("encryption: every kind of block pointer, every state of the file, every language", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const k of ["plain", "encrypted", "authenticated", "indirect", "embedded", "hole"]) {
      const g = V.wordsGrid(S, k);
      assert.doesNotMatch(g + V.kindLine(S, k), BAD, k);
      assert.equal((g.match(/<tr class=/g) ?? []).length, 16);
    }
    // Encrypted: the words that change from an ordinary pointer are 4, 5, b, e, f.
    const diff = [...V.wordsGrid(S, "encrypted").matchAll(/<tr class="[^"]*diff"><th scope="row">(\w)<\/th>/g)].map((m) => m[1]);
    assert.deepEqual(diff, ["4", "5", "b", "e", "f"]);
    const clean = M.cryptFile([S.fileText0, S.fileText1, S.fileText2], "core", S.bonusText);
    for (const key of [true, false])
      for (const flip of [false, true]) {
        const f = flip ? { ...clean, data: [clean.data[0], M.flipped(clean.data[1]), clean.data[2]] } : clean;
        for (const ui of [
          { key, flip, scrub: null, read: null },
          { key, flip, scrub: M.scrub(f), read: null },
          { key, flip, scrub: null, read: V.readAll(f, key) },
        ]) {
          const html = V.cryptFileView(S, f, ui) + ["scrub", "read", "key", "flip"].map((a) => V.cryptLine(S, a, ui)).join("");
          assert.doesNotMatch(html, BAD, `${lang} key=${key} flip=${flip}`);
          // Without the key, no plaintext of a data block is shown.
          if (!key) for (const t of [S.fileText0, S.fileText1, S.fileText2]) assert.ok(!text(V.cryptFileView(S, f, ui)).includes(t));
          // With the key, a block that fails its checksum shows no plaintext either.
          if (key && flip) {
            const out = text(V.cryptFileView(S, f, ui));
            assert.ok(!out.includes(text(S.fileText1)) && out.includes(text(S.corrupt)), `${lang} flipped block`);
          }
        }
        // The read's verdict names the first block that fails, with its error.
        const r = V.readAll(f, key);
        const out = text(V.cryptFileView(S, f, { key, flip, scrub: null, read: r }));
        if (!key) assert.match(out, /EACCES/);
        else if (flip) assert.match(out, /ECKSUM/);
      }
  }
});

test("counts: singular for 1 in English and Spanish, for 0 and 1 in French", () => {
  for (const [lang, n, want] of [
    ["en", 0, "0 sectors"], ["en", 1, "1 sector"], ["en", 2, "2 sectors"],
    ["fr", 0, "0 secteur"], ["fr", 1, "1 secteur"], ["fr", 2, "2 secteurs"],
    ["es", 0, "0 sectores"], ["es", 1, "1 sector"], ["es", 2, "2 sectores"],
  ])
    assert.equal(V.plural(strings(lang), n, "sector1", "sectorN"), want);
  // An embedded block allocates 0 sectors: singular in French.
  const x = { lsize: 4096, ashift: 12, algo: "lz4", zero: false, out: 90 };
  assert.match(text(V.compressBars(strings("fr"), x, M.compress(x))), /Sortie du compresseur : 90 octets[\s\S]*0 secteur, 0 octet(?!s)/);
  // The scrub of the five blocks, no error: "0 erreur" in French, "0 checksum errors" in English.
  const f = M.cryptFile(["a", "b", "c"], "core", "x");
  const ui = { key: false, flip: false, scrub: M.scrub(f), read: null };
  assert.match(text(V.cryptLine(strings("fr"), "scrub", ui)), /5 blocs.*0 erreur de somme de contrôle/);
  assert.match(text(V.cryptLine(strings("en"), "scrub", ui)), /5 blocks.*0 checksum errors/);
  assert.match(text(V.cryptLine(strings("es"), "scrub", ui)), /5 bloques.*0 errores de suma de comprobación/);
  // Spanish: plural for 0 bytes and 0 sectors; thousands grouped from five digits on.
  assert.match(text(V.compressBars(strings("es"), x, M.compress(x))), /Salida del compresor: 90 bytes[\s\S]*0 sectores, 0 bytes/);
  assert.equal(V.plural(strings("es"), 1, "cWrite1", "cWriteN"), "<b>1</b> escritura");
  assert.equal(V.plural(strings("es"), 0, "cWrite1", "cWriteN"), "<b>0</b> escrituras");
});

test("sizes: whole KiB, else bytes, in the page's language", () => {
  assert.equal(V.size(strings("en"), 131072), "128 KiB");
  assert.equal(V.size(strings("fr"), 131072), "128 Kio");
  assert.equal(V.size(strings("en"), 114688), "112 KiB");
  assert.equal(V.size(strings("en"), 112), "112 bytes");
  assert.equal(V.size(strings("fr"), 50176), "49 Kio");
  assert.equal(V.size(strings("en"), 49807), "49,807 bytes");
  assert.equal(V.size(strings("es"), 131072), "128\u00a0KiB");
  assert.equal(V.size(strings("es"), 4211), "4211\u00a0bytes");
  assert.equal(V.size(strings("es"), 49807), "49\u202f807\u00a0bytes");
});
