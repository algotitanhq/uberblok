// HTML and SVG for the tree and the uberblock room's figure, built from
// src/lib/tree.ts. Plain strings, no DOM: the page renders a first state at
// build time (readable without JavaScript) and the script renders every later
// state with the same functions. The 3D scene (src/lib/tree-3d.ts) draws the
// same state.
import { and, decimal } from "./l10n";
import {
  HEIGHTS, NLEVELS, PLACES, VDEV_LABELS, height, labelOffset, newestOnDisk, place, slotOf, ubOffset,
  type Blk, type ImportResult, type Pool, type Why,
} from "./tree";

export type TrStrings = Record<string, string> & { refs: Record<string, string>; lang: string };

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const see = (S: TrStrings, r: string) => (S.refs[r] ? ` <a class="see" href="${S.refs[r]}">${S.see}</a>` : "");
const strip = (html: string) => html.replace(/ ?<a class="see"[^>]*>[^<]*<\/a>/g, "");
/** What the live region reads: the line without its code links and tags. */
// Collapses ASCII white space only: the French no-break spaces stay (D1.9).
export const spoken = (html: string) => strip(html).replace(/<[^>]+>/g, "").replace(/[ \t\r\n]+/g, " ").trim();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
export const plural = (S: TrStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n });
/** A list in the page's language: "a, b and c" / « a, b et c ». */
export function list(S: TrStrings, xs: string[]): string {
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")}${and(S.lang)}${xs[xs.length - 1]}`;
}
const L = (l: number) => `L${l}`;

/** The name of a place: objset, dnodes, L2 #0, D3. */
export function placeName(S: TrStrings, key: string): string {
  const p = place(key);
  if (p.kind === "objset") return S.n_OS;
  if (p.kind === "dnodes") return S.n_DN;
  return fill(p.kind === "data" ? S.n_data : S.n_ind, { level: p.level, blkid: p.blkid });
}

// ------------------------------------------------------------------ states

/** The txg the figure is working on: the open one, else the next. */
export const workTxg = (p: Pool) => p.open?.txg ?? p.synced + 1;
/** The last txg whose four beats are done, or the synced one. */
export const syncedTxg = (p: Pool) => (p.open?.beat === 4 ? p.open.txg : p.synced);

export type BlockState = "old" | "new" | "unflushed" | "mem" | "lost" | "dead" | "live";

/**
 * Every block drawn, with its state. "live": in the tree of the newest
 * uberblock and not replaced; "old": replaced in the open txg, still reached
 * by the synced uberblock; "new", "unflushed", "mem", "lost": the open txg's
 * copies; "dead": replaced, no longer reached by the newest uberblock.
 */
export function drawn(p: Pool): { blk: Blk; state: BlockState; pair: "solo" | "left" | "right" }[] {
  const out: { blk: Blk; state: BlockState; pair: "solo" | "left" | "right" }[] = [];
  const t = p.open;
  const committed = t?.beat === 4;
  const lost = p.cut && t && (p.cut.during === "open" || p.cut.during === 0 || p.cut.during === 1);
  const swung = !!t && newestOnDisk(p).root === t.version.OS;
  for (const pl of PLACES) {
    const oldId = p.version[pl.key];
    const newId = t?.version[pl.key];
    if (!newId || newId === oldId) {
      out.push({ blk: p.blocks[oldId], state: "live", pair: "solo" });
      continue;
    }
    out.push({ blk: p.blocks[oldId], state: committed || swung ? "dead" : "old", pair: "left" });
    // spa_sync writes bottom up: below the height reached, written; above it, still in memory.
    const st: BlockState = lost ? "lost" : t!.beat === null ? (height(pl.key) < t!.wrote ? "unflushed" : "mem") : t!.beat === 0 ? "unflushed" : "new";
    out.push({ blk: p.blocks[newId], state: st, pair: "right" });
  }
  return out;
}

// ------------------------------------------------------------------ the 2D tree

const TW = 540;
const BW = 58;
const BH = 34;
const ROWS: Record<string, number> = { OS: 104, DN: 164 };
const rowY = (key: string) => ROWS[key] ?? 224 + (NLEVELS - 1 - place(key).level) * 60;

/** The x of a place's centre: data blocks spread, parents over their children. */
export function centreX(key: string): number {
  const p = place(key);
  if (p.kind === "data") return 70 + p.blkid * 133;
  const kids = p.kids.map(centreX);
  return kids.reduce((a, b) => a + b, 0) / kids.length;
}
const blockX = (key: string, pair: "solo" | "left" | "right") => centreX(key) + (pair === "left" ? -31 : pair === "right" ? 31 : 0);

/** The tree as an SVG drawing: the uberblock card on top, its root arrow, old and new copies side by side. */
export function treeSvg(S: TrStrings, p: Pool): string {
  const ub = newestOnDisk(p);
  const ds = drawn(p);
  const where = new Map(ds.map((d) => [d.blk.id, { x: blockX(d.blk.key, d.pair), y: rowY(d.blk.key), state: d.state }]));
  let edges = "";
  for (const d of ds) {
    const from = where.get(d.blk.id)!;
    for (const kid of d.blk.kids) {
      const to = where.get(kid);
      if (!to) continue;
      // A pointer in memory to a child not written yet: no address or checksum in it so far.
      const cls = d.state === "dead" || d.state === "old" ? "old" : d.state === "live" ? "live" : d.state === "mem" && to.state === "mem" ? "wait" : d.state;
      edges += `<path class="edge e-${cls}" data-edge="${esc(d.blk.id)}>${esc(kid)}" d="M${from.x} ${from.y + BH / 2}C${from.x} ${from.y + BH / 2 + 14} ${to.x} ${to.y - BH / 2 - 14} ${to.x} ${to.y - BH / 2}"/>`;
    }
  }
  let nodes = "";
  for (const d of ds) {
    const { x, y } = where.get(d.blk.id)!;
    nodes += `<g class="b s-${d.state} k-${place(d.blk.key).kind}" data-block="${esc(d.blk.id)}" data-state="${d.state}">`
      + `<rect x="${x - BW / 2}" y="${y - BH / 2}" width="${BW}" height="${BH}" rx="4"/>`
      + `<text class="nm" x="${x}" y="${y - 2}" text-anchor="middle">${esc(placeName(S, d.blk.key))}</text>`
      + `<text class="bt" x="${x}" y="${y + 12}" text-anchor="middle">${d.blk.birth}</text></g>`;
  }
  // The uberblock card and its one pointer, ub_rootbp.
  const os = where.get(ub.root ?? "");
  const cx = TW / 2;
  const card = `<g class="ub" data-ub="${ub.txg}"><rect x="${cx - 92}" y="8" width="184" height="44" rx="6"/>`
    + `<text class="nm" x="${cx}" y="27" text-anchor="middle">${esc(fill(S.ubCard, { txg: ub.txg }))}</text>`
    + `<text class="bt" x="${cx}" y="44" text-anchor="middle">${esc(fill(S.ubSlot, { slot: slotOf(ub.txg, p.ashift) }))} · ub_rootbp</text></g>`;
  const arrow = os ? `<path class="root" data-root="${esc(ub.root!)}" d="M${cx} 52C${cx} 70 ${os.x} 70 ${os.x} ${os.y - BH / 2 - 3}" marker-end="url(#tr-arrow)"/>` : "";
  const state = p.cut ? fill(S.sayCut, { where: cutWhere(S, p) }) : beatsSummary(S, p);
  const aria = fill(S.treeAria, { txg: ub.txg, os: (ub.root ?? "").split("@")[1] ?? "", state: spoken(state) });
  const shown = new Set<string>(ds.map((d) => d.state));
  if (edges.includes("e-wait")) shown.add("wait");
  const legend = [["old", S.lg_old], ["new", S.lg_new], ["mem", S.lg_mem], ["wait", S.lg_wait], ["unflushed", S.lg_unflushed], ["lost", S.lg_lost], ["dead", S.lg_dead]]
    .filter(([k]) => shown.has(k))
    .map(([k, t]) => `<li class="s-${k}"><span class="sw" aria-hidden="true"></span>${esc(t)}</li>`)
    .join("");
  return `<svg class="tr-tree" viewBox="0 0 ${TW} 372" role="img" aria-label="${esc(aria)}">`
    + `<defs><marker id="tr-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs>`
    + `<g class="edges">${edges}</g>${arrow}${card}<g class="blocks">${nodes}</g></svg>${legend ? `<ul class="tr-legend">${legend}</ul>` : ""}`;
}

// ------------------------------------------------------------------ the 2D disk

/** Where each part of the disk strip is drawn (not to scale). */
const SEG = { L0: [8, 62], L1: [62, 116], boot: [116, 166], data: [166, 372], L2: [372, 426], L3: [426, 480] } as Record<string, [number, number]>;
const segOf = (l: number) => SEG[L(l)];

/** Slot n of a ring of `count`, as an arc around (cx, cy), widened so that one slot of 128 stays visible. */
function arc(cx: number, cy: number, r: number, n: number, count: number): string {
  const step = (2 * Math.PI) / count;
  const half = Math.max(step * 0.38, 0.13);
  const a0 = (n + 0.5) * step - half;
  const a1 = (n + 0.5) * step + half;
  const pt = (a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  return `M${pt(a0)}A${r} ${r} 0 0 1 ${pt(a1)}`;
}

/** The disk: four labels, each with its config and its ring; the slot of the work txg and of the synced one marked. */
export function diskSvg(S: TrStrings, p: Pool): string {
  const work = workTxg(p);
  const sn = slotOf(work, p.ashift);
  const sp = slotOf(work - 1, p.ashift);
  let out = "";
  for (let l = 0; l < VDEV_LABELS; l++) {
    const [x0, x1] = segOf(l);
    const cx = (x0 + x1) / 2;
    const lab = p.labels[l];
    let ring = "";
    lab.ring.forEach((s, n) => {
      const cls = s?.torn ? "torn" : n === sn && s?.txg === work ? "new" : n === sp && s?.txg === work - 1 ? "prev" : n === sn ? "next" : "";
      if (!cls) return;
      ring += `<path class="slot ${cls}" d="${arc(cx, 50, 22, n, lab.ring.length)}"/>`;
    });
    const cfgCls = lab.configTorn ? "torn" : lab.config === work ? "new" : "";
    out += `<g class="lab" data-label="${l}"><circle class="ring" cx="${cx}" cy="50" r="22"/>${ring}`
      + `<rect class="seg${cfgCls ? ` ${cfgCls}` : ""}" x="${x0 + 1}" y="96" width="${x1 - x0 - 2}" height="30" rx="3"/>`
      + `<text class="nm" x="${cx}" y="115" text-anchor="middle">${L(l)}</text>`
      + `<text class="bt" x="${cx}" y="144" text-anchor="middle">${lab.configTorn ? esc(S.cellTorn) : lab.config}</text></g>`;
  }
  for (const k of ["boot", "data"]) {
    const [x0, x1] = SEG[k];
    out += `<rect class="seg area" x="${x0 + 1}" y="96" width="${x1 - x0 - 2}" height="30" rx="3"/><text class="bt" x="${(x0 + x1) / 2}" y="115" text-anchor="middle">${esc(S[k])}</text>`;
  }
  const slots = p.labels.map((lab, l) => `${L(l)} ${cellText(S, lab.ring[sn])}`).join(", ");
  const configs = p.labels.map((lab, l) => `${L(l)} ${lab.configTorn ? S.cellTorn : lab.config}`).join(", ");
  return `<svg class="tr-disk" viewBox="0 0 488 152" role="img" aria-label="${esc(fill(S.diskAria, { slot: sn, slots, configs }))}">${out}</svg>`;
}

const cellText = (S: TrStrings, s: Pool["labels"][number]["ring"][number]) =>
  !s ? S.cellEmpty : s.torn ? S.cellTorn : fill(S.cellUb, { txg: s.txg });

/** The disk as a table: where each label starts, its config, the two slots that matter. */
export function diskHtml(S: TrStrings, p: Pool): string {
  const work = workTxg(p);
  const sn = slotOf(work, p.ashift);
  const sp = slotOf(work - 1, p.ashift);
  const mib = (b: number) => {
    const v = b / 2 ** 20;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, "");
    return S.lang === "fr" ? `${decimal("fr", s)} Mio` : `${decimal(S.lang, s)} MiB`;
  };
  const head = `<tr><th scope="col">${S.c_label}</th><th scope="col">${S.c_at}${see(S, "offset")}</th><th scope="col">${S.c_config}</th>`
    + `<th scope="col">${fill(S.c_slot, { slot: sp, off: ubOffset(sp, p.ashift) / 1024 })}</th><th scope="col">${fill(S.c_slot, { slot: sn, off: ubOffset(sn, p.ashift) / 1024 })}</th></tr>`;
  const rows = p.labels.map((lab, l) => {
    const c = (s: Pool["labels"][number]["ring"][number]) => `<td class="${s?.torn ? "torn" : s?.txg === work ? "new" : ""}">${cellText(S, s)}</td>`;
    return `<tr data-label="${l}"><th scope="row">${L(l)}</th><td>${mib(labelOffset(p.psize, l, 0))}</td>`
      + `<td class="${lab.configTorn ? "torn" : lab.config === work ? "new" : ""}">${lab.configTorn ? S.cellTorn : `txg ${lab.config}`}</td>${c(lab.ring[sp])}${c(lab.ring[sn])}</tr>`;
  }).join("");
  return `<table class="tr-table"><thead>${head}</thead><tbody>${rows}</tbody></table><p class="muted note">${S.diskNote}</p>`;
}

// ------------------------------------------------------------------ the beats

type BeatKey = "beat0" | "beat1" | "beat2" | "beat3" | "beat4";

/** The five steps of a sync, each done, next, to do, or cut. */
export function beatsHtml(S: TrStrings, p: Pool): string {
  const t = p.open;
  const txg = workTxg(p);
  const done = t?.beat ?? -1;
  const cutAt = p.cut && t && p.cut.during !== "idle" ? (p.cut.during === "open" ? 0 : p.cut.during) : -2;
  const items: [BeatKey, string, string][] = [
    ["beat0", S.beat0, "write"],
    ["beat1", S.beat1, "flush"],
    ["beat2", p.configDirty ? S.beat2 : S.beat2none, "even"],
    ["beat3", S.beat3, "ubsync"],
    ["beat4", p.configDirty ? S.beat4 : S.beat4none, "odd"],
  ];
  const lis = items.map(([k, text], i) => {
    const writing = i === 0 && !!t && t.beat === null && t.wrote > 0;
    const st = i === cutAt ? "cut" : i <= done ? "done" : writing ? "now" : t && !p.cut && i === done + 1 ? "next" : "todo";
    const say = writing ? S.beat0prog : text;
    return `<li class="bt-${st}" data-beat="${i}"><span class="st">${S[`st_${st}`]}</span> ${fill(say, { txg, slot: slotOf(txg, p.ashift), w: t?.wrote ?? 0, h: HEIGHTS })}${see(S, k === "beat0" ? "write" : items[i][2])}</li>`;
  }).join("");
  return `<p class="muted">${beatsSummary(S, p)}</p><ol class="beats" start="0">${lis}</ol>`;
}

function beatsSummary(S: TrStrings, p: Pool): string {
  const t = p.open;
  if (!t || t.beat === 4) return fill(S.beatsIdle, { txg: t?.beat === 4 ? t.txg + 1 : workTxg(p) });
  if (t.beat === null && t.wrote === 0) return fill(S.beatsOpen, { txg: t.txg, n: plural(S, newBlocks(p).length, "block1", "blockN") });
  if (t.beat === null) return fill(S.beat0prog, { txg: t.txg, w: t.wrote, h: HEIGHTS });
  return fill(S[`beat${t.beat}`], { txg: t.txg, slot: slotOf(t.txg, p.ashift) });
}

/** The open txg's new copies, top down. */
export const newBlocks = (p: Pool) => (p.open ? PLACES.filter((pl) => p.open!.version[pl.key] !== p.version[pl.key]).map((pl) => pl.key) : []);

// ------------------------------------------------------------------ the import

export function importHtml(S: TrStrings, r: ImportResult | null): string {
  if (!r) return `<p class="muted">${S.importNone}</p>`;
  const parts = [S.imp_read + see(S, "load")];
  if (r.tornSlots.length) parts.push(fill(S.imp_torn, { list: list(S, r.tornSlots.map((s) => fill(S.tornSlot, { slot: s.slot, l: L(s.label) }))) }));
  parts.push(fill(S.imp_winner, { txg: r.winner.txg, slot: r.slot, labels: list(S, r.foundIn.map(L)) }) + see(S, "compare"));
  if (r.configLabel >= 0) parts.push(fill(S.imp_cfg, { l: L(r.configLabel), cfg: r.labelReads[r.configLabel].config ?? 0, txg: r.winner.txg }) + see(S, "readConfig"));
  for (const x of r.labelReads) {
    if (x.verdict === "tooNew") parts.push(fill(S.imp_tooNew, { l: L(x.label), cfg: x.config ?? 0 }));
    if (x.verdict === "torn") parts.push(fill(S.imp_cfgTorn, { l: L(x.label) }));
  }
  return `<ul class="imp">${parts.map((x) => `<li>${x}</li>`).join("")}</ul><p class="imp-verdict" data-tree-won="${r.tree}" data-winner="${r.winner.txg}">${importVerdict(S, r)}</p>`;
}

/** The outcome of an import, and the code's reason. */
export function importVerdict(S: TrStrings, r: ImportResult): string {
  const cut = r.cutTxg;
  const vars = { txg: r.winner.txg, cut: cut ?? "", n: plural(S, r.landedCopies, "copy1", "copyN") };
  if (cut === null) return `${fill(S.imp_same, vars)} ${S.why_idle}`;
  const why = whyKey(r);
  const head = r.tree === "new" ? S.imp_new : r.during === "open" ? S.imp_oldOpen : S.imp_old;
  return `${fill(head, vars)} ${fill(S[why], vars)}${see(S, why === "why_3none" || why === "why_3some" ? "cases" : why === "why_2" ? "readConfig" : "")}`;
}

function whyKey(r: ImportResult): string {
  const d = r.during;
  if (d === "open") return "why_open";
  if (d === 0) return "why_0";
  if (d === 1) return "why_1";
  if (d === 2) return r.labelReads.some((x) => x.verdict === "tooNew" || x.verdict === "torn") ? "why_2" : "why_2none";
  // Did this txg write any label? Not when its vdev configuration did not change.
  const labels = r.labelReads.some((x) => x.config === r.cutTxg || x.verdict === "torn");
  if (d === 3) return r.landedCopies ? (labels ? "why_3some" : "why_3somenone") : "why_3none";
  if (d === 4) return labels ? "why_4" : "why_4none";
  return "why_idle";
}

// ------------------------------------------------------------------ announcements

export function writeLine(S: TrStrings, p: Pool, blkid: number, rewritten: string[]): string {
  const txg = p.open!.txg;
  if (rewritten.length === 1) return fill(S.sayWriteShared, { k: blkid, txg });
  return fill(S.sayWrite, { k: blkid, txg, list: list(S, rewritten.map((k) => placeName(S, k))) }) + see(S, "dirty");
}

export function stepLine(S: TrStrings, p: Pool): string {
  const t = p.open!;
  if (t.beat === null) {
    // One height written: its blocks, and the parents that now hold their pointers.
    const fresh = newBlocks(p);
    const just = fresh.filter((k) => height(k) === t.wrote - 1);
    const parents = fresh.filter((k) => height(k) === t.wrote);
    return fill(just.length === 1 ? S.say0one : S.say0many, { list: list(S, just.map((k) => placeName(S, k))), parents: list(S, parents.map((k) => placeName(S, k))) }) + see(S, "bottomUp");
  }
  const vars = { txg: t.txg, prev: p.synced, slot: slotOf(t.txg, p.ashift), n: plural(S, newBlocks(p).length, "block1", "blockN") };
  const k = t.beat === 0 ? "say0" : t.beat === 1 ? "say1" : t.beat === 2 ? (p.configDirty ? "say2" : "say2none") : t.beat === 3 ? "say3" : p.configDirty ? "say4" : "say4none";
  const ref = ["write", "flush", "even", "ubsync", "odd"][t.beat!];
  return fill(S[k], vars) + see(S, ref);
}

function cutWhere(S: TrStrings, p: Pool): string {
  const c = p.cut!;
  if (c.during === "idle") return S.cut_idle;
  if (c.during === "open") return fill(S.cut_open, { txg: c.txg ?? "" });
  if (c.during === 0) return fill(S.cut_0, { txg: c.txg ?? "" });
  if (c.during === 1) return S.cut_1;
  if (c.during === 2) return p.configDirty ? S.cut_2 : S.cut_2none;
  if (c.during === 3) return fill(S.cut_3, { n: plural(S, c.landed, "write1", "writeN"), l: L(c.landed) });
  return p.configDirty ? S.cut_4 : S.cut_4none;
}

export const plugLine = (S: TrStrings, p: Pool) => fill(S.sayCut, { where: cutWhere(S, p) });

export function importLine(S: TrStrings, r: ImportResult): string {
  return `${fill(S.imp_winner, { txg: r.winner.txg, slot: r.slot, labels: list(S, r.foundIn.map(L)) })} ${importVerdict(S, r)}`;
}

export const whyLine = (S: TrStrings, p: Pool, w: Why) => fill(S[`why_${w}`], { txg: workTxg(p) });

// ------------------------------------------------------------------ text version

export function describe(S: TrStrings, p: Pool, last: (ImportResult) | null): string {
  const ub = newestOnDisk(p);
  const v = p.open && ub.root === p.open.version.OS ? p.open.version : p.version;
  const tree = PLACES.map((pl) => fill(S.tv_born, { name: placeName(S, pl.key), txg: p.blocks[v[pl.key]].birth })).join(", ");
  const parts = [fill(S.tv_tree, { txg: ub.txg, slot: slotOf(ub.txg, p.ashift), os: p.blocks[ub.root!]?.birth ?? "", tree })];
  if (p.open && p.open.beat !== 4) parts.push(fill(S.tv_open, { txg: p.open.txg, list: list(S, newBlocks(p).map((k) => placeName(S, k))), state: spoken(p.cut ? plugLine(S, p) : beatsSummary(S, p)) }));
  else if (p.cut) parts.push(spoken(plugLine(S, p)));
  const sn = slotOf(workTxg(p), p.ashift);
  parts.push(fill(S.tv_disk, { labels: p.labels.map((lab, l) => fill(S.tv_label, { l: L(l), cfg: lab.configTorn ? S.cellTorn : lab.config, slot: sn, ub: cellText(S, lab.ring[sn]) })).join((S.lang === "fr" ? "\u202f; " : "; ")) }));
  if (last) parts.push(spoken(importLine(S, last)));
  return parts.map((x) => `<p>${x}</p>`).join("");
}

