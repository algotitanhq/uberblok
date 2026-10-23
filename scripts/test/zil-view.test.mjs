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

// A small HTML tree and selector matcher, enough for the selectors targets() returns
// (tag, class, attribute, descendant, child, :last-child). No package: CI runs the tests
// before npm ci.
const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr", "col", "area", "source"]);
function parse(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let cur = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g)) {
    const [, close, name, rest, self] = m;
    const tag = name.toLowerCase();
    if (close) {
      for (let n = cur; n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; break; }
      continue;
    }
    const attrs = {};
    for (const a of rest.matchAll(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? "";
    const el = { tag, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!self && !VOID.has(tag)) cur = el;
  }
  return root;
}
function matches(el, compound) {
  if (compound.replace(/^[a-z][\w-]*/i, "").replace(/\.[\w-]+|\[[\w-]+(?:="[^"]*")?\]|:last-child/g, "") !== "")
    throw new Error(`selector part not supported by the test: ${compound}`);
  if (el.tag === "#root") return false;
  const tag = compound.match(/^[a-z][\w-]*/i);
  if (tag && el.tag !== tag[0].toLowerCase()) return false;
  for (const [, c] of compound.matchAll(/\.([\w-]+)/g)) if (!(el.attrs.class ?? "").split(/\s+/).includes(c)) return false;
  for (const [, n, v] of compound.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) if (!Object.hasOwn(el.attrs, n) || (v !== undefined && el.attrs[n] !== v)) return false;
  if (compound.includes(":last-child") && el.parent.children.at(-1) !== el) return false;
  return true;
}
function select(root, sel) {
  const parts = sel.replace(/\s*>\s*/g, " > ").trim().split(/\s+/);
  // Walk the selector right to left from each element.
  const fits = (el, i) => {
    if (!matches(el, parts[i])) return false;
    if (i === 0) return true;
    if (parts[i - 1] === ">") return el.parent && fits(el.parent, i - 2);
    for (let p = el.parent; p; p = p.parent) if (fits(p, i - 1)) return true;
    return false;
  };
  const out = [];
  const walk = (n) => { for (const c of n.children) { if (fits(c, parts.length - 1)) out.push(c); walk(c); } };
  walk(root);
  return out;
}

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

test("the test's selector matcher finds only what is there", () => {
  const doc = parse('<div data-writes><ul class="writes"><li data-w="1">a</li><li data-w="2"><b data-seq="3">x</b></li><p>z</p></ul></div>');
  assert.equal(select(doc, '[data-w="2"]').length, 1);
  assert.equal(select(doc, '[data-seq="999"]').length, 0);
  assert.equal(select(doc, ".writes > li:last-child").length, 0);
  assert.equal(select(doc, ".writes > p:last-child").length, 1);
  assert.equal(select(doc, ".writes > [data-seq]").length, 0);
  assert.equal(select(doc, ".writes [data-seq]").length, 1);
  assert.equal(select(doc, "[constructor]").length, 0);
  assert.throws(() => select(doc, "li:not(.x)"));
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
  step(() => Z.fsync(t));
  step(() => Z.write(t, 4096, { dsync: false, direct: false }));
  step(() => Z.fsync(t));
  for (let i = 0; i < 7; i++) {
    step(() => Z.write(t, 4096, { dsync: false, direct: false }));
    step(() => Z.fsync(t));
  }
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
  // Selectors are run on the HTML the step is drawn with, inside the figure's own containers.
  for (const [before, ev, after] of runs) {
    for (let k = 0; k < ev.length; k++) {
      const f = k < ev.length - 1 ? frameAt(before, after, ev, k) : undefined;
      const doc = parse(`<div data-writes>${writes(after, S, f)}</div><div data-memory>${memory(after, S, f)}</div><div data-disk>${disk(after, S, f)}</div>`);
      const found = targets(ev[k]).some((sel) => select(doc, sel).length > 0);
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

test("the narration says where a log block went and why, the log keeps every class tried", () => {
  const why = { en: "because there is no SLOG", fr: "car il n’y a pas de SLOG", es: "porque no hay SLOG" };
  const full = { en: "because the SLOG is full", fr: "car le SLOG est plein", es: "porque el SLOG está lleno" };
  for (const lang of ["en", "fr", "es"]) {
    const S = strings(lang);
    for (const e of [{ k: "create", blk, tried }, { k: "alloc", lwb: 1, next: 2, blk, tried }]) {
      const short = text(eventLine(S, e, true));
      const long = text(eventLine(S, e));
      assert.ok(short.includes(full[lang]), `${lang} ${e.k}: ${short}`);
      assert.ok(!short.includes(text(S.clsSpecial)), `${lang} ${e.k}: the tries stay in the log: ${short}`);
      assert.ok(long.includes(text(S.clsSpecial)), `${lang} ${e.k}: ${long}`);
      assert.ok(short.length < long.length, `${lang} ${e.k}`);
    }
    const noSlog = [{ cls: "log", ok: false, why: "absent" }, { cls: "embedded_log", ok: true, why: "taken" }];
    assert.ok(text(eventLine(S, { k: "create", blk, tried: noSlog }, true)).includes(why[lang]), lang);
    const onSlog = text(eventLine(S, { k: "create", blk: { ...blk, cls: "log" }, tried: [{ cls: "log", ok: true, why: "taken" }] }, true));
    assert.ok(!onSlog.includes(why[lang]) && !onSlog.includes(full[lang]), `${lang}: ${onSlog}`);
  }
});

test("a replay rings the write before the record: the narration names the write", () => {
  assert.match(targets({ k: "replay", seq: 1, write: 2, txg: 100 })[0], /data-w="2"/);
});
