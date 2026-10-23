// HTML and SVG for the vdevs room's figure, built from src/lib/vdevs.ts.
// Plain strings, no DOM: the page renders a first state at build time
// (readable without JavaScript) and the script renders every later state with
// the same functions. The 3D scene (src/lib/vdevs-3d.ts) draws the same state.
import { and } from "./l10n";
import {
  COPIES, OPS, classOfTop, classVdevs, isLeaf, leavesOf, topLevels, topOf, walk,
  type Block, type ClassName, type Hop, type Kind, type Pool, type Step, type Vdev,
} from "./vdevs";

export type VdStrings = Record<string, string> & { refs: Record<string, string>; lang: string };

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const see = (S: VdStrings, r: string) => (S.refs[r] ? ` <a class="see" href="${S.refs[r]}">${S.see}</a>` : "");
const strip = (html: string) => html.replace(/ ?<a class="see"[^>]*>[^<]*<\/a>/g, "");
/** What the live region reads: the line without its code links and tags. */
// Collapses ASCII white space only: the French no-break spaces stay (D1.9).
export const spoken = (html: string) => strip(html).replace(/<[^>]+>/g, "").replace(/[ \t\r\n]+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const code = (s: string) => `<code>${s}</code>`;

/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
export const plural = (S: VdStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n });
export const size = (S: VdStrings, b: number) => (b === 0 ? S.zero : fill(S.kib, { n: b / 1024 }));
/** A list in the page's language: "a, b and c" / « a, b et c ». */
export function list(S: VdStrings, xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")}${and(S.lang)}${xs[xs.length - 1]}`;
}
const clsName = (S: VdStrings, c: ClassName) => S[`c_${c}`];
const name = (p: Pool, id: string) => p.vdevs[id]?.name ?? id;

// ------------------------------------------------------------------ the 2D tree

const ROW = 30;
const INDENT = 22;
const W = 360;

/** The highlight of one I/O: depth at which each vdev is reached, sectors at the leaves, roles. */
export function litMap(h: Hop | null): Map<string, { depth: number; sectors?: number; role?: string }> {
  const m = new Map<string, { depth: number; sectors?: number; role?: string }>();
  const go = (x: Hop, depth: number) => {
    if (x.vdev !== "zio" && !m.has(x.vdev)) m.set(x.vdev, { depth, sectors: x.kids.length ? undefined : x.sectors, role: x.role });
    for (const k of x.kids) go(k, depth + 1);
  };
  if (h) go(h, 0);
  return m;
}

/**
 * The tree as an indented SVG drawing, as zpool status lists it, with the last I/O lit.
 * `hit`: the top-level vdevs that hold a copy of the last block, ringed, their count in the accent.
 */
export function treeSvg(S: VdStrings, p: Pool, h: Hop | null, selected: string | null, hit: string[] = []): string {
  const rows = walk(p);
  const lit = litMap(h);
  const y = (i: number) => 14 + i * ROW;
  const at = new Map(rows.map((r, i) => [r.v.id, i]));
  const counts = blocksPerTop(p);
  let lines = "";
  let nodes = "";
  rows.forEach(({ v, depth }, i) => {
    const x = 8 + depth * INDENT;
    if (v.parent) {
      const pi = at.get(v.parent)!;
      const px = 8 + (depth - 1) * INDENT + 9;
      const on = lit.has(v.id) ? " on" : "";
      lines += `<path class="edge${on}" data-edge="${esc(v.id)}" data-depth="${lit.get(v.id)?.depth ?? 0}" d="M${px} ${y(pi) + 9}V${y(i)}H${x}"/>`;
    }
    const top = v.parent === "root";
    const cls = top ? classOfTop(v) : "";
    const l = lit.get(v.id);
    const label = esc(v.name);
    const type = OPS[v.type].type;
    const tw = Math.max(48, v.name.length * 7.3 + 14);
    const badge = l?.sectors !== undefined
      ? `<text class="sec" x="${x + tw + 6 + type.length * 6.4 + 10}" y="${y(i) + 4}">${l.role && l.role !== "skip" && l.role !== "spare" && !l.role.startsWith("DVA") ? `${esc(l.role)} ` : ""}${plural(S, l.sectors, "sector1", "sectorN")}</text>`
      : "";
    const isHit = top && hit.includes(v.id);
    const landed = top && counts.get(v.id) ? `<g class="landed${isHit ? " last" : ""}"><rect x="${W - 34}" y="${y(i) - 8}" width="12" height="12" rx="2"/><text x="${W - 18}" y="${y(i) + 3}">${counts.get(v.id)}</text></g>` : "";
    nodes += `<g class="n t-${v.type}${cls ? ` c-${cls}` : ""}${l ? " on" : ""}${v.id === selected ? " sel" : ""}${isHit ? " hit" : ""}" data-node="${esc(v.id)}" data-depth="${l?.depth ?? 0}">`
      + (isHit ? `<rect class="ring" x="${x - 3}" y="${y(i) - 13}" width="${tw + 6}" height="26" rx="6"/>` : "")
      + `<rect x="${x}" y="${y(i) - 10}" width="${tw}" height="20" rx="4"/>`
      + (top ? `<rect class="bias" x="${x}" y="${y(i) - 10}" width="4" height="20" rx="1"/>` : "")
      + `<text class="nm" x="${x + 8}" y="${y(i) + 4}">${label}</text>`
      + `<text class="ty" x="${x + tw + 6}" y="${y(i) + 4}">${type}</text>${badge}${landed}</g>`;
  });
  const h2 = 14 + rows.length * ROW - 8;
  return `<svg class="vd-tree" viewBox="0 0 ${W} ${h2}" role="img" aria-label="${esc(spoken(treeText(S, p)))}">${lines}${nodes}</svg>`;
}

/** How many blocks have a DVA on each top-level vdev. */
export function blocksPerTop(p: Pool): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of p.blocks) for (const top of new Set(b.dvas.map((d) => d.top))) m.set(top, (m.get(top) ?? 0) + 1);
  return m;
}

// ------------------------------------------------------------------ panels

function stepLine(S: VdStrings, s: Step): string {
  const v: Record<string, string | number> = {};
  for (const [k, x] of Object.entries(s.v ?? {})) v[k] = k === "cls" ? clsName(S, x as ClassName) : k === "size" || k === "smallblk" ? size(S, x as number) : x;
  const ref = s.key.startsWith("zil") ? "zilOrder" : s.key === "enospc" ? "fallback" : s.key.startsWith("pcDdt") ? "pcDdt" : "pcRest";
  return fill(S[s.key], v) + see(S, ref);
}

const dvaText = (S: VdStrings, p: Pool, b: Block) =>
  b.dvas.map((d, i) => (d.group !== undefined ? fill(S.dvaGroup, { d: i, top: name(p, d.top), g: d.group }) : fill(S.dvaOn, { d: i, top: name(p, d.top) }))).join(", ");

/** The decision for a block: its class and why, then its DVAs. */
export function decisionHtml(S: VdStrings, p: Pool, b: Block): string {
  const steps = b.decision.map((s, i) => `<li class="${i === b.decision.length - 1 ? "taken" : "pass"}">${stepLine(S, s)}</li>`).join("");
  const copies = fill(S.copiesLine, { dvas: plural(S, COPIES[b.kind], "copy1", "copyN"), why: S[`copies_${b.kind}`] }) + see(S, "copies");
  return `<ol class="path">${steps}<li class="taken">${cap(copies)} ${dvaText(S, p, b)}.${see(S, "ditto")}</li></ol>`;
}

function hopLine(S: VdStrings, p: Pool, x: Hop): string {
  const v = p.vdevs[x.vdev];
  const role = x.role && !x.role.startsWith("DVA") ? `<span class="role">${x.role === "skip" ? S.role_skip : x.role === "spare" ? S.role_spare : x.role}</span> ` : x.role ? `<span class="role">${x.role}</span> ` : "";
  const what = x.rule === "all" ? S.r_all
    : x.rule === "one" ? (x.skipped?.length ? fill(S.r_oneSkip, { skipped: list(S, x.skipped.map((k) => code(name(p, k.vdev)))) }) : S.r_one)
    : x.rule === "columns" ? fill(S.r_columns, { cols: plural(S, x.kids.length, "col1", "colN") })
    : x.rule === "redirect" ? fill(S.r_redirect, { to: name(p, x.kids[0]?.vdev ?? "") })
    : plural(S, x.sectors ?? 0, "sector1", "sectorN");
  const ref = x.rule === "all" || x.rule === "one" ? "mirrorIo" : v.type === "raidz" ? "raidzIo" : v.type === "draid" ? "draidIo" : x.rule === "redirect" ? "dspareIo" : "";
  return `${role}${code(v.name)} <span class="ty">${OPS[v.type].type}</span> ${x.fn ? fill(S.hopFn, { fn: x.fn }) : ""}${S.colon}${what}${ref ? see(S, ref) : ""}`;
}

/** The I/O as a nested list, from the logical zio to the leaves. */
export function walkHtml(S: VdStrings, p: Pool, b: Block, h: Hop, type: "write" | "read"): string {
  const sub = (x: Hop): string => `<li>${hopLine(S, p, x)}${x.kids.length ? `<ul>${x.kids.map(sub).join("")}</ul>` : ""}</li>`;
  const head = fill(type === "write" ? S.walkWrite : b.dvas.length === 1 ? S.walkRead1 : S.walkRead, { dvas: plural(S, b.dvas.length, "copy1", "copyN") }) + see(S, "logical");
  return `<p class="walk-head">${head}</p><ul class="walk">${h.kids.map(sub).join("")}</ul>`;
}

export interface LastIo {
  block: Block;
  trace: Hop;
  type: "write" | "read";
}

export function lastHtml(S: VdStrings, p: Pool, io: LastIo | null): string {
  if (!io) return `<p class="muted">${S.noIo}</p>`;
  const b = io.block;
  const head = io.type === "write"
    ? fill(S.lastHead, { n: b.n, kind: S[`k_${b.kind}`], txg: b.txg, cls: fill(S.clsOf, { cls: clsName(S, b.cls) }) })
    : fill(S.lastHeadRead, { n: b.n, kind: S[`k_${b.kind}`], txg: b.txg });
  return `<p class="last-head" data-kind="${b.kind}" data-cls="${b.cls}" data-tops="${b.dvas.map((d) => d.top).join(",")}" data-io="${io.type}">${head}</p>${io.type === "write" ? decisionHtml(S, p, b) : ""}<h4>${S.walkTitle}</h4>${walkHtml(S, p, b, io.trace, io.type)}`;
}

/** The classes, their top-level vdevs, and how many blocks landed there; `hit`, the last block's class, is outlined. */
export function classesHtml(S: VdStrings, p: Pool, hit: ClassName | null = null): string {
  const counts = new Map<ClassName, number>();
  for (const b of p.blocks) counts.set(b.cls, (counts.get(b.cls) ?? 0) + 1);
  const rows = (["normal", "log", "special", "dedup", "embedded_log", "special_embedded_log"] as ClassName[]).map((c) => {
    const vs = classVdevs(p, c);
    return `<tr class="cl-${c}${vs.length ? "" : " empty"}${c === hit ? " hit" : ""}"><th scope="row"><span class="sw sw-${c}" aria-hidden="true"></span>${clsName(S, c)}</th><td>${vs.length ? vs.map((id) => code(name(p, id))).join(", ") : S.noVdev}</td><td class="num">${counts.get(c) ?? 0}</td></tr>`;
  }).join("");
  return `<table class="classes"><thead><tr><th scope="col">${S.thClass}</th><th scope="col">${S.thVdevs}</th><th scope="col">${S.thBlocks}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** What each look of the tree means; the same from the start, so an action changes the drawing, never the key. */
export function legendHtml(S: VdStrings): string {
  const sw = (cls: string) => `<span class="lg-sw ${cls}" aria-hidden="true"></span>`;
  const bias = (["normal", "log", "special", "dedup"] as ClassName[]).map((c) => `${sw(`lg-bias sw-${c}`)}${clsName(S, c)}`).join(" ");
  const items = [
    `${S.lg_bias}${S.colon}${bias}`,
    `${sw("lg-path")}${S.lg_path}`,
    `${sw("lg-hit")}${S.lg_hit}`,
    `${sw("lg-count")}${S.lg_count}`,
    `${sw("lg-sel")}${S.lg_sel}`,
    `${sw("lg-rep")}${S.lg_rep}`,
  ];
  return `<p class="lg-title">${S.legendTitle}</p><ul class="vd-legend">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`;
}

/** The top-level vdevs that hold a copy of a block. */
export const topsOf = (b: Block | null | undefined) => (b ? [...new Set(b.dvas.map((d) => d.top))] : []);

/** Hot spares and cache devices: beside the tree, not in it. */
export function auxHtml(S: VdStrings, p: Pool): string {
  const item = (id: string) => {
    const v = p.vdevs[id];
    const note = v.type === "dspare" ? `, ${S.dspareNote}` : "";
    const state = p.spareInUse[id] ? S.inUse : S.available;
    return `<li data-aux="${esc(id)}" class="${p.spareInUse[id] ? "inuse" : ""}">${code(v.name)} <span class="ty">${OPS[v.type].type}</span>, ${state}${note}</li>`;
  };
  return `<div class="aux-list"><p>${S.sparesLabel}${see(S, "aux")}</p><ul>${p.spares.map(item).join("")}</ul><p>${S.cacheLabel}</p><ul>${p.l2cache.map((id) => `<li data-aux="${esc(id)}">${code(p.vdevs[id].name)} <span class="ty">disk</span></li>`).join("")}</ul></div>`;
}

/** The selected node: its ops table and its place in the tree. */
export function opsHtml(S: VdStrings, p: Pool, id: string): string {
  const v = p.vdevs[id];
  if (!v) return "";
  const o = OPS[v.type];
  const fn = (x: string | null) => (x ? code(x) : code(S.fNull));
  const rows: [string, string][] = [
    [code("vdev_ops"), code(`&${o.table}`)],
    [code("vdev_op_type"), code(`"${o.type}"`)],
    [code("vdev_op_io_start"), fn(o.ioStart)],
    [code("vdev_op_io_done"), fn(o.ioDone)],
    [code("vdev_op_psize_to_asize"), fn(o.asize)],
    [code("vdev_op_need_resilver"), fn(o.needResilver)],
    [code("vdev_op_leaf"), code(o.leaf ? S.fTrue : S.fFalse)],
  ];
  if (v.parent || v.id === "root") {
    rows.push([S.fParent, v.parent ? code(name(p, v.parent)) : code(S.fNull)]);
    if (v.id !== "root") rows.push([S.fTop, code(topOf(p, v.id).name)]);
    rows.push([S.fChildren, String(v.kids.length)]);
  }
  if (v.parent === "root") {
    const c = classOfTop(v);
    rows.push([S.fBias, code(S[`bias_${v.bias ?? "none"}`])]);
    rows.push([S.fGroups, c === "log" ? S.groupsLineLog : fill(S.groupsLine, { cls: clsName(S, c), log: clsName(S, c === "special" ? "special_embedded_log" : "embedded_log") })]);
  } else if (v.parent) {
    rows.push([S.fGroups, S.groupsNone]);
  }
  const aux = !v.parent && v.id !== "root" ? `<p class="muted">${fill(S.auxNode, { list: code(p.spares.includes(id) ? "spa_spares" : "spa_l2cache") })}</p>` : "";
  const body = rows.map(([k, x]) => `<tr><th scope="row">${k}</th><td>${x}</td></tr>`).join("");
  return `<p class="ops-name">${code(v.name)}${see(S, `ops_${v.type}`)}</p>${aux}<table class="ops"><thead><tr><th scope="col">${S.thField}</th><th scope="col">${S.thValue}</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** The options of the node selector: every node of the tree, indented, then the spares and cache. */
export function nodeOptions(S: VdStrings, p: Pool, selected: string): string {
  const opt = (v: Vdev, depth: number) =>
    `<option value="${esc(v.id)}"${v.id === selected ? " selected" : ""}>${"  ".repeat(depth)}${esc(fill(S.nodeOpt, { name: v.name, type: OPS[v.type].type }))}</option>`;
  const tree = walk(p).map(({ v, depth }) => opt(v, depth)).join("");
  const aux = [...p.spares, ...p.l2cache].filter((id) => !p.vdevs[id].parent).map((id) => opt(p.vdevs[id], 0)).join("");
  return tree + aux;
}

// ------------------------------------------------------------------ words for the live region and the text version

export function dropLine(S: VdStrings, p: Pool, b: Block, h: Hop): string {
  const tops = [...new Set(b.dvas.map((d) => code(name(p, d.top))))];
  return cap(fill(S.sayDrop, {
    kind: S[`k_${b.kind}`], cls: fill(S.clsOf, { cls: clsName(S, b.cls) }), dvas: plural(S, b.dvas.length, "copy1", "copyN"),
    tops: list(S, tops), disks: plural(S, new Set(leavesOf(h)).size, "disk1", "diskN"),
  }));
}

export function readLine(S: VdStrings, p: Pool, b: Block, h: Hop): string {
  return fill(S.sayRead, { top: code(name(p, b.dvas[0].top)), disks: list(S, leavesOf(h).map((id) => code(name(p, id)))) });
}

export function replaceLine(S: VdStrings, p: Pool, old: string, node: string, added: string): string {
  return fill(S.sayReplace, { old: code(name(p, old)), node: code(name(p, node)), type: code(p.vdevs[node].type), added: code(name(p, added)) }) + see(S, "replacingOps");
}

export function resilverLine(S: VdStrings, before: Pool, after: Pool, collapsed: string[], kept: string[]): string {
  if (!collapsed.length && !kept.length) return S.sayNothing;
  const parts = [S.sayResilver];
  for (const id of collapsed) {
    const v = before.vdevs[id];
    parts.push(fill(S.sayCollapsed, { node: code(v.name), added: code(name(after, v.kids[v.kids.length - 1])) }));
  }
  for (const id of kept) parts.push(fill(S.sayKept, { node: code(after.vdevs[id].name) }));
  return parts.join(" ") + see(S, "resilverDone");
}

export function poolLine(S: VdStrings, p: Pool): string {
  return fill(S.sayPool, { list: list(S, topLevels(p).map((v) => `${code(v.name)} (${clsName(S, classOfTop(v))})`)) });
}

export function selectLine(S: VdStrings, p: Pool, id: string): string {
  const v = p.vdevs[id];
  return fill(S.saySelect, { name: code(v.name), type: code(OPS[v.type].type), table: code(OPS[v.type].table) });
}

/** The tree in words, for the text version and the drawing's label. */
export function treeText(S: VdStrings, p: Pool): string {
  const items = walk(p).map(({ v, depth }) => {
    const kids = plural(S, v.kids.length, "child1", "childN");
    const t = isLeaf(v) ? fill(S.tvLeaf, { name: v.name, type: v.type }) : v.parent === "root"
      ? fill(S.tvTop, { name: v.name, type: v.type, children: kids, cls: clsName(S, classOfTop(v)) })
      : fill(S.tvNode, { name: v.name, type: v.type, children: kids });
    return `${"— ".repeat(depth)}${t}`;
  });
  const free = (ids: string[]) => list(S, ids.map((id) => `${p.vdevs[id].name}${p.spareInUse[id] ? ` (${S.inUse})` : ""}`));
  return `${S.tvTree} ${items.join((S.lang === "fr" ? "\u202f; " : "; "))}. ${fill(S.tvAux, { spares: free(p.spares), cache: free(p.l2cache) })}`;
}

export function describe(S: VdStrings, p: Pool, io: LastIo | null): string {
  const tree = walk(p).map(({ v, depth }) => `<li style="margin-left:${depth}em">${code(v.name)} ${v.type}${v.parent === "root" ? `, ${clsName(S, classOfTop(v))}` : ""}</li>`).join("");
  const last = io ? `<p>${S.tvLast}</p>${strip(lastHtml(S, p, io)).replace(/<h4>/g, "<p>").replace(/<\/h4>/g, "</p>")}` : "";
  return `<p>${S.tvTree}</p><ul class="tv-tree">${tree}</ul><p>${fill(S.tvAux, { spares: list(S, p.spares.map((id) => p.vdevs[id].name)), cache: list(S, p.l2cache.map((id) => p.vdevs[id].name)) })}</p>${last}`;
}

export { KINDS, PSIZE } from "./vdevs";
export type { Kind };
