// fletcher4, the default ZFS checksum (`checksum=on`, include/sys/zio.h L119),
// as in fletcher_4_scalar_native, module/zcommon/zfs_fletcher.c L317-L338:
// four 64-bit running sums over the buffer read as 32-bit little-endian words.
// The four sums are the 256-bit checksum stored in the parent's blkptr_t.
export type Cksum = [bigint, bigint, bigint, bigint];

const M = (x: bigint) => BigInt.asUintN(64, x);

export function fletcher4(bytes: Uint8Array): Cksum {
  return fletcher4Inc([0n, 0n, 0n, 0n], bytes);
}

/**
 * fletcher_4_incremental_native (zfs_fletcher.c L592-L601): the four sums
 * carried on over more bytes, so that summing a stream piece by piece gives
 * the checksum of the whole (send/receive, dmu_send.c L268-L283).
 */
export function fletcher4Inc(start: Cksum, bytes: Uint8Array): Cksum {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let [a, b, c, d] = start;
  for (let i = 0; i + 4 <= bytes.byteLength; i += 4) {
    a = M(a + BigInt(view.getUint32(i, true)));
    b = M(b + a);
    c = M(c + b);
    d = M(d + c);
  }
  return [a, b, c, d];
}

export const sameCksum = (x: Cksum, y: Cksum) => x.every((w, i) => w === y[i]);

/** Short form for a card: the low 32 bits of the last word, in hex. */
export const shortCksum = (k: Cksum) => (k[3] & 0xffffffffn).toString(16).padStart(8, "0");

/** Full form: the four words, as zdb prints them. */
export const fullCksum = (k: Cksum) => k.map((w) => w.toString(16)).join(":");

/** A demo block: text padded with NUL to a multiple of four bytes. */
export function block(text: string, size = 32): Uint8Array {
  const out = new Uint8Array(size);
  out.set(new TextEncoder().encode(text).slice(0, size));
  return out;
}
