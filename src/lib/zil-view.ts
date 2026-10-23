// HTML for the ZIL and SLOG room's figure, built from a Zil of src/lib/zil.ts.
// Plain strings, no DOM: the page renders the opening state at build time
// (readable without JavaScript) and the script renders every later state, and
// every frame of an animated commit, with the same functions.
import { group } from "./l10n";
import {
  BLOCKSIZE, KIB, lwbRoom, LWB_STATES, logWrite, stateInput, zilWriteState, directPath,
  type Zil, type Ev, type Flags, type AllocClass, type Try, type Lwb, type Write, type LwbState, type WrState, type Block, type Rec,
} from "./zil";

export type ZilStrings = Record<string, string> & { lang: string };

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** A whole number in the page's language, with narrow no-break spaces (FR) or commas (EN) between thousands. */
export function num(S: ZilStrings, x: number): string {
  return group(S.lang, String(Math.round(x)));
}
/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
export const plural = (S: ZilStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n: num(S, n) });
/** Sizes: whole KiB as KiB, anything else in bytes. */
export const size = (S: ZilStrings, b: number) => (b >= KIB && b % KIB === 0 ? fill(S.kib, { n: num(S, b / KIB) }) : plural(S, b, "byte1", "byteN"));

const CLS: Record<AllocClass, string> = {
  log: "clsLog",
  special_embedded_log: "clsSpecialEmbedded",
  special: "clsSpecial",
  embedded_log: "clsEmbedded",
  normal: "clsNormal",
};
export const clsName = (S: ZilStrings, c: AllocClass) => S[CLS[c]];
const tried = (S: ZilStrings, t: Try[]) =>
  t.map((x) => fill(x.why === "absent" ? S.tAbsent : x.why === "full" ? S.tFull : S.tTaken, { cls: clsName(S, x.cls) })).join(" · ");
const stateBadge = (st: WrState) => `<span class="wr ${st.toLowerCase().replace(/_/g, "-")}">${st}</span>`;

// ---------- Frames: a commit drawn step by step ----------

/**
 * What is visible at step k of an action's events. A commit (write() with O_DSYNC, fsync()) is
 * drawn from the model's state after the action, with the steps not reached yet taken out. A txg
 * sync and a mount are drawn from the state before the action (`pre`), with the steps reached so
 * far laid over it: the writes synced or replayed, the blocks freed, the header.
 */
export interface Frame {
  pre: boolean;
  states: Record<number, LwbState>;
  hiddenLwbs: number[];
  recs: number[];
  blocks: number[];
  inPlace: number[];
  pending: number[];
  /** Lwbs whose commit waiter has been attached. */
  waiters: number[];
  header: Zil["header"];
  /** The txg synced so far by this action (0 if none): its writes are in the tree from that step on. */
  syncedTxg: number;
  /** Blocks freed so far by this action. */
  freed: number[];
  /** Writes replayed so far by this action. */
  replayed: number[];
  done: boolean;
  before: Zil;
}

/** Actions drawn from the state before them: a txg sync and a mount. Only sync() starts with a
 * "sync" event and only mount() emits "destroy" (src/lib/zil.ts). */
export const drawnBefore = (ev: Ev[]) => ev[0]?.k === "sync" || ev.some((e) => e.k === "destroy");

export function frameAt(before: Zil, after: Zil, ev: Ev[], k: number): Frame {
  const pre = drawnBefore(ev);
  const states: Record<number, LwbState> = {};
  for (const l of before.lwbs) states[l.id] = l.state;
  const recs = before.lwbs.flatMap((l) => l.recs.map((r) => r.seq));
  const blocks = [...before.lwbs.flatMap((l) => (l.blk ? [l.blk.id] : [])), ...before.freed.map((b) => b.id)];
  const inPlace = [...before.inPlace];
  const assigned = new Set<number>();
  const waiters = before.lwbs.filter((l) => l.waiters).map((l) => l.id);
  const freed: number[] = [];
  const replayed: number[] = [];
  let header = before.header;
  let droppedTxg = 0;
  let syncedTxg = 0;
  for (let i = 0; i <= k && i < ev.length; i++) {
    const e = ev[i];
    if (e.k === "lwb") states[e.lwb] = e.state;
    else if (e.k === "assign") {
      recs.push(e.seq);
      assigned.add(e.write);
    } else if (e.k === "create" || e.k === "alloc") blocks.push(e.blk.id);
    else if (e.k === "inplace") inPlace.push(e.write);
    else if (e.k === "waiter") waiters.push(e.lwb);
    else if (e.k === "free") freed.push(e.blk.id);
    else if (e.k === "replay") replayed.push(e.write);
    if (e.k === "reuse") header = after.header;
    if (e.k === "head") header = { ...header, log: e.blk };
    if (e.k === "reuse") blocks.push(e.blk.id);
    if (e.k === "dropSynced") droppedTxg = e.txg;
    if (e.k === "sync") syncedTxg = e.txg;
  }
  const pendingBefore = [...new Set([...before.pending.map((i) => i.write), ...after.pending.map((i) => i.write)])];
  const fresh = ev[0]?.k === "itx" ? [ev[0].write] : [];
  const gone = pre ? syncedTxg : droppedTxg;
  return {
    pre,
    states,
    hiddenLwbs: after.lwbs.filter((l) => !(l.id in states)).map((l) => l.id),
    recs,
    blocks,
    inPlace,
    pending: [...new Set([...pendingBefore, ...fresh])].filter((w) => !assigned.has(w) && after.writes[w - 1].txg > gone),
    waiters,
    header: k >= ev.length - 1 ? after.header : header,
    syncedTxg,
    freed,
    replayed,
    done: k >= ev.length - 1,
    before,
  };
}

/** The state a frame is drawn from: the state before a sync or a mount, until its last step. */
const base = (s: Zil, f?: Frame) => (f && f.pre && !f.done ? f.before : s);

// ---------- The decision panel ----------

export function decision(s: Zil, S: ZilStrings, bytes: number, f: Flags): string {
  const input = stateInput(s, bytes, f);
  const { state, reasons } = zilWriteState(input);
  const plan = logWrite(input, 0);
  const sz = size(S, bytes);
  const lines: string[] = [];
  if (f.direct && !directPath(bytes, f)) lines.push(fill(S.rDirectShort, { size: sz }));
  for (const r of reasons) {
    if (r === "throughput") lines.push(S.rThroughput);
    else if (r === "direct") lines.push(S.rDirect);
    else if (r === "small") lines.push(fill(S.rSmall, { size: sz }));
    else if (r === "halfBlock") lines.push(fill(S.rHalfBlock, { size: sz }));
    else if (r === "indirect") lines.push(fill(f.dsync ? S.rIndirectCommit : S.rIndirect, { size: sz }));
    else if (r === "slog") lines.push((s.pool.slog === "full" ? S.rSlogFull : S.rSlog));
    else if (r === "copied") lines.push(S.rCopied);
    else if (r === "needCopy") lines.push(S.rNeedCopy);
  }
  if (plan[0].downgraded) lines.push(fill(S.rDowngrade, { size: sz }));
  if (state === "WR_INDIRECT") lines.push(S.rIndirectEnd);
  const final = plan[0].state;
  return `<p class="verdict">${stateBadge(final)} <span class="for">${sz}${f.dsync ? " · O_DSYNC" : ""}${f.direct ? " · O_DIRECT" : ""}</span></p>
<ol class="reasons">${lines.map((l) => `<li>${l}</li>`).join("")}</ol>
<p class="commit">${f.dsync ? S.commitYes : S.commitNo}</p>`;
}

// ---------- The application's file ----------

function statusOf(w: Write, f?: Frame): Write["status"] {
  if (!f || f.done) return w.status;
  if (f.replayed.includes(w.id)) return "replayed";
  const b = f.before.writes[w.id - 1];
  const st = b ? b.status : "memory";
  return (st === "memory" || st === "logged") && w.txg <= f.syncedTxg ? "synced" : st;
}

export function writes(s: Zil, S: ZilStrings, f?: Frame): string {
  if (!s.writes.length) return `<p class="none">${S.noWrites}</p>`;
  const st: Record<Write["status"], string> = {
    memory: S.stMemory,
    logged: S.stLogged,
    synced: S.stSynced,
    lost: S.stLost,
    replayed: S.stReplayed,
  };
  const shown = s.writes.slice(-8);
  const more = s.writes.length - shown.length;
  return `<ul class="writes">${more ? `<li class="more">… ${plural(S, more, "write1", "writeN")}</li>` : ""}${shown
    .map((w) => {
      const status = statusOf(w, f);
      const inPlace = f ? f.inPlace.includes(w.id) : w.inPlace;
      return `<li class="w ${status}" data-w="${w.id}" data-wtxg="${w.txg}"><span class="wid">${fill(S.wLine, { id: w.id, size: size(S, w.size), off: fill(S.kib, { n: num(S, w.off / KIB) }), txg: w.txg })}</span>${stateBadge(w.state)}<span class="wst">${fill(st[status], { txg: w.txg })}</span>${inPlace ? `<span class="tag">${S.inPlace}</span>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

// ---------- Memory: pending itxs and the lwbs ----------

const recChip = (S: ZilStrings, r: Rec, split: boolean) =>
  `<li class="rec ${r.state.toLowerCase().replace(/_/g, "-")}" data-seq="${r.seq}">${fill(S.rec, { seq: r.seq, w: r.write, state: r.state.replace("WR_", ""), len: size(S, r.len) })}${split ? ` <span class="part">${S.recPart}</span>` : ""}</li>`;

/** Records that are part of a write split across lwbs. */
const splitSeqs = (recs: Rec[]) => {
  const by = new Map<number, number>();
  for (const r of recs) by.set(r.write, (by.get(r.write) ?? 0) + 1);
  return new Set(recs.filter((r) => r.state === "WR_NEED_COPY" && (by.get(r.write) ?? 0) > 1).map((r) => r.seq));
};

function lwbCard(S: ZilStrings, l: Lwb, f: Frame | undefined, split: Set<number>): string {
  const state = f ? f.states[l.id] ?? l.state : l.state;
  const at = LWB_STATES.indexOf(state);
  const blk = l.blk && (!f || f.blocks.includes(l.blk.id)) ? l.blk : null;
  const recs = f ? l.recs.filter((r) => f.recs.includes(r.seq)) : l.recs;
  const used = recs.reduce((a, r) => a + r.bytes, 0);
  const steps = LWB_STATES.map((x, i) => `<li class="${i < at ? "past" : i === at ? "now" : ""}"${i === at ? ' aria-current="step"' : ""}>${x}</li>`).join("");
  return `<li class="lwb${state === "FLUSH_DONE" ? " done" : ""}" data-lwb="${l.id}">
<p class="lh"><strong>${fill(S.lwbTitle, { id: l.id })}</strong> <span class="lb">${blk ? fill(S.lwbBlock, { b: blk.id, cls: clsName(S, blk.cls) }) : S.lwbNoBlock}</span>${(f ? f.waiters.includes(l.id) : l.waiters > 0) && at < 6 ? ` <span class="tag wait">${S.lwbWaiter}</span>` : ""}</p>
<ol class="steps" aria-label="${S.lwbStates}">${steps}</ol>
${recs.length ? `<p class="used"><span class="meter"><span style="width:${((used / lwbRoom(l.size)) * 100).toFixed(1)}%"></span></span> ${fill(S.lwbUsed, { used: size(S, used), room: size(S, lwbRoom(l.size)) })}</p><ul class="recs">${recs.map((r) => recChip(S, r, split.has(r.seq))).join("")}</ul>` : ""}
</li>`;
}

export function memory(s0: Zil, S: ZilStrings, f?: Frame): string {
  const s = base(s0, f);
  const pendingWrites = f ? f.pending : [...new Set(s.pending.map((i) => i.write))];
  const pend = pendingWrites.map((id) => s0.writes[id - 1]).filter(Boolean);
  const pendHtml = pend.length
    ? `<ul class="itxs">${pend.map((w) => `<li class="itx" data-itx="${w.id}">${stateBadge(w.state)} w${w.id} · ${size(S, w.size)} · txg ${w.txg}</li>`).join("")}</ul>`
    : `<p class="none">${S.noPending}</p>`;
  const lwbs = s.lwbs.filter((l) => !f || (!f.hiddenLwbs.includes(l.id) && !(l.blk && f.freed.includes(l.blk.id))));
  const split = splitSeqs(s.lwbs.flatMap((l) => l.recs));
  const shown = lwbs.slice(-5);
  const lwbHtml = s.phase !== "running"
    ? `<p class="none">${s.phase === "crashed" ? S.phaseCrashed : S.phaseImported}</p>`
    : lwbs.length
      ? `<ol class="lwbs">${shown.map((l) => lwbCard(S, l, f, split)).join("")}</ol>`
      : `<p class="none">${S.noLwbs}</p>`;
  return `<h4>${S.pendingLabel}</h4>${pendHtml}<h4>${S.lwbsLabel}</h4>${lwbHtml}`;
}

// ---------- Disk: the header, the chain, the devices ----------

interface Link {
  blk: Block;
  recs: Rec[];
  kind: "written" | "writing" | "end";
}

function chain(s: Zil, f?: Frame): Link[] {
  if (s.phase !== "running")
    return s.disk.map((d) => ({ blk: d.blk, recs: d.recs, kind: d.written ? "written" : "end" }));
  if (s.kept && !s.lwbs.length) return [{ blk: s.kept, recs: [], kind: "end" }];
  const out: Link[] = [];
  for (const l of s.lwbs) {
    if (!l.blk || (f && !f.blocks.includes(l.blk.id))) break;
    if (f && f.freed.includes(l.blk.id)) continue;
    const state = f ? f.states[l.id] ?? l.state : l.state;
    const at = LWB_STATES.indexOf(state);
    const recs = f ? l.recs.filter((r) => f.recs.includes(r.seq)) : l.recs;
    out.push({ blk: l.blk, recs: at >= 4 ? recs : [], kind: at === 6 ? "written" : at >= 4 ? "writing" : "end" });
    if (at < 4) break;
  }
  return out;
}

export function disk(s0: Zil, S: ZilStrings, f?: Frame): string {
  const s = base(s0, f);
  const h = f ? f.header : s.header;
  const head = `<dl class="hdr">
<div data-h="log"><dt>${S.hLog}</dt><dd>${h.log === null ? S.hHole : `b${h.log}`}</dd></div>
<div data-h="claim"><dt>${S.hClaim}</dt><dd>${h.claimTxg || S.hNever}</dd></div>
<div data-h="flags"><dt>${S.hFlags}</dt><dd>${h.replayNeeded ? S.yes : S.no}</dd></div>
<div data-h="seq"><dt>${S.hReplaySeq}</dt><dd>${h.replaySeq}</dd></div>
</dl>`;
  const links = chain(s, f);
  const ch = links.length
    ? `<ol class="chain"><li class="zh">${S.chainStart}</li>${links
        .map(
          (c) =>
            `<li class="blk ${c.kind}" data-b="${c.blk.id}"><span class="arrow" aria-hidden="true">→</span><span class="bcol"><span class="bid">b${c.blk.id}</span><span class="bcls">${clsName(S, c.blk.cls)}</span>${
              c.kind === "end" ? `<span class="bnote">${S.unwritten}</span>` : c.recs.length ? `<span class="brecs">${c.recs.map((r) => `<span data-seq="${r.seq}">#${r.seq}</span>`).join(" ")}</span>` : ""
            }</span></li>`,
        )
        .join("")}</ol>`
    : `<p class="none">${S.chainEmpty}</p>`;
  // Devices: every block ever allocated, by class; freed ones greyed.
  const kinds = new Map<number, string>();
  for (const c of links) kinds.set(c.blk.id, c.kind);
  const all = [
    ...(s.phase === "running" ? s.lwbs.flatMap((l) => (l.blk && (!f || f.blocks.includes(l.blk.id)) ? [l.blk] : [])) : s.disk.map((d) => d.blk)),
    ...s.freed.filter((b) => !f || f.blocks.includes(b.id)),
    ...(s.kept ? [s.kept] : []),
  ];
  const freed = new Set([...s.freed.map((b) => b.id), ...(f ? f.freed : [])]);
  const cell = (b: Block) =>
    `<li class="cell ${freed.has(b.id) ? "freed" : kinds.get(b.id) ?? "end"}" data-cell="${b.id}"${freed.has(b.id) ? ` title="${S.freedLabel}"` : ""}>b${b.id}${freed.has(b.id) ? `<span class="visually-hidden"> (${S.freedLabel})</span>` : ""}</li>`;
  const sorted = (xs: Block[]) => [...new Map(xs.map((b) => [b.id, b])).values()].sort((a, b) => a.id - b.id).slice(-14);
  const onSlog = sorted(all.filter((b) => b.cls === "log"));
  const onPool = sorted(all.filter((b) => b.cls !== "log"));
  const inPlace = f ? f.inPlace : s.inPlace;
  const data = inPlace.slice(-6).map((id) => `<li class="cell data" data-data="${id}">${fill(S.dataBlock, { id })}</li>`).join("");
  const slogRow = s.pool.slog !== "none" || onSlog.length
    ? `<div class="dev slog${s.pool.slog === "full" ? " full" : ""}"><p class="dl">${S.devSlog}${s.pool.slog === "full" ? ` · ${S.slogFull}` : ""}</p><ul class="cells">${onSlog.map(cell).join("") || `<li class="none">${S.devEmpty}</li>`}</ul></div>`
    : "";
  const poolRow = `<div class="dev pool"><p class="dl">${S.devPool}</p><ul class="cells">${onPool.map(cell).join("")}${data}${!onPool.length && !data ? `<li class="none">${S.devEmpty}</li>` : ""}</ul></div>`;
  return `<h4>${S.headerLabel}</h4>${head}<h4>${S.chainLabel}</h4>${ch}<div class="devs">${slogRow}${poolRow}</div>`;
}

// ---------- Words for the log, the summary and the text version ----------

export function eventLine(S: ZilStrings, e: Ev): string {
  switch (e.k) {
    case "itx":
      return fill(e.recs > 1 ? S.eItxN : S.eItx, { size: size(S, e.size), recs: plural(S, e.recs, "rec1", "recN"), txg: e.txg, state: e.state });
    case "create":
      return `${fill(S.eCreate, { b: e.blk.id, size: size(S, e.blk.size), cls: clsName(S, e.blk.cls) })} ${fill(S.eTried, { list: tried(S, e.tried) })}`;
    case "createWait":
      return fill(S.eCreateWait, { txg: e.txg });
    case "dropSynced":
      return fill(S.eDropSynced, { itxs: plural(S, e.itxs, "rec1", "recN"), txg: e.txg });
    case "reuse":
      return fill(S.eReuse, { b: e.blk.id, cls: clsName(S, e.blk.cls) });
    case "lwb":
      return fill(S[`eLwb${e.state}`], { id: e.lwb });
    case "assign":
      return fill(e.split ? S.eAssignPart : S.eAssign, { seq: e.seq, w: e.write, state: e.state, len: size(S, e.len), id: e.lwb, bytes: size(S, e.bytes) });
    case "waiter":
      return fill(S.eWaiter, { id: e.lwb });
    case "inplace":
      return fill(S.eInPlace, { w: e.write });
    case "alloc": {
      const fb = e.tried.length > 1;
      return fill(fb ? S.eAllocFallback : S.eAlloc, { id: e.lwb, b: e.blk.id, next: e.next, cls: clsName(S, e.blk.cls), list: tried(S, e.tried.slice(0, -1)) });
    }
    case "returns":
      return (e.via === "sync" ? (e.how === "fsync" ? S.eReturnsFsyncSynced : S.eReturnsWriteSynced) : e.how === "fsync" ? S.eReturnsFsync : S.eReturnsWrite);
    case "nothing":
      return S.eNothing;
    case "sync":
      return fill(S.eSync, { txg: e.txg, writes: plural(S, e.writes, "write1", "writeN"), dropped: plural(S, e.dropped, "rec1", "recN") });
    case "free":
      return fill(S.eFree, { b: e.blk.id });
    case "head":
      return (e.blk === null ? S.eHeadHole : fill(S.eHead, { b: e.blk }));
    case "crash":
      return fill(S.eCrash, { lost: plural(S, e.lost, "write1", "writeN") });
    case "claim":
      if (e.blocks === 0) return fill(S.eClaimHole, { first: e.first });
      return fill(S.eClaim, { first: e.first, blocks: plural(S, e.blocks, "block1", "blockN"), recs: plural(S, e.recs, "rec1", "recN"), needed: e.needed ? S.yes : S.no });
    case "replay":
      return fill(S.eReplay, { seq: e.seq, txg: e.txg, w: e.write });
    case "skip":
      return fill(e.why === "txg" ? S.eSkipTxg : S.eSkipSeq, { seq: e.seq, txg: e.txg });
    case "destroy":
      return e.kept === null ? S.eDestroy : fill(S.eDestroyKeep, { b: e.kept });
    case "refused":
      return e.why === "crashed" ? S.eRefCrashed : e.why === "imported" ? S.eRefImported : e.why === "notImported" ? S.eRefNotImported : S.eRefNotCrashed;
  }
}

/** The parts of the figure an event changed: they get a ring until the next step (D30.1). */
export function targets(e: Ev): string[] {
  switch (e.k) {
    case "itx":
      return [`[data-itx="${e.write}"]`, `[data-w="${e.write}"]`];
    case "create":
    case "reuse":
    case "alloc":
      return [`[data-b="${e.blk.id}"]`, `[data-cell="${e.blk.id}"]`];
    case "createWait":
    case "head":
    case "destroy":
      return ['[data-h="log"]'];
    case "dropSynced":
    case "sync":
      return [`[data-wtxg="${e.txg}"]`];
    case "lwb":
    case "waiter":
      return [`[data-lwb="${e.lwb}"]`];
    case "assign":
      return [`[data-lwb="${e.lwb}"] [data-seq="${e.seq}"]`];
    case "inplace":
      return [`[data-data="${e.write}"]`];
    case "returns":
    case "nothing":
      // The last write, or the "no write yet" line when fsync() is pressed first.
      return [".writes > li:last-child", "[data-writes] > .none"];
    case "free":
      return [`[data-cell="${e.blk.id}"]`];
    case "crash":
      return ["[data-memory]", ".w.lost"];
    case "claim":
      return ['[data-h="claim"]', '[data-h="flags"]'];
    case "replay":
      return [`[data-b] [data-seq="${e.seq}"]`, `[data-w="${e.write}"]`];
    case "skip":
      return [`[data-b] [data-seq="${e.seq}"]`];
    case "refused":
      return [];
  }
}

export const eventClass = (e: Ev) =>
  ({ lwb: "step", assign: "assign", alloc: "alloc", create: "alloc", createWait: "step", dropSynced: "step", reuse: "alloc", returns: "returns", crash: "crash", claim: "claim", replay: "replay", skip: "step", refused: "refused", free: "step", head: "step" })[e.k as string] ?? "";

const SHORT: Record<Write["status"], [string, string]> = {
  memory: ["shMemory1", "shMemoryN"],
  logged: ["shLogged1", "shLoggedN"],
  synced: ["shSynced1", "shSyncedN"],
  lost: ["shLost1", "shLostN"],
  replayed: ["shReplayed1", "shReplayedN"],
};

export function summary(s: Zil, S: ZilStrings): string {
  const counts = new Map<Write["status"], number>();
  for (const w of s.writes) counts.set(w.status, (counts.get(w.status) ?? 0) + 1);
  const statuses = [...counts].map(([k, n]) => plural(S, n, SHORT[k][0], SHORT[k][1])).join(", ");
  const blocks = chain(s).length;
  return fill(S.summary, {
    txg: s.txg,
    synced: s.synced,
    writes: plural(S, s.writes.length, "write1", "writeN"),
    statuses: statuses || S.noneW,
    blocks: plural(S, blocks, "block1", "blockN"),
    head: s.header.log === null ? S.hHole : `b${s.header.log}`,
  });
}

export function describe(s: Zil, S: ZilStrings): string {
  const st: Record<string, string> = { memory: S.stMemory, logged: S.stLogged, synced: S.stSynced, lost: S.stLost, replayed: S.stReplayed };
  const wl = s.writes.length
    ? s.writes.map((w) => `${fill(S.wLine, { id: w.id, size: size(S, w.size), off: fill(S.kib, { n: num(S, w.off / KIB) }), txg: w.txg })}, ${w.state}, ${fill(st[w.status], { txg: w.txg })}`).join((S.lang === "fr" ? "\u202f; " : "; "))
    : S.noneW;
  const pl = s.pending.length ? s.pending.map((i) => `w${i.write} ${i.state} ${size(S, i.len)}`).join((S.lang === "fr" ? "\u202f; " : "; ")) : S.none;
  const ll = s.lwbs.length
    ? s.lwbs.map((l) => `lwb ${l.id} ${l.state}${l.blk ? ` b${l.blk.id} (${clsName(S, l.blk.cls)})` : ""}${l.recs.length ? `${(S.lang === "fr" ? "\u00a0: " : ": ")}${l.recs.map((r) => `#${r.seq} w${r.write} ${r.state} ${size(S, r.len)}`).join(", ")}` : ""}`).join((S.lang === "fr" ? "\u202f; " : "; "))
    : S.none;
  const links = chain(s);
  const cl = links.length ? links.map((c) => `b${c.blk.id} (${clsName(S, c.blk.cls)}${c.kind === "end" ? `, ${S.unwritten}` : c.recs.length ? `${S.lang === "fr" ? "\u00a0: " : ": "}${c.recs.map((r) => `#${r.seq}`).join(" ")}` : ""})`).join(" → ") : S.chainNone;
  const pool = s.pool.slog === "none" ? S.tPoolNone : s.pool.slog === "full" ? S.tPoolFull : S.tPoolSlog;
  return `<p>${fill(S.tIntro, { slog: pool, bias: s.logbias, txg: s.txg, synced: s.synced })}</p>
<ul>
<li>${fill(S.tWrites, { list: wl })}</li>
<li>${fill(S.tPending, { list: pl })}</li>
<li>${fill(S.tLwbs, { list: ll })}</li>
<li>${fill(S.tChain, { list: cl })}</li>
<li>${fill(S.tHeader, { log: s.header.log === null ? S.hHole : `b${s.header.log}`, claim: s.header.claimTxg, needed: s.header.replayNeeded ? S.yes : S.no })}</li>
</ul>
<p>${summary(s, S)}</p>`;
}

export { BLOCKSIZE };
