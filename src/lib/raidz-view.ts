// HTML for the RAID-Z room's figure, built from Layouts of src/lib/raidz.ts.
// Plain strings, no DOM: the page renders the default layout at build time
// (readable without JavaScript) and the script renders the visitor's choices
// with the same functions. No links to the code: they live in the room's
// Source notes (DECISIONS.md D21.1, D23.1).
import { decimal } from "./l10n";
import { needResilver, type Layout, type ReadResult, type Attempt } from "./raidz";

export type RzStrings = Record<string, string>;

/** The name of the i-th block written: A, B, C, ... */
export const blockName = (i: number) => String.fromCharCode(65 + (i % 26));

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** Bytes as the figure writes them: 512 B, 4 KiB, 1.5 KiB. */
export function bytes(n: number, lang: string): string {
  if (n < 1024) return `${n} ${lang === "fr" ? "o" : "B"}`;
  const k = n / 1024;
  const s = Number.isInteger(k) ? String(k) : k.toFixed(k < 10 ? 2 : 1).replace(/0+$/, "").replace(/\.$/, "");
  return `${decimal(lang, s)} ${lang === "fr" ? "Kio" : "KiB"}`;
}

const code = (s: string) => `<code>${s}</code>`;

/** The counters of vdev_raidz_map_alloc and psize_to_asize, with their values. */
export function readout(L: Layout, lang: string): string {
  const dw = L.dcols - L.nparity;
  const sector = 2 ** L.ashift;
  const asec = L.asize / sector;
  const rows: [string, string, string][] = [
    ["b", `io_offset / 2<sup>ashift</sup> = ${L.offset} / ${sector}`, String(L.b)],
    ["s", `⌈psize / 2<sup>ashift</sup>⌉ = ⌈${L.psize} / ${sector}⌉`, String(L.s)],
    ["f", `b % dcols = ${L.b} % ${L.dcols}`, String(L.f)],
    ["o", `b / dcols = ${L.b} / ${L.dcols}`, String(L.o)],
    ["q", `s / (dcols − nparity) = ${L.s} / ${dw}`, String(L.q)],
    ["r", `s − q × ${dw} = ${L.s} − ${L.q * dw}`, String(L.r)],
    ["bc", L.r === 0 ? "r = 0" : `r + nparity = ${L.r} + ${L.nparity}`, String(L.bc)],
    ["tot", `s + nparity × (q + ${L.r === 0 ? 0 : 1}) = ${L.s} + ${L.nparity} × ${L.q + (L.r === 0 ? 0 : 1)}`, String(L.tot)],
    ["acols", L.q === 0 ? "q = 0 : bc" : "dcols", String(L.acols)],
    ["scols", L.q === 0 ? `min(dcols, roundup(bc, ${L.nparity + 1}))` : "dcols", String(L.scols)],
    ["rm_nskip", `roundup(tot, ${L.nparity + 1}) − tot = ${L.tot + L.nskip} − ${L.tot}`, String(L.nskip)],
    [
      "asize",
      `roundup(${L.s} + ${L.nparity} × ⌈${L.s} / ${dw}⌉, ${L.nparity + 1}) = ${asec} × ${sector}`,
      `${L.asize} (${bytes(L.asize, lang)})`,
    ],
  ];
  const items = rows
    .map(([k, f, v]) => `<div><dt>${code(k)}</dt><dd><span class="f">${f}</span> <span class="eq">=</span> <strong>${v}</strong></dd></div>`)
    .join("");
  return `<dl class="rz-readout">${items}</dl>`;
}

/** A count of sectors: singular for 1, and for 0 in French. */
const count = (S: RzStrings, lang: string, n: number, one: string, many: string) =>
  fill((lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n });

/** One-line summary: sectors of each kind and the cost. */
export function summary(L: Layout, S: RzStrings, lang: string, name = "A"): string {
  const parity = L.cols.filter((c) => c.parity).reduce((a, c) => a + c.size, 0);
  const ratio = (L.asize / L.psize).toFixed(2);
  return fill(S.summary, {
    name,
    psize: bytes(L.psize, lang),
    s: count(S, lang, L.s, "secData1", "secDataN"),
    p: count(S, lang, parity, "secParity1", "secParityN"),
    k: count(S, lang, L.nskip, "secSkip1", "secSkipN"),
    asize: bytes(L.asize, lang),
    ratio: decimal(lang, ratio),
    used: L.acols,
    dcols: L.dcols,
  });
}

/** The rows the map shows at most: older blocks scroll off the top past this. */
export const MAX_ROWS = 30;

/**
 * The map: one column per child, one row per sector, a context row above and
 * below. `L` is the block the controls describe (drawn in full, numbered by
 * sector); `older` are the blocks written before it on the same vdev, drawn
 * faded and labelled with their letter, so the reader sees each stripe take
 * its own width.
 */
export function grid(L: Layout, S: RzStrings, older: Layout[] = []): string {
  const all = [...older, L];
  const end = (B: Layout) => Math.max(...B.cols.map((c) => c.off + c.size + (c.skip ? 1 : 0)));
  const last = Math.max(...all.map(end)) + 1; // one row of context below
  const lo = Math.max(0, Math.min(...all.map((B) => B.o)) - 1);
  // The live block is always drawn whole; older blocks may be cut at the top.
  const first = Math.min(Math.max(0, L.o - 1), Math.max(lo, last - MAX_ROWS));
  const nrows = last - first;
  const dense = nrows > 26;
  type Cell = { cls: string; label: string; order?: number; c?: number; block?: string };
  const cells: (Cell | null)[][] = Array.from({ length: L.dcols }, () => Array(nrows).fill(null));
  const put = (dev: number, row: number, cell: Cell) => {
    if (row >= first && row < last) cells[dev][row - first] = cell;
  };
  older.forEach((B, i) => {
    const name = blockName(i);
    const tone = `o o${i % 2}`;
    for (const col of B.cols) {
      for (let k = 0; k < col.size; k++) put(col.dev, col.off + k, { cls: col.parity ? `${tone} op` : tone, label: name, block: name });
      if (col.skip) put(col.dev, col.off + col.size, { cls: `${tone} k`, label: "", block: name });
    }
  });
  let order = 0;
  const data = L.cols.filter((c) => !c.parity && c.size > 0);
  for (const col of data)
    for (let i = 0; i < col.size; i++) put(col.dev, col.off + i, { cls: `d d${(col.c - L.nparity) % 2}`, label: String(col.data + i), order: order++, c: col.c });
  for (const col of L.cols.filter((c) => c.parity))
    for (let i = 0; i < col.size; i++) put(col.dev, col.off + i, { cls: "p", label: col.name, order: order++, c: col.c });
  for (const col of L.cols.filter((c) => c.skip)) put(col.dev, col.off + col.size, { cls: "k", label: "", order: order++, c: col.c });

  const role = Array.from({ length: L.dcols }, (_, d) => {
    const col = L.cols.find((c) => c.dev === d && (c.size > 0 || c.skip));
    return col ? (col.name || S.skipShort) : "";
  });
  const head = Array.from({ length: L.dcols }, (_, d) => `<span class="h${role[d] ? "" : " idle"}" data-dev="${d}">${d}</span>`).join("");
  const roles = role.map((r, d) => `<span class="role" data-dev="${d}">${r}</span>`).join("");
  let body = "";
  for (let i = 0; i < nrows; i++) {
    const row = first + i;
    const showRow = !dense || i === 0 || i === nrows - 1 || (row - first) % 8 === 0;
    body += `<span class="rn">${showRow ? row : ""}</span>`;
    for (let d = 0; d < L.dcols; d++) {
      const c = cells[d][i];
      if (!c) body += `<span class="cell e" data-dev="${d}"></span>`;
      else if (c.block) body += `<span class="cell ${c.cls}" data-dev="${d}" data-block="${c.block}">${dense ? "" : c.label}</span>`;
      else body += `<span class="cell ${c.cls}" data-dev="${d}" data-c="${c.c}" data-n="${c.order}">${dense ? "" : c.label}</span>`;
    }
  }
  return (
    `<div class="rz-grid${dense ? " dense" : ""}${L.dcols > 12 ? " wide" : ""}" style="--n:${L.dcols};--rows:${nrows}" data-total="${order}">` +
    `<span class="corner">${S.child}</span>${head}<span class="corner">${S.column}</span>${roles}${body}</div>`
  );
}

/** How many children a block touches, skip sectors included: its stripe width. */
export const width = (L: Layout) => new Set(L.cols.filter((c) => c.size > 0 || c.skip).map((c) => c.dev)).size;

/** Text version of the map, column by column, in the order of rr_col[]; older blocks in one line each. */
export function describe(L: Layout, S: RzStrings, lang: string, older: Layout[] = []): string {
  const items = L.cols.map((col) => {
    const v = { c: col.c, dev: col.dev, off: col.off, n: col.size, from: col.data, to: col.data + col.size - 1, name: col.name };
    let t = col.parity ? fill(S.dParity, { ...v, n: count(S, lang, col.size, "secParity1", "secParityN") }) : col.size > 0 ? fill(col.size === 1 ? S.dData1 : col.size === 2 ? S.dData2 : S.dData, v) : fill(S.dEmpty, v);
    if (col.skip) t += " " + fill(S.dSkip, { row: col.off + col.size });
    return `<li>${t}</li>`;
  });
  const swap = L.swapped ? `<p>${S.swapped}</p>` : "";
  const before = older.length
    ? `<p>${S.dBefore}</p><ul>${older.map((B, i) => `<li>${fill(S.dOlder, { name: blockName(i), psize: bytes(B.psize, lang), w: width(B), b: B.b, asize: bytes(B.asize, lang) })}</li>`).join("")}</ul>`
    : "";
  return `${before}<p>${summary(L, S, lang, blockName(older.length))}</p>${swap}<ol>${items.join("")}</ol>`;
}

const childList = (devs: number[], S: RzStrings) => devs.map((d) => fill(S.childN, { d })).join(", ");

/**
 * One step of a read, as the figure shows it: the text, and what it lights
 * up in the map. `lit`: columns read or used; `rebuilt`: data columns rebuilt
 * from parity; `sim`: children assumed wrong for this attempt; `fixed`:
 * columns written back; `tone`: whether the step ends well.
 */
export interface ReadStep {
  html: string;
  kind: "step" | "attempt" | "result";
  lit?: number[];
  rebuilt?: number[];
  sim?: number[];
  fixed?: number[];
  tone?: "ok" | "bad";
}

/** Attempts shown one per step: the first 12 and the last 3, the others in one line. */
export function shownAttempts(n: number): number[] {
  return n <= 16 ? [...Array(n).keys()] : [...Array(12).keys(), n - 3, n - 2, n - 1];
}

/** The read of the live block, one step per press of "Next step". */
export function readPlan(L: Layout, R: ReadResult, S: RzStrings, health: string[]): ReadStep[] {
  const name = (c: number) => L.cols[c].name;
  const dev = (c: number) => L.cols[c].dev;
  const names = (cs: number[]) => cs.map((c) => `${name(c)} (${fill(S.childN, { d: dev(c) })})`).join(", ");
  const byName = (ns: string[]) => ns.map((n) => L.cols.findIndex((c) => c.name === n)).filter((c) => c >= 0);
  const dataCols = L.cols.slice(0, L.acols).filter((c) => !c.parity).map((c) => c.c);
  const out: ReadStep[] = [];
  const step = (s: Omit<ReadStep, "kind">) => out.push({ kind: "step", ...s });
  if (R.missing.length) step({ html: fill(S.rMissing, { cols: names(R.missing) }), tone: "bad" });
  step({
    html: fill(R.firstRead.some((c) => L.cols[c].parity) ? S.rFirstParity : S.rFirst, { cols: R.firstRead.map(name).join(", ") }),
    lit: R.firstRead,
  });
  if (R.known) {
    const rebuilt = R.missing.filter((c) => !L.cols[c].parity);
    step({
      html: fill(R.known.ok ? S.rKnownOk : S.rKnownBad, { cols: rebuilt.map(name).join(", "), parity: R.known.parity.join(" + ") }),
      lit: byName(R.known.parity),
      rebuilt,
    });
  }
  if (R.firstCksum) step({ html: S.rCksumOk, lit: dataCols, tone: "ok" });
  else if (R.tooMany) step({ html: fill(S.rTooMany, { n: R.missing.length, np: L.nparity }), tone: "bad" });
  else {
    step({ html: S.rCksumBad, lit: dataCols, tone: "bad" });
    step({ html: R.readAll.length ? fill(S.rReadAll, { cols: R.readAll.map(name).join(", ") }) : S.rReadAllNone, lit: R.readAll });
    step({ html: fill(S.rCombrec, { np: L.nparity, n: L.dcols }) });
  }
  let shown = -1;
  for (const i of shownAttempts(R.attempts.length)) {
    const a = R.attempts[i];
    const more = i > shown + 1 ? `${fill(S.attemptsMore, { n: i - shown - 1 })} ` : "";
    shown = i;
    out.push({
      kind: "attempt",
      html: `${more}${fill(S.aN, { k: i + 1 })} ${attemptText(L, a, S)}`,
      sim: a.tgts,
      rebuilt: a.outcome === "einval" ? [] : a.rebuilt,
      tone: a.outcome === "ok" ? "ok" : undefined,
    });
  }
  let result: string;
  if (!R.ok) result = R.tooMany ? S.rFailTooMany : S.rFail;
  else {
    const parts: string[] = [];
    const win = R.attempts.find((a) => a.outcome === "ok");
    parts.push(win ? fill(S.rFound, { k: R.attempts.length, tgts: childList(win.tgts, S) }) : S.rOk);
    if (R.repaired.length) parts.push(fill(S.rRepaired, { cols: names(R.repaired) }));
    if (R.parityVerified && !R.repaired.some((c) => L.cols[c].parity) && R.firstRead.some((c) => L.cols[c].parity)) parts.push(S.rParityChecked);
    if (R.undetected.length) parts.push(fill(S.rUndetected, { cols: names(R.undetected) }));
    result = parts.join(" ");
  }
  const missing = health.map((h, d) => (h === "missing" ? d : -1)).filter((d) => d >= 0);
  if (missing.length) {
    const list = childList(missing, S);
    const all = L.s + L.nparity >= L.dcols;
    result += " " + fill(all ? S.resilverAll : needResilver(L, missing) ? S.resilverYes : S.resilverNo, { list });
  }
  out.push({ kind: "result", html: result, fixed: R.repaired, tone: R.ok ? "ok" : "bad" });
  return out;
}

export function attemptText(L: Layout, a: Attempt, S: RzStrings): string {
  const tg = childList(a.tgts, S);
  const hit = a.cols.map((c) => L.cols[c].name).join(", ");
  if (a.outcome === "einval") return fill(S.aEinval, { tgts: tg, dead: a.dead, np: L.nparity });
  const what = !a.cols.length && !a.rebuilt.length
    ? S.aNotInStripe
    : a.deadData === 0
      ? fill(S.aParityOnly, { cols: hit })
      : fill(S.aRebuilt, { cols: a.rebuilt.map((c) => L.cols[c].name).join(", "), parity: a.parity.join(" + ") });
  return `${fill(S.aTry, { tgts: tg })} ${what} ${a.outcome === "ok" ? S.aOk : S.aCksum}`;
}
