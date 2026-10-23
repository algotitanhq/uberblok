// Tests for the words of the ZIL and SLOG room (src/lib/zil-view.ts with
// src/lib/zil-strings.ts): every count agrees with its number, singular for 1
// in English and Spanish and for 0 and 1 in French (DECISIONS.md D7.4); EN, FR and ES have the
// same keys and placeholders, none left unfilled; the decision panel names the
// state the model computes, for every combination of the buttons. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// zil-view.ts imports "./zil" as Astro's bundler does, without the extension;
// Node's loader needs it.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const { eventLine, summary, describe, decision, writes, memory, disk, frameAt, targets } = await import("../../src/lib/zil-view.ts");
const { ZIL_STRINGS } = await import("../../src/lib/zil-strings.ts");
const { fr } = await import("../../src/lib/fr.ts");
const Z = await import("../../src/lib/zil.ts");

const strings = (lang) => ({
  ...Object.fromEntries(Object.entries(ZIL_STRINGS[lang]).map(([k, v]) => [k, lang === "fr" ? fr(v) : v])),
  refs: new Proxy({}, { get: () => "#" }),
  lang,
});
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/[  ]/g, " ");
const blk = { id: 2, cls: "embedded_log", txg: 100, size: 4096 };
const tried = [
  { cls: "log", ok: false, why: "full" },
  { cls: "special_embedded_log", ok: false, why: "absent" },
  { cls: "special", ok: false, why: "absent" },
  { cls: "embedded_log", ok: true, why: "taken" },
];

/** Every log line, with every count set to n. */
function lines(S, n) {
  const evs = [
    { k: "itx", write: 1, size: 4096, state: "WR_NEED_COPY", recs: 1, txg: 100 },
    { k: "itx", write: 1, size: 131072, state: "WR_INDIRECT", recs: Math.max(n, 2), txg: 100 },
    { k: "create", blk, tried },
    { k: "createWait", txg: 100 },
    { k: "dropSynced", itxs: n, txg: 100 },
    { k: "lwb", lwb: 1, state: "OPENED" },
    { k: "assign", lwb: 1, seq: 1, write: 1, state: "WR_NEED_COPY", len: 4096, split: false, bytes: 4288 },
    { k: "assign", lwb: 2, seq: 2, write: 1, state: "WR_NEED_COPY", len: 376, split: true, bytes: 568 },
    { k: "waiter", lwb: 1 },
    { k: "inplace", write: 1 },
    { k: "alloc", lwb: 1, next: 2, blk: { ...blk, size: 131072 }, tried },
    { k: "alloc", lwb: 1, next: 2, blk: { id: 2, cls: "log", txg: 100, size: 131072 }, tried: [{ cls: "log", ok: true, why: "taken" }] },
    { k: "returns", how: "fsync", via: "log" },
    { k: "returns", how: "write", via: "log" },
    { k: "returns", how: "fsync", via: "sync" },
    { k: "returns", how: "write", via: "sync" },
    { k: "nothing" },
    { k: "sync", txg: 100, writes: n, dropped: n },
    { k: "free", blk },
    { k: "head", blk: 2 },
    { k: "head", blk: null },
    { k: "crash", lost: n },
    { k: "claim", first: 101, blocks: n, recs: n, needed: n > 0 },
    { k: "replay", seq: 1, write: 1, txg: 100 },
    { k: "skip", seq: 1, txg: 99, why: "txg" },
    { k: "skip", seq: 1, txg: 99, why: "seq" },
    { k: "destroy", kept: null },
    { k: "destroy", kept: 2 },
    { k: "reuse", blk },
    ...["crashed", "imported", "notCrashed", "notImported"].map((why) => ({ k: "refused", why })),
  ];
  return evs.map((e) => text(eventLine(S, e)));
}

const NOUNS = {
  en: [["byte", "bytes"], ["write", "writes"], ["record", "records"], ["itx", "itxs"], ["block", "blocks"]],
  fr: [["octet", "octets"], ["écriture", "écritures"], ["enregistrement", "enregistrements"], ["bloc", "blocs"], ["perdue", "perdues"], ["rejouée", "rejouées"]],
  es: [["byte", "bytes"], ["escritura", "escrituras"], ["entrada", "entradas"], ["bloque", "bloques"], ["perdida", "perdidas"], ["reproducida", "reproducidas"]],
};

/** A state with every write status, for the summary. */
function busy() {
  const s = Z.empty();
  Z.write(s, 4096, { dsync: false, direct: false });
  Z.fsync(s);
  Z.sync(s);
  Z.write(s, 4096, { dsync: false, direct: false });
  Z.fsync(s);
  Z.write(s, 4096, { dsync: false, direct: false });
  Z.crash(s);
  Z.importPool(s);
  Z.mount(s);
  return s;
}

for (const lang of ["en", "fr", "es"]) {
  const S = strings(lang);
  const singular = (n) => (lang === "fr" ? n < 2 : n === 1);
  for (const n of [0, 1, 2]) {
    test(`${lang}: every count in the log agrees with ${n}`, () => {
      for (const line of lines(S, n)) {
        for (const [one, many] of NOUNS[lang]) {
          const bad = singular(n) ? many : one;
          const re = new RegExp(`(^|[^\\d,.])${n} ${bad}(?![\\p{L}])`, "u");
          assert.doesNotMatch(line, re, line);
        }
      }
    });
  }
  test(`${lang}: the summary agrees with its counts`, () => {
    const s = busy();
    assert.deepEqual(s.writes.map((w) => w.status), ["synced", "replayed", "lost"]);
    const out = text(summary(s, S));
    for (const [one, many] of NOUNS[lang]) {
      assert.doesNotMatch(out, new RegExp(`(^|[^\\d,.])1 ${many}(?![\\p{L}])`, "u"), out);
      assert.doesNotMatch(out, new RegExp(`(^|[^\\d,.])[2-9] ${one}(?![\\p{L}])`, "u"), out);
    }
    if (lang === "fr") assert.match(out, /1 rejouée, 1 perdue/);
    if (lang === "es") assert.match(out, /1 reproducida, 1 perdida/);
  });
}

test("EN, FR and ES have the same keys and the same placeholders, and no placeholder is left unfilled", () => {
  const ph = (v) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  assert.deepEqual(Object.keys(ZIL_STRINGS.en).sort(), Object.keys(ZIL_STRINGS.fr).sort());
  for (const k of Object.keys(ZIL_STRINGS.en)) assert.equal(ph(ZIL_STRINGS.en[k]), ph(ZIL_STRINGS.fr[k]), k);
  assert.deepEqual(Object.keys(ZIL_STRINGS.es), Object.keys(ZIL_STRINGS.en));
  for (const k of Object.keys(ZIL_STRINGS.en)) assert.equal(ph(ZIL_STRINGS.en[k]), ph(ZIL_STRINGS.es[k]), k);
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const s = busy();
    const t = Z.empty();
    t.pool = { slog: "slog" };
    Z.write(t, 131072, { dsync: false, direct: false });
    const created = Z.clone(t);
    const ce = Z.fsync(t);
    Z.write(t, 131072, { dsync: false, direct: false });
    const before = Z.clone(t);
    const ev = Z.fsync(t);
    const frames = [...ev.map((_, k) => frameAt(before, t, ev, k)), ...ce.map((_, k) => frameAt(created, t, ce, k))];
    const out = [
      ...[0, 1, 2].flatMap((n) => lines(S, n)),
      summary(s, S),
      describe(s, S),
      describe(t, S),
      writes(t, S),
      memory(t, S),
      disk(t, S),
      ...frames.flatMap((f) => [writes(t, S, f), memory(t, S, f), disk(t, S, f)]),
    ].map(text);
    for (const o of out) assert.doesNotMatch(o, /\{\w+\}|undefined|NaN/, o);
  }
});

test("the decision panel shows the model's state for every combination of the buttons", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const slog of ["none", "slog", "full"])
      for (const logbias of ["latency", "throughput"])
        for (const size of Z.SIZES)
          for (const dsync of [false, true])
            for (const direct of [false, true]) {
              const s = Z.empty();
              s.pool = { slog };
              s.logbias = logbias;
              const want = Z.logWrite(Z.stateInput(s, size, { dsync, direct }), 0)[0].state;
              const html = decision(s, S, size, { dsync, direct });
              const shown = html.match(/class="wr [^"]+">(WR_\w+)</)[1];
              assert.equal(shown, want, `${lang} ${slog} ${logbias} ${size} ${dsync} ${direct}`);
              assert.doesNotMatch(text(html), /\{\w+\}/);
            }
  }
});

test("a commit drawn frame by frame: lwb states only move forward, records appear once, fsync returns last", () => {
  const S = strings("en");
  const t = Z.empty();
  t.pool = { slog: "slog" };
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  Z.write(t, 131072, { dsync: false, direct: false });
  const before = Z.clone(t);
  const ev = Z.fsync(t);
  let last = {};
  let recs = 0;
  for (let k = 0; k < ev.length; k++) {
    const f = frameAt(before, t, ev, k);
    for (const [id, st] of Object.entries(f.states)) {
      if (last[id]) assert.ok(Z.LWB_STATES.indexOf(st) >= Z.LWB_STATES.indexOf(last[id]), `lwb ${id} at step ${k}`);
    }
    last = f.states;
    assert.ok(f.recs.length >= recs);
    recs = f.recs.length;
    // The write is shown in memory, not yet in the log, until the last step.
    const w = text(writes(t, S, f)).split("w2:")[1];
    if (k < ev.length - 1) assert.match(w, /in memory/);
    else assert.match(w, /in the log/);
  }
  assert.equal(recs, 2);
});

test("the first commit drawn frame by frame: zh_log stays a hole until the txg sync, the itx leaves at the drop, no record", () => {
  const S = strings("en");
  const t = Z.empty();
  Z.write(t, 4096, { dsync: false, direct: false });
  const before = Z.clone(t);
  const ev = Z.fsync(t);
  const head = ev.findIndex((e) => e.k === "head");
  const drop = ev.findIndex((e) => e.k === "dropSynced");
  for (let k = 0; k < ev.length; k++) {
    const f = frameAt(before, t, ev, k);
    assert.equal(f.header.log, k < head ? null : 1, `step ${k}`);
    assert.deepEqual(f.pending, k < drop ? [1] : [], `step ${k}`);
    assert.deepEqual(f.recs, []);
    // The write is in memory until txg 100 syncs, then in the pool.
    assert.match(text(writes(t, S, f)), k < head - 1 ? /in memory/ : /in the pool/, `step ${k}`);
  }
});

test("a txg sync drawn step by step: the writes reach the pool first, then one log block is freed per step", () => {
  const S = strings("en");
  const t = Z.empty();
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  const before = Z.clone(t);
  const ev = Z.sync(t);
  assert.deepEqual(ev.map((e) => e.k), ["sync", "free", "free", "head"]);
  const cells = (f) => [...disk(t, S, f).matchAll(/class="cell (\w+)" data-cell="(\d+)"/g)].map((m) => `${m[2]}:${m[1]}`);
  for (let k = 0; k < ev.length - 1; k++) {
    const f = frameAt(before, t, ev, k);
    assert.match(text(writes(t, S, f)).split("w2:")[1], /in the pool/, `step ${k}`);
    // Step 1 frees b1, step 2 frees b2; b3 stays, allocated and not written.
    assert.deepEqual(cells(f), [`1:${k >= 1 ? "freed" : "written"}`, `2:${k >= 2 ? "freed" : "written"}`, "3:end"], `step ${k}`);
    assert.equal(f.header.log, 1, `step ${k}`);
  }
});

test("a mount drawn step by step: one write replayed per step, the chain shown until the log is destroyed", () => {
  const S = strings("en");
  const t = Z.empty();
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  Z.write(t, 4096, { dsync: false, direct: false });
  Z.fsync(t);
  Z.crash(t);
  Z.importPool(t);
  const before = Z.clone(t);
  const ev = Z.mount(t);
  assert.deepEqual(ev.map((e) => e.k), ["replay", "replay", "destroy"]);
  for (let k = 0; k < ev.length - 1; k++) {
    const f = frameAt(before, t, ev, k);
    const w = text(writes(t, S, f));
    assert.match(w.split("w2:")[1], /replayed/, `step ${k}`);
    assert.match(w.split("w3:")[1], k >= 1 ? /replayed/ : /in the log/, `step ${k}`);
    // The claimed chain stays drawn, with its records, until the last step destroys the log.
    assert.match(disk(t, S, f), /data-seq="1"/, `step ${k}`);
    assert.match(disk(t, S, f), /Claimed in txg<\/dt><dd>101/, `step ${k}`);
  }
  assert.doesNotMatch(disk(t, S), /data-seq=/);
});

test("every step rings a part of the figure that the step's drawing has", () => {
  const S = strings("en");
  const t = Z.empty();
  t.pool = { slog: "slog" };
  const runs = [];
  const step = (f) => {
    const before = Z.clone(t);
    runs.push([before, f(), Z.clone(t)]);
  };
  step(() => Z.write(t, 4096, { dsync: false, direct: false }));
  step(() => Z.fsync(t));
  step(() => Z.write(t, 131072, { dsync: false, direct: false }));
  step(() => Z.fsync(t));
  step(() => Z.write(t, 4096, { dsync: true, direct: false }));
  step(() => Z.write(t, 4096, { dsync: false, direct: false }));
  step(() => Z.sync(t));
  step(() => Z.write(t, 4096, { dsync: false, direct: false }));
  step(() => Z.fsync(t));
  step(() => Z.crash(t));
  step(() => Z.importPool(t));
  step(() => Z.mount(t));
  // Selectors are checked by the attribute they look for, on the HTML the step is drawn with.
  for (const [before, ev, after] of runs) {
    for (let k = 0; k < ev.length; k++) {
      const f = k < ev.length - 1 ? frameAt(before, after, ev, k) : undefined;
      const html = writes(after, S, f) + memory(after, S, f) + disk(after, S, f);
      const found = targets(ev[k]).some((sel) => {
        const attrs = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
        if (!attrs.length) return sel === "[data-memory]" || /class="[^"]*\bw\b[^"]*"/.test(html);
        const [, name, value] = attrs[attrs.length - 1];
        return html.includes(value === undefined ? name : `${name}="${value}"`);
      });
      assert.ok(found, `${ev[k].k} at step ${k}: ${targets(ev[k]).join(", ")}`);
    }
  }
});

test("the figure carries no link: the code is in the Source notes", () => {
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    const s = busy();
    const html = writes(s, S) + memory(s, S) + disk(s, S) + describe(s, S) + decision(s, S, 131072, { dsync: true, direct: true });
    assert.doesNotMatch(html, /<a\b/);
  }
});
