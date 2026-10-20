// A model of the vdev tree in OpenZFS zfs-2.4.4, for the vdevs room. Four
// parts, each transcribed from the code (ANALYSIS.md, room "The vdevs"):
//  - The tree: vdev_t nodes with a parent, children, a top-level ancestor and
//    an ops table (vdev_impl.h L239-L269, L101-L126); the hot spares and cache
//    devices beside it (spa_impl.h L284-L285); the allocation bias of each
//    top-level vdev and the classes it joins (vdev.c L1546-L1579).
//  - Where a block goes: spa_preferred_class (spa_misc.c L2121-L2179) with
//    zio_dva_allocate's fallback (zio.c L4368-L4407), zio_alloc_zil's order
//    (zio.c L4561-L4595), the number of copies of dmu_write_policy, and the
//    ditto placement of metaslab_alloc_dva_range (metaslab.c L5401-L5427).
//  - How an I/O walks down: zio_vdev_io_start (zio.c L4692-L4697, L4831),
//    vdev_mirror_io_start (vdev_mirror.c L656-L693) for mirror, replacing and
//    spare nodes, vdev_raidz_map_alloc (src/lib/raidz.ts) for raidz, and the
//    dRAID permutations (vdev_draid.c L509-L526, L931-L954, L1042-L1064)
//    with the distributed spare's redirection (vdev_draid.c L2609-L2710).
//  - Replacing a disk: spa_vdev_attach (spa.c L8324-L8360, L8436-L8454),
//    vdev_add_parent (vdev.c L1418-L1449), and the end of a resilver
//    (spa.c L9438-L9456).
// What it simplifies, and why it stays faithful: DECISIONS.md D11.2.
import { mapAlloc, psizeToAsize } from "./raidz";

export const ASHIFT = 12;
export const SECTOR = 2 ** ASHIFT;
export const KIB = 1024;
export const FIRST_TXG = 100;
/** include/sys/txg.h L41, L44: TXG_CONCURRENT_STATES 3, TXG_INITIAL = TXG_SIZE (4). */
export const TXG_CONCURRENT_STATES = 3;
export const TXG_INITIAL = 4;
/** spa_misc.c L448: the share of the special class kept for metadata. */
export const SPECIAL_RESERVE_PCT = 25;
/** VDEV_DRAID_SEED, vdev_draid.h L45. */
export const VDEV_DRAID_SEED = 0xd7a1d5eedn;

// ------------------------------------------------------------------ blocks

export const KINDS = ["zil", "meta", "ddt", "small", "large"] as const;
export type Kind = (typeof KINDS)[number];
/** The block sizes of the figure, after compression: inputs, not the code's (D11.2). */
export const PSIZE: Record<Kind, number> = { zil: 4 * KIB, meta: 16 * KIB, ddt: 8 * KIB, small: 4 * KIB, large: 128 * KIB };
/**
 * Copies of each kind (D11.2): a ZIL block is allocated with one DVA
 * (zio.c L4562-L4564); a file's data block with copies=1; metadata of a
 * dataset gets one more with redundant_metadata=all, the default (dmu.c
 * L2400-L2404); the DDT lives in the MOS, whose copies are
 * spa_max_replication, 3 (dmu_objset.c L651, spa_misc.c L2210-L2220).
 */
export const COPIES: Record<Kind, number> = { zil: 1, meta: 2, ddt: 3, small: 1, large: 1 };

// ------------------------------------------------------------------ the tree

export type VType = "root" | "mirror" | "raidz" | "draid" | "replacing" | "spare" | "disk" | "dspare";
export type Bias = "none" | "log" | "special" | "dedup";
export type ClassName = "normal" | "log" | "embedded_log" | "special" | "special_embedded_log" | "dedup";
export const CLASSES: ClassName[] = ["normal", "log", "embedded_log", "special", "special_embedded_log", "dedup"];

export interface Vdev {
  id: string; // a stable key for the figure
  name: string; // as zpool status prints it
  type: VType;
  vdevId: number; // vdev_id: position among its parent's children
  parent: string | null;
  kids: string[];
  bias?: Bias; // top-level vdevs only
  /** DTL_MISSING of a leaf attached by a replacement: txgs [TXG_INITIAL, missingTo). */
  missingTo?: number;
}

/** The slots of vdev_ops_t shown in the figure, per type, as in the tables of 2.4.4. */
export interface Ops {
  type: string; // vdev_op_type
  leaf: boolean; // vdev_op_leaf
  ioStart: string | null;
  ioDone: string | null;
  asize: string;
  needResilver: string | null;
  table: string; // the ops table's name
}
const MIRROR_FNS = { ioStart: "vdev_mirror_io_start", ioDone: "vdev_mirror_io_done", asize: "vdev_default_asize", needResilver: "vdev_default_need_resilver", leaf: false };
export const OPS: Record<VType, Ops> = {
  root: { type: "root", table: "vdev_root_ops", ioStart: null, ioDone: null, asize: "vdev_default_asize", needResilver: null, leaf: false },
  mirror: { type: "mirror", table: "vdev_mirror_ops", ...MIRROR_FNS },
  replacing: { type: "replacing", table: "vdev_replacing_ops", ...MIRROR_FNS },
  spare: { type: "spare", table: "vdev_spare_ops", ...MIRROR_FNS },
  raidz: { type: "raidz", table: "vdev_raidz_ops", ioStart: "vdev_raidz_io_start", ioDone: "vdev_raidz_io_done", asize: "vdev_raidz_psize_to_asize", needResilver: "vdev_raidz_need_resilver", leaf: false },
  draid: { type: "draid", table: "vdev_draid_ops", ioStart: "vdev_draid_io_start", ioDone: "vdev_draid_io_done", asize: "vdev_draid_psize_to_asize", needResilver: "vdev_draid_need_resilver", leaf: false },
  disk: { type: "disk", table: "vdev_disk_ops", ioStart: "vdev_disk_io_start", ioDone: "vdev_disk_io_done", asize: "vdev_default_asize", needResilver: null, leaf: true },
  dspare: { type: "dspare", table: "vdev_draid_spare_ops", ioStart: "vdev_draid_spare_io_start", ioDone: "vdev_draid_spare_io_done", asize: "vdev_default_asize", needResilver: null, leaf: true },
};

/** The dRAID of the figure: draid1:2d:5c:1s, one parity, two data, five children, one distributed spare. */
export const DRAID = { nparity: 1, ndata: 2, children: 5, nspares: 1 };
/** RAID-Z of the figure: raidz1 over three disks. */
export const RAIDZ = { nparity: 1, children: 3 };

export interface Options {
  log: boolean; // a mirror of two SSDs as SLOG
  special: boolean; // a mirror of two SSDs as special
  dedup: boolean; // one disk as dedup vdev
  smallblk: number; // special_small_blocks of the dataset, bytes
  specialFill: "low" | "over75" | "full";
}
export const DEFAULT_OPTIONS: Options = { log: true, special: true, dedup: false, smallblk: 0, specialFill: "low" };

export interface Dva {
  top: string; // the top-level vdev
  offset: number; // bytes on that vdev (raidz), or the group start (draid)
  group?: number; // dRAID group
}

export interface Block {
  n: number;
  kind: Kind;
  txg: number;
  psize: number;
  cls: ClassName;
  dvas: Dva[];
  decision: Step[];
}

/** One line of the decision, as a string key and its values: the view words it. */
export interface Step {
  key: string;
  v?: Record<string, string | number>;
}

export interface Pool {
  opts: Options;
  vdevs: Record<string, Vdev>;
  spares: string[]; // spa_spares
  l2cache: string[]; // spa_l2cache
  spareInUse: Record<string, boolean>;
  txg: number; // the txg of the next block
  rotor: Partial<Record<ClassName, number>>; // index into the class's vdevs
  nextOffset: Record<string, number>; // per top-level vdev, bytes
  nextGroup: number; // per dRAID
  nextDisk: number; // name of the next new disk
  blocks: Block[];
}

const disk = (n: number) => `sd${String.fromCharCode(97 + n)}`;

/** The figure's pool: zpool create with these vdevs, in this order. */
export function createPool(opts: Options = DEFAULT_OPTIONS): Pool {
  const vdevs: Record<string, Vdev> = {};
  const add = (v: Omit<Vdev, "kids" | "vdevId"> & { kids?: string[] }) => {
    const parent = v.parent ? vdevs[v.parent] : null;
    const node: Vdev = { kids: [], vdevId: parent ? parent.kids.length : 0, ...v };
    vdevs[node.id] = node;
    if (parent) parent.kids.push(node.id);
    return node;
  };
  add({ id: "root", name: "root", type: "root", parent: null });
  let top = 0;
  let d = 0;
  const leaves = (parent: string, n: number) => {
    for (let i = 0; i < n; i++, d++) add({ id: disk(d), name: disk(d), type: "disk", parent });
  };
  // Normal class: a mirror, a raidz1, a dRAID.
  add({ id: "mirror", name: `mirror-${top++}`, type: "mirror", parent: "root", bias: "none" });
  leaves("mirror", 2);
  add({ id: "raidz", name: `raidz1-${top++}`, type: "raidz", parent: "root", bias: "none" });
  leaves("raidz", RAIDZ.children);
  const draidId = top;
  add({ id: "draid", name: `draid1:2d:5c:1s-${top++}`, type: "draid", parent: "root", bias: "none" });
  leaves("draid", DRAID.children);
  // The disk names stay the same whatever is present, so they can be followed.
  d = 10;
  if (opts.log) {
    add({ id: "log", name: `mirror-${top++}`, type: "mirror", parent: "root", bias: "log" });
    leaves("log", 2);
  }
  d = 12;
  if (opts.special) {
    add({ id: "special", name: `mirror-${top++}`, type: "mirror", parent: "root", bias: "special" });
    leaves("special", 2);
  }
  d = 14;
  if (opts.dedup) add({ id: disk(14), name: disk(14), type: "disk", parent: "root", bias: "dedup" });
  // Spares: the hot spare given to zpool create, then the dRAID's distributed
  // spare, appended by vdev_draid_spare_create (vdev_draid.c L1706-L1724).
  const dspare = `draid1-${draidId}-0`;
  vdevs[disk(15)] = { id: disk(15), name: disk(15), type: "disk", vdevId: 0, parent: null, kids: [] };
  vdevs[dspare] = { id: dspare, name: dspare, type: "dspare", vdevId: 1, parent: null, kids: [] };
  vdevs[disk(16)] = { id: disk(16), name: disk(16), type: "disk", vdevId: 0, parent: null, kids: [] };
  return {
    opts: { ...opts },
    vdevs,
    spares: [disk(15), dspare],
    l2cache: [disk(16)],
    spareInUse: {},
    txg: FIRST_TXG,
    rotor: {},
    nextOffset: {},
    nextGroup: 0,
    nextDisk: 17,
    blocks: [],
  };
}

const clone = (p: Pool): Pool => JSON.parse(JSON.stringify(p));

export const topLevels = (p: Pool) => p.vdevs.root.kids.map((id) => p.vdevs[id]);

/** vdev_top: the ancestor that is a child of the root. */
export function topOf(p: Pool, id: string): Vdev {
  let v = p.vdevs[id];
  while (v.parent && v.parent !== "root") v = p.vdevs[v.parent];
  return v;
}

export const isLeaf = (v: Vdev) => OPS[v.type].leaf;

/**
 * The top-level vdevs of each class: vdev_metaslab_group_create (vdev.c
 * L1546-L1579) puts a vdev's group in the class of its bias, and gives every
 * non-log vdev a second group in the embedded log class, or in the special
 * embedded log class for a special vdev.
 */
export function classVdevs(p: Pool, cls: ClassName): string[] {
  const t = topLevels(p);
  const by = (b: Bias) => t.filter((v) => v.bias === b).map((v) => v.id);
  switch (cls) {
    case "normal": return by("none");
    case "log": return by("log");
    case "special": return by("special");
    case "dedup": return by("dedup");
    // A dedup vdev has a vdev_log_mg too, but no metaslab is ever moved into
    // it: only normal and special vdevs with more than zfs_embedded_slog_min_ms
    // (64) metaslabs get one (vdev.c L82-L88, L1689-L1696). The figure takes
    // its normal and special vdevs to be that large (D11.2).
    case "embedded_log": return by("none");
    case "special_embedded_log": return by("special");
  }
}

const has = (p: Pool, cls: ClassName) => classVdevs(p, cls).length > 0; // mc_groups != 0
/** The figure's special vdev can be full; no other class fills up (D11.2). */
const full = (p: Pool, cls: ClassName) => cls === "special" && p.opts.specialFill === "full";
/** metaslab_class_get_alloc(special) < limit, the 75% of spa_preferred_class L2169-L2176. */
const specialUnder75 = (p: Pool) => p.opts.specialFill === "low";

/**
 * spa_preferred_class, spa_misc.c L2121-L2179, for a block that is not a gang
 * child. `tried` is the class an allocation already failed in (zio.c L4407).
 */
export function preferredClass(p: Pool, kind: Exclude<Kind, "zil">, tried?: ClassName): { cls: ClassName; step: Step } {
  const triedDedup = tried === "dedup";
  const triedSpecial = tried === "special";
  if (kind === "ddt") {
    // L2149-L2156
    if (has(p, "dedup") && !triedDedup && !triedSpecial) return { cls: "dedup", step: { key: "pcDdtDedup" } };
    if (has(p, "special") && !triedSpecial) return { cls: "special", step: { key: "pcDdtSpecial" } }; // spa_special_has_ddt
    return { cls: "normal", step: { key: triedSpecial ? "pcDdtNormalTried" : "pcDdtNormal" } };
  }
  // L2158-L2159
  if (!has(p, "special")) return { cls: "normal", step: { key: "pcNoSpecial" } };
  if (triedSpecial) return { cls: "normal", step: { key: "pcTriedSpecial" } };
  // L2161-L2163: metadata, and indirect blocks of user data
  if (kind === "meta") return { cls: "special", step: { key: "pcMeta" } };
  // L2169-L2176
  const size = PSIZE[kind];
  if (size <= p.opts.smallblk) {
    if (specialUnder75(p)) return { cls: "special", step: { key: "pcSmall", v: { size, smallblk: p.opts.smallblk } } };
    return { cls: "normal", step: { key: "pcSmallOver75", v: { size, smallblk: p.opts.smallblk } } };
  }
  return { cls: "normal", step: { key: "pcData", v: { size, smallblk: p.opts.smallblk } } };
}

/** zio_alloc_zil's order, zio.c L4561-L4595: the first class that has room. */
export const ZIL_ORDER: ClassName[] = ["log", "special_embedded_log", "special", "embedded_log", "normal"];

/** The class of a block, and the steps that decided it. */
export function chooseClass(p: Pool, kind: Kind): { cls: ClassName; steps: Step[] } {
  const steps: Step[] = [];
  if (kind === "zil") {
    for (const c of ZIL_ORDER) {
      if (has(p, c) && !full(p, c)) {
        steps.push({ key: "zilTake", v: { cls: c } });
        return { cls: c, steps };
      }
      steps.push({ key: has(p, c) ? "zilFull" : "zilNone", v: { cls: c } });
    }
    throw new Error("no class for a ZIL block");
  }
  let { cls, step } = preferredClass(p, kind);
  steps.push(step);
  // zio_dva_allocate: on ENOSPC, ask spa_preferred_class again (zio.c L4404-L4407).
  while (full(p, cls)) {
    steps.push({ key: "enospc", v: { cls } });
    const again = preferredClass(p, kind, cls);
    steps.push(again.step);
    cls = again.cls;
  }
  return { cls, steps };
}

/**
 * The DVAs of a block in its class: the first at the class's rotor, every
 * other at the next vdev of the class after the previous one (mg_next,
 * metaslab.c L5420-L5423), round the class. The rotor then moves on (D11.2).
 */
function placeDvas(p: Pool, cls: ClassName, copies: number): string[] {
  const vs = classVdevs(p, cls);
  const r = (p.rotor[cls] ?? 0) % vs.length;
  const out = Array.from({ length: copies }, (_, d) => vs[(r + d) % vs.length]);
  p.rotor[cls] = (r + 1) % vs.length;
  return out;
}

/** Write a block of this kind: its class, its DVAs, and where each lands. */
export function writeBlock(p0: Pool, kind: Kind): { pool: Pool; block: Block; trace: Hop } {
  const p = clone(p0);
  const { cls, steps } = chooseClass(p, kind);
  const psize = PSIZE[kind];
  const dvas: Dva[] = placeDvas(p, cls, COPIES[kind]).map((top) => {
    const v = p.vdevs[top];
    if (v.type === "draid") {
      const group = p.nextGroup++;
      return { top, offset: group * draidGroupSize(), group };
    }
    const offset = p.nextOffset[top] ?? 0;
    p.nextOffset[top] = offset + asizeOn(v, psize);
    return { top, offset };
  });
  const block: Block = { n: p.blocks.length + 1, kind, txg: p.txg++, psize, cls, dvas, decision: steps };
  p.blocks.push(block);
  return { pool: p, block, trace: ioTrace(p, block, "write") };
}

/** The allocated size on a top-level vdev: vdev_op_psize_to_asize. */
function asizeOn(v: Vdev, psize: number): number {
  if (v.type === "raidz") return psizeToAsize(psize, ASHIFT, v.kids.length, RAIDZ.nparity);
  return Math.ceil(psize / SECTOR) * SECTOR;
}

// ------------------------------------------------------------------ dRAID

const M64 = (x: bigint) => BigInt.asUintN(64, x);
const rotl = (x: bigint, k: number) => M64((x << BigInt(k)) | (x >> BigInt(64 - k)));

/** vdev_draid_rand, xoroshiro128++ (vdev_draid_rand.c L30-L41). */
function draidRand(s: [bigint, bigint]): bigint {
  const s0 = s[0];
  let s1 = s[1];
  const result = M64(rotl(M64(s0 + s1), 17) + s0);
  s1 ^= s0;
  s[0] = M64(rotl(s0, 49) ^ s1 ^ M64(s1 << 21n));
  s[1] = rotl(s1, 28);
  return result;
}

/** The fixed maps of vdev_draid.c L171-L176 that the figure can use: children, permutations, seed, checksum. */
export const DRAID_MAPS: Record<number, { nperms: number; seed: bigint; checksum: bigint }> = {
  2: { nperms: 256, seed: 0x89ef3dabbcc7de37n, checksum: 0x00000000433d433dn },
  3: { nperms: 256, seed: 0x89a57f3de98121b4n, checksum: 0x00000000bcd8b7b5n },
  4: { nperms: 256, seed: 0xc9ea9ec82340c885n, checksum: 0x00000001819d7c69n },
  5: { nperms: 256, seed: 0xf46733b7f4d47dfdn, checksum: 0x00000002a1648d74n },
  6: { nperms: 256, seed: 0x88c3c62d8585b362n, checksum: 0x00000003d3b0c2c4n },
};

/** vdev_draid_generate_perms, vdev_draid.c L501-L526: a Fisher-Yates shuffle of each row from the previous one. */
export function draidPerms(children: number): Uint8Array {
  const map = DRAID_MAPS[children];
  if (!map) throw new RangeError(`no dRAID map for ${children} children in the figure`);
  const perms = new Uint8Array(children * map.nperms);
  let prev = Array.from({ length: children }, (_, i) => i);
  const seed: [bigint, bigint] = [VDEV_DRAID_SEED, map.seed];
  for (let i = 0; i < map.nperms; i++) {
    const cur = prev.slice();
    for (let j = children - 1; j > 0; j--) {
      const k = Number(draidRand(seed) % BigInt(j + 1));
      const val = cur[j];
      cur[j] = cur[k];
      cur[k] = val;
    }
    perms.set(cur, i * children);
    prev = cur;
  }
  return perms;
}

/** verify_perms's checksum, vdev_draid.c L452-L460: word 0 of fletcher-4 over the map. */
export function draidPermsChecksum(perms: Uint8Array): bigint {
  const view = new DataView(perms.buffer, perms.byteOffset, perms.byteLength);
  let a = 0n;
  for (let i = 0; i + 4 <= perms.byteLength; i += 4) a = M64(a + BigInt(view.getUint32(i, true)));
  return a;
}

let PERMS: Uint8Array | null = null;
const perms = () => (PERMS ??= draidPerms(DRAID.children));

/** ngroups as zpool computes it, cmd/zpool/zpool_vdev.c L1464-L1465. */
export function draidNgroups(ndata = DRAID.ndata, nparity = DRAID.nparity, children = DRAID.children, nspares = DRAID.nspares): number {
  let ngroups = 1;
  while ((ngroups * (ndata + nparity)) % (children - nspares) !== 0) ngroups++;
  return ngroups;
}
const ROWHEIGHT = 2 ** 24; // VDEV_DRAID_ROWHEIGHT, 1 << SPA_MAXBLOCKSHIFT
const groupwidth = () => DRAID.ndata + DRAID.nparity;
const ndisks = () => DRAID.children - DRAID.nspares;
export const draidGroupSize = () => groupwidth() * ROWHEIGHT; // vdc_groupsz, vdev_draid.c L2293

/** vdev_draid_get_perm and vdev_draid_permute_id, vdev_draid.c L560-L576. */
function permuteId(pindex: number, index: number): number {
  const ncols = DRAID.children;
  const nperms = DRAID_MAPS[ncols].nperms;
  const poff = pindex % (nperms * ncols);
  const base = Math.floor(poff / ncols) * ncols;
  const iter = poff % ncols;
  return (perms()[base + index] + iter) % ncols;
}

export interface DraidCol {
  dev: number; // rc_devidx: the child
  parity: boolean;
  name: string; // P, D0, D1
  sectors: number; // rc_size >> ashift, before the skip sector of a write
  row: number; // the row on the children (wraps to the next one)
}

/**
 * The columns of one block at the start of a group: vdev_draid_logical_to_physical
 * (vdev_draid.c L931-L954) and the loop of vdev_draid_map_alloc_row
 * (L1042-L1064), for a block that fits in its group.
 */
export function draidColumns(group: number, psize: number): { cols: DraidCol[]; perm: number; groupstart: number; spareDev: number[] } {
  const gw = groupwidth();
  const nd = ndisks();
  const ngroups = draidNgroups();
  const groupstart = (group * gw) % nd;
  const perm = Math.floor(group / ngroups);
  const row0 = perm * ((gw * ngroups) / nd) + Math.floor(((group % ngroups) * gw) / nd);
  const wrap = groupstart + gw > nd ? nd - groupstart : gw;
  const s = Math.ceil(psize / SECTOR);
  const q = Math.floor(s / DRAID.ndata);
  const r = s - q * DRAID.ndata;
  const bc = r === 0 ? 0 : r + DRAID.nparity;
  const cols: DraidCol[] = [];
  for (let i = 0; i < gw; i++) {
    const c = (groupstart + i) % nd;
    const sectors = q === 0 && i >= bc ? 0 : i < bc ? q + 1 : q;
    const parity = i < DRAID.nparity;
    cols.push({ dev: permuteId(perm, c), parity, name: parity ? "P" : `D${i - DRAID.nparity}`, sectors, row: row0 + (i >= wrap ? 1 : 0) });
  }
  // The children holding the distributed spares' space in this slice:
  // vdev_draid_spare_get_child, L2424-L2454, (children - 1) - spare_id.
  const spareDev = Array.from({ length: DRAID.nspares }, (_, sid) => permuteId(perm, DRAID.children - 1 - sid));
  return { cols, perm, groupstart, spareDev };
}

// ------------------------------------------------------------------ the I/O walk

/** One hop of an I/O: the vdev, the function its ops table calls, and the hops below. */
export interface Hop {
  vdev: string;
  fn: string | null;
  role?: string; // a DVA, a raidz or dRAID column, a skip sector, the spare's redirection
  sectors?: number;
  kids: Hop[];
  rule: "dvas" | "all" | "one" | "columns" | "redirect" | "leaf";
  skipped?: { vdev: string; why: "missing" }[]; // children a read passed over
}

/** DTL_MISSING contains this txg (vdev_mirror_child_missing, vdev_mirror.c L508-L516). */
const missing = (v: Vdev, txg: number) => v.missingTo !== undefined && txg >= TXG_INITIAL && txg < v.missingTo;

/** The I/O of a block, from the logical zio down to the leaves. */
export function ioTrace(p: Pool, b: Block, type: "write" | "read"): Hop {
  // zio_vdev_io_start with no vdev: the mirror ops over the block's DVAs (zio.c L4692-L4697).
  const dvaHops = b.dvas.map((d, i) => ({ d, i }));
  const chosen = type === "write" ? dvaHops : dvaHops.slice(0, 1);
  return {
    vdev: "zio",
    fn: "vdev_mirror_io_start",
    rule: "dvas",
    kids: chosen.map(({ d, i }) => ({ ...hop(p, d.top, b, d, type), role: `DVA ${i}` })),
  };
}

function hop(p: Pool, id: string, b: Block, d: Dva, type: "write" | "read", sectors?: number): Hop {
  const v = p.vdevs[id];
  const fn = OPS[v.type].ioStart;
  const sec = sectors ?? Math.ceil(b.psize / SECTOR);
  switch (v.type) {
    case "disk":
      return { vdev: id, fn, rule: "leaf", sectors: sec, kids: [] };
    case "mirror":
    case "replacing":
    case "spare": {
      // vdev_mirror_io_start: writes go to all children, a read to one (L656-L693).
      if (type === "write") return { vdev: id, fn, rule: "all", sectors: sec, kids: v.kids.map((k) => hop(p, k, b, d, type, sec)) };
      const skipped: Hop["skipped"] = [];
      let pick: string | undefined;
      for (const k of v.kids) {
        const kv = p.vdevs[k];
        if (missing(kv, b.txg)) {
          skipped.push({ vdev: k, why: "missing" });
          continue;
        }
        // vdev_mirror_child_select prefers a distributed spare (L561-L565),
        // otherwise the least loaded child: the figure takes the first (D11.2).
        if (kv.type === "dspare") {
          pick = k;
          break;
        }
        pick ??= k;
      }
      return { vdev: id, fn, rule: "one", sectors: sec, skipped, kids: pick ? [hop(p, pick, b, d, type, sec)] : [] };
    }
    case "raidz": {
      const L = mapAlloc(b.psize, ASHIFT, v.kids.length, RAIDZ.nparity, d.offset);
      // A write issues every column; a normal read only the data columns
      // (vdev_raidz_io_start_read_row, vdev_raidz.c L2573-L2588).
      const cols = L.cols.filter((c) => (type === "write" ? c.size > 0 || c.skip : !c.parity && c.size > 0));
      return {
        vdev: id, fn, rule: "columns", sectors: sec,
        kids: cols.map((c) => ({ ...hop(p, v.kids[c.dev], b, d, type, c.size + (type === "write" && c.skip ? 1 : 0)), role: c.size === 0 ? "skip" : c.name })),
      };
    }
    case "draid": {
      const { cols } = draidColumns(d.group ?? 0, b.psize);
      // Writes are full stripes: every column, an empty one as a skip sector
      // (vdev_draid_map_alloc_write, L640-L652, L653-L698); a normal read only the data
      // columns that hold data (vdev_draid_map_alloc_read, L758-L764).
      const parity = Math.max(...cols.map((c) => c.sectors));
      const used = cols.filter((c) => (type === "write" ? true : !c.parity && c.sectors > 0));
      return {
        vdev: id, fn, rule: "columns", sectors: sec,
        kids: used.map((c) => ({ ...hop(p, v.kids[c.dev], b, d, type, type === "write" ? parity : c.sectors), role: c.sectors === 0 ? "skip" : c.name })),
      };
    }
    case "dspare": {
      // vdev_draid_spare_io_start sends the I/O to the child of the dRAID that
      // holds this slice's spare space (vdev_draid.c L2609-L2710, L2424-L2454).
      const draid = p.vdevs.draid;
      const { spareDev } = draidColumns(d.group ?? 0, b.psize);
      const sid = Number(id.split("-")[2]);
      const target = draid.kids[spareDev[sid]];
      return { vdev: id, fn, rule: "redirect", sectors: sec, kids: [{ ...hop(p, target, b, d, type, sec), role: "spare" }] };
    }
    case "root":
      throw new Error("the root has no io_start");
  }
}

/** Every vdev an I/O reaches, in order: what the figure lights. */
export function reached(h: Hop): string[] {
  return [h.vdev, ...h.kids.flatMap(reached)];
}

/** The leaves an I/O writes to or reads from. */
export const leavesOf = (h: Hop): string[] => (h.kids.length ? h.kids.flatMap(leavesOf) : h.rule === "leaf" ? [h.vdev] : []);

/**
 * The same block in the tree after a replacement: a DVA names its top-level
 * vdev by vdev_id (DVA_GET_VDEV, vdev_lookup_top: excerpt 13), and a replacing node takes the old disk's
 * vdev_id (excerpt 8), so a DVA on a replaced top-level disk now leads to the
 * replacing node, then to the new disk.
 */
export function sameBlock(before: Pool, after: Pool, b: Block): Block {
  const byId = (id: number) => topLevels(after).find((v) => v.vdevId === id)!.id;
  return { ...b, dvas: b.dvas.map((d) => ({ ...d, top: byId(before.vdevs[d.top].vdevId) })) };
}

// ------------------------------------------------------------------ replacing a disk

export type Why = "notLeaf" | "busy" | "spareTaken" | "dspareElsewhere" | "notAttached" | "spareBias";

/** Can this disk be replaced, or spared, in the figure? */
export function canReplace(p: Pool, id: string, by: "new" | "spare" | "dspare"): Why | null {
  const v = p.vdevs[id];
  if (!v || v.type !== "disk") return "notLeaf";
  if (!v.parent) return "notAttached";
  const parent = p.vdevs[v.parent];
  // The figure does one replacement per disk at a time (D11.3).
  if (parent.type === "replacing" || parent.type === "spare") return "busy";
  // spa.c L8280-L8285 (excerpt 17): log, dedup and special vdevs are not replaced by spares.
  if (by !== "new" && topOf(p, id).bias !== "none") return "spareBias";
  if (by === "spare" && p.spareInUse[p.spares[0]]) return "spareTaken";
  if (by === "dspare") {
    // spa.c L8286-L8292: a dRAID spare can only replace a child of its own dRAID.
    if (topOf(p, id).id !== "draid") return "dspareElsewhere";
    if (p.spareInUse[p.spares[1]]) return "spareTaken";
  }
  return null;
}

/**
 * zpool replace: spa_vdev_attach with replacing set. The new parent is a spare
 * node if the new disk is a hot spare, else a replacing node (spa.c
 * L8324-L8360); vdev_add_parent puts it in the old disk's place, with the old
 * disk as child 0 (vdev.c L1418-L1449), and the new disk becomes the last
 * child (spa.c L8436-L8454), with DTL_MISSING from TXG_INITIAL to the txg
 * plus TXG_CONCURRENT_STATES (spa.c L8472, L8499-L8500).
 */
export function replace(p0: Pool, id: string, by: "new" | "spare" | "dspare"): { pool: Pool; node: string; added: string } {
  const why = canReplace(p0, id, by);
  if (why) throw new Error(`cannot replace ${id}: ${why}`);
  const p = clone(p0);
  const old = p.vdevs[id];
  const parent = p.vdevs[old.parent!];
  const type: VType = by === "new" ? "replacing" : "spare";
  const nodeId = `${type}:${id}`;
  // vdev_add_parent: the new node takes the old disk's vdev_id and place.
  const node: Vdev = { id: nodeId, name: `${type}-${old.vdevId}`, type, vdevId: old.vdevId, parent: parent.id, kids: [id] };
  // A top-level disk hands its role to the new node (vdev_top_transfer, vdev.c L1445-L1446).
  if (parent.id === "root") {
    node.bias = old.bias;
    delete old.bias;
  }
  parent.kids[parent.kids.indexOf(id)] = nodeId;
  p.vdevs[nodeId] = node;
  old.parent = nodeId;
  old.vdevId = 0;
  let added: string;
  if (by === "new") {
    added = disk(p.nextDisk++);
    p.vdevs[added] = { id: added, name: added, type: "disk", vdevId: 1, parent: nodeId, kids: [] };
  } else {
    added = by === "spare" ? p.spares[0] : p.spares[1];
    p.spareInUse[added] = true;
    Object.assign(p.vdevs[added], { parent: nodeId, vdevId: 1 });
  }
  node.kids.push(added);
  p.vdevs[added].missingTo = p.txg + TXG_CONCURRENT_STATES;
  return { pool: p, node: nodeId, added };
}

/**
 * The resilver is done: every new child's DTL is empty. A replacing node
 * loses its old disk, child 0, and goes away (spa_vdev_resilver_done_hunt,
 * spa.c L9438-L9456, then vdev_remove_parent); a spare node stays until its
 * spare is detached or its old disk replaced (L9461-L9479, D11.3).
 */
export function resilverDone(p0: Pool): { pool: Pool; collapsed: string[]; kept: string[] } {
  const p = clone(p0);
  const collapsed: string[] = [];
  const kept: string[] = [];
  const waiting = new Set(Object.values(p.vdevs).filter((v) => v.missingTo !== undefined).map((v) => v.parent));
  for (const v of Object.values(p.vdevs)) if (v.missingTo !== undefined) delete v.missingTo;
  for (const v of Object.values(p.vdevs).filter((x) => x.parent && (x.type === "replacing" || x.type === "spare"))) {
    if (v.type === "spare") {
      if (waiting.has(v.id)) kept.push(v.id);
      continue;
    }
    const [oldId, newId] = [v.kids[0], v.kids[v.kids.length - 1]];
    const parent = p.vdevs[v.parent!];
    const nv = p.vdevs[newId];
    parent.kids[parent.kids.indexOf(v.id)] = newId;
    Object.assign(nv, { parent: parent.id, vdevId: v.vdevId });
    if (v.bias) nv.bias = v.bias;
    delete p.vdevs[v.id];
    delete p.vdevs[oldId];
    collapsed.push(v.id);
  }
  return { pool: p, collapsed, kept };
}

/** Does any node of the tree still wait for a resilver? */
export const resilvering = (p: Pool) => Object.values(p.vdevs).some((v) => v.missingTo !== undefined);

/** The class of each top-level vdev, for colour: its bias. */
export const classOfTop = (v: Vdev): ClassName => (v.bias === "log" ? "log" : v.bias === "special" ? "special" : v.bias === "dedup" ? "dedup" : "normal");

/** Depth-first walk of the tree from the root. */
export function walk(p: Pool, id = "root", depth = 0, out: { v: Vdev; depth: number }[] = []) {
  const v = p.vdevs[id];
  out.push({ v, depth });
  for (const k of v.kids) walk(p, k, depth + 1, out);
  return out;
}
