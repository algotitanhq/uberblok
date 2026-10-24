// HTML for the three figures of the compression, dedup and encryption room,
// built from src/lib/transforms.ts. Plain strings, no DOM: the page renders a
// first state at build time (readable without JavaScript) and the scripts
// render every later state with the same functions. The figures carry no code
// links (D21.1): the room's Source notes show the code. What the last action
// changed is outlined until the next one (D31.1).
import { group } from "./l10n";
import {
  BPE_PAYLOAD_SIZE, bpWords, compress, hex, maxCopies, readBlock,
  type BpKind, type CBlock, type CompressIn, type CompressOut, type CryptFile, type DedupState, type DedupStep,
  type ReadResult, type WordRole,
} from "./transforms";

export type TrStrings = Record<string, string> & { lang: string };

export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
/** What the live region reads: the line without its tags. */
export const spoken = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
/** The class that outlines what the last action changed. */
const chg = (on: boolean | undefined) => (on ? " chg" : "");
/** The same, said to a screen reader inside the outlined row or item. */
const srChg = (S: TrStrings, on: boolean | undefined) => (on ? `<span class="visually-hidden"> ${S.srChanged}</span>` : "");

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

/** What an action changed in the compression figure: the rows of the bars, the branch that decided, the outcome. */
export interface CompressChanges {
  block: boolean;
  out: boolean;
  disk: boolean;
  branch: boolean;
  outcome: boolean;
}
export const NO_COMPRESS_CHANGES: CompressChanges = { block: false, out: false, disk: false, branch: false, outcome: false };

/** Each flag compares what the figure draws before and after, so an outline always means a visible change. */
export function compressChanges(S: TrStrings, a: CompressIn, ra: CompressOut, b: CompressIn, rb: CompressOut): CompressChanges {
  const rows = (x: CompressIn, r: CompressOut) => compressBars(S, x, r).split('<div class="row').slice(1);
  const taken = (x: CompressIn, r: CompressOut) => compressPath(S, x, r).match(/<li class="taken[\s\S]*?<\/li>/)?.[0] ?? "";
  const outcome = (x: CompressIn, r: CompressOut) => compressResult(S, x, r).match(/<p class="outcome[\s\S]*?<\/p>/)?.[0] ?? "";
  const [r0, r1] = [rows(a, ra), rows(b, rb)];
  return {
    block: r0[0] !== r1[0],
    out: r0[1] !== r1[1],
    disk: r0[2] !== r1[2],
    branch: taken(a, ra) !== taken(b, rb),
    outcome: outcome(a, ra) !== outcome(b, rb),
  };
}

const algoName = (S: TrStrings, a: string) => (a === "off" ? S.algoOff : a === "lz4" ? "LZ4" : "ZLE");
const pct = (x: number, l: number) => `${Math.min(100, (100 * x) / l).toFixed(3)}%`;

/** The bars: the logical block with its sectors, the 7/8 line and the limit, the compressor output, the sectors allocated. */
export function compressBars(S: TrStrings, x: CompressIn, r: CompressOut, c: CompressChanges = NO_COMPRESS_CHANGES): string {
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
  // The seven-eighths value, and the key to its dashed line, only when rounding to a sector moves the limit.
  const limitLabel = r.limit === null ? "" : fill(r.limit === r.eighth ? S.limitLabel : S.limitLabelRounded, { limit: size(S, r.limit), eighth: size(S, r.eighth) });
  const outLabel = r.limit === null || x.zero ? "" : fill(x.out > r.limit ? S.outOver : S.outFits, { out: size(S, x.out) });
  return `<div class="bars" role="img" aria-label="${compressLine(S, x, r).replace(/<[^>]+>/g, "").replace(/"/g, "&quot;")}">
<div class="row${chg(c.block)}"><div class="rlabel">${fill(S.rowBlock, { lsize: size(S, x.lsize), n: plural(S, n, "sector1", "sectorN"), sector: size(S, sector) })}</div><div class="track">${lines}<span class="bar block${x.zero ? " zero" : ""}"></span>${ticks}</div></div>
<div class="row${chg(c.out)}"><div class="rlabel">${outLabel ? fill(S.rowOutVal, { val: outLabel }) : S.rowOut}${limitLabel ? `<span class="lim">${limitLabel}</span>` : ""}</div>${outRow}</div>
<div class="row${chg(c.disk)}"><div class="rlabel">${fill(S.rowDisk, { n: plural(S, r.sectors, "sector1", "sectorN"), asize: size(S, r.asize) })}</div>${disk}</div>
</div>`;
}

type PathState = "pass" | "taken" | "skip";

/** The branches of zio_write_compress, in order, with the one that decided. */
export function compressPath(S: TrStrings, x: CompressIn, r: CompressOut, c: CompressChanges = NO_COMPRESS_CHANGES): string {
  const steps: { text: string; st: PathState }[] = [];
  const add = (text: string, st: PathState) => steps.push({ text, st });
  const done = () => steps.some((s) => s.st === "taken");
  const next = (cond: boolean, yes: string, no: string) => {
    if (done()) add(no, "skip");
    else add(cond ? yes : no, cond ? "taken" : "pass");
  };
  next(x.algo === "off", S.pOffYes, fill(S.pOffNo, { algo: algoName(S, x.algo) }));
  next(x.zero, S.pZeroYes, S.pZeroNo);
  const lim = r.limit ?? 0;
  next(r.why === "over", fill(S.pOverYes, { out: size(S, x.out), limit: size(S, lim) }), fill(S.pOverNo, { out: size(S, Math.max(1, x.out)), limit: size(S, lim) }));
  next(r.why === "embed", fill(S.pEmbedYes, { out: size(S, r.returned ?? 0) }), r.why === "noembed-rounded" ? S.pEmbedEnc : S.pEmbedNo);
  if (done()) add(S.pRound, "skip");
  else add(fill(r.outcome === "uncompressed" ? S.pRoundLsize : S.pRoundOk, { rounded: size(S, r.rounded ?? 0), lsize: size(S, x.lsize) }), "taken");
  return `<ol class="path" role="list" aria-label="${S.pathLabel}">${steps.map((s, i) => `<li class="${s.st}${chg(c.branch && s.st === "taken")}" data-i="${i}">${s.text}${s.st === "taken" ? `<span class="visually-hidden"> ${S.srTaken}</span>` : ""}</li>`).join("")}</ol>`;
}

const outcomeName = (S: TrStrings, r: CompressOut) => S[`o_${r.outcome}`];
const kindOf = (r: CompressOut): BpKind => (r.outcome === "hole" ? "hole" : r.outcome === "embedded" ? "embedded" : "plain");

/** One sentence: what became of the block. */
export function compressLine(S: TrStrings, x: CompressIn, r: CompressOut): string {
  const v = { lsize: size(S, x.lsize), psize: size(S, r.psize), n: plural(S, r.sectors, "sector1", "sectorN"), algo: algoName(S, r.compress), out: size(S, Math.max(1, x.out)), limit: size(S, r.limit ?? 0), ashift: x.ashift };
  return fill(S[`l_${r.why}`], v);
}

/** The outcome and the block pointer it leaves. */
export function compressResult(S: TrStrings, x: CompressIn, r: CompressOut, c: CompressChanges = NO_COMPRESS_CHANGES, brief = false): string {
  const fields = r.outcome === "hole"
    ? fill(S.bpHole, { lsize: size(S, x.lsize) })
    : r.outcome === "embedded"
      ? fill(S.bpEmbedded, { psize: size(S, r.psize), lsize: size(S, x.lsize), algo: algoName(S, r.compress) })
      : fill(S.bpPlain, { psize: size(S, r.psize), lsize: size(S, x.lsize), algo: algoName(S, r.compress), asize: size(S, r.asize) });
  return `<p class="outcome ${r.outcome}${chg(c.outcome)}"><b>${outcomeName(S, r)}</b>${brief ? "" : ` ${compressLine(S, x, r)}`}</p><p class="bpfields">${fields}</p>${wordsGrid(S, kindOf(r), "plain", true)}`;
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

/** What a kind of block pointer means, in a sentence. */
export function kindLine(S: TrStrings, kind: BpKind): string {
  const copies = maxCopies(kind);
  return `${S[`kd_${kind}`]}${copies ? ` ${fill(S.copiesLine, { n: copies })}` : ""}`;
}

// ---------------------------------------------------------------- dedup

const contentChip = (c: string) => `<span class="ct ct-${c}">${c}</span>`;

/** What an action changed in the dedup figure: the entry, the new block pointer, the new block on disk, the counters, the quota. */
export interface DedupChanges {
  entry: string | null;
  bp: boolean;
  disk: string | null;
  counters: ("write" | "lookup" | "disk" | "entry")[];
  quota: boolean;
}
export const NO_DEDUP_CHANGES: DedupChanges = { entry: null, bp: false, disk: null, counters: [], quota: false };

export function dedupChanges(a: DedupState, b: DedupState, quotaA: boolean, quotaB: boolean): DedupChanges {
  const before = new Map(a.entries.map((e) => [e.content, `${e.refcnt}|${e.dva}`]));
  const entry = b.entries.find((e) => before.get(e.content) !== `${e.refcnt}|${e.dva}`)?.content ?? null;
  const counters: DedupChanges["counters"] = [];
  if (b.steps.length > a.steps.length) counters.push("write");
  if (b.lookups > a.lookups) counters.push("lookup");
  if (b.disk.length > a.disk.length) counters.push("disk");
  if (b.entries.length > a.entries.length) counters.push("entry");
  return {
    entry,
    bp: b.bps.length > a.bps.length,
    // A new block on disk, or on a hit the block the new pointer reuses: its list of references grew.
    disk: b.disk.length > a.disk.length ? b.disk[b.disk.length - 1].dva : b.bps.length > a.bps.length ? b.bps[b.bps.length - 1].dva : null,
    counters,
    quota: quotaB && !quotaA,
  };
}

/** The pipeline of the last write: checksum, lookup, outcome. */
function dedupPath(S: TrStrings, st: DedupStep | undefined, brief: boolean): string {
  if (!st) return `<p class="muted">${S.dNoWrite}</p>`;
  const look = st.outcome === "hit" ? S.dFound : st.outcome === "overquota" ? S.dNull : S.dNew;
  const items = [
    fill(S.dStepCk, { c: contentChip(st.content), ck: st.cksum, txg: st.txg }),
    look,
    brief ? S[`ds_${st.outcome}`] : dedupLine(S, st),
  ];
  return `<ol class="path">${items.map((t, i) => `<li class="${i === 2 ? "taken" : "pass"}">${t}</li>`).join("")}</ol>`;
}

/** What one write did. */
export function dedupLine(S: TrStrings, st: DedupStep): string {
  const v = { c: contentChip(st.content), dva: st.bp.dva, n: st.refcnt ?? 0, txg: st.txg, birth: st.bp.physical };
  return fill(S[`d_${st.outcome}`], v);
}

/** The DDT, the block pointers, the disk and the counters; what the last action changed is outlined. */
export function dedupView(S: TrStrings, s: DedupState, quota = false, c: DedupChanges = NO_DEDUP_CHANGES, brief = false): string {
  const last = s.steps[s.steps.length - 1];
  const ddt = s.entries.length
    ? `<div class="ddt-scroll" tabindex="0" role="region" aria-label="${S.ddtCaption}"><table class="ddt"><caption>${S.ddtCaption}</caption><thead><tr><th scope="col">${S.thKey}</th><th scope="col">${S.thContent}</th><th scope="col">${S.thRef}</th><th scope="col">${S.thDva}</th><th scope="col" class="birth">${S.thBirth}</th></tr></thead><tbody>${s.entries
      .map((e) => `<tr${c.entry === e.content ? ' class="chg"' : ""}><td><code>${e.cksum}…</code>${srChg(S, c.entry === e.content)}</td><td>${contentChip(e.content)}</td><td class="num">${e.refcnt}</td><td><code>${e.dva}</code></td><td class="num birth">${e.birth}</td></tr>`)
      .join("")}</tbody></table></div>`
    : `<p class="muted">${S.ddtEmpty}</p>`;
  const bps = s.bps.length
    ? `<ol class="bps">${s.bps
      .map((b, i) => `<li${c.bp && i === s.bps.length - 1 ? ' class="chg"' : ""}><span class="bpn">bp${b.n}</span>${contentChip(b.content)}<span class="dbit ${b.dedup ? "on" : "off"}">D=${b.dedup ? 1 : 0}</span><span class="arrow" aria-hidden="true">→</span><code>${b.dva}</code><span class="births">${fill(S.births, { l: b.logical, p: b.physical })}</span>${srChg(S, c.bp && i === s.bps.length - 1)}</li>`)
      .join("")}</ol>`
    : `<p class="muted">${S.bpsEmpty}</p>`;
  const disk = s.disk.length
    ? `<ol class="disk">${s.disk
      .map((d) => {
        const refs = s.bps.filter((b) => b.dva === d.dva).map((b) => `bp${b.n}`);
        return `<li${c.disk === d.dva ? ' class="chg"' : ""}><code>${d.dva}</code>${contentChip(d.content)}<span class="refs">${fill(S.refsBy, { list: refs.join(", ") })}</span>${srChg(S, c.disk === d.dva)}</li>`;
      })
      .join("")}</ol>`
    : `<p class="muted">${S.diskEmpty}</p>`;
  const counters = ([
    ["write", plural(S, s.steps.length, "cWrite1", "cWriteN")],
    ["lookup", plural(S, s.lookups, "cLookup1", "cLookupN")],
    ["disk", plural(S, s.disk.length, "cDisk1", "cDiskN")],
    ["entry", plural(S, s.entries.length, "cEntry1", "cEntryN")],
  ] as const).map(([k, x]) => `<span class="n-${k}${chg(c.counters.includes(k))}">${x}</span>`).join("");
  const over = quota ? `<p class="quota-note${chg(c.quota)}">${S.quotaNote}</p>` : "";
  return `<p class="counters">${counters}</p><div class="dd-grid"><section class="panel"><h3>${S.lastWrite}</h3>${dedupPath(S, last, brief)}</section><section class="panel"><h3>${S.ddtLabel}</h3>${over}${ddt}</section><section class="panel"><h3>${S.bpsLabel}</h3>${bps}</section><section class="panel"><h3>${S.diskLabel}</h3>${disk}</section></div>`;
}

export function dedupDescribe(S: TrStrings, s: DedupState, quota = false): string {
  const over = quota ? `<p>${S.quotaNote}</p>` : "";
  if (!s.steps.length) return `<p>${S.dNoWrite}</p>${over}`;
  return `<ol>${s.steps.map((st) => `<li>${dedupLine(S, st)}</li>`).join("")}</ol><p>${dedupView(S, s).match(/<p class="counters">([\s\S]*?)<\/p>/)![1].replace(/<\/span><span[^>]*>/g, ", ").replace(/<[^>]+>/g, "")}.</p>${over}`;
}

// ---------------------------------------------------------------- encryption

export interface CryptUi {
  key: boolean;
  flip: boolean;
  scrub: { id: string; ok: boolean }[] | null;
  read: ReadResult[] | null;
}

/** What an action changed in the encrypted file: the blocks whose look changed, the key line, the scrub verdicts, the read. */
export interface CryptChanges {
  blocks: string[];
  key: boolean;
  scrub: boolean;
  read: boolean;
}
export const NO_CRYPT_CHANGES: CryptChanges = { blocks: [], key: false, scrub: false, read: false };

export function cryptChanges(act: string): CryptChanges {
  if (act === "key") return { blocks: ["dn", "d0", "d1", "d2"], key: true, scrub: false, read: false };
  if (act === "flip") return { blocks: ["d1"], key: false, scrub: false, read: false };
  if (act === "scrub") return { blocks: [], key: false, scrub: true, read: false };
  if (act === "read") return { blocks: [], key: false, scrub: false, read: true };
  return NO_CRYPT_CHANGES;
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
export function cryptFileView(S: TrStrings, f: CryptFile, ui: CryptUi, c: CryptChanges = NO_CRYPT_CHANGES): string {
  const blocks = [f.dnode, f.indirect, ...f.data];
  const sc = new Map(ui.scrub?.map((x) => [x.id, x.ok]) ?? []);
  // A scrub that finds damage outlines only the failed checksum: the passes are not news.
  const anyBad = ui.scrub?.some((x) => !x.ok) ?? false;
  // A failed read marks the block where it stopped, as the scrub marks a damaged one.
  const fail = ui.read ? ui.read.findIndex((x) => !x.ok) : -1;
  const err = fail >= 0 ? (ui.read![fail] as { ok: false; err: string }).err : "";
  const li = (b: CBlock, cls: string) => {
    const kind = b.id === "L1" ? "indirect" : b.id === "dn" ? "dnode" : "encrypted";
    const verdict = ui.scrub ? `<span class="sc ${sc.get(b.id) ? "ok" : "bad"}${chg(c.scrub && (!anyBad || !sc.get(b.id)))}">${sc.get(b.id) ? S.scOk : S.scBad}</span>` : "";
    const failed = fail >= 0 && b.id === `d${fail}`;
    const readMark = failed ? `<span class="rd bad${chg(c.read)}">${err === "ECKSUM" ? S.readMarkEcksum : S.readMarkEacces}</span>` : "";
    const flipMark = ui.flip && b.id === "d1" ? `<span class="flip">${S.flipped}</span>` : "";
    return `<li class="${cls}${chg(c.blocks.includes(b.id))}"><div class="bhead"><span class="bname">${blockName(S, b.id)}</span><span class="bkind">${S[`k_${kind}`]}</span>${flipMark}${verdict}${readMark}</div><div class="bbody">${contentOf(S, b, ui.key, ui.flip)}</div>${srChg(S, c.blocks.includes(b.id))}</li>`;
  };
  // A read that succeeds shows the text; one that fails is marked on its block, and the line under the buttons says why.
  const read = ui.read && fail < 0 ? `<p class="readout ok${chg(c.read)}">${fill(S.readOk, { text: ui.read.map((x) => (x.ok ? x.text : "")).join(" ") })}</p>` : "";
  return `<p class="keystate ${ui.key ? "on" : "off"}${chg(c.key)}">${ui.key ? S.keyOn : S.keyOff}</p><ul class="ctree" aria-label="${S.treeLabel}">${li(blocks[0], "dn")}<li class="sub"><ul>${li(blocks[1], "ind")}<li class="sub"><ul class="leaves">${f.data.map((b) => li(b, "dat")).join("")}</ul></li></ul></li></ul>${read}`;
}

/** What the last action on the encrypted file did. */
export function cryptLine(S: TrStrings, act: string, ui: CryptUi): string {
  if (act === "scrub" && ui.scrub) {
    const bad = ui.scrub.filter((x) => !x.ok).length;
    const v = { n: plural(S, ui.scrub.length, "blk1", "blkN"), bad: plural(S, bad, "err1", "errN") };
    return fill(ui.key ? S.scrubKey : S.scrubNoKey, v);
  }
  if (act === "read" && ui.read) {
    const i = ui.read.findIndex((x) => !x.ok);
    if (i < 0) return S.readOkLine;
    const e = ui.read[i] as { ok: false; err: string };
    return fill(e.err === "ECKSUM" ? S.readEcksum : S.readEacces, { i });
  }
  if (act === "key") return ui.key ? S.keyOnLine : S.keyOffLine;
  if (act === "flip") return (ui.flip ? S.flipOnLine : S.flipOffLine);
  return "";
}

/** Read every data block of the file. */
export const readAll = (f: CryptFile, key: boolean) => f.data.map((b) => readBlock(b, key));

export { BPE_PAYLOAD_SIZE };
