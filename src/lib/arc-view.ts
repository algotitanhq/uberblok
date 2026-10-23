// HTML for the ARC room's figure, built from an Arc of src/lib/arc.ts. Plain
// strings, no DOM: the page renders the opening state at build time (readable
// without JavaScript) and the script renders every later state with the same
// functions. The narration and the log are plain and carry no code links: the
// Source notes of the room show the code (DECISIONS.md D21.1, D25.1).
import { decimal } from "./l10n";
import { BLOCK, CAPACITY, ARC_MINTIME, mruTarget, pct, type Arc, type Ev, type St } from "./arc";

export type ArcStrings = Record<string, string> & { lang: string };

/** What one read changed, outlined in the figure: the block read, the blocks it pushed out, the balance. */
export interface Marks {
  hit: string[];
  out: string[];
  balance: boolean;
}
export const NO_MARKS: Marks = { hit: [], out: [], balance: false };

export function marks(ev: Ev[]): Marks {
  const m: Marks = { hit: [], out: [], balance: false };
  for (const e of ev) {
    if (e.k === "new" || e.k === "ghost" || e.k === "hit") m.hit.push(e.id);
    else if (e.k === "evict" || e.k === "forget") m.out.push(e.id);
    else if (e.k === "pass" && e.pd !== e.pdBefore) m.balance = true;
  }
  return m;
}

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const code = (s: string | number) => `<code>${s}</code>`;

/** A number with at most `d` decimals, in the page's language. */
export function num(S: ArcStrings, x: number, d = 2): string {
  const t = String(Number(x.toFixed(d)));
  return decimal(S.lang, t);
}
const blocks = (S: ArcStrings, bytes: number) => num(S, bytes / BLOCK);
/** "{n} block" or "{n} blocks": singular for 1 in English, for 0 and 1 in French. */
const plural = (S: ArcStrings, n: number, one: string, many: string) => fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n: num(S, n) });
/** "{n} blocks" for a size in bytes, with the same rule. */
const nblocks = (S: ArcStrings, bytes: number) => plural(S, bytes / BLOCK, "blk1", "blkN");
const kib = (S: ArcStrings, bytes: number) => fill(S.kib, { n: num(S, bytes / 1024, 0) });
export const pdText = (S: ArcStrings, pd: bigint) => fill(S.percent, { n: num(S, pct(pd), 1) });

const NAME: Record<St, string> = { mru: "nMru", mfu: "nMfu", mru_ghost: "nMruGhost", mfu_ghost: "nMfuGhost" };
const ROLE: Record<St, string> = { mru: "rMru", mfu: "rMfu", mru_ghost: "rMruGhost", mfu_ghost: "rMfuGhost" };
const ORDER: St[] = ["mru_ghost", "mru", "mfu", "mfu_ghost"];

function chip(S: ArcStrings, id: string, st: St | "gone", live: boolean): string {
  const cls = `chip ${st}`;
  const where = st === "gone" ? S.aGone : S[NAME[st]];
  if (!live) return `<span class="${cls}" data-id="${id}">${id}</span>`;
  return `<button type="button" class="${cls}" data-id="${id}" aria-label="${fill(S.aRead, { id, where })}">${id}</button>`;
}

const mark = (m: Marks, id: string) => (m.hit.includes(id) ? ' class="hit"' : m.out.includes(id) ? ' class="out"' : "");

function listBox(s: Arc, S: ArcStrings, st: St, live: boolean, m: Marks): string {
  const ids = s.lists[st];
  const ghost = st.endsWith("ghost");
  const meta = ghost
    ? fill(S.ghostMeta, { n: plural(S, ids.length, "hdr1", "hdrN"), cap: nblocks(S, st === "mru_ghost" ? s.gs.mru : s.gs.mfu), hits: kib(S, st === "mru_ghost" ? s.hits.mru : s.hits.mfu) })
    : fill(S.liveMeta, { n: plural(S, ids.length, "blk1", "blkN") });
  const chips = ids.length
    ? `<ol class="chips">${ids.map((id) => `<li${mark(m, id)}>${chip(S, id, st, live)}</li>`).join("")}</ol>`
    : `<p class="none">${S.none}</p>`;
  return `<section class="list ${st}" data-st="${st}" aria-label="${S[NAME[st]]}">
  <header><h3>${S[NAME[st]]}</h3><p class="role">${S[ROLE[st]]}</p><p class="meta">${meta}</p></header>
  ${chips}
  ${ids.length > 1 ? `<p class="ends" aria-hidden="true"><span>${S.head}</span><span>${S.tail}</span></p>` : ""}
</section>`;
}

/** The gauge: arc_c as 16 cells, MRU from the left, MFU from the right, the MRU target as a mark. */
export function gauge(s: Arc, S: ArcStrings): string {
  const mru = s.lists.mru.length;
  const mfu = s.lists.mfu.length;
  const t = mruTarget(s.pd) / BLOCK;
  const cells = Array.from({ length: CAPACITY }, (_, i) => `<span class="cell ${i < mru ? "mru" : i >= CAPACITY - mfu ? "mfu" : "free"}"></span>`).join("");
  return `<div class="gauge" aria-hidden="true">
  <div class="cells">${cells}<span class="mark" style="left:${((t / CAPACITY) * 100).toFixed(3)}%"></span></div>
  <p class="gauge-legend"><span class="k mru">${S.nMru} ${mru}</span><span class="k free">${fill(S.free, { n: CAPACITY - mru - mfu })}</span><span class="k mfu">${S.nMfu} ${mfu}</span></p>
</div>`;
}

export function balance(s: Arc, S: ArcStrings): string {
  return fill(S.balance, { pd: pdText(S, s.pd), target: nblocks(S, mruTarget(s.pd)), c: CAPACITY });
}

export function board(s: Arc, S: ArcStrings, live: boolean, m: Marks = NO_MARKS): string {
  const gone = s.forgotten.length
    ? `<ol class="chips">${s.forgotten.map((id) => `<li${mark(m, id)}>${chip(S, id, "gone", live)}</li>`).join("")}</ol>`
    : `<p class="none">${S.none}</p>`;
  return `<div class="lists">${ORDER.map((st) => listBox(s, S, st, live, m)).join("")}</div>
<section class="list gone" aria-label="${S.nGone}"><header><h3>${S.nGone}</h3><p class="role">${S.rGone}</p></header>${gone}</section>`;
}

export function clock(s: Arc, S: ArcStrings): string {
  return fill(S.clock, { t: num(S, s.now / 1000, 3) });
}

export function summary(s: Arc, S: ArcStrings): string {
  return fill(S.summary, {
    mru: plural(S, s.lists.mru.length, "blk1", "blkN"),
    mfu: s.lists.mfu.length,
    mrug: plural(S, s.lists.mru_ghost.length, "hdr1", "hdrN"),
    mfug: s.lists.mfu_ghost.length,
    c: CAPACITY,
    balance: balance(s, S),
  });
}

/** Text version: every list in order, the balance, the counters. */
export function describe(s: Arc, S: ArcStrings): string {
  const items = (st: St) => (s.lists[st].length ? s.lists[st].join(", ") : S.none);
  const rows = ORDER.map((st) => `<li>${fill(S.tList, { name: S[NAME[st]], n: s.lists[st].length, list: items(st) })}</li>`);
  return `<p>${fill(S.tIntro, { c: CAPACITY, size: kib(S, BLOCK), t: num(S, s.now / 1000, 3) })}</p>
<ol>${rows.join("")}</ol>
<p>${fill(S.tGone, { list: s.forgotten.length ? s.forgotten.join(", ") : S.none })}</p>
<p>${balance(s, S)} ${fill(S.tHits, { mru: kib(S, s.hits.mru), mfu: kib(S, s.hits.mfu) })}</p>`;
}

/** One line of the log, plain. */
export function eventLine(S: ArcStrings, e: Ev): string {
  switch (e.k) {
    case "new":
      return fill(e.forgotten ? S.eNewForgotten : S.eNew, { id: code(e.id) });
    case "ghost":
      return fill(e.from === "mru_ghost" ? S.eGhostMru : S.eGhostMfu, { id: code(e.id), kib: kib(S, e.bytes) });
    case "hit":
      if (e.from === "mfu") return fill(S.eHitMfu, { id: code(e.id) });
      return fill(e.to === "mfu" ? S.eHitPromote : S.eHitStay, { id: code(e.id), dt: e.dt, min: ARC_MINTIME });
    case "pass": {
      const adj =
        e.adj === "small"
          ? fill(S.eAdjSmall, { pd: pdText(S, e.pd) })
          : e.adj === "none"
            ? fill(S.eAdjNone, { pd: pdText(S, e.pd) })
            : fill(S.eAdjMoved, {
                grd: kib(S, e.grd),
                gfd: kib(S, e.gfd),
                total: nblocks(S, e.total),
                before: pdText(S, e.pdBefore),
                after: pdText(S, e.pd),
                tb: blocks(S, mruTarget(e.pdBefore)),
                ta: nblocks(S, e.target),
              });
      const share = fill(e.mru > e.target ? S.eShareOver : S.eShareUnder, { mru: plural(S, e.mru / BLOCK, "blk1", "blkN"), target: blocks(S, e.target) });
      return `${fill(S.ePass, { c: CAPACITY })} ${adj} ${share}`;
    }
    case "evict":
      return fill(e.from === "mru" ? S.eEvictMru : S.eEvictMfu, { id: code(e.id) });
    case "forget":
      return fill(e.from === "mru_ghost" ? S.eForgetMru : S.eForgetMfu, { id: code(e.id), cap: nblocks(S, e.cap) });
  }
}

/**
 * The narration of one read, in a sentence or three: what happened to the block
 * read, which block it pushed out and from where, and the balance if it moved.
 * Plain text (it goes to a live region).
 */
export function narrate(S: ArcStrings, ev: Ev[]): string {
  const out: string[] = [];
  const read = ev.find((e) => e.k === "new" || e.k === "ghost" || e.k === "hit");
  if (read?.k === "new") out.push(fill(read.forgotten ? S.nNewForgotten : S.nNew, { id: read.id }));
  else if (read?.k === "ghost") out.push(fill(read.from === "mru_ghost" ? S.nGhostMru : S.nGhostMfu, { id: read.id }));
  else if (read?.k === "hit") out.push(fill(read.from === "mfu" ? S.nHitMfu : read.to === "mfu" ? S.nHitPromote : S.nHitStay, { id: read.id, dt: read.dt }));
  const pass = ev.find((e) => e.k === "pass");
  if (pass?.k === "pass" && pass.pd !== pass.pdBefore) out.push(fill(S.nShare, { before: pdText(S, pass.pdBefore), after: pdText(S, pass.pd) }));
  for (const e of ev) {
    if (e.k === "evict") out.push(fill(e.from === "mru" ? S.nOutMru : S.nOutMfu, { id: e.id }));
    else if (e.k === "forget") out.push(fill(S.nForget, { id: e.id, ghost: S[NAME[e.from]] }));
  }
  return out.join(" ");
}

/** What Next read will read: the next block of a scan or of the hot set, or a new block. */
export function queueLine(S: ArcStrings, queue: string[], kind: "scan" | "hot" | null, total: number, nextNew: string): string {
  if (!queue.length || !kind) return fill(S.qNew, { id: nextNew });
  return fill(S[kind === "scan" ? "qScan" : "qHot"], { id: queue[0], i: total - queue.length + 1, total });
}

export const eventClass = (e: Ev) =>
  e.k === "pass" ? "pass" : e.k === "evict" ? "evict" : e.k === "forget" ? "forget" : e.k === "ghost" ? "ghost" : e.k === "hit" && e.to === "mfu" && e.from === "mru" ? "promote" : "read";
