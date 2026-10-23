// HTML and SVG for the Metaslabs and space maps room's figure, built from an Ms
// of src/lib/metaslab.ts. Plain strings, no DOM: the page renders the opening
// state at build time (readable without JavaScript) and the script renders
// every later state with the same functions.
import { decimal, group } from "./l10n";
import {
  MS_START, MS_SIZE, MS_COUNT, MS_ID, BLOCK, MIB, SM_SHIFT, SM_RUN_MAX, SM_BLKSZ, SM_ALLOC, TXG_DEFER_SIZE,
  space, extents, shouldCondense, hex,
  type Ms, type Ev, type Entry, type Seg, type Check,
} from "./metaslab";

export type MsStrings = Record<string, string> & { lang: string };

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const code = (s: string | number) => `<code>${s}</code>`;

/** A number with at most `d` decimals, in the page's language, with thin spaces between thousands. */
export function num(S: MsStrings, x: number, d = 1): string {
  const [i, f] = String(Number(x.toFixed(d))).split(".");
  const g = group(S.lang, i);
  return f ? decimal(S.lang, `${g}.${f}`) : g;
}
/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
const plural = (S: MsStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n: num(S, n, 2) });
export const bytes = (S: MsStrings, b: number): string =>
  b >= MIB ? fill(S.mib, { n: num(S, b / MIB, 2) }) : b >= 1024 ? fill(S.kib, { n: num(S, b / 1024, 2) }) : plural(S, b, "byte1", "byteN");
const words = (S: MsStrings, n: number) => plural(S, n, "word1", "wordN");
const units = (S: MsStrings, n: number) => plural(S, n, "unit1", "unitN");
const typeName = (t: number) => (t === SM_ALLOC ? "ALLOC" : "FREE");
const offHex = (x: number) => "0x" + x.toString(16).toUpperCase();
const range = ([a, b]: Seg) => `[${offHex(a)}, ${offHex(b)})`;
const ranges = (S: MsStrings, rt: Seg[], max = 3) =>
  rt.length <= max ? rt.map(range).join(", ") : `${rt.slice(0, max).map(range).join(", ")} ${plural(S, rt.length - max, "more1", "moreN")}`;

/** The deferred trees, with the txg each was freed in and the txg at whose sync it comes back (metaslab_sync_done L4571, L4630-L4633). */
export function deferred(s: Ms): { segs: Seg[]; freed: number; back: number }[] {
  const last = s.txg - 1;
  return [last, last - 1]
    .map((t) => ({ segs: s.defer[t % TXG_DEFER_SIZE], freed: t, back: t + TXG_DEFER_SIZE }))
    .filter((d) => d.segs.length > 0);
}

// ---------- What the last action changed ----------

/** Sorted copy with overlapping or adjacent segments (or closer than `gap`) joined. */
function norm(segs: Seg[], gap = 0): Seg[] {
  const out: Seg[] = [];
  for (const [a, b] of [...segs].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** a minus b, both normalised. */
function minus(a: Seg[], b: Seg[]): Seg[] {
  const out: Seg[] = [];
  let j = 0;
  for (const [s0, e] of a) {
    let s = s0;
    while (j < b.length && b[j][1] <= s) j++;
    for (let k = j; k < b.length && b[k][0] < e; k++) {
      if (b[k][0] > s) out.push([s, b[k][0]]);
      s = Math.max(s, b[k][1]);
    }
    if (s < e) out.push([s, e]);
  }
  return out;
}

export type TreeKey = "allocatable" | "allocating" | "freeing" | "defer" | "cursor";
export interface Changes {
  /** Ranges of the metaslab whose state (free, allocated, allocating, freeing, deferred) changed. */
  segs: Seg[];
  trees: TreeKey[];
  /** Files written, deleted or rewritten. */
  files: string[];
  /** Index of the first word of the tape the action wrote, or null. */
  fresh: number | null;
}
export const NO_CHANGES: Changes = { segs: [], trees: [], files: [], fresh: null };

/** What an action changed, from the states before and after it: the figure outlines exactly this. */
export function changes(a: Ms, b: Ms): Changes {
  const classes = (s: Ms) => [norm(s.allocatable), norm(s.allocating), norm(s.freeing), norm([...s.defer[0], ...s.defer[1]])];
  const ca = classes(a);
  const cb = classes(b);
  const segs = cb.flatMap((c, i) => minus(c, ca[i]));
  // Space that became allocated and synced: in some tree before, in none after.
  segs.push(...minus(norm(ca.flat()), norm(cb.flat())));
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  const trees: TreeKey[] = [];
  if (!same(a.allocatable, b.allocatable)) trees.push("allocatable");
  if (!same(a.allocating, b.allocating)) trees.push("allocating");
  if (!same(a.freeing, b.freeing)) trees.push("freeing");
  if (!same(a.defer, b.defer)) trees.push("defer");
  if (a.cursor !== b.cursor) trees.push("cursor");
  const before = new Map(a.files.map((f) => [f.id, f]));
  const files = b.files.filter((f) => !same(f, before.get(f.id))).map((f) => f.id);
  const rewritten = b.length < a.length || (a.tape.length > 0 && b.tape[0] !== undefined && !same(a.tape[0].words.map(String), b.tape[0].words.map(String)));
  const fresh = rewritten ? 0 : b.tape.length > a.tape.length ? a.tape.length : null;
  // Changed ranges closer than 2.5 % of the metaslab are one run, outlined once (a rewrite touches hundreds of blocks).
  return { segs: norm(segs, MS_SIZE / 40), trees, files, fresh };
}

// ---------- The vdev and the metaslab ----------

export function vdev(s: Ms, _S: MsStrings): string {
  const used = 1 - (space(s.allocatable) + space(s.defer[0]) + space(s.defer[1])) / MS_SIZE;
  const cells = Array.from({ length: MS_COUNT }, (_, i) =>
    i === MS_ID
      ? `<span class="ms on"><span class="fillbar" style="width:${(used * 100).toFixed(2)}%"></span><span class="id">${i}</span></span>`
      : `<span class="ms"><span class="id">${i}</span></span>`,
  ).join("");
  return `<div class="vdev-cells">${cells}</div>`;
}

const X = (b: number) => ((b - MS_START) / MS_SIZE) * 1000;
const rects = (rt: Seg[], cls: string, min = 0) =>
  rt.map(([a, b]) => {
    const w = Math.max(X(b) - X(a), min);
    return `<rect class="${cls}" x="${X(a).toFixed(2)}" y="0" width="${w.toFixed(2)}" height="40"/>`;
  }).join("");

/** The range of the metaslab a tape entry describes, or null for a debug word. */
export function entryRange(s: Ms, sel: number | null): Seg | null {
  const e = sel === null ? undefined : s.tape[sel];
  if (!e || e.kind === "debug") return null;
  const a = MS_START + e.offset * 2 ** SM_SHIFT;
  return [a, a + e.run * 2 ** SM_SHIFT];
}

/** The zoomed metaslab: free tree, synced allocations, this txg's allocations and frees, deferred frees, the cursor, and the range of the selected tape entry. */
export function bar(s: Ms, S: MsStrings, chg: Seg[] = [], sel: Seg | null = null): string {
  const live = s.files.filter((f) => !f.deleting);
  const pc = (b: number) => (X(b) / 10).toFixed(3);
  const labels = live
    .map((f) => {
      const ex = extents(f.blocks).sort((p, q) => q[1] - q[0] - (p[1] - p[0]))[0];
      if (!ex || X(ex[1]) - X(ex[0]) < 14) return "";
      return `<span class="flabel" style="left:${(((X(ex[0]) + X(ex[1])) / 2) / 10).toFixed(3)}%">${f.id}</span>`;
    })
    .join("");
  const ticks = [0, 128, 256, 384, 512]
    .map((m) => `<span class="tickl${m === 0 ? " first" : m === 512 ? " last" : ""}" style="left:${((m / 512) * 100).toFixed(3)}%">${m === 0 ? "0" : fill(S.mibShort, { n: m })}</span>`)
    .join("");
  // Clamped so that the whole triangle stays inside the bar at 0 and at 512 MiB.
  const cur = `<span class="cursor" style="left:clamp(5px, ${s.cursor ? pc(s.cursor) : "0"}%, calc(100% - 5px))"></span>`;
  // At least 10 px wide, so that a 4 MiB entry still shows on a phone.
  const selr = sel ? `<span class="selr" style="left:min(${pc(sel[0])}%, calc(100% - 10px));width:max(10px, ${((X(sel[1]) - X(sel[0])) / 10).toFixed(3)}%)"></span>` : "";
  return `<div class="msbox">${cur}<svg class="ms-svg" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
<defs><pattern id="hatch-${S.lang}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="hbg"/><line x1="0" y1="0" x2="0" y2="6" class="hl"/></pattern></defs>
<rect class="used" x="0" y="0" width="1000" height="40"/>
${rects(s.allocatable, "free")}
${rects(s.allocating, "allocating", 1.2)}
${rects(s.freeing, "freeing", 1.2).replace(/class="freeing"/g, `class="freeing" style="fill:url(#hatch-${S.lang})"`)}
${deferred(s).map((d) => rects(d.segs, "deferred", 1.2)).join("")}
${live.flatMap((f) => extents(f.blocks)).map(([a, b]) => `<rect class="fext" x="${X(a).toFixed(2)}" y="0" width="${(X(b) - X(a)).toFixed(2)}" height="40"/>`).join("")}
<rect class="frame" x="0" y="0" width="1000" height="40"/>
${chg.map(([a, b]) => { const w = Math.max(X(b) - X(a), 4); const x = Math.min(X(a), 1000 - w); return `<rect class="chg" x="${x.toFixed(2)}" y="1" width="${w.toFixed(2)}" height="38"/>`; }).join("")}
</svg><div class="flabels" aria-hidden="true">${labels}${selr}</div><div class="ticks" aria-hidden="true">${ticks}</div></div>`;
}

export function legend(S: MsStrings): string {
  const k = (cls: string, t: string) => `<li><span class="sw ${cls}"></span>${t}</li>`;
  return `<ul class="ms-legend">${k("free", S.lgFree)}${k("used", S.lgUsed)}${k("allocating", S.lgAllocating)}${k("freeing", S.lgFreeing)}${k("deferred", S.lgDeferred)}<li><span class="sw cur"></span>${S.lgCursor}</li>${k("selr", S.lgSelected)}${k("chg", S.lgChanged)}</ul>`;
}

export function trees(s: Ms, S: MsStrings, chg: TreeKey[] = []): string {
  const on = (k: TreeKey) => (chg.includes(k) ? ` class="chg"` : "");
  const row = (name: string, rt: Seg[], note = "", k?: TreeKey) =>
    `<li${k ? on(k) : ""}><span class="tn">${code(name)}</span> <span class="tv">${rt.length ? `${bytes(S, space(rt))}, ${plural(S, rt.length, "seg1", "segN")}` : S.emptyTree}</span>${note ? ` <span class="muted">${note}</span>` : ""}</li>`;
  const defs = deferred(s);
  const d = defs.length
    ? defs.map((x) => row(`ms_defer[${x.freed % TXG_DEFER_SIZE}]`, x.segs, fill(S.deferNote, { freed: x.freed, back: x.back }), "defer")).join("")
    : row("ms_defer[]", [], "", "defer");
  return `<ul class="trees">
${row("ms_allocatable", s.allocatable, "", "allocatable")}
${row(`ms_allocating[${s.txg & 3}]`, s.allocating, s.allocating.length ? fill(S.openNote, { txg: s.txg }) : "", "allocating")}
${row("ms_freeing", s.freeing, s.freeing.length ? fill(S.openNote, { txg: s.txg }) : "", "freeing")}
${d}
<li${on("cursor")}><span class="tn">${code("ms_lbas[17]")}</span> <span class="tv">${s.cursor ? offHex(s.cursor) : "0"}</span> <span class="muted">${S.cursorNote}</span></li>
</ul>`;
}

export function files(s: Ms, S: MsStrings, live: boolean, chg: string[] = []): string {
  if (!s.files.length) return `<p class="none">${S.noFiles}</p>`;
  const items = s.files.map((f) => {
    const ex = extents(f.blocks);
    const state = f.deleting ? fill(S.fDeleting, { txg: f.pending ?? s.txg }) : f.pending !== null ? fill(S.fPending, { txg: f.pending }) : S.fSynced;
    const btn = live && !f.deleting
      ? `<button type="button" class="btn btn--small" data-del="${f.id}"${f.pending !== null ? ` disabled title="${S.fBusy}"` : ""} aria-label="${fill(S.aDelete, { id: f.id })}">${S.delete}</button>`
      : "";
    return `<li class="${f.deleting ? "deleting" : f.pending !== null ? "pending" : ""}${chg.includes(f.id) ? " chg" : ""}"><span class="fid">${f.id}</span> <span class="fmeta">${bytes(S, f.blocks.length * BLOCK)} · ${plural(S, ex.length, "ext1", "extN")} · ${state}</span>${btn}</li>`;
  });
  return `<ul class="files">${items.join("")}</ul>`;
}

// ---------- The tape ----------

export const TAPE_SHOWN = 32;

function entryLabel(S: MsStrings, e: Entry): string {
  if (e.kind === "debug") return e.txg ? fill(S.eDebug, { action: typeName(e.type), txg: e.txg, at: e.at }) : fill(S.ePad, { at: e.at });
  return fill(S.eEntry, { type: typeName(e.type), size: bytes(S, e.run * 2 ** SM_SHIFT), at: e.at, words: words(S, e.words.length) });
}

/** Indices of the entries drawn: all of a short map; else the first 3 (where a condense starts) and the last ones. */
export function shownEntries(s: Ms): number[] {
  const n = s.tape.length;
  if (n <= TAPE_SHOWN) return [...Array(n).keys()];
  const tail = TAPE_SHOWN - 3;
  return [0, 1, 2, ...Array.from({ length: tail }, (_, k) => n - tail + k)];
}

export function tape(s: Ms, S: MsStrings, live: boolean, sel: number | null, fresh: number | null = null): string {
  if (!s.tape.length) return `<p class="none">${S.tapeEmpty}</p>`;
  const idx = shownEntries(s);
  const cells: string[] = [];
  const run: string[] = [];
  idx.forEach((i, j) => {
    const e = s.tape[i];
    const cls = `tc ${e.kind}${e.kind === "debug" ? (e.txg ? "" : " pad") : e.type === SM_ALLOC ? " alloc" : " free"}${e.condense ? " cond" : ""}${i === sel ? " sel" : ""}`;
    const txt =
      e.kind === "debug"
        ? `<span class="t1">${e.txg ? `txg ${e.txg}` : S.padShort}</span>${e.txg ? ` <span class="t2">${typeName(e.type)}</span>` : ""}`
        : `<span class="t1">${typeName(e.type)}</span> <span class="t2">${bytes(S, e.run * 2 ** SM_SHIFT)}</span>`;
    const gap = j > 0 && i !== idx[j - 1] + 1 ? `<li class="earlier">${fill(S.skipped, { n: words(S, s.tape[i].at - s.tape[idx[j - 1]].at - s.tape[idx[j - 1]].words.length) })}</li>` : "";
    const cell = live
      ? `<li><button type="button" class="${cls}" data-e="${i}" data-w="${e.words.map(hex).join(" ")}" aria-pressed="${i === sel}" aria-label="${entryLabel(S, e)}">${txt}</button></li>`
      : `<li><span class="${cls}" data-e="${i}" data-w="${e.words.map(hex).join(" ")}">${txt}</span></li>`;
    // The words the last action wrote are always the end of the tape: one outlined run, not one box per word.
    if (!run.length && fresh !== null && i >= fresh) {
      // Words hidden in the gap just before are new too when the action wrote from inside it.
      if (fresh < i) run.push(gap + cell);
      else {
        cells.push(gap);
        run.push(cell);
      }
    } else (run.length ? run : cells).push(gap + cell);
  });
  if (run.length) cells.push(`<li class="chgrun"><ol class="tape-cells">${run.join("")}</ol></li>`);
  return `<ol class="tape-cells">${cells.join("")}</ol>`;
}

export function tapeMeta(s: Ms, S: MsStrings): string {
  return fill(S.tapeMeta, { len: plural(S, s.length, "byte1", "byteN"), words: words(S, s.length / 8), blocks: plural(S, Math.ceil(s.length / SM_BLKSZ), "block1", "blockN"), alloc: bytes(S, s.alloc) });
}

/** The fields of one word, as space_map.h L104-L140 draws them, high bits first. */
function fields(S: MsStrings, e: Entry, w: bigint, second: boolean): { name: string; bits: string; width: number; value: string; cls: string }[] {
    const v = (low: number, len: number) => (w >> BigInt(low)) & ((1n << BigInt(len)) - 1n);
  const h = (x: bigint) => "0x" + x.toString(16).toUpperCase();
  if (e.kind === "debug")
    return [
      { name: S.fPrefix, bits: "63–62", width: 2, value: "10", cls: "pre" },
      { name: S.fAction, bits: "61–60", width: 2, value: String(v(60, 2)), cls: "act" },
      { name: S.fPass, bits: "59–50", width: 10, value: String(v(50, 10)), cls: "pass" },
      { name: "txg", bits: "49–0", width: 50, value: String(v(0, 50)), cls: "txg" },
    ];
  if (e.kind === "one")
    return [
      { name: S.fPrefix, bits: "63", width: 1, value: "0", cls: "pre" },
      { name: S.fOffset, bits: "62–16", width: 47, value: h(v(16, 47)), cls: "off" },
      { name: "type", bits: "15", width: 1, value: String(v(15, 1)), cls: "typ" },
      { name: S.fRun1, bits: "14–0", width: 15, value: h(v(0, 15)), cls: "run" },
    ];
  if (!second)
    return [
      { name: S.fPrefix, bits: "63–62", width: 2, value: "11", cls: "pre" },
      { name: "pad", bits: "61–60", width: 2, value: "0", cls: "pad" },
      { name: S.fRun1, bits: "59–24", width: 36, value: h(v(24, 36)), cls: "run" },
      { name: "vdev", bits: "23–0", width: 24, value: String(v(0, 24)), cls: "vdv" },
    ];
  return [
    { name: "type", bits: "63", width: 1, value: String(v(63, 1)), cls: "typ" },
    { name: S.fOffset, bits: "62–0", width: 63, value: h(v(0, 63)), cls: "off" },
  ];
}

export function bits(s: Ms, S: MsStrings, sel: number | null): string {
  const e = sel === null ? undefined : s.tape[sel];
  if (!e) return `<p class="none">${S.bitsNone}</p>`;
  const rows = e.words
    .map((w, k) => {
      const fs = fields(S, e, w, k === 1);
      const boxes = fs
        .map((f) => `<span class="fb ${f.cls}" style="flex-grow:${f.width}"><span class="fn">${f.name}</span><span class="fbits">${fill(S.bitsRange, { r: f.bits, n: f.width })}</span><span class="fv">${f.value}</span></span>`)
        .join("");
      return `<div class="word"><p class="whex"><span class="muted">${fill(S.wordAt, { i: e.at + k })}</span> <code>${hex(w)}</code></p><div class="fields">${boxes}</div></div>`;
    })
    .join("");
  return `<div class="bits-head"><h4>${entryLabel(S, e)}</h4></div>${rows}<p class="bits-says">${says(S, e)}</p>`;
}

/** What an entry means, in words. */
function says(S: MsStrings, e: Entry): string {
  if (e.kind === "debug")
    return e.txg ? fill(S.saysDebug, { action: typeName(e.type), txg: e.txg }) : S.saysPad;
  const off = e.offset * 2 ** SM_SHIFT;
  const run = e.run * 2 ** SM_SHIFT;
  const base = fill(S.saysEntry, {
    type: typeName(e.type),
    off: offHex(e.offset),
    offb: bytes(S, off),
    at: offHex(MS_START + off),
    run: units(S, e.run),
    runb: bytes(S, run),
  });
  const why = fill(e.kind === "two" ? S.saysTwo : S.saysOne, { max: num(S, SM_RUN_MAX, 0) });
  const cond = e.condense ? ` ${S.saysCondense}` : "";
  return `${base} ${why}${cond}`;
}

// ---------- The condense test ----------

export function check(s: Ms, S: MsStrings): string {
  const c = shouldCondense(s);
  const yn = (b: boolean) => `<span class="yn ${b ? "yes" : "no"}">${b ? S.yes : S.no}</span>`;
  const pct = Math.min(1, c.object / c.t2);
  const line1 = fill(S.test1, { obj: num(S, c.object, 0), t1: num(S, c.t1, 0), opt: num(S, c.optimal, 0) });
  const line2 = fill(S.test2, { obj: num(S, c.object, 0), t2: num(S, c.t2, 0) });
  const verdict = c.empty ? S.verdictEmpty : c.yes ? S.verdictYes : S.verdictNo;
  return `<ul class="tests">
<li>${yn(c.object >= c.t1)} ${line1}</li>
<li>${yn(c.object > c.t2)} ${line2}<span class="meter" aria-hidden="true"><span style="width:${(pct * 100).toFixed(2)}%"></span></span></li>
</ul>
<p class="verdict ${c.yes ? "yes" : "no"}">${fill(S.verdictLine, { yn: yn(c.yes), verdict })}</p>`;
}

// ---------- Words for the screen reader and the text version ----------

export function summary(s: Ms, S: MsStrings): string {
  const c = shouldCondense(s);
  return fill(S.summary, {
    txg: s.txg,
    free: bytes(S, space(s.allocatable)),
    segs: plural(S, s.allocatable.length, "seg1", "segN"),
    len: plural(S, s.length, "byte1", "byteN"),
    entries: plural(S, s.tape.filter((e) => e.kind !== "debug").length, "entry1", "entryN"),
    verdict: c.yes ? S.yes : S.no,
  });
}

export function describe(s: Ms, S: MsStrings): string {
  const defs = deferred(s);
  const fl = s.files.length
    ? s.files.map((f) => `${f.id} (${bytes(S, f.blocks.length * BLOCK)}${(S.lang === "fr" ? "\u00a0: " : ": ")}${ranges(S, extents(f.blocks))}${f.deleting ? `, ${fill(S.fDeleting, { txg: s.txg })}` : f.pending !== null ? `, ${fill(S.fPending, { txg: f.pending })}` : ""})`).join((S.lang === "fr" ? "\u202f; " : "; "))
    : S.none;
  const last = s.tape.slice(-8).map((e) => `${hex(e.words[0])}${e.words[1] !== undefined ? ` ${hex(e.words[1])}` : ""} (${entryLabel(S, e)})`);
  return `<p>${fill(S.tIntro, { n: MS_COUNT, id: MS_ID, start: offHex(MS_START), txg: s.txg })}</p>
<ul>
<li>${fill(S.tFree, { free: bytes(S, space(s.allocatable)), list: ranges(S, s.allocatable, 6) || S.none })}</li>
<li>${fill(S.tOpen, { txg: s.txg, alloc: s.allocating.length ? ranges(S, s.allocating) : S.none, freeing: s.freeing.length ? ranges(S, s.freeing) : S.none })}</li>
<li>${defs.length ? defs.map((d) => fill(S.tDefer, { list: ranges(S, d.segs), freed: d.freed, back: d.back })).join(" ") : S.tNoDefer}</li>
<li>${fill(S.tFiles, { list: fl })}</li>
<li>${fill(S.tTape, { meta: tapeMeta(s, S) })} ${last.length ? fill(S.tLast, { list: last.join((S.lang === "fr" ? "\u202f; " : "; ")) }) : ""}</li>
</ul>
<p>${summary(s, S)}</p>`;
}

/** One line of the log, in plain words; the code is in the room's Source notes (DECISIONS.md D21.1). */
export function eventLine(S: MsStrings, e: Ev): string {
  switch (e.k) {
    case "write": {
      const how = e.picks.size || e.picks.bestfit
        ? fill(S.ePickMixed, { c: plural(S, e.picks.cursor, "block1", "blockN"), z: plural(S, e.picks.size + e.picks.bestfit, "block1", "blockN") })
        : fill(S.ePickCursor, { n: plural(S, e.picks.cursor, "block1", "blockN") });
      return fill(S.eWrite, { id: code(e.id), size: bytes(S, e.size), n: e.size / BLOCK, ext: plural(S, e.exts.length, "ext1", "extN") }) + ` ${how}`;
    }
    case "full":
      return fill(S.eFull, { size: bytes(S, e.size), free: bytes(S, e.free) });
    case "delete":
      return fill(S.eDelete, { id: code(e.id) });
    case "busy":
      return fill(S.eBusy, { id: code(e.id) });
    case "rewrite":
      return fill(S.eRewrite, { n: plural(S, e.n, "block1", "blockN"), txg: e.txg });
    case "condense":
      return fill(S.eCondense, { txg: e.txg, before: num(S, e.before, 0), after: num(S, e.after, 0) });
    case "append":
      return fill(e.type === SM_ALLOC ? S.eAppendAlloc : S.eAppendFree, { txg: e.txg, n: plural(S, e.entries, "entry1", "entryN"), w: words(S, e.words), from: e.from }) +
        (e.two ? ` ${fill(S.eTwo, { n: e.two })}` : "") + (e.pad ? ` ${plural(S, e.pad, "pad1", "padN")}` : "");
    case "nothing":
      return fill(S.eNothing, { txg: e.txg });
    case "deferBack":
      return fill(S.eDeferBack, { txg: e.txg, freed: e.freed, b: bytes(S, e.bytes) });
    case "defer":
      return fill(S.eDefer, { txg: e.txg, b: bytes(S, e.bytes), back: e.back });
    case "synced":
      return fill(S.eSynced, { txg: e.txg, len: plural(S, e.length, "byte1", "byteN"), alloc: bytes(S, e.alloc) });
    case "load":
      return fill(e.same ? S.eLoadSame : S.eLoadDiff, { n: plural(S, e.entries, "entry1", "entryN"), w: words(S, e.words), segs: plural(S, e.segs, "seg1", "segN"), d: bytes(S, e.deferred) });
    case "notClean":
      return fill(S.eNotClean, { txg: e.txg });
    case "refuse":
      return refuse(S, e.check);
    case "idle":
      return S.eIdle;
    case "churn":
      return fill(e.stopped ? S.eChurnStop : S.eChurn, { n: plural(S, e.txgs, "txg1", "txgN"), from: e.from, to: e.from + e.txgs - 1, b: plural(S, e.blocks, "block1", "blockN") });
  }
}

function refuse(S: MsStrings, c: Check): string {
  const why = [c.object >= c.t1 ? "" : fill(S.whyPct, { obj: num(S, c.object, 0), t1: num(S, c.t1, 0) }), c.object > c.t2 ? "" : fill(S.whyBlocks, { obj: num(S, c.object, 0), t2: num(S, c.t2, 0) })].filter(Boolean);
  return fill(S.eRefuse, { why: why.join(S.whyAnd) });
}

export const eventClass = (e: Ev) =>
  e.k === "append" ? "append" : e.k === "condense" ? "condense" : e.k === "refuse" || e.k === "busy" || e.k === "full" || e.k === "notClean" || e.k === "idle" ? "refused" : e.k === "defer" || e.k === "deferBack" ? "defer" : e.k === "synced" || e.k === "nothing" ? "synced" : "act";

