// HTML for the Snapshots and clones room's figure, built from a State of
// src/lib/snapshots.ts. Plain strings, no DOM: the page renders the opening
// state at build time (readable without JavaScript) and the script renders
// every later state with the same functions.
import {
  SLOTS, head, ds, snapshots, referencedBy, owners, wouldKill, taskRefusal, slotBlock,
  type State, type Dataset, type Event, type Block, type Task,
} from "./snapshots";

export type SnStrings = Record<string, string> & { refs: Record<string, string> };

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const code = (s: string | number) => `<code>${s}</code>`;
const see = (S: SnStrings, r: string) => ` <a class="see" href="${S.refs[r]}">${S.see}</a>`;

/** A block's name: its slot letter (R for a root) and its birth txg. */
export const blockName = (b: Block) => `${b.slot < 0 ? "R" : SLOTS[b.slot]}<sub>${b.birth}</sub>`;
const blockText = (S: SnStrings, b: Block) =>
  fill(b.slot < 0 ? S.aRoot : S.aBlock, { slot: SLOTS[b.slot] ?? "", birth: b.birth }) + (b.dir === "clone" ? ` ${S.aOfClone}` : "");
export const dsName = (s: State, id: string) => (id === "$ORIGIN" ? "$ORIGIN" : (s.datasets.find((d) => d.id === id)?.name ?? id));
const list = (S: SnStrings, xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${S.and} ${xs[xs.length - 1]}`);

/** One chip: a button in the browser, a span at build time. */
function chip(s: State, S: SnStrings, id: number, at: string, live: boolean, extra = ""): string {
  const b = s.blocks[id];
  const cls = `chip${b.slot < 0 ? " root" : ""}${b.dir === "clone" ? " c" : ""}${extra}`;
  const txt = blockName(b);
  if (!live) return `<span class="${cls}" data-b="${id}" data-at="${at}">${txt}</span>`;
  return `<button type="button" class="${cls}" data-b="${id}" data-at="${at}" aria-label="${blockText(S, b)}" aria-pressed="false">${txt}</button>`;
}

function entries(s: State, S: SnStrings, d: Dataset, live: boolean): string {
  const es = d.deadlist
    .map(
      (e) =>
        `<li class="entry${e.blocks.length ? "" : " empty"}"><span class="key" title="${fill(S.keyTitle, { key: e.key })}">&gt;&#8239;${e.key}</span>${
          e.blocks.length ? e.blocks.map((id) => chip(s, S, id, `dl:${d.id}`, live)).join("") : `<span class="none">${S.none}</span>`
        }</li>`,
    )
    .join("");
  return `<div class="dl"><span class="lbl">${code("deadlist")}</span><ul>${es}</ul></div>`;
}

function pendingTask(s: State, t: Task) {
  return s.pending.tasks.findIndex((q) => q.kind === t.kind && JSON.stringify(q) === JSON.stringify(t));
}

function dsRow(s: State, S: SnStrings, d: Dataset, live: boolean): string {
  const kind = d.snapshot
    ? fill(S.kSnapshot, { txg: d.creationTxg })
    : d.dir === "clone"
      ? fill(S.kClone, { origin: dsName(s, d.prevSnap), txg: d.creationTxg })
      : S.kHead;
  const meta = `${code("ds_prev_snap_txg")} <strong>${d.prevSnapTxg}</strong> <span class="muted">(${dsName(s, d.prevSnap)})</span>`;
  const pend = !d.snapshot ? (s.pending.changes[d.dir] ?? {}) : {};
  const slots = s.roots[d.bp]
    .map((id, i) => {
      const p = pend[i];
      const tag = p ? `<span class="tag ${p}">${fill(p === "write" ? S.tagWrite : S.tagDelete, { txg: s.txg })}</span>` : "";
      if (id === null) {
        if (!d.snapshot && live && !p) return `<button type="button" class="slot-empty" data-write="${d.dir}:${i}">${fill(S.writeSlot, { slot: SLOTS[i] })}</button>`;
        return `<span class="slot-none${p ? " pending" : ""}">${fill(S.emptySlot, { slot: SLOTS[i] })}${tag}</span>`;
      }
      return `<span class="slot${p ? " pending" : ""}">${chip(s, S, id, `tree:${d.id}`, live)}${tag}</span>`;
    })
    .join("");
  let acts = "";
  if (live && d.snapshot) {
    const cl = { kind: "clone", origin: d.id } as Task;
    const de = { kind: "destroy", snap: d.id } as Task;
    const ci = pendingTask(s, cl);
    const di = pendingTask(s, de);
    const bits: string[] = [];
    if (ci >= 0) bits.push(`<span class="tag task">${fill(S.tagClone, { txg: s.txg })}</span><button type="button" class="btn sm" data-cancel-task="${ci}">${S.cancel}</button>`);
    else if (!taskRefusal(s, cl)) bits.push(`<button type="button" class="btn sm" data-task="clone:${d.id}">${S.clone}</button>`);
    if (di >= 0) bits.push(`<span class="tag task">${fill(S.tagDestroy, { txg: s.txg })}</span><button type="button" class="btn sm" data-cancel-task="${di}">${S.cancel}</button>`);
    else {
      const why = taskRefusal(s, de);
      if (why === "EEXIST") bits.push(`<span class="refuse">${S.eexist}${see(S, "eexist")}</span>`);
      else if (!why) bits.push(`<button type="button" class="btn sm" data-task="destroy:${d.id}">${S.destroy}</button>`);
    }
    acts = `<div class="acts">${bits.join("")}</div>`;
  }
  return `<section class="ds ${d.snapshot ? "snap" : d.dir === "clone" ? "clone" : "head"}" data-ds="${d.id}" aria-label="${d.name}">
<header><h3><code>${d.name}</code></h3><span class="kind">${kind}</span><span class="meta">${meta}</span>${acts}</header>
<div class="tree"><span class="lbl">${code("ds_bp")} →</span>${chip(s, S, d.bp, `tree:${d.id}`, live)}<span class="arrow" aria-hidden="true">→</span><span class="slots">${slots}</span></div>
${entries(s, S, d, live)}
</section>`;
}

/** The board: every dataset, then the blocks freed by the last sync. */
export function board(s: State, S: SnStrings, live: boolean, freedLast: number[] = []): string {
  const rows = s.datasets.map((d) => dsRow(s, S, d, live)).join("");
  const freed = freedLast.length
    ? `<p class="freed"><span class="lbl">${fill(S.freedIn, { txg: s.txg - 1 })}</span>${freedLast.map((id) => `<span class="chip gone${s.blocks[id].slot < 0 ? " root" : ""}${s.blocks[id].dir === "clone" ? " c" : ""}" data-b="${id}" data-at="freed">${blockName(s.blocks[id])}</span>`).join("")}</p>`
    : "";
  return `<div class="board">${rows}</div>${freed}`;
}

/** What is waiting in the open txg. */
export function waiting(s: State, S: SnStrings): string {
  const items: string[] = [];
  for (const dir of ["fs", "clone"] as const)
    for (const [slot, c] of Object.entries(s.pending.changes[dir] ?? {}))
      items.push(fill(c === "write" ? S.wWrite : S.wDelete, { slot: SLOTS[Number(slot)], ds: dir }));
  for (const t of s.pending.tasks)
    items.push(t.kind === "snapshot" ? S.wSnapshot : t.kind === "clone" ? fill(S.wClone, { snap: dsName(s, t.origin) }) : fill(S.wDestroy, { snap: dsName(s, t.snap) }));
  return items.length ? fill(S.waiting, { txg: s.txg, list: list(S, items) }) : fill(S.nothing, { txg: s.txg });
}

/** One line of the sync's log, mapped to the code. */
export function eventLine(s: State, S: SnStrings, e: Event): string {
  const bn = (id: number) => `<b>${blockName(s.blocks[id])}</b>`;
  switch (e.k) {
    case "born":
      return fill(s.blocks[e.block].slot < 0 ? S.eRoot : S.eBorn, { ds: code(dsName(s, e.ds)), b: bn(e.block), txg: s.blocks[e.block].birth }) + see(S, "birth");
    case "kill":
      return fill(e.freed ? S.eFree : S.eDead, {
        ds: code(dsName(s, e.ds)), b: bn(e.block), birth: e.birth, prev: e.prevSnapTxg, key: e.key ?? "",
      }) + see(S, e.freed ? "free" : "insert");
    case "snapshot":
      return fill(S.eSnap, { snap: code(dsName(s, e.snap)), root: bn(e.bp), old: e.oldPrev, keys: e.keys.join(", "), txg: ds(s, e.snap).creationTxg }) + see(S, "snapshot");
    case "clone":
      return fill(S.eClone, { origin: code(dsName(s, e.origin)), root: bn(e.bp), txg: ds(s, e.origin).creationTxg, keys: e.keys.join(", ") }) + see(S, "clone");
    case "destroy":
      return fill(S.eDestroy, {
        snap: code(e.name),
        prev: e.prevSnapTxg,
        next: code(dsName(s, e.next)),
        freed: e.freed.length ? list(S, e.freed.map(bn)) : S.nothingFreed,
        merged: e.merged.length ? fill(S.eMerged, { list: list(S, e.merged.map(bn)) }) : "",
        key: e.removedKey,
        from: e.removedFrom.length ? fill(S.eRemoved, { key: e.removedKey, list: list(S, e.removedFrom.map((x) => code(dsName(s, x)))) }) : "",
      }) + see(S, "destroy");
    case "refused":
      return fill(e.err === "EAGAIN" ? S.eEagain : e.err === "EEXIST" ? S.eexist : S.eEnoent, {}) + see(S, e.err === "EAGAIN" ? "eagain" : "eexist");
    case "synced":
      return fill(S.eSynced, { txg: e.txg });
  }
}

/** The panel for the selected block: birth, references, owner range, what a kill would do. */
export function ownerPanel(s: State, S: SnStrings, id: number | null, live: boolean): string {
  if (id === null || !s.blocks[id]) return `<p class="muted">${S.pick}</p>`;
  const b = s.blocks[id];
  const title = `<h4>${fill(b.slot < 0 ? S.oRoot : S.oBlock, { name: blockName(b), birth: b.birth })}${b.dir === "clone" ? ` <span class="muted">${S.aOfClone}</span>` : ""}</h4>`;
  if (b.freed !== undefined) return `${title}<p>${fill(S.oFreed, { txg: b.freed })}</p>`;
  const refs = referencedBy(s, id);
  const o = owners(s, id);
  const names = (xs: string[]) => list(S, xs.map((x) => code(dsName(s, x))));
  const out: string[] = [title];
  out.push(`<p>${fill(S.oRefs, { list: names(refs) })}</p>`);
  const where = s.datasets.flatMap((d) => d.deadlist.filter((e) => e.blocks.includes(id)).map((e) => fill(S.oOnDl, { ds: code(d.name), key: e.key, killer: code(d.dir), txg: b.killed[d.dir] ?? "?" })));
  if (where.length) out.push(`<p>${where.join(" ")}</p>`);
  if (b.dir === "fs") {
    const k = b.killed.fs;
    const range = k === undefined ? fill(S.oRangeOpen, { birth: b.birth }) : fill(k - 1 === b.birth ? S.oRangeOne : S.oRangeKilled, { birth: b.birth, last: k - 1, k });
    out.push(`<p>${o.snaps.length ? fill(S.oSnaps, { list: names(o.snaps), range }) : fill(S.oNoSnap, { range })}${see(S, "insert")}</p>`);
  } else out.push(`<p>${S.oCloneOwn}</p>`);
  for (const dir of ["fs", "clone"] as const) {
    const h = head(s, dir);
    if (!h || !refs.includes(h.id) || b.slot < 0) continue;
    const w = wouldKill(s, h, id);
    const cmp = fill(w.freed ? S.oWouldFree : S.oWouldDead, { ds: code(h.name), birth: b.birth, prev: h.prevSnapTxg, key: w.key ?? "" });
    const p = s.pending.changes[dir]?.[b.slot];
    let acts = "";
    if (live)
      acts = p
        ? ` <span class="tag ${p}">${fill(p === "write" ? S.tagWrite : S.tagDelete, { txg: s.txg })}</span> <button type="button" class="btn sm" data-cancel="${dir}:${b.slot}">${S.cancel}</button>`
        : ` <span class="acts"><button type="button" class="btn sm" data-change="${dir}:${b.slot}:write">${fill(S.overwrite, { ds: h.name })}</button><button type="button" class="btn sm" data-change="${dir}:${b.slot}:delete">${fill(S.delete, { ds: h.name })}</button></span>`;
    out.push(`<p class="would">${cmp}${see(S, "kill")}${acts}</p>`);
  }
  return out.join("");
}

/** The text version of the whole state. */
export function describe(s: State, S: SnStrings): string {
  const items = s.datasets.map((d) => {
    const blocks = s.roots[d.bp].map((id, i) => (id === null ? fill(S.emptySlot, { slot: SLOTS[i] }) : blockText(S, s.blocks[id])));
    const dl = d.deadlist
      .map((e) => fill(S.tEntry, { key: e.key, list: e.blocks.length ? list(S, e.blocks.map((id) => blockText(S, s.blocks[id]))) : S.none }))
      .join(S.semi);
    const kind = d.snapshot ? fill(S.kSnapshot, { txg: d.creationTxg }) : d.dir === "clone" ? fill(S.kClone, { origin: dsName(s, d.prevSnap), txg: d.creationTxg }) : S.kHead;
    return `<li>${fill(S.tDataset, {
      name: code(d.name), kind, prev: d.prevSnapTxg, root: blockText(S, s.blocks[d.bp]), blocks: blocks.join(", "), dl,
    })}</li>`;
  });
  const freed = s.blocks.filter((b) => b.freed !== undefined);
  const tail = freed.length ? `<p>${fill(S.tFreed, { list: list(S, freed.map((b) => fill(S.tFreedOne, { b: blockText(S, b), txg: b.freed! }))) })}</p>` : "";
  return `<p>${fill(S.tIntro, { txg: s.txg })}</p><ol>${items.join("")}</ol>${tail}`;
}

/** A one-sentence summary, for the figure's label. */
export function summary(s: State, S: SnStrings): string {
  const snaps = snapshots(s).map((d) => d.name);
  const c = head(s, "clone");
  return fill(S.summary, {
    txg: s.txg,
    snaps: snaps.length ? list(S, snaps) : S.noSnapshots,
    clone: c ? fill(S.summaryClone, { origin: dsName(s, c.prevSnap) }) : "",
    live: ((n) => fill(n === 0 ? S.live0 : n === 1 ? S.live1 : S.liveN, { n }))(s.blocks.filter((b) => b.freed === undefined).length),
  });
}

/** Is a slot of this head empty and free to write? (used by the script) */
export const canWrite = (s: State, dir: "fs" | "clone", slot: number) => {
  const h = head(s, dir);
  return !!h && slotBlock(s, h, slot) === null && !s.pending.changes[dir]?.[slot];
};
