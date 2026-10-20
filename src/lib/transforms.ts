// The model of the compression, dedup and encryption room: a transcription of
// the branches of zio_write_compress (with zio_get_compression_max_size and
// zio_roundup_alloc_size), of zio_ddt_write with ddt_lookup's quota, and of the
// block pointer layouts of spa.h with what zio_encrypt does to each kind of
// block. Refs: ANALYSIS.md, room "Compression, dedup, encryption", excerpts
// 1 to 15; simplifications: DECISIONS.md D10.2. No DOM, no dependency.
import { fletcher4 } from "./fletcher4";

// ---------------------------------------------------------------- compression

/** spa.h L356-L357: BPE_NUM_WORDS 14 words of 8 bytes. */
export const BPE_PAYLOAD_SIZE = 14 * 8;

export type Algo = "off" | "lz4" | "zle";

/** zio_get_compression_max_size (zio.c L1791-L1809). */
export function maxSize(algo: Algo, gcdAlloc: number, minAlloc: number, sLen: number): number {
  let d = sLen - (sLen >> 3);
  if (algo === "zle") return d;
  d = d - (d % gcdAlloc);
  if (d < minAlloc) return BPE_PAYLOAD_SIZE;
  return d;
}

/** zio_roundup_alloc_size (zio.c L1783-L1789). */
export function roundupAlloc(size: number, minAlloc: number, gcdAlloc: number): number {
  if (size > minAlloc) return Math.ceil(size / gcdAlloc) * gcdAlloc;
  return minAlloc;
}

export interface CompressIn {
  /** Logical size of the block, bytes. */
  lsize: number;
  ashift: number;
  algo: Algo;
  /** The block is all zeros. */
  zero: boolean;
  /** What the compressor would output with no limit, bytes (ignored for zeros or with compression off). */
  out: number;
  /** zp_encrypt (an encrypted dataset). */
  encrypt?: boolean;
}

export type Outcome = "hole" | "uncompressed" | "compressed" | "embedded" | "written";

export interface CompressOut {
  /** s_len - s_len/8, before the snap. */
  eighth: number;
  /** The limit handed to the compressor (zio_get_compression_max_size), or null with compression off. */
  limit: number | null;
  /** What zio_compress_data returned: the output if it fit under the limit, else lsize (zio_compress.c L148-L149). */
  returned: number | null;
  /** The output rounded up by zio_roundup_alloc_size, when that branch ran. */
  rounded: number | null;
  outcome: Outcome;
  /** Why: the branch of zio_write_compress that decided. */
  why: "zero" | "off" | "over" | "embed" | "noembed-rounded" | "rounded-lsize" | "rounded";
  /** PSIZE in the block pointer (0 for a hole; the payload size for an embedded bp). */
  psize: number;
  /** BP_SET_COMPRESS: the algorithm kept, or off. */
  compress: Algo;
  /** Bytes allocated on disk (vdev_default_asize on a single disk: PSIZE rounded to the sector). */
  asize: number;
  sectors: number;
}

/** zio_write_compress, the branches of L1982-L2039 and L2107-L2132, on a pool of plain disks of one ashift. */
export function compress(x: CompressIn): CompressOut {
  const sector = 2 ** x.ashift;
  const minAlloc = sector, gcdAlloc = sector;
  const eighth = x.lsize - (x.lsize >> 3);
  const base = { eighth, limit: null, returned: null, rounded: null } as Pick<CompressOut, "eighth" | "limit" | "returned" | "rounded">;
  const alloc = (psize: number) => {
    const asize = psize ? Math.ceil(psize / sector) * sector : 0;
    return { psize, asize, sectors: asize / sector };
  };
  // L1983: compression off, nothing below runs; the block is written as is.
  if (x.algo === "off") return { ...base, outcome: "written", why: "off", compress: "off", ...alloc(x.lsize) };
  // L1986-L1987, L1996-L1997: all zeros, a hole (L2107-L2115).
  if (x.zero) return { ...base, outcome: "hole", why: "zero", compress: "off", ...alloc(0) };
  const limit = maxSize(x.algo, gcdAlloc, minAlloc, x.lsize);
  const out = Math.max(1, Math.round(x.out));
  const returned = out > limit ? x.lsize : out;
  const b = { ...base, limit, returned };
  // L1998-L2001.
  if (returned >= x.lsize) return { ...b, outcome: "uncompressed", why: "over", compress: "off", ...alloc(x.lsize) };
  // L2002-L2017: level 0, a type with no fill count and embedded_data enabled are taken as given.
  if (returned <= BPE_PAYLOAD_SIZE && !x.encrypt) return { ...b, outcome: "embedded", why: "embed", compress: x.algo, psize: returned, asize: 0, sectors: 0 };
  // L2018-L2039.
  const rounded = roundupAlloc(returned, minAlloc, gcdAlloc);
  const why = returned <= BPE_PAYLOAD_SIZE ? "noembed-rounded" : rounded >= x.lsize ? "rounded-lsize" : "rounded";
  if (rounded >= x.lsize) return { ...b, rounded, outcome: "uncompressed", why, compress: "off", ...alloc(x.lsize) };
  return { ...b, rounded, outcome: "compressed", why, compress: x.algo, ...alloc(rounded) };
}

// ---------------------------------------------------------------- dedup

export interface Entry {
  content: string;
  /** The block's checksum, the DDT key (shortened for display). */
  cksum: string;
  refcnt: number;
  dva: string;
  /** ddp_phys_birth: the txg the data was written. */
  birth: number;
}

export interface WrittenBp {
  n: number;
  content: string;
  dva: string;
  /** The D bit as written. */
  dedup: boolean;
  logical: number;
  physical: number;
}

export type DedupOutcome = "miss" | "hit" | "overquota";

export interface DedupStep {
  content: string;
  txg: number;
  cksum: string;
  overQuota: boolean;
  outcome: DedupOutcome;
  bp: WrittenBp;
  /** A data block written to disk by this step (miss, over quota), or null (hit). */
  wrote: string | null;
  /** The entry's refcount after the step, or null when there is no entry. */
  refcnt: number | null;
}

export interface DedupState {
  txg: number;
  entries: Entry[];
  bps: WrittenBp[];
  /** Data blocks on disk: DVA and content. */
  disk: { dva: string; content: string; txg: number }[];
  lookups: number;
  steps: DedupStep[];
}

export const CONTENTS = ["A", "B", "C"] as const;
export const FIRST_TXG = 100;

/** A short stand-in checksum of a content: the first word of fletcher-4 over its bytes, in hex. */
export function cksumOf(content: string): string {
  const bytes = new Uint8Array(4096);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (content.charCodeAt(i % content.length) * 31 + i) & 0xff;
  return fletcher4(bytes)[3].toString(16).padStart(16, "0").slice(-8);
}

/** DVAs of the figure: vdev 0, 128 KiB blocks one after the other from offset 0x400000. */
const dvaAt = (i: number) => `0:${(0x400000 + i * 0x20000).toString(16)}`;

export function dedupStart(): DedupState {
  return { txg: FIRST_TXG, entries: [], bps: [], disk: [], lookups: 0, steps: [] };
}

/**
 * One write of a block of the given content, in its own txg (zio_ddt_write,
 * zio.c L3795-L4168, with copies=1 and no write of the same key in flight).
 */
export function dedupWrite(s: DedupState, content: string, overQuota: boolean): DedupState {
  const txg = s.txg;
  const cksum = cksumOf(content);
  const entries = s.entries.map((e) => ({ ...e }));
  const disk = [...s.disk];
  const n = s.bps.length;
  const found = entries.find((e) => e.cksum === cksum);
  let step: DedupStep;
  if (found) {
    // L3962-L3986: enough DVAs in the entry, fill the bp (ddt.c L724-L726) and addref.
    found.refcnt++;
    const bp = { n, content, dva: found.dva, dedup: true, logical: txg, physical: found.birth };
    step = { content, txg, cksum, overQuota, outcome: "hit", bp, wrote: null, refcnt: found.refcnt };
  } else if (overQuota) {
    // ddt.c L1376-L1383, zio.c L3824-L3832: no new entry, D bit cleared, an ordinary write.
    const dva = dvaAt(disk.length);
    disk.push({ dva, content, txg });
    const bp = { n, content, dva, dedup: false, logical: txg, physical: txg };
    step = { content, txg, cksum, overQuota, outcome: "overquota", bp, wrote: dva, refcnt: null };
  } else {
    // A new entry, no DVA: the child write (L4110-L4114), the refcount 0 → 1 (L4161),
    // the DVA copied into the entry when the write is ready (L3782).
    const dva = dvaAt(disk.length);
    disk.push({ dva, content, txg });
    entries.push({ content, cksum, refcnt: 1, dva, birth: txg });
    const bp = { n, content, dva, dedup: true, logical: txg, physical: txg };
    step = { content, txg, cksum, overQuota, outcome: "miss", bp, wrote: dva, refcnt: 1 };
  }
  return { txg: txg + 1, entries, bps: [...s.bps, step.bp], disk, lookups: s.lookups + 1, steps: [...s.steps, step] };
}

// ---------------------------------------------------------------- encryption

export type BpKind = "plain" | "encrypted" | "authenticated" | "indirect" | "embedded" | "hole";

/** What a word of a block pointer holds, by kind (spa.h L123-L225, L265-L294, L365-L373). */
export type WordRole =
  | "dva-vdev" | "dva-offset" | "prop" | "prop2" | "pad" | "pbirth" | "lbirth" | "fill" | "cksum"
  | "salt" | "iv1" | "iv2-fill" | "mac" | "macmac" | "payload" | "zero";

export interface Word {
  i: number;
  role: WordRole;
  /** For DVA words, which DVA (1-3); for checksum and MAC words, the index in its array. */
  k?: number;
}

export function bpWords(kind: BpKind): Word[] {
  const w: Word[] = [];
  if (kind === "embedded") {
    for (let i = 0; i < 16; i++) w.push({ i, role: i === 6 ? "prop" : i === 10 ? "lbirth" : "payload" });
    return w;
  }
  for (let d = 0; d < 3; d++) {
    if (kind === "encrypted" && d === 2) {
      w.push({ i: 4, role: "salt" }, { i: 5, role: "iv1" });
    } else {
      w.push({ i: 2 * d, role: kind === "hole" ? "zero" : "dva-vdev", k: d + 1 }, { i: 2 * d + 1, role: kind === "hole" ? "zero" : "dva-offset", k: d + 1 });
    }
  }
  w.push({ i: 6, role: "prop" }, { i: 7, role: "prop2" }, { i: 8, role: "pad" }, { i: 9, role: "pbirth" }, { i: 10, role: "lbirth" });
  w.push({ i: 11, role: kind === "encrypted" ? "iv2-fill" : "fill" });
  const tail: WordRole = kind === "encrypted" || kind === "authenticated" ? "mac" : kind === "indirect" ? "macmac" : "cksum";
  w.push({ i: 12, role: "cksum", k: 0 }, { i: 13, role: "cksum", k: 1 });
  w.push({ i: 14, role: tail, k: tail === "cksum" ? 2 : 0 }, { i: 15, role: tail, k: tail === "cksum" ? 3 : 1 });
  return w;
}

/** The X bit (BP_USES_CRYPT, spa.h L452-L454). */
export const usesCrypt = (k: BpKind) => k === "encrypted" || k === "authenticated" || k === "indirect";
/** Most copies a block pointer of this kind can carry (dmu.c L2523-L2525). */
export const maxCopies = (k: BpKind) => (k === "encrypted" ? 2 : k === "embedded" || k === "hole" ? 0 : 3);

/** A block of the figure's encrypted file. */
export interface CBlock {
  id: string;
  kind: BpKind;
  /** Bytes as stored on disk (ciphertext for an encrypted block). */
  disk: Uint8Array;
  /** The plaintext, for the reader with the key. */
  plain: string;
  /** The 256-bit checksum stored in its parent's block pointer, words as the writer stored them. */
  cksum: bigint[];
}

/** A deterministic stand-in for a keystream; the figure does not run AES (D10.2). */
function stream(seed: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}
const bytesOf = (s: string, n = 512) => {
  const b = new Uint8Array(n);
  for (let i = 0; i < s.length && i < n; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
};

/**
 * The writer's checksum: fletcher-4 of the bytes on disk; for a block pointer
 * with the X bit and a checksum not flagged for dedup, words 2 and 3 are
 * folded into 0 and 1 and replaced by the MAC (zio_checksum.c L324-L341).
 */
function storedCksum(disk: Uint8Array, kind: BpKind, mac: bigint[]): bigint[] {
  const c = fletcher4(disk);
  if (!usesCrypt(kind)) return c;
  return [c[0] ^ c[2], c[1] ^ c[3], mac[0], mac[1]];
}

/** zio_checksum_error_impl's comparison (L508-L526): the truncated words only, for a crypt bp. */
export function verifies(b: CBlock): boolean {
  const a = fletcher4(b.disk);
  if (!usesCrypt(b.kind)) return a.every((w, i) => w === b.cksum[i]);
  return (a[0] ^ a[2]) === b.cksum[0] && (a[1] ^ a[3]) === b.cksum[1];
}

export interface CryptFile {
  dnode: CBlock;
  indirect: CBlock;
  data: CBlock[];
}

/** An encrypted file of three data blocks: its dnode block, its indirect block and its data. */
export function cryptFile(texts: string[], dnodeCore: string, bonus: string): CryptFile {
  const mac = (seed: number): bigint[] => {
    const s = stream(seed * 7919, 16);
    const w = (o: number) => s.slice(o, o + 8).reduce((a, x) => (a << 8n) | BigInt(x), 0n);
    return [w(0), w(8)];
  };
  const data = texts.map((t, i) => {
    const plain = bytesOf(t);
    const ks = stream(1000 + i, plain.length);
    const disk = plain.map((x, j) => x ^ ks[j]);
    const m = mac(1000 + i);
    return { id: `d${i}`, kind: "encrypted" as BpKind, disk, plain: t, cksum: storedCksum(disk, "encrypted", m), mac: m };
  });
  // zio_encrypt L5123-L5131: the indirect block is in clear, its bp carries a checksum of the MACs below.
  const indirectBytes = bytesOf(data.map((d) => d.mac.map((x) => x.toString(16)).join("")).join("|"));
  const ind = { id: "L1", kind: "indirect" as BpKind, disk: indirectBytes, plain: "", cksum: storedCksum(indirectBytes, "indirect", mac(1)) };
  // zio_crypt.c L115-L120: the dnode core in clear, the bonus buffer encrypted.
  const core = bytesOf(dnodeCore, 256);
  const bks = stream(2000, 256);
  const bonusBytes = bytesOf(bonus, 256).map((x, j) => x ^ bks[j]);
  const dn = new Uint8Array(512);
  dn.set(core, 0);
  dn.set(bonusBytes, 256);
  const dnode = { id: "dn", kind: "encrypted" as BpKind, disk: dn, plain: bonus, cksum: storedCksum(dn, "encrypted", mac(2)) };
  return { dnode, indirect: ind, data: data.map(({ mac: _m, ...b }) => b) };
}

/** A copy of a block with one bit flipped on disk. */
export function flipped(b: CBlock, byte = 37, bit = 2): CBlock {
  const disk = b.disk.slice();
  disk[byte] ^= 1 << bit;
  return { ...b, disk };
}

export type ReadResult = { ok: true; text: string } | { ok: false; err: "EACCES" | "ECKSUM" };

/** A read of a block through the DMU: checksum, then decryption, which needs the key (dsl_crypt.c L2818-L2823). */
export function readBlock(b: CBlock, keyLoaded: boolean): ReadResult {
  if (!verifies(b)) return { ok: false, err: "ECKSUM" };
  if (b.kind !== "encrypted") return { ok: true, text: b.plain };
  if (!keyLoaded) return { ok: false, err: "EACCES" };
  return { ok: true, text: b.plain };
}

/** Scrub: raw reads (dsl_scan.c L4841), so no decryption and no key: the truncated checksum of every block. */
export function scrub(f: CryptFile): { id: string; ok: boolean }[] {
  return [f.dnode, f.indirect, ...f.data].map((b) => ({ id: b.id, ok: verifies(b) }));
}

/** The first bytes of a block as hex, for the opaque view. */
export const hex = (b: Uint8Array, n = 12) => Array.from(b.slice(0, n), (x) => x.toString(16).padStart(2, "0")).join(" ");
