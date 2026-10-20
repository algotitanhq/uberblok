// HTML for the send / receive room's figure, built from src/lib/send.ts.
// Plain strings, no DOM: the page renders the finished stream at build time
// (readable without JavaScript) and the script renders every frame of the
// traversal and of the receive with the same functions.
//
// A frame is a position t on one timeline: t = 0 … steps.length is the
// traversal (t steps done; BEGIN is out before the first); t = steps.length + 1
// writes the pending record and END; after that, each t dispatches one more
// record on the receiving side.
import { group } from "./l10n";
import { shortCksum } from "./fletcher4";
import {
  OBJECT_END, allBps, contentOf, dnodeBlocks, sameContent,
  type Bp, type Content, type Dnode, type Rec, type Received, type Send, type Snapshot, type Step,
} from "./send";

export type SrStrings = Record<string, string> & { refs: Record<string, string>; lang: string };

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const code = (s: string | number) => `<code>${s}</code>`;
const see = (S: SrStrings, r: string) => ` <a class="see" href="${S.refs[r]}">${S.see}</a>`;

/** A whole number in the page's language. */
export const num = (S: SrStrings, x: number) =>
  group(S.lang, String(Math.round(x)));
/** Singular for 1 in English, for 0 and 1 in French (DECISIONS.md D7.4). */
export const plural = (S: SrStrings, n: number, one: string, many: string) =>
  fill((S.lang === "fr" ? n < 2 : n === 1) ? S[one] : S[many], { n: num(S, n) });

/** The last frame of a send. */
export const lastFrame = (snd: Send, rcv: Received) => snd.steps.length + 1 + rcv.dispatched.length + (rcv.error ? 1 : 0);
/** Traversal steps done at frame t. */
const stepsDone = (snd: Send, t: number) => Math.min(t, snd.steps.length);
/** Records written at frame t. */
export const written = (snd: Send, t: number) =>
  t > snd.steps.length ? snd.records.length : snd.records.filter((r) => r.step < t).length;
/** Records dispatched by the receiver at frame t. */
export const received = (snd: Send, rcv: Received, t: number) => Math.max(0, Math.min(t - snd.steps.length - 1, rcv.dispatched.length));
/** Has the receiver reached its error at frame t? */
const failed = (snd: Send, rcv: Received, t: number) => !!rcv.error && t - snd.steps.length - 1 > rcv.dispatched.length;

// ---------------------------------------------------------------- names

/** A file's name, from the snapshot sent or the from-snapshot (c exists only in the latter). */
const fileName = (snd: Send, object: number) => {
  for (const s of [snd.to, snd.from]) if (s) for (const b of dnodeBlocks(s.root)) for (const d of b.dnodes ?? []) if (d.object === object && d.name) return d.name;
  return String(object);
};

export function bpLabel(S: SrStrings, snd: Send, b: Bp): string {
  switch (b.kind) {
    case "objset": return S.bpObjset;
    case "meta": return S.bpMeta;
    case "dnodes": return fill(S.bpDnodes, { n: b.blkid });
    case "indirect": return fill(S.bpIndirect, { f: fileName(snd, b.object) });
    case "data": return b.hole ? fill(S.bpHole, { f: fileName(snd, b.object), i: b.blkid }) : fill(S.bpData, { f: fileName(snd, b.object), i: b.blkid });
  }
}

/** A record in a few words: "WRITE a @1024". */
export function recLabel(S: SrStrings, snd: Send, r: Rec): string {
  const f = (o: number) => fileName(snd, o);
  switch (r.type) {
    case "OBJECT": return fill(S.rObject, { o: r.object!, f: f(r.object!) });
    case "WRITE": return fill(S.rWrite, { o: r.object!, f: f(r.object!), off: num(S, r.offset!), data: r.data! });
    case "FREE":
      return r.length === OBJECT_END
        ? fill(S.rFreeEnd, { o: r.object!, f: f(r.object!), off: num(S, r.offset!) })
        : fill(S.rFree, { o: r.object!, f: f(r.object!), off: num(S, r.offset!), len: num(S, r.length!) });
    case "FREEOBJECTS": return fill(r.numobjs === 1 ? S.rFreeobjects1 : S.rFreeobjectsN, { o: r.firstobj!, last: r.firstobj! + r.numobjs! - 1 });
    case "BEGIN": return S.rBegin;
    case "END": return S.rEnd;
  }
}

// ---------------------------------------------------------------- the tree

type BpState = "todo" | "visit" | "skip" | "pruned";

function bpStates(snd: Send, t: number): { st: Map<string, BpState>; cur: string | null; curDn: number | null; dn: Set<number> } {
  const st = new Map<string, BpState>();
  const dn = new Set<number>();
  for (const b of allBps(snd.to.root)) st.set(b.id, "todo");
  const done = stepsDone(snd, t);
  for (let i = 0; i < done; i++) {
    const s = snd.steps[i];
    if (s.k === "dnode") dn.add(s.dn!.object);
    else {
      st.set(s.bp!.id, s.visit ? "visit" : "skip");
      for (const id of s.pruned ?? []) st.set(id, "pruned");
    }
  }
  const last = done > 0 && t <= snd.steps.length ? snd.steps[done - 1] : null;
  return { st, cur: last?.k === "test" ? last.bp!.id : null, curDn: last?.k === "dnode" ? last.dn!.object : null, dn };
}

function chip(S: SrStrings, snd: Send, b: Bp, state: BpState, cur: boolean): string {
  const F = snd.minTxg;
  const label = bpLabel(S, snd, b);
  const why =
    state === "visit" ? fill(b.birth === 0 ? S.aVisitZero : S.aVisit, { birth: b.birth, F })
      : state === "skip" ? fill(S.aSkip, { birth: b.birth, F })
        : state === "pruned" ? S.aPruned : S.aTodo;
  const aria = `${fill(S.aBp, { label, birth: b.birth })}: ${why}`;
  const text = b.kind === "data" ? (b.hole ? S.hole : b.data!) : label;
  const cmp = state === "skip" ? `<span class="cmp">≤&#8239;${F}</span>` : state === "visit" && b.birth > 0 ? `<span class="cmp">&gt;&#8239;${F}</span>` : "";
  return `<span class="bp ${b.kind}${b.hole ? " hole" : ""} ${state}${cur ? " cur" : ""}" data-bp="${b.id}" role="img" aria-label="${aria}"><span class="t">${text}</span><sub>${b.birth}</sub>${cmp}</span>`;
}

function slot(S: SrStrings, d: Dnode, met: boolean, cur: boolean): string {
  const label = d.type === "reserved" ? S.slotReserved : d.type === "none" ? S.slotFree : d.name!;
  const aria = fill(d.type === "file" ? S.aSlotFile : d.type === "none" ? S.aSlotFree : S.aSlotReserved, { o: d.object, f: d.name ?? "" }) + (met ? ` ${S.aMet}` : "");
  return `<span class="slot ${d.type}${met ? " met" : ""}${cur ? " cur" : ""}" data-dn="${d.object}" role="img" aria-label="${aria}"><span class="o">${d.object}</span>${label}</span>`;
}

/** The tree of the snapshot being sent, each block pointer as the traversal left it at frame t. */
export function tree(S: SrStrings, snd: Send, t: number): string {
  const { st, cur, curDn, dn } = bpStates(snd, t);
  const c = (b: Bp) => chip(S, snd, b, st.get(b.id)!, cur === b.id);
  const root = snd.to.root;
  const meta = root.kids![0];
  const files = (blk: Bp) =>
    (blk.dnodes ?? [])
      .filter((d) => d.bp)
      .map((d) => `<li class="file"><div class="row">${c(d.bp!)}<span class="arrow" aria-hidden="true">→</span><span class="leaves">${d.bp!.kids!.map(c).join("")}</span></div></li>`)
      .join("");
  const blocks = meta.kids!
    .map(
      (blk) =>
        `<li><div class="row">${c(blk)}<span class="slots">${(blk.dnodes ?? []).map((d) => slot(S, d, dn.has(d.object), curDn === d.object)).join("")}</span></div>${blk.hole ? "" : `<ul>${files(blk)}</ul>`}</li>`,
    )
    .join("");
  return `<ul class="tree" aria-label="${S.treeLabel}"><li><div class="row">${c(root)}</div><ul><li><div class="row">${c(meta)}</div><ul>${blocks}</ul></li></ul></li></ul>`;
}

// ---------------------------------------------------------------- one step, in words

const cbText = (S: SrStrings, s: Step) => {
  if (s.k === "dnode") return s.dn!.object === 0 ? S.cbMeta : s.dn!.type === "file" ? S.cbObject : S.cbFreeobjects;
  const b = s.bp!;
  if (b.kind === "dnodes") return b.hole ? S.cbHoleMeta : S.cbObjectRange;
  if (b.kind === "data") return b.hole ? S.cbHole : S.cbData;
  return S.cbNone;
};

/** What step i did, with the records it wrote. */
export function stepLine(S: SrStrings, snd: Send, i: number): string {
  const s = snd.steps[i];
  const recs = s.emitted.map((j) => `<b>${recLabel(S, snd, snd.records[j])}</b>`);
  const out = recs.length ? ` ${fill(recs.length === 1 ? S.wrote1 : S.wroteN, { list: recs.join(", ") })}` : "";
  if (s.k === "dnode") {
    const d = s.dn!;
    const what = fill(d.type === "file" ? S.sDnodeFile : d.type === "none" ? S.sDnodeFree : S.sDnodeReserved, { o: d.object, f: d.name ?? "" });
    const pend = d.type === "none" && !recs.length ? ` ${S.pending}` : "";
    return `${what} ${cbText(S, s)}${see(S, d.type === "file" ? "dumpDnode" : "sendCbDnode")}${out}${pend}`;
  }
  const b = s.bp!;
  const label = bpLabel(S, snd, b);
  if (!s.visit) {
    const n = s.pruned!.length;
    const tail = n ? fill(S.sSkipBelow, { n: plural(S, n, "bp1", "bpN") }) : S.sSkipLeaf;
    return `${fill(S.sSkip, { label, birth: b.birth, F: snd.minTxg })} ${tail}${see(S, "visitbp")}`;
  }
  const pend = b.hole && !recs.length ? ` ${S.pending}` : "";
  return `${fill(s.zeroHole ? S.sVisitZeroHole : S.sVisit, { label, birth: b.birth, F: snd.minTxg })} ${cbText(S, s)}${see(S, b.kind === "data" ? "sendCbData" : "sendCbMeta")}${out}${pend}`;
}

/** What frame t did, for the status line and the log. */
export function frameLine(S: SrStrings, snd: Send, rcv: Received, t: number): string {
  if (t === 0) return fill(snd.from ? S.fBeginIncr : S.fBeginFull, { from: snd.from?.name ?? "", F: snd.minTxg });
  if (t <= snd.steps.length) return stepLine(S, snd, t - 1);
  if (t === snd.steps.length + 1) {
    const tail = snd.records.filter((r) => r.step === snd.steps.length).map((r) => `<b>${recLabel(S, snd, r)}</b>`);
    return fill(S.fEnd, { list: fill(tail.length === 1 ? S.wrote1 : S.wroteN, { list: tail.join(", ") }), ck: shortCksum(snd.total) }) + see(S, "end");
  }
  const k = t - snd.steps.length - 1;
  if (k > rcv.dispatched.length) {
    const j = rcv.dispatched.length;
    return fill(S.fEcksum, { i: rcv.error!.i, j, rec: recLabel(S, snd, snd.records[j]) }) + see(S, "recvCheck");
  }
  return dispatchLine(S, snd, rcv, k - 1);
}

export function dispatchLine(S: SrStrings, snd: Send, rcv: Received, k: number): string {
  const d = rcv.dispatched[k];
  const r = snd.records[d.i];
  const rec = `<b>${recLabel(S, snd, r)}</b>`;
  const f = (o: number) => fileName(snd, o);
  const ck = d.computed ? fill(S.dCk, { ck: shortCksum(d.computed) }) : "";
  let eff = "";
  switch (d.type) {
    case "BEGIN":
      eff = snd.from ? fill(S.eBeginIncr, { from: snd.from.name }) : S.eBeginFull;
      break;
    case "OBJECT":
      eff = fill(d.effect === "created" ? S.eCreated : S.eExists, { f: f(r.object!) });
      break;
    case "WRITE":
      eff = fill(S.eWrite, { f: f(r.object!), i: d.effect, data: r.data! });
      break;
    case "FREE": {
      const n = d.effect ? d.effect.split(",").length : 0;
      eff = n ? fill(S.eFreed, { f: f(r.object!), list: d.effect.split(",").join(", "), n: plural(S, n, "blk1", "blkN") }) : fill(S.eFreeNone, { f: f(r.object!) });
      break;
    }
    case "FREEOBJECTS":
      eff = d.effect ? fill(S.eObjFreed, { f: d.effect.split(",").map((o) => f(Number(o))).join(", ") }) : S.eObjNone;
      break;
    case "END":
      eff = fill(S.eEnd, { ck: shortCksum(snd.total) });
      break;
  }
  return `${rec}${ck} → ${code(d.fn)}${see(S, d.type === "END" ? "recvEnd" : d.type === "BEGIN" ? "recvBegin" : "dispatch")}${(S.lang === "fr" ? "\u00a0: " : ": ")}${eff}`;
}

// ---------------------------------------------------------------- the strip and the receiver

/** The stream: every record written at frame t, each with its drr_checksum. */
export function strip(S: SrStrings, snd: Send, rcv: Received, t: number): string {
  const w = written(snd, t);
  const r = received(snd, rcv, t);
  const bad = failed(snd, rcv, t) ? rcv.error!.i : -1;
  if (!w) return `<p class="muted">${S.stripEmpty}</p>`;
  const cards = snd.records.slice(0, w).map((x, i) => {
    const ck = x.cksum ? `<span class="ck" title="drr_checksum">${shortCksum(x.cksum)}</span>` : `<span class="ck none">${S.noCk}</span>`;
    // The failing header, and the record before it that it was checking: neither is applied.
    const lost = bad >= 0 && i >= r && i < bad;
    const st = i === bad ? " bad" : lost ? " lost" : i < r ? " done" : "";
    const sr = i === bad || lost ? `<span class="visually-hidden"> ${S.srBad}</span>` : i < r ? `<span class="visually-hidden"> ${S.srDone}</span>` : "";
    return `<li class="rec ${x.type.toLowerCase()}${st}" data-rec="${i}"><span class="n">${i}</span><span class="ty">${x.type}</span><span class="args">${recArgs(S, snd, x)}${sr}</span>${ck}</li>`;
  });
  return `<ol class="strip" aria-label="${S.stripLabel}">${cards.join("")}</ol>`;
}

function recArgs(S: SrStrings, snd: Send, r: Rec): string {
  const f = (o: number) => fileName(snd, o);
  switch (r.type) {
    case "OBJECT": return fill(S.aObject, { o: r.object!, f: f(r.object!) });
    case "WRITE": return fill(S.aWrite, { f: f(r.object!), off: num(S, r.offset!), data: r.data! });
    case "FREE": return r.length === OBJECT_END ? fill(S.aFreeEnd, { f: f(r.object!), off: num(S, r.offset!) }) : fill(S.aFree, { f: f(r.object!), off: num(S, r.offset!), end: num(S, r.offset! + r.length!) });
    case "FREEOBJECTS": return r.numobjs === 1 ? fill(S.aFreeobjects1, { o: r.firstobj! }) : fill(S.aFreeobjectsN, { o: r.firstobj!, last: r.firstobj! + r.numobjs! - 1 });
    case "BEGIN": return snd.from ? fill(S.aBeginIncr, { from: snd.from.name, to: snd.to.name }) : fill(S.aBeginFull, { to: snd.to.name });
    case "END": return fill(S.aEnd, { ck: shortCksum(snd.total) });
  }
}

function files(S: SrStrings, c: Content, names: Record<number, string>, changed: Set<string>): string {
  const objs = Object.keys(c).map(Number).sort((a, b) => a - b);
  if (!objs.length) return `<p class="muted">${S.noFiles}</p>`;
  return `<ul class="files">${objs
    .map((o) => {
      const bl = c[o].blocks;
      const cells = Array.from({ length: Math.max(bl.length, 0) }, (_, i) =>
        `<span class="blk${bl[i] === null ? " hole" : ""}${changed.has(`${o}.${i}`) ? " new" : ""}">${bl[i] ?? S.hole}</span>`).join("");
      return `<li${changed.has(`${o}`) ? ' class="new"' : ""}><span class="fname">${names[o] ?? o}</span><span class="o">${fill(S.objN, { o })}</span><span class="blks">${cells || `<span class="muted">${S.emptyFile}</span>`}</span></li>`;
    })
    .join("")}</ul>`;
}

/** What the receiver is left with after a failed receive. */
const kept = (S: SrStrings, snd: Send) => (snd.from ? fill(S.vKeepsFrom, { from: snd.from.name }) : S.vKeepsNothing);

/** The receiving side at frame t: the files it holds, and the verdict once END is checked. */
export function receiver(S: SrStrings, snd: Send, rcv: Received, t: number): string {
  const k = received(snd, rcv, t);
  const names: Record<number, string> = {};
  for (const s of [snd.from, snd.to]) if (s) for (const b of dnodeBlocks(s.root)) for (const d of b.dnodes ?? []) if (d.name) names[d.object] = d.name;
  const holds = snd.from ? fill(S.holdsFrom, { from: snd.from.name, F: snd.from.txg }) : S.holdsNone;
  const cur = k ? rcv.dispatched[k - 1] : null;
  const changed = new Set<string>();
  if (cur && !failed(snd, rcv, t)) {
    const r = snd.records[cur.i];
    if (cur.type === "WRITE" || cur.type === "FREE") for (const i of cur.effect.split(",").filter(Boolean)) changed.add(`${r.object}.${i}`);
    if (cur.type === "OBJECT" && cur.effect === "created") changed.add(`${r.object}`);
  }
  const content = failed(snd, rcv, t) ? rcv.start : cur ? cur.after : rcv.start;
  let verdict = "";
  if (failed(snd, rcv, t)) verdict = `<p class="verdict bad">${fill(S.vEcksum, { i: rcv.error!.i, holds: kept(S, snd) })}${see(S, "recvCheck")}</p>`;
  else if (k === rcv.dispatched.length && !rcv.error) {
    const same = sameContent(rcv.content, contentOf(snd.to.root));
    verdict = `<p class="verdict ${same ? "ok" : "bad"}">${fill(same ? S.vSame : S.vDiffer, { to: snd.to.name, ck: shortCksum(snd.total) })}</p>`;
  }
  return `<p class="holds">${holds}</p>${files(S, content, names, changed)}${verdict}`;
}

/** The counters at frame t. */
export function counters(S: SrStrings, snd: Send, t: number): string {
  let v = 0, sk = 0, pr = 0;
  for (const s of snd.steps.slice(0, stepsDone(snd, t)))
    if (s.k === "test") {
      if (s.visit) v++;
      else {
        sk++;
        pr += s.pruned!.length;
      }
    }
  const w = written(snd, t);
  const bytes = snd.records.slice(0, w).reduce((a, r) => a + r.header.length + r.payload.length, 0);
  return [
    plural(S, v, "cVisited1", "cVisitedN"),
    plural(S, sk, "cSkipped1", "cSkippedN"),
    plural(S, pr, "cPruned1", "cPrunedN"),
    plural(S, w, "rec1", "recN"),
    plural(S, bytes, "byte1", "byteN"),
  ].map((x) => `<span>${x}</span>`).join("");
}

/** Every from-snapshot side by side: the count shrinks as F grows. */
export function table(S: SrStrings, sends: Send[], current: number): string {
  const total = allBps(sends[0].to.root).length;
  const rows = sends
    .map((x, i) => `<tr${i === current ? ' class="cur" aria-current="true"' : ""}><th scope="row">${x.from ? `@${x.from.name}` : S.full}</th><td>${x.minTxg}</td><td>${num(S, x.visited)} / ${total}</td><td>${num(S, x.skipped)} + ${num(S, x.pruned)}</td><td>${num(S, x.records.length)}</td><td>${num(S, x.bytes)}</td></tr>`)
    .join("");
  return `<table class="cmp-table"><caption>${fill(S.tableCaption, { to: sends[0].to.name })}</caption><thead><tr><th scope="col">${S.thFrom}</th><th scope="col">${S.thF}</th><th scope="col">${S.thVisited}</th><th scope="col">${S.thSkipped}</th><th scope="col">${S.thRecords}</th><th scope="col">${S.thBytes}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The history the tree comes from. */
export function history(S: SrStrings, snaps: Snapshot[]): string {
  return `<ol class="history">${snaps.map((s, i) => `<li><span class="txg">${fill(S.txgN, { txg: s.txg })}</span> ${S[`h${i + 1}`]} <code>@${s.name}</code></li>`).join("")}</ol>`;
}

/** The text version: the choice, every test, every record, the receiver's result. */
export function describe(S: SrStrings, snd: Send, rcv: Received): string {
  const tests = snd.steps.map((_, i) => `<li>${stepLine(S, snd, i).replace(/ ?<a class="see"[^>]*>[^<]*<\/a>/g, "")}</li>`).join("");
  const recs = snd.records.map((r) => `<li>${recLabel(S, snd, r)}${r.cksum ? `, drr_checksum ${shortCksum(r.cksum)}` : ""}</li>`).join("");
  const end = rcv.error
    ? fill(S.vEcksum, { i: rcv.error.i, holds: kept(S, snd) })
    : fill(sameContent(rcv.content, contentOf(snd.to.root)) ? S.vSame : S.vDiffer, { to: snd.to.name, ck: shortCksum(snd.total) });
  return `<p>${summary(S, snd)}</p><h4>${S.tTests}</h4><ol>${tests}</ol><h4>${S.tRecords}</h4><ol>${recs}</ol><p>${end.replace(/<[^>]+>/g, "")}</p>`;
}

/** One sentence: what is sent and what it costs. */
export function summary(S: SrStrings, snd: Send): string {
  return fill(snd.from ? S.summaryIncr : S.summaryFull, {
    from: snd.from?.name ?? "", to: snd.to.name, F: snd.minTxg,
    visited: plural(S, snd.visited, "bp1", "bpN"), total: allBps(snd.to.root).length,
    records: plural(S, snd.records.length, "rec1", "recN"), bytes: plural(S, snd.bytes, "byte1", "byteN"),
  });
}

