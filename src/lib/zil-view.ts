// HTML for the ZIL and SLOG room's figure, built from a Zil of src/lib/zil.ts.
// Plain strings, no DOM: the page renders the opening state at build time
// (readable without JavaScript) and the script renders every later state, and
// every frame of an animated commit, with the same functions.
import { group } from "./l10n";
import {
  BLOCKSIZE, KIB, lwbRoom, LWB_STATES, logWrite, stateInput, zilWriteState, directPath,
  type Zil, type Ev, type Flags, type AllocClass, type Try, type Lwb, type Write, type LwbState, type WrState, type Block, type Rec,
} from "./zil";

export type ZilStrings = Record<string, string> & { refs: Record<string, string>; lang: string };

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const code = (s: string | number) => `<code>${s}</code>`;
const see = (S: ZilStrings, r: string) => ` <a class="see" href="${S.refs[r]}">${S.see}</a>`;

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

/** What is visible at step k of an action's events: the model's state after the action, with the steps not reached yet taken out. */
export interface Frame {
  states: Record<number, LwbState>;
  hiddenLwbs: number[];
  recs: number[];
  blocks: number[];
  inPlace: number[];
  pending: number[];
  /** Lwbs whose commit waiter has been attached. */
  waiters: number[];
  header: Zil["header"];
  /** The txg a create commit has synced so far (0 if none): its writes are in the tree from that step on. */
  syncedTxg: number;
  done: boolean;
  before: Zil;
}

export function frameAt(before: Zil, after: Zil, ev: Ev[], k: number): Frame {
  const states: Record<number, LwbState> = {};
  for (const l of before.lwbs) states[l.id] = l.state;
  const recs = before.lwbs.flatMap((l) => l.recs.map((r) => r.seq));
  const blocks = [...before.lwbs.flatMap((l) => (l.blk ? [l.blk.id] : [])), ...before.freed.map((b) => b.id)];
  const inPlace = [...before.inPlace];
  const assigned = new Set<number>();
  const waiters = before.lwbs.filter((l) => l.waiters).map((l) => l.id);
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
    if (e.k === "reuse") header = after.header;
    if (e.k === "head") header = { ...header, log: e.blk };
    if (e.k === "reuse") blocks.push(e.blk.id);
    if (e.k === "dropSynced") droppedTxg = e.txg;
    if (e.k === "sync") syncedTxg = e.txg;
  }
  const pendingBefore = [...new Set([...before.pending.map((i) => i.write), ...after.pending.map((i) => i.write)])];
  const fresh = ev[0]?.k === "itx" ? [ev[0].write] : [];
  return {
    states,
    hiddenLwbs: after.lwbs.filter((l) => !(l.id in states)).map((l) => l.id),
    recs,
    blocks,
    inPlace,
    pending: [...new Set([...pendingBefore, ...fresh])].filter((w) => !assigned.has(w) && after.writes[w - 1].txg > droppedTxg),
    waiters,
    header: k >= ev.length - 1 ? after.header : header,
    syncedTxg,
    done: k >= ev.length - 1,
    before,
  };
}

// ---------- The decision panel ----------

export function decision(s: Zil, S: ZilStrings, bytes: number, f: Flags): string {
  const input = stateInput(s, bytes, f);
  const { state, reasons } = zilWriteState(input);
  const plan = logWrite(input, 0);
  const sz = size(S, bytes);
  const lines: string[] = [];
  if (f.direct && !directPath(bytes, f)) lines.push(fill(S.rDirectShort, { size: sz }) + see(S, "shortDirect"));
  for (const r of reasons) {
    if (r === "throughput") lines.push(S.rThroughput + see(S, "tput"));
    else if (r === "direct") lines.push(S.rDirect + see(S, "tput"));
    else if (r === "small") lines.push(fill(S.rSmall, { size: sz }) + see(S, "imm"));
    else if (r === "halfBlock") lines.push(fill(S.rHalfBlock, { size: sz }) + see(S, "imm"));
    else if (r === "indirect") lines.push(fill(f.dsync ? S.rIndirectCommit : S.rIndirect, { size: sz }) + see(S, "imm"));
    else if (r === "slog") lines.push((s.pool.slog === "full" ? S.rSlogFull : S.rSlog) + see(S, "slog"));
    else if (r === "copied") lines.push(S.rCopied + see(S, "ret"));
    else if (r === "needCopy") lines.push(S.rNeedCopy + see(S, "ret"));
  }
  if (plan[0].downgraded) lines.push(fill(S.rDowngrade, { size: sz }) + see(S, "down"));
  if (state === "WR_INDIRECT") lines.push(S.rIndirectEnd + see(S, "inplace"));
  const final = plan[0].state;
  return `<p class="verdict">${stateBadge(final)} <span class="for">${sz}${f.dsync ? " · O_DSYNC" : ""}${f.direct ? " · O_DIRECT" : ""}</span></p>
<ol class="reasons">${lines.map((l) => `<li>${l}</li>`).join("")}</ol>
<p class="commit">${f.dsync ? S.commitYes : S.commitNo}${see(S, "commitFlag")}</p>`;
}

// ---------- The application's file ----------

function statusOf(w: Write, f?: Frame): Write["status"] {
  if (!f || f.done) return w.status;
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
      return `<li class="w ${status}"><span class="wid">${fill(S.wLine, { id: w.id, size: size(S, w.size), off: fill(S.kib, { n: num(S, w.off / KIB) }), txg: w.txg })}</span>${stateBadge(w.state)}<span class="wst">${fill(st[status], { txg: w.txg })}</span>${inPlace ? `<span class="tag">${S.inPlace}</span>` : ""}</li>`;
    })
    .join("")}</ul>`;
}

// ---------- Memory: pending itxs and the lwbs ----------

const recChip = (S: ZilStrings, r: Rec, split: boolean) =>
  `<li class="rec ${r.state.toLowerCase().replace(/_/g, "-")}" title="lrc_txg ${r.txg}">${fill(S.rec, { seq: r.seq, w: r.write, state: r.state.replace("WR_", ""), len: size(S, r.len) })}${split ? ` <span class="part">${S.recPart}</span>` : ""}</li>`;

/** Records that are part of a write split across lwbs. */
const splitSeqs = (recs: Rec[]) => {
  const by = new Map<number, number>();
  for (const r of recs) by.set(r.write, (by.get(r.write) ?? 0) + 1);
  return new Set(recs.filter((r) => r.state === "WR_NEED_COPY" && (by.get(r.write) ?? 0) > 1).map((r) => r.seq));
};

function lwbCard(_s: Zil, S: ZilStrings, l: Lwb, f: Frame | undefined, split: Set<number>): string {
  const state = f ? f.states[l.id] ?? l.state : l.state;
  const at = LWB_STATES.indexOf(state);
  const blk = l.blk && (!f || f.blocks.includes(l.blk.id)) ? l.blk : null;
  const recs = f ? l.recs.filter((r) => f.recs.includes(r.seq)) : l.recs;
  const used = recs.reduce((a, r) => a + r.bytes, 0);
  const steps = LWB_STATES.map((x, i) => `<li class="${i < at ? "past" : i === at ? "now" : ""}"${i === at ? ' aria-current="step"' : ""}>${x}</li>`).join("");
  return `<li class="lwb${state === "FLUSH_DONE" ? " done" : ""}" data-lwb="${l.id}">
<p class="lh"><strong>${fill(S.lwbTitle, { id: l.id })}</strong> <span class="lb">${blk ? fill(S.lwbBlock, { b: blk.id, cls: clsName(S, blk.cls) }) : S.lwbNoBlock}</span>${(f ? f.waiters.includes(l.id) : l.waiters > 0) && at < 6 ? ` <span class="tag wait">${S.lwbWaiter}</span>` : ""}</p>
<ol class="steps" aria-label="lwb_state_t">${steps}</ol>
${recs.length ? `<p class="used"><span class="meter"><span style="width:${((used / lwbRoom(l.size)) * 100).toFixed(1)}%"></span></span> ${fill(S.lwbUsed, { used: size(S, used), room: size(S, lwbRoom(l.size)) })}</p><ul class="recs">${recs.map((r) => recChip(S, r, split.has(r.seq))).join("")}</ul>` : ""}
</li>`;
}

export function memory(s: Zil, S: ZilStrings, f?: Frame): string {
  const pendingWrites = f ? f.pending : [...new Set(s.pending.map((i) => i.write))];
  const pend = pendingWrites.map((id) => s.writes[id - 1]).filter(Boolean);
  const pendHtml = pend.length
    ? `<ul class="itxs">${pend.map((w) => `<li class="itx">${stateBadge(w.state)} w${w.id} · ${size(S, w.size)} · txg ${w.txg}</li>`).join("")}</ul>`
    : `<p class="none">${S.noPending}</p>`;
  const lwbs = s.lwbs.filter((l) => !f || !f.hiddenLwbs.includes(l.id));
  const split = splitSeqs(s.lwbs.flatMap((l) => l.recs));
  const shown = lwbs.slice(-5);
  const lwbHtml = s.phase !== "running"
    ? `<p class="none">${s.phase === "crashed" ? S.phaseCrashed : S.phaseImported}</p>`
    : lwbs.length
      ? `<ol class="lwbs">${shown.map((l) => lwbCard(s, S, l, f, split)).join("")}</ol>`
      : `<p class="none">${S.noLwbs}</p>`;
  return `<h4>${S.pendingLabel}${see(S, "itx")}</h4>${pendHtml}<h4>${S.lwbsLabel}${see(S, "states")}</h4>${lwbHtml}`;
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
    const state = f ? f.states[l.id] ?? l.state : l.state;
    const at = LWB_STATES.indexOf(state);
    const recs = f ? l.recs.filter((r) => f.recs.includes(r.seq)) : l.recs;
    out.push({ blk: l.blk, recs: at >= 4 ? recs : [], kind: at === 6 ? "written" : at >= 4 ? "writing" : "end" });
    if (at < 4) break;
  }
  return out;
}

export function disk(s: Zil, S: ZilStrings, f?: Frame): string {
  const h = f ? f.header : s.header;
  const head = `<dl class="hdr">
<div><dt>${S.hLog}</dt><dd>${h.log === null ? S.hHole : `b${h.log}`}</dd></div>
<div><dt>${S.hClaim}</dt><dd>${h.claimTxg}</dd></div>
<div><dt>${S.hFlags}</dt><dd>${h.replayNeeded ? "ZIL_REPLAY_NEEDED" : "0"}</dd></div>
<div><dt>${S.hReplaySeq}</dt><dd>${h.replaySeq}</dd></div>
</dl>`;
  const links = chain(s, f);
  const ch = links.length
    ? `<ol class="chain"><li class="zh">zh_log</li>${links
        .map(
          (c) =>
            `<li class="blk ${c.kind}"><span class="arrow" aria-hidden="true">→</span><span class="bcol"><span class="bid">b${c.blk.id}</span><span class="bcls">${clsName(S, c.blk.cls)}</span>${
              c.kind === "end" ? `<span class="bnote">${S.unwritten}</span>` : c.recs.length ? `<span class="brecs">${c.recs.map((r) => `#${r.seq}`).join(" ")}</span>` : ""
            }</span></li>`,
        )
        .join("")}</ol>`
    : `<p class="none">${S.chainEmpty}</p>`;
  // Devices: every block ever allocated, by class; freed ones greyed.
  const live = new Map<number, string>();
  for (const c of links) live.set(c.blk.id, c.kind);
  const all = [
    ...(s.phase === "running" ? s.lwbs.flatMap((l) => (l.blk && (!f || f.blocks.includes(l.blk.id)) ? [l.blk] : [])) : s.disk.map((d) => d.blk)),
    ...s.freed.filter((b) => !f || f.blocks.includes(b.id)),
    ...(s.kept ? [s.kept] : []),
  ];
  const freed = new Set(s.freed.map((b) => b.id));
  const cell = (b: Block) =>
    `<li class="cell ${freed.has(b.id) ? "freed" : live.get(b.id) ?? "end"}" title="${freed.has(b.id) ? S.freedLabel : ""}">b${b.id}</li>`;
  const sorted = (xs: Block[]) => [...new Map(xs.map((b) => [b.id, b])).values()].sort((a, b) => a.id - b.id).slice(-14);
  const onSlog = sorted(all.filter((b) => b.cls === "log"));
  const onPool = sorted(all.filter((b) => b.cls !== "log"));
  const inPlace = f ? f.inPlace : s.inPlace;
  const data = inPlace.slice(-6).map((id) => `<li class="cell data">${fill(S.dataBlock, { id })}</li>`).join("");
  const slogRow = s.pool.slog !== "none" || onSlog.length
    ? `<div class="dev slog${s.pool.slog === "full" ? " full" : ""}"><p class="dl">${S.devSlog}${s.pool.slog === "full" ? ` · ${S.slogFull}` : ""}</p><ul class="cells">${onSlog.map(cell).join("") || `<li class="none">${S.devEmpty}</li>`}</ul></div>`
    : "";
  const poolRow = `<div class="dev pool"><p class="dl">${S.devPool}</p><ul class="cells">${onPool.map(cell).join("")}${data}${!onPool.length && !data ? `<li class="none">${S.devEmpty}</li>` : ""}</ul></div>`;
  return `<h4>${S.headerLabel}${see(S, "header")}</h4>${head}<h4>${S.chainLabel}${see(S, "issue")}</h4>${ch}<div class="devs">${slogRow}${poolRow}</div>`;
}

// ---------- Words for the log, the summary and the text version ----------

export function eventLine(S: ZilStrings, e: Ev): string {
  switch (e.k) {
    case "itx":
      return fill(e.recs > 1 ? S.eItxN : S.eItx, { size: size(S, e.size), recs: plural(S, e.recs, "itx1", "itxN"), txg: e.txg, state: e.state }) + see(S, "itx");
    case "create":
      return `${fill(S.eCreate, { b: e.blk.id, size: size(S, e.blk.size), cls: clsName(S, e.blk.cls) })} ${fill(S.eTried, { list: tried(S, e.tried) })}${see(S, "create")}`;
    case "createWait":
      return fill(S.eCreateWait, { txg: e.txg }) + see(S, "createWait");
    case "dropSynced":
      return fill(S.eDropSynced, { itxs: plural(S, e.itxs, "itx1", "itxN"), txg: e.txg }) + see(S, "dropSynced");
    case "reuse":
      return fill(S.eReuse, { b: e.blk.id, cls: clsName(S, e.blk.cls) }) + see(S, "reuse");
    case "lwb":
      return fill(S.eLwb, { id: e.lwb, state: code(e.state) }) + see(S, "states");
    case "assign":
      return fill(e.split ? S.eAssignPart : S.eAssign, { seq: e.seq, w: e.write, state: e.state, len: size(S, e.len), id: e.lwb, bytes: size(S, e.bytes) }) + see(S, "assign");
    case "waiter":
      return fill(S.eWaiter, { id: e.lwb }) + see(S, "close");
    case "inplace":
      return fill(S.eInPlace, { w: e.write }) + see(S, "inplace");
    case "alloc": {
      const fb = e.tried.length > 1;
      return fill(fb ? S.eAllocFallback : S.eAlloc, { id: e.lwb, b: e.blk.id, next: e.next, cls: clsName(S, e.blk.cls), list: tried(S, e.tried.slice(0, -1)) }) + see(S, "alloc");
    }
    case "returns":
      return (e.via === "sync" ? (e.how === "fsync" ? S.eReturnsFsyncSynced : S.eReturnsWriteSynced) : e.how === "fsync" ? S.eReturnsFsync : S.eReturnsWrite) + see(S, "flush");
    case "nothing":
      return S.eNothing + see(S, "prune");
    case "sync":
      return fill(S.eSync, { txg: e.txg, writes: plural(S, e.writes, "write1", "writeN"), dropped: plural(S, e.dropped, "itx1", "itxN") }) + see(S, "clean");
    case "free":
      return fill(S.eFree, { b: e.blk.id }) + see(S, "sync");
    case "head":
      return (e.blk === null ? S.eHeadHole : fill(S.eHead, { b: e.blk })) + see(S, "sync");
    case "crash":
      return fill(S.eCrash, { lost: plural(S, e.lost, "write1", "writeN") });
    case "claim":
      return fill(S.eClaim, { first: e.first, blocks: plural(S, e.blocks, "block1", "blockN"), recs: plural(S, e.recs, "rec1", "recN"), needed: e.needed ? S.yes : S.no }) + see(S, "claim");
    case "replay":
      return fill(S.eReplay, { seq: e.seq, txg: e.txg, w: e.write }) + see(S, "replay");
    case "skip":
      return fill(e.why === "txg" ? S.eSkipTxg : S.eSkipSeq, { seq: e.seq, txg: e.txg }) + see(S, "replay");
    case "destroy":
      return e.kept === null ? S.eDestroy + see(S, "destroy") : fill(S.eDestroyKeep, { b: e.kept }) + see(S, "keepFirst");
    case "refused":
      return e.why === "crashed" ? S.eRefCrashed : e.why === "imported" ? S.eRefImported : e.why === "notImported" ? S.eRefNotImported : S.eRefNotCrashed;
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
