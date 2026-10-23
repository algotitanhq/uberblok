// The model of the tree and the uberblock room: a block pointer tree under
// an uberblock, a leaf write that copies the leaf and every ancestor, and the
// commit of vdev_config_sync in four beats on one disk with four labels and
// their uberblock rings; the plug pulled at any beat, then the import.
// Transcribed from OpenZFS zfs-2.4.4 (ANALYSIS.md, room "The tree and the
// uberblock", excerpts 1 to 11 and "Hand-checked cases"); what it simplifies:
// DECISIONS.md D12.2. No DOM: the page, the unit tests and the browser check
// run the same functions.

export const KiB = 1024;
/** sizeof (vdev_label_t): 8K pad + 8K boot env + 112K config + 128K ring (vdev_impl.h L535-L540). */
export const LABEL_SIZE = 256 * KiB;
/** VDEV_LABELS (vdev_impl.h L562). */
export const VDEV_LABELS = 4;
/** offsetof (vdev_label_t, vl_vdev_phys) and of vl_uberblock. */
export const PHYS_OFFSET = 16 * KiB;
export const RING_OFFSET = 128 * KiB;
/** VDEV_UBERBLOCK_RING (vdev_impl.h L482). */
export const RING_SIZE = 128 * KiB;
/** VDEV_BOOT_SIZE, 3.5 MiB after the two front labels (vdev_impl.h L555). */
export const BOOT_SIZE = 7 * 2 ** 19;
const UBERBLOCK_SHIFT = 10;
const MAX_UBERBLOCK_SHIFT = 13;

/** VDEV_UBERBLOCK_SHIFT: ashift clamped to [10, 13] (vdev_impl.h L491-L494). */
export const ubShift = (ashift: number) => Math.min(Math.max(ashift, UBERBLOCK_SHIFT), MAX_UBERBLOCK_SHIFT);
/** VDEV_UBERBLOCK_COUNT (vdev_impl.h L495-L496). */
export const ubCount = (ashift: number) => RING_SIZE >> ubShift(ashift);
/** VDEV_UBERBLOCK_OFFSET: where slot n starts inside a label. */
export const ubOffset = (n: number, ashift: number) => RING_OFFSET + n * 2 ** ubShift(ashift);

/** The slot of a txg's uberblock, vdev_uberblock_sync L1782-L1784 (no RAID-Z expansion state). */
export function slotOf(txg: number, ashift = 9, multihost = false): number {
  const m = multihost ? 1 : 0;
  return txg % (ubCount(ashift) - m);
}

/** vdev_label_offset, vdev_label.c L158-L170. */
export function labelOffset(psize: number, l: number, offset: number): number {
  if (!(offset < LABEL_SIZE)) throw new Error("offset outside a label");
  if (psize % LABEL_SIZE !== 0) throw new Error("psize not a multiple of the label size");
  return offset + l * LABEL_SIZE + (l < VDEV_LABELS / 2 ? 0 : psize - VDEV_LABELS * LABEL_SIZE);
}

export interface Uberblock {
  txg: number;
  timestamp: number;
  /** ub_rootbp: the id of the objset block it points to, null for a tree the figure no longer draws. */
  root: string | null;
}

/** vdev_uberblock_compare, vdev_label.c L1495-L1505: txg, then timestamp (MMP sequence left out). */
export function compareUb(a: Uberblock, b: Uberblock): number {
  if (a.txg !== b.txg) return a.txg < b.txg ? -1 : 1;
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  return 0;
}

/**
 * The parents of a data block, level by level (dbuf_dirty, dbuf.c L2537-L2554):
 * level l + 1 holds block blkid >> epbs, for the levels below dn_nlevels.
 */
export function ancestors(blkid: number, nlevels: number, epbs: number): { level: number; blkid: number }[] {
  const out: { level: number; blkid: number }[] = [];
  for (let level = 1; level < nlevels; level++) out.push({ level, blkid: Math.floor(blkid / 2 ** (epbs * level)) });
  return out;
}

// ------------------------------------------------------------------ the figure's tree

/** The figure's file: dn_nlevels 3, two pointers per indirect block (epbs 1), four data blocks. */
export const NLEVELS = 3;
export const EPBS = 1;
export const NDATA = 4;

export type Kind = "objset" | "dnodes" | "ind" | "data";

/** A place in the tree: the objset, the block of dnodes, an indirect or a data block. */
export interface Place {
  key: string;
  kind: Kind;
  level: number;
  blkid: number;
  kids: string[];
}

const key = (level: number, blkid: number) => (level === 0 ? `D${blkid}` : `L${level}-${blkid}`);

/** The shape of the tree, top down: objset, the block of dnodes holding the file's dnode, L2, L1, data. */
export const PLACES: Place[] = (() => {
  const out: Place[] = [
    { key: "OS", kind: "objset", level: -1, blkid: 0, kids: ["DN"] },
    { key: "DN", kind: "dnodes", level: -1, blkid: 0, kids: [key(NLEVELS - 1, 0)] },
  ];
  for (let level = NLEVELS - 1; level >= 0; level--) {
    const n = Math.ceil(NDATA / 2 ** (EPBS * level));
    for (let b = 0; b < n; b++) {
      const kids: string[] = [];
      if (level > 0) for (let c = b * 2 ** EPBS; c < Math.min((b + 1) * 2 ** EPBS, Math.ceil(NDATA / 2 ** (EPBS * (level - 1)))); c++) kids.push(key(level - 1, c));
      out.push({ key: key(level, b), kind: level === 0 ? "data" : "ind", level, blkid: b, kids });
    }
  }
  return out;
})();
export const place = (k: string) => PLACES.find((p) => p.key === k)!;

/**
 * How high a place stands above the data: 0 for a data block, its level for an
 * indirect block, then the block of dnodes, then the objset. spa_sync writes
 * the new tree bottom up, one height after the other: a block's write waits
 * until its children have their new addresses and checksums (zio_write_compress,
 * zio.c L1932-L1939).
 */
export function height(k: string): number {
  const p = place(k);
  return p.kind === "objset" ? NLEVELS + 1 : p.kind === "dnodes" ? NLEVELS : p.level;
}
/** The heights spa_sync writes: data, L1, L2, the block of dnodes, the objset. */
export const HEIGHTS = NLEVELS + 2;

/** The keys rewritten by a write of data block blkid: itself, its indirect blocks, the block of dnodes, the objset. */
export function pathOf(blkid: number): string[] {
  return [key(0, blkid), ...ancestors(blkid, NLEVELS, EPBS).map((a) => key(a.level, a.blkid)), "DN", "OS"];
}

export interface Blk {
  id: string;
  key: string;
  birth: number;
  /** Child block ids, as the block pointers in this block name them. */
  kids: string[];
}

/** A version of the tree: which block holds each place. */
export type Version = Record<string, string>;

export const blockId = (k: string, birth: number) => `${k}@${birth}`;

// ------------------------------------------------------------------ the disk

export interface Slot extends Uberblock {
  /** A write cut in the middle: the slot fails its checksum on read. */
  torn?: boolean;
}

export interface Label {
  /** ZPOOL_CONFIG_POOL_TXG of the config written in this label. */
  config: number;
  /** The config write was cut in the middle: the label fails its checksum. */
  configTorn: boolean;
  ring: (Slot | null)[];
}

/** The beats of vdev_config_sync, after spa_sync has written the txg's blocks (beat 0). */
export type Beat = 0 | 1 | 2 | 3 | 4;

export interface Txg {
  txg: number;
  version: Version;
  /** Data blocks written in this txg, in order. */
  leaves: number[];
  /** How many heights of the new tree spa_sync has written, bottom up (0 to HEIGHTS). */
  wrote: number;
  /** null: blocks not all written; 0: blocks written, not flushed; 1 to 4: beats done. */
  beat: Beat | null;
}

export interface Cut {
  /**
   * The beat in progress when the power went: 0 while spa_sync was writing the
   * blocks, 1 to 4 for the beats, "open" before spa_sync wrote anything, "idle"
   * with no txg syncing.
   */
  during: 0 | 1 | 2 | 3 | 4 | "open" | "idle";
  /** During beat 3: how many uberblock writes landed before the torn one. */
  landed: number;
  txg: number | null;
}

export interface Pool {
  ashift: number;
  psize: number;
  /** Last synced txg, and the tree its uberblock points to. */
  synced: number;
  version: Version;
  blocks: Record<string, Blk>;
  labels: Label[];
  /** The txg being built and synced, if any. */
  open: Txg | null;
  /** The vdev configuration changed in the open txg (spa_config_dirty_list not empty). */
  configDirty: boolean;
  /** Set by an import until the next commit: the config update it asks for dirties every vdev. */
  configForced: boolean;
  /** The power went: nothing more is written until the import. */
  cut: Cut | null;
}

export const START_TXG = 4210;
export const CONFIG_TXG = 4200;
export const PSIZE = 2 ** 30;
const T0 = 1_760_000_000;
/** ub_timestamp, in seconds: five seconds per txg, the default txg timeout. */
export const stamp = (txg: number) => T0 + (txg - START_TXG) * 5;

/** The figure's first state: txg 4210 synced, the ring full of the last 128 txgs, labels at txg 4200. */
export function createPool(): Pool {
  const ashift = 9;
  const count = ubCount(ashift);
  // Births of the first tree: a parent is never older than its newest child.
  const births: Record<string, number> = { D0: 4190, D1: 4120, D2: 4180, D3: 4210, "L1-0": 4190, "L1-1": 4210, "L2-0": 4210, DN: 4210, OS: 4210 };
  const version: Version = {};
  for (const p of PLACES) version[p.key] = blockId(p.key, births[p.key]);
  const blocks: Record<string, Blk> = {};
  for (const p of PLACES) blocks[version[p.key]] = { id: version[p.key], key: p.key, birth: births[p.key], kids: p.kids.map((k) => version[k]) };
  const labels: Label[] = [];
  for (let l = 0; l < VDEV_LABELS; l++) {
    const ring: (Slot | null)[] = new Array(count).fill(null);
    for (let t = START_TXG - count + 1; t <= START_TXG; t++) ring[slotOf(t, ashift)] = { txg: t, timestamp: stamp(t), root: t === START_TXG ? version.OS : null };
    labels.push({ config: CONFIG_TXG, configTorn: false, ring });
  }
  return { ashift, psize: PSIZE, synced: START_TXG, version, blocks, labels, open: null, configDirty: true, configForced: false, cut: null };
}

const clonePool = (p: Pool): Pool => ({
  ...p,
  version: { ...p.version },
  blocks: Object.fromEntries(Object.entries(p.blocks).map(([k, b]) => [k, { ...b, kids: [...b.kids] }])),
  labels: p.labels.map((l) => ({ ...l, ring: l.ring.map((s) => (s ? { ...s } : null)) })),
  open: p.open ? { ...p.open, version: { ...p.open.version }, leaves: [...p.open.leaves] } : null,
  cut: p.cut ? { ...p.cut } : null,
});

/** Why an action is refused, or null. */
export type Why = "cut" | "syncing" | "nothingToSync" | "notCut" | "noLeaf" | "cfgLocked" | "cfgForced";

/** spa_sync has started on the open txg and not finished: its blocks are being written or committed. */
export const syncing = (p: Pool) => !!p.open && p.open.wrote > 0 && p.open.beat !== 4;

export function canWrite(p: Pool): Why | null {
  if (p.cut) return "cut";
  if (syncing(p)) return "syncing";
  return null;
}
export function canStep(p: Pool): Why | null {
  if (p.cut) return "cut";
  if (!p.open || p.open.beat === 4) return "nothingToSync";
  return null;
}
export const canImport = (p: Pool): Why | null => (p.cut ? null : "notCut");
/** The config switch: set before spa_sync starts on the txg, and forced on after an import. */
export function canSetConfig(p: Pool): Why | null {
  if (p.cut) return "cut";
  if (syncing(p)) return "cfgLocked";
  if (p.configForced) return "cfgForced";
  return null;
}

/** Close a fully synced txg: its tree becomes the pool's. */
function settle(p: Pool): void {
  if (p.open?.beat === 4) {
    p.synced = p.open.txg;
    p.version = p.open.version;
    p.open = null;
  }
}

/**
 * A write of data block blkid in the open txg (dbuf_dirty): the block and every
 * ancestor not yet copied in this txg get a new copy born in it; the old copies
 * stay, still reachable from the last synced uberblock.
 */
export function writeLeaf(pool: Pool, blkid: number): { pool: Pool; rewritten: string[] } {
  if (canWrite(pool)) throw new Error(`write refused: ${canWrite(pool)}`);
  const p = clonePool(pool);
  settle(p);
  if (!p.open) p.open = { txg: p.synced + 1, version: { ...p.version }, leaves: [], wrote: 0, beat: null };
  const t = p.open;
  const rewritten: string[] = [];
  for (const k of pathOf(blkid)) {
    const id = blockId(k, t.txg);
    if (t.version[k] !== id) {
      t.version[k] = id;
      rewritten.push(k);
    }
  }
  // The new blocks point to the newest copy of each child: changed or shared.
  for (const k of Object.keys(t.version)) {
    const id = t.version[k];
    if (id.endsWith(`@${t.txg}`)) p.blocks[id] = { id, key: k, birth: t.txg, kids: place(k).kids.map((c) => t.version[c]) };
  }
  t.leaves.push(blkid);
  return { pool: p, rewritten };
}

/**
 * The next step of the sync: spa_sync writes the txg's new blocks one height
 * per step, data first and the objset last (beat 0 is done when the objset is
 * written), then vdev_config_sync's four beats (vdev_label.c L2085-L2161).
 */
export function step(pool: Pool): Pool {
  if (canStep(pool)) throw new Error(`step refused: ${canStep(pool)}`);
  const p = clonePool(pool);
  const t = p.open!;
  if (t.beat === null) {
    t.wrote += 1;
    if (t.wrote === HEIGHTS) t.beat = 0;
    return p;
  }
  const next = (t.beat + 1) as Beat;
  t.beat = next;
  if (next === 2 && p.configDirty) for (const l of [0, 2]) writeConfig(p, l, t.txg);
  if (next === 3) for (let l = 0; l < VDEV_LABELS; l++) writeUb(p, l, t);
  if (next === 4 && p.configDirty) for (const l of [1, 3]) writeConfig(p, l, t.txg);
  if (next === 4) p.configForced = false;
  return p;
}

function writeConfig(p: Pool, l: number, txg: number) {
  p.labels[l].config = txg;
  p.labels[l].configTorn = false;
}
function writeUb(p: Pool, l: number, t: Txg) {
  p.labels[l].ring[slotOf(t.txg, p.ashift)] = { txg: t.txg, timestamp: stamp(t.txg), root: t.version.OS };
}

/**
 * The power goes. Whatever beat is in progress is cut: its first writes landed,
 * the next one is torn, the rest never happened. Label writes land in order
 * L0 then L2 (L1 then L3); uberblock writes L0, L1, L2, L3; `landed` says how
 * many of these landed when the cut falls in beat 3 (0 to 3).
 */
export function pullPlug(pool: Pool, landed = 0): Pool {
  if (pool.cut) throw new Error("already cut");
  const p = clonePool(pool);
  const t = p.open;
  const n = Math.max(0, Math.min(3, Math.floor(landed)));
  if (!t || t.beat === 4) {
    settle(p);
    p.cut = { during: "idle", landed: 0, txg: null };
    return p;
  }
  if (t.beat === null) {
    p.cut = { during: t.wrote === 0 ? "open" : 0, landed: 0, txg: t.txg };
    return p;
  }
  const during = (t.beat + 1) as 1 | 2 | 3 | 4;
  p.cut = { during, landed: during === 3 ? n : 0, txg: t.txg };
  const pair = during === 2 ? [0, 2] : during === 4 ? [1, 3] : [];
  if (pair.length && p.configDirty) {
    writeConfig(p, pair[0], t.txg);
    p.labels[pair[1]].configTorn = true;
  }
  if (during === 3) {
    for (let l = 0; l < n; l++) writeUb(p, l, t);
    p.labels[n].ring[slotOf(t.txg, p.ashift)] = { txg: t.txg, timestamp: stamp(t.txg), root: t.version.OS, torn: true };
  }
  return p;
}

export interface SlotRead {
  label: number;
  slot: number;
  txg: number | null;
  /** "torn": the read fails its checksum (vdev_uberblock_load_done L1547). */
  state: "valid" | "torn" | "empty";
}

export interface ImportResult {
  winner: Uberblock;
  /** Labels whose slot holds the winning uberblock. */
  foundIn: number[];
  slot: number;
  /** Torn slots skipped. */
  tornSlots: SlotRead[];
  /** The config chosen by vdev_label_read_config(vd, ub_txg), and why each label was or was not. */
  configLabel: number;
  labelReads: { label: number; config: number | null; verdict: "chosen" | "torn" | "tooNew" | "older" | "equal" }[];
  /** "new": the tree of the txg that was syncing; "old": the one before it. */
  tree: "new" | "old";
  /** The txg that was syncing when the power went, if any. */
  cutTxg: number | null;
  /** Its uberblock copies that landed intact. */
  landedCopies: number;
  /** Where the cut fell. */
  during: Cut["during"] | null;
}

/**
 * The import: every slot of every label (vdev_uberblock_load_impl
 * L1570-L1588), keeping the best valid uberblock with vdev_uberblock_compare
 * (L1547-L1553); then the config of the label with the highest txg not above
 * the winner's (vdev_label_read_config L832-L863, called at L1647).
 */
export function readPool(p: Pool): ImportResult {
  let best: Uberblock | null = null;
  const tornSlots: SlotRead[] = [];
  p.labels.forEach((lab, l) =>
    lab.ring.forEach((s, n) => {
      if (!s) return;
      if (s.torn) return void tornSlots.push({ label: l, slot: n, txg: null, state: "torn" });
      if (!best || compareUb(s, best) > 0) best = s;
    }),
  );
  const winner = best as Uberblock | null;
  if (!winner) throw new Error("no valid uberblock");
  const slot = slotOf(winner.txg, p.ashift);
  const foundIn = p.labels.map((lab, l) => (lab.ring[slot] && !lab.ring[slot]!.torn && lab.ring[slot]!.txg === winner.txg ? l : -1)).filter((l) => l >= 0);
  let bestTxg = 0;
  let configLabel = -1;
  const reads: ImportResult["labelReads"] = p.labels.map((lab, l) => {
    if (lab.configTorn) return { label: l, config: null, verdict: "torn" as const };
    if (lab.config > winner.txg) return { label: l, config: lab.config, verdict: "tooNew" as const };
    if (lab.config > bestTxg) {
      bestTxg = lab.config;
      configLabel = l;
    }
    return { label: l, config: lab.config, verdict: "older" as const };
  });
  for (const r of reads) {
    if (r.label === configLabel) r.verdict = "chosen";
    else if (r.verdict === "older" && r.config === bestTxg) r.verdict = "equal";
  }
  const cutTxg = p.cut?.txg ?? null;
  const landedCopies = cutTxg === null ? 0 : p.labels.filter((lab) => {
    const s = lab.ring[slotOf(cutTxg, p.ashift)];
    return s && !s.torn && s.txg === cutTxg;
  }).length;
  return { winner, foundIn, slot, tornSlots, configLabel, labelReads: reads, tree: cutTxg !== null && winner.txg === cutTxg ? "new" : "old", cutTxg, landedCopies, during: p.cut?.during ?? null };
}

/** The uberblock an import would pick now: the root arrow of the figure. */
export const newestOnDisk = (p: Pool): Uberblock => readPool(p).winner;

/**
 * Import after the cut: the pool opens at the winner's tree; blocks of a txg
 * no uberblock reaches are forgotten (no committed space map holds them). The
 * next txg is the winner's + 1 (spa.c L4750-L4751), and its config is dirty.
 */
export function importPool(pool: Pool): { pool: Pool; result: ImportResult } {
  if (!pool.cut) throw new Error("import without a cut");
  const result = readPool(pool);
  const p = clonePool(pool);
  if (result.tree === "new" && p.open) {
    p.synced = p.open.txg;
    p.version = p.open.version;
  } else if (p.open) {
    for (const id of Object.keys(p.blocks)) if (p.blocks[id].birth === p.open.txg) delete p.blocks[id];
  }
  p.synced = result.winner.txg;
  p.open = null;
  p.cut = null;
  // spa_ld_check_for_config_update asks for a config update on import; it
  // dirties every top-level vdev for the next txg (spa.c L5721-L5736,
  // L9757-L9769; spa_config.c L489-L491): that txg rewrites all four labels.
  p.configDirty = true;
  p.configForced = true;
  return { pool: p, result };
}

/** Blocks of a version, top down. */
export const versionBlocks = (p: Pool, v: Version) => PLACES.map((pl) => p.blocks[v[pl.key]]);

/** The tree the newest uberblock on disk points to, as a version. */
export function rootVersion(p: Pool): Version {
  const ub = newestOnDisk(p);
  if (p.open && ub.root === p.open.version.OS) return p.open.version;
  return p.version;
}
