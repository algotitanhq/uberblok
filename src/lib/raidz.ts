// A model of RAID-Z in OpenZFS zfs-2.4.4, module/zfs/vdev_raidz.c, for a raidz
// vdev that is not being expanded (one row per map). Two halves:
//  - mapAlloc() is vdev_raidz_map_alloc (L612-L740) and the skip-sector
//    placement of vdev_raidz_map_alloc_write (L497-L581), integer for integer;
//    psizeToAsize() is vdev_raidz_psize_to_asize (L2306-L2329).
//  - readBlock() follows the read path's decisions: which columns a read
//    issues (vdev_raidz_io_start_read_row, L2509-L2589), the reconstruction of
//    known-missing columns (L3668-L3741), the checksum, read-all, and the
//    combinatorial search of vdev_raidz_combrec (L3502-L3602) with the parity
//    choice of vdev_raidz_reconstruct_row (L2076-L2160) and
//    vdev_raidz_math.c L184-L236. It tracks which columns are right or wrong,
//    not their bytes: a reconstruction is right exactly when every column it
//    reads is right (Reed-Solomon over GF(2^8) is exact).
// ANALYSIS.md, room "RAID-Z", has the excerpts; DECISIONS.md D4.1 what is
// simplified. No imports: scripts/test/raidz-model.test.mjs loads this file
// with Node's type stripping.

export const VDEV_RAIDZ_MAXPARITY = 3; // include/sys/fs/zfs.h L929
export const SPA_MINBLOCKSHIFT = 9; // psize is a multiple of 512 bytes
export const PARITY_NAMES = ["P", "Q", "R"]; // VDEV_RAIDZ_P/Q/R, vdev_raidz.c L121-L123

const roundup = (x: number, y: number) => Math.ceil(x / y) * y;

export interface Col {
  c: number; // column index in rr_col[]
  dev: number; // rc_devidx: the child it lives on
  off: number; // rc_offset >> ashift: sector on that child
  size: number; // rc_size >> ashift: sectors written (0 for a skipped column)
  parity: boolean; // c < rr_firstdatacol
  name: string; // P, Q, R, or D0, D1, ... for data columns
  data: number; // first sector of the block in this column (data columns)
  skip: boolean; // one skip sector follows (or, if size is 0, is) this column
}

export interface Layout {
  psize: number;
  ashift: number;
  dcols: number;
  nparity: number;
  offset: number; // io_offset, bytes on the raidz vdev
  b: number;
  s: number;
  f: number;
  o: number; // in sectors
  q: number;
  r: number;
  bc: number;
  tot: number;
  acols: number;
  scols: number;
  nskip: number;
  skipstart: number;
  nwrapped: number;
  swapped: boolean; // the raidz1 1 MiB parity swap (L725-L734)
  asize: number; // vdev_raidz_psize_to_asize, bytes
  cols: Col[];
}

export function check(psize: number, ashift: number, dcols: number, nparity: number, offset = 0) {
  if (!(nparity >= 1 && nparity <= VDEV_RAIDZ_MAXPARITY)) throw new RangeError("nparity is 1, 2 or 3");
  // vdev_raidz_open: EINVAL if vdev_children < nparity + 1 (L2178-L2179)
  if (!(Number.isInteger(dcols) && dcols >= nparity + 1)) throw new RangeError("a raidz needs nparity + 1 children");
  if (!(ashift >= SPA_MINBLOCKSHIFT && ashift <= 16)) throw new RangeError("ashift is 9 to 16");
  if (!(psize > 0 && psize % 512 === 0)) throw new RangeError("psize is a multiple of 512");
  if (!(offset >= 0 && offset % 2 ** ashift === 0)) throw new RangeError("offset is sector-aligned");
}

/** vdev_raidz_psize_to_asize, vdev_raidz.c L2306-L2317 (cols: logical width = children). */
export function psizeToAsize(psize: number, ashift: number, cols: number, nparity: number): number {
  let asize = Math.floor((psize - 1) / 2 ** ashift) + 1; // L2315
  asize += nparity * Math.floor((asize + cols - nparity - 1) / (cols - nparity)); // L2316
  return roundup(asize, nparity + 1) * 2 ** ashift; // L2317
}

/** vdev_raidz_map_alloc for a write of psize bytes at io_offset `offset`. */
export function mapAlloc(psize: number, ashift: number, dcols: number, nparity: number, offset = 0): Layout {
  check(psize, ashift, dcols, nparity, offset);
  const sector = 2 ** ashift;
  // zio_vdev_io_start pads the I/O to a whole sector (zio.c L4718-L4729)
  const ioSize = roundup(psize, sector);
  const b = offset / sector; // L617
  const s = ioSize / sector; // L619
  const f = b % dcols; // L621
  const o = Math.floor(b / dcols); // L623, in sectors
  const q = Math.floor(s / (dcols - nparity)); // L634
  const r = s - q * (dcols - nparity); // L640
  const bc = r === 0 ? 0 : r + nparity; // L643
  const tot = s + nparity * (q + (r === 0 ? 0 : 1)); // L649
  let acols: number, scols: number;
  if (q === 0) {
    acols = bc; // L655-L658
    scols = Math.min(dcols, roundup(bc, nparity + 1));
  } else {
    acols = dcols; // L659-L662
    scols = dcols;
  }
  const cols: Col[] = [];
  let asum = 0;
  for (let c = 0; c < scols; c++) {
    // L677-L696
    let col = f + c;
    let coff = o;
    if (col >= dcols) {
      col -= dcols;
      coff += 1;
    }
    const size = c >= acols ? 0 : c < bc ? q + 1 : q;
    asum += size;
    cols.push({ c, dev: col, off: coff, size, parity: c < nparity, name: "", data: 0, skip: false });
  }
  if (asum !== tot) throw new Error("asize != tot"); // L698
  const nskip = roundup(tot, nparity + 1) - tot; // L699
  let skipstart = bc; // L700

  // L725-L734: single parity swaps columns 0 and 1 in every other megabyte.
  let swapped = false;
  if (nparity === 1 && Math.floor(offset / 2 ** 20) % 2 === 1) {
    const [d, off] = [cols[0].dev, cols[0].off];
    cols[0].dev = cols[1].dev;
    cols[0].off = cols[1].off;
    cols[1].dev = d;
    cols[1].off = off;
    if (skipstart === 0) skipstart = 1;
    swapped = true;
  }

  // vdev_raidz_map_alloc_write: where the skip sectors go (L509-L516, L522,
  // L526-L543 for parity columns, L548-L576 for data columns).
  let nwrapped = 0;
  if (skipstart < nparity) nwrapped = nskip;
  else if (scols < skipstart + nskip) nwrapped = (skipstart + nskip) % scols;
  let skipped = scols - acols;
  for (let c = acols; c < scols; c++) cols[c].skip = true;
  for (let c = 0; c < nparity; c++)
    if (c < nwrapped) {
      cols[c].skip = true;
      skipped++;
    }
  let data = 0;
  for (let c = nparity; c < acols; c++) {
    if (c >= skipstart && skipped < nskip) {
      cols[c].skip = true;
      skipped++;
    }
    cols[c].data = data;
    data += cols[c].size; // each data column is the next rc_size bytes (L550-L551)
  }
  if (skipped !== nskip) throw new Error("skip sectors");
  if (data !== s) throw new Error("data sectors");
  for (const col of cols) col.name = col.parity ? PARITY_NAMES[col.c] : col.c < acols ? `D${col.c - nparity}` : "";

  return {
    psize, ashift, dcols, nparity, offset, b, s, f, o, q, r, bc, tot, acols, scols, nskip, skipstart, nwrapped, swapped,
    asize: psizeToAsize(psize, ashift, dcols, nparity), cols,
  };
}

/** Sectors on each child the block occupies, skip sectors included: [dev] -> list of sectors. */
export function footprint(L: Layout): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const col of L.cols) {
    const n = col.size + (col.skip ? 1 : 0);
    const list = m.get(col.dev) ?? [];
    for (let i = 0; i < n; i++) list.push(col.off + i);
    m.set(col.dev, list);
  }
  return m;
}

// ---- Reading the block back, with damaged children -----------------------

/** What a child does when read: answers, is gone (ENXIO), or returns wrong bytes silently. */
export type Health = "ok" | "missing" | "corrupt";

export type AttemptOutcome = "ok" | "cksum" | "einval";
export interface Attempt {
  tgts: number[]; // ltgts: logical child ids, = device indexes without expansion
  cols: number[]; // the columns they hit
  dead: number;
  deadData: number;
  parity: string[]; // parity columns used to rebuild, by name
  rebuilt: number[]; // data columns rebuilt (simulated and known errors)
  outcome: AttemptOutcome;
}

export interface ReadResult {
  firstRead: number[]; // columns read at first (L2573-L2588)
  missing: number[]; // columns whose child is gone (L2522-L2531)
  known: { parity: string[]; ok: boolean } | null; // reconstruction of known-missing data (L3712-L3741)
  firstCksum: boolean; // checksum after the first read
  readAll: number[]; // columns read by vdev_raidz_read_all (L3747-L3774), [] if none
  tooMany: boolean; // more known errors than parity: combrec gives up (L3510-L3520)
  attempts: Attempt[]; // combrec's combinations, in its order (L3523-L3598)
  ok: boolean; // the block was read with a valid checksum
  parityVerified: boolean; // io_done_verified checked the parity it read (L3139-L3141)
  repaired: number[]; // columns written back with good data (L3166-L3210)
  undetected: number[]; // corrupt columns this read did not see (parity not read, or not checked)
}

/** The columns of the block, with what each child returns. */
function columns(L: Layout, health: Health[]) {
  return L.cols.slice(0, L.acols).map((col) => ({
    ...col,
    missing: health[col.dev] === "missing",
    corrupt: health[col.dev] === "corrupt",
  }));
}

/**
 * vdev_raidz_reconstruct_row for target columns `tgts` (simulated plus known
 * errors): the data targets are rebuilt from the first valid parity columns
 * in P, Q, R order. Returns the parity used and whether the result is right.
 */
function rebuild(cols: ReturnType<typeof columns>, tgts: Set<number>) {
  const valid = cols.filter((x) => x.parity && !tgts.has(x.c) && !x.missing);
  const badData = cols.filter((x) => !x.parity && tgts.has(x.c));
  const used = valid.slice(0, badData.length);
  const inputs = [...used, ...cols.filter((x) => !x.parity && !tgts.has(x.c))];
  const right = used.length === badData.length && inputs.every((x) => !x.corrupt);
  return { parity: used.map((x) => x.name), right };
}

/** Is the block right after a reconstruction of `tgts` (or none)? */
function dataRight(cols: ReturnType<typeof columns>, tgts: Set<number>, rebuiltRight: boolean) {
  return cols.every((x) => x.parity || (tgts.has(x.c) ? rebuiltRight : !x.corrupt && !x.missing));
}

/**
 * Read the block of layout L when each child behaves as `health[dev]` says.
 * A normal read (not a scrub, no DTL, no slow-child outliers).
 */
export function readBlock(L: Layout, health: Health[]): ReadResult {
  const np = L.nparity;
  const cols = columns(L, health);
  const missing = cols.filter((x) => x.missing).map((x) => x.c);
  const missingData = cols.filter((x) => x.missing && !x.parity).length;
  // L2575-L2588: data columns always; parity only if some data is missing.
  const firstRead = cols.filter((x) => !x.missing && (!x.parity || missingData > 0)).map((x) => x.c);
  const res: ReadResult = {
    firstRead, missing, known: null, firstCksum: false, readAll: [], tooMany: false, attempts: [], ok: false,
    parityVerified: false, repaired: [], undetected: [],
  };
  const knownSet = new Set(missing);
  const total = missing.length;

  // vdev_raidz_io_done_reconstruct_known_missing: with parity read, rebuild
  // the missing data columns if there are no more errors than parity (L3712-L3713).
  let knownRight = false;
  if (missingData > 0 && total <= np) {
    const r = rebuild(cols, knownSet);
    res.known = { parity: r.parity, ok: r.right };
    knownRight = r.right;
  }
  // raidz_checksum_verify (L3865): the parent's checksum over the data columns.
  res.firstCksum = total <= np && dataRight(cols, knownSet, knownRight);
  if (res.firstCksum) {
    res.ok = true;
    verified(cols, np, knownSet, new Set(firstRead), res);
  } else {
    // L3886-L3910: read every column not tried yet, then io_done runs again:
    // same known-missing reconstruction, same checksum, then combrec.
    res.readAll = cols.filter((x) => !x.missing && !firstRead.includes(x.c)).map((x) => x.c);
    if (total > np) {
      res.tooMany = true; // L3510-L3520
    } else {
      const win = combrec(L, cols, knownSet, res);
      if (win) {
        res.ok = true;
        // L3403-L3428: every simulated data column gets ECKSUM (a simulated
        // parity column does not: io_done_verified checks it).
        const errors = new Set([...knownSet, ...win.cols.filter((c) => !cols[c].parity)]);
        verified(cols, np, errors, new Set([...firstRead, ...res.readAll]), res);
      }
    }
  }
  res.undetected = res.ok ? cols.filter((x) => x.corrupt && !res.repaired.includes(x.c)).map((x) => x.c) : [];
  return res;
}

/**
 * vdev_raidz_io_done_verified (L3102-L3247) once the block is right: verify
 * the parity columns read but not used (L3132-L3163, raidz_parity_verify
 * L2800-L2853), then, if anything unexpected was found, write the good data
 * back to every column in error (L3166-L3210). A missing child is in error
 * but expected (rc_skipped); its repair write cannot land and is not shown.
 */
function verified(cols: ReturnType<typeof columns>, np: number, errors: Set<number>, tried: Set<number>, res: ReadResult) {
  const parityErrors = cols.filter((x) => x.parity && errors.has(x.c)).length;
  const dataErrors = cols.filter((x) => !x.parity && errors.has(x.c)).length;
  const parityUntried = cols.filter((x) => x.parity && !errors.has(x.c) && !tried.has(x.c)).length;
  let unexpected = cols.filter((x) => errors.has(x.c) && !x.missing).length;
  const err = new Set(errors);
  res.parityVerified = parityErrors + parityUntried < np - dataErrors;
  if (res.parityVerified)
    for (const x of cols)
      if (x.parity && tried.has(x.c) && !err.has(x.c) && x.corrupt) {
        err.add(x.c); // regenerated parity differs from what the child returned
        unexpected++;
      }
  if (unexpected > 0) res.repaired = cols.filter((x) => err.has(x.c) && !x.missing && x.size > 0).map((x) => x.c);
}

/** vdev_raidz_combrec (L3502-L3602) with raidz_reconstruct (L3308-L3446). */
function combrec(L: Layout, cols: ReturnType<typeof columns>, known: Set<number>, res: ReadResult): Attempt | null {
  const np = L.nparity;
  const n = L.dcols; // L3532-L3536 without expansion: the number of children
  for (let numFailures = 1; numFailures <= np; numFailures++) {
    const tstore = new Array<number>(np + 2);
    const at = (i: number) => tstore[i + 1]; // ltgts = &tstore[1]
    const set = (i: number, v: number) => (tstore[i + 1] = v);
    set(-1, -1); // L3542-L3546
    for (let i = 0; i < numFailures; i++) set(i, i);
    set(numFailures, n);
    for (;;) {
      const tg = Array.from({ length: numFailures }, (_, i) => at(i));
      const out = reconstruct(cols, np, known, tg);
      res.attempts.push(out);
      if (out.outcome === "einval") break; // L3551-L3557
      if (out.outcome === "ok") return out;
      // L3560-L3594: next combination.
      let t = 0;
      for (; ; t++) {
        set(t, at(t) + 1);
        if (at(t) === n) break; // try more failures
        if (at(t) !== at(t + 1)) break; // found next combination
        set(t, at(t - 1) + 1);
      }
      if (at(numFailures - 1) === n) break;
    }
  }
  return null;
}

function reconstruct(cols: ReturnType<typeof columns>, np: number, known: Set<number>, ltgts: number[]): Attempt {
  let dead = 0;
  let deadData = 0;
  const sim: number[] = [];
  for (const x of cols) {
    if (known.has(x.c)) {
      dead++;
      if (!x.parity) deadData++;
      continue;
    }
    if (x.size === 0) continue;
    // raidz_simulate_failure without expansion: logical child i is device i
    if (ltgts.includes(x.dev)) {
      sim.push(x.c);
      dead++;
      if (!x.parity) deadData++;
    }
  }
  const tgts = new Set([...sim, ...known]);
  const rebuilt = cols.filter((x) => !x.parity && tgts.has(x.c)).map((x) => x.c);
  const base = { tgts: ltgts, cols: sim, dead, deadData, parity: [] as string[], rebuilt };
  if (dead > np) return { ...base, outcome: "einval" }; // L3385-L3392
  let right: boolean;
  if (deadData > 0) {
    const r = rebuild(cols, tgts);
    base.parity = r.parity;
    right = dataRight(cols, tgts, r.right);
  } else right = dataRight(cols, new Set(), false);
  return { ...base, outcome: right ? "ok" : "cksum" };
}

/**
 * vdev_raidz_need_resilver (L4013-L4035), for a block whose children `dirty`
 * have a non-empty DTL: does a resilver have to rewrite this block?
 */
export function needResilver(L: Layout, dirty: number[]): boolean {
  const np = L.nparity;
  if (L.s + np >= L.dcols) return true;
  for (let c = 0; c < L.s + np; c++) if (dirty.includes((L.f + c) % L.dcols)) return true;
  return false;
}
