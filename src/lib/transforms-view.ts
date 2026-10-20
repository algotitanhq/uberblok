// HTML for the three figures of the compression, dedup and encryption room,
// built from src/lib/transforms.ts. Plain strings, no DOM: the page renders a
// first state at build time (readable without JavaScript) and the scripts
// render every later state with the same functions.
import { group } from "./l10n";
import {
  BPE_PAYLOAD_SIZE, bpWords, compress, hex, maxCopies, readBlock,
  type BpKind, type CBlock, type CompressIn, type CompressOut, type CryptFile, type DedupState, type DedupStep,
  type ReadResult, type WordRole,
} from "./transforms";

export type TrStrings = Record<string, string> & { refs: Record<string, string>; lang: string };

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const see = (S: TrStrings, r: string) => ` <a class="see" href="${S.refs[r]}">${S.see}</a>`;
const strip = (html: string) => html.replace(/ ?<a class="see"[^>]*>[^<]*<\/a>/g, "");
/** What the live region reads: the line without its code links and tags. */
export const spoken = (html: string) => strip(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** A whole number in the page's language. */
export const num = (S: TrStrings, x: number) =>
  group(S.lang, String(Math.round(x)));
/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
export const plural = (S: TrStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n: num(S, n) });
/** A size: "128 KiB" when it is a whole number of KiB, else in bytes. */
export const size = (S: TrStrings, b: number) => (b >= 1024 && b % 1024 === 0 ? fill(S.kib, { n: num(S, b / 1024) }) : plural(S, b, "byte1", "byteN"));

// ---------------------------------------------------------------- compression

export const LSIZES = [4096, 8192, 16384, 131072];
export const ASHIFTS = [9, 12, 13];
export const ALGOS = ["off", "lz4", "zle"] as const;
/** The data presets: all zeros, or a compressor output as a share of the block (or a fixed size). */
export const PRESETS = ["text", "random", "zero", "tiny"] as const;
export type Preset = (typeof PRESETS)[number];
/** The compressor output of a preset for a block size: inputs of the figure, not a compressor's (D10.2). */
export function presetOut(p: Preset, lsize: number): number {
  if (p === "text") return Math.round(lsize * 0.38);
  if (p === "random") return lsize + 64;
  if (p === "tiny") return 90;
  return 0;
}

const algoName = (S: TrStrings, a: string) => (a === "off" ? S.algoOff : a === "lz4" ? "LZ4" : "ZLE");
const pct = (x: number, l: number) => `${Math.min(100, (100 * x) / l).toFixed(3)}%`;

/** The bars: the logical block with its sectors, the 7/8 line and the limit, the compressor output, the sectors allocated. */
export function compressBars(S: TrStrings, x: CompressIn, r: CompressOut): string {
  const sector = 2 ** x.ashift;
  const n = x.lsize / sector;
  const ticks = n <= 64 ? Array.from({ length: n - 1 }, (_, i) => `<span class="tick" style="left:${pct((i + 1) * sector, x.lsize)}"></span>`).join("") : "";
  const lines = r.limit === null ? "" :
    `<span class="vline eighth" style="left:${pct(r.eighth, x.lsize)}" title="7/8"></span>` +
    `<span class="vline limit" style="left:${pct(r.limit, x.lsize)}"></span>`;
  const outRow = x.algo === "off"
    ? `<div class="bar-note">${S.noCompressor}</div>`
    : x.zero || r.limit === null
      ? `<div class="bar-note">${S.zeroNoCompressor}</div>`
      : `<div class="track">${lines}<span class="bar out ${x.out > r.limit ? "over" : "fits"}" style="width:${pct(Math.max(x.out, 1), x.lsize)}"></span></div>`;
  const disk = r.sectors
    ? `<div class="track sectors">${Array.from({ length: r.sectors }, (_, i) => `<span class="sec" style="left:${pct(i * sector, x.lsize)};width:${pct(sector, x.lsize)}"></span>`).join("")}</div>`
    : `<div class="bar-note">${r.outcome === "embedded" ? S.diskEmbedded : S.diskNothing}</div>`;
  const limitLabel = r.limit === null ? "" : fill(S.limitLabel, { limit: size(S, r.limit), eighth: size(S, r.eighth) });
  const outLabel = r.limit === null || x.zero ? "" : fill(x.out > r.limit ? S.outOver : S.outFits, { out: size(S, x.out) });
  return `<div class="bars" role="img" aria-label="${strip(compressLine(S, x, r)).replace(/<[^>]+>/g, "").replace(/"/g, "&quot;")}">
<div class="row"><div class="rlabel">${fill(S.rowBlock, { lsize: size(S, x.lsize), n: plural(S, n, "sector1", "sectorN"), sector: size(S, sector) })}</div><div class="track">${lines}<span class="bar block${x.zero ? " zero" : ""}"></span>${ticks}</div></div>
<div class="row"><div class="rlabel">${outLabel ? fill(S.rowOutVal, { val: outLabel }) : S.rowOut}${limitLabel ? `<span class="lim">${limitLabel}</span>` : ""}</div>${outRow}</div>
<div class="row"><div class="rlabel">${fill(S.rowDisk, { n: plural(S, r.sectors, "sector1", "sectorN"), asize: size(S, r.asize) })}</div>${disk}</div>
</div>`;
}

type PathState = "pass" | "taken" | "skip";

/** The branches of zio_write_compress, in order, with the one that decided. */
export function compressPath(S: TrStrings, x: CompressIn, r: CompressOut): string {
  const steps: { text: string; st: PathState; ref: string }[] = [];
  const add = (text: string, st: PathState, ref: string) => steps.push({ text, st, ref });
  const done = () => steps.some((s) => s.st === "taken");
  const next = (cond: boolean, yes: string, no: string, ref: string) => {
    if (done()) add(no, "skip", ref);
    else add(cond ? yes : no, cond ? "taken" : "pass", ref);
  };
  next(x.algo === "off", S.pOffYes, fill(S.pOffNo, { algo: algoName(S, x.algo) }), "compressOn");
  next(x.zero, S.pZeroYes, S.pZeroNo, "zero");
  const lim = r.limit ?? 0;
  next(r.why === "over", fill(S.pOverYes, { out: size(S, x.out), limit: size(S, lim) }), fill(S.pOverNo, { out: size(S, Math.max(1, x.out)), limit: size(S, lim) }), "over");
  next(r.why === "embed", fill(S.pEmbedYes, { out: size(S, r.returned ?? 0) }), r.why === "noembed-rounded" ? S.pEmbedEnc : S.pEmbedNo, "embed");
  if (done()) add(S.pRound, "skip", "round");
  else add(fill(r.outcome === "uncompressed" ? S.pRoundLsize : S.pRoundOk, { rounded: size(S, r.rounded ?? 0), lsize: size(S, x.lsize) }), "taken", "round");
  return `<ol class="path" aria-label="${S.pathLabel}">${steps.map((s, i) => `<li class="${s.st}" data-i="${i}">${s.text}${s.st !== "skip" ? see(S, s.ref) : ""}${s.st === "taken" ? `<span class="visually-hidden"> ${S.srTaken}</span>` : ""}</li>`).join("")}</ol>`;
}

const outcomeName = (S: TrStrings, r: CompressOut) => S[`o_${r.outcome}`];
const kindOf = (r: CompressOut): BpKind => (r.outcome === "hole" ? "hole" : r.outcome === "embedded" ? "embedded" : "plain");

/** One sentence: what became of the block. */
export function compressLine(S: TrStrings, x: CompressIn, r: CompressOut): string {
  const v = { lsize: size(S, x.lsize), psize: size(S, r.psize), n: plural(S, r.sectors, "sector1", "sectorN"), algo: algoName(S, r.compress), out: size(S, Math.max(1, x.out)), limit: size(S, r.limit ?? 0), ashift: x.ashift };
  return fill(S[`l_${r.why}`], v);
}

/** The outcome and the block pointer it leaves. */
export function compressResult(S: TrStrings, x: CompressIn, r: CompressOut): string {
  const fields = r.outcome === "hole"
    ? fill(S.bpHole, { lsize: size(S, x.lsize) })
    : r.outcome === "embedded"
      ? fill(S.bpEmbedded, { psize: size(S, r.psize), lsize: size(S, x.lsize), algo: algoName(S, r.compress) })
      : fill(S.bpPlain, { psize: size(S, r.psize), lsize: size(S, x.lsize), algo: algoName(S, r.compress), asize: size(S, r.asize) });
  return `<p class="outcome ${r.outcome}"><b>${outcomeName(S, r)}</b> ${compressLine(S, x, r)}</p><p class="bpfields">${fields}</p>${wordsGrid(S, kindOf(r), "plain", true)}`;
}

/** The same data at every ashift of the figure. */
export function compressTable(S: TrStrings, x: CompressIn): string {
  const rows = ASHIFTS.map((a) => {
    const r = compress({ ...x, ashift: a });
    return `<tr${a === x.ashift ? ' class="cur" aria-current="true"' : ""}><th scope="row">${a} (${size(S, 2 ** a)})</th><td>${r.limit === null ? "—" : num(S, r.limit)}</td><td>${outcomeName(S, r)}</td><td>${num(S, r.psize)}</td><td>${num(S, r.asize)}</td></tr>`;
  }).join("");
  return `<table class="cmp-table"><caption>${fill(S.tableCaption, { lsize: size(S, x.lsize), algo: algoName(S, x.algo) })}</caption><thead><tr><th scope="col">${S.thAshift}</th><th scope="col">${S.thLimit}</th><th scope="col">${S.thOutcome}</th><th scope="col">${S.thPsize}</th><th scope="col">${S.thAsize}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------------------------------------------------------------- block pointer words

const roleText = (S: TrStrings, role: WordRole, k?: number) => fill(S[`w_${role}`], { k: k ?? 0 });
const changed = (a: WordRole, b: WordRole) => a !== b;

/** The 16 words of a block pointer of this kind; words that differ from `base` are marked. */
export function wordsGrid(S: TrStrings, kind: BpKind, base: BpKind = "plain", compact = false): string {
  const w = bpWords(kind).sort((a, b) => a.i - b.i);
  const b = bpWords(base).sort((a, b2) => a.i - b2.i);
  const rows = w.map((x, i) => {
    const diff = kind !== base && (changed(x.role, b[i].role) || x.k !== b[i].k);
    return `<tr class="r-${x.role}${diff ? " diff" : ""}"><th scope="row">${x.i.toString(16)}</th><td>${roleText(S, x.role, x.k)}${diff ? `<span class="visually-hidden"> ${S.srChanged}</span>` : ""}</td></tr>`;
  }).join("");
  const cap = fill(S.gridCaption, { kind: S[`k_${kind}`] });
  return `<table class="words${compact ? " compact" : ""}"><caption>${cap}</caption><thead><tr><th scope="col">${S.thWord}</th><th scope="col">${S.thHolds}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** What a kind of block pointer means, in a sentence, with its code reference. */
export function kindLine(S: TrStrings, kind: BpKind): string {
  const copies = maxCopies(kind);
  return `${S[`kd_${kind}`]}${copies ? ` ${fill(S.copiesLine, { n: copies })}` : ""}${see(S, `k_${kind}`)}`;
}

// ---------------------------------------------------------------- dedup

const contentChip = (c: string) => `<span class="ct ct-${c}">${c}</span>`;

/** The pipeline of the last write: checksum, lookup, outcome. */
function dedupPath(S: TrStrings, st: DedupStep | undefined): string {
  if (!st) return `<p class="muted">${S.dNoWrite}</p>`;
  const look = st.outcome === "hit" ? S.dFound : st.outcome === "overquota" ? S.dNull : S.dNew;
  const items = [
    fill(S.dStepCk, { c: contentChip(st.content), ck: st.cksum, txg: st.txg }),
    `${look}${see(S, st.outcome === "overquota" ? "quota" : "lookup")}`,
    `${dedupLine(S, st)}`,
  ];
  return `<ol class="path">${items.map((t, i) => `<li class="${i === 2 ? "taken" : "pass"}">${t}</li>`).join("")}</ol>`;
}

/** What one write did. */
export function dedupLine(S: TrStrings, st: DedupStep): string {
  const v = { c: contentChip(st.content), dva: st.bp.dva, n: st.refcnt ?? 0, txg: st.txg, birth: st.bp.physical };
  const ref = st.outcome === "hit" ? "hit" : st.outcome === "miss" ? "miss" : "overquota";
  return fill(S[`d_${st.outcome}`], v) + see(S, ref);
}

/** The DDT, the block pointers, the disk and the counters. */
export function dedupView(S: TrStrings, s: DedupState): string {
  const last = s.steps[s.steps.length - 1];
  const ddt = s.entries.length
    ? `<div class="ddt-scroll" tabindex="0" role="region" aria-label="${S.ddtCaption}"><table class="ddt"><caption>${S.ddtCaption}</caption><thead><tr><th scope="col">${S.thKey}</th><th scope="col">${S.thContent}</th><th scope="col">${S.thRef}</th><th scope="col">${S.thDva}</th><th scope="col">${S.thBirth}</th></tr></thead><tbody>${s.entries
      .map((e) => `<tr${last && last.content === e.content && last.outcome !== "overquota" ? ' class="cur"' : ""}><td><code>${e.cksum}…</code></td><td>${contentChip(e.content)}</td><td class="num">${e.refcnt}</td><td><code>${e.dva}</code></td><td class="num">${e.birth}</td></tr>`)
      .join("")}</tbody></table></div>`
    : `<p class="muted">${S.ddtEmpty}</p>`;
  const bps = s.bps.length
    ? `<ol class="bps">${s.bps
      .map((b, i) => `<li${i === s.bps.length - 1 ? ' class="cur"' : ""}><span class="bpn">bp${b.n}</span>${contentChip(b.content)}<span class="dbit ${b.dedup ? "on" : "off"}">D=${b.dedup ? 1 : 0}</span><span class="arrow" aria-hidden="true">→</span><code>${b.dva}</code><span class="births">${fill(S.births, { l: b.logical, p: b.physical })}</span></li>`)
      .join("")}</ol>`
    : `<p class="muted">${S.bpsEmpty}</p>`;
  const disk = s.disk.length
    ? `<ol class="disk">${s.disk
      .map((d) => {
        const refs = s.bps.filter((b) => b.dva === d.dva).map((b) => `bp${b.n}`);
        const isNew = last?.wrote === d.dva;
        return `<li${isNew ? ' class="cur"' : ""}><code>${d.dva}</code>${contentChip(d.content)}<span class="refs">${fill(S.refsBy, { list: refs.join(", ") })}</span></li>`;
      })
      .join("")}</ol>`
    : `<p class="muted">${S.diskEmpty}</p>`;
  const counters = [
    plural(S, s.steps.length, "cWrite1", "cWriteN"),
    plural(S, s.lookups, "cLookup1", "cLookupN"),
    plural(S, s.disk.length, "cDisk1", "cDiskN"),
    plural(S, s.entries.length, "cEntry1", "cEntryN"),
  ].map((x) => `<span>${x}</span>`).join("");
  return `<p class="counters">${counters}</p><div class="dd-grid"><section class="panel"><h3>${S.lastWrite}</h3>${dedupPath(S, last)}</section><section class="panel"><h3>${S.ddtLabel}</h3>${ddt}</section><section class="panel"><h3>${S.bpsLabel}</h3>${bps}</section><section class="panel"><h3>${S.diskLabel}</h3>${disk}</section></div>`;
}

export function dedupDescribe(S: TrStrings, s: DedupState): string {
  if (!s.steps.length) return `<p>${S.dNoWrite}</p>`;
  return `<ol>${s.steps.map((st) => `<li>${strip(dedupLine(S, st))}</li>`).join("")}</ol><p>${strip(dedupView(S, s).match(/<p class="counters">([\s\S]*?)<\/p>/)![1]).replace(/<\/span><span>/g, ", ").replace(/<[^>]+>/g, "")}.</p>`;
}

// ---------------------------------------------------------------- encryption

export interface CryptUi {
  key: boolean;
  flip: boolean;
  scrub: { id: string; ok: boolean }[] | null;
  read: ReadResult[] | null;
}

const blockName = (S: TrStrings, id: string) => (id === "dn" ? S.bDnode : id === "L1" ? S.bIndirect : fill(S.bData, { i: id.slice(1) }));

function contentOf(S: TrStrings, b: CBlock, key: boolean, flip: boolean): string {
  if (b.id === "L1") return `<span class="clear">${S.indirectClear}</span>`;
  if (b.id === "dn") {
    const core = `<span class="clear">${S.dnodeCore}</span>`;
    const bonus = key ? `<span class="plain">${fill(S.bonusPlain, { text: b.plain })}</span>` : `<span class="opaque">${fill(S.bonusOpaque, { hex: hex(b.disk.slice(256)) })}</span>`;
    return `${core}${bonus}`;
  }
  // A flipped block fails its checksum before decryption (zio_checksum_error_impl): no plaintext.
  if (key && flip && b.id === "d1") return `<span class="opaque">${S.corrupt}</span>`;
  return key ? `<span class="plain">${fill(S.quoted, { text: b.plain })}</span>` : `<span class="opaque"><code>${hex(b.disk)}…</code></span>`;
}

/** The encrypted file: dnode block, indirect block, data blocks, each as on disk and as the reader sees it. */
export function cryptFileView(S: TrStrings, f: CryptFile, ui: CryptUi): string {
  const blocks = [f.dnode, f.indirect, ...f.data];
  const sc = new Map(ui.scrub?.map((x) => [x.id, x.ok]) ?? []);
  const li = (b: CBlock, cls: string) => {
    const kind = b.id === "L1" ? "indirect" : b.id === "dn" ? "dnode" : "encrypted";
    const verdict = ui.scrub ? `<span class="sc ${sc.get(b.id) ? "ok" : "bad"}">${sc.get(b.id) ? S.scOk : S.scBad}</span>` : "";
    const flipMark = ui.flip && b.id === "d1" ? `<span class="flip">${S.flipped}</span>` : "";
    return `<li class="${cls}"><div class="bhead"><span class="bname">${blockName(S, b.id)}</span><span class="bkind">${S[`k_${kind}`]}</span>${flipMark}${verdict}</div><div class="bbody">${contentOf(S, b, ui.key, ui.flip)}</div></li>`;
  };
  const fail = ui.read ? ui.read.findIndex((x) => !x.ok) : -1;
  const err = fail >= 0 ? (ui.read![fail] as { ok: false; err: string }).err : "";
  const read = !ui.read
    ? ""
    : fail < 0
      ? `<p class="readout ok">${fill(S.readOk, { text: ui.read.map((x) => (x.ok ? x.text : "")).join(" ") })}${see(S, "eacces")}</p>`
      : `<p class="readout bad">${fill(err === "ECKSUM" ? S.readEcksum : S.readEacces, { i: fail })}${see(S, err === "ECKSUM" ? "truncated" : "eacces")}</p>`;
  return `<p class="keystate ${ui.key ? "on" : "off"}">${ui.key ? S.keyOn : S.keyOff}</p><ul class="ctree" aria-label="${S.treeLabel}">${li(blocks[0], "dn")}<li class="sub"><ul>${li(blocks[1], "ind")}<li class="sub"><ul class="leaves">${f.data.map((b) => li(b, "dat")).join("")}</ul></li></ul></li></ul>${read}`;
}

/** What the last action on the encrypted file did. */
export function cryptLine(S: TrStrings, act: string, ui: CryptUi): string {
  if (act === "scrub" && ui.scrub) {
    const bad = ui.scrub.filter((x) => !x.ok).length;
    const v = { n: plural(S, ui.scrub.length, "blk1", "blkN"), bad: plural(S, bad, "err1", "errN") };
    return fill(ui.key ? S.scrubKey : S.scrubNoKey, v) + see(S, "scrub");
  }
  if (act === "read" && ui.read) {
    const i = ui.read.findIndex((x) => !x.ok);
    if (i < 0) return S.readOkLine + see(S, "eacces");
    const e = ui.read[i] as { ok: false; err: string };
    return fill(e.err === "ECKSUM" ? S.readEcksum : S.readEacces, { i }) + see(S, e.err === "ECKSUM" ? "truncated" : "eacces");
  }
  if (act === "key") return (ui.key ? S.keyOnLine : S.keyOffLine) + see(S, "clear");
  if (act === "flip") return (ui.flip ? S.flipOnLine : S.flipOffLine);
  return "";
}

/** Read every data block of the file. */
export const readAll = (f: CryptFile, key: boolean) => f.data.map((b) => readBlock(b, key));

export { BPE_PAYLOAD_SIZE };
