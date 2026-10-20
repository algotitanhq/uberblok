// HTML for the RAID-Z room's figure, built from a Layout of src/lib/raidz.ts.
// Plain strings, no DOM: the page renders the default layout at build time
// (readable without JavaScript) and the script renders the visitor's choices
// with the same functions.
import { decimal } from "./l10n";
import type { Layout, ReadResult, Attempt } from "./raidz";

export type RzStrings = Record<string, string> & { refs: Record<string, string> };

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
const ref = (href: string, label: string) => `<a href="${href}">${label}</a>`;

/** The counters of vdev_raidz_map_alloc and psize_to_asize, with their values. */
export function readout(L: Layout, S: RzStrings, lang: string): string {
  const dw = L.dcols - L.nparity;
  const sector = 2 ** L.ashift;
  const asec = L.asize / sector;
  const rows: [string, string, string, string][] = [
    ["s", `⌈psize / 2<sup>ashift</sup>⌉ = ⌈${L.psize} / ${sector}⌉`, String(L.s), "s"],
    ["f", `b % dcols = ${L.b} % ${L.dcols}`, String(L.f), "f"],
    ["o", `b / dcols = ${L.b} / ${L.dcols}`, String(L.o), "o"],
    ["q", `s / (dcols − nparity) = ${L.s} / ${dw}`, String(L.q), "q"],
    ["r", `s − q × ${dw} = ${L.s} − ${L.q * dw}`, String(L.r), "r"],
    ["bc", L.r === 0 ? "r = 0" : `r + nparity = ${L.r} + ${L.nparity}`, String(L.bc), "bc"],
    ["tot", `s + nparity × (q + ${L.r === 0 ? 0 : 1}) = ${L.s} + ${L.nparity} × ${L.q + (L.r === 0 ? 0 : 1)}`, String(L.tot), "tot"],
    ["acols", L.q === 0 ? "q = 0 : bc" : "dcols", String(L.acols), "cols"],
    ["scols", L.q === 0 ? `min(dcols, roundup(bc, ${L.nparity + 1}))` : "dcols", String(L.scols), "cols"],
    ["rm_nskip", `roundup(tot, ${L.nparity + 1}) − tot = ${L.tot + L.nskip} − ${L.tot}`, String(L.nskip), "nskip"],
    [
      "asize",
      `roundup(${L.s} + ${L.nparity} × ⌈${L.s} / ${dw}⌉, ${L.nparity + 1}) = ${asec} × ${sector}`,
      `${L.asize} (${bytes(L.asize, lang)})`,
      "asize",
    ],
  ];
  const items = rows
    .map(
      ([k, f, v, r]) =>
        `<div><dt>${code(k)}</dt><dd><span class="f">${f}</span> <span class="eq">=</span> <strong>${v}</strong> ${ref(S.refs[r], S.see)}</dd></div>`,
    )
    .join("");
  return `<dl class="rz-readout">${items}</dl>`;
}

/** A count of sectors: singular for 1, and for 0 in French. */
const count = (S: RzStrings, lang: string, n: number, one: string, many: string) =>
  fill((lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n });

/** One-line summary: sectors of each kind and the cost. */
export function summary(L: Layout, S: RzStrings, lang: string): string {
  const parity = L.cols.filter((c) => c.parity).reduce((a, c) => a + c.size, 0);
  const ratio = (L.asize / L.psize).toFixed(2);
  return fill(S.summary, {
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

/** The map: one column per child, one row per sector from o, a context row above and below. */
export function grid(L: Layout, S: RzStrings): string {
  const first = Math.max(0, L.o - 1);
  let last = 0;
  for (const c of L.cols) last = Math.max(last, c.off + c.size + (c.skip ? 1 : 0));
  last += 1; // one row of context below
  const nrows = last - first;
  const dense = nrows > 26;
  // cell[dev][row] = what is there
  type Cell = { cls: string; label: string; order: number; c: number };
  const cells: (Cell | null)[][] = Array.from({ length: L.dcols }, () => Array(nrows).fill(null));
  let order = 0;
  const put = (dev: number, row: number, cell: Cell) => {
    if (row >= first && row < last) cells[dev][row - first] = cell;
  };
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
  const head = Array.from({ length: L.dcols }, (_, d) => `<span class="h" data-dev="${d}">${d}</span>`).join("");
  const roles = role.map((r, d) => `<span class="role" data-dev="${d}">${r}</span>`).join("");
  let body = "";
  for (let i = 0; i < nrows; i++) {
    const row = first + i;
    const showRow = !dense || i === 0 || i === nrows - 1 || (row - first) % 8 === 0;
    body += `<span class="rn">${showRow ? row : ""}</span>`;
    for (let d = 0; d < L.dcols; d++) {
      const c = cells[d][i];
      body += c
        ? `<span class="cell ${c.cls}" data-dev="${d}" data-c="${c.c}" data-n="${c.order}">${dense ? "" : c.label}</span>`
        : `<span class="cell e" data-dev="${d}"></span>`;
    }
  }
  return (
    `<div class="rz-grid${dense ? " dense" : ""}${L.dcols > 12 ? " wide" : ""}" style="--n:${L.dcols};--rows:${nrows}" data-total="${order}">` +
    `<span class="corner">${S.child}</span>${head}<span class="corner">${S.column}</span>${roles}${body}</div>`
  );
}

/** Text version of the map, column by column, in the order of rr_col[]. */
export function describe(L: Layout, S: RzStrings, lang: string): string {
  const items = L.cols.map((col) => {
    const v = { c: col.c, dev: col.dev, off: col.off, n: col.size, from: col.data, to: col.data + col.size - 1, name: col.name };
    let t = col.parity ? fill(S.dParity, { ...v, n: count(S, lang, col.size, "secParity1", "secParityN") }) : col.size > 0 ? fill(col.size === 1 ? S.dData1 : col.size === 2 ? S.dData2 : S.dData, v) : fill(S.dEmpty, v);
    if (col.skip) t += " " + fill(S.dSkip, { row: col.off + col.size });
    return `<li>${t}</li>`;
  });
  const swap = L.swapped ? `<p>${S.swapped}</p>` : "";
  return `<p>${summary(L, S, lang)}</p>${swap}<ol>${items.join("")}</ol>`;
}

const childList = (devs: number[], S: RzStrings) => devs.map((d) => fill(S.childN, { d })).join(", ");

/** The read, step by step, as list items (HTML). */
export function readSteps(L: Layout, R: ReadResult, S: RzStrings): { steps: string[]; attempts: string[]; result: string } {
  const name = (c: number) => L.cols[c].name;
  const dev = (c: number) => L.cols[c].dev;
  const names = (cs: number[]) => cs.map((c) => `${name(c)} (${fill(S.childN, { d: dev(c) })})`).join(", ");
  const steps: string[] = [];
  if (R.missing.length) steps.push(`${fill(S.rMissing, { cols: names(R.missing) })} ${ref(S.refs.enxio, S.see)}`);
  steps.push(
    `${fill(R.firstRead.some((c) => L.cols[c].parity) ? S.rFirstParity : S.rFirst, { cols: R.firstRead.map(name).join(", ") })} ${ref(S.refs.readRow, S.see)}`,
  );
  if (R.known) steps.push(`${fill(R.known.ok ? S.rKnownOk : S.rKnownBad, { cols: R.missing.filter((c) => !L.cols[c].parity).map(name).join(", "), parity: R.known.parity.join(" + ") })} ${ref(S.refs.known, S.see)}`);
  if (R.firstCksum) steps.push(`${S.rCksumOk} ${ref(S.refs.cksum, S.see)}`);
  else if (R.tooMany) steps.push(`${fill(S.rTooMany, { n: R.missing.length, np: L.nparity })} ${ref(S.refs.tooMany, S.see)}`);
  else {
    steps.push(`${S.rCksumBad} ${ref(S.refs.cksum, S.see)}`);
    steps.push(`${R.readAll.length ? fill(S.rReadAll, { cols: R.readAll.map(name).join(", ") }) : S.rReadAllNone} ${ref(S.refs.readAll, S.see)}`);
    steps.push(`${fill(S.rCombrec, { np: L.nparity, n: L.dcols })} ${ref(S.refs.combrec, S.see)}`);
  }
  const attempts = R.attempts.map((a) => attemptText(L, a, S));
  let result: string;
  if (!R.ok) result = `${R.tooMany ? S.rFailTooMany : S.rFail} ${ref(S.refs.unrecoverable, S.see)}`;
  else {
    const parts: string[] = [];
    const win = R.attempts.find((a) => a.outcome === "ok");
    parts.push(win ? fill(S.rFound, { k: R.attempts.length, tgts: childList(win.tgts, S) }) : S.rOk);
    if (R.repaired.length) parts.push(`${fill(S.rRepaired, { cols: names(R.repaired) })} ${ref(S.refs.repair, S.see)}`);
    if (R.parityVerified && !R.repaired.some((c) => L.cols[c].parity) && R.firstRead.some((c) => L.cols[c].parity))
      parts.push(`${S.rParityChecked} ${ref(S.refs.parityVerify, S.see)}`);
    if (R.undetected.length) parts.push(`${fill(S.rUndetected, { cols: names(R.undetected) })} ${ref(S.refs.scrub, S.see)}`);
    result = parts.join(" ");
  }
  return { steps, attempts, result };
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
