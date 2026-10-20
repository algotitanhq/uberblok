// Tests for the words of the send / receive room (src/lib/send-view.ts with
// src/lib/send-strings.ts): EN, FR and ES have the same keys and placeholders;
// every frame of every stream (each from-snapshot, with and without a flipped
// bit) is drawn with no placeholder left unfilled; counts are singular for 1 in
// English and Spanish and for 0 and 1 in French (DECISIONS.md D7.4); the drawing agrees
// with the model (states of the tree, records written, records received).
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
const V = await import("../../src/lib/send-view.ts");
const M = await import("../../src/lib/send.ts");
const { SEND_STRINGS } = await import("../../src/lib/send-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(SEND_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  refs: new Proxy({}, { get: () => "#" }),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const snaps = M.snapshots();
const to = snaps[3];
const FROMS = [null, ...snaps.slice(0, 3)];

function all(from, flip) {
  const snd = M.send(to, from);
  let stream = M.streamBytes(snd.records);
  if (flip) {
    const w = snd.records.findIndex((r) => r.type === "WRITE");
    stream = M.flipBit(stream, w >= 0 ? w : 1);
  }
  const rcv = M.receive(from ? M.contentOf(from.root) : {}, stream);
  return { snd, rcv };
}

test("EN, FR and ES: same keys, same placeholders", () => {
  const en = SEND_STRINGS.en;
  const frs = SEND_STRINGS.fr;
  assert.deepEqual(Object.keys(en).sort(), Object.keys(frs).sort());
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
  for (const k of Object.keys(en)) assert.equal(ph(frs[k]), ph(en[k]), k);
  const es = SEND_STRINGS.es;
  assert.deepEqual(Object.keys(es), Object.keys(en));
  for (const k of Object.keys(en)) assert.equal(ph(es[k]), ph(en[k]), k);
});

test("every frame of every stream, every language: nothing left unfilled", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const from of FROMS)
      for (const flip of [false, true]) {
        const { snd, rcv } = all(from, flip);
        const last = V.lastFrame(snd, rcv);
        for (let t = 0; t <= last; t++) {
          const html = [
            V.tree(S, snd, t), V.strip(S, snd, rcv, t), V.receiver(S, snd, rcv, t), V.counters(S, snd, t),
            t ? V.frameLine(S, snd, rcv, t) : V.frameLine(S, snd, rcv, 0),
          ].join("");
          assert.doesNotMatch(html, /\{\w+\}|undefined|NaN/, `${lang} ${from?.name ?? "full"} flip=${flip} t=${t}`);
        }
        const rest = [V.describe(S, snd, rcv), V.summary(S, snd), V.table(S, FROMS.map((f) => M.send(to, f)), 0), V.history(S, snaps)].join("");
        assert.doesNotMatch(rest, /\{\w+\}|undefined|NaN/);
      }
  }
});

test("counts: singular for 1 in English and Spanish, for 0 and 1 in French", () => {
  for (const [lang, n, want] of [
    ["en", 0, "0 block pointers"], ["en", 1, "1 block pointer"], ["en", 2, "2 block pointers"],
    ["fr", 0, "0 pointeur de bloc"], ["fr", 1, "1 pointeur de bloc"], ["fr", 2, "2 pointeurs de bloc"],
    ["es", 0, "0 punteros de bloque"], ["es", 1, "1 puntero de bloque"], ["es", 2, "2 punteros de bloque"],
  ])
    assert.equal(V.plural(strings(lang), n, "bp1", "bpN"), want);
  // The counters at the start of a stream read 0: singular in French.
  const { snd } = all(snaps[2], false);
  assert.match(text(V.counters(strings("fr"), snd, 0)), /0 pointeur de bloc visité.*0 sauté.*0 en dessous, jamais lu.*1 enregistrement.*312 octets/);
  assert.match(text(V.counters(strings("en"), snd, 0)), /0 block pointers visited.*0 skipped.*0 below them.*1 record312 bytes/);
  assert.match(text(V.counters(strings("es"), snd, 0)), /0 punteros de bloque visitados.*0 omitidos.*0 por debajo, nunca leídos.*1 registro312 bytes/);
  assert.match(text(V.dispatchLine(strings("es"), snd, all(snaps[2], false).rcv, 0)), /GUID de @s3/);
  assert.match(text(V.dispatchLine(strings("fr"), snd, all(snaps[2], false).rcv, 0)), /GUID de @s3/);
  // A FREE that frees two blocks (b, from @s1), and the singular in French for one.
  const r1 = all(snaps[0], false);
  const lines = (lang) => r1.rcv.dispatched.map((_, k) => text(V.dispatchLine(strings(lang), r1.snd, r1.rcv, k)));
  assert.ok(lines("en").some((l) => /b frees 2 blocks \(1, 2\)/.test(l)));
  assert.ok(lines("fr").some((l) => /b libère 2 blocs \(1, 2\)/.test(l)));
  assert.equal(V.plural(strings("fr"), 1, "blk1", "blkN"), "1 bloc");
  assert.ok(lines("es").some((l) => /b libera 2 bloques \(1, 2\)/.test(l)));
  assert.equal(V.plural(strings("es"), 1, "blk1", "blkN"), "1 bloque");
  // FREEOBJECTS names the file that is gone from @s4.
  assert.ok(lines("en").some((l) => /receive_freeobjects.*: c is deleted\./.test(l)));
  assert.ok(lines("fr").some((l) => /receive_freeobjects.*: c est supprimé\./.test(l)));
  assert.ok(lines("es").some((l) => /receive_freeobjects.*: c se elimina\./.test(l)));
});

test("the drawing agrees with the model: final frame", () => {
  const S = strings("en");
  for (const from of FROMS) {
    const { snd, rcv } = all(from, false);
    const last = V.lastFrame(snd, rcv);
    const tr = V.tree(S, snd, last);
    assert.equal((tr.match(/class="bp [^"]*\bvisit\b/g) ?? []).length, snd.visited);
    assert.equal((tr.match(/class="bp [^"]*\bskip\b/g) ?? []).length, snd.skipped);
    assert.equal((tr.match(/class="bp [^"]*\bpruned\b/g) ?? []).length, snd.pruned);
    assert.equal((tr.match(/class="bp [^"]*\btodo\b/g) ?? []).length, 0);
    const st = V.strip(S, snd, rcv, last);
    assert.equal((st.match(/<li class="rec /g) ?? []).length, snd.records.length);
    assert.equal((st.match(/<li class="rec [^"]*\bdone\b/g) ?? []).length, snd.records.length);
    assert.match(V.receiver(S, snd, rcv, last), /class="verdict ok"/);
    assert.match(text(V.counters(S, snd, last)), new RegExp(`^${snd.visited} block pointer`));
  }
});

test("frames in order: the traversal, then END, then the receiver one record at a time", () => {
  const S = strings("en");
  const { snd, rcv } = all(snaps[1], false);
  assert.equal(V.written(snd, 0), 1, "BEGIN is out before the first step");
  let prev = 1;
  for (let t = 1; t <= snd.steps.length; t++) {
    const w = V.written(snd, t);
    assert.ok(w >= prev);
    prev = w;
  }
  assert.equal(V.written(snd, snd.steps.length + 1), snd.records.length);
  assert.equal(V.received(snd, rcv, snd.steps.length + 1), 0);
  assert.equal(V.received(snd, rcv, V.lastFrame(snd, rcv)), snd.records.length);
  assert.match(text(V.frameLine(S, snd, rcv, snd.steps.length + 1)), /The traversal is done\. Written: FREEOBJECTS 5 to 7, END/);
  // The first dispatched record is BEGIN, found by GUID on the receiver.
  assert.match(text(V.frameLine(S, snd, rcv, snd.steps.length + 2)), /BEGIN → dmu_recv_begin.*GUID of @s2/);
});

test("a flipped bit: the strip marks the record, the receiver shows ECKSUM and keeps the from-snapshot", () => {
  const want = {
    en: [/record 4 .*ECKSUM.*Record 3, WRITE a at 0/, /holds nothing, as before/, /still holds @s1\./],
    fr: [/enregistrement 4 .*ECKSUM.*enregistrement 3, WRITE a à 0/, /ne détient toujours rien/, /détient toujours @s1\./],
    es: [/registro 4 .*ECKSUM.*registro 3, WRITE a en 0/, /no tiene nada, como antes/, /sigue teniendo @s1\./],
  };
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const { snd, rcv } = all(null, true);
    const last = V.lastFrame(snd, rcv);
    assert.deepEqual(rcv.error, { i: 4, err: "ECKSUM" });
    assert.match(V.strip(S, snd, rcv, last), /class="rec [a-z]+ bad" data-rec="4"/);
    assert.match(V.strip(S, snd, rcv, last), /class="rec write lost" data-rec="3"/, "the damaged WRITE is marked never applied");
    assert.match(V.receiver(S, snd, rcv, last), /class="verdict bad"/);
    assert.match(text(V.frameLine(S, snd, rcv, last)), want[lang][0]);
    assert.doesNotMatch(V.receiver(S, snd, rcv, last), /class="files"/, "a full receive undone leaves nothing");
    assert.match(text(V.receiver(S, snd, rcv, last)), want[lang][1]);
    const inc = all(snaps[0], true);
    assert.match(text(V.receiver(S, inc.snd, inc.rcv, V.lastFrame(inc.snd, inc.rcv))), want[lang][2]);
  }
});
