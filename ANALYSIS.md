# Analysis of the OpenZFS source for Uberblok

Everything below is read from one frozen commit and nothing else:

- **OpenZFS `zfs-2.4.4`**, commit [`71a9f9578616a90c3c14bb59629fb4d31bfd68d1`](https://github.com/openzfs/zfs/tree/71a9f9578616a90c3c14bb59629fb4d31bfd68d1) (tagged 2026-08-21). See `DECISIONS.md` D0.1.
- Every permalink uses the full SHA. Every code block below a permalink is a byte-for-byte copy of those lines, checked by `scripts/check-permalinks.mjs` (see the end of this file).
- Line numbers in the annotations ("L1234") are line numbers in the file of the excerpt being discussed.

The excerpts are short quotations of OpenZFS code, under the [CDDL-1.0](https://opensource.org/licenses/CDDL-1.0), copyright of their authors as stated in the header of each file (Sun Microsystems, Oracle, Delphix, Lawrence Livermore National Laboratory and the OpenZFS contributors). Each one links to its source. No OpenZFS file is copied into this repository.

This document is the source of the animations: **an animation that maps to nothing here does not exist.** Each room section gives the problem, the functions and structures that *are* the idea, 10–40 line excerpts, what the animation shows mapped to lines, and facts (constants, sizes) the room texts may state.

## Contents

- [Architecture](#architecture)
- [Key structures](#key-structures)
- [What the code says that common accounts get wrong](#what-the-code-says-that-common-accounts-get-wrong)
- Rooms, in visit order (`DECISIONS.md` D0.4):
  0. [Hall: the uberblock](#room-hall-the-uberblock)
  1. History wing: no code; facts go to `SOURCES.md` (slice 2)
  2. [The tree and the uberblock](#room-the-tree-and-the-uberblock)
  3. [Copy-on-write, checksums and self-healing](#room-copy-on-write-checksums-and-self-healing)
  4. [Transaction groups](#room-transaction-groups)
  5. [The vdevs](#room-the-vdevs)
  6. [RAID-Z](#room-raid-z)
  7. [Snapshots and clones](#room-snapshots-and-clones)
  8. [The ARC](#room-the-arc)
  9. [Metaslabs and space maps](#room-metaslabs-and-space-maps)
  10. [ZIL and SLOG](#room-zil-and-slog)
  11. [send / receive](#room-send--receive)
  12. [Compression, dedup, encryption](#room-compression-dedup-encryption)
  13. Engine room (colophon): no code; it names this commit and links here (slice 13)
- [Checking the excerpts](#checking-the-excerpts)

## What the code says that common accounts get wrong

Points where the 2.4.4 code differs from what is often written about ZFS, or from the mission's wording. The room texts follow the code.

- **"The ring of 128 uberblocks"** is true only for ashift 9 or 10. The ring is 128 KiB per label and a slot is `1 << clamp(ashift, 10, 13)` bytes, so ashift 11 gives 64 slots of 2 KiB, a pool on 4K-sector disks (ashift 12, the common case today) has **32** slots per label, and ashift 13 or more has 16. See the Hall room facts and `DECISIONS.md` D0.7.
- **The uberblock is not written "even labels, then odd labels".** The even/odd phases write the config nvlist of each label; the uberblock is written to the same slot of all four labels in one phase between them (`vdev_config_sync`, tree room).
- **The uberblock is not checksummed by a parent.** The Merkle chain stops at `ub_rootbp`; the uberblock slot carries an embedded SHA-256 label checksum whose verifier is its disk offset (copy-on-write room facts).
- **Copy-on-write has one exception for blocks of the tree:** a block born in the txg being synced may be rewritten in place from sync pass 2, because no committed uberblock references it yet (`zio_write_compress`).
- **There is no `arc_p` any more.** Ghost hits are counted in bytes by `arc_access` and turned into three fixed-point fractions (`arc_meta`, `arc_pd`, `arc_pm`) in `arc_evict` (ARC room).
- **RAID-Z data is not round-robin by sector.** On a raidz that is not being expanded the map has one row, and each data column is a contiguous run of the block (RAID-Z room).
- **Clones: there is no `ds_origin`.** The origin snapshot is `dd_origin_obj` in the `dsl_dir` (snapshots room).
- **Incremental send's pruning lives in `dmu_traverse.c`**, comparing the *logical* birth txg with `fromtxg` (send/receive room).
- **A SLOG does not stop indirect ZIL writes entirely:** with `logbias=throughput`, or a write that takes the Direct I/O path (`O_DIRECT` on at least a whole file block), a write is always logged as WR_INDIRECT (ZIL room).
- **Snapshot creation is independent of the amount of data**, but it is not literally one write: the deadlist is cloned with one empty bpobj per existing key (snapshots room).
- **A snapshot's deadlist is not "the blocks only it owns".** It holds the blocks killed between the previous snapshot and this one: blocks the *previous* snapshot references and this one does not. Destroying a snapshot frees the part of the *next* dataset's deadlist born after the snapshot before it (snapshots room).

## Architecture

All paths and line numbers refer to OpenZFS tag zfs-2.4.4, commit 71a9f9578616a90c3c14bb59629fb4d31bfd68d1. File counts were computed with `ls` on that tree.

### Source map

| Directory | What lives there |
|---|---|
| `module/zfs/` | The portable kernel core: 137 `.c` files (+3 raidz-math `.h`). Everything from the OS-neutral half of the POSIX layer down to the vdev tree, the ARC and the zio pipeline. Compiled both into the kernel module and (minus 9 files, see `lib/libzpool`) into userland. |
| `include/sys/` | 140 top-level headers for the core (`dmu.h`, `dbuf.h`, `spa.h`, `vdev_impl.h`, `zio.h`, `zio_impl.h`, `uberblock_impl.h`, ...) plus subdirectories `crypto/`, `fm/`, `fs/` (only `zfs.h`: the user/kernel ABI, e.g. `ZFS_DEV "/dev/zfs"` at [`include/sys/fs/zfs.h#L1422`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/fs/zfs.h#L1422)), `lua/`, `sysevent/`, `zstd/`. |
| `module/os/linux/zfs/` | 34 Linux-specific files. The ZPL proper: VFS glue `zpl_file.c`, `zpl_inode.c`, `zpl_super.c`, `zpl_xattr.c`, `zpl_ctldir.c`, `zpl_export.c`, `zpl_file_range.c`; vnode-like ops `zfs_vnops_os.c`, `zfs_vfsops.c`, `zfs_dir.c` (directories = ZAP objects), `zfs_acl.c`, `zfs_znode_os.c`, `zfs_ctldir.c` (`.zfs/snapshot`); the block device `vdev_disk.c`; `zvol_os.c`; `zfs_ioctl_os.c` (the `/dev/zfs` entry point); OS halves `abd_os.c`, `arc_os.c`, `spa_misc_os.c`, `mmp_os.c`, `vdev_label_os.c`; `zio_crypt.c`, QAT offload (`qat*.c`). |
| `module/os/freebsd/zfs/` | 24 FreeBSD-specific files: `zfs_vnops_os.c` (VOP table; e.g. `zfs_freebsd_write` calls the shared `zfs_write` at [`module/os/freebsd/zfs/zfs_vnops_os.c#L4738`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/freebsd/zfs/zfs_vnops_os.c#L4738)), `zfs_vfsops.c`, `zfs_dir.c`, `zfs_acl.c`, `vdev_geom.c` (GEOM instead of `vdev_disk.c`), `zvol_os.c`, `sysctl_os.c`, `kmod_core.c`, and the same `*_os.c` pattern as Linux. |
| `module/zcommon/` | 17 `.c` files shared by kernel and userland: property tables (`zfs_prop.c`, `zpool_prop.c`, `zprop_common.c`), feature table (`zfeature_common.c`), name validation (`zfs_namecheck.c`), Fletcher checksums (`zfs_fletcher*.c`, 7 files), `cityhash.c`, `zfs_deleg.c`, `zfs_comutil.c`, `zfs_valstr.c`, `simd_stat.c`. |
| `cmd/` | Userland tools. `zpool` (`zpool_main.c`, 13930 lines) and `zfs` (`zfs_main.c`, 9649 lines) link `libzfs`/`libzfs_core` and talk to the kernel only through ioctls on `/dev/zfs` (kernel side: `zfsdev_ioctl_common` at [`module/zfs/zfs_ioctl.c#L8135`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_ioctl.c#L8135)). `zdb` (`zdb.c`, 10285 lines), `ztest` and `zhack` instead link `libzpool` and run the pool code themselves, in-process. Others: `zed`, `zinject`, `zstream`, `raidz_test`, `zarcstat`, ... |
| `lib/libzpool` | The userland build of the kernel core. `nodist_libzpool_la_SOURCES` lists 128 of the 137 `module/zfs/*.c` files, plus `module/zcommon`, `module/lua` and `module/os/linux/zfs/zio_crypt.c`; it adds 8 shims of its own (`kernel.c`, `taskq.c`, `util.c`, `abd_os.c`, `arc_os.c`, `vdev_label_os.c`, `zfs_debug.c`, `zfs_racct.c`) and is compiled with `-DLIB_ZPOOL_BUILD`. The 9 core files it leaves out are exactly the POSIX/ioctl/zvol front ends: `zfs_vnops.c`, `zfs_ioctl.c`, `zfs_log.c`, `zfs_replay.c`, `zfs_quota.c`, `zfs_onexit.c`, `zfs_impl.c`, `dataset_kstats.c`, `zvol.c`. `vdev_disk.c` is not included either, so userland pools sit on `vdev_file.c`. |

`module/zfs/*.c` grouped by layer (137 files; each file is in exactly one group):

| Layer | # | Files |
|---|---|---|
| POSIX layer, OS-neutral half (ZPL) | 7 | `zfs_vnops.c` (`zfs_read`, `zfs_write`), `zfs_znode.c`, `zfs_sa.c`, `zfs_fuid.c`, `zfs_rlock.c` (range locks), `zfs_quota.c`, `zfs_byteswap.c` |
| ZIL (intent log) | 3 | `zil.c`, `zfs_log.c` (builds ZPL log records), `zfs_replay.c` |
| Kernel entry points other than files | 3 | `zfs_ioctl.c`, `zfs_onexit.c`, `zvol.c` |
| ZAP and SA (object formats on top of DMU) | 4 | `zap.c`, `zap_leaf.c`, `zap_micro.c`, `sa.c` |
| Channel programs (Lua) | 6 | `zcp.c`, `zcp_get.c`, `zcp_global.c`, `zcp_iter.c`, `zcp_set.c`, `zcp_synctask.c` |
| DMU (objects, buffers, transactions, send/recv) | 15 | `dmu.c`, `dmu_tx.c`, `dmu_objset.c`, `dmu_object.c`, `dbuf.c`, `dbuf_stats.c`, `dnode.c`, `dnode_sync.c`, `dmu_zfetch.c`, `dmu_direct.c`, `dmu_traverse.c`, `dmu_diff.c`, `dmu_send.c`, `dmu_recv.c`, `dmu_redact.c` |
| ARC and buffers | 2 | `arc.c` (ARC and L2ARC), `abd.c` (ABD scatter/linear buffers) |
| DSL (datasets, snapshots, pool-wide sync) | 12 | `dsl_pool.c`, `dsl_dataset.c`, `dsl_dir.c`, `dsl_deadlist.c`, `dsl_scan.c`, `dsl_destroy.c`, `dsl_synctask.c`, `dsl_prop.c`, `dsl_bookmark.c`, `dsl_crypt.c`, `dsl_deleg.c`, `dsl_userhold.c` |
| Block-reference bookkeeping (dedup, clone, bp lists) | 9 | `blkptr.c`, `bpobj.c`, `bplist.c`, `bptree.c`, `brt.c`, `ddt.c`, `ddt_log.c`, `ddt_stats.c`, `ddt_zap.c` |
| SPA (pool, txg, uberblock, config) | 12 | `spa.c`, `spa_misc.c`, `spa_config.c`, `spa_checkpoint.c`, `spa_errlog.c`, `spa_history.c`, `spa_log_spacemap.c`, `spa_stats.c`, `txg.c`, `uberblock.c`, `zfeature.c`, `mmp.c` |
| Space allocation | 4 | `metaslab.c`, `space_map.c`, `range_tree.c`, `space_reftree.c` |
| ZIO pipeline | 4 | `zio.c`, `zio_checksum.c`, `zio_compress.c`, `zio_inject.c` |
| Checksum, compression, KDF algorithms | 12 | `sha2_zfs.c`, `skein_zfs.c`, `edonr_zfs.c`, `blake3_zfs.c`, `zfs_impl.c`, `zfs_chksum.c` (benchmark), `hkdf.c`, `lz4.c`, `lz4_zfs.c`, `lzjb.c`, `gzip.c`, `zle.c` |
| vdev tree | 17 | `vdev.c`, `vdev_label.c`, `vdev_queue.c`, `vdev_mirror.c`, `vdev_raidz.c`, `vdev_draid.c`, `vdev_draid_rand.c`, `vdev_root.c`, `vdev_file.c`, `vdev_missing.c`, `vdev_indirect.c`, `vdev_indirect_births.c`, `vdev_indirect_mapping.c`, `vdev_removal.c`, `vdev_rebuild.c`, `vdev_initialize.c`, `vdev_trim.c` |
| RAID-Z parity math (SIMD variants) | 10 | `vdev_raidz_math.c`, `_scalar`, `_sse2`, `_ssse3`, `_avx2`, `_avx512f`, `_avx512bw`, `_aarch64_neon`, `_aarch64_neonx2`, `_powerpc_altivec` |
| Infrastructure | 17 | `aggsum.c`, `btree.c`, `bqueue.c`, `multilist.c`, `objlist.c`, `refcount.c`, `rrwlock.c`, `zrlock.c`, `zthr.c`, `unique.c`, `pathname.c`, `dataset_kstats.c`, `zfs_debug_common.c`, `zfs_ratelimit.c`, `zfs_crrd.c`, `fm.c`, `zfs_fm.c` |

7+3+3+4+6+15+2+12+9+12+4+4+12+17+10+17 = 137.

### The layering

```
   VFS (Linux)                     VFS (FreeBSD)             /dev/zfs ioctl      zvol
   zpl_file.c zpl_inode.c ...      zfs_vnops_os.c            zfs_ioctl.c         zvol.c
   zfs_vnops_os.c zfs_dir.c        zfs_dir.c                      |                |
        \______________________________/                          |                |
                       |                                          |                |
   ZPL core       zfs_vnops.c (zfs_read/zfs_write) zfs_znode.c    |                |
                  zfs_rlock.c zfs_sa.c                            |                |
                       |            \                             |                |
   helpers        ZAP zap*.c   SA sa.c   ZIL zil.c zfs_log.c      |                |
                       |            |        |                    |                |
   ============================================================================================
   DMU            dmu.c  dmu_tx.c  dmu_objset.c  dnode.c dnode_sync.c  dbuf.c      +-------+
                  (objects = dnodes, blocks = dbufs, changes grouped in dmu_tx)    |  ARC  |
                       |                                                    <----> | arc.c |
   DSL            dsl_pool.c  dsl_dataset.c  dsl_dir.c  dsl_deadlist.c             | abd.c |
                  dsl_scan.c  dsl_synctask.c                                       +-------+
                       |                                                               |
   SPA            spa.c  spa_misc.c  txg.c  uberblock.c                                |
                  metaslab.c  space_map.c  range_tree.c                                |
                  zio.c  zio_checksum.c  zio_compress.c  <-----------------------------+
                       |                           (arc_read/arc_write create zios)
   vdev           vdev.c  vdev_queue.c  vdev_label.c
                  vdev_mirror.c  vdev_raidz.c  vdev_draid.c  vdev_root.c
                  leaves: vdev_disk.c (Linux) / vdev_geom.c (FreeBSD) / vdev_file.c
```

Read top to bottom: a file system call becomes a range of an object (ZPL), the object's blocks are dbufs cached in the ARC (DMU), a txg later the dirty dbufs of every dirty dataset are written (DSL drives the sync, SPA owns the txg), each write is a zio that allocates space from metaslabs and is fanned out by the vdev tree. The ARC is beside the DMU, not below it: `dbuf_read_impl` calls `arc_read`, and `dbuf_write` calls `arc_write`, and it is the ARC that creates the zio.

### Who calls whom: one write, end to end

A buffered (non-Direct-I/O, non-sync) `write(2)` on Linux. Each hop links to the line of the call.

Open context (the calling thread):

1. `zpl_iter_write` (the `.write_iter` of the file ops) calls `zfs_write`: [`zpl_file.c#L278`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zpl_file.c#L278).
2. `zfs_write` creates a transaction: `dmu_tx_create` [`zfs_vnops.c#L865`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L865), declares the range with `dmu_tx_hold_write_by_dnode` [`zfs_vnops.c#L869`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L869), then `dmu_tx_assign(tx, DMU_TX_WAIT)` [`zfs_vnops.c#L872`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L872).
3. `dmu_tx_assign` loops on `dmu_tx_try_assign` [`dmu_tx.c#L1250`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1250), which joins the open txg with `txg_hold_open` [`dmu_tx.c#L1085`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1085).
4. `zfs_write` copies the user data with `dmu_write_uio_dbuf` [`zfs_vnops.c#L906`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L906). (When the write is a full, block-aligned block extending the file, 2.4.4 instead loans an ARC buffer and calls `dmu_assign_arcbuf_by_dbuf` [`zfs_vnops.c#L953`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L953).)
5. `dmu_write_uio_dbuf` calls `dmu_write_uio_dnode` [`dmu.c#L1649`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1649). In 2.4.4 this function first diverts aligned Direct I/O to `dmu_write_uio_direct` [`dmu.c#L1548`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1548); the buffered path continues.
6. `dmu_write_uio_dnode` holds the affected dbufs with `dmu_buf_hold_array_by_dnode` [`dmu.c#L1569`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1569), then for a whole block calls `dmu_buf_will_fill_flags` [`dmu.c#L1588`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1588) and for a partial block `dmu_buf_will_dirty_flags` [`dmu.c#L1596`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1596), and copies the bytes into `db_data` with `zfs_uio_fault_move` [`dmu.c#L1600`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1600).
7. Both lead to `dbuf_dirty`: from `dmu_buf_will_dirty_flags` [`dbuf.c#L2776`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2776) (after a `dbuf_read` of the old contents [`dbuf.c#L2770`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2770)), from `dmu_buf_will_fill_flags` [`dbuf.c#L3037`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L3037).
8. `dbuf_dirty` creates a dirty record for `tx->tx_txg & TXG_MASK`, dirties the parent indirect recursively (`dbuf_dirty(parent, tx)` [`dbuf.c#L2552`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2552)) and marks the dnode dirty: `dnode_setdirty` [`dbuf.c#L2583`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2583).
9. `dnode_setdirty` puts the dnode on the objset's dirty list [`dnode.c#L1889`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dnode.c#L1889) and calls `dsl_dataset_dirty` [`dnode.c#L1910`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dnode.c#L1910), which adds the dataset to the pool's `dp_dirty_datasets` for this txg via `txg_list_add` [`dsl_dataset.c#L1478`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1478).
10. Back in `zfs_write`: an intent-log record `zfs_log_write` [`zfs_vnops.c#L1042`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1042) (queued in memory with `zil_itx_assign` [`zfs_log.c#L693`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_log.c#L693); it reaches disk only on `zil_commit`), then `dmu_tx_commit` [`zfs_vnops.c#L1046`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1046), which releases the txg hold with `txg_rele_to_sync` [`dmu_tx.c#L1460`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1460). The system call returns; nothing has been written to the pool yet.

Syncing context (the per-pool `txg_sync_thread`, woken at the latest every `zfs_txg_timeout = 5` seconds [`txg.c#L116`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L116), used at [`txg.c#L533`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L533)):

11. `txg_sync_thread` calls `spa_sync(spa, txg)` [`txg.c#L602`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L602).
12. `spa_sync` calls `spa_sync_iterate_to_convergence` [`spa.c#L10935`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10935), which calls `dsl_pool_sync(dp, txg)` once per sync pass [`spa.c#L10684`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10684). (2.4.4 has this intermediate function between `spa_sync` and `dsl_pool_sync`.)
13. `dsl_pool_sync` pops each dirty dataset and calls `dsl_dataset_sync(ds, rio, tx)` [`dsl_pool.c#L721`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L721), all under one root zio that it waits on [`dsl_pool.c#L723`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L723). (A second round at [`dsl_pool.c#L760`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L760) pushes the user/group-accounting changes.)
14. `dsl_dataset_sync` calls `dmu_objset_sync(ds->ds_objset, rio, tx)` [`dsl_dataset.c#L2141`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L2141).
15. `dmu_objset_sync` issues the `arc_write` of the objset block itself [`dmu_objset.c#L1685`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L1685) and, per dirty-dnode sublist, dispatches `sync_dnodes_task` on `dp_sync_taskq` [`dmu_objset.c#L1765`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L1765). That task calls `dmu_objset_sync_dnodes` [`dmu_objset.c#L1576`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L1576), which calls `dnode_sync(dn, tx)` [`dmu_objset.c#L1492`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L1492). (The task-queue hop is not in the brief's chain; it is in 2.4.4.)
16. `dnode_sync` calls `dbuf_sync_list(list, dn->dn_phys->dn_nlevels - 1, tx)` [`dnode_sync.c#L883`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dnode_sync.c#L883).
17. `dbuf_sync_list` dispatches each dirty record to `dbuf_sync_indirect` [`dbuf.c#L4975`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L4975) or, for level-0 data, `dbuf_sync_leaf` [`dbuf.c#L4977`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L4977); `dbuf_sync_indirect` writes itself and recurses into its children [`dbuf.c#L4607`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L4607).
18. `dbuf_sync_leaf` calls `dbuf_write(dr, *datap, tx)` [`dbuf.c#L4934`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L4934) and then issues it with `zio_nowait(dr->dr_zio)` [`dbuf.c#L4940`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L4940).
19. `dbuf_write` calls `arc_write(...)` with `dbuf_write_ready`/`dbuf_write_done` callbacks [`dbuf.c#L5505`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5505).
20. `arc_write` calls `zio_write(...)` [`arc.c#L7131`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L7131).
21. `zio_write` gives the zio `ZIO_WRITE_PIPELINE` [`zio.c#L1357`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1357). `zio_nowait` runs it: `__zio_execute` [`zio.c#L2587`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2587) advances `io_stage` to the next bit set in `io_pipeline` and calls `zio_pipeline[highbit64(stage) - 1](zio)` [`zio.c#L2494`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2494). For this write the stages are WRITE_BP_INIT, ISSUE_ASYNC, WRITE_COMPRESS, ENCRYPT, CHECKSUM_GENERATE (`zio_checksum_compute` [`zio.c#L5243`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5243)), DVA_THROTTLE, DVA_ALLOCATE, READY, VDEV_IO_START, VDEV_IO_DONE, VDEV_IO_ASSESS, DONE (see the excerpts below).
22. `zio_dva_allocate` calls `metaslab_alloc` [`zio.c#L4380`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4380) -> `metaslab_alloc_range` [`metaslab.c#L5996`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5996) -> `metaslab_alloc_dva_range`, once per copy [`metaslab.c#L6029`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L6029) -> `metaslab_group_alloc` [`metaslab.c#L5445`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5445) -> `metaslab_block_alloc` [`metaslab.c#L5230`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5230), which takes the extent out of the in-memory free tree with `zfs_range_tree_remove(rt, start, size)` [`metaslab.c#L4877`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4877). (2.4.4 adds the `_range` variants between `metaslab_alloc` and the per-DVA allocator.)
23. `zio_vdev_io_start` on the logical zio (no vdev yet) treats the block's DVAs as mirror children: `vdev_mirror_ops.vdev_op_io_start(zio)` [`zio.c#L4697`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4697). `vdev_mirror_io_start` sends a write to every child with `zio_vdev_child_io` [`vdev_mirror.c#L689`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L689).
24. Each child zio reaches `zio_vdev_io_start` again, now with a top-level vdev, and calls `vd->vdev_ops->vdev_op_io_start(zio)` [`zio.c#L4831`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4831): for a mirror top-level that is `vdev_mirror_io_start` again (same line 689); for RAID-Z, `vdev_raidz_io_start` builds the map with `vdev_raidz_map_alloc` [`vdev_raidz.c#L2714`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2714) and calls `vdev_raidz_io_start_write` [`vdev_raidz.c#L2723`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2723), which computes parity `vdev_raidz_generate_parity_row` [`vdev_raidz.c#L2443`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2443) and issues one child per column [`vdev_raidz.c#L2459`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2459).
25. At a leaf, `zio_vdev_io_start` first queues the I/O: `vdev_queue_io(zio)` [`zio.c#L4811`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4811), then calls the leaf's `vdev_op_io_start` (line 4831), which is `vdev_disk_io_start` on Linux [`vdev_disk.c#L1350`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L1350). It calls `vdev_disk_io_rw` [`vdev_disk.c#L1246`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L1246) -> `vbio_submit` [`vdev_disk.c#L1025`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L1025) -> `vdev_submit_bio` [`vdev_disk.c#L840`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L840) -> the kernel's `submit_bio` [`vdev_disk.c#L652`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L652).

Committing the txg (still in `spa_sync`):

26. After all datasets, `dsl_pool_sync_mos` writes the MOS with `dmu_objset_sync` [`dsl_pool.c#L586`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L586) and records its root block pointer for the uberblock: `spa_set_rootblkptr` [`dsl_pool.c#L593`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L593).
27. `spa_sync` calls `spa_sync_rewrite_vdev_config` [`spa.c#L10958`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10958), which calls `vdev_config_sync` [`spa.c#L10815`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10815) (on a selected subset of top-level vdevs; on all children at [`spa.c#L10817`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10817) when the config is dirty). (2.4.4 has this intermediate function between `spa_sync` and `vdev_config_sync`.)
28. `vdev_config_sync` fills the new uberblock with `uberblock_update` [`vdev_label.c#L2072`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2072), flushes disk caches [`vdev_label.c#L2096`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2096), writes the even labels L0/L2 [`vdev_label.c#L2109`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2109), then the uberblocks with `vdev_uberblock_sync_list` [`vdev_label.c#L2133`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2133), then the odd labels L1/L3 [`vdev_label.c#L2154`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2154).
29. `vdev_uberblock_sync` picks the ring slot `n = (ub_txg - ...) % (VDEV_UBERBLOCK_COUNT(vd) - m)` [`vdev_label.c#L1783`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1783) and writes it into each of the `VDEV_LABELS` (4, [`vdev_impl.h#L562`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L562)) labels with `vdev_label_write` [`vdev_label.c#L1793`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1793). Once one new uberblock is on disk, the txg is committed.

### Who calls whom: one read

A buffered `read(2)` on Linux, block not in the ARC.

1. `zpl_iter_read` calls `zfs_read` [`zpl_file.c#L228`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zpl_file.c#L228).
2. `zfs_read` (unless the range is mmap-cached, then `mappedread`) calls `dmu_read_uio_dbuf` [`zfs_vnops.c#L463`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L463) -> `dmu_read_uio_dnode` [`dmu.c#L1495`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1495) (Direct I/O diverts to `dmu_read_uio_direct` [`dmu.c#L1439`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1439)) -> `dmu_buf_hold_array_by_dnode(..., TRUE, ...)` [`dmu.c#L1446`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1446).
3. `dmu_buf_hold_array_by_dnode` holds each dbuf (`dbuf_hold` [`dmu.c#L551`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L551)) and starts all reads in parallel under one root zio: `dbuf_read(db, zio, dbuf_flags)` [`dmu.c#L581`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L581), then `zio_wait` [`dmu.c#L607`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L607).
4. `dbuf_read` calls `dbuf_read_impl` [`dbuf.c#L1865`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L1865), which calls `arc_read` with the block pointer [`dbuf.c#L1671`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L1671).
5. On an ARC miss, `arc_read` calls `zio_read(..., arc_read_done, ...)` [`arc.c#L6422`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L6422); `zio_read` selects `ZIO_READ_PIPELINE` [`zio.c#L1342`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1342): READ_BP_INIT, READY, VDEV_IO_START, VDEV_IO_DONE, VDEV_IO_ASSESS, CHECKSUM_VERIFY, DONE.
6. VDEV_IO_START on the logical zio again goes through `vdev_mirror_ops` [`zio.c#L4697`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4697); for a read `vdev_mirror_io_start` picks one child with `vdev_mirror_child_select` [`vdev_mirror.c#L659`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L659) and issues it [`vdev_mirror.c#L689`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L689). Down the tree, the leaf path is the same as for writes: `vdev_queue_io` (`zio.c` L4811) and `vdev_disk_io_start` (`vdev_disk.c` L1246).
7. Checksum verification is pushed down: when `zio_vdev_child_io` creates a read child that carries the bp, it moves the CHECKSUM_VERIFY stage from the parent to the child [`zio.c#L1638`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1638) ("This pushes error detection as close to the leaves as possible"). In that child, `zio_checksum_verify` calls `zio_checksum_error` [`zio.c#L5272`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5272) -> `zio_checksum_error_impl` [`zio_checksum.c#L560`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L560), which recomputes the checksum with `ci->ci_func[byteswap]` [`zio_checksum.c#L491`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L491) and compares it with the one in the block pointer. On `ECKSUM` the mirror's done path can retry another copy (not traced here).
8. On completion `arc_read_done` fills the ARC header, the dbuf becomes cached, and `dmu_read_uio_dnode` copies from `db_data` into the user's buffer.

### Excerpts

#### 1. `enum zio_stage` — include/sys/zio_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L128-L166

```c
enum zio_stage {
	ZIO_STAGE_OPEN			= 1 << 0,	/* RWFCXT */

	ZIO_STAGE_READ_BP_INIT		= 1 << 1,	/* R----- */
	ZIO_STAGE_WRITE_BP_INIT		= 1 << 2,	/* -W---- */
	ZIO_STAGE_FREE_BP_INIT		= 1 << 3,	/* --F--- */
	ZIO_STAGE_ISSUE_ASYNC		= 1 << 4,	/* -WF--T */
	ZIO_STAGE_WRITE_COMPRESS	= 1 << 5,	/* -W---- */

	ZIO_STAGE_ENCRYPT		= 1 << 6,	/* -W---- */
	ZIO_STAGE_CHECKSUM_GENERATE	= 1 << 7,	/* -W---- */

	ZIO_STAGE_NOP_WRITE		= 1 << 8,	/* -W---- */

	ZIO_STAGE_DDT_READ_START	= 1 << 9,	/* R----- */
	ZIO_STAGE_DDT_READ_DONE		= 1 << 10,	/* R----- */
	ZIO_STAGE_DDT_WRITE		= 1 << 11,	/* -W---- */
	ZIO_STAGE_DDT_FREE		= 1 << 12,	/* --F--- */

	ZIO_STAGE_BRT_FREE		= 1 << 13,	/* --F--- */

	ZIO_STAGE_GANG_ASSEMBLE		= 1 << 14,	/* RWFC-- */
	ZIO_STAGE_GANG_ISSUE		= 1 << 15,	/* RWFC-- */

	ZIO_STAGE_DVA_THROTTLE		= 1 << 16,	/* -W---- */
	ZIO_STAGE_DVA_ALLOCATE		= 1 << 17,	/* -W---- */
	ZIO_STAGE_DVA_FREE		= 1 << 18,	/* --F--- */
	ZIO_STAGE_DVA_CLAIM		= 1 << 19,	/* ---C-- */

	ZIO_STAGE_READY			= 1 << 20,	/* RWFCXT */

	ZIO_STAGE_VDEV_IO_START		= 1 << 21,	/* RW--XT */
	ZIO_STAGE_VDEV_IO_DONE		= 1 << 22,	/* RW--XT */
	ZIO_STAGE_VDEV_IO_ASSESS	= 1 << 23,	/* RW--XT */

	ZIO_STAGE_CHECKSUM_VERIFY	= 1 << 24,	/* R----- */
	ZIO_STAGE_DIO_CHECKSUM_VERIFY	= 1 << 25,	/* -W---- */

	ZIO_STAGE_DONE			= 1 << 26	/* RWFCXT */
```

L129-L166: the pipeline is a bitmask, one bit per stage, in execution order. The comment column says which zio types use the stage (R read, W write, F free, C claim, X flush, T trim). L153: DVA_ALLOCATE (where `metaslab_alloc` is called) is write-only. L157 READY sits between allocation and the vdev stages; `zio_ready` (zio.c L5413) waits for logical, gang and DDT children before notifying its parents. L159-L161: the three stages that actually touch a vdev. L163: CHECKSUM_VERIFY is read-only and comes after the I/O. `__zio_execute` shifts `stage <<= 1` until it finds a bit present in `io_pipeline` ([`zio.c#L2452`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2452)) and indexes `zio_pipeline[]` with `highbit64(stage) - 1`; that table ([`zio.c#L5929-L5956`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5929-L5956)) lists a NULL slot for OPEN followed by the 26 stage functions (`zio_read_bp_init` ... `zio_done`), in the same order as this enum.

#### 2. `ZIO_WRITE_PIPELINE` — include/sys/zio_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L209-L230

```c
#define	ZIO_WRITE_COMMON_STAGES			\
	(ZIO_INTERLOCK_STAGES |			\
	ZIO_VDEV_IO_STAGES |			\
	ZIO_STAGE_ISSUE_ASYNC |			\
	ZIO_STAGE_CHECKSUM_GENERATE)

#define	ZIO_WRITE_PHYS_PIPELINE			\
	ZIO_WRITE_COMMON_STAGES

#define	ZIO_REWRITE_PIPELINE			\
	(ZIO_WRITE_COMMON_STAGES |		\
	ZIO_STAGE_WRITE_COMPRESS |		\
	ZIO_STAGE_ENCRYPT |			\
	ZIO_STAGE_WRITE_BP_INIT)

#define	ZIO_WRITE_PIPELINE			\
	(ZIO_WRITE_COMMON_STAGES |		\
	ZIO_STAGE_WRITE_BP_INIT |		\
	ZIO_STAGE_WRITE_COMPRESS |		\
	ZIO_STAGE_ENCRYPT |			\
	ZIO_STAGE_DVA_THROTTLE |		\
	ZIO_STAGE_DVA_ALLOCATE)
```

L209-L213: every write gets the interlock stages (READY, DONE), the three vdev stages, ISSUE_ASYNC and CHECKSUM_GENERATE. L224-L230: a normal write (the one `zio_write` assigns at [`zio.c#L1357`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1357)) adds bp initialisation, compression, encryption, and the two allocation stages. L218-L222: a rewrite of an already allocated block omits DVA_THROTTLE and DVA_ALLOCATE. For comparison, `ZIO_READ_PIPELINE` ([`zio_impl.h#L196-L198`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L196-L198)) is `ZIO_READ_COMMON_STAGES | ZIO_STAGE_READ_BP_INIT`, and the common read stages include `ZIO_STAGE_CHECKSUM_VERIFY` ([`zio_impl.h#L188-L191`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L188-L191)).

## Key structures

### `blkptr_t`

Defined in [`include/sys/spa.h#L374-L382`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L374-L382) (with `dva_t` at [`include/sys/spa.h#L110-L112`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L110-L112)). The 128-byte pointer that links every block to its parent: the copy-on-write tree room, the checksum/self-healing room (the checksum lives in the parent, not next to the data), and the snapshot room (birth txg) all read it.

| Field | Line | Meaning for the museum |
|---|---|---|
| `dva_word[2]` (`dva_t`) | [L111](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L111) | A 128-bit Data Virtual Address, "opaque outside the SPA". Word 0 holds vdev id (24 bits, `SPA_VDEVBITS`) and ASIZE; word 1 holds the gang bit and the offset in 512-byte units. This is "where the block lives". |
| `blk_dva[SPA_DVAS_PER_BP]` | [L375](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L375) | Up to 3 DVAs ([L362](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L362)): the `copies=` / ditto copies. A failed checksum on one DVA can be repaired from another. |
| `blk_prop` | [L376](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L376) | Word 6: LSIZE, PSIZE, compression, embedded bit E, checksum function, DMU type, level, and the B/D/X bits (byteorder, dedup, encryption). |
| `blk_prop2` | [L377](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L377) | Word 7, "additional properties": bit 63 is the R (rewrite) bit read by `BP_GET_REWRITE` ([L540-L541](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L540-L541)). |
| `blk_pad` | [L378](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L378) | Word 8, "extra space for the future"; the diagram shows it as padding. |
| `blk_birth_word[2]` | [L379](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L379) | Words 9 and a: `[0]` physical birth txg (raw value zero if equal to logical), `[1]` logical birth txg ([L494-L498](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L494-L498)). Birth txg is what makes snapshots and incremental send cheap: a block is newer than a snapshot iff it was born after it. |
| `blk_fill` | [L380](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L380) | Word b: number of non-zero blocks under this bp; for encrypted bps the upper 32 bits carry IV2. |
| `blk_cksum` | [L381](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L381) | Words c-f: 256-bit checksum of the child (`zio_cksum_t` = `zc_word[4]`, [L40](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa_checksum.h#L40)). Stored in the parent, so a block can never vouch for itself. |

**On-disk 128-byte layout.** The big comment at [`spa.h#L123-L186`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L123-L186) draws the blkptr as 16 64-bit words (`SPA_BLKPTRSHIFT` 7 = 128 bytes, [L361](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L361)):

- Words 0-5: three DVAs, two words each. The even word is `pad | vdev | pad | ASIZE`, the odd word is `G | offset` (G = gang block indicator).
- Word 6: `B D X | lvl | type | cksum | E | comp | PSIZE | LSIZE`, i.e. `blk_prop`.
- Word 7: `R | padding` (`blk_prop2`); word 8: padding (`blk_pad`).
- Word 9: physical birth txg; word a: logical birth txg; word b: fill count.
- Words c-f: `checksum[0..3]`.
- Variants: for encrypted bps ([L188-L263](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L188-L263)) DVA 3 is replaced by salt and IV1, IV2 goes into the top of the fill word and words e-f become the MAC, so encrypted blocks have at most 2 copies and a 128-bit checksum. For embedded bps ([L265-L323](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L265-L323)) everything except word 6 and the logical birth word is payload (`BPE_NUM_WORDS` 14, i.e. 112 bytes, [L356](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L356)).

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L361-L382

```c
#define	SPA_BLKPTRSHIFT	7		/* blkptr_t is 128 bytes	*/
#define	SPA_DVAS_PER_BP	3		/* Number of DVAs in a bp	*/
#define	SPA_SYNC_MIN_VDEVS 3		/* min vdevs to update during sync */

/*
 * A block is a hole when it has either 1) never been written to, or
 * 2) is zero-filled. In both cases, ZFS can return all zeroes for all reads
 * without physically allocating disk space. Holes are represented in the
 * blkptr_t structure by zeroed blk_dva. Correct checking for holes is
 * done through the BP_IS_HOLE macro. For holes, the logical size, level,
 * DMU object type, and birth times are all also stored for holes that
 * were written to at some point (i.e. were punched after having been filled).
 */
typedef struct blkptr {
	dva_t		blk_dva[SPA_DVAS_PER_BP]; /* Data Virtual Addresses */
	uint64_t	blk_prop;	/* size, compression, type, etc	    */
	uint64_t	blk_prop2;	/* additional properties	    */
	uint64_t	blk_pad;	/* Extra space for the future	    */
	uint64_t	blk_birth_word[2];
	uint64_t	blk_fill;	/* fill count			    */
	zio_cksum_t	blk_cksum;	/* 256-bit checksum		    */
} blkptr_t;
```

L361-L362: a blkptr is 2^7 = 128 bytes and holds 3 DVAs. L365-L373: a hole is a bp with zeroed `blk_dva`. L374-L382: the struct is exactly the 16 words of the diagram: 6 words of DVAs, `blk_prop`, `blk_prop2`, `blk_pad`, 2 birth words, `blk_fill`, 4 checksum words.

### `dnode_phys_t`

Defined in [`include/sys/dnode.h#L213-L273`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L213-L273). The on-disk object descriptor (a 512-byte slot, `DNODE_SHIFT` 9, [L63](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L63)): the root of each object's block tree, used in the object/indirect-tree room.

| Field | Line | Meaning for the museum |
|---|---|---|
| `dn_type` | [L214](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L214) | `dmu_object_type_t`: file data, directory ZAP, space map, etc. |
| `dn_indblkshift` | [L215](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L215) | log2 of the indirect block size: how many blkptrs fan out per indirect block. |
| `dn_nlevels` | [L216](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L216) | Height of the tree; 1 means `dn_blkptr` points directly at data blocks. |
| `dn_nblkptr` | [L217](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L217) | How many root blkptrs this dnode uses (1 to 3 in a 512-byte dnode). |
| `dn_bonustype` | [L218](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L218) | Type of the bonus buffer contents (e.g. file attributes). |
| `dn_checksum` / `dn_compress` | [L219](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L219) | Checksum (L219) and compression (L220) algorithm for this object's blocks. |
| `dn_datablkszsec` | [L222](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L222) | Data block size in 512-byte sectors (the per-object recordsize). |
| `dn_bonuslen` | [L223](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L223) | Length of the bonus area. |
| `dn_extra_slots` | [L224](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L224) | Number of following 512-byte slots consumed (large dnodes). |
| `dn_maxblkid` | [L228](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L228) | Largest allocated block id: the logical length of the object in blocks. |
| `dn_used` | [L229](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L229) | Disk space consumed (bytes or sectors). |
| `dn_blkptr[]` | [L257](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L257) | The root block pointers of the object tree, union-overlaid with bonus and spill ([diagram L240-L255](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L240-L255)): 3 bps, or 1 bp + 320-byte bonus, or 1 bp + 192-byte bonus + spill. |
| `dn_bonus[]` | [L260](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L260) | Bonus buffer right after `dn_blkptr[0]`. |
| `dn_spill` | [L266](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L266) | Spill blkptr at the end of the tail, for overflow attributes. |

### `uberblock_t`

Defined in [`include/sys/uberblock_impl.h#L122-L185`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L185) (typedef `uberblock_t` at [L41](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock.h#L41)). The root of the whole pool: the "consistency without fsck" / transaction-group room, where the atomic switch to a new uberblock is the commit.

| Field | Line | Meaning for the museum |
|---|---|---|
| `ub_magic` | [L123](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L123) | `UBERBLOCK_MAGIC` 0x00bab10c "oo-ba-bloc!" ([L46](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L46)); must stay the first word. |
| `ub_version` | [L124](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L124) | `SPA_VERSION` of the on-disk format; must stay second so mismatches are detected. |
| `ub_txg` | [L125](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L125) | Txg of the last sync. On import the highest valid txg wins: this is how ZFS "knows" the latest state. |
| `ub_guid_sum` | [L126](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L126) | Sum of all vdev guids: detects a missing device. |
| `ub_timestamp` | [L127](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L127) | UTC time of the last sync. |
| `ub_rootbp` | [L128](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L128) | blkptr to the MOS `objset_phys_t`: the top of the entire Merkle tree. |
| `ub_software_version` | [L131](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L131) | Highest SPA version supported by the writer. |
| `ub_mmp_magic` | [L134](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L134) | `MMP_MAGIC` 0xa11cea11 ([L48](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L48)) for multihost protection. |
| `ub_mmp_delay` | [L139](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L139) | Nanoseconds since the last MMP write; 0 means MMP is off. |
| `ub_mmp_config` | [L159](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L159) | Packed write interval, sequence and fail intervals with valid bits. |
| `ub_checkpoint_txg` | [L182](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L182) | Non-zero if this uberblock is a pool checkpoint. |
| `ub_raidz_reflow_info` | [L184](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L184) | RAIDZ expansion progress: scratch state and reflow offset ([layout L89-L97](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L89-L97)). |

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L159

```c
struct uberblock {
	uint64_t	ub_magic;	/* UBERBLOCK_MAGIC		*/
	uint64_t	ub_version;	/* SPA_VERSION			*/
	uint64_t	ub_txg;		/* txg of last sync		*/
	uint64_t	ub_guid_sum;	/* sum of all vdev guids	*/
	uint64_t	ub_timestamp;	/* UTC time of last sync	*/
	blkptr_t	ub_rootbp;	/* MOS objset_phys_t		*/

	/* highest SPA_VERSION supported by software that wrote this txg */
	uint64_t	ub_software_version;

	/* Maybe missing in uberblocks we read, but always written */
	uint64_t	ub_mmp_magic;	/* MMP_MAGIC			*/
	/*
	 * If ub_mmp_delay == 0 and ub_mmp_magic is valid, MMP is off.
	 * Otherwise, nanosec since last MMP write.
	 */
	uint64_t	ub_mmp_delay;

	/*
	 * The ub_mmp_config contains the multihost write interval, multihost
	 * fail intervals, sequence number for sub-second granularity, and
	 * valid bit mask.  This layout is as follows:
	 *
	 *   64      56      48      40      32      24      16      8       0
	 *   +-------+-------+-------+-------+-------+-------+-------+-------+
	 * 0 | Fail Intervals|      Seq      |   Write Interval (ms) | VALID |
	 *   +-------+-------+-------+-------+-------+-------+-------+-------+
	 *
	 * This allows a write_interval of (2^24/1000)s, over 4.5 hours
	 *
	 * VALID Bits:
	 * - 0x01 - Write Interval (ms)
	 * - 0x02 - Sequence number exists
	 * - 0x04 - Fail Intervals
	 * - 0xf8 - Reserved
	 */
	uint64_t	ub_mmp_config;
```

L123-L128: the core six fields; the only pointer is `ub_rootbp` (L128), so writing one uberblock atomically publishes a whole new tree. L131-L159: later additions (software version, multihost). The struct continues with `ub_checkpoint_txg` (L182) and `ub_raidz_reflow_info` (L184).

### `vdev_label_t` / `vdev_phys_t`

Defined in [`include/sys/vdev_impl.h#L535-L540`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L535-L540) (`vdev_phys_t` at [L501-L504](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L501-L504)). The 256 KiB label written 4 times per leaf device; holds the config nvlist and the uberblock ring. Used by the uberblock ring / import room.

| Field | Line | Meaning for the museum |
|---|---|---|
| `vp_nvlist` | [L502](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L502) | Packed config nvlist, `VDEV_PHYS_SIZE` (112 KiB, [L481](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L481)) minus the checksum trailer. Describes the pool and vdev tree. |
| `vp_zbt` | [L503](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L503) | `zio_eck_t` embedded checksum trailer: the label checksums itself since it has no parent bp. |
| `vl_pad1` | [L536](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L536) | 8 KiB padding (`VDEV_PAD_SIZE`, [L478](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L478)), left for disk labels/boot blocks. |
| `vl_be` | [L537](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L537) | 8 KiB boot environment block (`vdev_boot_envblock_t`, used for GRUB env). |
| `vl_vdev_phys` | [L538](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L538) | The 112 KiB `vdev_phys_t` above. |
| `vl_uberblock` | [L539](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L539) | The 128 KiB uberblock ring (`VDEV_UBERBLOCK_RING`, [L482](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L482)). |

**Layout and sizes.** One label = 8K + 8K + 112K + 128K = 256K ([L540](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L540)). There are `VDEV_LABELS` = 4 ([L562](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L562)): two at the start, followed by a 3.5 MiB boot region (`VDEV_BOOT_SIZE`, [L555](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L555); the first two labels plus boot area total 4 MiB), and two at the end (`VDEV_LABEL_START_SIZE` / `VDEV_LABEL_END_SIZE`, [L560-L561](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L560-L561)). Uberblock slot size is `MIN(MAX(ashift, UBERBLOCK_SHIFT), MAX_UBERBLOCK_SHIFT)` ([L491-L494](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L491-L494)), with `UBERBLOCK_SHIFT` 10 ([L47](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L47)) and max 13; slot count is ring >> shift ([L495-L496](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L495-L496)): 128 slots of 1 KiB at ashift 9 or 10, 32 slots of 4 KiB at ashift 12. With MMP enabled the last slot (`MMP_BLOCKS_PER_LABEL` 1, [L488](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L488)) is reserved for MMP.

### `dsl_dataset_t` / `dsl_dataset_phys_t`

Defined in [`include/sys/dsl_dataset.h#L174-L271`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L174-L271) (on-disk `dsl_dataset_phys_t` at [L140-L172](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L140-L172)). A filesystem, snapshot or clone; the snapshot/clone room uses the prev/next snapshot chain, the deadlist and `ds_bp`.

| Field | Line | Meaning for the museum |
|---|---|---|
| `ds_dir_obj` | [L141](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L141) | phys: the `dsl_dir` this dataset belongs to. |
| `ds_prev_snap_obj` | [L142](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L142) | phys: previous snapshot; the snapshot chain is a linked list. |
| `ds_prev_snap_txg` | [L143](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L143) | phys: txg of the previous snapshot; blocks born after it belong only to this dataset. |
| `ds_next_snap_obj` | [L144](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L144) | phys: next snapshot in the chain. |
| `ds_num_children` | [L146](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L146) | phys: clone/snap children; 0 for a head. |
| `ds_creation_txg` | [L148](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L148) | phys: txg in which the dataset was created. |
| `ds_deadlist_obj` | [L149](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L149) | phys: blocks freed by this dataset but still referenced by the previous snapshot. |
| `ds_referenced_bytes` | [L155](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L155) | phys: all blocks referenced, including shared ones. |
| `ds_unique_bytes` | [L158](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L158) | phys: space only this snapshot holds (what destroying it would free). |
| `ds_guid` | [L165](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L165) | phys: 64-bit id that never changes (used by send/receive). |
| `ds_bp` | [L167](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L167) | phys: blkptr to the dataset's objset; a snapshot is just a frozen copy of this pointer. |
| `ds_dbuf` | [L180](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L180) | in-core: the dbuf holding the phys struct (`dsl_dataset_phys()` returns its data, [L273-L277](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L273-L277)). |
| `ds_is_snapshot` | [L183](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L183) | in-core: snapshot or head. |
| `ds_prev` | [L187](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L187) | in-core: held previous snapshot, syncing context only. |
| `ds_deadlist` | [L192](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L192) | in-core handle on the deadlist object. |

### `arc_buf_hdr_t`

Defined in [`include/sys/arc_impl.h#L472-L520`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L472-L520) (typedef at [L77](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc.h#L77); `l1arc_buf_hdr_t` at [L162-L186](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L162-L186), `l2arc_buf_hdr_t` at [L456-L463](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L456-L463)). The cache header for one block, keyed by its DVA and birth; used in the ARC (MRU/MFU and ghost lists) room. The comment at [L131-L161](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L131-L161) explains the L1/L2 split as a memory saving measure.

| Field | Line | Meaning for the museum |
|---|---|---|
| `b_dva` | [L474](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L474) | Block identity part 1: the DVA copied from the blkptr. |
| `b_birth` | [L475](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L475) | Identity part 2: birth txg (set from `BP_GET_PHYSICAL_BIRTH`); `buf_hash(spa, dva, birth)` hashes these. |
| `b_type` | [L477](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L477) | Data or metadata buffer. |
| `b_hash_next` | [L481](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L481) | Chain in the ARC hash table. |
| `b_flags` | [L482](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L482) | `arc_flags_t`: compressed, encrypted, L2 eligible, has L1/L2 header, etc. |
| `b_psize` | [L501](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L501) | Compressed size in 512-byte units; the ARC keeps blocks compressed. |
| `b_lsize` | [L508](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L508) | Logical size, immutable. |
| `b_spa` | [L509](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L509) | Pool identity, third part of the hash key. |
| `b_l2hdr` | [L512](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L512) | L2ARC part, undefined when not in L2ARC. |
| `b_l1hdr` | [L514](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L514) | L1ARC part, undefined in `l2arc_only` state (the header is reallocated smaller). |
| l1: `b_state` | [L164](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L164) | Which ARC state: MRU, MFU, their ghosts, etc. The animation's "which list am I on". |
| l1: `b_arc_access` | [L168](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L168) | Time of last access, drives MRU to MFU promotion. |
| l1: `b_mru_hits` .. `b_mfu_ghost_hits` | [L169](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L169) | Hit counters per list (L169-L172), including ghost hits that adapt the MRU/MFU balance. |
| l1: `b_refcnt` / `b_pabd` | [L177](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L177) | Reference count (L177) and the physical data ABD (L180). |
| l2: `b_dev` / `b_daddr` | [L458](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L458) | L2ARC device (L458) and byte offset on it (L459). |

### `space_map_t` / `space_map_phys_t`

Defined in [`include/sys/space_map.h#L93-L102`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L93-L102) (on-disk `space_map_phys_t` at [L58-L83](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L58-L83)). An append-only log of alloc/free records for a region; used in the free-space / metaslab room.

| Field | Line | Meaning for the museum |
|---|---|---|
| `smp_object` | [L60](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L60) | phys: object number, kept only for compatibility. |
| `smp_length` | [L63](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L63) | phys: length of the log in bytes; grows with every txg. |
| `smp_alloc` | [L66](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L66) | phys: net space allocated from the map (signed). |
| `smp_histogram` | [L82](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L82) | phys: 32 buckets ([L48](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L48)) counting free regions by power-of-two size; lets ZFS judge fragmentation without loading the map. |
| `sm_start` / `sm_size` | [L94](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L94) | Region covered (L94-L95). |
| `sm_shift` | [L96](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L96) | Unit shift: offsets and runs are stored in 2^shift units. |
| `sm_object` | [L98](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L98) | DMU object holding the log. |
| `sm_blksz` | [L99](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L99) | Block size of the space map object. |
| `sm_phys` | [L101](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L101) | Pointer to the on-disk header above. |

Entry encoding (comment at [L104-L140](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L104-L140)): one-word entries hold a 47-bit offset, a type bit and a 15-bit run ([L167-L168](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L167-L168)); two-word entries hold a 36-bit run, a 24-bit vdev, a type bit and a 63-bit offset ([L172-L173](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L172-L173)); debug entries record action, sync pass and txg.

### `zil_header_t`

Defined in [`include/sys/zil.h#L63-L71`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L63-L71). The per-dataset intent log header pointing at the chain of log blocks; used in the ZIL / synchronous write and crash-replay room.

| Field | Line | Meaning for the museum |
|---|---|---|
| `zh_claim_txg` | [L64](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L64) | Txg in which log blocks were claimed after a crash; 0 means nothing claimed. |
| `zh_replay_seq` | [L65](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L65) | Highest replayed sequence number, so replay is not repeated. |
| `zh_log` | [L66](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L66) | blkptr to the first log block; each block chains to the next. |
| `zh_claim_blk_seq` | [L67](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L67) | Highest claimed block sequence number. |
| `zh_flags` | [L68](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L68) | `ZIL_REPLAY_NEEDED` 0x1, `ZIL_CLAIM_LR_SEQ_VALID` 0x2 ([L76-L77](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L76-L77)). |
| `zh_claim_lr_seq` | [L69](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L69) | Highest claimed log record sequence number. |
| `zh_pad[3]` | [L70](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L70) | Padding; all fields are 64-bit for portability. |

### `metaslab_t`

Defined in [`include/sys/metaslab_impl.h#L339-L537`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L339-L537) (typedef at [L60](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L60)). One slice of a vdev's space with its in-core range trees and on-disk space map; used in the allocator / deferred-free room. The diagram at [L285-L338](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L285-L338) shows the lifecycle allocatable -> allocating[4] and freeing -> freed -> defer[2] -> allocatable; frees are deferred `TXG_DEFER_SIZE` = 2 txgs ([L49](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L49)) as a safety net for uberblock rollback.

| Field | Line | Meaning for the museum |
|---|---|---|
| `ms_lock` | [L350](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L350) | Main lock coordinating allocs/frees with syncing. |
| `ms_sm` | [L369](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L369) | The on-disk space map of this metaslab. |
| `ms_id` / `ms_start` / `ms_size` | [L370](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L370) | Index (L370), start offset (L371) and size (L372) within the vdev. |
| `ms_fragmentation` | [L373](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L373) | Fragmentation metric. |
| `ms_allocating[TXG_SIZE]` | [L375](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L375) | Per-txg allocation trees (`TXG_SIZE` 4, [L42](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L42)). |
| `ms_allocatable` | [L376](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L376) | In-core free tree, eligible for allocation. |
| `ms_freeing` | [L385](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L385) | Blocks to free in this syncing txg. |
| `ms_freed` | [L387](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L387) | Already freed this syncing txg. |
| `ms_defer[TXG_DEFER_SIZE]` | [L388](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L388) | Deferred frees, not reusable for 2 txgs. |
| `ms_checkpointing` | [L390](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L390) | Frees to add to the pool checkpoint instead. |
| `ms_condensing` | [L402](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L402) | Space map is being rewritten in minimal form. |
| `ms_loaded` | [L414](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L414) | Whether the space map has been read into `ms_allocatable`. |
| `ms_weight` | [L469](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L469) | Weight vs. other metaslabs in the group: how the allocator picks a metaslab. |
| `ms_max_size` | [L487](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L487) | Maximum allocatable segment size. |
| `ms_unflushed_allocs` / `ms_unflushed_frees` | [L521](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L521) | Changes in the log space map not yet flushed to this space map (L521-L522). |

## Room: Hall: the uberblock

**Problem.** A storage pool is millions of blocks scattered over several disks, and after a crash the system must decide, without scanning anything, which of them form the current, consistent state of the pool. Some fixed place on disk has to name the root of everything, and that place has to stay usable even when the last write to it was interrupted.

**The idea in the code.**
- `struct uberblock` in [`include/sys/uberblock_impl.h#L122-L185`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L185): a small record that names one txg (`ub_txg`) and one block pointer to the MOS (`ub_rootbp`).
- `vl_uberblock[VDEV_UBERBLOCK_RING]` in `vdev_label_t`, [`include/sys/vdev_impl.h#L535-L540`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L535-L540): every label carries a 128 KiB ring of uberblock slots.
- `vdev_uberblock_compare` in [`module/zfs/vdev_label.c#L1495-L1528`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1495-L1528): on import, the uberblock with the highest `ub_txg` wins (then `ub_timestamp`, then MMP sequence).

**Excerpts.**

### 1. `struct uberblock` — include/sys/uberblock_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L139

```c
struct uberblock {
	uint64_t	ub_magic;	/* UBERBLOCK_MAGIC		*/
	uint64_t	ub_version;	/* SPA_VERSION			*/
	uint64_t	ub_txg;		/* txg of last sync		*/
	uint64_t	ub_guid_sum;	/* sum of all vdev guids	*/
	uint64_t	ub_timestamp;	/* UTC time of last sync	*/
	blkptr_t	ub_rootbp;	/* MOS objset_phys_t		*/

	/* highest SPA_VERSION supported by software that wrote this txg */
	uint64_t	ub_software_version;

	/* Maybe missing in uberblocks we read, but always written */
	uint64_t	ub_mmp_magic;	/* MMP_MAGIC			*/
	/*
	 * If ub_mmp_delay == 0 and ub_mmp_magic is valid, MMP is off.
	 * Otherwise, nanosec since last MMP write.
	 */
	uint64_t	ub_mmp_delay;
```

L122-L124: the magic number (`UBERBLOCK_MAGIC`, `0x00bab10c`) and version come first; the comment above the struct says these two fields must never move. L125: `ub_txg` is the transaction group this uberblock commits. L127: `ub_timestamp`, the tie-breaker on import. L128: `ub_rootbp` is a full `blkptr_t` to the MOS `objset_phys_t`; everything else in the pool is reachable from this one pointer. L131-L139: later additions (software version, multihost/MMP fields).

### 2. `vdev_uberblock_load_done` — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1536-L1567

```c
static void
vdev_uberblock_load_done(zio_t *zio)
{
	vdev_t *vd = zio->io_vd;
	spa_t *spa = zio->io_spa;
	zio_t *rio = zio->io_private;
	uberblock_t *ub = abd_to_buf(zio->io_abd);
	struct ubl_cbdata *cbp = rio->io_private;

	ASSERT3U(zio->io_size, ==, VDEV_UBERBLOCK_SIZE(vd));

	if (zio->io_error == 0 && uberblock_verify(ub) == 0) {
		mutex_enter(&rio->io_lock);
		if (vdev_uberblock_compare(ub, &cbp->ubl_latest) > 0) {
			cbp->ubl_latest = *ub;
		}
		if (ub->ub_txg <= spa->spa_load_max_txg &&
		    vdev_uberblock_compare(ub, cbp->ubl_ubbest) > 0) {
			/*
			 * Keep track of the vdev in which this uberblock
			 * was found. We will use this information later
			 * to obtain the config nvlist associated with
			 * this uberblock.
			 */
			*cbp->ubl_ubbest = *ub;
			cbp->ubl_vd = vd;
		}
		mutex_exit(&rio->io_lock);
	}

	abd_free(zio->io_abd);
}
```

This callback runs once per uberblock slot read, for every slot of every label of every readable leaf (the loops are in `vdev_uberblock_load_impl`, [`module/zfs/vdev_label.c#L1570-L1588`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1570-L1588)). L1547: a slot counts only if the read succeeded and `uberblock_verify` accepts the magic; the read itself goes through `zio_read_phys` with `ZIO_CHECKSUM_LABEL` ([`module/zfs/vdev_label.c#L197-L200`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L197-L200)), so a torn or garbage slot fails with an I/O error and is skipped. L1549-L1551: track the newest uberblock seen at all. L1552-L1562: track the best one not newer than `spa_load_max_txg` (this is the hook for rewinding to an older txg), and remember which vdev it came from so the matching config can be read from that vdev ([`module/zfs/vdev_label.c#L1647`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1647)).

**Short excerpts for the question-first Hall (v1.4, ALG-205).** The Hall's Source notes show only these lines; the longer excerpts above stay as the analysis.

### 3. `struct uberblock`, the fields the Hall shows — include/sys/uberblock_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L128

```c
struct uberblock {
	uint64_t	ub_magic;	/* UBERBLOCK_MAGIC		*/
	uint64_t	ub_version;	/* SPA_VERSION			*/
	uint64_t	ub_txg;		/* txg of last sync		*/
	uint64_t	ub_guid_sum;	/* sum of all vdev guids	*/
	uint64_t	ub_timestamp;	/* UTC time of last sync	*/
	blkptr_t	ub_rootbp;	/* MOS objset_phys_t		*/
```

L123 `ub_magic` holds `UBERBLOCK_MAGIC`, 0x00bab10c ([L46](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L46)). L125 `ub_txg`, the txg of the last sync, decides which uberblock wins on import. L128 `ub_rootbp`, the block pointer to the MOS, is the root every other block of the pool hangs from. The fields after L128 (software version, MMP, checkpoint, RAID-Z expansion) are left to the longer excerpt above.

### 4. `vdev_uberblock_sync`, the slot of a txg — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1782-L1784

```c
	int m = spa_multihost(vd->vdev_spa) ? MMP_BLOCKS_PER_LABEL : 0;
	int n = (ub->ub_txg - (RRSS_GET_STATE(ub) == RRSS_SCRATCH_VALID)) %
	    (VDEV_UBERBLOCK_COUNT(vd) - m);
```

The slot is the txg modulo the number of slots, `VDEV_UBERBLOCK_COUNT(vd)`, the 128 KiB ring shifted right by the slot size, one sector clamped between 1 KiB and 8 KiB ([`include/sys/vdev_impl.h#L491-L496`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L491-L496)). With `multihost=on`, `m` is `MMP_BLOCKS_PER_LABEL`, 1 ([L488](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L488)), and the ring turns on one slot fewer. The `RRSS_SCRATCH_VALID` term moves an uberblock that carries RAID-Z expansion state back one slot, so it does not overwrite the committed uberblock of the same txg (comment at L1768-L1781). The same slot is then written in each of the four labels (L1792-L1796).

### 5. `vdev_uberblock_load_done`, a valid uberblock and the newest — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1547-L1551

```c
	if (zio->io_error == 0 && uberblock_verify(ub) == 0) {
		mutex_enter(&rio->io_lock);
		if (vdev_uberblock_compare(ub, &cbp->ubl_latest) > 0) {
			cbp->ubl_latest = *ub;
		}
```

Called once per slot read on import. A slot counts only if the read succeeded and `uberblock_verify` finds the magic number, byte-swapping the record first if it was written on a machine of the other byte order (`module/zfs/uberblock.c` L33-L42). A slot whose checksum fails never gets this far: label reads use `ZIO_CHECKSUM_LABEL` (L199), a checksum embedded in the slot itself, so the read returns an error. `vdev_uberblock_compare` ([L1495-L1505](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1495-L1505)) orders uberblocks by `ub_txg`, then `ub_timestamp`, then the MMP sequence number when both carry one (L1506-L1527); the newest valid one is kept in `ubl_latest`.

**What the animation shows.**
- A disk opens to show its four labels; one label opens to show the ring of slots, each holding a small card with a txg number — `vl_uberblock` [`include/sys/vdev_impl.h#L539`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L539) and `VDEV_UBERBLOCK_COUNT` [`include/sys/vdev_impl.h#L495-L496`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L495-L496).
- Import: every slot on every label lights up as it is read — loops in `vdev_uberblock_load_impl` L1577-L1585.
- Cards with bad magic or a failed read fade out — `vdev_uberblock_load_done` L1547.
- The card with the highest txg rises to the top; on a txg tie the timestamp decides — `vdev_uberblock_compare` L1498-L1505.
- From the winning card a single arrow (`ub_rootbp`, L128) leads off-screen into the pool: the doorway to the next room.
- Interaction: the visitor can drag a "max txg" slider (`spa_load_max_txg`, L1552) and watch an older card become the winner.
- Simplified: the MMP sequence tie-breaker (L1507-L1527) and the raidz-reflow consistency check in `vdev_uberblock_load` are not shown.

**Facts for the text**
- The magic number is `0x00bab10c` ("oo-ba-bloc!") — [`include/sys/uberblock_impl.h#L46`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L46).
- The ring is 128 KiB per label (`VDEV_UBERBLOCK_RING (128 << 10)`) — [`include/sys/vdev_impl.h#L482`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L482); a label is 256 KiB in total (8K pad + 8K boot env + 112K config nvlist + 128K ring) — [`include/sys/vdev_impl.h#L535-L540`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L535-L540).
- Slot size is `1 << shift` with shift = ashift clamped to [10, 13] (`UBERBLOCK_SHIFT` 10, `MAX_UBERBLOCK_SHIFT` 13) — [`include/sys/vdev_impl.h#L491-L494`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L491-L494), [`include/sys/uberblock_impl.h#L47`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L47). So the ring holds 128 slots of 1 KiB at ashift 9/10, 64 slots of 2 KiB at ashift 11, 32 slots of 4 KiB at ashift 12, 16 slots of 8 KiB at ashift 13 or more — [`include/sys/vdev_impl.h#L495-L496`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L495-L496).
- With multihost enabled, `MMP_BLOCKS_PER_LABEL` (1) slot at the end of the ring is reserved for MMP writes — [`include/sys/vdev_impl.h#L484-L488`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L484-L488).
- Every leaf has `VDEV_LABELS` = 4 labels, so a pool on N disks holds 4 x N copies of each ring — [`include/sys/vdev_impl.h#L562`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L562).

## Room: The tree and the uberblock

**Problem.** ZFS has no fsck. After a crash, the pool must open in either the old state or the new state of the last transaction group, never a mixture, even though one txg writes thousands of blocks to many disks. The whole change of state therefore has to come down to one small write that either happened or did not, and that write must not be able to destroy the previous state if it is torn.

**The idea in the code.**
- `ub_rootbp` in [`include/sys/uberblock_impl.h#L128`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L128) roots a tree of `blkptr_t`: MOS `objset_phys_t.os_meta_dnode` [`include/sys/dmu_objset.h#L80-L81`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dmu_objset.h#L80-L81) -> dnode `dn_blkptr[]` [`include/sys/dnode.h#L257`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L257) -> `dn_nlevels` of indirect blocks [`include/sys/dnode.h#L216`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L216) -> data.
- `vdev_uberblock_sync` in [`module/zfs/vdev_label.c#L1738-L1799`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1738-L1799): writes the new uberblock into slot `ub_txg % count` of all four labels, never into the slot holding the current one.
- `vdev_config_sync` in [`module/zfs/vdev_label.c#L2040-L2164`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2040-L2164): the ordering flush data, even labels, uberblocks, odd labels.

**Excerpts.**

### 1. `vdev_label_offset` — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L158-L170

```c
/*
 * Basic routines to read and write from a vdev label.
 * Used throughout the rest of this file.
 */
uint64_t
vdev_label_offset(uint64_t psize, int l, uint64_t offset)
{
	ASSERT(offset < sizeof (vdev_label_t));
	ASSERT0(P2PHASE_TYPED(psize, sizeof (vdev_label_t), uint64_t));

	return (offset + l * sizeof (vdev_label_t) + (l < VDEV_LABELS / 2 ?
	    0 : psize - VDEV_LABELS * sizeof (vdev_label_t)));
}
```

L168-L169: labels 0 and 1 (`l < VDEV_LABELS / 2`) sit at the start of the device at `l * sizeof (vdev_label_t)`; labels 2 and 3 are shifted by `psize - VDEV_LABELS * sizeof (vdev_label_t)`, so they occupy the last two 256 KiB of the device. Two front and two back copies survive damage concentrated at either end of the disk. L165-L166: the offset must fall inside one label and the device size must be a multiple of the label size.

### 2. `vdev_uberblock_sync` — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1768-L1797

```c
	/*
	 * We chose a slot based on the txg.  If this uberblock has a special
	 * RAIDZ expansion state, then it is essentially an update of the
	 * current uberblock (it has the same txg).  However, the current
	 * state is committed, so we want to write it to a different slot. If
	 * we overwrote the same slot, and we lose power during the uberblock
	 * write, and the disk does not do single-sector overwrites
	 * atomically (even though it is required to - i.e. we should see
	 * either the old or the new uberblock), then we could lose this
	 * txg's uberblock. Rewinding to the previous txg's uberblock may not
	 * be possible because RAIDZ expansion may have already overwritten
	 * some of the data, so we need the progress indicator in the
	 * uberblock.
	 */
	int m = spa_multihost(vd->vdev_spa) ? MMP_BLOCKS_PER_LABEL : 0;
	int n = (ub->ub_txg - (RRSS_GET_STATE(ub) == RRSS_SCRATCH_VALID)) %
	    (VDEV_UBERBLOCK_COUNT(vd) - m);

	/* Copy the uberblock_t into the ABD */
	abd_t *ub_abd = abd_alloc_for_io(VDEV_UBERBLOCK_SIZE(vd), B_TRUE);
	abd_copy_from_buf(ub_abd, ub, sizeof (uberblock_t));
	abd_zero_off(ub_abd, sizeof (uberblock_t),
	    VDEV_UBERBLOCK_SIZE(vd) - sizeof (uberblock_t));

	for (int l = 0; l < VDEV_LABELS; l++)
		vdev_label_write(zio, vd, l, ub_abd,
		    VDEV_UBERBLOCK_OFFSET(vd, n), VDEV_UBERBLOCK_SIZE(vd),
		    vdev_uberblock_sync_done, good_writes,
		    flags | ZIO_FLAG_DONT_PROPAGATE);

```

L1782-L1784: the slot is `ub_txg % (VDEV_UBERBLOCK_COUNT(vd) - m)`, with `m` = 1 slot reserved for MMP when multihost is on. Consecutive txgs therefore go to consecutive slots, and the uberblock of the previous txg is never overwritten by the next one. The `RRSS_SCRATCH_VALID` term moves a same-txg RAIDZ-expansion update to a different slot for the reason given in the comment (L1768-L1781). L1787-L1790: the uberblock is copied into a slot-sized buffer and the remainder is zeroed. L1792-L1796: the same slot is written in all four labels of this leaf.

### 3. `vdev_config_sync` — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2100-L2139

```c
	/*
	 * Sync out the even labels (L0, L2) for every dirty vdev.  If the
	 * system dies in the middle of this process, that's OK: all of the
	 * even labels that made it to disk will be newer than any uberblock,
	 * and will therefore be considered invalid.  The odd labels (L1, L3),
	 * which have not yet been touched, will still be valid.  We flush
	 * the new labels to disk to ensure that all even-label updates
	 * are committed to stable storage before the uberblock update.
	 */
	if ((error = vdev_label_sync_list(spa, 0, txg, flags)) != 0) {
		if ((flags & ZIO_FLAG_IO_RETRY) != 0) {
			zfs_dbgmsg("vdev_label_sync_list() returned error %d "
			    "for pool '%s' when syncing out the even labels "
			    "of dirty vdevs", error, spa_name(spa));
		}
		goto retry;
	}

	/*
	 * Sync the uberblocks to all vdevs in svd[].
	 * If the system dies in the middle of this step, there are two cases
	 * to consider, and the on-disk state is consistent either way:
	 *
	 * (1)	If none of the new uberblocks made it to disk, then the
	 *	previous uberblock will be the newest, and the odd labels
	 *	(which had not yet been touched) will be valid with respect
	 *	to that uberblock.
	 *
	 * (2)	If one or more new uberblocks made it to disk, then they
	 *	will be the newest, and the even labels (which had all
	 *	been successfully committed) will be valid with respect
	 *	to the new uberblocks.
	 */
	if ((error = vdev_uberblock_sync_list(svd, svdcount, ub, flags)) != 0) {
		if ((flags & ZIO_FLAG_IO_RETRY) != 0) {
			zfs_dbgmsg("vdev_uberblock_sync_list() returned error "
			    "%d for pool '%s'", error, spa_name(spa));
		}
		goto retry;
	}
```

Before this point, every vdev written in this txg has had its write cache flushed ([`module/zfs/vdev_label.c#L2085-L2098`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2085-L2098)), "before any uberblock that references them". L2109: phase 1 writes the config nvlists of the even labels (L0, L2); `vdev_label_sync` writes `l, l + 2` ([`module/zfs/vdev_label.c#L1946-L1952`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1946-L1952)). L2133: phase 2 writes the uberblocks; `vdev_uberblock_sync_list` then flushes them and fails unless at least one write succeeded ([`module/zfs/vdev_label.c#L1826-L1854`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1826-L1854)). Phase 3, the odd labels (L1, L3), follows at [`module/zfs/vdev_label.c#L2144-L2161`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2144-L2161). The comments at L2118-L2132 give the crash argument, case by case.

Why the flip is atomic, from these lines: (a) the tree for txg N is on stable storage before any uberblock for N exists (flush at L2085-L2098); (b) the uberblock for N goes to a slot other than the one holding N-1 (L1783); (c) on import the highest valid `ub_txg` wins and invalid slots are ignored (`vdev_uberblock_load_done` L1547-L1553). A crash before any new uberblock lands leaves N-1 as the winner, with odd labels still matching it; a crash after at least one lands makes N the winner, with even labels already matching it. The only state change is "does a valid uberblock for N exist anywhere"; this is the single atomic write.

### 4. `objset_phys_t` — include/sys/dmu_objset.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dmu_objset.h#L80-L95

```c
typedef struct objset_phys {
	dnode_phys_t os_meta_dnode;
	zil_header_t os_zil_header;
	uint64_t os_type;
	uint64_t os_flags;
	uint8_t os_portable_mac[ZIO_OBJSET_MAC_LEN];
	uint8_t os_local_mac[ZIO_OBJSET_MAC_LEN];
	char os_pad0[OBJSET_PHYS_SIZE_V2 - sizeof (dnode_phys_t)*3 -
	    sizeof (zil_header_t) - sizeof (uint64_t)*2 -
	    2*ZIO_OBJSET_MAC_LEN];
	dnode_phys_t os_userused_dnode;
	dnode_phys_t os_groupused_dnode;
	dnode_phys_t os_projectused_dnode;
	char os_pad1[OBJSET_PHYS_SIZE_V3 - OBJSET_PHYS_SIZE_V2 -
	    sizeof (dnode_phys_t)];
} objset_phys_t;
```

L81: an objset starts with a whole `dnode_phys_t`, the meta-dnode, whose blocks are the blocks of dnodes of the objset: object number *n* is dnode *n* of that object. `ub_rootbp` points to the MOS's `objset_phys_t`, so its `os_meta_dnode.dn_blkptr[]` are the second step of the tree. The meta-dnode is a dnode like any other, with its own `dn_nlevels` of indirect blocks above the dnode blocks. A filesystem's objset hangs from the MOS the same way, one level down: its dataset's `ds_bp` ([`include/sys/dsl_dataset.h#L167`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L167)) is a block pointer to another `objset_phys_t`.

### 5. `dnode_phys_t` — include/sys/dnode.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L213-L229

```c
typedef struct dnode_phys {
	uint8_t dn_type;		/* dmu_object_type_t */
	uint8_t dn_indblkshift;		/* ln2(indirect block size) */
	uint8_t dn_nlevels;		/* 1=dn_blkptr->data blocks */
	uint8_t dn_nblkptr;		/* length of dn_blkptr */
	uint8_t dn_bonustype;		/* type of data in bonus buffer */
	uint8_t	dn_checksum;		/* ZIO_CHECKSUM type */
	uint8_t	dn_compress;		/* ZIO_COMPRESS type */
	uint8_t dn_flags;		/* DNODE_FLAG_* */
	uint16_t dn_datablkszsec;	/* data block size in 512b sectors */
	uint16_t dn_bonuslen;		/* length of dn_bonus */
	uint8_t dn_extra_slots;		/* # of subsequent slots consumed */
	uint8_t dn_pad2[3];

	/* accounting is protected by dn_dirty_mtx */
	uint64_t dn_maxblkid;		/* largest allocated block ID */
	uint64_t dn_used;		/* bytes (or sectors) of disk space */
```

L215: `dn_indblkshift`, the size of an indirect block, at most 128 KiB (`DN_MAX_INDBLKSHIFT` 17, [`include/sys/dnode.h#L71`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L71)); an indirect block of 128 KiB holds 1024 block pointers of 128 bytes. L216: `dn_nlevels`, the height of the object's tree, 1 when `dn_blkptr[]` point at data. L217: how many of the root pointers `dn_blkptr[]` ([`include/sys/dnode.h#L257`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L257)) are used.

### 6. `dbuf_dirty`, the parent — module/zfs/dbuf.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2537-L2554

```c
	if (db->db_level+1 < dn->dn_nlevels) {
		dmu_buf_impl_t *parent = db->db_parent;
		dbuf_dirty_record_t *di;
		int parent_held = FALSE;

		if (db->db_parent == NULL || db->db_parent == dn->dn_dbuf) {
			int epbs = dn->dn_indblkshift - SPA_BLKPTRSHIFT;
			parent = dbuf_hold_level(dn, db->db_level + 1,
			    db->db_blkid >> epbs, FTAG);
			ASSERT(parent != NULL);
			parent_held = TRUE;
		}
		if (drop_struct_rwlock)
			rw_exit(&dn->dn_struct_rwlock);
		ASSERT3U(db->db_level + 1, ==, parent->db_level);
		di = dbuf_dirty(parent, tx);
		if (parent_held)
			dbuf_rele(parent, FTAG);
```

L2537: a block below the top level of its object has a parent indirect block. L2542-L2545: the parent is the block at `db_level + 1` whose number is `db_blkid >> epbs`, with `epbs = dn_indblkshift - SPA_BLKPTRSHIFT` block pointers per indirect block as a power of two (10 for 128 KiB). L2552: dirtying a block dirties its parent, recursively, up to the top level; the top level is held by the dnode, which `dnode_setdirty` marks dirty ([`module/zfs/dbuf.c#L2583`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2583)); the dnode lives in a block of the meta-dnode, which is dirtied the same way, up to the objset. Every dirty block is written to a new place at sync (copy-on-write room, `zio_write_compress`), so one changed leaf gives a new copy of the leaf and of every block on its path to the root.

### 7. `vdev_config_sync`, the flush — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2085-L2098

```c
	/*
	 * Flush the write cache of every disk that's been written to
	 * in this transaction group.  This ensures that all blocks
	 * written in this txg will be committed to stable storage
	 * before any uberblock that references them.
	 */
	zio_t *zio = zio_root(spa, NULL, NULL, flags);

	for (vdev_t *vd =
	    txg_list_head(&spa->spa_vdev_txg_list, TXG_CLEAN(txg)); vd != NULL;
	    vd = txg_list_next(&spa->spa_vdev_txg_list, vd, TXG_CLEAN(txg)))
		zio_flush(zio, vd);

	(void) zio_wait(zio);
```

Beat 1. L2091-L2096: every vdev written in this txg (`spa_vdev_txg_list`) gets a cache flush, and L2098 waits for all of them, before any label or uberblock is written. Without it a disk could make the new uberblock durable before the blocks it points to.

### 8. `vdev_config_sync`, the odd labels — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2144-L2161

```c
	/*
	 * Sync out odd labels for every dirty vdev.  If the system dies
	 * in the middle of this process, the even labels and the new
	 * uberblocks will suffice to open the pool.  The next time
	 * the pool is opened, the first thing we'll do -- before any
	 * user data is modified -- is mark every vdev dirty so that
	 * all labels will be brought up to date.  We flush the new labels
	 * to disk to ensure that all odd-label updates are committed to
	 * stable storage before the next transaction group begins.
	 */
	if ((error = vdev_label_sync_list(spa, 1, txg, flags)) != 0) {
		if ((flags & ZIO_FLAG_IO_RETRY) != 0) {
			zfs_dbgmsg("vdev_label_sync_list() returned error %d "
			    "for pool '%s' when syncing out the odd labels of "
			    "dirty vdevs", error, spa_name(spa));
		}
		goto retry;
	}
```

Beat 4. L2145-L2152: the odd labels L1 and L3 are written last; a crash in the middle leaves the even labels and the new uberblocks, which suffice. L2154: `vdev_label_sync_list(spa, 1, txg, flags)`, the same function as beat 2 with `l = 1`; `vdev_label_sync` writes labels `l` and `l + 2` ([`module/zfs/vdev_label.c#L1946-L1952`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1946-L1952)). Both label phases write only the vdevs on `spa_config_dirty_list` ([`module/zfs/vdev_label.c#L1962-L1984`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1962-L1984)): in a txg where no vdev configuration changed, beats 2 and 4 write nothing, and only the uberblock is new (excerpt 11).

### 9. `vdev_label_read_config`, which label counts — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L832-L863

```c
	for (int l = 0; l < VDEV_LABELS; l++) {
		nvlist_t *label = NULL;

		if (zio_wait(zio[l]) == 0 &&
		    nvlist_unpack(vp[l]->vp_nvlist, sizeof (vp[l]->vp_nvlist),
		    &label, 0) == 0) {
			/*
			 * Auxiliary vdevs won't have txg values in their
			 * labels and newly added vdevs may not have been
			 * completely initialized so just return the
			 * configuration from the first valid label we
			 * encounter.
			 */
			error = nvlist_lookup_uint64(label,
			    ZPOOL_CONFIG_POOL_TXG, &label_txg);
			if ((error || label_txg == 0) && !config) {
				config = label;
				for (l++; l < VDEV_LABELS; l++)
					zio_wait(zio[l]);
				break;
			} else if (label_txg <= txg && label_txg > best_txg) {
				best_txg = label_txg;
				nvlist_free(config);
				config = fnvlist_dup(label);
			}
		}

		if (label != NULL) {
			nvlist_free(label);
			label = NULL;
		}
	}
```

On import, the config is read from the vdev of the winning uberblock with `txg` = that uberblock's `ub_txg` ([`module/zfs/vdev_label.c#L1647`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1647)). L835-L837: a label counts only if its read succeeds (the read checks the label's embedded checksum, `ZIO_CHECKSUM_LABEL`, [`module/zfs/vdev_label.c#L197-L200`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L197-L200)), so a torn label is skipped. L852-L855: among the others, the label with the highest `ZPOOL_CONFIG_POOL_TXG` not above the uberblock's txg wins, the first one met on a tie. This is the line that makes the comment of excerpt 3 true: even labels written for txg N are "newer than any uberblock" when no uberblock of txg N made it, and are passed over for the odd labels.

### 10. `vdev_uberblock_compare` — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1495-L1505

```c
int
vdev_uberblock_compare(const uberblock_t *ub1, const uberblock_t *ub2)
{
	int cmp = TREE_CMP(ub1->ub_txg, ub2->ub_txg);

	if (likely(cmp))
		return (cmp);

	cmp = TREE_CMP(ub1->ub_timestamp, ub2->ub_timestamp);
	if (likely(cmp))
		return (cmp);
```

L1498: the higher `ub_txg` wins. L1503: on equal txg, the later `ub_timestamp`. The rest of the function (L1507-L1527) breaks a remaining tie by MMP sequence number. `vdev_uberblock_load_done` keeps a slot only if it beats the best so far (`> 0`, [`module/zfs/vdev_label.c#L1549-L1553`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1549-L1553)).

### 11. `spa_sync_rewrite_vdev_config` — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10792-L10819

```c
		if (list_is_empty(&spa->spa_config_dirty_list)) {
			vdev_t *svd[SPA_SYNC_MIN_VDEVS] = { NULL };
			int svdcount = 0;
			int children = rvd->vdev_children;
			int c0 = random_in_range(children);

			for (int c = 0; c < children; c++) {
				vdev_t *vd =
				    rvd->vdev_child[(c0 + c) % children];

				/* Stop when revisiting the first vdev */
				if (c > 0 && svd[0] == vd)
					break;

				if (vd->vdev_ms_array == 0 ||
				    vd->vdev_islog ||
				    !vdev_is_concrete(vd))
					continue;

				svd[svdcount++] = vd;
				if (svdcount == SPA_SYNC_MIN_VDEVS)
					break;
			}
			error = vdev_config_sync(svd, svdcount, txg);
		} else {
			error = vdev_config_sync(rvd->vdev_child,
			    rvd->vdev_children, txg);
		}
```

L10792: when no vdev configuration changed in this txg, the uberblock goes to at most `SPA_SYNC_MIN_VDEVS` (3, [`include/sys/spa.h#L363`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L363)) top-level vdevs, starting from a random one, skipping logs and vdevs without metaslabs (L10794-L10813); L10815 syncs those. L10816-L10818: otherwise every top-level vdev gets it. On each one, `vdev_uberblock_sync` reaches every leaf below it ([`module/zfs/vdev_label.c#L1741-L1744`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1741-L1744)), so on a pool of one disk that disk receives every uberblock.

**Short excerpts for the question-first room (v1.4, ALG-185).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 12. `struct uberblock`, the root pointer — include/sys/uberblock_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L122-L128

```c
struct uberblock {
	uint64_t	ub_magic;	/* UBERBLOCK_MAGIC		*/
	uint64_t	ub_version;	/* SPA_VERSION			*/
	uint64_t	ub_txg;		/* txg of last sync		*/
	uint64_t	ub_guid_sum;	/* sum of all vdev guids	*/
	uint64_t	ub_timestamp;	/* UTC time of last sync	*/
	blkptr_t	ub_rootbp;	/* MOS objset_phys_t		*/
```

L125: `ub_txg`, the txg this uberblock commits; the import keeps the valid one with the highest. L127: `ub_timestamp`, the tie-breaker for two uberblocks of the same txg (excerpt 10). L128: `ub_rootbp`, the one block pointer, to the MOS `objset_phys_t`; `dsl_pool_sync_mos` sets it once the MOS is written ([`module/zfs/dsl_pool.c#L593`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L593)).

### 13. `dbuf_dirty`, the parent level by level — module/zfs/dbuf.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2537-L2552

```c
	if (db->db_level+1 < dn->dn_nlevels) {
		dmu_buf_impl_t *parent = db->db_parent;
		dbuf_dirty_record_t *di;
		int parent_held = FALSE;

		if (db->db_parent == NULL || db->db_parent == dn->dn_dbuf) {
			int epbs = dn->dn_indblkshift - SPA_BLKPTRSHIFT;
			parent = dbuf_hold_level(dn, db->db_level + 1,
			    db->db_blkid >> epbs, FTAG);
			ASSERT(parent != NULL);
			parent_held = TRUE;
		}
		if (drop_struct_rwlock)
			rw_exit(&dn->dn_struct_rwlock);
		ASSERT3U(db->db_level + 1, ==, parent->db_level);
		di = dbuf_dirty(parent, tx);
```

Excerpt 6 without its last two lines (the release of the hold). L2537: a block below the top level of its object has a parent indirect block. L2542-L2545: the parent is at level + 1, block `db_blkid >> epbs`. L2552: dirtying the block dirties the parent, recursively; the top level is held by the dnode, which `dbuf_dirty` marks dirty in its own block of dnodes ([`module/zfs/dbuf.c#L2583`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L2583)).

### 14. `zio_write_compress`, children first — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1932-L1939

```c
	/*
	 * If our children haven't all reached the ready stage,
	 * wait for them and then repeat this pipeline stage.
	 */
	if (zio_wait_for_children(zio, ZIO_CHILD_LOGICAL_BIT |
	    ZIO_CHILD_GANG_BIT, ZIO_WAIT_READY)) {
		return (NULL);
	}
```

A block's write I/O is the child of its parent's write I/O: `dbuf_write` takes the parent's pending write as `pio` ([`module/zfs/dbuf.c#L5411`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5411), the dnode's I/O for the top level, [L5420](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5420)). L1936-L1939: the parent's write stops at this stage until every child is ready, that is has its new address and checksum. The ready callback `dbuf_write_ready` copies the child's new block pointer into the parent's buffer ([`module/zfs/dbuf.c#L5083-L5085`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5083-L5085)), so the parent is compressed and checksummed with the new pointers in it. The tree is therefore written bottom up: data, then each level of indirect blocks, then the dnode's block, then the objset. Children reach "ready" before their own I/O to the disk is done; the flush of excerpt 7 is what puts all of them on stable storage before the uberblock.

### 15. `vdev_uberblock_sync`, the slot — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1782-L1784

```c
	int m = spa_multihost(vd->vdev_spa) ? MMP_BLOCKS_PER_LABEL : 0;
	int n = (ub->ub_txg - (RRSS_GET_STATE(ub) == RRSS_SCRATCH_VALID)) %
	    (VDEV_UBERBLOCK_COUNT(vd) - m);
```

Excerpt 2, the slot alone. `n` is `ub_txg` modulo the number of slots (one fewer per label with multihost). Consecutive txgs take consecutive slots, so the new uberblock never lands on the slot of the one the pool is using. The one exception is an uberblock that updates the current txg during a RAID-Z expansion (`RRSS_SCRATCH_VALID`): it takes `ub_txg` − 1, the slot before, for the same reason (the comment at L1768-L1781). The same `n` is written in the four labels of the disk ([`module/zfs/vdev_label.c#L1792-L1796`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1792-L1796)).

### 16. `vdev_config_sync`, the two cases of a cut — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2118-L2131

```c
	/*
	 * Sync the uberblocks to all vdevs in svd[].
	 * If the system dies in the middle of this step, there are two cases
	 * to consider, and the on-disk state is consistent either way:
	 *
	 * (1)	If none of the new uberblocks made it to disk, then the
	 *	previous uberblock will be the newest, and the odd labels
	 *	(which had not yet been touched) will be valid with respect
	 *	to that uberblock.
	 *
	 * (2)	If one or more new uberblocks made it to disk, then they
	 *	will be the newest, and the even labels (which had all
	 *	been successfully committed) will be valid with respect
	 *	to the new uberblocks.
```

Excerpt 3, the comment of beat 3 alone: a cut before any new uberblock lands leaves the previous uberblock and the untouched odd labels; a cut after one lands leaves the new uberblock and the even labels written at beat 2. The figure's import replays both.

### 17. `vdev_uberblock_load_done`, keep the newest valid — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1547-L1553

```c
	if (zio->io_error == 0 && uberblock_verify(ub) == 0) {
		mutex_enter(&rio->io_lock);
		if (vdev_uberblock_compare(ub, &cbp->ubl_latest) > 0) {
			cbp->ubl_latest = *ub;
		}
		if (ub->ub_txg <= spa->spa_load_max_txg &&
		    vdev_uberblock_compare(ub, cbp->ubl_ubbest) > 0) {
```

Called for every slot of every label the import reads. L1547: a slot counts only if its read succeeded, which checks the label checksum of the slot (a torn write fails it), and if `uberblock_verify` accepts it (magic number). L1549-L1551 track the newest valid uberblock seen at all. L1552-L1553: the one the import uses replaces the best so far when `vdev_uberblock_compare` (excerpt 10) ranks it higher, by txg and then timestamp, and only at or below `spa_load_max_txg`, which a rewind lowers (the excerpt stops at the opening of that branch; the full callback is the Hall's excerpt 2).

**What the animation shows.**
- The tree: the uberblock card at the top, one arrow (`ub_rootbp`) to the MOS objset, from its meta-dnode to a dnode, down `dn_nlevels` of indirect blocks to data — [`include/sys/uberblock_impl.h#L128`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/uberblock_impl.h#L128), [`include/sys/dnode.h#L216`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L216), [`include/sys/dnode.h#L257`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dnode.h#L257).
- A write: a leaf changes, and new copies of the leaf and of every ancestor appear beside the old ones (see next room); the old tree stays intact and still hangs from the old uberblock.
- The disk strip: L0 L1 at the left, L2 L3 at the right — `vdev_label_offset` L168-L169.
- Beat 1, "flush": the new tree turns solid — L2085-L2098.
- Beat 2, "even labels": L0 and L2 config blocks update — L2109, L1946.
- Beat 3, "uberblocks": slot `txg % count` in all four rings receives the new card — L1783-L1796; the root arrow now swings from the old tree to the new one.
- Beat 4, "odd labels": L1 and L3 update — L2154.
- Interaction: a "pull the plug" button usable at any beat; on reboot the import of the previous room runs and the visitor sees which tree wins, matching cases (1) and (2) of L2123-L2131.
- Simplified: the config nvlist contents, the retry with `ZIO_FLAG_IO_RETRY`, MMP, and multiple sync passes within one txg are not shown; the tree is drawn with one dataset and very few blocks.

**Facts for the text**
- 4 labels per leaf, 2 at the front and 2 at the back — [`include/sys/vdev_impl.h#L562`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L562), [`module/zfs/vdev_label.c#L168-L169`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L168-L169).
- The front area is 2 labels + a 3.5 MiB boot region = 4 MiB (`VDEV_BOOT_SIZE (7ULL << 19)`) — [`include/sys/vdev_impl.h#L555-L560`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L555-L560).
- Slot index = `ub_txg % (VDEV_UBERBLOCK_COUNT(vd) - m)` — [`module/zfs/vdev_label.c#L1783-L1784`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1783-L1784); with 128 slots, the ring keeps the last 128 txgs' uberblocks (32 at ashift 12).
- The uberblock sync succeeds if at least one uberblock write succeeded (`good_writes >= 1 ? 0 : EIO`) — [`module/zfs/vdev_label.c#L1854`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1854).
- The MOS root pointer is set by `dsl_pool_sync_mos` via `spa_set_rootblkptr` once the MOS is synced — [`module/zfs/dsl_pool.c#L593`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L593).
- A `blkptr_t` is 128 bytes (`SPA_BLKPTRSHIFT 7`) and holds up to 3 DVAs (`SPA_DVAS_PER_BP`) — [`include/sys/spa.h#L361-L362`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L361-L362).

- The vdev configuration is written only in a txg where it changed: both label phases walk `spa_config_dirty_list` (excerpt 8), and with that list empty the uberblock goes to up to three top-level vdevs (excerpt 11). A txg that only changes data rewrites the uberblock, not the labels.
- After an import, the next txg is the winner's `ub_txg` + 1 (`spa_first_txg`, [`module/zfs/spa.c#L4750-L4751`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L4750-L4751)): when the plug was pulled before any uberblock of txg N landed, the pool's next txg is N again, and its uberblock goes to the same slot.
- An import rewrites every label soon after: it asks for a config update (`need_update` for `SPA_LOAD_IMPORT`, [`module/zfs/spa.c#L5721-L5736`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L5721-L5736)), which the async thread runs ([`module/zfs/spa.c#L9757-L9769`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L9757-L9769)) as `spa_config_update(spa, SPA_CONFIG_UPDATE_POOL)`: `vdev_config_dirty` on the root vdev, every top-level vdev, for the txg after the last synced one, then a wait for that txg ([`module/zfs/spa_config.c#L489-L491`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_config.c#L489-L491)). This is the "mark every vdev dirty so that all labels will be brought up to date" of excerpt 8's comment: a torn label is rewritten by the first txg after the import.

**Hand-checked cases** (the unit tests replay them). One disk, `psize` 1 GiB (2^30 bytes, a multiple of the 256 KiB label as `vdev_label_offset` asserts), ashift 9, so 1 KiB slots and 128 per ring, multihost off. Txg 4210 is the last synced; the ring holds the uberblocks of txgs 4083 to 4210, one per slot; the four labels hold a config of txg 4200. The file has `dn_nlevels` 3.

- Slots, `ub_txg % 128`: txg 4210 → 114, 4211 → 115 (the slot of txg 4083, not of 4210), 4223 → 127, 4224 → 0, 4338 → 114. At ashift 12 (32 slots): 4211 → 19.
- Offsets, `vdev_label_offset(2^30, l, off)`: labels start at 0, 262144, 1073217536 and 1073479680. The config (`vl_vdev_phys`, offset 16384) of L0 to L3: 16384, 278528, 1073233920, 1073496064. Slot 115 (`VDEV_UBERBLOCK_OFFSET` = 131072 + 115 × 1024 = 248832): 248832, 510976, 1073466368, 1073728512.
- Ancestors (excerpt 6). With 128 KiB indirect blocks (`epbs` 10), data block 2 has parents L1 block 0 and L2 block 0; data block 5000, L1 block 4 and L2 block 0; data block 1048576 (2^20), L1 block 1024 and L2 block 1. The figure's tree has `epbs` 1 (two pointers per indirect block, to stay small): data block 2 has parents L1 block 1 and L2 block 0, then the meta-dnode's block of dnodes that holds the file's dnode, and the objset: five new blocks; data blocks 0 and 3 in one txg, seven (both L1 blocks, L2, dnode block, objset, two data blocks).
- Txg 4211, config changed, the plug pulled during each beat. The torn write is the one in flight; the label writes of one phase are taken to land in order L0 then L2 (L1 then L3), the four uberblock writes L0, L1, L2, L3.
  - During beat 1 (flush): the new blocks may not be on disk. Winner txg 4210 (slot 114), config L0 (txg 4200). The old tree.
  - During beat 2: L0's config of txg 4211 landed, L2's torn. Winner 4210; L0 (4211 > 4210) is passed over, L2 fails its checksum, L1 (4200) is the first best: config L1. The old tree: case (1) of excerpt 3.
  - During beat 3, no uberblock landed (L0's torn): slot 115 of L0, which held txg 4083, is garbage and skipped; winner 4210 in slot 114 of all four labels; config L1. The old tree: case (1).
  - During beat 3, the uberblock landed in L0 (L1's torn): winner 4211 from slot 115 of L0; config L0 (4211). The new tree: case (2). Same with two or three landed.
  - During beat 4: L1's config landed, L3's torn. Winner 4211 in slot 115 of L0 to L3 (beat 3 was complete); config L0. The new tree.
  - After beat 4: winner 4211, every label at 4211, config L0.
  - Config not changed: beats 2 and 4 write nothing; the labels stay at 4200 and the config is L0's in every case; the winner is the same as above, 4211 as soon as one uberblock of 4211 landed.
- Ties: two valid uberblocks of the same txg, timestamps 1000 and 1001: the second wins (excerpt 10). Never seen in the figure: one disk, one uberblock per txg.

## Room: Copy-on-write, checksums and self-healing

**Problem.** Disks return wrong data without reporting an error: bit rot, misdirected or phantom writes, firmware bugs. A checksum stored next to the data cannot catch a misdirected or lost write, because the stale block carries a checksum that matches it. And a filesystem that overwrites live blocks in place can be left half-old and half-new after a crash.

**The idea in the code.**
- `zio_write_compress` in [`module/zfs/zio.c#L2094-L2105`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2094-L2105): unless the block was already born in this same txg, its bp is zeroed and the write gets a fresh DVA (`zio_dva_allocate` asserts a hole bp, [`module/zfs/zio.c#L4345`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4345)).
- `blk_cksum` in `blkptr_t`, [`include/sys/spa.h#L374-L382`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L374-L382): the 256-bit checksum of a block is stored in the pointer to it, i.e. in its parent.
- `vdev_mirror_io_done` in [`module/zfs/vdev_mirror.c#L713-L936`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L713-L936): on a bad copy, read another child, then rewrite the bad children with the good data.

**Excerpts.**

### 1. `zio_write_compress` — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2086-L2105

```c
	/*
	 * The final pass of spa_sync() must be all rewrites, but the first
	 * few passes offer a trade-off: allocating blocks defers convergence,
	 * but newly allocated blocks are sequential, so they can be written
	 * to disk faster.  Therefore, we allow the first few passes of
	 * spa_sync() to allocate new blocks, but force rewrites after that.
	 * There should only be a handful of blocks after pass 1 in any case.
	 */
	if (!BP_IS_HOLE(bp) && BP_GET_BIRTH(bp) == zio->io_txg &&
	    BP_GET_PSIZE(bp) == psize &&
	    pass >= zfs_sync_pass_rewrite) {
		VERIFY3U(psize, !=, 0);
		enum zio_stage gang_stages = zio->io_pipeline & ZIO_GANG_STAGES;

		zio->io_pipeline = ZIO_REWRITE_PIPELINE | gang_stages;
		zio->io_flags |= ZIO_FLAG_IO_REWRITE;
	} else {
		BP_ZERO(bp);
		zio->io_pipeline = ZIO_WRITE_PIPELINE;
	}
```

L2094-L2101: a bp is rewritten in place only if it is not a hole, was born in the txg being synced (`BP_GET_BIRTH(bp) == zio->io_txg`), keeps the same size, and the sync pass is at least `zfs_sync_pass_rewrite` (2, [`module/zfs/zio.c#L128`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L128)). Such a block is not yet referenced by any committed uberblock, so rewriting it does not touch live data. L2102-L2104: in every other case `BP_ZERO(bp)` and the full `ZIO_WRITE_PIPELINE`, which includes `ZIO_STAGE_DVA_ALLOCATE` ([`include/sys/zio_impl.h#L153`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L153)); `zio_dva_allocate` then asserts the bp is a hole before calling `metaslab_alloc` ([`module/zfs/zio.c#L4345-L4346`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4345-L4346), [`module/zfs/zio.c#L4380-L4382`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4380-L4382)). The old bp is kept in `io_bp_orig`, and when the write completes `dbuf_write_done` calls `dsl_dataset_block_kill` on the old bp and `dsl_dataset_block_born` on the new one ([`module/zfs/dbuf.c#L5152-L5154`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5152-L5154)). The old block is freed only if it was born after the most recent snapshot; otherwise it goes on the dataset's deadlist ([`module/zfs/dsl_dataset.c#L294`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L294), [`module/zfs/dsl_dataset.c#L332-L345`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L332-L345)).

### 2. `zio_checksum_error_impl` — module/zfs/zio_checksum.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L501-L538

```c
	} else {
		byteswap = BP_SHOULD_BYTESWAP(bp);
		expected_cksum = bp->blk_cksum;
		ci->ci_func[byteswap](abd, size,
		    spa->spa_cksum_tmpls[checksum], &actual_cksum);
	}

	/*
	 * MAC checksums are a special case since half of this checksum will
	 * actually be the encryption MAC. This will be verified by the
	 * decryption process, so we just check the truncated checksum now.
	 * Objset blocks use embedded MACs so we don't truncate the checksum
	 * for them.
	 */
	if (bp != NULL && BP_USES_CRYPT(bp) &&
	    BP_GET_TYPE(bp) != DMU_OT_OBJSET) {
		if (!(ci->ci_flags & ZCHECKSUM_FLAG_DEDUP)) {
			actual_cksum.zc_word[0] ^= actual_cksum.zc_word[2];
			actual_cksum.zc_word[1] ^= actual_cksum.zc_word[3];
		}

		actual_cksum.zc_word[2] = 0;
		actual_cksum.zc_word[3] = 0;
		expected_cksum.zc_word[2] = 0;
		expected_cksum.zc_word[3] = 0;
	}

	if (info != NULL) {
		info->zbc_checksum_name = ci->ci_name;
		info->zbc_byteswapped = byteswap;
		info->zbc_injected = 0;
		info->zbc_has_cksum = 1;
	}

	if (!ZIO_CHECKSUM_EQUAL(actual_cksum, expected_cksum))
		return (SET_ERROR(ECKSUM));

	return (0);
```

L502-L505: for ordinary blocks the expected value is `bp->blk_cksum`, taken from the block pointer the reader followed, and the actual value is recomputed over the bytes just read. On write, `zio_checksum_compute` stores the computed value into the same field, `bp->blk_cksum = cksum` ([`module/zfs/zio_checksum.c#L411-L417`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L411-L417)), in stage `ZIO_STAGE_CHECKSUM_GENERATE` ([`include/sys/zio_impl.h#L138`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L138)). L515-L526: for encrypted blocks other than objsets, only 128 of the 256 bits are compared here; the other half is the MAC, which decryption verifies. L535-L536: a mismatch returns `ECKSUM`. For a mirror the check runs in each child read, not in the parent: `zio_vdev_child_io` moves `ZIO_STAGE_CHECKSUM_VERIFY` from parent to child whenever a bp is available ([`module/zfs/zio.c#L1631-L1639`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1631-L1639)).

### 3. `vdev_mirror_io_done` — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L900-L934

```c
			if (mc->mc_error == 0) {
				vdev_ops_t *ops = mc->mc_vd->vdev_ops;

				if (mc->mc_tried)
					continue;
				/*
				 * We didn't try this child.  We need to
				 * repair it if:
				 * 1. it's a scrub (in which case we have
				 * tried everything that was healthy)
				 *  - or -
				 * 2. it's an indirect or distributed spare
				 * vdev (in which case it could point to any
				 * other vdev, which might have a bad DTL)
				 *  - or -
				 * 3. the DTL indicates that this data is
				 * missing from this vdev
				 */
				if (!(zio->io_flags & ZIO_FLAG_SCRUB) &&
				    ops != &vdev_indirect_ops &&
				    ops != &vdev_draid_spare_ops &&
				    !vdev_dtl_contains(mc->mc_vd, DTL_PARTIAL,
				    zio->io_txg, 1))
					continue;
				mc->mc_error = SET_ERROR(ESTALE);
			}

			zio_nowait(zio_vdev_child_io(zio, zio->io_bp,
			    mc->mc_vd, mc->mc_offset,
			    zio->io_abd, zio->io_size, ZIO_TYPE_WRITE,
			    zio->io_priority == ZIO_PRIORITY_REBUILD ?
			    ZIO_PRIORITY_REBUILD : ZIO_PRIORITY_ASYNC_WRITE,
			    ZIO_FLAG_IO_REPAIR | (unexpected_errors ?
			    ZIO_FLAG_SELF_HEAL : 0), NULL, NULL));
		}
```

Earlier in the function, if no child has returned good data yet, `vdev_mirror_child_select` chooses another untried child and a new read is issued ([`module/zfs/vdev_mirror.c#L793-L802`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L793-L802)). Repair runs only with at least one good copy, a writeable pool, and unexpected errors, resilver, or a resilvering scrub ([`module/zfs/vdev_mirror.c#L883-L886`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L883-L886)). L900-L904: children that returned good data are never rewritten (the comment just above explains that rewriting the only good copy during a power loss could lose it). L905-L924: a child that was not tried is repaired only in a scrub, for indirect or dRAID-spare vdevs, or when its DTL says this txg is missing. L927-L933: the good buffer `zio->io_abd` is written to each damaged child as a `ZIO_FLAG_IO_REPAIR` write, flagged `ZIO_FLAG_SELF_HEAL` when the cause was an unexpected error.

**Short excerpts for the question-first room (v1.4, ALG-173).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 4. `blkptr_t`, the pointer that holds the checksum — include/sys/spa.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L374-L382

```c
typedef struct blkptr {
	dva_t		blk_dva[SPA_DVAS_PER_BP]; /* Data Virtual Addresses */
	uint64_t	blk_prop;	/* size, compression, type, etc	    */
	uint64_t	blk_prop2;	/* additional properties	    */
	uint64_t	blk_pad;	/* Extra space for the future	    */
	uint64_t	blk_birth_word[2];
	uint64_t	blk_fill;	/* fill count			    */
	zio_cksum_t	blk_cksum;	/* 256-bit checksum		    */
} blkptr_t;
```

### 5. `zio_write_compress`, overwrite or new address — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2094-L2105

```c
	if (!BP_IS_HOLE(bp) && BP_GET_BIRTH(bp) == zio->io_txg &&
	    BP_GET_PSIZE(bp) == psize &&
	    pass >= zfs_sync_pass_rewrite) {
		VERIFY3U(psize, !=, 0);
		enum zio_stage gang_stages = zio->io_pipeline & ZIO_GANG_STAGES;

		zio->io_pipeline = ZIO_REWRITE_PIPELINE | gang_stages;
		zio->io_flags |= ZIO_FLAG_IO_REWRITE;
	} else {
		BP_ZERO(bp);
		zio->io_pipeline = ZIO_WRITE_PIPELINE;
	}
```

### 6. `zio_checksum_error_impl`, expected and actual — module/zfs/zio_checksum.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L501-L506

```c
	} else {
		byteswap = BP_SHOULD_BYTESWAP(bp);
		expected_cksum = bp->blk_cksum;
		ci->ci_func[byteswap](abd, size,
		    spa->spa_cksum_tmpls[checksum], &actual_cksum);
	}
```

### 7. `vdev_mirror_io_done`, the repair write — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L927-L933

```c
			zio_nowait(zio_vdev_child_io(zio, zio->io_bp,
			    mc->mc_vd, mc->mc_offset,
			    zio->io_abd, zio->io_size, ZIO_TYPE_WRITE,
			    zio->io_priority == ZIO_PRIORITY_REBUILD ?
			    ZIO_PRIORITY_REBUILD : ZIO_PRIORITY_ASYNC_WRITE,
			    ZIO_FLAG_IO_REPAIR | (unexpected_errors ?
			    ZIO_FLAG_SELF_HEAL : 0), NULL, NULL));
```

**What the animation shows.**
- A leaf block is modified: a new block appears at a new address, and the old one stays until the pointer moves — `zio_write_compress` L2102-L2104, `zio_dva_allocate` L4345.
- The parent's pointer is rewritten with the new address and the new checksum, so the parent itself changes and is copied too; the change ripples up to the uberblock — `zio_checksum_compute` L417; the parent is dirtied with the child, `dbuf_dirty(parent, tx)` dbuf.c L2552.
- The old block fades out (freed) or turns grey (kept by a snapshot) — `dsl_dataset_block_kill` L294, L332-L345.
- Read with a mirror: the read goes to one side, the bytes are hashed and compared with the checksum held in the parent's pointer; on mismatch the block flashes red — `zio_checksum_error_impl` L503, L535.
- The other side is read and matches — `vdev_mirror_io_done` L793-L802, `vdev_mirror_child_select`.
- The good bytes are copied back over the bad side, which turns green — L927-L933.
- Interaction: the visitor flips bits on one disk of the mirror (or makes one disk "write to the wrong place") and then reads the file.
- Simplified: sync passes, gang blocks, dedup, nopwrite, encryption MACs, and the load-based child choice in `vdev_mirror_child_select` are not shown; the tree is one file.

**Facts for the text**
- `blk_cksum` is a `zio_cksum_t`, 4 x 64-bit words = 256 bits — [`include/sys/spa.h#L381`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L381), [`include/sys/spa_checksum.h#L39-L41`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa_checksum.h#L39-L41).
- Precise Merkle-tree claim: the checksum of every block is held in the `blkptr_t` that points to it, and that `blkptr_t` lives inside the parent block, which its own parent checksums in turn ([`module/zfs/zio_checksum.c#L503`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L503), [`module/zfs/zio_checksum.c#L417`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L417)). The root `ub_rootbp` has no parent pointer; the uberblock slot is protected instead by an embedded SHA-256 label checksum (`"label"`, `ZCHECKSUM_FLAG_EMBEDDED`) whose verifier is the slot's disk offset — [`module/zfs/zio_checksum.c#L175-L177`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L175-L177), [`module/zfs/zio_checksum.c#L295-L298`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L295-L298). Exceptions to the parent rule in the code: gang headers and ZIL blocks use embedded checksums ([`module/zfs/zio_checksum.c#L386-L393`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L386-L393)), and `checksum=off` exists in the table ([`module/zfs/zio_checksum.c#L173-L174`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L173-L174)).
- A bp holds up to 3 DVAs (`SPA_DVAS_PER_BP`), all covered by one `blk_cksum` — [`include/sys/spa.h#L362`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L362).
- In-place rewrite is allowed only for blocks born in the current txg, from sync pass 2 (`zfs_sync_pass_rewrite = 2`) — [`module/zfs/zio.c#L128`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L128).
- The default checksum is fletcher4: `checksum=on` resolves to `ZIO_CHECKSUM_ON_VALUE`, defined as `ZIO_CHECKSUM_FLETCHER_4` — [`include/sys/zio.h#L119-L120`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio.h#L119-L120). Fletcher4 keeps four 64-bit running sums over the block read as 32-bit words (`a += ip[0]; b += a; c += b; d += c;`), and the four sums are the 256-bit checksum — [`module/zcommon/zfs_fletcher.c#L317-L338`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfs_fletcher.c#L317-L338). The room's demonstration computes this exact function over the demo blocks (slice 1).
- If no child of a mirror returns good data, the read fails with the worst child error instead of returning bytes — [`module/zfs/vdev_mirror.c#L878-L881`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L878-L881).
- The uberblock of txg N goes to slot `N % count` of the ring, so consecutive txgs use consecutive slots and the previous uberblock survives the next commit — [`module/zfs/vdev_label.c#L1782-L1784`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L1782-L1784) (tree room excerpt 2).
- Checksum errors increment `vs_checksum_errors` on the leaf vdev and post an ereport — [`module/zfs/zio.c#L5295-L5300`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5295-L5300) (in `zio_checksum_verify`).
- Not every write that zeroes its bp allocates: right after, a block that compresses to nothing (`psize == 0`) takes `ZIO_INTERLOCK_PIPELINE` and becomes a hole ([`module/zfs/zio.c#L2107-L2115`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2107-L2115)), dedup takes `ZIO_DDT_WRITE_PIPELINE` ([`module/zfs/zio.c#L2126-L2131`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2126-L2131)), and nopwrite adds `ZIO_STAGE_NOP_WRITE` ([`module/zfs/zio.c#L2133-L2136`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2133-L2136)).
- A lost write leaves stale bytes, not the previous version of the block: the new block goes to a fresh extent taken out of the metaslab's free tree ([`module/zfs/metaslab.c#L4877`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4877), after `zio_dva_allocate` asserted a hole bp, [`module/zfs/zio.c#L4345-L4346`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4345-L4346)), so a dropped write leaves whatever an earlier, freed block left there. The old version stays at its old address. Only the checksum in the parent, which describes the new block, tells the two apart.
- ZIL blocks carry embedded checksums: the `zilog` and `zilog2` rows of the checksum table have `ZCHECKSUM_FLAG_EMBEDDED` ([`module/zfs/zio_checksum.c#L181-L182`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L181-L182), [`module/zfs/zio_checksum.c#L190-L191`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L190-L191)), as does `gang_header` ([`module/zfs/zio_checksum.c#L178-L180`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L178-L180)).

## Room: Transaction groups

**Problem.** A file system that updates blocks in place can be caught by a power cut halfway through a multi-block update, leaving metadata that contradicts itself; the classic cure is an fsck pass over the whole disk at boot. ZFS never overwrites live blocks, so it only needs one thing to be atomic: the switch from the old tree to the new one. To make that switch rare and cheap, every change made by every thread is batched into a numbered transaction group (txg) which is written out as a unit and then committed by a single uberblock write.

**The idea in the code.**
- `txg_hold_open` / `txg_rele_to_sync` in [`module/zfs/txg.c#L319`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L319) — a writer joins the open txg by bumping a per-CPU counter, and leaves it by dropping that counter ([`module/zfs/txg.c#L367`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L367)).
- `txg_quiesce` in [`module/zfs/txg.c#L388`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L388) — closes the open txg, opens the next one, and waits until every holder of the old one has left.
- `spa_sync` in [`module/zfs/spa.c#L10838`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10838) — writes the quiesced txg, iterating until the MOS stops changing, then rewrites labels and uberblock via `vdev_config_sync` ([`module/zfs/spa.c#L10815-L10818`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10815-L10818)).

**Excerpts.**

### 1. `txg_quiesce` — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L395-L428

```c
	/*
	 * Grab all tc_open_locks so nobody else can get into this txg.
	 */
	for (c = 0; c < max_ncpus; c++)
		mutex_enter(&tx->tx_cpu[c].tc_open_lock);

	ASSERT(txg == tx->tx_open_txg);
	tx->tx_open_txg++;
	tx->tx_open_time = tx_open_time = gethrtime();

	DTRACE_PROBE2(txg__quiescing, dsl_pool_t *, dp, uint64_t, txg);
	DTRACE_PROBE2(txg__opened, dsl_pool_t *, dp, uint64_t, tx->tx_open_txg);

	/*
	 * Now that we've incremented tx_open_txg, we can let threads
	 * enter the next transaction group.
	 */
	for (c = 0; c < max_ncpus; c++)
		mutex_exit(&tx->tx_cpu[c].tc_open_lock);

	spa_txg_history_set(dp->dp_spa, txg, TXG_STATE_OPEN, tx_open_time);
	spa_txg_history_add(dp->dp_spa, txg + 1, tx_open_time);

	/*
	 * Quiesce the transaction group by waiting for everyone to
	 * call txg_rele_to_sync() for their open transaction handles.
	 */
	for (c = 0; c < max_ncpus; c++) {
		tx_cpu_t *tc = &tx->tx_cpu[c];
		mutex_enter(&tc->tc_lock);
		while (tc->tc_count[g] != 0)
			cv_wait(&tc->tc_cv[g], &tc->tc_lock);
		mutex_exit(&tc->tc_lock);
	}
```

L398-L399: the quiesce thread takes every per-CPU `tc_open_lock`, so no new writer can enter txg `txg`. L402: the open txg number is advanced; from here on `txg_hold_open` hands out `txg + 1`. L412-L413: the locks are released at once, so the next txg is open for business while the old one drains. L422-L428: for each CPU, wait on `tc_cv[g]` until `tc_count[g]` (the number of open handles on that txg, indexed by `txg & TXG_MASK`) reaches zero; `txg_rele_to_sync` broadcasts that condition variable when it drops the last handle (txg.c L374-L375). When the loop exits, the txg is quiesced: no one can add to it any more.

### 2. `txg_sync_thread` — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L583-L610

```c
		/*
		 * Consume the quiesced txg which has been handed off to
		 * us.  This may cause the quiescing thread to now be
		 * able to quiesce another txg, so we must signal it.
		 */
		ASSERT(tx->tx_quiesced_txg != 0);
		txg = tx->tx_quiesced_txg;
		tx->tx_quiesced_txg = 0;
		tx->tx_syncing_txg = txg;
		DTRACE_PROBE2(txg__syncing, dsl_pool_t *, dp, uint64_t, txg);
		cv_broadcast(&tx->tx_quiesce_more_cv);

		dprintf("txg=%llu quiesce_txg=%llu sync_txg=%llu\n",
		    (u_longlong_t)txg, (u_longlong_t)tx->tx_quiesce_txg_waiting,
		    (u_longlong_t)tx->tx_sync_txg_waiting);
		mutex_exit(&tx->tx_sync_lock);

		txg_stat_t *ts = spa_txg_history_init_io(spa, txg, dp);
		start = ddi_get_lbolt();
		spa_sync(spa, txg);
		delta = ddi_get_lbolt() - start;
		spa_txg_history_fini_io(spa, ts);

		mutex_enter(&tx->tx_sync_lock);
		tx->tx_synced_txg = txg;
		tx->tx_syncing_txg = 0;
		DTRACE_PROBE2(txg__synced, dsl_pool_t *, dp, uint64_t, txg);
		cv_broadcast(&tx->tx_sync_done_cv);
```

L589-L591: the sync thread takes the txg that the quiesce thread handed off in `tx_quiesced_txg` and records it as `tx_syncing_txg`. L593: it wakes the quiesce thread, which may now quiesce the next txg while this one is being written, but only if someone has already asked for it by raising `tx_quiesce_txg_waiting` (excerpt 5, L638-L641); this is how three txgs can be in flight at once. L602: `spa_sync` does all the I/O for the txg. L607-L610: the txg becomes `tx_synced_txg` and anyone blocked in `txg_wait_synced` is woken through `tx_sync_done_cv`.

### 3. `spa_sync_iterate_to_convergence` — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10743-L10766

```c
		 * (e.g. if we have sync tasks but no dirty user data). We need
		 * to check the uberblock's rootbp because it is updated if we
		 * have synced out dirty data (though in this case the MOS will
		 * most likely also be dirty due to second order effects, we
		 * don't want to rely on that here).
		 */
		if (pass == 1 &&
		    BP_GET_LOGICAL_BIRTH(&spa->spa_uberblock.ub_rootbp) < txg &&
		    !dmu_objset_is_dirty(mos, txg)) {
			/*
			 * Nothing changed on the first pass, therefore this
			 * TXG is a no-op. Avoid syncing deferred frees, so
			 * that we can keep this TXG as a no-op.
			 */
			ASSERT(txg_list_empty(&dp->dp_dirty_datasets, txg));
			ASSERT(txg_list_empty(&dp->dp_dirty_dirs, txg));
			ASSERT(txg_list_empty(&dp->dp_sync_tasks, txg));
			ASSERT(txg_list_empty(&dp->dp_early_sync_tasks, txg));
			break;
		}

		spa_sync_deferred_frees(spa, tx);
	} while (dmu_objset_is_dirty(mos, txg));
}
```

This is the tail of the `do { ... }` loop that begins at spa.c L10675. Each pass syncs datasets, frees, DDT, scrub state and vdevs, and writing those blocks allocates space, which dirties space maps, which live in the MOS, which dirties the MOS again. L10749-L10764: if pass 1 found nothing to write (root block pointer not born in this txg, MOS clean), the txg is a no-op and the loop stops early. L10765: otherwise the loop repeats as long as the MOS is dirty in this txg; it ends when a pass produces no new changes, i.e. when the tree has converged. Only after this does `spa_sync` call `spa_sync_rewrite_vdev_config` (spa.c L10958), whose `vdev_config_sync` writes even labels, then uberblocks, then odd labels ([`module/zfs/vdev_label.c#L2109`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2109), [`module/zfs/vdev_label.c#L2133`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2133), [`module/zfs/vdev_label.c#L2154`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2154)).

### 4. `txg_sync_thread`, the wait — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L532-L553

```c
	for (;;) {
		clock_t timeout = zfs_txg_timeout * hz;
		clock_t timer;
		uint64_t txg;

		/*
		 * We sync when we're scanning, there's someone waiting
		 * on us, or the quiesce thread has handed off a txg to
		 * us, or we have reached our timeout.
		 */
		timer = (delta >= timeout ? 0 : timeout - delta);
		while (!dsl_scan_active(dp->dp_scan) &&
		    !tx->tx_exiting && timer > 0 &&
		    tx->tx_synced_txg >= tx->tx_sync_txg_waiting &&
		    !txg_has_quiesced_to_sync(dp)) {
			dprintf("waiting; tx_synced=%llu waiting=%llu dp=%p\n",
			    (u_longlong_t)tx->tx_synced_txg,
			    (u_longlong_t)tx->tx_sync_txg_waiting, dp);
			txg_thread_wait(tx, &cpr, &tx->tx_sync_more_cv, timer);
			delta = ddi_get_lbolt() - start;
			timer = (delta > timeout ? 0 : timeout - delta);
		}
```

L533: the timeout is `zfs_txg_timeout` seconds, 5 by default ([`module/zfs/txg.c#L116`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L116)), in clock ticks. L542 and L552: `timer` counts from `start`, which is set when the previous `spa_sync` began (L601), so the 5 seconds run from the start of the last sync, not from its end. L543-L546: the thread sleeps while all four hold: no scan is running, the timer has not expired, nobody waits for a txg later than the last synced one (`tx_sync_txg_waiting`), and no quiesced txg is waiting. Any one of them ends the wait. The next lines ([`module/zfs/txg.c#L564-L578`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L564-L578)) wait for a quiesced txg and, if none is quiescing, ask for one: `tx_quiesce_txg_waiting = tx_open_txg + 1` and a broadcast to the quiesce thread (L574-L576).

Who raises `tx_sync_txg_waiting`:
- `txg_wait_synced(dp, txg)`, with `txg == 0` meaning the open txg plus `TXG_DEFER_SIZE` (2) — [`module/zfs/txg.c#L714-L717`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L714-L717), [`include/sys/txg.h#L49`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L49). `zpool sync` reaches it: `zpool_sync_one` → `lzc_sync` → `zfs_ioc_pool_sync` → `txg_wait_synced(spa_get_dsl(spa), 0)` — [`lib/libzfs/libzfs_pool.c#L4503`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/lib/libzfs/libzfs_pool.c#L4503), [`lib/libzfs_core/libzfs_core.c#L538`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/lib/libzfs_core/libzfs_core.c#L538), [`module/zfs/zfs_ioctl.c#L7306`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_ioctl.c#L7306).
- `txg_kick(dp, txg)` — [`module/zfs/txg.c#L830-L832`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L830-L832) — called by `dsl_pool_dirty_space` when the dirty data of this txg exceeds `zfs_dirty_data_max * zfs_dirty_data_sync_percent / 100` — [`module/zfs/dsl_pool.c#L997-L1002`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L997-L1002), [`module/zfs/dsl_pool.c#L983-L987`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L983-L987); `zfs_dirty_data_sync_percent` is 20 ([`module/zfs/dsl_pool.c#L120`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L120)) and `zfs_dirty_data_max` defaults to 10% of memory, capped ([`module/zfs/dsl_pool.c#L99-L105`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L99-L105)).

### 5. `txg_quiesce_thread` — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L628-L667

```c
	for (;;) {
		uint64_t txg;

		/*
		 * We quiesce when there's someone waiting on us.
		 * However, we can only have one txg in "quiescing" or
		 * "quiesced, waiting to sync" state.  So we wait until
		 * the "quiesced, waiting to sync" txg has been consumed
		 * by the sync thread.
		 */
		while (!tx->tx_exiting &&
		    (tx->tx_open_txg >= tx->tx_quiesce_txg_waiting ||
		    txg_has_quiesced_to_sync(dp)))
			txg_thread_wait(tx, &cpr, &tx->tx_quiesce_more_cv, 0);

		if (tx->tx_exiting)
			txg_thread_exit(tx, &cpr, &tx->tx_quiesce_thread);

		txg = tx->tx_open_txg;
		dprintf("txg=%llu quiesce_txg=%llu sync_txg=%llu\n",
		    (u_longlong_t)txg,
		    (u_longlong_t)tx->tx_quiesce_txg_waiting,
		    (u_longlong_t)tx->tx_sync_txg_waiting);
		tx->tx_quiescing_txg = txg;

		mutex_exit(&tx->tx_sync_lock);
		txg_quiesce(dp, txg);
		mutex_enter(&tx->tx_sync_lock);

		/*
		 * Hand this txg off to the sync thread.
		 */
		dprintf("quiesce done, handing off txg %llu\n",
		    (u_longlong_t)txg);
		tx->tx_quiescing_txg = 0;
		tx->tx_quiesced_txg = txg;
		DTRACE_PROBE2(txg__quiesced, dsl_pool_t *, dp, uint64_t, txg);
		cv_broadcast(&tx->tx_sync_more_cv);
		cv_broadcast(&tx->tx_quiesce_done_cv);
	}
```

L631-L641: the quiesce thread sleeps until someone asks for a txg beyond the open one (`tx_open_txg < tx_quiesce_txg_waiting`) and there is no quiesced txg still waiting for the sync thread. The comment states the rule the figure keeps: one txg at most in "quiescing" or "quiesced, waiting to sync". L646-L651: it takes the open txg and records it as `tx_quiescing_txg`; `txg_quiesce` (excerpt 1) does the rest. L662-L666: the hand-off: `tx_quiesced_txg = txg`, then a broadcast that wakes the sync thread.

Who raises `tx_quiesce_txg_waiting`: the sync thread when it is ready for a txg and none is quiescing (L574-L575 of the file), and `txg_wait_open(dp, txg, B_TRUE)` ([`module/zfs/txg.c#L791-L794`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L791-L794)). At this tag the only caller with `B_TRUE` is `dmu_free_long_range_impl`, when the frees of the current txg reach a threshold: "To avoid filling up a TXG with just frees, wait for the next TXG to open" ([`module/zfs/dmu.c#L1096-L1106`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1096-L1106)). So in the common case the next txg stays open while one syncs, and it is quiesced only when the sync thread is done and asks for it; the three states are all busy only when `txg_wait_open` asked for a quiesce during a sync.

**What the animation shows.** The figure runs a model (`src/lib/txg.ts`) of the two threads' wait conditions over the same state variables, `tx_open_txg`, `tx_quiescing_txg`, `tx_quiesced_txg`, `tx_syncing_txg`, `tx_synced_txg`, `tx_sync_txg_waiting`, `tx_quiesce_txg_waiting` ([`include/sys/txg_impl.h#L94-L103`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg_impl.h#L94-L103)), and per-CPU `tc_count[TXG_SIZE]` ([`include/sys/txg_impl.h#L75`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg_impl.h#L75)). Every event it shows:
- "Add a write": `dmu_tx_assign` → `txg_hold_open` on the next CPU: the write joins `tx_open_txg` and `tc_count[cpu][txg & TXG_MASK]` goes up — [`module/zfs/dmu_tx.c#L1085`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1085), [`module/zfs/txg.c#L333-L338`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L333-L338). The txg's dirty count goes up (`dp_dirty_pertxg`, [`module/zfs/dsl_pool.c#L995`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L995)); past the sync threshold, `txg_kick` (above).
- A write finishes: `dmu_tx_commit` → `txg_rele_to_sync`, the count goes down and the last one broadcasts `tc_cv` — [`module/zfs/dmu_tx.c#L1460`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1460), [`module/zfs/txg.c#L372-L375`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L372-L375).
- The sync thread wakes on the timeout, on a waiter, or on a quiesced txg (excerpt 4, L542-L553), then asks for a quiesce (L568-L577).
- The quiesce: the open txg moves to the "quiescing" column and the next txg opens at once (excerpt 1, L398-L413); writes that hold the old txg stay in it until they finish (L422-L428).
- The hand-off: the column says "quiesced, waiting for the sync thread" while `tx_quiesced_txg` is set and the sync thread is busy (excerpt 5, L662-L666); the sync thread takes it (excerpt 2, L589-L593).
- Sync passes: pass 1, pass 2, ... until a pass leaves the MOS clean (excerpt 3; the loop and its pass counter start at [`module/zfs/spa.c#L10675-L10676`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10675-L10676)); an empty txg stops after pass 1 (L10749-L10764).
- The commit: `spa_sync_rewrite_vdev_config` → `vdev_config_sync`, flush, even labels, uberblock, odd labels (spa.c L10958, tree room excerpt 3); the uberblock on disk becomes this txg's. An empty txg writes nothing: `uberblock_update` reports no change because the root block pointer was not born in this txg, and `vdev_config_sync` returns — [`module/zfs/vdev_label.c#L2071-L2077`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2071-L2077), [`module/zfs/uberblock.c#L74`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/uberblock.c#L74).
- Then `tx_synced_txg = txg` (excerpt 2, L607-L610).
- Interaction: add writes; `zpool sync` (`txg_wait_synced(dp, 0)`, waits for open + 2); "free a large file" (`txg_wait_open(dp, 0, B_TRUE)`, the only way to fill all three columns); background writes; play, pause, one event at a time. A timer bar shows `zfs_txg_timeout` running down from the start of the last sync.
- Simplified (see `DECISIONS.md` D3.1): 4 CPUs; writes are one block each and the dirty threshold is scaled to 4 blocks (20% of a 20-block `zfs_dirty_data_max`); time is slowed and durations are illustrative; holds are taken without the `tc_open_lock` wait; the write throttle (`dmu_tx_delay`, `zfs_dirty_data_max` waits), scans, the ZIL, synctasks and pool suspension are left out; pass sizes are illustrative (pass 1 user data plus metadata, then fewer metadata blocks), always three passes for a non-empty txg.

**Facts for the text**
- Three txgs can be active at once (open, quiescing, syncing): `TXG_CONCURRENT_STATES` is 3 — [`include/sys/txg.h#L41`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L41); "There may be up to three active txgs, and there is always a txg in the open state" — [`module/zfs/txg.c#L47-L52`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L47-L52).
- "ZFS asserts consistency at the granularity of these transaction groups" — [`module/zfs/txg.c#L44-L46`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L44-L46).
- Per-txg state is kept in arrays of `TXG_SIZE` = 4 ("next power of 2") indexed by `txg & TXG_MASK` — [`include/sys/txg.h#L42-L45`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L42-L45).
- A txg is synced at least every `zfs_txg_timeout` = 5 seconds — [`module/zfs/txg.c#L116`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L116), counted from the start of the previous sync (excerpt 4).
- Frees are deferred: from sync pass `zfs_sync_pass_deferred_free` = 2 onward (without the log spacemap feature), frees go to a deferred bpobj instead of being processed in the same pass — [`module/zfs/zio.c#L122`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L122), [`module/zfs/spa.c#L10686-L10703`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10686-L10703).
- When no vdev config is dirty, the uberblock is written to at most `SPA_SYNC_MIN_VDEVS` = 3 randomly chosen top-level vdevs — [`include/sys/spa.h#L363`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L363), [`module/zfs/spa.c#L10792-L10815`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10792-L10815).
- Sync passes converge because, from a later pass on, ZFS rewrites in place blocks it allocated earlier in the same sync, and stops compressing and defers frees — the comment [`module/zfs/txg.c#L92-L99`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L92-L99); the in-place rewrite is `zfs_sync_pass_rewrite` = 2 ([`module/zfs/zio.c#L128`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L128), copy-on-write room).
- Each pool has its own two threads, `txg_quiesce_thread` and `txg_sync_thread`, started by `txg_sync_start` — [`module/zfs/txg.c#L210-L219`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L210-L219).
- The hold counters are per CPU because "Having a single structure would result in heavy lock contention" — [`include/sys/txg_impl.h#L51-L55`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg_impl.h#L51-L55).
- The sync thread's "scan" condition, `dsl_scan_active`, is true for a running (unpaused) scrub or resilver, an async destroy, or pending background frees and livelist deletes — [`module/zfs/dsl_scan.c#L3723-L3732`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L3723-L3732).
- "The first such pass is the largest as it encompasses all the modified user data ... Subsequent passes ... consist exclusively of filesystem metadata" — [`module/zfs/txg.c#L86-L90`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L86-L90).
- `fsync` normally does not wait for a txg: `zfs_fsync` calls `zil_commit` — [`module/zfs/zfs_vnops.c#L117-L120`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L117-L120) (ZIL room). In unusual cases the ZIL falls back to `txg_wait_synced`: zil.c L2394-L2396, L2493-L2502.

**Short excerpts for the question-first room (v1.4, ALG-189).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 6. `txg_hold_open`, joining the open txg — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L333-L338

```c
	mutex_enter(&tc->tc_open_lock);
	txg = tx->tx_open_txg;

	mutex_enter(&tc->tc_lock);
	tc->tc_count[txg & TXG_MASK]++;
	mutex_exit(&tc->tc_lock);
```

L333-L334: the writer takes the `tc_open_lock` of the CPU it runs on, then reads `tx_open_txg`; `txg_quiesce` takes all these locks to close a txg (excerpt 1, L398-L399), so a writer gets either the old txg or the next one, never a txg being closed. L336-L338: it raises the hold count of that CPU for this txg, `tc_count[txg & TXG_MASK]` (`TXG_SIZE` = 4 slots, [txg.h L42-L45](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L42-L45)). The counts are per CPU because a single one "would result in heavy lock contention" ([txg_impl.h L51-L55](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg_impl.h#L51-L55)). `dmu_tx_assign` calls it ([dmu_tx.c L1085](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_tx.c#L1085)); `txg_rele_to_sync` lowers the count when the transaction commits and wakes the quiesce thread at 0 ([L372-L375](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L372-L375)).

### 7. `txg_sync_thread`, when to sync — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L542-L553

```c
		timer = (delta >= timeout ? 0 : timeout - delta);
		while (!dsl_scan_active(dp->dp_scan) &&
		    !tx->tx_exiting && timer > 0 &&
		    tx->tx_synced_txg >= tx->tx_sync_txg_waiting &&
		    !txg_has_quiesced_to_sync(dp)) {
			dprintf("waiting; tx_synced=%llu waiting=%llu dp=%p\n",
			    (u_longlong_t)tx->tx_synced_txg,
			    (u_longlong_t)tx->tx_sync_txg_waiting, dp);
			txg_thread_wait(tx, &cpr, &tx->tx_sync_more_cv, timer);
			delta = ddi_get_lbolt() - start;
			timer = (delta > timeout ? 0 : timeout - delta);
		}
```

Excerpt 4 without the loop's declarations. L542 and L551-L552: `timer` counts from `start`, set when the previous `spa_sync` began ([L601](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L601)). L543-L546: the thread sleeps while no scan is active, the timer has not run out, nobody waits for a txg past the last synced one, and no quiesced txg is waiting. The timeout is `zfs_txg_timeout`, 5 seconds ([L116](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L116)). `tx_sync_txg_waiting` is raised by `txg_wait_synced` ([L714-L717](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L714-L717), what `zpool sync` calls) and by `txg_kick` ([L830-L832](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L830-L832), called by `dsl_pool_dirty_space` past `zfs_dirty_data_sync_percent`, [dsl_pool.c L997-L1002](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L997-L1002)).

### 8. `txg_quiesce`, the next txg opens — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L398-L402

```c
	for (c = 0; c < max_ncpus; c++)
		mutex_enter(&tx->tx_cpu[c].tc_open_lock);

	ASSERT(txg == tx->tx_open_txg);
	tx->tx_open_txg++;
```

The start of excerpt 1. L398-L399: with every CPU's `tc_open_lock` held, no writer can be inside `txg_hold_open` between its lock and its read of `tx_open_txg`. L402: the open txg number goes up by one. The locks are released right after ([L412-L413](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L412-L413)), so new writers enter the next txg while the old one drains.

### 9. `txg_quiesce`, the drain — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L422-L428

```c
	for (c = 0; c < max_ncpus; c++) {
		tx_cpu_t *tc = &tx->tx_cpu[c];
		mutex_enter(&tc->tc_lock);
		while (tc->tc_count[g] != 0)
			cv_wait(&tc->tc_cv[g], &tc->tc_lock);
		mutex_exit(&tc->tc_lock);
	}
```

The end of excerpt 1. For each CPU in turn, the quiesce thread sleeps on `tc_cv[g]` until that CPU's hold count for this txg is 0; `txg_rele_to_sync` broadcasts it when the last hold goes (L374-L375). When the loop ends, no transaction holds the txg: it is quiesced.

### 10. `txg_quiesce_thread`, one txg per state — module/zfs/txg.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L638-L641

```c
		while (!tx->tx_exiting &&
		    (tx->tx_open_txg >= tx->tx_quiesce_txg_waiting ||
		    txg_has_quiesced_to_sync(dp)))
			txg_thread_wait(tx, &cpr, &tx->tx_quiesce_more_cv, 0);
```

The wait of excerpt 5. The quiesce thread sleeps while nobody asks for a txg past the open one, or while the txg it quiesced last has not been taken by the sync thread. So at most one txg is quiescing or quiesced. The sync thread asks when it is ready ([L574-L576](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L574-L576)); `txg_wait_open(dp, 0, B_TRUE)` asks too ([L791-L794](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/txg.c#L791-L794)), and at this tag only `dmu_free_long_range_impl` calls it that way ([dmu.c L1096-L1106](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L1096-L1106)).

### 11. `spa_sync_iterate_to_convergence`, no-op or another pass — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L10749-L10765

```c
		if (pass == 1 &&
		    BP_GET_LOGICAL_BIRTH(&spa->spa_uberblock.ub_rootbp) < txg &&
		    !dmu_objset_is_dirty(mos, txg)) {
			/*
			 * Nothing changed on the first pass, therefore this
			 * TXG is a no-op. Avoid syncing deferred frees, so
			 * that we can keep this TXG as a no-op.
			 */
			ASSERT(txg_list_empty(&dp->dp_dirty_datasets, txg));
			ASSERT(txg_list_empty(&dp->dp_dirty_dirs, txg));
			ASSERT(txg_list_empty(&dp->dp_sync_tasks, txg));
			ASSERT(txg_list_empty(&dp->dp_early_sync_tasks, txg));
			break;
		}

		spa_sync_deferred_frees(spa, tx);
	} while (dmu_objset_is_dirty(mos, txg));
```

Excerpt 3 without the comment above. L10749-L10761: after pass 1, if the root block pointer was not born in this txg and the MOS is clean, the txg is a no-op and the loop stops. L10764-L10765: otherwise deferred frees are synced and the loop runs another pass as long as the MOS is dirty in this txg.

### 12. `vdev_config_sync`, an unchanged txg writes nothing — module/zfs/vdev_label.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2071-L2077

```c
	if (ub->ub_txg < txg) {
		boolean_t changed = uberblock_update(ub, spa->spa_root_vdev,
		    txg, spa->spa_mmp.mmp_delay);

		if (!changed && list_is_empty(&spa->spa_config_dirty_list) &&
		    !spa_multihost(spa))
			return (0);
```

`uberblock_update` sets the new uberblock's txg and reports whether its root block pointer was born in this txg ([uberblock.c L74](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/uberblock.c#L74)). If not, no vdev configuration is dirty and multihost protection is off, `vdev_config_sync` returns before the flush and the label writes ([L2085-L2098](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_label.c#L2085-L2098), tree room excerpt 7): an idle pool goes through a txg every 5 seconds and writes nothing.

## Room: The vdevs

**Problem.** A pool is mirrors, RAID-Z groups, dRAID, log devices, special devices, spares and replacements in progress, nested arbitrarily, and the I/O path must not grow one special case per combination. ZFS represents all of it as one tree of `vdev_t` nodes, each with a table of operations, so a write to "the pool" is a walk down that tree in which each node decides how to fan out to its children. Separately, the allocator needs to know which top-level vdevs may receive which kind of block (ZIL, metadata, dedup tables, small blocks, ordinary data).

**The idea in the code.**
- `struct vdev` in [`include/sys/vdev_impl.h#L208`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L208) — one node of the tree: parent, children, top-level ancestor, and an ops table.
- `vdev_ops_t` in [`include/sys/vdev_impl.h#L101-L126`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L101-L126) — the per-type virtual method table; a node's type is nothing but the table it points to.
- `vdev_metaslab_group_create` in [`module/zfs/vdev.c#L1539`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1539) — binds a top-level vdev to an allocation class (normal, log, special, dedup).

**Excerpts.**

### 1. `struct vdev` — include/sys/vdev_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L239-L269

```c
	uint64_t	vdev_state;	/* see VDEV_STATE_* #defines	*/
	uint64_t	vdev_prevstate;	/* used when reopening a vdev	*/
	vdev_ops_t	*vdev_ops;	/* vdev operations		*/
	spa_t		*vdev_spa;	/* spa for this vdev		*/
	void		*vdev_tsd;	/* type-specific data		*/
	vdev_t		*vdev_top;	/* top-level vdev		*/
	vdev_t		*vdev_parent;	/* parent vdev			*/
	vdev_t		**vdev_child;	/* array of children		*/
	uint64_t	vdev_children;	/* number of children		*/
	vdev_stat_t	vdev_stat;	/* virtual device statistics	*/
	vdev_stat_ex_t	vdev_stat_ex;	/* extended statistics		*/
	boolean_t	vdev_expanding;	/* expand the vdev?		*/
	boolean_t	vdev_reopening;	/* reopen in progress?		*/
	boolean_t	vdev_nonrot;	/* true if solid state		*/
	int		vdev_load_error; /* error on last load		*/
	int		vdev_open_error; /* error on last open		*/
	int		vdev_validate_error; /* error on last validate	*/
	kthread_t	*vdev_open_thread; /* thread opening children	*/
	kthread_t	*vdev_validate_thread; /* thread validating children */
	uint64_t	vdev_crtxg;	/* txg when top-level was added */
	uint64_t	vdev_root_zap;

	/*
	 * Top-level vdev state.
	 */
	uint64_t	vdev_ms_array;	/* metaslab array object	*/
	uint64_t	vdev_ms_shift;	/* metaslab size shift		*/
	uint64_t	vdev_ms_count;	/* number of metaslabs		*/
	metaslab_group_t *vdev_mg;	/* metaslab group		*/
	metaslab_group_t *vdev_log_mg;	/* embedded slog metaslab group	*/
	metaslab_t	**vdev_ms;	/* metaslab array		*/
```

L241: `vdev_ops` is the node's behaviour (mirror, raidz, draid, disk, file, root...). L243: `vdev_tsd` holds type-specific state (for raidz, the `vdev_raidz_t` with `vd_nparity` used in the RAID-Z room). L244-L247: the tree itself: `vdev_top` points at the top-level vdev this node belongs to (a top-level vdev points at itself), `vdev_parent`, and the `vdev_child` array of `vdev_children` entries. L264-L269 are "top-level vdev state": only top-level vdevs own metaslabs (`vdev_ms`, `vdev_ms_count`) and a metaslab group `vdev_mg`, i.e. only they are allocation targets; interior and leaf nodes below them only route I/O.

### 2. `vdev_ops_t` — include/sys/vdev_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L101-L126

```c
typedef const struct vdev_ops {
	vdev_init_func_t		*vdev_op_init;
	vdev_fini_func_t		*vdev_op_fini;
	vdev_open_func_t		*vdev_op_open;
	vdev_close_func_t		*vdev_op_close;
	vdev_asize_func_t		*vdev_op_psize_to_asize;
	vdev_asize_func_t		*vdev_op_asize_to_psize;
	vdev_min_asize_func_t		*vdev_op_min_asize;
	vdev_min_alloc_func_t		*vdev_op_min_alloc;
	vdev_io_start_func_t		*vdev_op_io_start;
	vdev_io_done_func_t		*vdev_op_io_done;
	vdev_state_change_func_t	*vdev_op_state_change;
	vdev_need_resilver_func_t	*vdev_op_need_resilver;
	vdev_hold_func_t		*vdev_op_hold;
	vdev_rele_func_t		*vdev_op_rele;
	vdev_remap_func_t		*vdev_op_remap;
	vdev_xlation_func_t		*vdev_op_xlate;
	vdev_rebuild_asize_func_t	*vdev_op_rebuild_asize;
	vdev_metaslab_init_func_t	*vdev_op_metaslab_init;
	vdev_config_generate_func_t	*vdev_op_config_generate;
	vdev_nparity_func_t		*vdev_op_nparity;
	vdev_ndisks_func_t		*vdev_op_ndisks;
	vdev_kobj_post_evt_func_t	*vdev_op_kobj_evt_post;
	char				vdev_op_type[16];
	boolean_t			vdev_op_leaf;
} vdev_ops_t;
```

Every vdev type is one constant instance of this table. L106-L107: size translation (a raidz turns psize into a larger asize, see `vdev_raidz_psize_to_asize`). L110-L111: `vdev_op_io_start` / `vdev_op_io_done` are the I/O path: `zio_vdev_io_start` ends in `vd->vdev_ops->vdev_op_io_start(zio)` ([`module/zfs/zio.c#L4831`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4831)); interior types create child zios, leaf types issue the real disk or file I/O. L113: `vdev_op_need_resilver` lets each type decide whether a block touches a damaged child. L124-L125: the type name and whether this is a leaf. The tables in 2.4.4: `vdev_root_ops` ([`vdev_root.c#L145`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_root.c#L145)), `vdev_mirror_ops` ([`vdev_mirror.c#L971-L995`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L971-L995)), `vdev_replacing_ops` ([L997](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L997)) and `vdev_spare_ops` ([L1023](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L1023)), `vdev_raidz_ops` ([`vdev_raidz.c#L5481`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L5481)), `vdev_draid_ops` ([`vdev_draid.c#L2336`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2336)) and `vdev_draid_spare_ops` ([L2829](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2829)), `vdev_file_ops` ([`vdev_file.c#L314`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_file.c#L314)), `vdev_disk_ops` on Linux ([`module/os/linux/zfs/vdev_disk.c#L1341`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/vdev_disk.c#L1341)), plus `vdev_indirect_ops`, `vdev_missing_ops`, `vdev_hole_ops`. Replacing and spare vdevs reuse the mirror's open/close/io_start/io_done functions verbatim (compare [`vdev_mirror.c#L1000-L1007`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L1000-L1007) with L974-L981): a disk replacement in progress is a temporary two-way mirror of old and new disk.

### 3. `vdev_metaslab_group_create` — module/zfs/vdev.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1546-L1579

```c
	if (vd->vdev_mg == NULL) {
		metaslab_class_t *mc;

		if (vd->vdev_islog && vd->vdev_alloc_bias == VDEV_BIAS_NONE)
			vd->vdev_alloc_bias = VDEV_BIAS_LOG;

		ASSERT3U(vd->vdev_islog, ==,
		    (vd->vdev_alloc_bias == VDEV_BIAS_LOG));

		switch (vd->vdev_alloc_bias) {
		case VDEV_BIAS_LOG:
			mc = spa_log_class(spa);
			break;
		case VDEV_BIAS_SPECIAL:
			mc = spa_special_class(spa);
			break;
		case VDEV_BIAS_DEDUP:
			mc = spa_dedup_class(spa);
			break;
		default:
			mc = spa_normal_class(spa);
		}

		vd->vdev_mg = metaslab_group_create(mc, vd);

		if (!vd->vdev_islog) {
			if (mc == spa_special_class(spa)) {
				vd->vdev_log_mg = metaslab_group_create(
				    spa_special_embedded_log_class(spa), vd);
			} else {
				vd->vdev_log_mg = metaslab_group_create(
				    spa_embedded_log_class(spa), vd);
			}
		}
```

L1549-L1550: a log device without an explicit bias gets `VDEV_BIAS_LOG`. L1555-L1567: the vdev's `vdev_alloc_bias` (none/log/special/dedup, [`include/sys/vdev_impl.h#L158-L163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L158-L163)) picks one of the pool's metaslab classes via `spa_log_class`, `spa_special_class`, `spa_dedup_class`, `spa_normal_class` ([`module/zfs/spa_misc.c#L2075-L2109`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2075-L2109)). L1569: the vdev's metaslab group joins that class. L1571-L1578: every non-log top-level vdev also gets a second group, `vdev_log_mg`, in the "embedded log" class (or the special-embedded-log class for special vdevs), so ZIL blocks can be allocated on normal vdevs when there is no SLOG. Which class a given block goes to is decided per write by `spa_preferred_class` ([`module/zfs/spa_misc.c#L2120-L2179`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2120-L2179)): DDT blocks to dedup, else special, else normal (L2149-L2156); metadata and indirect blocks to special (L2161-L2163); data blocks no larger than the dataset's `special_small_blocks` to special while special is less than 75% full (L2169-L2176); everything else to normal.

### 4. `vdev_mirror_io_start` — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L656-L693

```c
		/*
		 * For normal reads just pick one child.
		 */
		c = vdev_mirror_child_select(zio);
		children = (c >= 0);
	} else {
		ASSERT(zio->io_type == ZIO_TYPE_WRITE);

		/*
		 * Writes go to all children.
		 */
		c = 0;
		children = mm->mm_children;
	}

	while (children--) {
		mc = &mm->mm_child[c++];

		/*
		 * When sequentially resilvering and the integrity of the data
		 * is speculative (ZIO_FLAG_SPECULATIVE), issue write repair IOs
		 * only to the vdev which is being rebuilt. Existing data on
		 * other children must never be overwritten with unconfirmed
		 * data to avoid unrecoverable damage to the pool.
		 */
		if ((zio->io_priority == ZIO_PRIORITY_REBUILD) &&
		    (zio->io_flags & ZIO_FLAG_IO_REPAIR) &&
		    !(zio->io_flags & ZIO_FLAG_SCRUB) &&
		    (zio->io_flags & ZIO_FLAG_SPECULATIVE) &&
		    mm->mm_rebuilding && !mc->mc_rebuilding) {
			continue;
		}

		zio_nowait(zio_vdev_child_io(zio, zio->io_bp,
		    mc->mc_vd, mc->mc_offset, zio->io_abd, zio->io_size,
		    zio->io_type, zio->io_priority, 0,
		    vdev_mirror_child_done, mc));
	}
```

L659-L660: a normal read picks one child with `vdev_mirror_child_select`. That function skips a child that cannot be read, and a child whose DTL says it is missing the block's txg ([`vdev_mirror.c#L508-L516`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L508-L516), [`vdev_mirror.c#L554-L559`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L554-L559)); it takes a dRAID distributed spare first if one is eligible ([`vdev_mirror.c#L561-L565`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L561-L565)); otherwise it takes the least loaded child, at random among equals ([`vdev_mirror.c#L567-L586`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L567-L586)). L662-L669: writes go to all children. L671-L687: the exception is a sequential rebuild with speculative data, which writes only to the child being rebuilt. L689-L692: each child gets a child zio for the same offset and size. The same function serves the logical zio of a block, which has no vdev: `zio_vdev_io_start` hands it to `vdev_mirror_ops` with the block's DVAs as children ([`zio.c#L4692-L4697`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4692-L4697)), and every later child zio, which has a vdev, goes to that vdev's own `vdev_op_io_start` ([`zio.c#L4831`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4831)). The root's table has none: `.vdev_op_io_start = NULL, /* not applicable to the root */` ([`vdev_root.c#L154-L155`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_root.c#L154-L155)).

### 5. `vdev_replacing_ops` — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L997-L1021

```c
vdev_ops_t vdev_replacing_ops = {
	.vdev_op_init = NULL,
	.vdev_op_fini = NULL,
	.vdev_op_open = vdev_mirror_open,
	.vdev_op_close = vdev_mirror_close,
	.vdev_op_psize_to_asize = vdev_default_asize,
	.vdev_op_asize_to_psize = vdev_default_psize,
	.vdev_op_min_asize = vdev_default_min_asize,
	.vdev_op_min_alloc = NULL,
	.vdev_op_io_start = vdev_mirror_io_start,
	.vdev_op_io_done = vdev_mirror_io_done,
	.vdev_op_state_change = vdev_mirror_state_change,
	.vdev_op_need_resilver = vdev_default_need_resilver,
	.vdev_op_hold = NULL,
	.vdev_op_rele = NULL,
	.vdev_op_remap = NULL,
	.vdev_op_xlate = vdev_default_xlate,
	.vdev_op_rebuild_asize = vdev_mirror_rebuild_asize,
	.vdev_op_metaslab_init = NULL,
	.vdev_op_config_generate = NULL,
	.vdev_op_nparity = NULL,
	.vdev_op_ndisks = NULL,
	.vdev_op_type = VDEV_TYPE_REPLACING,	/* name of this vdev type */
	.vdev_op_leaf = B_FALSE			/* not a leaf vdev */
};
```

L1000-L1007 are the mirror's functions, the same as in `vdev_mirror_ops` ([`vdev_mirror.c#L971-L995`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L971-L995)) and `vdev_spare_ops` ([`vdev_mirror.c#L1023-L1047`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L1023-L1047)). Only L1019, the type name, differs. A replacement in progress and an active hot spare are mirrors for the I/O path: a write goes to the old and the new disk, a read to one of them.

### 6. `spa_vdev_attach`, replacing or spare — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8324-L8360

```c
	} else {
		/*
		 * Active hot spares can only be replaced by inactive hot
		 * spares.
		 */
		if (pvd->vdev_ops == &vdev_spare_ops &&
		    oldvd->vdev_isspare &&
		    !spa_has_spare(spa, newvd->vdev_guid))
			return (spa_vdev_exit(spa, newrootvd, txg, ENOTSUP));

		/*
		 * If the source is a hot spare, and the parent isn't already a
		 * spare, then we want to create a new hot spare.  Otherwise, we
		 * want to create a replacing vdev.  The user is not allowed to
		 * attach to a spared vdev child unless the 'isspare' state is
		 * the same (spare replaces spare, non-spare replaces
		 * non-spare).
		 */
		if (pvd->vdev_ops == &vdev_replacing_ops &&
		    spa_version(spa) < SPA_VERSION_MULTI_REPLACE) {
			return (spa_vdev_exit(spa, newrootvd, txg, ENOTSUP));
		} else if (pvd->vdev_ops == &vdev_spare_ops &&
		    newvd->vdev_isspare != oldvd->vdev_isspare) {
			return (spa_vdev_exit(spa, newrootvd, txg, ENOTSUP));
		}

		if (spa_vdev_new_spare_would_cause_double_spares(newvd, pvd)) {
			vdev_dbgmsg(newvd,
			    "disk would create double spares, ignore.");
			return (spa_vdev_exit(spa, newrootvd, txg, EEXIST));
		}

		if (newvd->vdev_isspare)
			pvops = &vdev_spare_ops;
		else
			pvops = &vdev_replacing_ops;
	}
```

`zpool replace` calls `spa_vdev_attach` with `replacing` set. L8329-L8332: an active hot spare can only be replaced by an inactive one. L8356-L8359: if the new disk is a hot spare, the new parent is a `spare` node, else a `replacing` node. A distributed spare of a dRAID can only replace a child of that dRAID ([`spa.c#L8286-L8292`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8286-L8292)).

### 7. `spa_vdev_attach`, the new parent — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8436-L8454

```c
	/*
	 * If the parent is not a mirror, or if we're replacing, insert the new
	 * mirror/replacing/spare vdev above oldvd.
	 */
	if (!raidz && pvd->vdev_ops != pvops) {
		pvd = vdev_add_parent(oldvd, pvops);
		ASSERT(pvd->vdev_ops == pvops);
		ASSERT(oldvd->vdev_parent == pvd);
	}

	ASSERT(pvd->vdev_top->vdev_parent == rvd);

	/*
	 * Extract the new device from its root and add it to pvd.
	 */
	vdev_remove_child(newrootvd, newvd);
	newvd->vdev_id = pvd->vdev_children;
	newvd->vdev_crtxg = oldvd->vdev_crtxg;
	vdev_add_child(pvd, newvd);
```

L8440-L8444: the new parent is inserted above the old disk by `vdev_add_parent` (excerpt 8). L8451-L8454: the new disk becomes the parent's last child. Before the I/O starts, the new disk's DTL is marked missing from `TXG_INITIAL` to `dtl_max_txg`, the current txg plus `TXG_CONCURRENT_STATES` ([`spa.c#L8472`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8472), [`spa.c#L8499-L8500`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8499-L8500); `TXG_CONCURRENT_STATES` is 3, `TXG_INITIAL` is `TXG_SIZE`, 4: [`txg.h#L41-L44`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L41-L44)). So reads of blocks born before that skip the new disk (excerpt 4), and the resilver copies them.

### 8. `vdev_add_parent` — module/zfs/vdev.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1418-L1449

```c
vdev_add_parent(vdev_t *cvd, vdev_ops_t *ops)
{
	spa_t *spa = cvd->vdev_spa;
	vdev_t *pvd = cvd->vdev_parent;
	vdev_t *mvd;

	ASSERT(spa_config_held(spa, SCL_ALL, RW_WRITER) == SCL_ALL);

	mvd = vdev_alloc_common(spa, cvd->vdev_id, 0, ops);

	mvd->vdev_asize = cvd->vdev_asize;
	mvd->vdev_min_asize = cvd->vdev_min_asize;
	mvd->vdev_max_asize = cvd->vdev_max_asize;
	mvd->vdev_psize = cvd->vdev_psize;
	mvd->vdev_ashift = cvd->vdev_ashift;
	mvd->vdev_logical_ashift = cvd->vdev_logical_ashift;
	mvd->vdev_physical_ashift = cvd->vdev_physical_ashift;
	mvd->vdev_state = cvd->vdev_state;
	mvd->vdev_crtxg = cvd->vdev_crtxg;
	mvd->vdev_nonrot = cvd->vdev_nonrot;

	vdev_remove_child(pvd, cvd);
	vdev_add_child(pvd, mvd);
	cvd->vdev_id = mvd->vdev_children;
	vdev_add_child(mvd, cvd);
	vdev_top_update(cvd->vdev_top, cvd->vdev_top);

	if (mvd == mvd->vdev_top)
		vdev_top_transfer(cvd, mvd);

	return (mvd);
}
```

L1426: the new node gets the old disk's `vdev_id`, so it takes its place among its parent's children (L1439-L1440); the old disk becomes its child 0 (L1441-L1442). L1445-L1446: if the old disk was itself a top-level vdev (a single disk under the root), the new node becomes the top-level vdev and takes over its state with `vdev_top_transfer` ([`vdev.c#L1299-L1330`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1299-L1330)), metaslabs and allocation class included.

### 9. `spa_vdev_resilver_done_hunt` — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L9438-L9456

```c
	/*
	 * Check for a completed replacement.  We always consider the first
	 * vdev in the list to be the oldest vdev, and the last one to be
	 * the newest (see spa_vdev_attach() for how that works).  In
	 * the case where the newest vdev is faulted, we will not automatically
	 * remove it after a resilver completes.  This is OK as it will require
	 * user intervention to determine which disk the admin wishes to keep.
	 */
	if (vd->vdev_ops == &vdev_replacing_ops) {
		ASSERT(vd->vdev_children > 1);

		newvd = vd->vdev_child[vd->vdev_children - 1];
		oldvd = vd->vdev_child[0];

		if (vdev_dtl_empty(newvd, DTL_MISSING) &&
		    vdev_dtl_empty(newvd, DTL_OUTAGE) &&
		    !vdev_dtl_required(oldvd))
			return (oldvd);
	}
```

When the new disk's DTLs are empty and the old one is no longer required, the old disk, child 0, is returned and detached; the replacing node, left with one child, is removed by `vdev_remove_parent` ([`vdev.c#L1455-L1504`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1455-L1504)), and the new disk takes its place. A spare node is not collapsed by the resilver: when its child 0, the original disk, is marked `vdev_unspare`, the end of its resilver detaches the other child, the hot spare (`spa_vdev_resilver_done_hunt` ([`spa.c#L9462-L9480`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L9462-L9480)), which happens when the original disk is brought back online with the unspare flag, which zed passes ([`zfs_mod.c#L211`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/cmd/zed/agents/zfs_mod.c#L211)), or its fault is cleared ([`vdev.c#L4500-L4504`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L4500-L4504), [`vdev.c#L4753-L4756`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L4753-L4756)); if the original disk is itself replaced, the end of that replacement's resilver detaches the hot spare too, the spare node's child 1 (`sguid`, [`spa.c#L9520-L9536`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L9520-L9536)); otherwise the administrator detaches one of the two, and a spare node left with one child is removed ([`spa.c#L8733-L8740`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8733-L8740)). Until then the hot spare stays in the tree.

### 10. `spa_preferred_class`, DDT blocks — module/zfs/spa_misc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2121-L2156

```c
spa_preferred_class(spa_t *spa, const zio_t *zio)
{
	metaslab_class_t *mc = zio->io_metaslab_class;
	boolean_t tried_dedup = (mc == spa_dedup_class(spa));
	boolean_t tried_special = (mc == spa_special_class(spa));
	const zio_prop_t *zp = &zio->io_prop;

	/* Gang children should always use the class of their parents. */
	if (zio->io_flags & ZIO_FLAG_GANG_CHILD) {
		ASSERT(mc != NULL);
		return (mc);
	}

	/*
	 * Override object type for the purposes of selecting a storage class.
	 * Primarily for DMU_OTN_ types where we can't explicitly control their
	 * storage class; instead, choose a static type most closely matches
	 * what we want.
	 */
	dmu_object_type_t objtype =
	    zp->zp_storage_type == DMU_OT_NONE ?
	    zp->zp_type : zp->zp_storage_type;

	/*
	 * ZIL allocations determine their class in zio_alloc_zil().
	 */
	ASSERT(objtype != DMU_OT_INTENT_LOG);

	if (DMU_OT_IS_DDT(objtype)) {
		if (spa_has_dedup(spa) && !tried_dedup && !tried_special)
			return (spa_dedup_class(spa));
		else if (spa_special_has_ddt(spa) && !tried_special)
			return (spa_special_class(spa));
		else
			return (spa_normal_class(spa));
	}
```

L2123-L2125: `io_metaslab_class` is the class an allocation already tried (it is set by `zio_dva_allocate` before the first try, excerpt 12), so on a second call the function knows what failed. L2144-L2147: ZIL blocks never come here. L2149-L2156: a DDT block goes to the dedup class if the pool has one and it was not tried; else to special, if the pool has a special vdev (`spa_special_has_ddt`: `zfs_ddt_data_is_special`, true by default, [`spa_misc.c#L2111-L2115`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2111-L2115)) and it was not tried; else to normal. "The pool has a class" means the class has at least one metaslab group: `spa_has_special`, `spa_has_dedup` ([`spa_misc.c#L2729-L2750`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2729-L2750)).

### 11. `spa_preferred_class`, everything else — module/zfs/spa_misc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2158-L2179

```c
	if (!spa_has_special(spa) || tried_special)
		return (spa_normal_class(spa));

	if (DMU_OT_IS_METADATA(objtype) ||
	    (zfs_user_indirect_is_special && zp->zp_level > 0))
		return (spa_special_class(spa));

	/*
	 * Allow small blocks in special class.  However, leave a reserve of
	 * zfs_special_class_metadata_reserve_pct exclusively for metadata.
	 */
	if (zio->io_size <= zp->zp_zpl_smallblk) {
		metaslab_class_t *special = spa_special_class(spa);
		uint64_t limit = metaslab_class_get_space(special) *
		    (100 - zfs_special_class_metadata_reserve_pct) / 100;

		if (metaslab_class_get_alloc(special) < limit)
			return (special);
	}

	return (spa_normal_class(spa));
}
```

L2158-L2159: without a special vdev, or after special failed, normal. L2161-L2163: metadata (an object type whose `ot_metadata` is true, such as "DMU dnode", [`dmu.c#L116`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L116); "ZFS plain file" is not, [`dmu.c#L125`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L125)) and indirect blocks of user data go to special. L2169-L2176: a data block whose size is at most the dataset's `special_small_blocks` (`zp_zpl_smallblk`, [`dmu.c#L2555`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2555); default 0, so off, [`zfs_prop.c#L739-L742`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfs_prop.c#L739-L742)) goes to special while the special class has allocated less than 75% of its space; past that, the last 25% is kept for metadata. Everything else goes to normal.

### 12. `zio_dva_allocate`, the fallback — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4368-L4407

```c
	/*
	 * Try allocating the block in the usual metaslab class.
	 * If that's full, allocate it in some other class(es).
	 * If that's full, allocate as a gang block,
	 * and if all are full, the allocation fails (which shouldn't happen).
	 *
	 * Note that we do not fall back on embedded slog (ZIL) space, to
	 * preserve unfragmented slog space, which is critical for decent
	 * sync write performance.  If a log allocation fails, we will fall
	 * back to spa_sync() which is abysmal for performance.
	 */
	ASSERT(ZIO_HAS_ALLOCATOR(zio));
	error = metaslab_alloc(spa, mc, zio->io_size, bp,
	    zio->io_prop.zp_copies, zio->io_txg, NULL, flags,
	    &zio->io_alloc_list, zio->io_allocator, zio);

	/*
	 * When the dedup or special class is spilling into the normal class,
	 * there can still be significant space available due to deferred
	 * frees that are in-flight.  We track the txg when this occurred and
	 * back off adding new DDT entries for a few txgs to allow the free
	 * blocks to be processed.
	 */
	if (error == ENOSPC && spa->spa_dedup_class_full_txg != zio->io_txg &&
	    (mc == spa_dedup_class(spa) || (mc == spa_special_class(spa) &&
	    !spa_has_dedup(spa) && spa_special_has_ddt(spa)))) {
		spa->spa_dedup_class_full_txg = zio->io_txg;
		zfs_dbgmsg("%s[%llu]: %s class spilling, req size %llu, "
		    "%llu allocated of %llu",
		    spa_name(spa), (u_longlong_t)zio->io_txg,
		    metaslab_class_get_name(mc),
		    (u_longlong_t)zio->io_size,
		    (u_longlong_t)metaslab_class_get_alloc(mc),
		    (u_longlong_t)metaslab_class_get_space(mc));
	}

	/*
	 * Fall back to some other class when this one is full.
	 */
	if (error == ENOSPC && (newmc = spa_preferred_class(spa, zio)) != mc) {
```

L4368-L4378: the comment states the order: the usual class, then "some other class(es)", then a gang block. L4380-L4382: `metaslab_alloc` allocates `zp_copies` DVAs in the chosen class. L4391-L4402: when the dedup or special class spills into normal, the txg is recorded and new DDT entries back off for a few txgs. L4407: on `ENOSPC`, `spa_preferred_class` is asked again; since `io_metaslab_class` now names the class that failed, it returns the next one (excerpts 10 and 11), and the allocation starts again ([`zio.c#L4430-L4444`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4430-L4444)). ZIL blocks do not come here: `zio_alloc_zil` has its own order (ZIL and SLOG room, excerpt 3), log, special embedded log, special, embedded log, normal ([`zio.c#L4561-L4595`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4561-L4595)).

### 13. `metaslab_alloc_dva_range`, ditto copies — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5401-L5427

```c
	 * If we are doing ditto or log blocks, try to spread them across
	 * consecutive vdevs.  If we're forced to reuse a vdev before we've
	 * allocated all of our ditto blocks, then try and spread them out on
	 * that vdev as much as possible.  If it turns out to not be possible,
	 * gradually lower our standards until anything becomes acceptable.
	 * Also, allocating on consecutive vdevs (as opposed to random vdevs)
	 * gives us hope of containing our fault domains to something we're
	 * able to reason about.  Otherwise, any two top-level vdev failures
	 * will guarantee the loss of data.  With consecutive allocation,
	 * only two adjacent top-level vdev failures will result in data loss.
	 *
	 * If we are doing gang blocks (hintdva is non-NULL), try to keep
	 * ourselves on the same vdev as our gang block header.  It makes our
	 * fault domains something tractable.
	 */
	if (hintdva && DVA_IS_VALID(&hintdva[d])) {
		vd = vdev_lookup_top(spa, DVA_GET_VDEV(&hintdva[d]));
		mg = vdev_get_mg(vd, mc);
	}
	if (mg == NULL && d != 0) {
		vd = vdev_lookup_top(spa, DVA_GET_VDEV(&dva[d - 1]));
		mg = vdev_get_mg(vd, mc)->mg_next;
	}
	if (mg == NULL || mg->mg_class != mc || mg->mg_activation_count <= 0) {
		ASSERT(mca->mca_rotor != NULL);
		mg = mca->mca_rotor;
	}
```

A block with several copies has one DVA per copy, allocated one after the other in the same class. L5401-L5410: "try to spread them across consecutive vdevs". L5420-L5423: DVA `d` starts at the metaslab group after the vdev of DVA `d - 1` (`mg_next`, the next vdev of the class, round the class). L5424-L5427: the first DVA starts at the class's rotor, which moves on by an amount that depends on block sizes, queue depths and free space ([`metaslab.c#L639-L698`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L639-L698)): the metaslabs room. How many copies: `zp_copies`, from `dmu_write_policy`. With `redundant_metadata=all`, the default ([`zfs_prop.c#L412-L415`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfs_prop.c#L412-L415)), metadata gets one more than the dataset's `copies` ([`dmu.c#L2400-L2404`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2400-L2404), capped at `spa_max_replication`, [`dmu.c#L2542`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2542)); the MOS, where the DDT lives, has `os_copies = spa_max_replication(spa)` ([`dmu_objset.c#L651`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L651)), 3 ([`spa_misc.c#L2210-L2220`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2210-L2220)); a ZIL block is allocated with one DVA ([`zio.c#L4562-L4564`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4562-L4564)).

### 14. `vdev_draid_generate_perms` — module/zfs/vdev_draid.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L506-L526

```c
	uint64_t draid_seed[2] = { VDEV_DRAID_SEED, map->dm_seed };
	uint8_t *current_row, *previous_row = initial_row;

	/*
	 * Perform a Fisher-Yates shuffle of each row using the previous
	 * row as the starting point.  An initial_row with known pattern
	 * is used as the input for the first row.
	 */
	for (int i = 0; i < nperms; i++) {
		current_row = &perms[i * children];
		memcpy(current_row, previous_row, rowsz);

		for (int j = children - 1; j > 0; j--) {
			uint64_t k = vdev_draid_rand(draid_seed) % (j + 1);
			uint8_t val = current_row[j];
			current_row[j] = current_row[k];
			current_row[k] = val;
		}

		previous_row = current_row;
	}
```

A dRAID's layout comes from a fixed table of permutations of its children. L506: the generator is seeded with `VDEV_DRAID_SEED` and the seed of the map for this number of children ([`vdev_draid.c#L171-L176`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L171-L176): 5 children, 256 permutations, seed `0xf46733b7f4d47dfd`). L514-L526: each row is a Fisher-Yates shuffle of the previous one, with `vdev_draid_rand`, xoroshiro128++ ([`vdev_draid_rand.c#L30-L41`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid_rand.c#L30-L41); public domain, so linked, not quoted). The result is checked against the checksum stored with the map, word 0 of fletcher-4 over the whole array (`verify_perms`, [`vdev_draid.c#L452-L460`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L452-L460)), and the comment above the table says why: "Existing pools depend on the same mapping always being generated in order to read and write from the correct locations" ([`vdev_draid.c#L166-L169`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L166-L169)).

### 15. `vdev_draid_logical_to_physical` — module/zfs/vdev_draid.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L931-L954

```c
	/*
	 * groupstart is where the group this IO will land in "starts" in
	 * the permutation array.
	 */
	uint64_t group = logical_offset / vdc->vdc_groupsz;
	uint64_t groupstart = (group * groupwidth) % ndisks;
	ASSERT3U(groupstart + groupwidth, <=, ndisks + groupstart);
	*start = groupstart;

	/* b_offset is the sector offset within a group chunk */
	b_offset = b_offset % (rowheight_sectors * groupwidth);
	ASSERT0(b_offset % groupwidth);

	/*
	 * Find the starting byte offset on each child vdev:
	 * - within a permutation there are ngroups groups spread over the
	 *   rows, where each row covers a slice portion of the disk
	 * - each permutation has (groupwidth * ngroups) / ndisks rows
	 * - so each permutation covers rows * slice portion of the disk
	 * - so we need to find the row where this IO group target begins
	 */
	*perm = group / ngroups;
	uint64_t row = (*perm * ((groupwidth * ngroups) / ndisks)) +
	    (((group % ngroups) * groupwidth) / ndisks);
```

L935-L936: a block's offset gives its group; the group starts at position `(group * groupwidth) % ndisks` of a permutation row, where `ndisks` is the children minus the distributed spares. L952: the permutation number changes every `ngroups` groups; `ngroups` is chosen by `zpool create` as the smallest count for which `ngroups * groupwidth` is a multiple of `ndisks` ([`zpool_vdev.c#L1459-L1465`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/cmd/zpool/zpool_vdev.c#L1459-L1465)). L953-L954: the row on the children. The design comment draws the result: groups of `groupwidth` drives filling rows, a new device map every slice ([`vdev_draid.c#L65-L87`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L65-L87)).

### 16. `vdev_draid_map_alloc_row`, the columns — module/zfs/vdev_draid.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L1042-L1064

```c
	uint8_t *base;
	uint64_t iter, asize = 0;
	vdev_draid_get_perm(vdc, perm, &base, &iter);
	for (uint64_t i = 0; i < groupwidth; i++) {
		raidz_col_t *rc = &rr->rr_col[i];
		uint64_t c = (groupstart + i) % ndisks;

		/* increment the offset if we wrap to the next row */
		if (i == wrap)
			physical_offset += VDEV_DRAID_ROWHEIGHT;

		rc->rc_devidx = vdev_draid_permute_id(vdc, base, iter, c);
		rc->rc_offset = physical_offset;

		if (q == 0 && i >= bc)
			rc->rc_size = 0;
		else if (i < bc)
			rc->rc_size = (q + 1) << ashift;
		else
			rc->rc_size = q << ashift;

		asize += rc->rc_size;
	}
```

L1044: the permutation row and its rotation (`vdev_draid_get_perm`, [`vdev_draid.c#L560-L569`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L560-L569)). L1047: column `i` is position `(groupstart + i) % ndisks`; L1053: its child is `(base[c] + iter) % children` (`vdev_draid_permute_id`, [`vdev_draid.c#L571-L576`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L571-L576)). L1050-L1051: a group that does not fit before the end of the row continues on the next row. L1056-L1061: column sizes as in RAID-Z, the first `nparity` columns being parity ([`vdev_draid.c#L1035`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L1035)). A write fills every column of the group, an empty or short data column padded with a skip sector ([`vdev_draid.c#L676-L683`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L676-L683) for a short one), because "dRAID always allocates a full stripe width" ([`vdev_draid.c#L1099-L1102`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L1099-L1102), [`vdev_draid.c#L640-L652`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L640-L652)); a normal read reads only the data columns that hold data ([`vdev_draid.c#L758-L764`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L758-L764)). The positions from `ndisks` to `children - 1` of each row hold no column: they are the space of the distributed spares. A distributed spare is a leaf (`vdev_draid_spare_ops`, [`vdev_draid.c#L2829-L2853`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2829-L2853)) whose `io_start` sends each write to the child of the dRAID at position `(children - 1) - spare_id` of the row of that offset ([`vdev_draid.c#L2424-L2454`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2424-L2454), [`vdev_draid.c#L2609-L2710`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2609-L2710)). The distributed spares are listed among the pool's spares, named `draid<parity>-<vdev id>-<spare id>` ([`vdev_draid.c#L1706-L1724`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L1706-L1724)).

### 17. `spa_vdev_attach`, what a spare may replace — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8279-L8293

```c
	/*
	 * log, dedup and special vdevs should not be replaced by spares.
	 */
	if ((oldvd->vdev_top->vdev_alloc_bias != VDEV_BIAS_NONE ||
	    oldvd->vdev_top->vdev_islog) && newvd->vdev_isspare) {
		return (spa_vdev_exit(spa, newrootvd, txg, ENOTSUP));
	}

	/*
	 * A dRAID spare can only replace a child of its parent dRAID vdev.
	 */
	if (newvd->vdev_ops == &vdev_draid_spare_ops &&
	    oldvd->vdev_top != vdev_draid_spare_get_parent(newvd)) {
		return (spa_vdev_exit(spa, newrootvd, txg, ENOTSUP));
	}
```

L8280-L8285: a spare (hot or distributed) is refused with `ENOTSUP` when the disk it would replace sits under a top-level vdev with a bias (special, dedup) or a log: spares stand in for normal vdevs only; a plain `zpool replace` with a new disk is allowed everywhere. L8287-L8292: a distributed spare can only replace a child of its own dRAID.

**Short excerpts for the question-first room (v1.4, ALG-191).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 18. `vdev_ops_t`, the functions every vdev type fills in — include/sys/vdev_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L104-L113

```c
	vdev_open_func_t		*vdev_op_open;
	vdev_close_func_t		*vdev_op_close;
	vdev_asize_func_t		*vdev_op_psize_to_asize;
	vdev_asize_func_t		*vdev_op_asize_to_psize;
	vdev_min_asize_func_t		*vdev_op_min_asize;
	vdev_min_alloc_func_t		*vdev_op_min_alloc;
	vdev_io_start_func_t		*vdev_op_io_start;
	vdev_io_done_func_t		*vdev_op_io_done;
	vdev_state_change_func_t	*vdev_op_state_change;
	vdev_need_resilver_func_t	*vdev_op_need_resilver;
```

Excerpt 2, cut to the slots the room talks about. L104-L105: open and close. L106-L109: size translation (a raidz turns a block's size into a larger allocated size). L110-L111: `vdev_op_io_start` and `vdev_op_io_done`, how an I/O goes on to the children and how their results come back. L113: `vdev_op_need_resilver`, whether a block touches a child that missed writes. A vdev's type is nothing but the table it points to (`vdev_ops`, excerpt 1, L241); the I/O path calls `vd->vdev_ops->vdev_op_io_start(zio)` ([zio.c L4831](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4831)).

### 19. `vdev_mirror_io_start`, one child for a read, all for a write — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L656-L669

```c
		/*
		 * For normal reads just pick one child.
		 */
		c = vdev_mirror_child_select(zio);
		children = (c >= 0);
	} else {
		ASSERT(zio->io_type == ZIO_TYPE_WRITE);

		/*
		 * Writes go to all children.
		 */
		c = 0;
		children = mm->mm_children;
	}
```

Excerpt 4 up to the choice of children. L656-L660: a normal read picks one child (`vdev_mirror_child_select`, which skips a child missing the block's txg). L662-L668: a write goes to every child; the loop that follows issues one child zio per child (excerpt 4, L689-L692). The replacing and spare tables use this function (excerpt 22).

### 20. `spa_preferred_class`, the choice of class — module/zfs/spa_misc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2149-L2178

```c
	if (DMU_OT_IS_DDT(objtype)) {
		if (spa_has_dedup(spa) && !tried_dedup && !tried_special)
			return (spa_dedup_class(spa));
		else if (spa_special_has_ddt(spa) && !tried_special)
			return (spa_special_class(spa));
		else
			return (spa_normal_class(spa));
	}

	if (!spa_has_special(spa) || tried_special)
		return (spa_normal_class(spa));

	if (DMU_OT_IS_METADATA(objtype) ||
	    (zfs_user_indirect_is_special && zp->zp_level > 0))
		return (spa_special_class(spa));

	/*
	 * Allow small blocks in special class.  However, leave a reserve of
	 * zfs_special_class_metadata_reserve_pct exclusively for metadata.
	 */
	if (zio->io_size <= zp->zp_zpl_smallblk) {
		metaslab_class_t *special = spa_special_class(spa);
		uint64_t limit = metaslab_class_get_space(special) *
		    (100 - zfs_special_class_metadata_reserve_pct) / 100;

		if (metaslab_class_get_alloc(special) < limit)
			return (special);
	}

	return (spa_normal_class(spa));
```

Excerpts 10 and 11 without the preamble. L2149-L2156: a DDT block goes to dedup if the pool has one, else to special if the pool keeps the DDT there, else to normal; a class already tried is skipped. L2158-L2159: no special vdev, or special already tried: normal. L2161-L2163: metadata, and the indirect blocks of files, go to special. L2169-L2176: a block no larger than `special_small_blocks` (`zp_zpl_smallblk`) goes to special while special has allocated less than 75% of its space (`zfs_special_class_metadata_reserve_pct` = 25, [spa_misc.c L448](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L448)). L2178: the rest to normal. ZIL blocks never come here (L2147).

### 21. `zio_dva_allocate`, a full class — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4404-L4407

```c
	/*
	 * Fall back to some other class when this one is full.
	 */
	if (error == ENOSPC && (newmc = spa_preferred_class(spa, zio)) != mc) {
```

Excerpt 12's last lines. When the class answers `ENOSPC`, `spa_preferred_class` is asked again; it now knows which class was tried, so it returns the next one, and the allocation starts over there ([L4430-L4444](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4430-L4444)).

### 22. `metaslab_alloc_dva_range`, the next copy on the next vdev — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5420-L5427

```c
	if (mg == NULL && d != 0) {
		vd = vdev_lookup_top(spa, DVA_GET_VDEV(&dva[d - 1]));
		mg = vdev_get_mg(vd, mc)->mg_next;
	}
	if (mg == NULL || mg->mg_class != mc || mg->mg_activation_count <= 0) {
		ASSERT(mca->mca_rotor != NULL);
		mg = mca->mca_rotor;
	}
```

Excerpt 13 without its comment and the gang hint. L5420-L5423: DVA `d` starts at the metaslab group after the one of DVA `d - 1`, the next top-level vdev of the class (the groups of a class form a ring). L5424-L5427: the first DVA, or a group that is not usable, starts at the class's rotor, which moves on by load and free space (the metaslabs room). A class of one vdev puts every copy on it.

### 23. `vdev_replacing_ops`, the mirror's functions — module/zfs/vdev_mirror.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L1000-L1007

```c
	.vdev_op_open = vdev_mirror_open,
	.vdev_op_close = vdev_mirror_close,
	.vdev_op_psize_to_asize = vdev_default_asize,
	.vdev_op_asize_to_psize = vdev_default_psize,
	.vdev_op_min_asize = vdev_default_min_asize,
	.vdev_op_min_alloc = NULL,
	.vdev_op_io_start = vdev_mirror_io_start,
	.vdev_op_io_done = vdev_mirror_io_done,
```

Excerpt 5, the slots that matter. L1000-L1001: the mirror's open and close. L1002-L1004: default size translation, as a mirror. L1006-L1007: the mirror's `io_start` and `io_done`: a write to a replacing node goes to the old disk and the new one, a read to one of them. `vdev_spare_ops` fills the same slots ([L1023-L1047](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_mirror.c#L1023-L1047)).

### 24. `vdev_add_parent`, the new node in the old disk's place — module/zfs/vdev.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1439-L1446

```c
	vdev_remove_child(pvd, cvd);
	vdev_add_child(pvd, mvd);
	cvd->vdev_id = mvd->vdev_children;
	vdev_add_child(mvd, cvd);
	vdev_top_update(cvd->vdev_top, cvd->vdev_top);

	if (mvd == mvd->vdev_top)
		vdev_top_transfer(cvd, mvd);
```

Excerpt 8, the tree surgery. L1439-L1440: the old disk leaves its parent and the new node takes its place (with its `vdev_id`, L1426). L1441-L1442: the old disk becomes the new node's child 0; `spa_vdev_attach` then adds the new disk after it ([spa.c L8449-L8454](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L8449-L8454)). L1445-L1446: if the old disk was a top-level vdev, the new node becomes the top-level vdev and takes over its metaslabs, group and bias.

### 25. `spa_vdev_resilver_done_hunt`, the end of a replacement — module/zfs/spa.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L9446-L9455

```c
	if (vd->vdev_ops == &vdev_replacing_ops) {
		ASSERT(vd->vdev_children > 1);

		newvd = vd->vdev_child[vd->vdev_children - 1];
		oldvd = vd->vdev_child[0];

		if (vdev_dtl_empty(newvd, DTL_MISSING) &&
		    vdev_dtl_empty(newvd, DTL_OUTAGE) &&
		    !vdev_dtl_required(oldvd))
			return (oldvd);
```

Excerpt 9 without the comment. L9449-L9450: the newest disk is the last child, the oldest the first. L9452-L9455: when the new disk misses no txg and the old one is not needed, the old disk is returned to be detached; the replacing node, left with one child, is removed (`vdev_remove_parent`). A spare node is not collapsed here (it is handled below, L9462-L9480).

### 26. `vdev_draid_map_alloc_row`, the child of each column — module/zfs/vdev_draid.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L1047-L1053

```c
		uint64_t c = (groupstart + i) % ndisks;

		/* increment the offset if we wrap to the next row */
		if (i == wrap)
			physical_offset += VDEV_DRAID_ROWHEIGHT;

		rc->rc_devidx = vdev_draid_permute_id(vdc, base, iter, c);
```

Excerpt 16, the placement. L1047: column `i` of a group is position `(groupstart + i) mod ndisks` in the row. L1049-L1051: a group that runs past the end of a row goes on in the next one. L1053: the child is the permutation's entry at that position (`vdev_draid_permute_id`), so each row of the table puts the group on a different set of children.

**What the animation shows.** (Simplifications and why they stay faithful: `DECISIONS.md` D11.2.)

- (2D, and 3D when WebGL is available) The pool as a tree from `spa_root_vdev` ([`spa_impl.h#L265`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa_impl.h#L265)): the root, the top-level vdevs (a mirror, a raidz1 of three disks, a draid1:2d:5c:1s of five, and, at the visitor's choice, a mirror as log, a mirror as special, a disk as dedup), and the leaves. Each node shows its `vdev_op_type`, and its ops table on demand: `vdev_op_io_start`, `vdev_op_io_done`, `vdev_op_psize_to_asize`, `vdev_op_need_resilver`, `vdev_op_leaf` — excerpts 1 and 2, the tables of excerpt 2's notes, excerpt 5. "Log", "special" and "dedup" are not types: they are the bias of a top-level vdev, which picks its class — excerpt 3.
- Hot spares and the cache device beside the tree, not in it: `spa_spares`, with the dRAID's distributed spare, and `spa_l2cache` — [`spa_impl.h#L284-L285`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa_impl.h#L284-L285), excerpt 16's last note.
- The visitor drops a block of one of five kinds: a ZIL block, metadata (a dnode block), a DDT block, a small file block (4 KiB), a large file block (128 KiB). The figure shows the class chosen and why (excerpts 10 to 12, and `zio_alloc_zil` for the ZIL), with or without log, special and dedup vdevs, `special_small_blocks` at 0 or 16 KiB, and the special class under 75%, over 75% or full; then the DVAs (excerpt 13).
- The write walks down: the logical zio fans out over the DVAs with the mirror's function (excerpt 4's note), each top-level vdev's `io_start` fans out its way: a mirror, replacing or spare node to every child (excerpt 4), a raidz to one column per child, fewer for a small block (`vdev_raidz_map_alloc`, RAID-Z room excerpts 1 and 4), a dRAID to the `groupwidth` children of the group's permutation row (excerpts 14 to 16), a distributed spare to the child holding the spare space (excerpt 16); the leaves issue the disk I/O (`vdev_disk_io_start`).
- "Read it back": the logical zio reads one DVA; a mirror reads one child; a raidz or dRAID reads its data columns; a replacing or spare node skips the new disk for blocks it is missing (excerpts 4 and 7).
- Replace a disk: the leaf becomes a `replacing` node with old and new disk (excerpts 6 to 8); a hot spare gives a `spare` node; on a dRAID child, the distributed spare can be used. "Resilver done": a replacing node collapses to the new disk, a spare node stays (excerpt 9). Replacing a top-level disk makes the new node the top-level vdev (excerpt 8, L1445-L1446).
- Left out: indirect (removed) vdevs, holes, `missing` vdevs, RAID-Z expansion, the rebuild (sequential resilver) itself, gang blocks, and the metaslab allocator's choice of a vdev within a class (the metaslabs room).

**Facts for the text**
- Four allocation biases: `VDEV_BIAS_NONE`, `VDEV_BIAS_LOG` ("dedicated to ZIL data (SLOG)"), `VDEV_BIAS_SPECIAL` ("ddt, metadata, and small blks"), `VDEV_BIAS_DEDUP` — [`include/sys/vdev_impl.h#L158-L163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L158-L163).
- The pool holds one metaslab class pointer per class, six: normal, log, embedded log, special, special embedded log, dedup — [`include/sys/spa_impl.h#L248-L253`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa_impl.h#L248-L253).
- Special class keeps 25% reserved for metadata: `zfs_special_class_metadata_reserve_pct = 25` — [`module/zfs/spa_misc.c#L448`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L448); DDT data and user indirect blocks go to special by default (`zfs_ddt_data_is_special`, `zfs_user_indirect_is_special` = B_TRUE) — [`module/zfs/spa_misc.c#L440-L441`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L440-L441).
- `vdev_ops_t` has 22 operation slots plus the type name and leaf flag — [`include/sys/vdev_impl.h#L101-L126`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_impl.h#L101-L126).
- dRAID permutation constants: seed `0xd7a1d5eed`, at most 254 maps, row height `1 << SPA_MAXBLOCKSHIFT` (16 MiB, with `SPA_MAXBLOCKSHIFT 24`) — [`include/sys/vdev_draid.h#L45-L48`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_draid.h#L45-L48), [`include/sys/fs/zfs.h#L1959`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/fs/zfs.h#L1959).
- The ops tables of the figure's types, from the tables listed in excerpt 2's notes: `root`: no `io_start`, no `io_done`; `mirror`, `replacing`, `spare`: `vdev_mirror_io_start`, `vdev_mirror_io_done`, `vdev_default_asize`, `vdev_default_need_resilver`; `raidz`: `vdev_raidz_io_start`, `vdev_raidz_io_done`, `vdev_raidz_psize_to_asize`, `vdev_raidz_need_resilver`; `draid`: `vdev_draid_io_start`, `vdev_draid_io_done`, `vdev_draid_psize_to_asize`, `vdev_draid_need_resilver`; `disk` (Linux): `vdev_disk_io_start`, `vdev_disk_io_done`, `vdev_default_asize`, no `need_resilver`, leaf; `dspare`: `vdev_draid_spare_io_start`, `vdev_draid_spare_io_done`, `vdev_default_asize`, leaf ([`vdev_draid.c#L2829-L2853`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2829-L2853)).
- Type names: `root`, `mirror`, `replacing`, `raidz`, `draid`, `dspare`, `disk`, `file`, `missing`, `hole`, `spare`, `log`, `l2cache`, `indirect` — [`zfs.h#L914-L927`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/fs/zfs.h#L914-L927). `log` and `l2cache` name configuration lists, not ops tables.
- dRAID: rows of 16 MiB (`VDEV_DRAID_ROWHEIGHT`, [`vdev_draid.h#L45-L48`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_draid.h#L45-L48)); groups of `groupwidth = ndata + nparity` children; `ndisks = children - nspares` ([`vdev_draid.c#L2291-L2294`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_draid.c#L2291-L2294)). For draid1:2d:5c:1s: `groupwidth` 3, `ndisks` 4, `ngroups` 4.
- The special class keeps 25% for metadata (`zfs_special_class_metadata_reserve_pct`, [`spa_misc.c#L443-L448`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L443-L448)).
- The embedded log metaslab is set aside only on normal and special vdevs with more than `zfs_embedded_slog_min_ms` (64) metaslabs — [`module/zfs/vdev.c#L82-L88`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L82-L88), [`module/zfs/vdev.c#L1689-L1696`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1689-L1696). A dedup vdev has a `vdev_log_mg` (excerpt 3) but never receives that metaslab, so ZIL blocks never land on it; the figure takes its normal and special vdevs to be large enough (D11.2).

**Hand-checked cases** (the unit tests replay them). Pool: mirror-0 (sda, sdb), raidz1-1 (sdc, sdd, sde), draid1:2d:5c:1s-2 (children 0 to 4: sdf to sdj); ashift 12.

- *Classes, no log, no special, no dedup.* ZIL: no log class, no special embedded log, no special, so the embedded log class, which holds the three normal vdevs; 1 DVA. Metadata: no special, normal, 2 DVAs on two consecutive normal vdevs. DDT: no dedup, no special, normal, 3 DVAs, one on each normal vdev. Small and large file blocks: normal, 1 DVA.
- *With a log mirror and a special mirror, `special_small_blocks=0`.* ZIL: log class. Metadata: special, 2 DVAs, both on the one special mirror (the class has one vdev, so `mg_next` is itself). DDT: special (`spa_special_has_ddt`), 3 DVAs on it. Small file block (4 KiB): 4,096 ≤ 0 is false, normal. Large: normal. Without the log: ZIL to the special embedded log class, on the special mirror.
- *`special_small_blocks=16K`.* Small: special while under 75%; over 75%: normal, not tried; large (128 KiB > 16 KiB): normal. Special full: metadata tries special, `ENOSPC`, then `spa_preferred_class` with special tried gives normal; a DDT block without a dedup vdev, the same; with a dedup vdev, DDT goes to dedup first and is not affected.
- *Mirror.* A write of a block on mirror-0 goes to sda and sdb; a read to one of them.
- *raidz1 of three, 128 KiB at offset 0.* 32 sectors, `q` 16, `r` 0: three columns of 16 sectors, P on child 0 (sdc), D0 on sdd, D1 on sde; a read reads sdd and sde. A 4 KiB block (1 sector): `q` 0, `r` 1, `bc` 2: two columns, P and D0, on two of the three children, plus a skip sector if the allocation leaves one.
- *dRAID, 5 children.* The generated map's checksum is `0x2a1648d74`, the one in the table. Rows 0 to 2 of the map: 2 3 1 4 0; 0 3 4 1 2; 1 2 4 0 3. Group 0: permutation 0, start 0: P on child 2 (sdh), D0 on child 3 (sdi), D1 on child 1 (sdg); spare space on child 0 (sdf). Group 1: start 3, wraps after one column: P on child 4 (sdj), D0 on child 2, D1 on child 3. Group 4: permutation 1 (row 0 rotated by 1), start 0: P on child 3, D0 on child 4, D1 on child 2; spare space on child 1. Group 5: P on child 0 (sdf), D0 on child 3, D1 on child 4. A 4 KiB block in a group: P and D0 one sector each, D1 a skip sector; written to all three children, read from D0's only.
- *Replace sdd (raidz1-1, child 1).* raidz1-1's children become sdc, replacing-1, sde; replacing-1's are sdd, then the new disk. A write's column for child 1 goes to replacing-1, then to both disks. A block born before the replacement is read from sdd (the new disk is missing it). After the resilver: sdc, the new disk, sde.
- *Hot spare for sda.* mirror-0's children become spare-0, sdb; spare-0's are sda and the hot spare, which is marked in use. After the resilver, spare-0 stays.
- *Replace the dedup disk (a top-level disk).* The replacing node becomes the top-level vdev, keeps the dedup bias, and a DDT block lands on it; after the resilver the new disk is the top-level vdev.
- *Distributed spare for sdf (draid child 0).* Child 0 becomes spare-0 with sdf and draid1-2-0. Group 5 has a column on child 0: the write goes to sdf and to draid1-2-0, which sends it to child 1 (sdg), the child holding the spare space of permutation 1.

## Room: RAID-Z

**Problem.** Classic RAID-5 updates a stripe in place: new data and new parity are written to the same disks, at the same offsets, as two separate writes. A crash between them leaves a stripe whose parity no longer matches its data, and nothing on disk says which is wrong (the "write hole"); a later disk failure reconstructs garbage silently. Small writes also force a read-modify-write of the whole stripe. RAID-Z avoids both by never updating a stripe: each block gets its own stripe, sized to the block.

**The idea in the code.**
- `vdev_raidz_map_alloc` in [`module/zfs/vdev_raidz.c#L612`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L612) — cuts one block (one zio) into columns: a variable-width stripe made for that block alone.
- `vdev_raidz_psize_to_asize` in [`module/zfs/vdev_raidz.c#L2306`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2306) — the allocator's view: data sectors + parity sectors, rounded up to a multiple of nparity + 1.
- `vdev_raidz_combrec` in [`module/zfs/vdev_raidz.c#L3502`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3502) — when the parent's checksum fails and no disk reported an error, try every combination of up to nparity "guilty" children until the checksum verifies.

**Excerpts.**

### 1. `vdev_raidz_map_alloc` — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L615-L649

```c
	raidz_row_t *rr;
	/* The starting RAIDZ (parent) vdev sector of the block. */
	uint64_t b = zio->io_offset >> ashift;
	/* The zio's size in units of the vdev's minimum sector size. */
	uint64_t s = zio->io_size >> ashift;
	/* The first column for this stripe. */
	uint64_t f = b % dcols;
	/* The starting byte offset on each child vdev. */
	uint64_t o = (b / dcols) << ashift;
	uint64_t acols, scols;

	raidz_map_t *rm =
	    kmem_zalloc(offsetof(raidz_map_t, rm_row[1]), KM_SLEEP);
	rm->rm_nrows = 1;

	/*
	 * "Quotient": The number of data sectors for this stripe on all but
	 * the "big column" child vdevs that also contain "remainder" data.
	 */
	uint64_t q = s / (dcols - nparity);

	/*
	 * "Remainder": The number of partial stripe data sectors in this I/O.
	 * This will add a sector to some, but not all, child vdevs.
	 */
	uint64_t r = s - q * (dcols - nparity);

	/* The number of "big columns" - those which contain remainder data. */
	uint64_t bc = (r == 0 ? 0 : r + nparity);

	/*
	 * The total number of data and parity sectors associated with
	 * this I/O.
	 */
	uint64_t tot = s + nparity * (q + (r == 0 ? 0 : 1));
```

L617-L623: everything is in sectors of `1 << ashift`. `b` is the block's starting sector on the raidz vdev's address space, `s` its size in sectors (the zio was already padded to a whole sector in `zio_vdev_io_start`, [`module/zfs/zio.c#L4718-L4729`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4718-L4729)). The raidz address space is interleaved sector by sector across the `dcols` children, so the block starts on child `f = b % dcols` at child byte offset `o = (b / dcols) << ashift`. L634: `q = s / (dcols - nparity)` full sectors per column. L640: `r = s - q * (dcols - nparity)` leftover data sectors. L643: `bc = (r == 0 ? 0 : r + nparity)` "big columns" get one extra sector; the parity columns are always among them, because parity must cover the longest data column. L649: `tot = s + nparity * (q + (r == 0 ? 0 : 1))` sectors are written in total. This one map is the whole stripe for the whole block: there is no notion of a fixed stripe shared with other blocks. (For a raidz that is not being expanded, `rm_nrows` is always 1, L628.)

### 2. `vdev_raidz_psize_to_asize` — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2305-L2317

```c
static uint64_t
vdev_raidz_psize_to_asize(vdev_t *vd, uint64_t psize, uint64_t txg)
{
	vdev_raidz_t *vdrz = vd->vdev_tsd;
	uint64_t asize;
	uint64_t ashift = vd->vdev_top->vdev_ashift;
	uint64_t nparity = vdrz->vd_nparity;

	uint64_t cols = vdev_raidz_get_logical_width(vdrz, txg);

	asize = ((psize - 1) >> ashift) + 1;
	asize += nparity * ((asize + cols - nparity - 1) / (cols - nparity));
	asize = roundup(asize, nparity + 1) << ashift;
```

The space the allocator reserves for a block of `psize` bytes, with `cols` children (the logical width; equal to the number of children unless the vdev was expanded) and `nparity` parity. L2315: data sectors, `ceil(psize / sector)`. L2316: add `nparity` parity sectors per started row of `cols - nparity` data sectors, i.e. `nparity * ceil(data / (cols - nparity))`. L2317: round the total up to a multiple of `nparity + 1`. That roundup is the padding: the extra sectors become "skip sectors" in the map, `rm_nskip = roundup(tot, nparity + 1) - tot` ([L699](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L699)). The comment at [L2284-L2286](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2284-L2286) gives the reason indirectly: a leftover gap smaller than nparity + 1 sectors "can't store data or parity", so allocations are kept in multiples of nparity + 1 and no unusable hole is left between blocks. Worked examples, both checked against the two functions: raidz2, 6 children, 4K sectors, 20K block: s = 5, q = 1, r = 1, bc = 3, tot = 9; asize = 5 + 2 * ceil(5/4) = 9, roundup(9, 3) = 9, no skip. raidz1, 5 children, 8K block: s = 2, q = 0, r = 2, bc = 3, tot = 3; asize = 2 + 1 * ceil(2/4) = 3, roundup(3, 2) = 4, one skip sector.

### 3. `vdev_raidz_combrec` — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3523-L3558

```c
	for (int num_failures = 1; num_failures <= nparity; num_failures++) {
		int tstore[VDEV_RAIDZ_MAXPARITY + 2];
		int *ltgts = &tstore[1]; /* value is logical child ID */


		/*
		 * Determine number of logical children, n.  See comment
		 * above raidz_simulate_failure().
		 */
		int n = 0;
		for (int w = physical_width;
		    w >= original_width; w--) {
			n += w;
		}

		ASSERT3U(num_failures, <=, nparity);
		ASSERT3U(num_failures, <=, VDEV_RAIDZ_MAXPARITY);

		/* Handle corner cases in combrec logic */
		ltgts[-1] = -1;
		for (int i = 0; i < num_failures; i++) {
			ltgts[i] = i;
		}
		ltgts[num_failures] = n;

		for (;;) {
			int err = raidz_reconstruct(zio, ltgts, num_failures,
			    nparity);
			if (err == EINVAL) {
				/*
				 * Reconstruction not possible with this #
				 * failures; try more failures.
				 */
				break;
			} else if (err == 0)
				return (0);
```

Reached from `vdev_raidz_io_done` only after the block's checksum failed, every column has been read, and no child reported enough I/O errors to explain it ([L3959](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3959)). L3523: try 1 failed child, then 2, up to `nparity`. L3532-L3536: `n` logical children (the sum of all past widths if the vdev was expanded; just the child count otherwise). L3542-L3546: start with targets 0..num_failures-1, sentinels at both ends. L3549: `raidz_reconstruct` pretends those children are dead, rebuilds their columns from parity and asks the checksum again ([L3399](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3399)); success returns 0 and the bad columns are reported and repaired. The loop that follows (L3560-L3594) enumerates the next combination; the big comment above the function ([L3467-L3490](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3467-L3490)) lists the order for a 6-wide RAIDZ3. Without a checksum in the parent block pointer this search would have no oracle: parity alone cannot tell which column lied.

### 4. `vdev_raidz_map_alloc`, the columns — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L677-L700

```c
	for (uint64_t c = 0; c < scols; c++) {
		raidz_col_t *rc = &rr->rr_col[c];
		uint64_t col = f + c;
		uint64_t coff = o;
		if (col >= dcols) {
			col -= dcols;
			coff += 1ULL << ashift;
		}
		rc->rc_devidx = col;
		rc->rc_offset = coff;

		if (c >= acols)
			rc->rc_size = 0;
		else if (c < bc)
			rc->rc_size = (q + 1) << ashift;
		else
			rc->rc_size = q << ashift;

		asize += rc->rc_size;
	}

	ASSERT3U(asize, ==, tot << ashift);
	rm->rm_nskip = roundup(tot, nparity + 1) - tot;
	rm->rm_skipstart = bc;
```

L677-L686: column `c` lives on child `f + c`, at child sector `o`; past the last child it wraps to child 0, one sector lower (`coff += 1 << ashift`). L688-L693: a column past `acols` has no data (it only carries a skip sector), the first `bc` columns have `q + 1` sectors, the others `q`. L698: the sizes add up to `tot`. L699-L700: the padding, `roundup(tot, nparity + 1) - tot` skip sectors, placed from column `bc` on. Where exactly they land is in `vdev_raidz_map_alloc_write` ([L509-L580](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L509-L580)): one zero-filled sector after each column from `rm_skipstart`, wrapping onto the parity columns when the stripe runs out of columns (`nwrapped`, L511-L516), and the columns past `acols` count as one skip each (L523). Put together, the block's columns and skip sectors cover exactly `asize` consecutive sectors of the raidz address space, in which child `d`, sector `k` is sector `k * dcols + d` (checked for every input of the figure by `scripts/test/raidz-model.test.mjs`).

### 5. `vdev_raidz_need_resilver` — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L4011-L4037

```c
	uint64_t s = ((psize - 1) >> ashift) + 1;
	/* The first column for this stripe. */
	uint64_t f = b % dcols;

	/* Unreachable by sequential resilver. */
	ASSERT3U(phys_birth, !=, TXG_UNKNOWN);

	if (!vdev_dtl_contains(vd, DTL_PARTIAL, phys_birth, 1))
		return (B_FALSE);

	if (s + nparity >= dcols)
		return (B_TRUE);

	for (uint64_t c = 0; c < s + nparity; c++) {
		uint64_t devidx = (f + c) % dcols;
		vdev_t *cvd = vd->vdev_child[devidx];

		/*
		 * dsl_scan_need_resilver() already checked vd with
		 * vdev_dtl_contains(). So here just check cvd with
		 * vdev_dtl_empty(), cheaper and a good approximation.
		 */
		if (!vdev_dtl_empty(cvd, DTL_PARTIAL))
			return (B_TRUE);
	}

	return (B_FALSE);
```

Called for each block a resilver visits (below). L4018-L4019: if the raidz vdev's DTL (the txgs some child missed) does not contain the block's birth txg, nothing to do. L4021-L4022: a block that spans at least as many columns as there are children touches every child: resilver it. L4024-L4035: otherwise, only if one of the `s + nparity` children from `f` on has a dirty DTL. The comment at L4030-L4032 calls the per-child test "a good approximation".

**Short excerpts for the question-first room (v1.4, ALG-187).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 6. `vdev_raidz_map_alloc`, the counts — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L634-L649

```c
	uint64_t q = s / (dcols - nparity);

	/*
	 * "Remainder": The number of partial stripe data sectors in this I/O.
	 * This will add a sector to some, but not all, child vdevs.
	 */
	uint64_t r = s - q * (dcols - nparity);

	/* The number of "big columns" - those which contain remainder data. */
	uint64_t bc = (r == 0 ? 0 : r + nparity);

	/*
	 * The total number of data and parity sectors associated with
	 * this I/O.
	 */
	uint64_t tot = s + nparity * (q + (r == 0 ? 0 : 1));
```

Excerpt 1 from its quotient on. L634: `q`, the full rows of data. L640: `r`, the data sectors left over. L643: `bc`, the "big columns" that get one sector more: the `r` columns of remainder data and the `nparity` parity columns, which must be as long as the longest data column. L649: `tot`, data plus parity, the sectors written for this block. Nothing here depends on any other block: the stripe is made for this one.

### 7. `vdev_raidz_psize_to_asize`, the rounding — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2315-L2317

```c
	asize = ((psize - 1) >> ashift) + 1;
	asize += nparity * ((asize + cols - nparity - 1) / (cols - nparity));
	asize = roundup(asize, nparity + 1) << ashift;
```

Excerpt 2, the arithmetic alone. L2315: data sectors. L2316: `nparity` parity sectors for each started row of `cols - nparity` data sectors. L2317: rounded up to a multiple of `nparity + 1`; the extra sectors are the skip sectors of the map (`rm_nskip`, [L699](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L699)). A one-sector block costs `nparity + 1` sectors whatever the width ([L2302-L2303](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2302-L2303)).

### 8. `vdev_raidz_io_start_read_row`, the columns a read asks for — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2573-L2588

```c
	for (int c = rr->rr_cols - 1; c >= 0; c--) {
		raidz_col_t *rc = &rr->rr_col[c];
		vdev_t *cvd = vd->vdev_child[rc->rc_devidx];

		if (rc->rc_error || rc->rc_size == 0)
			continue;

		if (forceparity ||
		    c >= rr->rr_firstdatacol || rr->rr_missingdata > 0 ||
		    (zio->io_flags & (ZIO_FLAG_SCRUB | ZIO_FLAG_RESILVER))) {
			zio_nowait(zio_vdev_child_io(zio, NULL, cvd,
			    rc->rc_offset, rc->rc_abd, rc->rc_size,
			    zio->io_type, zio->io_priority, 0,
			    vdev_raidz_child_done, rc));
		}
	}
```

L2577-L2578: a column whose child is gone (`rc_error` set just above, [L2522-L2531](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2522-L2531)) or that holds no data is not read. L2580-L2582: parity columns (`c < rr_firstdatacol`) are read only when a data column is missing (`rr_missingdata`), for a scrub or a resilver, or when parity is forced. A normal read of a healthy block reads its data columns and nothing else.

### 9. `vdev_raidz_combrec`, the combinations — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3542-L3558

```c
		ltgts[-1] = -1;
		for (int i = 0; i < num_failures; i++) {
			ltgts[i] = i;
		}
		ltgts[num_failures] = n;

		for (;;) {
			int err = raidz_reconstruct(zio, ltgts, num_failures,
			    nparity);
			if (err == EINVAL) {
				/*
				 * Reconstruction not possible with this #
				 * failures; try more failures.
				 */
				break;
			} else if (err == 0)
				return (0);
```

Inside the loop over `num_failures`, from 1 to `nparity` ([L3523](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3523)). L3542-L3546: the first combination is children 0 to `num_failures - 1`, with sentinels at both ends. L3549: `raidz_reconstruct` treats those children as wrong, rebuilds their data columns from parity and checks the parent's checksum again ([L3399](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3399)). L3551-L3556: `EINVAL`, more columns dead than parity can rebuild ([L3385-L3392](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3385-L3392)): try more failures. L3557-L3558: 0, the checksum verifies; the columns found wrong are then marked `ECKSUM` ([L3403-L3428](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3403-L3428)) and rewritten with the good data ([L3166-L3210](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3166-L3210)). The next combination is computed below ([L3560-L3598](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3560-L3598)), in the order the comment above the function lists ([L3467-L3490](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3467-L3490)).

### 10. `vdev_raidz_need_resilver`, the test — module/zfs/vdev_raidz.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L4018-L4035

```c
	if (!vdev_dtl_contains(vd, DTL_PARTIAL, phys_birth, 1))
		return (B_FALSE);

	if (s + nparity >= dcols)
		return (B_TRUE);

	for (uint64_t c = 0; c < s + nparity; c++) {
		uint64_t devidx = (f + c) % dcols;
		vdev_t *cvd = vd->vdev_child[devidx];

		/*
		 * dsl_scan_need_resilver() already checked vd with
		 * vdev_dtl_contains(). So here just check cvd with
		 * vdev_dtl_empty(), cheaper and a good approximation.
		 */
		if (!vdev_dtl_empty(cvd, DTL_PARTIAL))
			return (B_TRUE);
	}
```

Excerpt 5 without its first lines (the sizes) and its last. L4018-L4019: the block was born outside the txgs some child missed: nothing to do. L4021-L4022: a block as wide as the vdev touches every child. L4024-L4035: otherwise, only if one of its `s + nparity` children from `f` on missed writes.

**Resilver, as far as this room goes.** A healing resilver is a scan of the block tree, not of the disk. `dsl_scan_recurse` reads an indirect block and calls `dsl_scan_visitbp` on each block pointer in it ([module/zfs/dsl_scan.c#L2248-L2255](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L2248-L2255)); `dsl_scan_visitbp` ends by calling the scan function on the block ([module/zfs/dsl_scan.c#L2440](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L2440)), `dsl_scan_scrub_cb`, which skips a block born outside the scan's txg window ([module/zfs/dsl_scan.c#L4844-L4848](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L4844-L4848)) and, for a resilver, asks whether the block needs I/O ([module/zfs/dsl_scan.c#L4878-L4880](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L4878-L4880)): `dsl_scan_need_resilver` → `vdev_dtl_need_resilver` ([module/zfs/dsl_scan.c#L3805](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L3805), [module/zfs/vdev.c#L3184-L3194](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L3184-L3194)) → excerpt 5. For a healing resilver the window is the txg range of the DTLs: `vdev_resilver_needed(spa->spa_root_vdev, &scn_min_txg, &scn_max_txg)` ([module/zfs/dsl_scan.c#L914-L915](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L914-L915)). So the free space of a disk is never read or written by a resilver, and a block written while a child was healthy is skipped. The room says no more than this about resilver; the scan's queues, sorting and pacing are left to a later room.

**The read path, as the figure runs it.** All in module/zfs/vdev_raidz.c.
- First read: `vdev_raidz_io_start_read_row` marks a child that cannot be read as an error (`ENXIO`, [L2522-L2531](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2522-L2531)) and issues only the data columns, unless a data column is missing, a scrub or resilver is running, or parity is forced ([L2573-L2588](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2573-L2588)). A normal read does not read parity.
- Known errors first: `vdev_raidz_io_done_reconstruct_known_missing` rebuilds the missing data columns from parity when there are no more errors than parity read ([L3712-L3739](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3712-L3739)).
- The checksum of the parent block pointer over the reassembled block ([L3865](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3865), `raidz_checksum_verify` [L2767-L2772](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2767-L2772)). If it fails, `vdev_raidz_read_all` reads every column not read yet and the I/O is redone ([L3886-L3910](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3886-L3910)); the second time through, with all columns read, `vdev_raidz_combrec` runs ([L3959](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3959)).
- Before any combination, `vdev_raidz_combrec` gives up if a row has more known errors than parity, returning the worst error ([L3510-L3520](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3510-L3520)); if no combination verifies it returns `ECKSUM` and the read is reported unrecoverable ([L3959-L3963](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3959-L3963)).
- The combinations: excerpt 3 and the enumeration below it ([L3560-L3598](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3560-L3598)). Without expansion, logical child `i` is child `i`: `raidz_simulate_failure` tests `sector_id % w == i` with `sector_id = width * row + devidx` ([L3283-L3299](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3283-L3299)). `raidz_reconstruct` counts known errors and simulated ones; more than `nparity` is `EINVAL`, which ends the search for that number of failures ([L3385-L3392](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3385-L3392), [L3551-L3557](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3551-L3557)).
- Which parity rebuilds what: `vdev_raidz_reconstruct_row` marks a parity column valid if it is neither a target nor in error ([L2094-L2115](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2094-L2115)); the rebuild uses the first valid ones in order, P, then Q, then R, for one bad data column, PQ, PR, QR for two ([L2125-L2155](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2125-L2155), and the same choice in [module/zfs/vdev_raidz_math.c#L184-L236](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz_math.c#L184-L236)).
- After success: every simulated data column is marked `ECKSUM` (a simulated parity column is not: "we don't really know if it's wrong") ([L3403-L3428](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3403-L3428)). `vdev_raidz_io_done_verified` then checks the parity it read and did not use, when there is more parity than errors to explain ([L3132-L3163](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3132-L3163); `raidz_parity_verify` regenerates parity from the good data and compares, [L2800-L2853](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2800-L2853)), and if anything unexpected was found, writes the good data back to every column in error ([L3166-L3210](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3166-L3210)). A bad parity column that a read neither needs nor checks stays as it is; a scrub reads every column ([L2580-L2582](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2580-L2582)).

**What the animation shows.**
- The visitor picks the block's physical size (`psize`, a multiple of 512 bytes), the parity (raidz1, 2, 3), the number of children and the ashift, and where the block starts (its first sector `b` on the raidz vdev). The counters `s`, `f`, `o`, `q`, `r`, `bc`, `tot`, `acols`, `scols`, `rm_nskip` appear with their values — excerpt 1, L617-L649, and excerpt 4 — and `asize` with `vdev_raidz_psize_to_asize`'s three lines (excerpt 2). `acols` and `scols` follow [L655-L662](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L655-L662); a one-sector block costs `nparity + 1` sectors whatever the width, as the comment above `vdev_raidz_psize_to_asize` says ([L2300-L2303](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2300-L2303)). The figure runs `src/lib/raidz.ts`, a transcription of those functions, so every number is the code's for those inputs.
- The map: one column per child, one row per sector from `o`. Parity columns first (P, Q, R in columns 0, 1, 2, [L121-L123](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L121-L123)), then data columns, each a contiguous run of the block's sectors (`D0` holds sectors 0 to `q` or `q - 1`, and so on: the data loop at [L548-L576](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L548-L576) hands each column the next `rc_size` bytes), then the skip sectors, hatched, where `vdev_raidz_map_alloc_write` puts them. The 1 MiB swap of raidz1 ([L725-L734](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L725-L734)) is applied when `b` falls in an odd megabyte.
- "Write the block": the data columns fill one after the other, each from top to bottom, then the parity columns, then all columns are issued together as child writes — `vdev_raidz_io_start_write` ([L2443-L2462](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2443-L2462)); parity is generated from this block's columns only ([L1141-L1156](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L1141-L1156) for P). Nothing old is read.
- No write hole: a static figure compares a RAID-5 stripe update in place with a RAID-Z block written to free space. The RAID-Z half is about copy-on-write and the txg commit (copy-on-write and transaction groups rooms), not code in `vdev_raidz.c`; the page says so.
- "Read the block": each child can be set healthy, missing or silently wrong. The figure shows the first read, the known-missing rebuild, the checksum, the read of every column, `combrec`'s combinations in its order with the outcome of each (checksum fails, `EINVAL`, or verified), the parity used, and the columns written back — the read path above. It tracks which columns are right, not their bytes: a rebuild is right exactly when every column it reads is right.
- Resilver: with the missing children back and their DTLs dirty, whether a resilver would rewrite this block — excerpt 5.
- Simplified, see `DECISIONS.md` D4.1: no expansion (one row), no dRAID, no DTL-based `ESTALE` reads, no slow-child outliers, no gang blocks, no scrub path, no draid spares, bytes not computed.

**Facts for the text**
- Maximum parity is 3: `VDEV_RAIDZ_MAXPARITY 3` — [`include/sys/fs/zfs.h#L929`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/fs/zfs.h#L929); parity columns are always the first ones, P = 0, Q = 1, R = 2 — [`module/zfs/vdev_raidz.c#L121-L123`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L121-L123), and `rr_firstdatacol = nparity` — [`module/zfs/vdev_raidz.c#L669`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L669).
- Padding: `rm_nskip = roundup(tot, nparity + 1) - tot`, starting at column `bc` — [`module/zfs/vdev_raidz.c#L699-L700`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L699-L700). A 1-sector block always costs nparity + 1 sectors, whatever the width — [`module/zfs/vdev_raidz.c#L2302-L2303`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2302-L2303).
- The map structures: `raidz_col_t` (device index, offset, size, error per column), `raidz_row_t` (`rr_cols`, `rr_scols`, `rr_bigcols`, `rr_firstdatacol`), `raidz_map_t` (`rm_nrows`, `rm_nskip`, `rm_skipstart`) — [`include/sys/vdev_raidz_impl.h#L109-L157`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/vdev_raidz_impl.h#L109-L157).
- The oracle is the parent's checksum: `raidz_checksum_verify` calls `zio_checksum_error` on the reassembled block — [`module/zfs/vdev_raidz.c#L2772`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2772).
- A raidz needs at least `nparity + 1` children: `vdev_raidz_open` fails with `EINVAL` otherwise — [module/zfs/vdev_raidz.c#L2178-L2181](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2178-L2181).
- Space cost of one block: `asize / psize`. Raidz2 on 12 children with 4K sectors: a 4K block takes 12K (3×), an 8K block 24K (3×, two skip sectors), a 40K block 48K (1.2×), a 128K block 168K (1.31×) — `vdev_raidz_psize_to_asize`, excerpt 2, checked by the unit tests.
- Skip sectors are written as zeros: in the same child I/O as their column (a gang ABD for data columns, a padded linear ABD for parity, [L526-L572](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L526-L572)), or, for a column with no data, as an optional `ZIO_FLAG_NODATA` I/O, "to improve aggregation contiguity" — `raidz_start_skip_writes` [L2481-L2506](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L2481-L2506).
- RAIDZ expansion (out of scope for this room): "An existing RAIDZ VDEV can be expanded by attaching a new disk" — [L152-L162](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L152-L162); blocks then use `vdev_raidz_map_alloc_expanded`, with several rows.
- Too many dead children: more than `nparity` faulted children makes the raidz vdev `CANT_OPEN` / `NO_REPLICAS`; any fault makes it `DEGRADED` — [`module/zfs/vdev_raidz.c#L3977-L3983`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev_raidz.c#L3977-L3983).

## Room: Snapshots and clones

**Problem.** A snapshot must freeze a whole filesystem instantly, however large it is, and must not slow down later writes. The hard part is not taking the snapshot but freeing space afterwards: when the live filesystem overwrites or deletes a block, ZFS must decide, without scanning anything, whether some snapshot still needs that block. Copying metadata or keeping per-block reference counts would make both operations proportional to the size of the data.

**The idea in the code.**
- `BP_GET_LOGICAL_BIRTH` / `BP_GET_BIRTH` in [`include/sys/spa.h#L494-L507`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L494-L507) — every block pointer records the txg in which the block was born.
- `dsl_dataset_block_kill` in [`module/zfs/dsl_dataset.c#L254`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L254) — one comparison, birth versus `ds_prev_snap_txg`, decides "free now" or "put on the deadlist".
- `dsl_dataset_snapshot_sync_impl` in [`module/zfs/dsl_dataset.c#L1725`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1725) — a snapshot is a new `dsl_dataset_phys_t` that copies the head's root block pointer `ds_bp`.
- `dsl_deadlist_insert` in [`module/zfs/dsl_deadlist.c#L464`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L464) — a deadlist is a set of entries keyed by snapshot txgs; a dead block goes into the entry of the last key below its birth.
- `dsl_dataset_create_sync_dd` in [`module/zfs/dsl_dataset.c#L1177`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1177) — a clone is a head whose `ds_bp` and `ds_prev_snap_txg` come from its origin snapshot, so the same comparison serves it.
- `dsl_destroy_snapshot_sync_impl` in [`module/zfs/dsl_destroy.c#L308`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L308) — destroying a snapshot frees whole deadlist entries chosen by key, without reading a block pointer.

**Excerpts.**

### 1. `BP_GET_LOGICAL_BIRTH` — include/sys/spa.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L481-L507

```c
/*
 * Block birth time macros for different use cases:
 * - BP_GET_LOGICAL_BIRTH(): When the block was logically modified by user.
 *   To be used with a focus on user data, like incremental replication.
 * - BP_GET_PHYSICAL_BIRTH(): When the block was physically written to disks.
 *   For regular writes is equal to logical birth.  For dedup and block cloning
 *   can be smaller than logical birth.  For remapped and rewritten blocks can
 *   be bigger. To be used with focus on physical disk content: ARC, DDT, scrub.
 * - BP_GET_RAW_PHYSICAL_BIRTH(): Raw physical birth value.  Zero if equal
 *   to logical birth.  Should only be used for BP copying and debugging.
 * - BP_GET_BIRTH(): When the block was allocated, which is a physical birth
 *   for rewritten blocks (rewrite flag set) or logical birth otherwise.
 */
#define	BP_GET_LOGICAL_BIRTH(bp)	(bp)->blk_birth_word[1]
#define	BP_SET_LOGICAL_BIRTH(bp, x)	((bp)->blk_birth_word[1] = (x))

#define	BP_GET_RAW_PHYSICAL_BIRTH(bp)	(bp)->blk_birth_word[0]
#define	BP_SET_PHYSICAL_BIRTH(bp, x)	((bp)->blk_birth_word[0] = (x))

#define	BP_GET_PHYSICAL_BIRTH(bp)					\
	(BP_IS_EMBEDDED(bp) ? 0 : 					\
	BP_GET_RAW_PHYSICAL_BIRTH(bp) ? BP_GET_RAW_PHYSICAL_BIRTH(bp) :	\
	BP_GET_LOGICAL_BIRTH(bp))

#define	BP_GET_BIRTH(bp)					\
	((BP_IS_EMBEDDED(bp) || !BP_GET_REWRITE(bp)) ?		\
	BP_GET_LOGICAL_BIRTH(bp) : BP_GET_PHYSICAL_BIRTH(bp))
```

L483-L492: the comment defines four views of birth time. Logical birth is "when the block was logically modified by user" and is the one for incremental replication; physical birth is when the data was actually written, smaller than logical for dedup and block cloning, larger for remapped and rewritten blocks. L494: logical birth lives in `blk_birth_word[1]`. L497-L503: physical birth lives in `blk_birth_word[0]`, stored as zero when equal to logical birth, so the getter falls back to the logical value. L505-L507: `BP_GET_BIRTH`, the value the snapshot code compares, is the logical birth unless the block carries the rewrite flag.

### 2. `dsl_dataset_block_kill` — module/zfs/dsl_dataset.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L294-L316

```c
	if (BP_GET_BIRTH(bp) > dsl_dataset_phys(ds)->ds_prev_snap_txg) {
		int64_t delta;

		/*
		 * Put blocks that would create IO on the pool's deadlist for
		 * dsl_process_async_destroys() to find. This is to prevent
		 * zio_free() from creating a ZIO_TYPE_FREE IO for them, which
		 * are very heavy and can lead to out-of-memory conditions if
		 * something tries to free millions of blocks on the same txg.
		 */
		boolean_t defer = spa_version(spa) >= SPA_VERSION_DEADLISTS &&
		    (BP_IS_GANG(bp) || BP_GET_DEDUP(bp) ||
		    brt_maybe_exists(spa, bp));

		if (defer) {
			dprintf_bp(bp, "putting on free list: %s", "");
			bpobj_enqueue(&ds->ds_dir->dd_pool->dp_free_bpobj,
			    bp, B_FALSE, tx);
		} else {
			dprintf_bp(bp, "freeing ds=%llu",
			    (u_longlong_t)ds->ds_object);
			dsl_free(tx->tx_pool, tx->tx_txg, bp);
		}
```

L294: the entire ownership question is this one comparison. If the block was born after the most recent snapshot of this dataset (`ds_prev_snap_txg`), no snapshot can reference it, so it is freed at once. L304-L306: gang blocks, dedup blocks and blocks that may be in the block-cloning table are not freed inline but queued on the pool's free bpobj (L308-L311), because freeing them generates I/O (the comment at L297-L303 explains why). L312-L315: the ordinary case, `dsl_free` in the current txg. Otherwise (the `else` at [`module/zfs/dsl_dataset.c#L332`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L332)) the block is still referenced by a snapshot and goes onto the head's deadlist via `dsl_deadlist_insert` at [`module/zfs/dsl_dataset.c#L344`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L344).

### 3. `dsl_dataset_snapshot_sync_impl` — module/zfs/dsl_dataset.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1760-L1785

```c
	dsobj = dmu_object_alloc(mos, DMU_OT_DSL_DATASET, 0,
	    DMU_OT_DSL_DATASET, sizeof (dsl_dataset_phys_t), tx);
	VERIFY0(dmu_bonus_hold(mos, dsobj, FTAG, &dbuf));
	dmu_buf_will_dirty(dbuf, tx);
	dsphys = dbuf->db_data;
	memset(dsphys, 0, sizeof (dsl_dataset_phys_t));
	dsphys->ds_dir_obj = ds->ds_dir->dd_object;
	dsphys->ds_fsid_guid = unique_create();
	(void) random_get_pseudo_bytes((void*)&dsphys->ds_guid,
	    sizeof (dsphys->ds_guid));
	dsphys->ds_prev_snap_obj = dsl_dataset_phys(ds)->ds_prev_snap_obj;
	dsphys->ds_prev_snap_txg = dsl_dataset_phys(ds)->ds_prev_snap_txg;
	dsphys->ds_next_snap_obj = ds->ds_object;
	dsphys->ds_num_children = 1;
	dsphys->ds_creation_time = gethrestime_sec();
	dsphys->ds_creation_txg = crtxg;
	dsphys->ds_deadlist_obj = dsl_dataset_phys(ds)->ds_deadlist_obj;
	dsphys->ds_referenced_bytes = dsl_dataset_phys(ds)->ds_referenced_bytes;
	dsphys->ds_compressed_bytes = dsl_dataset_phys(ds)->ds_compressed_bytes;
	dsphys->ds_uncompressed_bytes =
	    dsl_dataset_phys(ds)->ds_uncompressed_bytes;
	dsphys->ds_flags = dsl_dataset_phys(ds)->ds_flags;
	rrw_enter(&ds->ds_bp_rwlock, RW_READER, FTAG);
	dsphys->ds_bp = dsl_dataset_phys(ds)->ds_bp;
	rrw_exit(&ds->ds_bp_rwlock, FTAG);
	dmu_buf_rele(dbuf, FTAG);
```

L1760-L1761: one new MOS object is allocated for the snapshot. L1770-L1772: it takes over the head's link to the previous snapshot and points forward to the head (`ds_next_snap_obj = ds->ds_object`). L1775: its creation txg is the current txg. L1776: the head's deadlist object is handed to the snapshot as-is. L1777-L1780: space counters are copied. L1783: the root block pointer `ds_bp` is copied; that single 128-byte copy is what makes the snapshot share every block with the head. Nothing in the data tree is read or written.

**What decides "free now" or "deadlist", in order.** The excerpts above are the rule; the ones below are what the rule needs to be right: when a block is born, when it is killed, what a snapshot does to the deadlists, how a clone starts, and what destroying a snapshot frees. All of it was read for slice 5 (`DECISIONS.md` D5.1).

- **Birth.** A block's birth txg is set when it is allocated: `metaslab_alloc` ends with `BP_SET_BIRTH(bp, txg, 0)` [`module/zfs/metaslab.c#L6061`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L6061), and `zio_dva_allocate` passes it `zio->io_txg` [`module/zfs/zio.c#L4380-L4382`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4380-L4382). A block written in txg T is born in T; the physical birth is stored as 0, "equal to logical birth" (excerpt 1).
- **Kill.** Three callers hand an old block pointer to `dsl_dataset_block_kill`, all in syncing context: a data or indirect block rewritten (`dbuf_write_done`, `dsl_dataset_block_kill(ds, bp_orig, tx, B_TRUE)` then `dsl_dataset_block_born` [`module/zfs/dbuf.c#L5149-L5155`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dbuf.c#L5149-L5155)), the objset block that `ds_bp` points to, rewritten each txg the dataset changes (`dmu_objset_write_done` [`module/zfs/dmu_objset.c#L1535-L1543`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_objset.c#L1535-L1543)), and freed ranges, a deleted file or a truncation (`free_blocks` [`module/zfs/dnode_sync.c#L147`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dnode_sync.c#L147)). The two write callbacks pass `async = B_TRUE`: a block bound for the deadlist is parked on `ds_pending_deadlist` ([`module/zfs/dsl_dataset.c#L333-L342`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L333-L342)) and inserted by `dsl_dataset_sync_done` ([`module/zfs/dsl_dataset.c#L2292-L2293`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L2292-L2293)), which `dsl_pool_sync` calls before the sync tasks ([`module/zfs/dsl_pool.c#L784-L793`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L784-L793)). Same outcome, a few lines later.
- **The same txg.** Writes of txg T and a snapshot taken in txg T: the snapshot is a sync task, and the sync tasks run after every dirty dataset of the txg is written (excerpt 7). So a block born in T is in the snapshot of T, which is why the test of excerpt 2 is a strict `>`: born in T, killed later, it goes on the deadlist. A second snapshot of the same dataset in the same txg is refused, `EAGAIN` ("We don't allow multiple snapshots of the same txg", [`module/zfs/dsl_dataset.c#L1534-L1539`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1534-L1539)).

### 4. `dsl_deadlist_insert` — module/zfs/dsl_deadlist.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L487-L501

```c
	dle_tofind.dle_mintxg = BP_GET_BIRTH(bp);
	dle = avl_find(&dl->dl_tree, &dle_tofind, &where);
	if (dle == NULL)
		dle = avl_nearest(&dl->dl_tree, where, AVL_BEFORE);
	else
		dle = AVL_PREV(&dl->dl_tree, dle);

	if (dle == NULL) {
		zfs_panic_recover("blkptr at %p has invalid BLK_BIRTH %llu",
		    bp, (longlong_t)BP_GET_BIRTH(bp));
		dle = avl_first(&dl->dl_tree);
	}

	ASSERT3P(dle, !=, NULL);
	dle_enqueue(dl, dle, bp, bp_freed, tx);
```

A deadlist is not one list: it is an AVL tree of entries, each a bpobj (a list of block pointers) keyed by a txg, `dle_mintxg` (persisted as a ZAP from key to bpobj, `dsl_deadlist_add_key` [`module/zfs/dsl_deadlist.c#L544-L545`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L544-L545)). A key "is not inclusive" ([`module/zfs/dsl_deadlist.c#L521-L524`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L521-L524)): the entry with key `k` holds blocks born after `k` and up to the next key. L487-L492: look the birth up; on an exact match take the entry *before* it, otherwise the nearest entry before the insertion point. Either way, the block goes into the entry with the largest key strictly below its birth. L494-L498: a birth at or below every key cannot happen on a sane pool; it is reported with `zfs_panic_recover` and put in the first entry. The keys are snapshot txgs (excerpt 5), so the entry a block lands in says between which two snapshots it was born, which is what destroying a snapshot needs (excerpt 8).

### 5. `dsl_dataset_snapshot_sync_impl`, the deadlist hand-off — module/zfs/dsl_dataset.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1830-L1839

```c
	dmu_buf_will_dirty(ds->ds_dbuf, tx);
	dsl_dataset_phys(ds)->ds_deadlist_obj =
	    dsl_deadlist_clone(&ds->ds_deadlist, UINT64_MAX,
	    dsl_dataset_phys(ds)->ds_prev_snap_obj, tx);
	dsl_deadlist_close(&ds->ds_deadlist);
	VERIFY0(dsl_deadlist_open(&ds->ds_deadlist, mos,
	    dsl_dataset_phys(ds)->ds_deadlist_obj));
	dsl_deadlist_add_key(&ds->ds_deadlist,
	    dsl_dataset_phys(ds)->ds_prev_snap_txg, tx);
	dsl_bookmark_snapshotted(ds, tx);
```

Before this point the new snapshot took the head's deadlist object as its own (`dsphys->ds_deadlist_obj = dsl_dataset_phys(ds)->ds_deadlist_obj`, excerpt 3, L1776). L1831-L1833: the head gets a new deadlist, `dsl_deadlist_clone` with `maxtxg = UINT64_MAX`: one *empty* bpobj for every key of the old one ([`module/zfs/dsl_deadlist.c#L727-L737`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L727-L737)). L1837-L1838: plus one key, the head's `ds_prev_snap_txg`, which at this point is still the txg of the *previous* snapshot: it is set to this snapshot's txg only at L1883 ([`module/zfs/dsl_dataset.c#L1881-L1884`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1881-L1884)). So after snapshots taken in txgs t1 < t2 < … < tn, the head's deadlist has the keys it started with plus t1 … t(n-1), and its `ds_prev_snap_txg` is tn. A block killed in the head after tn and born at or before tn lands in the entry of the last snapshot taken before it was born, or in a starting key if it is older than t1. And each snapshot keeps the deadlist the head had until then: the blocks killed between the previous snapshot and this one, that is, blocks the previous snapshot references and this one does not.

**Where the keys start.** A filesystem is created from the pool's `$ORIGIN` snapshot: `dsl_dataset_create_sync_dd` takes `dp->dp_origin_snap` when no origin is given ([`module/zfs/dsl_dataset.c#L1186-L1187`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1186-L1187)). `$ORIGIN` is created with `crtxg = 1` ([`module/zfs/dsl_dataset.c#L1752-L1758`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1752-L1758), "The origin's ds_creation_txg has to be < TXG_INITIAL"), by `dsl_pool_create_origin`, which snapshots an empty dataset ([`module/zfs/dsl_pool.c#L1179-L1183`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L1179-L1183)): that dataset had no key ([`module/zfs/dsl_dataset.c#L1211-L1212`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1211-L1212)), so excerpt 5 gives its head one key, 0, its `ds_prev_snap_txg` before the snapshot. A new filesystem is a clone of `$ORIGIN` (excerpt 6): `ds_prev_snap_txg` 1 and the keys of the `$ORIGIN` head below 1, that is `{0}`. Its first snapshot adds key 1. Every block a user writes is born after txg 1, so entry 0 stays empty and entry 1 holds what was born before the first snapshot.

### 6. `dsl_dataset_create_sync_dd`, a clone — module/zfs/dsl_dataset.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1213-L1227

```c
	} else {
		dsl_dataset_t *ohds; /* head of the origin snapshot */

		dsphys->ds_prev_snap_obj = origin->ds_object;
		dsphys->ds_prev_snap_txg =
		    dsl_dataset_phys(origin)->ds_creation_txg;
		dsphys->ds_referenced_bytes =
		    dsl_dataset_phys(origin)->ds_referenced_bytes;
		dsphys->ds_compressed_bytes =
		    dsl_dataset_phys(origin)->ds_compressed_bytes;
		dsphys->ds_uncompressed_bytes =
		    dsl_dataset_phys(origin)->ds_uncompressed_bytes;
		rrw_enter(&origin->ds_bp_rwlock, RW_READER, FTAG);
		dsphys->ds_bp = dsl_dataset_phys(origin)->ds_bp;
		rrw_exit(&origin->ds_bp_rwlock, FTAG);
```

A clone is a new head whose origin is a snapshot. L1216-L1218: its previous snapshot is the origin, and its `ds_prev_snap_txg` the origin's creation txg. L1225-L1227: its `ds_bp` is the origin's: like a snapshot, a clone starts by copying one block pointer. Then the origin's `ds_num_children` goes up ([`module/zfs/dsl_dataset.c#L1243-L1244`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1243-L1244)), the clone's deadlist is cloned from the head of the origin's filesystem, keeping only keys below the origin's txg ([`module/zfs/dsl_dataset.c#L1246-L1251`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1246-L1251)), and the clone's `dsl_dir` records the origin in `dd_origin_obj` ([`module/zfs/dsl_dataset.c#L1264-L1265`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1264-L1265)); in memory, `dd_origin_txg` is the origin's creation txg ([`module/zfs/dsl_dir.c#L269-L270`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dir.c#L269-L270)). A write in the clone then goes through excerpt 2 with the clone's own `ds_prev_snap_txg`: a block born after the origin was written by the clone and is freed when the clone kills it; a block born at or before the origin's txg is shared with the origin and goes on the clone's deadlist. Nothing is copied when the clone diverges; it diverges by birth txg. (Livelists, a clone-only list of the blocks born after the origin, used to destroy a clone fast, are tracked at the top of `dsl_dataset_block_kill` ([`module/zfs/dsl_dataset.c#L285-L292`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L285-L292)); they change no outcome and are left out.) `zfs promote`, which swaps a clone and its origin's filesystem, is `dsl_dataset_promote_sync` ([`module/zfs/dsl_dataset.c#L3713-L3721`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L3713-L3721)); bookmarks are in `dsl_bookmark.c`. Neither is in the room.

### 7. `dsl_pool_sync`, datasets before sync tasks — module/zfs/dsl_pool.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L747-L760

```c
	/*
	 * Sync the datasets again to push out the changes due to
	 * userspace updates.  This must be done before we process the
	 * sync tasks, so that any snapshots will have the correct
	 * user accounting information (and we won't get confused
	 * about which blocks are part of the snapshot).
	 */
	rio = zio_root(dp->dp_spa, NULL, NULL, ZIO_FLAG_MUSTSUCCEED);
	while ((ds = txg_list_remove(&dp->dp_dirty_datasets, txg)) != NULL) {
		objset_t *os = ds->ds_objset;

		ASSERT(list_link_active(&ds->ds_synced_link));
		dmu_buf_rele(ds->ds_dbuf, ds);
		dsl_dataset_sync(ds, rio, tx);
```

L747-L753: every dirty dataset is written out "before we process the sync tasks, so that … we won't get confused about which blocks are part of the snapshot". The sync tasks (snapshot, clone, destroy) run at the end of `dsl_pool_sync` ([`module/zfs/dsl_pool.c#L845-L854`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_pool.c#L845-L854)), after `dsl_dataset_sync_done` has emptied the pending deadlists. Hence the order the figure follows within one txg: the writes of every dataset, each kill decided against `ds_prev_snap_txg` as it was *before* any snapshot of this txg, then the snapshots, clones and destroys, in the order they were asked for.

### 8. `dsl_destroy_snapshot_sync_impl` — module/zfs/dsl_destroy.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L387-L424

```c
	dmu_buf_will_dirty(ds_next->ds_dbuf, tx);
	dsl_dataset_phys(ds_next)->ds_prev_snap_obj =
	    dsl_dataset_phys(ds)->ds_prev_snap_obj;
	dsl_dataset_phys(ds_next)->ds_prev_snap_txg =
	    dsl_dataset_phys(ds)->ds_prev_snap_txg;
	ASSERT3U(dsl_dataset_phys(ds)->ds_prev_snap_txg, ==,
	    ds_prev ? dsl_dataset_phys(ds_prev)->ds_creation_txg : 0);

	if (ds_next->ds_deadlist.dl_oldfmt) {
		process_old_deadlist(ds, ds_prev, ds_next,
		    after_branch_point, tx);
	} else {
		/* Adjust prev's unique space. */
		if (ds_prev && !after_branch_point) {
			dsl_deadlist_space_range(&ds_next->ds_deadlist,
			    dsl_dataset_phys(ds_prev)->ds_prev_snap_txg,
			    dsl_dataset_phys(ds)->ds_prev_snap_txg,
			    &used, &comp, &uncomp);
			dsl_dataset_phys(ds_prev)->ds_unique_bytes += used;
		}

		/* Adjust snapused. */
		dsl_deadlist_space_range(&ds_next->ds_deadlist,
		    dsl_dataset_phys(ds)->ds_prev_snap_txg, UINT64_MAX,
		    &used, &comp, &uncomp);
		dsl_dir_diduse_space(ds->ds_dir, DD_USED_SNAP,
		    -used, -comp, -uncomp, tx);

		/* Move blocks to be freed to pool's free list. */
		dsl_deadlist_move_bpobj(&ds_next->ds_deadlist,
		    &dp->dp_free_bpobj, dsl_dataset_phys(ds)->ds_prev_snap_txg,
		    tx);
		dsl_dir_diduse_space(tx->tx_pool->dp_free_dir,
		    DD_USED_HEAD, used, comp, uncomp, tx);

		/* Merge our deadlist into next's and free it. */
		dsl_deadlist_merge(&ds_next->ds_deadlist,
		    dsl_dataset_phys(ds)->ds_deadlist_obj, tx);
```

Destroying snapshot S, whose next dataset N is the next snapshot or the head. L387-L391: N inherits S's previous snapshot and `ds_prev_snap_txg`. L395-L397: pools from before deadlists had keys take the old path, `process_old_deadlist`, which applies the same rule to each block ([`module/zfs/dsl_destroy.c#L129-L151`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L129-L151)); the figure follows the keyed path. L399-L413: space accounting only. L415-L418: `dsl_deadlist_move_bpobj` takes every entry of N's deadlist with a key at or above S's `ds_prev_snap_txg` and moves it to the pool's free list, `dp_free_bpobj` ("Remove entries on dl that are born > mintxg", [`module/zfs/dsl_deadlist.c#L930-L952`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L930-L952)). Those blocks were born after S's previous snapshot and killed before N: S was the only dataset referencing them. No block pointer is read to decide this; the keys alone say it. The sync thread frees what is on `dp_free_bpobj` in later txgs ([`module/zfs/dsl_scan.c#L3828-L3835`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L3828-L3835)). L422-L424: S's own deadlist, blocks killed before S and still referenced by S's previous snapshot, is merged into N's, entry by entry: `dsl_deadlist_insert_bpobj` puts each into N's entry with the same key, or the nearest key below ([`module/zfs/dsl_deadlist.c#L829-L834`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L829-L834)). Then S's deadlist is freed ([`module/zfs/dsl_destroy.c#L434-L437`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L434-L437)), and the key of S's creation txg is removed from the clones whose origin is younger than S ([`module/zfs/dsl_destroy.c#L441-L445`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L441-L445), `dsl_dir_remove_clones_key` [`module/zfs/dsl_destroy.c#L230-L232`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L230-L232)) and, when N is a snapshot, from the head ([`module/zfs/dsl_destroy.c#L475-L479`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L475-L479)): `dsl_deadlist_remove_key` merges that entry into the one before it ([`module/zfs/dsl_deadlist.c#L549-L577`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L549-L577)). A snapshot that is the origin of a clone cannot be destroyed: `ds_num_children > 1`, "Can't delete a branch point", `EEXIST` ([`module/zfs/dsl_destroy.c#L83-L87`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_destroy.c#L83-L87)).

**What the animation shows.**
- One filesystem, `fs`, its snapshots and at most one clone. Each dataset is drawn as its `ds_bp`, the root block it points to, and the data blocks under that root. Every block is labelled with its birth txg — `blk_birth_word[1]` (excerpt 1). The root stands for the whole metadata path (objset, dnodes, indirect blocks), which is rewritten and killed by the same rule (`dmu_objset_write_done`, `dbuf_write_done`, above).
- The visitor works in the open txg: write a data block, overwrite one, delete one, take a snapshot, clone a snapshot, destroy a snapshot. "Sync the txg" runs the txg in the order of excerpt 7: for each dataset that changed, the new blocks are born with the txg's number, a new root is born, and every replaced or deleted block, old root included, goes through `dsl_dataset_block_kill`: the comparison `BP_GET_BIRTH(bp) > ds_prev_snap_txg` is shown with its two numbers (excerpt 2, L294); true, the block is freed (L312-L315); false, it slides into the deadlist entry excerpt 4 picks, with that entry's key shown. A block cannot be changed twice in one txg in the figure (it is pending until the sync).
- Then the sync tasks. A snapshot appears as a new row whose `ds_bp` is the head's (excerpt 3, L1783), with the head's old deadlist; the head gets the cloned keys plus one (excerpt 5) and its `ds_prev_snap_txg` becomes the txg. A second snapshot in the same txg is refused, `EAGAIN`. A clone appears with the origin's `ds_bp`, `ds_prev_snap_txg` = the origin's txg, and the deadlist keys below it (excerpt 6). A destroy frees the entries of the next dataset's deadlist at or above the snapshot's `ds_prev_snap_txg`, merges the snapshot's deadlist into the next one, and removes the key of its txg (excerpt 8); an origin of a clone cannot be destroyed, `EEXIST`.
- "Which snapshot owns this block": the visitor selects any block still on disk and sees its birth txg, every dataset that references it, and the range of snapshots holding it: the snapshots of its filesystem taken in or after the txg of its birth and before the txg it was killed in (sync tasks run after the kills, excerpt 7, so a snapshot taken in the txg of the kill no longer holds it). For a block still live, the figure also says what a kill would do now, the test of excerpt 2 with the dataset's current `ds_prev_snap_txg`. The figure runs `src/lib/snapshots.ts`, a transcription of the functions above; its tests check that the deadlist outcomes and the range match the actual references of every dataset after random sequences.
- Simplified, see `DECISIONS.md` D5.2: one filesystem with up to four snapshots, one clone that cannot itself be snapshotted or destroyed, four data blocks per dataset; no deferred frees (gang/dedup/BRT, L304-L311), space accounting (`ds_unique_bytes`, `used`), livelists, bookmarks, promote, holds, deferred destroy, or old-format deadlists. Blocks on `dp_free_bpobj` are drawn as freed at once.

**Facts for the text**
- `dsl_dataset_phys_t` stores `ds_prev_snap_txg` right after `ds_prev_snap_obj` — [`include/sys/dsl_dataset.h#L142-L143`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L142-L143); after a snapshot the head's value is set to the snapshot's creation txg — [`module/zfs/dsl_dataset.c#L1883`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1883).
- Two birth txgs per block pointer: words 9 and a of the 16-word layout ("physical birth txg", "logical birth txg") — [`include/sys/spa.h#L147-L149`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L147-L149); physical birth is stored as 0 when equal to logical — [`include/sys/spa.h#L509-L515`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L509-L515).
- The "free now or deadlist" test is a strict `>`: a block whose birth equals `ds_prev_snap_txg` is treated as held by that snapshot — [`module/zfs/dsl_dataset.c#L294`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L294) — and it is right to be: a snapshot taken in txg T holds the blocks born in T (excerpt 7).
- A clone's `ds_prev_snap_txg` is its origin's `ds_creation_txg` — [`module/zfs/dsl_dataset.c#L1217-L1218`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1217-L1218); the clone's origin is persisted in `dd_origin_obj` — [`include/sys/dsl_dir.h#L73`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dir.h#L73).
- Deadlist entries are looked up by birth: the entry used is the one before the exact or nearest key — [`module/zfs/dsl_deadlist.c#L487-L492`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L487-L492); a birth older than every key triggers `zfs_panic_recover("... invalid BLK_BIRTH ...")` — [`module/zfs/dsl_deadlist.c#L494-L497`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_deadlist.c#L494-L497).
- `ds_num_children` is "clone/snap children; ==0 for head" — [`include/sys/dsl_dataset.h#L146`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_dataset.h#L146); a snapshot starts with 1, its successor in the chain (excerpt 3, L1772-L1773), and each clone adds one.
- One snapshot per dataset per txg: `ds_prev_snap_txg >= tx->tx_txg` returns `EAGAIN` — [`module/zfs/dsl_dataset.c#L1538-L1539`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L1538-L1539).
- Hand-checked sequence (the unit tests replay it). `fs` starts with `ds_prev_snap_txg` 1 and deadlist keys {0}. Txg 8: write A, B, C (born 8, root R8). Txg 9: snapshot `@s1` (`ds_bp` = R8; `fs` keys {0, 1}, `ds_prev_snap_txg` 9). Txg 10: overwrite A: A8 and R8 are killed, 8 > 9 is false, both go to entry 1 of `fs`'s deadlist; A10 and R10 are born. Txg 11: write D and snapshot `@s2` in the same txg: R10 is killed, 10 > 9, freed; D11 and R11 are born, then `@s2` takes `ds_bp` = R11 and the deadlist {1: A8, R8}; `fs` keys {0, 1, 9}, `ds_prev_snap_txg` 11. Txg 12: overwrite D: D11 and R11, 11 > 11 is false, entry 9 of `fs`; D11 is owned by `@s2` alone. Txg 13: destroy `@s1` (`ds_prev_snap_txg` 1): `@s2`'s entries at or above key 1 are freed (A8, R8, referenced by `@s1` alone); `@s1`'s empty deadlist merges into `@s2`'s; key 9 is removed from `fs`, its entry (D11, R11) merged into entry 1. Txg 14: clone `@s2`: `ds_bp` = R11, `ds_prev_snap_txg` 11, keys {0, 1}. Txg 15: overwrite C in the clone: C8 and R11, born at or before 11, go to the clone's entry 1, not to free space; C15 is the clone's own. Destroying `@s2` now is refused, `EEXIST`.

## Room: The ARC

**Problem.** A plain LRU cache is destroyed by one large scan: reading a big file once pushes out every block that was being reused. A plain LFU cache never forgets yesterday's hot set. The ARC keeps two lists, "seen once recently" (MRU) and "seen at least twice" (MFU), plus ghost lists that remember only the headers of recently evicted blocks; a hit in a ghost list is evidence that the corresponding list was too small, and the balance between the lists moves accordingly.

**The idea in the code.**
- `arc_access` in [`module/zfs/arc.c#L5342`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5342) — the state machine: anon -> MRU -> MFU, ghost hits back into the cache, with ghost-hit bytes counted.
- `arc_evict` in [`module/zfs/arc.c#L4460`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4460) with `arc_evict_adj` in [`module/zfs/arc.c#L4406`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4406) — converts ghost hits into three target fractions (`arc_meta`, `arc_pd`, `arc_pm`) and evicts each list down to its share of `arc_c`.
- `arc_evict_hdr` in [`module/zfs/arc.c#L3773`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3773) — evicting from MRU/MFU frees the data but keeps the header in the matching ghost state.

**Excerpts.**

### 1. `arc_access` — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5398-L5428

```c
	} else if (hdr->b_l1hdr.b_state == arc_mru) {
		/*
		 * This buffer has been accessed once recently and either
		 * its read is still in progress or it is in the cache.
		 */
		if (HDR_IO_IN_PROGRESS(hdr)) {
			hdr->b_l1hdr.b_arc_access = now;
			return;
		}
		hdr->b_l1hdr.b_mru_hits++;
		ARCSTAT_BUMP(arcstat_mru_hits);

		/*
		 * If the previous access was a prefetch, then it already
		 * handled possible promotion, so nothing more to do for now.
		 */
		if (was_prefetch) {
			hdr->b_l1hdr.b_arc_access = now;
			return;
		}

		/*
		 * If more than ARC_MINTIME have passed from the previous
		 * hit, promote the buffer to the MFU state.
		 */
		if (ddi_time_after(now, hdr->b_l1hdr.b_arc_access +
		    ARC_MINTIME)) {
			hdr->b_l1hdr.b_arc_access = now;
			DTRACE_PROBE1(new_state__mfu, arc_buf_hdr_t *, hdr);
			arc_change_state(arc_mfu, hdr);
		}
```

The MRU branch. A buffer enters the cache in MRU on first access (the anon branch just above, [L5381-L5397](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5381-L5397)). L5403-L5406: a hit on a block whose read is still in flight only refreshes the timestamp. L5407-L5408: count the MRU hit. L5414-L5417: if the first access was a prefetch, this demand hit does not promote. L5423-L5428: a second access promotes to MFU only if more than `ARC_MINTIME` has passed since the previous access, so that several accesses within one burst count as one "use". `ddi_time_after(a, b)` is true when `a` is later than `b`, so a hit exactly `ARC_MINTIME` after does not promote, and `b_arc_access` is refreshed only when the buffer is promoted (L5425): a series of hits less than `ARC_MINTIME` apart is measured from the first access, not from the previous hit. The other branches are excerpt 4. Note that `arc_access` itself does not change any target: in 2.4.4 it only accumulates ghost-hit bytes, which `arc_evict` consumes.

### 2. `arc_evict` — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4479-L4497

```c
	/* Get ARC ghost hits since last eviction. */
	ngrd = wmsum_value(&arc_mru_ghost->arcs_hits[ARC_BUFC_DATA]);
	uint64_t grd = ngrd - ogrd;
	ogrd = ngrd;
	ngrm = wmsum_value(&arc_mru_ghost->arcs_hits[ARC_BUFC_METADATA]);
	uint64_t grm = ngrm - ogrm;
	ogrm = ngrm;
	ngfd = wmsum_value(&arc_mfu_ghost->arcs_hits[ARC_BUFC_DATA]);
	uint64_t gfd = ngfd - ogfd;
	ogfd = ngfd;
	ngfm = wmsum_value(&arc_mfu_ghost->arcs_hits[ARC_BUFC_METADATA]);
	uint64_t gfm = ngfm - ogfm;
	ogfm = ngfm;

	/* Adjust ARC states balance based on ghost hits. */
	arc_meta = arc_evict_adj(arc_meta, gsrd + gsrm + gsfd + gsfm,
	    grm + gfm, grd + gfd, zfs_arc_meta_balance);
	arc_pd = arc_evict_adj(arc_pd, gsrd + gsfd, grd, gfd, 100);
	arc_pm = arc_evict_adj(arc_pm, gsrm + gsfm, grm, gfm, 100);
```

This is where adaptation happens in 2.4.4 (there is no `arc_p` anymore; it is replaced by fixed-point fractions of 2^32, defined at [`include/sys/arc_impl.h#L1032-L1035`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L1032-L1035)). L4480-L4491: ghost-hit bytes since the previous call, split four ways: MRU-ghost data (`grd`), MRU-ghost metadata (`grm`), MFU-ghost data (`gfd`), MFU-ghost metadata (`gfm`). The `og..` counters and the ghost targets `gs..` are `static` ([L4464-L4465](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4464-L4465)): hits accumulate between two calls and are consumed by the next one. L4494-L4495: `arc_meta` (metadata share of the cache) goes up with metadata ghost hits and down with data ghost hits, the downward push divided by `zfs_arc_meta_balance / 100` (L4437 in `arc_evict_adj`). L4496: `arc_pd` (MRU share of data) goes up with MRU-ghost data hits and down with MFU-ghost data hits; L4497: `arc_pm`, the same for metadata. The `total` argument is the ghost target size computed on the previous call (static `gsrd`... , [L4465](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4465), set at L4569-L4584, excerpt 6), so a hit moves the fraction by roughly hit bytes / ghost size, within the bounds of excerpt 5.

### 3. `arc_evict` — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4527-L4556

```c
	/* Evict MRU metadata. */
	w = wt * (int64_t)(arc_meta * arc_pm >> 48) >> 16;
	e = MIN((int64_t)(asize - ac), (int64_t)(mrum - w));
	bytes = arc_evict_impl(arc_mru, ARC_BUFC_METADATA, e);
	total_evicted += bytes;
	mrum -= bytes;
	asize -= bytes;

	/* Evict MFU metadata. */
	w = wt * (int64_t)(arc_meta >> 16) >> 16;
	e = MIN((int64_t)(asize - ac), (int64_t)(m - bytes - w));
	bytes = arc_evict_impl(arc_mfu, ARC_BUFC_METADATA, e);
	total_evicted += bytes;
	mfum -= bytes;
	asize -= bytes;

	/* Evict MRU data. */
	wt -= m - total_evicted;
	w = wt * (int64_t)(arc_pd >> 16) >> 16;
	e = MIN((int64_t)(asize - ac), (int64_t)(mrud - w));
	bytes = arc_evict_impl(arc_mru, ARC_BUFC_DATA, e);
	total_evicted += bytes;
	mrud -= bytes;
	asize -= bytes;

	/* Evict MFU data. */
	e = asize - ac;
	bytes = arc_evict_impl(arc_mfu, ARC_BUFC_DATA, e);
	mfud -= bytes;
	total_evicted += bytes;
```

Eviction order, each step bounded by both "how much we are over `arc_c`" (`asize - ac`) and "how much this list is over its target" (`mrum - w`, ...). `wt` is the evictable total, `t - (asize - ac)` ([L4499-L4501](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4499-L4501)), where `t` is the size of MRU and MFU, data and metadata ([L4468-L4477](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4468-L4477)). L4528: MRU-metadata target `wt * arc_meta * arc_pm`; L4536: all-metadata target `wt * arc_meta`, MFU metadata is evicted down to it; L4544-L4546: the remaining budget is data, MRU-data target `wt * arc_pd`; L4553-L4554: MFU data absorbs whatever overshoot remains. So MRU data is evicted only down to its target, never below, and only as much as the cache is over `arc_c`; if MRU is at or under its target, all of the overshoot comes from MFU. Each `arc_evict_impl` call evicts at most the list's evictable size and nothing for a negative request ([L4386-L4398](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4386-L4398)), walks the state's multilist from the tail (`arc_evict_state`, [L4150](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4150); markers inserted at the tail, [L4180](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4180), headers taken with `multilist_sublist_prev`, [L3922-L3924](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3922-L3924)) until at least the requested bytes are evicted, and calls `arc_evict_hdr` (excerpt 7) on each header.

### 4. `arc_access`, the ghost branches — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5429-L5449

```c
	} else if (hdr->b_l1hdr.b_state == arc_mru_ghost) {
		arc_state_t	*new_state;
		/*
		 * This buffer has been accessed once recently, but was
		 * evicted from the cache.  Would we have bigger MRU, it
		 * would be an MRU hit, so handle it the same way, except
		 * we don't need to check the previous access time.
		 */
		hdr->b_l1hdr.b_mru_ghost_hits++;
		ARCSTAT_BUMP(arcstat_mru_ghost_hits);
		hdr->b_l1hdr.b_arc_access = now;
		wmsum_add(&arc_mru_ghost->arcs_hits[arc_buf_type(hdr)],
		    arc_hdr_size(hdr));
		if (was_prefetch) {
			new_state = arc_mru;
			DTRACE_PROBE1(new_state__mru, arc_buf_hdr_t *, hdr);
		} else {
			new_state = arc_mfu;
			DTRACE_PROBE1(new_state__mfu, arc_buf_hdr_t *, hdr);
		}
		arc_change_state(new_state, hdr);
```

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5450-L5472

```c
	} else if (hdr->b_l1hdr.b_state == arc_mfu) {
		/*
		 * This buffer has been accessed more than once and either
		 * still in the cache or being restored from one of ghosts.
		 */
		if (!HDR_IO_IN_PROGRESS(hdr)) {
			hdr->b_l1hdr.b_mfu_hits++;
			ARCSTAT_BUMP(arcstat_mfu_hits);
		}
		hdr->b_l1hdr.b_arc_access = now;
	} else if (hdr->b_l1hdr.b_state == arc_mfu_ghost) {
		/*
		 * This buffer has been accessed more than once recently, but
		 * has been evicted from the cache.  Would we have bigger MFU
		 * it would stay in cache, so move it back to MFU state.
		 */
		hdr->b_l1hdr.b_mfu_ghost_hits++;
		ARCSTAT_BUMP(arcstat_mfu_ghost_hits);
		hdr->b_l1hdr.b_arc_access = now;
		wmsum_add(&arc_mfu_ghost->arcs_hits[arc_buf_type(hdr)],
		    arc_hdr_size(hdr));
		DTRACE_PROBE1(new_state__mfu, arc_buf_hdr_t *, hdr);
		arc_change_state(arc_mfu, hdr);
```

L5437-L5441: an MRU-ghost hit counts on the header (`b_mru_ghost_hits`), refreshes `b_arc_access`, and adds the buffer's size (`arc_hdr_size`, its compressed size if compressed, [L1795-L1807](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L1795-L1807)) to `arc_mru_ghost->arcs_hits` for its type, the counter excerpt 2 reads. L5442-L5449: the buffer goes to MFU, or to MRU if it was a prefetch: "Would we have bigger MRU, it would be an MRU hit", and the second access is what promotes. L5450-L5459: an MFU hit stays in MFU and refreshes `b_arc_access`. L5460-L5472: an MFU-ghost hit counts into `arc_mfu_ghost->arcs_hits` and goes back to MFU. A ghost hit is a cache miss: the data is gone and is read again from disk. In `arc_read`, a hit on a cached buffer calls `arc_access` at [L6025](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L6025) (state MRU, MFU or uncached, [L6020-L6022](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L6020-L6022)); a miss, on a new header or a ghost one, calls it before the data is allocated (excerpt 8). The branch for `arc_uncached` ([L5473-L5480](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5473-L5480)) is for uncacheable prefetches; `arc_l2c_only` goes back to MRU ([L5481-L5488](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5481-L5488)).

### 5. `arc_evict_adj` — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4405-L4442

```c
static uint64_t
arc_evict_adj(uint64_t frac, uint64_t total, uint64_t up, uint64_t down,
    uint_t balance)
{
	if (total < 32 || up + down == 0)
		return (frac);

	/*
	 * We should not have more ghost hits than ghost size, but they may
	 * get close.  To avoid overflows below up/down should not be bigger
	 * than 1/5 of total.  But to limit maximum adjustment speed restrict
	 * it some more.
	 */
	if (up + down >= total / 16) {
		uint64_t scale = (up + down) / (total / 32);
		up /= scale;
		down /= scale;
	}

	/* Get maximal dynamic range by choosing optimal shifts. */
	int s = highbit64(total);
	s = MIN(64 - s, 32);

	ASSERT3U(frac, <=, 1ULL << 32);
	uint64_t ofrac = (1ULL << 32) - frac;

	if (frac >= 4 * ofrac)
		up /= frac / (2 * ofrac + 1);
	up = (up << s) / (total >> (32 - s));
	if (ofrac >= 4 * frac)
		down /= ofrac / (2 * frac + 1);
	down = (down << s) / (total >> (32 - s));
	down = down * 100 / balance;

	ASSERT3U(up, <=, (1ULL << 32) - frac);
	ASSERT3U(down, <=, frac);
	return (frac + up - down);
}
```

L4409-L4410: no change while the ghost total is tiny (`total < 32` bytes, in practice only before the first ghost targets exist) or there were no hits. L4417-L4421: if the hits reach 1/16 of the ghost total, they are scaled down to about 1/32 of it: one call moves a fraction by at most about 1/32 of its range. L4424-L4426: `s` is chosen so that `total` fits in 32 bits after the shift, and L4432 and L4435 compute `up / total` and `down / total` as fractions of 2^32. L4431 and L4434: near the top (`frac >= 4 * ofrac`, 80 % or more) an upward step is divided by `frac / (2 * ofrac + 1)`, and symmetrically near the bottom for a downward step, so a fraction approaches 0 or 1 ever more slowly. L4436: the downward step is divided by `balance / 100`: 1 for `arc_pd` and `arc_pm`, 5 for `arc_meta`. Worked example (the unit tests check it): `frac` = 2^31 (1/2), `total` = 2^20 (eight blocks of 128 KiB), `up` = 2^17 (one 128 KiB MRU-ghost hit), `down` = 0. `up + down` >= 2^20 / 16, so `scale` = 2^17 / 2^15 = 4 and `up` = 2^15; `highbit64(2^20)` = 21, `s` = 32; `up` = 2^47 / 2^20 = 2^27, so `arc_pd` becomes 2^31 + 2^27, 53.125 %. The same hit in the MFU ghost list gives 2^31 − 2^27.

### 6. `arc_evict`, the ghost lists — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4558-L4587

```c
	/*
	 * Evict ghost lists
	 *
	 * Size of each state's ghost list represents how much that state
	 * may grow by shrinking the other states.  Would it need to shrink
	 * other states to zero (that is unlikely), its ghost size would be
	 * equal to sum of other three state sizes.  But excessive ghost
	 * size may result in false ghost hits (too far back), that may
	 * never result in real cache hits if several states are competing.
	 * So choose some arbitraty point of 1/2 of other state sizes.
	 */
	gsrd = (mrum + mfud + mfum) / 2;
	e = zfs_refcount_count(&arc_mru_ghost->arcs_size[ARC_BUFC_DATA]) -
	    gsrd;
	(void) arc_evict_impl(arc_mru_ghost, ARC_BUFC_DATA, e);

	gsrm = (mrud + mfud + mfum) / 2;
	e = zfs_refcount_count(&arc_mru_ghost->arcs_size[ARC_BUFC_METADATA]) -
	    gsrm;
	(void) arc_evict_impl(arc_mru_ghost, ARC_BUFC_METADATA, e);

	gsfd = (mrud + mrum + mfum) / 2;
	e = zfs_refcount_count(&arc_mfu_ghost->arcs_size[ARC_BUFC_DATA]) -
	    gsfd;
	(void) arc_evict_impl(arc_mfu_ghost, ARC_BUFC_DATA, e);

	gsfm = (mrud + mrum + mfud) / 2;
	e = zfs_refcount_count(&arc_mfu_ghost->arcs_size[ARC_BUFC_METADATA]) -
	    gsfm;
	(void) arc_evict_impl(arc_mfu_ghost, ARC_BUFC_METADATA, e);
```

After the live lists, each ghost list is trimmed to half of the other three live lists, measured after this call's evictions: the MRU-data ghost list may hold `(mrum + mfud + mfum) / 2` bytes of headers, the MFU-data ghost list `(mrud + mrum + mfum) / 2`. A ghost list is not the size of the cache, and when the other lists are empty it holds nothing. These four values are kept (`static`) as the `total` arguments of the next call's `arc_evict_adj` (excerpt 2). A ghost list's size counts the logical size of the headers it holds (`bytes_evicted += HDR_GET_LSIZE(hdr)` when one is trimmed, [L3800-L3801](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3800-L3801)); trimming walks from the tail too.

### 7. `arc_evict_hdr` — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3876-L3891

```c
	if (hdr->b_l1hdr.b_pabd != NULL)
		arc_hdr_free_abd(hdr, B_FALSE);

	if (HDR_HAS_RABD(hdr))
		arc_hdr_free_abd(hdr, B_TRUE);

	arc_change_state(evicted_state, hdr);
	DTRACE_PROBE1(arc__evict, arc_buf_hdr_t *, hdr);
	if (evicted_state == arc_anon) {
		arc_hdr_destroy(hdr);
		*real_evicted += HDR_FULL_SIZE;
	} else {
		ASSERT(HDR_IN_HASH_TABLE(hdr));
	}

	return (bytes_evicted);
```

Evicting a live header: the state it goes to is chosen at [L3828-L3830](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3828-L3830), MRU to `arc_mru_ghost`, MFU to `arc_mfu_ghost` (uncached to anon). L3876-L3880: the data (`b_pabd`, and the raw encrypted copy) is freed. L3882: the header moves to the ghost state; L3884-L3889: only an uncached buffer's header is destroyed; a ghost header stays in the hash table, so a later read of the same block finds it. Evicting a ghost header (trimming, excerpt 6) takes the branch at [L3786-L3826](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3786-L3826): destroyed (L3820-L3823), or moved to `arc_l2c_only` if the block is on an L2ARC device (L3805-L3819). Prefetched and indirect buffers have a minimum lifetime before they can be evicted ([L3832-L3839](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3832-L3839)).

### 8. `arc_read`, the miss path — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L6198-L6208

```c
		/*
		 * Take additional reference for IO_IN_PROGRESS.  It stops
		 * arc_access() from putting this header without any buffers
		 * and so other references but obviously nonevictable onto
		 * the evictable list of MRU or MFU state.
		 */
		add_reference(hdr, hdr);
		if (!embedded_bp)
			arc_access(hdr, *arc_flags, B_FALSE);
		arc_hdr_set_flags(hdr, ARC_FLAG_IO_IN_PROGRESS);
		arc_hdr_alloc_abd(hdr, alloc_flags);
```

A miss, on a header just created or found in a ghost state: `add_reference` holds the header, `arc_access` moves it (to MRU for a new header, to MFU or MRU for a ghost one, excerpts 1 and 4), then the data buffer is allocated (`arc_hdr_alloc_abd`, which goes through `arc_get_data_impl`, [L5233](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5233)) and the read is issued. While held, a header is off its state's list and not evictable: `add_reference` removes it ([L2334-L2338](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L2334-L2338)), `arc_change_state` moves a held header between states without putting it on a list ([L2473-L2493](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L2473-L2493)), and the last `remove_reference` inserts it into its state's list ([L2369](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L2369)), at the head (`multilist_insert`, [`module/zfs/multilist.c#L184`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/multilist.c#L184)). So each list runs from the most recently released header (head) to the least recently released (tail), and eviction takes from the tail.

**When eviction runs.** `arc_get_data_impl` calls `arc_adapt`, then `arc_wait_for_eviction` ([L5251-L5252](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5251-L5252)). That wakes the eviction thread when the cache is overflowing, which `arc_is_overflowing` judges as more than `arc_c` plus `zfs_max_recordsize` ([L5099-L5100](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5099-L5100); 16 MiB on 64-bit, [`module/zfs/dsl_dataset.c#L87-L91`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_dataset.c#L87-L91)), and makes the allocating thread wait when the overflow is severe ([L5156-L5222](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5156-L5222)). The thread, `arc_evict_cb`, calls `arc_evict` ([L4876-L4877](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4876-L4877)) and keeps going while it evicted something and the cache is still over `arc_c` ([L4895-L4896](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4895-L4896)). A hit allocates nothing and so triggers no eviction.

**`arc_c` itself.** `arc_adapt` ([L5056-L5082](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5056-L5082)) grows `arc_c` by `MAX(bytes, SPA_OLD_MAXBLOCKSIZE)` per allocation while the cache is within `2 * SPA_MAXBLOCKSIZE` of it (128 KiB and 16 MiB: `SPA_OLD_MAXBLOCKSHIFT` 17, `SPA_MAXBLOCKSHIFT` 24, [`include/sys/fs/zfs.h#L1958-L1962`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/fs/zfs.h#L1958-L1962)) ([L5076-L5081](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5076-L5081)), and stops at `arc_c_max` ([L5069-L5070](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5069-L5070)) or when growth is off (`arc_no_grow`, [L5066-L5067](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5066-L5067)); shrinking under memory pressure (`arc_reduce_target_size`, [L4714](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4714)) is a separate control, not driven by ghost hits. Ghost hits move the *shares* of `arc_c`, never `arc_c`.

### 9. The L2ARC, its design comment — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L8261-L8274

```c
 * 1. There is no eviction path from the ARC to the L2ARC.  Evictions from
 * the ARC behave as usual, freeing buffers and placing headers on ghost
 * lists.  The ARC does not send buffers to the L2ARC during eviction as
 * this would add inflated write latencies for all ARC memory pressure.
 *
 * 2. The L2ARC attempts to cache data from the ARC before it is evicted.
 * It does this by periodically scanning buffers from the eviction-end of
 * the MFU and MRU ARC lists, copying them to the L2ARC devices if they are
 * not already there. It scans until a headroom of buffers is satisfied,
 * which itself is a buffer for ARC eviction. If a compressible buffer is
 * found during scanning and selected for writing to an L2ARC device, we
 * temporarily boost scanning headroom during the next scan cycle to make
 * sure we adapt to compression effects (which might significantly reduce
 * the data volume we write to L2ARC). The thread that does this is
```

The design comment opens with what the L2ARC is: "a cache layer in-between main memory and disk" on dedicated devices, "short-stroked disks, solid state disks", meant to "boost the performance of random read workloads" ([L8217-L8222](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L8217-L8222)). The L2ARC (a cache device) is fed by `l2arc_feed_thread` ([L9771](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9771)), which wakes about once a second (`next = ddi_get_lbolt() + hz`, [L9791](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9791)), evicts ahead of its write hand on the device and copies eligible ARC buffers to it (`l2arc_evict`, `l2arc_write_buffers`, [L9841-L9851](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9841-L9851)), from the tails of the MRU and MFU lists, or from their heads while the ARC is not yet "warm" ([L9530-L9538](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9530-L9538); `from_head = !arc_warm`, [L9491](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9491); `arc_warm` is set when free memory runs out, [L4928-L4931](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4928-L4931)). A ghost header whose block is on the device is not destroyed when trimmed but kept as `arc_l2c_only` (excerpt 7), and a read of it goes back to MRU (excerpt 4).

**What the animation shows.**
- Four lists, the data lists of MRU, MFU and their ghosts, each drawn from head (most recent) to tail (evicted first); the cache, `arc_c` = 16 blocks of 128 KiB; a gauge with `arc_pd` and the MRU target it gives. The visitor reads blocks: a new block, a sequential scan of new blocks, the hot set again, or any block shown (cached, ghost, or forgotten). A clock advances one second before each action, or 10 ms if the visitor chooses; reads within one action are 1 ms apart.
- New block: a header appears at the head of MRU — `arc_access` L5381-L5397, `arc_read` L6204-L6208, `remove_reference` L2369.
- Re-read of an MRU block more than 62 ms after its `b_arc_access`: to the head of MFU; 62 ms or less: stays in MRU, moves to its head, `b_arc_access` unchanged — L5407-L5428 (excerpt 1).
- MFU hit: to the head of MFU — L5450-L5459.
- Cache over `arc_c` after a miss: one eviction pass. MRU gives up its tail only down to its target and only as much as the cache is over; MFU gives up the rest — L4543-L4556. Each evicted header slides into the head of the matching ghost list, its data box empties — `arc_evict_hdr` L3828-L3830, L3876-L3882. Ghost lists are then trimmed to half of the other live lists, the trimmed headers destroyed ("forgotten") — L4569-L4582, L3820-L3823.
- Ghost hit: the block is read from disk again, lands in MFU, and the ghost-hit counter of its list grows by 128 KiB — L5437-L5449, L5466-L5472. At the pass that follows, `arc_pd` moves up (MRU ghost) or down (MFU ghost) through `arc_evict_adj`, and the MRU target follows — L4496, L4405-L4442, L4545.
- Simulator rules (the code's rules): promotion and ghost transitions exactly as `arc_access`; fractions updated only at eviction passes with `arc_evict_adj` in uint64 fixed point, 2^32, balance 100 for `arc_pd`; per-list targets and eviction order as L4527-L4556; ghost caps as L4569-L4587, kept for the next pass's `total`. Simplifications, stated on screen and in `DECISIONS.md` D6.2: data blocks only, all 128 KiB and uncompressed, so the metadata lists are empty and the metadata terms of `arc_evict` are zero (`arc_meta` and `arc_pm` then never change a data target and are not drawn); one sublist per state (exact LRU order; the code spreads headers over sublists by hash and evicts round-robin, [L7518-L7543](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L7518-L7543), [L4205-L4213](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4205-L4213)); one eviction pass right after each miss, as soon as the cache is over `arc_c`, instead of an asynchronous thread woken past `arc_c + zfs_max_recordsize` (at the figure's scale that tolerance would be eight caches); the reader releases each block at once (no dbuf cache holding it); `arc_c` fixed (at `arc_c_max`); a logical clock with `ARC_MINTIME` 62 ms; no prefetch, no `uncached` state, no anon (dirty) buffers, no dnode pruning, no compressed or encrypted copies, no L2ARC.

**Facts for the text**
- Seven states: anon, MRU, MRU ghost, MFU, MFU ghost, L2C only, uncached — [`include/sys/arc.h#L231-L238`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc.h#L231-L238), described at [`include/sys/arc_impl.h#L45-L52`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L45-L52); each state has one list per buffer type (data, metadata) and counts ghost-hit bytes in `arcs_hits` — [`include/sys/arc_impl.h#L77-L98`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L77-L98).
- Initial balance: metadata 25% of the cache, MRU 50% of data, MRU 50% of metadata — [`module/zfs/arc.c#L8038-L8040`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L8038-L8040).
- `zfs_arc_meta_balance = 500`: data ghost hits push metadata down 5 times less than metadata ghost hits push it up — [`module/zfs/arc.c#L459`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L459), applied at [`module/zfs/arc.c#L4437`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4437).
- `ARC_MINTIME` is `hz >> 4`, about 62 ms — [`module/zfs/arc.c#L1318`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L1318).
- One call of `arc_evict_adj` moves a fraction by at most about 1/32 of its range (L4417-L4421, excerpt 5).
- A ghost list holds at most half of what the three other live lists hold (L4569-L4587, excerpt 6).
- Per-header bookkeeping: `b_state`, `b_arc_access`, and hit counters `b_mru_hits`, `b_mru_ghost_hits`, `b_mfu_hits`, `b_mfu_ghost_hits` in the L1 part of `arc_buf_hdr` — [`include/sys/arc_impl.h#L162-L172`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L162-L172); the header is keyed by `b_dva` and `b_birth` — [`include/sys/arc_impl.h#L472-L475`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L472-L475).
- `arc_c` grows by `MAX(bytes, SPA_OLD_MAXBLOCKSIZE)` per allocation when near the target — [`module/zfs/arc.c#L5076-L5081`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5076-L5081).
- Hand-checked sequence (the unit tests replay it; `arc_c` = 16 blocks of 128 KiB, data only, one sublist). Opening: H1-H6 read, then read again a second later: six MRU hits after more than `ARC_MINTIME`, all six in MFU, `arc_pd` = 2^31, nothing evicted. A scan of S1-S12, 1 ms apart: S1-S10 fill the cache; S11 is over `arc_c` by one block: first pass, ghost targets still 0, `total < 32`, `arc_pd` unchanged; MRU holds 11 blocks, target 8: `e = MIN(1, 3)` blocks, S1 to the MRU ghost list; ghost targets 6/2 = 3 blocks (MRU ghost) and 10/2 = 5 (MFU ghost). S12: the same, S2 to the MRU ghost list. MRU S12...S3, MFU H6...H1 intact, MRU ghost S2 S1. Read S2 (MRU-ghost hit): to MFU, `arcs_hits` + 128 KiB; pass: `total` = 8 blocks = 2^20, `arc_pd` = 2^31 + 2^27 (53.125 %), MRU target 8.5 blocks, MRU 10 blocks: `e = MIN(1, 1.5)`, S3 to the MRU ghost list; MFU nothing. Read S12, S11, S10 again: MRU hits after more than 62 ms, to MFU, no pass. Read N1 (new): over by one; MRU 7 blocks, under its target 8.5: nothing from MRU, H1 (MFU tail) to the MFU ghost list; ghost targets 9/2 = 4.5 and 7/2 = 3.5 blocks. Read H1 (MFU-ghost hit): to MFU; pass: `total` = 8 blocks, `arc_pd` = 2^31 + 2^27 − 2^27 = 2^31, target 8; MRU 7: nothing; H2 to the MFU ghost list. A new block N2 read again 10 ms later stays in MRU (MRU hit, `b_arc_access` unchanged), again 52 ms later (62 ms, not after `b_arc_access + ARC_MINTIME`) stays, one more millisecond later goes to MFU.

**Short excerpts for the question-first room (v1.4, ALG-193).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis.

### 10. `arc_access`, promotion to MFU — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5423-L5428

```c
		if (ddi_time_after(now, hdr->b_l1hdr.b_arc_access +
		    ARC_MINTIME)) {
			hdr->b_l1hdr.b_arc_access = now;
			DTRACE_PROBE1(new_state__mfu, arc_buf_hdr_t *, hdr);
			arc_change_state(arc_mfu, hdr);
		}
```

The end of excerpt 1. A hit on an MRU block more than `ARC_MINTIME` after `b_arc_access` refreshes the time and moves the header to MFU; otherwise nothing changes, so re-reads within one burst count as one use. `ARC_MINTIME` is `hz >> 4`, "62 ms" ([L1318](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L1318)); `ddi_time_after` is strict, so exactly 62 ms does not promote. A new block enters MRU in the anon branch ([L5381-L5397](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5381-L5397)).

### 11. `arc_evict_hdr`, the data goes, the header stays — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3876-L3882

```c
	if (hdr->b_l1hdr.b_pabd != NULL)
		arc_hdr_free_abd(hdr, B_FALSE);

	if (HDR_HAS_RABD(hdr))
		arc_hdr_free_abd(hdr, B_TRUE);

	arc_change_state(evicted_state, hdr);
```

Excerpt 7 without its last lines. L3876-L3880: the data (and its raw copy, if any) is freed. L3882: the header moves to `evicted_state`, MRU ghost for an MRU header and MFU ghost for an MFU header ([L3829-L3830](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3829-L3830)). Only an uncached header goes to anon and is destroyed (L3884-L3889); a ghost header stays in the hash table, so a later read of the same block finds it.

### 12. `arc_evict`, MRU data down to its target, then MFU data — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4543-L4556

```c
	/* Evict MRU data. */
	wt -= m - total_evicted;
	w = wt * (int64_t)(arc_pd >> 16) >> 16;
	e = MIN((int64_t)(asize - ac), (int64_t)(mrud - w));
	bytes = arc_evict_impl(arc_mru, ARC_BUFC_DATA, e);
	total_evicted += bytes;
	mrud -= bytes;
	asize -= bytes;

	/* Evict MFU data. */
	e = asize - ac;
	bytes = arc_evict_impl(arc_mfu, ARC_BUFC_DATA, e);
	mfud -= bytes;
	total_evicted += bytes;
```

The data half of excerpt 3. L4545: the MRU data target `w` is `wt` times `arc_pd`, a fraction of 2^32. L4546-L4547: MRU gives up at most what it holds above `w`, and no more than the cache is over `arc_c` (`asize - ac`); a negative amount evicts nothing ([L4386-L4398](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4386-L4398)). L4553-L4554: MFU gives up whatever is still over. `wt` is the evictable part of `arc_c` ([L4499-L4501](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4499-L4501)).

### 13. `arc_evict`, how many ghosts to keep — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4561-L4572

```c
	 * Size of each state's ghost list represents how much that state
	 * may grow by shrinking the other states.  Would it need to shrink
	 * other states to zero (that is unlikely), its ghost size would be
	 * equal to sum of other three state sizes.  But excessive ghost
	 * size may result in false ghost hits (too far back), that may
	 * never result in real cache hits if several states are competing.
	 * So choose some arbitraty point of 1/2 of other state sizes.
	 */
	gsrd = (mrum + mfud + mfum) / 2;
	e = zfs_refcount_count(&arc_mru_ghost->arcs_size[ARC_BUFC_DATA]) -
	    gsrd;
	(void) arc_evict_impl(arc_mru_ghost, ARC_BUFC_DATA, e);
```

Part of excerpt 6: its comment without the first two lines, and the trim of the MRU data ghost list. L4561-L4567: a ghost list as large as the three other live lists would give false ghost hits, so it is held to half of them. L4569-L4572: the MRU data ghost list is trimmed to `gsrd` from its tail; the trimmed headers are destroyed ([L3820-L3823](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3820-L3823)) unless the block is on an L2ARC device. `gsrd` is static ([L4465](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4465)) and becomes the next pass's `total`. The MFU data ghost list is trimmed the same way at L4579-L4582.

### 14. `arc_access`, an MRU ghost hit — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5432-L5441

```c
		 * This buffer has been accessed once recently, but was
		 * evicted from the cache.  Would we have bigger MRU, it
		 * would be an MRU hit, so handle it the same way, except
		 * we don't need to check the previous access time.
		 */
		hdr->b_l1hdr.b_mru_ghost_hits++;
		ARCSTAT_BUMP(arcstat_mru_ghost_hits);
		hdr->b_l1hdr.b_arc_access = now;
		wmsum_add(&arc_mru_ghost->arcs_hits[arc_buf_type(hdr)],
		    arc_hdr_size(hdr));
```

The start of excerpt 4. L5432-L5435: "Would we have bigger MRU, it would be an MRU hit". L5437-L5441: the hit is counted on the header and the header's size ([L1795-L1807](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L1795-L1807), compressed if the block is) is added to the MRU ghost list's `arcs_hits` for its buffer type. L5442-L5449: the header goes to MFU, or to MRU if the read was a prefetch. `arc_access` changes no target; an MFU ghost hit does the same with the MFU ghost list's counter ([L5466-L5472](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L5466-L5472)).

### 15. `arc_evict`, the balance moves — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4493-L4497

```c
	/* Adjust ARC states balance based on ghost hits. */
	arc_meta = arc_evict_adj(arc_meta, gsrd + gsrm + gsfd + gsfm,
	    grm + gfm, grd + gfd, zfs_arc_meta_balance);
	arc_pd = arc_evict_adj(arc_pd, gsrd + gsfd, grd, gfd, 100);
	arc_pm = arc_evict_adj(arc_pm, gsrm + gsfm, grm, gfm, 100);
```

The end of excerpt 2. Each pass passes the ghost-hit bytes since the previous pass (L4480-L4491) to `arc_evict_adj`: `arc_meta`, the metadata share, up with metadata ghost hits and down with data ghost hits divided by `zfs_arc_meta_balance / 100` ([L459](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L459), 500 by default); `arc_pd`, the MRU share of data, up with MRU-ghost data hits and down with MFU-ghost data hits; `arc_pm`, the same for metadata. They are fractions of 2^32 ([include/sys/arc_impl.h L1032-L1035](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/arc_impl.h#L1032-L1035)) and start at 1/4, 1/2 and 1/2 ([L8038-L8040](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L8038-L8040)).

### 16. `arc_evict_adj`, at most about 1/32 per pass — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L4412-L4422

```c
	/*
	 * We should not have more ghost hits than ghost size, but they may
	 * get close.  To avoid overflows below up/down should not be bigger
	 * than 1/5 of total.  But to limit maximum adjustment speed restrict
	 * it some more.
	 */
	if (up + down >= total / 16) {
		uint64_t scale = (up + down) / (total / 32);
		up /= scale;
		down /= scale;
	}
```

Part of excerpt 5. When the hits reach 1/16 of the ghost total, `up` and `down` are divided by `(up + down) / (total / 32)`, so they come to about 1/32 of the total, and a pass moves a fraction by at most about 1/32 of its range. In the figure one 128 KiB ghost hit (2^17 bytes) against ghost targets of 8 blocks (2^20) reaches that limit: it is scaled by 4 to 2^15, the shift is 32, `up` = 2^47 / 2^20 = 2^27, and `arc_pd` goes from 2^31 to 2^31 + 2^27, 53.125% (the hand-checked sequence above).

### 17. The L2ARC is fed from the lists' tails — module/zfs/arc.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L8266-L8270

```c
 * 2. The L2ARC attempts to cache data from the ARC before it is evicted.
 * It does this by periodically scanning buffers from the eviction-end of
 * the MFU and MRU ARC lists, copying them to the L2ARC devices if they are
 * not already there. It scans until a headroom of buffers is satisfied,
 * which itself is a buffer for ARC eviction. If a compressible buffer is
```

Point 2 of excerpt 9. The feed thread copies blocks from the eviction end of MRU and MFU to the cache device before they are evicted; eviction itself writes nothing to it (point 1, L8261-L8264). `l2arc_feed_thread` ([L9771](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9771)) wakes about once a second ([L9791](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9791)) and reads the lists from their tails ([L9530-L9538](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L9530-L9538)). A ghost header whose block is on the device stays as L2C only ([L3805-L3819](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/arc.c#L3805-L3819)).

## Room: Metaslabs and space maps

**Problem.** A copy-on-write pool allocates a new block for every write and frees the old one, so allocation is the hottest path in the system. A single bitmap of the whole pool would be enormous to keep in memory and would have to be rewritten in place on every change, which is exactly what copy-on-write forbids. ZFS instead cuts each vdev into a few hundred metaslabs, keeps only some of them loaded in memory, and records each metaslab's history as an append-only log of ALLOC and FREE extents.

**The idea in the code.**
- `struct metaslab` in [`include/sys/metaslab_impl.h#L339`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L339) — one region of a vdev, with an in-core free tree `ms_allocatable` and per-txg trees `ms_allocating[TXG_SIZE]`, `ms_freeing`, `ms_defer[TXG_DEFER_SIZE]` ([`include/sys/metaslab_impl.h#L375-L388`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L375-L388)); grouped per top-level vdev in `struct metaslab_group` ([`include/sys/metaslab_impl.h#L237`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L237)) and per class in `struct metaslab_class` ([`include/sys/metaslab_impl.h#L181`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L181)).
- `metaslab_block_alloc` in [`module/zfs/metaslab.c#L4856`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4856) — carves an extent out of `ms_allocatable` using the class allocator (by default dynamic fit, `metaslab_df_alloc` [`module/zfs/metaslab.c#L1895`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1895), built on `metaslab_block_picker` [`module/zfs/metaslab.c#L1771`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1771)).
- `space_map_write` in [`module/zfs/space_map.c#L760`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L760) / `space_map_load` in [`module/zfs/space_map.c#L450`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L450) — append this txg's extents to the on-disk log; replay the log to rebuild the free tree.

**Excerpts.**

### 1. `metaslab_block_alloc` — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4863-L4890

```c
	ASSERT(MUTEX_HELD(&msp->ms_lock));
	VERIFY(!msp->ms_condensing);
	VERIFY0(msp->ms_disabled);
	VERIFY0(msp->ms_new);

	start = mc->mc_ops->msop_alloc(msp, size, max_size, actual_size);
	if (start != -1ULL) {
		size = *actual_size;
		metaslab_group_t *mg = msp->ms_group;
		vdev_t *vd = mg->mg_vd;

		VERIFY0(P2PHASE(start, 1ULL << vd->vdev_ashift));
		VERIFY0(P2PHASE(size, 1ULL << vd->vdev_ashift));
		VERIFY3U(zfs_range_tree_space(rt) - size, <=, msp->ms_size);
		zfs_range_tree_remove(rt, start, size);
		zfs_range_tree_clear(msp->ms_trim, start, size);

		if (zfs_range_tree_is_empty(msp->ms_allocating[txg & TXG_MASK]))
			vdev_dirty(mg->mg_vd, VDD_METASLAB, msp, txg);

		zfs_range_tree_add(msp->ms_allocating[txg & TXG_MASK], start,
		    size);
		msp->ms_allocating_total += size;

		/* Track the last successful allocation */
		msp->ms_alloc_txg = txg;
		metaslab_verify_space(msp, txg);
	}
```

L4864: allocation is refused on a metaslab that is being condensed, because its free tree is being written out. L4868: the class's allocator (`mc_ops->msop_alloc`, e.g. dynamic fit) returns an offset inside this metaslab. L4874-L4875: offset and size are multiples of the vdev's sector size (`1 << vdev_ashift`). L4877: the extent leaves the in-core free tree. L4880-L4881: the first allocation of a txg marks the metaslab dirty for that txg, so `metaslab_sync` will visit it. L4883-L4884: the extent is recorded in `ms_allocating[txg & TXG_MASK]`: nothing is written to disk yet, the allocation lives only in memory until its txg syncs.

### 2. `metaslab_sync` — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4367-L4405

```c
	/*
	 * We'll be going to disk to sync our space accounting, thus we
	 * drop the ms_lock during that time so allocations coming from
	 * open-context (ZIL) for future TXGs do not block.
	 */
	mutex_exit(&msp->ms_lock);
	space_map_t *log_sm = spa_syncing_log_sm(spa);
	if (log_sm != NULL) {
		ASSERT(spa_feature_is_enabled(spa, SPA_FEATURE_LOG_SPACEMAP));
		if (metaslab_unflushed_txg(msp) == 0)
			metaslab_unflushed_add(msp, tx);
		else if (!metaslab_unflushed_dirty(msp))
			metaslab_unflushed_bump(msp, tx, B_TRUE);

		space_map_write(log_sm, alloctree, SM_ALLOC,
		    vd->vdev_id, tx);
		space_map_write(log_sm, msp->ms_freeing, SM_FREE,
		    vd->vdev_id, tx);
		mutex_enter(&msp->ms_lock);

		ASSERT3U(spa->spa_unflushed_stats.sus_memused, >=,
		    metaslab_unflushed_changes_memused(msp));
		spa->spa_unflushed_stats.sus_memused -=
		    metaslab_unflushed_changes_memused(msp);
		zfs_range_tree_remove_xor_add(alloctree,
		    msp->ms_unflushed_frees, msp->ms_unflushed_allocs);
		zfs_range_tree_remove_xor_add(msp->ms_freeing,
		    msp->ms_unflushed_allocs, msp->ms_unflushed_frees);
		spa->spa_unflushed_stats.sus_memused +=
		    metaslab_unflushed_changes_memused(msp);
	} else {
		ASSERT(!spa_feature_is_enabled(spa, SPA_FEATURE_LOG_SPACEMAP));

		space_map_write(msp->ms_sm, alloctree, SM_ALLOC,
		    SM_NO_VDEVID, tx);
		space_map_write(msp->ms_sm, msp->ms_freeing, SM_FREE,
		    SM_NO_VDEVID, tx);
		mutex_enter(&msp->ms_lock);
	}
```

In syncing context, the txg's allocations (`alloctree`, i.e. `ms_allocating[txg & TXG_MASK]`, metaslab.c L4251) and frees (`ms_freeing`) are appended to a space map. L4373-L4396: when the pool has a log space map for this txg, both trees are appended to that single pool-wide log, tagged with the vdev id, and remembered in the metaslab's `ms_unflushed_allocs`/`ms_unflushed_frees`. L4397-L4404: otherwise they are appended to the metaslab's own space map `ms_sm`, without a vdev id. Either way, the order is ALLOC then FREE, and nothing already on disk is rewritten. Just above, L4363-L4365, sync pass 1 condenses the map first if the metaslab is loaded (`ms_loaded`) and `metaslab_should_condense` says so.

### 3. `space_map_write_seg` — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L633-L663

```c
		uint64_t run_len = MIN(size, run_max);
		switch (words) {
		case 1:
			*block_cursor = SM_OFFSET_ENCODE(start) |
			    SM_TYPE_ENCODE(maptype) |
			    SM_RUN_ENCODE(run_len);
			block_cursor++;
			break;
		case 2:
			/* write the first word of the entry */
			*block_cursor = SM_PREFIX_ENCODE(SM2_PREFIX) |
			    SM2_RUN_ENCODE(run_len) |
			    SM2_VDEV_ENCODE(vdev_id);
			block_cursor++;

			/* move on to the second word of the entry */
			ASSERT3P(block_cursor, <, block_end);
			*block_cursor = SM2_TYPE_ENCODE(maptype) |
			    SM2_OFFSET_ENCODE(start);
			block_cursor++;
			break;
		default:
			panic("%d-word space map entries are not supported",
			    words);
			break;
		}
		sm->sm_phys->smp_length += words * sizeof (uint64_t);

		start += run_len;
		size -= run_len;
	}
```

This is how one extent becomes 64-bit words. L633: a long extent is split into runs no longer than the maximum run of the chosen format. L636-L638: a one-word entry packs offset (in `sm_shift` units, relative to the map start), type (ALLOC or FREE) and run length. L643-L651: a two-word entry, needed for long runs or when a vdev id must be stored (log space map), puts prefix, run and vdev in the first word and type and offset in the second. L659: `smp_length` grows by one or two words: the space map is a log that only gets longer until it is condensed.

### 4. `space_map_write_impl` — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L704-L739

```c
	zfs_btree_t *t = &rt->rt_root;
	zfs_btree_index_t where;
	for (zfs_range_seg_t *rs = zfs_btree_first(t, &where); rs != NULL;
	    rs = zfs_btree_next(t, &where, &where)) {
		uint64_t offset = (zfs_rs_get_start(rs, rt) - sm->sm_start) >>
		    sm->sm_shift;
		uint64_t length = (zfs_rs_get_end(rs, rt) -
		    zfs_rs_get_start(rs, rt)) >> sm->sm_shift;
		uint8_t words = 1;

		/*
		 * We only write two-word entries when both of the following
		 * are true:
		 *
		 * [1] The feature is enabled.
		 * [2] The offset or run is too big for a single-word entry,
		 *	or the vdev_id is set (meaning not equal to
		 *	SM_NO_VDEVID).
		 *
		 * Note that for purposes of testing we've added the case that
		 * we write two-word entries occasionally when the feature is
		 * enabled and zfs_force_some_double_word_sm_entries has been
		 * set.
		 */
		if (spa_feature_is_active(spa, SPA_FEATURE_SPACEMAP_V2) &&
		    (offset >= (1ULL << SM_OFFSET_BITS) ||
		    length > SM_RUN_MAX ||
		    vdev_id != SM_NO_VDEVID ||
		    (zfs_force_some_double_word_sm_entries &&
		    random_in_range(100) == 0)))
			words = 2;

		space_map_write_seg(sm, zfs_rs_get_start(rs, rt),
		    zfs_rs_get_end(rs, rt), maptype, vdev_id, words, &db,
		    FTAG, tx);
	}
```

L704-L711: the range tree is walked in offset order; each segment is turned into an offset and a length in `sm_shift` units, relative to the start of the map. L712-L734: one word unless the `spacemap_v2` feature is active and the offset does not fit in 47 bits, the run is longer than `SM_RUN_MAX` (2^15 units), or a vdev id must be stored (only the pool-wide log space map stores one). The feature is activated as soon as it is enabled (`ZFEATURE_FLAG_ACTIVATE_ON_ENABLE`, [`module/zcommon/zfeature_common.c#L427-L431`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfeature_common.c#L427-L431)), and a new pool enables every feature, so a run longer than `SM_RUN_MAX` is one two-word entry; without the feature, `space_map_write_seg` would cut it into one-word runs of at most `SM_RUN_MAX` (excerpt 3, L633). With `sm_shift` = 12 (4 KiB units: a metaslab's map is opened with the vdev's `ashift` as its shift, [`module/zfs/metaslab.c#L2920-L2921`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L2920-L2921)), `SM_RUN_MAX` is 128 MiB. The `zfs_force_some_double_word_sm_entries` branch is a test tunable, off by default. Just above, L679, `space_map_write_impl` writes one debug entry first (excerpt 5), and `space_map_write` returns early, writing nothing, when the tree is empty ([L775-L778](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L775-L778)); it also adds the tree's space to `smp_alloc` for ALLOC and subtracts it for FREE ([L780-L783](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L780-L783)).

### 5. `space_map_write_intro_debug` — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L529-L543

```c
static void
space_map_write_intro_debug(space_map_t *sm, maptype_t maptype, dmu_tx_t *tx)
{
	dmu_buf_will_dirty(sm->sm_dbuf, tx);

	uint64_t dentry = SM_PREFIX_ENCODE(SM_DEBUG_PREFIX) |
	    SM_DEBUG_ACTION_ENCODE(maptype) |
	    SM_DEBUG_SYNCPASS_ENCODE(spa_sync_pass(tx->tx_pool->dp_spa)) |
	    SM_DEBUG_TXG_ENCODE(dmu_tx_get_txg(tx));

	dmu_write(sm->sm_os, space_map_object(sm), sm->sm_phys->smp_length,
	    sizeof (dentry), &dentry, tx, DMU_READ_NO_PREFETCH);

	sm->sm_phys->smp_length += sizeof (dentry);
}
```

Every append of one tree starts with a debug word: prefix 2, the map type as action (0 for ALLOC, 1 for FREE, `maptype_t` [`include/sys/space_map.h#L142-L145`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L142-L145)), the sync pass and the txg. So a txg that both allocates and frees appends `debug, ALLOC entries, debug, FREE entries`. When the map is read back, debug entries only tell which txg the following entries belong to; a padding entry (txg 0) is skipped ([L121-L142](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L121-L142)).

### 6. The entry layouts — include/sys/space_map.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L104-L140

```c
/*
 * debug entry
 *
 *     2     2        10                     50
 *  +-----+-----+------------+----------------------------------+
 *  | 1 0 | act |  syncpass  |        txg (lower bits)          |
 *  +-----+-----+------------+----------------------------------+
 *   63 62 61 60 59        50 49                                0
 *
 *
 * one-word entry
 *
 *    1               47                   1           15
 *  +-----------------------------------------------------------+
 *  | 0 |   offset (sm_shift units)    | type |       run       |
 *  +-----------------------------------------------------------+
 *   63  62                          16   15   14               0
 *
 *
 * two-word entry
 *
 *     2     2               36                      24
 *  +-----+-----+---------------------------+-------------------+
 *  | 1 1 | pad |            run            |       vdev        |
 *  +-----+-----+---------------------------+-------------------+
 *   63 62 61 60 59                       24 23                 0
 *
 *     1                            63
 *  +------+----------------------------------------------------+
 *  | type |                      offset                        |
 *  +------+----------------------------------------------------+
 *     63   62                                                  0
 *
 * Note that a two-word entry will not straddle a block boundary.
 * If necessary, the last word of a block will be padded with a
 * debug entry (with act = syncpass = txg = 0).
 */
```

Three kinds of 64-bit words, told apart by their top bits: `0` a one-word entry, `10` a debug entry, `11` the first word of a two-word entry ([`module/zfs/space_map.c#L63-L80`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L63-L80)). The run is stored minus one (excerpt 7, L189-L190 and L194-L195), so a one-word run goes from 1 to 2^15 units. L137-L139: a two-word entry never straddles two blocks of the space map object; if only one word is left in a block, it is padded with an empty debug entry ([`module/zfs/space_map.c#L615-L631`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L615-L631)).

### 7. The encoding macros — include/sys/space_map.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L175-L203

```c
#define	SM_PREFIX_DECODE(x)	BF64_DECODE(x, 62, 2)
#define	SM_PREFIX_ENCODE(x)	BF64_ENCODE(x, 62, 2)

#define	SM_DEBUG_ACTION_DECODE(x)	BF64_DECODE(x, 60, 2)
#define	SM_DEBUG_ACTION_ENCODE(x)	BF64_ENCODE(x, 60, 2)
#define	SM_DEBUG_SYNCPASS_DECODE(x)	BF64_DECODE(x, 50, 10)
#define	SM_DEBUG_SYNCPASS_ENCODE(x)	BF64_ENCODE(x, 50, 10)
#define	SM_DEBUG_TXG_DECODE(x)		BF64_DECODE(x, 0, 50)
#define	SM_DEBUG_TXG_ENCODE(x)		BF64_ENCODE(x, 0, 50)

#define	SM_OFFSET_DECODE(x)	BF64_DECODE(x, 16, SM_OFFSET_BITS)
#define	SM_OFFSET_ENCODE(x)	BF64_ENCODE(x, 16, SM_OFFSET_BITS)
#define	SM_TYPE_DECODE(x)	BF64_DECODE(x, 15, 1)
#define	SM_TYPE_ENCODE(x)	BF64_ENCODE(x, 15, 1)
#define	SM_RUN_DECODE(x)	(BF64_DECODE(x, 0, SM_RUN_BITS) + 1)
#define	SM_RUN_ENCODE(x)	BF64_ENCODE((x) - 1, 0, SM_RUN_BITS)
#define	SM_RUN_MAX		SM_RUN_DECODE(~0ULL)
#define	SM_OFFSET_MAX		SM_OFFSET_DECODE(~0ULL)

#define	SM2_RUN_DECODE(x)	(BF64_DECODE(x, SPA_VDEVBITS, SM2_RUN_BITS) + 1)
#define	SM2_RUN_ENCODE(x)	BF64_ENCODE((x) - 1, SPA_VDEVBITS, SM2_RUN_BITS)
#define	SM2_VDEV_DECODE(x)	BF64_DECODE(x, 0, SPA_VDEVBITS)
#define	SM2_VDEV_ENCODE(x)	BF64_ENCODE(x, 0, SPA_VDEVBITS)
#define	SM2_TYPE_DECODE(x)	BF64_DECODE(x, SM2_OFFSET_BITS, 1)
#define	SM2_TYPE_ENCODE(x)	BF64_ENCODE(x, SM2_OFFSET_BITS, 1)
#define	SM2_OFFSET_DECODE(x)	BF64_DECODE(x, 0, SM2_OFFSET_BITS)
#define	SM2_OFFSET_ENCODE(x)	BF64_ENCODE(x, 0, SM2_OFFSET_BITS)
#define	SM2_RUN_MAX		SM2_RUN_DECODE(~0ULL)
#define	SM2_OFFSET_MAX		SM2_OFFSET_DECODE(~0ULL)
```

`BF64_ENCODE(x, low, len)` is `(P2PHASE((x), 1ULL << (len)) << (low))` and `BF64_DECODE(x, low, len)` is `P2PHASE((x) >> (low), 1ULL << (len))` ([`include/sys/bitops.h#L46-L48`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/bitops.h#L46-L48)): the value is masked to `len` bits, then shifted. `SPA_VDEVBITS` is 24 ([`include/sys/spa.h#L103`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L103)), so the vdev field of a two-word entry is bits 0-23 and its run bits 24-59; `SM_NO_VDEVID` is `1 << 24` ([L163](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L163)), which the 24-bit mask turns into 0 in a two-word entry written without a vdev. `SM_RUN_MAX` is `SM_RUN_DECODE(~0ULL)` = 2^15 and `SM2_RUN_MAX` = 2^36 (L191, L202). The museum's encoder implements these macros, and the unit tests check its words against values computed by hand from them.

### 8. `metaslab_block_picker` — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1770-L1802

```c
static uint64_t
metaslab_block_picker(zfs_range_tree_t *rt, uint64_t *cursor, uint64_t size,
    uint64_t max_size, uint64_t max_search, uint64_t *found_size)
{
	if (*cursor == 0)
		*cursor = rt->rt_start;
	zfs_btree_t *bt = &rt->rt_root;
	zfs_btree_index_t where;
	zfs_range_seg_t *rs = metaslab_block_find(bt, rt, *cursor, size,
	    max_size, &where);
	uint64_t first_found;
	int count_searched = 0;

	if (rs != NULL)
		first_found = zfs_rs_get_start(rs, rt);

	while (rs != NULL && (zfs_rs_get_start(rs, rt) - first_found <=
	    max_search || count_searched < metaslab_min_search_count)) {
		uint64_t offset = zfs_rs_get_start(rs, rt);
		if (offset + size <= zfs_rs_get_end(rs, rt)) {
			*found_size = MIN(zfs_rs_get_end(rs, rt) - offset,
			    max_size);
			*cursor = offset + *found_size;
			return (offset);
		}
		rs = zfs_btree_next(bt, &where, &where);
		count_searched++;
	}

	*cursor = 0;
	*found_size = 0;
	return (-1ULL);
}
```

L1774-L1775: a cursor at 0 starts from the beginning of the tree (`rt_start`, the metaslab's start). L1778-L1779: `metaslab_block_find` ([L1734-L1763](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1734-L1763)) returns the free segment that overlaps `[cursor, cursor + max_size)` or, when the request is of one size (`size == max_size`), the next one after the cursor. L1786-L1797: from there it walks forward in offset order, at most `max_search` bytes (16 MiB, `metaslab_df_max_search` [L192](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L192)) past the first segment found and at least `metaslab_min_search_count` = 100 segments ([L199](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L199)), and takes the first segment the request fits in, from its start. L1792: the cursor moves to the end of what was taken, so the next allocation of the same alignment continues right after it. L1799-L1801: nothing found, the cursor goes back to 0 and the caller falls back.

### 9. `metaslab_df_alloc` — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1905-L1931

```c
	uint64_t align = max_size & -max_size;
	uint64_t *cursor = &msp->ms_lbas[highbit64(align) - 1];
	zfs_range_tree_t *rt = msp->ms_allocatable;
	uint_t free_pct = zfs_range_tree_space(rt) * 100 / msp->ms_size;
	uint64_t offset;

	ASSERT(MUTEX_HELD(&msp->ms_lock));

	/*
	 * If we're running low on space, find a segment based on size,
	 * rather than iterating based on offset.
	 */
	if (metaslab_largest_allocatable(msp) < metaslab_df_alloc_threshold ||
	    free_pct < metaslab_df_free_pct) {
		align = size & -size;
		cursor = &msp->ms_lbas[highbit64(align) - 1];
		offset = -1;
	} else {
		offset = metaslab_block_picker(rt, cursor, size, max_size,
		    metaslab_df_max_search, found_size);
		if (max_size != size && offset == -1) {
			align = size & -size;
			cursor = &msp->ms_lbas[highbit64(align) - 1];
			offset = metaslab_block_picker(rt, cursor, size,
			    max_size, metaslab_df_max_search, found_size);
		}
	}
```

"Dynamic fit" ([comment, L1874-L1893](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1874-L1893)). L1905-L1906: one cursor per power-of-two alignment of the request, `ms_lbas[]` ([`include/sys/metaslab_impl.h#L506`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L506)); every 128 KiB block uses `ms_lbas[17]`. L1917-L1921: when the largest free segment is under `metaslab_df_alloc_threshold` (`SPA_OLD_MAXBLOCKSIZE`, 128 KiB, [L169](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L169)) or less than `metaslab_df_free_pct` = 4 % of the metaslab is free ([L177](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L177)), it does not search by offset. L1922-L1930: otherwise, first fit from the cursor. Then, if nothing was found ([L1933-L1954](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1933-L1954)): the size-sorted tree `ms_allocatable_by_size` gives a segment of exactly the requested size or the next larger one (`metaslab_df_use_largest_segment` is off, [L208](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L208)); the size tree is ordered by size, then offset, so that is the smallest segment that fits, the lowest one among equals; the cursor moves to the end of the allocation. The range tree keeps adjacent segments merged (`zfs_range_tree_add` joins a segment with its neighbours, [`module/zfs/range_tree.c#L387-L394`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/range_tree.c#L387-L394)), so blocks allocated one after the other in one txg are one extent of `ms_allocating`, and one entry on the map.

### 10. `metaslab_sync_done`, the deferred frees — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4624-L4638

```c
	/*
	 * Move the frees from the defer_tree back to the free
	 * range tree (if it's loaded). Swap the freed_tree and
	 * the defer_tree -- this is safe to do because we've
	 * just emptied out the defer_tree.
	 */
	zfs_range_tree_vacate(*defer_tree,
	    msp->ms_loaded ? zfs_range_tree_add : NULL, msp->ms_allocatable);
	if (defer_allowed) {
		zfs_range_tree_swap(&msp->ms_freed, defer_tree);
	} else {
		zfs_range_tree_vacate(msp->ms_freed,
		    msp->ms_loaded ? zfs_range_tree_add : NULL,
		    msp->ms_allocatable);
	}
```

At the end of each txg's sync. `defer_tree` is `ms_defer[txg % TXG_DEFER_SIZE]` ([L4571](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4571)). L4630-L4631: the frees that were deferred two txgs ago go back into `ms_allocatable` (if the metaslab is loaded). L4632-L4633: this txg's frees, `ms_freed`, take their place. `ms_freed` received this txg's `ms_freeing` right after the space map was written ([L4493-L4494](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4493-L4494)), and `ms_freeing` is where a free lands, in syncing context ([L5518-L5528](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5518-L5528)). So a block freed in txg T is written to the map as FREE at the sync of T and is allocatable again at the end of the sync of T + 2. Deferring is skipped (L4635-L4637) only when the pool is almost full (free space at most the slop space), or a vdev is being removed or expanded ([L4573-L4578](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4573-L4578)). A metaslab with deferred space stays dirty for the next txg, so this runs every txg until the frees are back ([L4645-L4651](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4645-L4651)).

### 11. `space_map_load_callback` — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L401-L416

```c
static int
space_map_load_callback(space_map_entry_t *sme, void *arg)
{
	space_map_load_arg_t *smla = arg;
	if (sme->sme_type == smla->smla_type) {
		VERIFY3U(zfs_range_tree_space(smla->smla_rt) + sme->sme_run, <=,
		    smla->smla_sm->sm_size);
		zfs_range_tree_add(smla->smla_rt, sme->sme_offset,
		    sme->sme_run);
	} else {
		zfs_range_tree_remove(smla->smla_rt, sme->sme_offset,
		    sme->sme_run);
	}

	return (0);
}
```

`space_map_load_length` ([L423-L443](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L423-L443)) loads a map of free space (`maptype` SM_FREE) by first adding the whole region (L430-L431) and then replaying every entry in order with this callback: an entry of the loaded type is added, the other type is removed. `metaslab_load_impl` loads up to `ms_synced_length`, the length at the end of the last sync ([L2514](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L2514), [L2529-L2531](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L2529-L2531); set at [L4640](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4640)), then removes the two deferred trees, whose frees are on the map but not allocatable yet ([L2649-L2652](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L2649-L2652)). Without the log space map, there are no unflushed changes to apply (L2600-L2603 walk empty trees). A metaslab whose map was never written loads as entirely free ([L2543-L2557](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L2543-L2557)).

### 12. `metaslab_should_condense` — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3835-L3861

```c
static boolean_t
metaslab_should_condense(metaslab_t *msp)
{
	space_map_t *sm = msp->ms_sm;
	vdev_t *vd = msp->ms_group->mg_vd;
	uint64_t vdev_blocksize = 1ULL << vd->vdev_ashift;

	ASSERT(MUTEX_HELD(&msp->ms_lock));
	ASSERT(msp->ms_loaded);
	ASSERT(sm != NULL);
	ASSERT3U(spa_sync_pass(vd->vdev_spa), ==, 1);

	/*
	 * We always condense metaslabs that are empty and metaslabs for
	 * which a condense request has been made.
	 */
	if (zfs_range_tree_numsegs(msp->ms_allocatable) == 0 ||
	    msp->ms_condense_wanted)
		return (B_TRUE);

	uint64_t record_size = MAX(sm->sm_blksz, vdev_blocksize);
	uint64_t object_size = space_map_length(sm);
	uint64_t optimal_size = space_map_estimate_optimal_size(sm,
	    msp->ms_allocatable, SM_NO_VDEVID);

	return (object_size >= (optimal_size * zfs_condense_pct / 100) &&
	    object_size > zfs_metaslab_condense_block_threshold * record_size);
```

Called in sync pass 1 only, on a loaded metaslab, from `metaslab_sync` ([L4363-L4365](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4363-L4365)), which itself returns before this point when the txg has no allocation, free or checkpoint for the metaslab and no condense was asked for ([L4279-L4284](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4279-L4284)). L3851-L3853: an empty free tree, or a requested condense, always condenses. L3855: a "record" is the larger of the map's block size and the vdev's sector. L3857-L3858: the optimal size is the estimate for writing `ms_allocatable` alone (excerpt 13). L3860-L3861: condense when the map is at least `zfs_condense_pct` / 100 times the optimal size (200 %, [L89](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L89)) and longer than `zfs_metaslab_condense_block_threshold` = 4 records ([L104](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L104)). Without the log space map, a metaslab's map has blocks of `zfs_metaslab_sm_blksz_no_log` = 16 KiB ([L74](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L74), allocated at [L4309-L4313](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4309-L4313)), so with 4 KiB sectors the second test is a map longer than 64 KiB, 8192 words.

### 13. `space_map_estimate_optimal_size` — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L1033-L1069

```c
	uint64_t size = 0;
	uint64_t idx = 0;

	if (!spa_feature_is_enabled(spa, SPA_FEATURE_SPACEMAP_V2) ||
	    (vdev_id == SM_NO_VDEVID && sm->sm_size < SM_OFFSET_MAX)) {

		/*
		 * If we are trying to force some double word entries just
		 * assume the worst-case of every single word entry being
		 * written as a double word entry.
		 */
		uint64_t entry_size =
		    (spa_feature_is_enabled(spa, SPA_FEATURE_SPACEMAP_V2) &&
		    zfs_force_some_double_word_sm_entries) ?
		    (2 * sizeof (uint64_t)) : sizeof (uint64_t);

		uint64_t single_entry_max_bucket = SM_RUN_BITS + shift - 1;
		for (; idx <= single_entry_max_bucket; idx++)
			size += histogram[idx] * entry_size;

		if (!spa_feature_is_enabled(spa, SPA_FEATURE_SPACEMAP_V2)) {
			for (; idx < ZFS_RANGE_TREE_HISTOGRAM_SIZE; idx++) {
				ASSERT3U(idx, >=, single_entry_max_bucket);
				entries_for_seg =
				    1ULL << (idx - single_entry_max_bucket);
				size += histogram[idx] *
				    entries_for_seg * entry_size;
			}
			return (size);
		}
	}

	ASSERT(spa_feature_is_enabled(spa, SPA_FEATURE_SPACEMAP_V2));

	uint64_t double_entry_max_bucket = SM2_RUN_BITS + shift - 1;
	for (; idx <= double_entry_max_bucket; idx++)
		size += histogram[idx] * 2 * sizeof (uint64_t);
```

A worst-case estimate from the range tree's histogram, not a walk of its segments (the whole function, [L1033-L1085](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L1033-L1085)). `rt_histogram[i]` counts the segments whose size in bytes is in [2^i, 2^(i+1)) (`idx = highbit64(size) - 1`, [`module/zfs/range_tree.c#L131-L132`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/range_tree.c#L131-L132)). For a metaslab map (`SM_NO_VDEVID`, and a metaslab is far smaller than `SM_OFFSET_MAX`) with `spacemap_v2` enabled: segments up to bucket `SM_RUN_BITS + shift - 1` (26 with 4 KiB units, under 128 MiB) count one word, L1049-L1051; larger ones, up to bucket `SM2_RUN_BITS + shift - 1`, two words, L1067-L1069; larger still, more two-word entries ([L1071-L1076](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L1071-L1076), unreachable in a metaslab of at most 16 GiB). Then one padding word per block of the result, plus one ([L1078-L1083](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L1078-L1083)). Example: one free segment of 480 MiB (bucket 28) gives 16 bytes, plus (16 / 16384 + 1) × 8 = 8, 24 bytes.

### 14. `metaslab_condense`, the rewrite — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3994-L4013

```c
	/*
	 * Note:
	 * When the log space map feature is enabled, each space map will
	 * always have ALLOCS followed by FREES for each sync pass. This is
	 * typically true even when the log space map feature is disabled,
	 * except from the case where a metaslab goes through metaslab_sync()
	 * and gets condensed. In that case the metaslab's space map will have
	 * ALLOCS followed by FREES (due to condensing) followed by ALLOCS
	 * followed by FREES (due to space_map_write() in metaslab_sync()) for
	 * sync pass 1.
	 */
	zfs_range_tree_t *tmp_tree = zfs_range_tree_create_flags(
	    NULL, type, NULL, start, shift,
	    ZFS_RT_F_DYN_NAME,
	    metaslab_rt_name(msp->ms_group, msp, "tmp_tree"));
	zfs_range_tree_add(tmp_tree, msp->ms_start, msp->ms_size);
	space_map_write(sm, tmp_tree, SM_ALLOC, SM_NO_VDEVID, tx);
	space_map_write(sm, msp->ms_allocatable, SM_FREE, SM_NO_VDEVID, tx);
	space_map_write(sm, condense_tree, SM_FREE, SM_NO_VDEVID, tx);

```

Before this point the condense tree has received the two deferred trees and the allocation trees of the txgs in flight ([L3949-L3957](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3949-L3957)): they are free in the old map's view (deferred frees were written as FREE; this txg's allocations are not written yet). `ms_condensing` is set so no allocation happens meanwhile ([L3974](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3974), checked by `metaslab_block_alloc` L4864, excerpt 1), and the map is truncated to length 0, `smp_alloc` 0 ([L3978-L3980](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3978-L3980); `space_map_truncate` [`module/zfs/space_map.c#L908-L910`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L908-L910)). L4009-L4010: one ALLOC entry for the whole metaslab. L4011: one FREE entry per segment of `ms_allocatable`. L4012: one FREE entry per segment of the condense tree. Then `metaslab_sync` goes on and appends this txg's ALLOC and FREE entries as usual (L3994-L4003 says so). Replaying the condensed map therefore gives the same free tree, deferred frees included, as replaying the long one. The metaslab must be loaded: condensing writes from the in-core tree.

**Short excerpts for the question-first room (v1.4, ALG-197).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis. Excerpt 15 is new; 16 to 22 are cuts of excerpts 9, 1, 2, 10, 11, 12 and 14. Each is checked against the frozen commit like the others.

### 15. `metaslab_compare`, the order of the metaslabs — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L947-L960

```c
	/*
	 * Sort inactive metaslabs first, then primaries, then secondaries. When
	 * selecting a metaslab to allocate from, an allocator first tries its
	 * primary, then secondary active metaslab. If it doesn't have active
	 * metaslabs, or can't allocate from them, it searches for an inactive
	 * metaslab to activate. If it can't find a suitable one, it will steal
	 * a primary or secondary metaslab from another allocator.
	 */
	if (sort1 < sort2)
		return (-1);
	if (sort1 > sort2)
		return (1);

	int cmp = TREE_CMP(m2->ms_weight, m1->ms_weight);
```

How a metaslab group keeps its metaslabs sorted, for the room's "Choosing a metaslab" note. L947-L954: the comment states the policy: an allocator first tries its primary active metaslab, then its secondary, and only if it has none or they cannot take the allocation does it look for an inactive metaslab to activate. L955-L958: inactive metaslabs sort before active ones, so that search walks the inactive ones first. L960: within each group, a higher `ms_weight` comes first. The weight is segment-based by default (`zfs_metaslab_segment_weight_enabled`, [L259](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L259)): `metaslab_segment_weight` ([L3389-L3442](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3389-L3442)) encodes the highest bucket of the free-segment histogram that has segments, and how many. `find_valid_metaslab` walks this tree and skips a metaslab for which `metaslab_should_allocate` says its largest free segment is too small ([L4924-L4937](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4924-L4937); [L3454-L3493](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3454-L3493)).

### 16. `metaslab_df_alloc`, the cursor or the size — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1917-L1924

```c
	if (metaslab_largest_allocatable(msp) < metaslab_df_alloc_threshold ||
	    free_pct < metaslab_df_free_pct) {
		align = size & -size;
		cursor = &msp->ms_lbas[highbit64(align) - 1];
		offset = -1;
	} else {
		offset = metaslab_block_picker(rt, cursor, size, max_size,
		    metaslab_df_max_search, found_size);
```

Excerpt 9 from its test on. L1917-L1921: with no free segment of at least `metaslab_df_alloc_threshold` (128 KiB) or under 4 % free, no forward search (`offset = -1`), and the fallback after this excerpt takes a segment by size ([L1933-L1954](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1933-L1954)). L1923-L1924: otherwise `metaslab_block_picker` searches forward from the cursor.

### 17. `metaslab_block_alloc`, from the free tree to the open txg — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4877-L4884

```c
		zfs_range_tree_remove(rt, start, size);
		zfs_range_tree_clear(msp->ms_trim, start, size);

		if (zfs_range_tree_is_empty(msp->ms_allocating[txg & TXG_MASK]))
			vdev_dirty(mg->mg_vd, VDD_METASLAB, msp, txg);

		zfs_range_tree_add(msp->ms_allocating[txg & TXG_MASK], start,
		    size);
```

Excerpt 1, the two trees. L4877: the extent leaves `ms_allocatable`, the free tree. L4880-L4881: the first allocation of a txg in this metaslab marks it dirty for that txg's sync. L4883-L4884: the extent goes into `ms_allocating` of this txg. Nothing reaches the disk here.

### 18. `metaslab_sync`, the append — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4400-L4403

```c
		space_map_write(msp->ms_sm, alloctree, SM_ALLOC,
		    SM_NO_VDEVID, tx);
		space_map_write(msp->ms_sm, msp->ms_freeing, SM_FREE,
		    SM_NO_VDEVID, tx);
```

Excerpt 2, the branch without a log space map. The txg's allocation tree is appended as ALLOC entries, then `ms_freeing` as FREE entries, to the metaslab's own space map; `SM_NO_VDEVID` says the entries carry no vdev id. Nothing already on disk is rewritten.

### 19. `metaslab_sync_done`, the deferred frees, swapped — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4630-L4633

```c
	zfs_range_tree_vacate(*defer_tree,
	    msp->ms_loaded ? zfs_range_tree_add : NULL, msp->ms_allocatable);
	if (defer_allowed) {
		zfs_range_tree_swap(&msp->ms_freed, defer_tree);
```

Excerpt 10, the swap alone. L4630-L4631: the tree deferred two txgs ago goes back into `ms_allocatable` (if loaded). L4632-L4633: this txg's frees take its place in `ms_defer[txg % TXG_DEFER_SIZE]`.

### 20. `space_map_load_callback`, the replay — module/zfs/space_map.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/space_map.c#L405-L413

```c
	if (sme->sme_type == smla->smla_type) {
		VERIFY3U(zfs_range_tree_space(smla->smla_rt) + sme->sme_run, <=,
		    smla->smla_sm->sm_size);
		zfs_range_tree_add(smla->smla_rt, sme->sme_offset,
		    sme->sme_run);
	} else {
		zfs_range_tree_remove(smla->smla_rt, sme->sme_offset,
		    sme->sme_run);
	}
```

Excerpt 11 without its signature. Loading free space, `smla_type` is `SM_FREE`: a FREE entry is added to the tree (L405-L409), an ALLOC entry removed (L410-L413). The tree starts as the whole metaslab, so replaying the map in order gives the free space.

### 21. `metaslab_should_condense`, the two tests — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3855-L3861

```c
	uint64_t record_size = MAX(sm->sm_blksz, vdev_blocksize);
	uint64_t object_size = space_map_length(sm);
	uint64_t optimal_size = space_map_estimate_optimal_size(sm,
	    msp->ms_allocatable, SM_NO_VDEVID);

	return (object_size >= (optimal_size * zfs_condense_pct / 100) &&
	    object_size > zfs_metaslab_condense_block_threshold * record_size);
```

Excerpt 12 after its early returns. L3855: a record is the larger of the map's block size and a sector. L3856: the map's length on disk. L3857-L3858: the size the free tree would take if written alone (excerpt 13). L3860-L3861: condense when the map is at least `zfs_condense_pct` (200 %) of that and longer than `zfs_metaslab_condense_block_threshold` (4) records.

### 22. `metaslab_condense`, the rewrite — module/zfs/metaslab.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L4009-L4012

```c
	zfs_range_tree_add(tmp_tree, msp->ms_start, msp->ms_size);
	space_map_write(sm, tmp_tree, SM_ALLOC, SM_NO_VDEVID, tx);
	space_map_write(sm, msp->ms_allocatable, SM_FREE, SM_NO_VDEVID, tx);
	space_map_write(sm, condense_tree, SM_FREE, SM_NO_VDEVID, tx);
```

Excerpt 14, the three writes. After the truncation, one ALLOC entry for the whole metaslab (L4009-L4010), one FREE entry per segment of the free tree (L4011), then one FREE entry per segment of the condense tree, the deferred frees and the allocations of the txgs in flight (L4012).

**What the animation shows.**
- A top-level vdev of `vdev_asize` 8 GiB with `ashift` 12 cut into 16 metaslabs of 512 MiB: `vdev_metaslab_set_size` gives `ms_count = asize >> 29` = 16, which is not under `zfs_vdev_min_ms_count` = 16 nor over 200, so `ms_shift` = 29 ([`module/zfs/vdev.c#L3021-L3026`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L3021-L3026), the table of [L3006-L3013](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L3006-L3013)). The visitor's writes all go to metaslab 2, `ms_start` = 1 GiB, drawn zoomed: its free tree `ms_allocatable` (L376), the extents allocated in the open txg (`ms_allocating[txg & TXG_MASK]`, L375), the frees of the open txg (`ms_freeing`, L385), the two deferred trees (`ms_defer[]`, L388) with the txg at which each comes back, and the dynamic-fit cursor `ms_lbas[17]`.
- Write a file of 4, 32 or 160 MiB: one 128 KiB block at a time through `metaslab_df_alloc` (excerpts 8 and 9), each removed from `ms_allocatable` and added to `ms_allocating` (excerpt 1, L4877-L4884); consecutive blocks merge into one extent. Delete a synced file: its extents go to `ms_freeing` (L5527).
- Sync the open txg: `metaslab_sync` appends `debug, ALLOC…, debug, FREE…` to the tape, the metaslab's own space map (excerpt 2, L4397-L4404; excerpts 3-5), with padding at 16 KiB block boundaries; `smp_length` and `smp_alloc` are updated; then `metaslab_sync_done` moves the deferred trees (excerpt 10).
- Select an entry on the tape: its words in hexadecimal and their fields, laid out as space_map.h draws them (excerpts 6-7): one-word (offset 47 bits, type 1, run 15, stored minus one), two-word (prefix, pad, run 36, vdev 24; type, offset 63) or debug (prefix, action, sync pass, txg).
- "Load": `ms_allocatable` is emptied, the whole metaslab is added, the tape is replayed entry by entry (FREE adds, ALLOC removes), then the deferred trees are removed (excerpt 11); the result is compared with the tree before.
- "Condense": `metaslab_should_condense` evaluated on the current state, its two tests shown with their numbers (excerpts 12-13). Refused: the reason. Accepted: the open txg is synced with the condense first (excerpt 14, then excerpt 2). A plain sync also condenses when the test says yes, as `metaslab_sync` does at L4363-L4365.
- "Rewrite": a 64 MiB file whose random 128 KiB blocks are rewritten, 128 per txg (copy-on-write: each rewrite frees the old block and allocates a new one), for up to 40 txgs; it stops before a sync that would condense, so the condense can be watched. The workload is deterministic (mulberry32 from a fixed seed), and its numbers are pinned by the model's tests: from the opening state, a first run of 40 txgs leaves the map under 64 KiB; a second run stops before the sync of its 28th txg (67 txgs synced, about 70) with the map at 65,840 bytes, while the free tree has 189 segments (about two hundred) and an optimal size of 1,528 bytes (under 2 KiB); the condense rewrites the map to 3,256 bytes. A few writes and deletes before it move these figures by a txg or a few hundred bytes (QA's replay on ALG-91: 40 + 29 txgs, 66,336 → 3,200 bytes).
- Simplified, logged in `DECISIONS.md` D7.2: the pool has no log space map (the 2.4.4 default is to have one; `metaslab_sync` L4373-L4396 then writes to the pool-wide log, with vdev ids and two-word entries, and the metaslab's own map only at flush time); one sync pass per txg and one txg in flight (the open txg is synced at once, with no quiescing); metaslab selection (weights, activation, `metaslab_alloc_dva_range`'s rotor, [`module/zfs/metaslab.c#L5431-L5464`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L5431-L5464)), allocation throttling, gang blocks, ditto copies, checkpoint, trim and the space map histogram are not drawn; every block is 128 KiB, so one cursor; files never span metaslabs (a write that does not fit is refused instead of moving to another metaslab).

**Hand-checked sequence** (the unit tests replay it). Metaslab 2: `ms_start` 0x40000000, `ms_size` 0x20000000, `sm_shift` 12, units of 4 KiB; the map is empty and txg 10 is open.
- Txg 10: write A, 32 MiB = 256 blocks. Cursor 0 → `rt_start` (L1774-L1775), the free segment from the start fits, A = [0x40000000, 0x42000000), cursor at its end. Sync: `metaslab_should_condense` no (map 0 bytes; optimal: one free segment of 480 MiB, 24 bytes). Tape: debug ALLOC pass 1 txg 10 = `0x800400000000000A`; ALLOC offset 0 run 8192 units = `0x0000000000001FFF`. `smp_length` 16, `smp_alloc` 32 MiB.
- Txg 11: write B, 4 MiB, at the cursor: B = [0x42000000, 0x42400000). Tape: `0x800400000000000B`, then ALLOC offset 0x2000 run 1024 = `0x00000000200003FF`. `smp_length` 32.
- Txg 12: delete A. Tape: debug FREE txg 12 = `0x900400000000000C`, FREE offset 0 run 8192 = `0x0000000000009FFF`. `smp_alloc` 4 MiB. After `metaslab_sync_done(12)`: A is in `ms_defer[0]`, not allocatable. Loading now: whole metaslab, minus A, minus B, plus A, minus `ms_defer[0]` (A) = [0x42400000, 0x60000000), the in-core tree.
- Txgs 13 and 14 sync with nothing to write: no entry. At the end of the sync of 14 = 12 + `TXG_DEFER_SIZE`, `ms_defer[0]` goes back: `ms_allocatable` = [0x40000000, 0x42000000) and [0x42400000, 0x60000000).
- Txg 15: write C, 160 MiB = 1280 blocks. The cursor is at 0x42400000, past A's hole: C = [0x42400000, 0x4C400000). Its run is 40960 units > `SM_RUN_MAX` (32768): one two-word entry. Tape: `0x800400000000000F`, then `0xC000009FFF000000` (prefix 3, run − 1 = 0x9FFF at bit 24, vdev field 0) and `0x0000000000002400` (type ALLOC, offset 0x2400). `smp_length` 72.
- Txg 16: delete C. Tape: `0x9004000000000010`, `0xC000009FFF000000`, `0x8000000000002400`. `smp_length` 96.
- Condense asked now: refused. `ms_allocatable` has two segments, A (32 MiB, bucket 25: 8 bytes) and [0x4C400000, 0x60000000) (316 MiB, bucket 28: 16 bytes); optimal 24 + 8 = 32 bytes; 96 ≥ 64 holds, but 96 > 4 × 16384 does not.
- Txg 17: write D, 4 MiB. C is still deferred (until the end of the sync of 18) and the cursor is at 0x4C400000: D = [0x4C400000, 0x4C800000), not in A's hole.
- Txg 17, then: write E, 312 MiB, which ends exactly at the end of the metaslab (cursor 0x60000000), then F, 4 MiB: no segment at or after the cursor, `metaslab_block_picker` returns −1 and resets the cursor; 32 MiB of 512 are free (6 %, over `metaslab_df_free_pct`), so this was the offset search, and the fallback takes the smallest segment that fits from the size tree: A. F = [0x40000000, 0x40400000).
- Were the map condensed at the sync of txg 17 (`metaslab_should_condense` says no here; a condense requested through `ms_condense_wanted`, [L3186-L3188](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3186-L3188), would do it), `metaslab_condense` would write, before txg 17's own entries, with `ms_defer[0]` = C and txg 17's allocating tree D, E, F: debug ALLOC, the whole metaslab as one two-word ALLOC entry (`0xC00001FFFF000000`, `0x0000000000000000`: run 131072 units), debug FREE, then the free tree (`ms_allocatable` after F: [0x40400000, 0x42000000), 28 MiB, one word `0x0000000004009BFF`), debug FREE, then the condense tree (C, D, E and F, merged where adjacent: [0x40000000, 0x40400000) as `0x00000000000083FF` and [0x42400000, 0x60000000) as `0xC00001DBFF000000`, `0x8000000000002400`). Txg 17's own entries follow: debug ALLOC, F (`0x00000000000003FF`) and D with E (`0xC000013BFF000000`, `0x000000000000C400`). Replayed, the 13 words give [0x40400000, 0x42000000) and C; the load removes `ms_defer[0]` (C): `ms_allocatable`.

**Facts for the text**
- A top-level vdev targets `zfs_vdev_default_ms_count` = 200 metaslabs, with size-shift tunables `zfs_vdev_default_ms_shift` = 29 (commented "lower limit for metaslab size (512M)") and `zfs_vdev_max_ms_shift` = 34 ("upper limit ... (16G)") — [`module/zfs/vdev.c#L91`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L91), [`module/zfs/vdev.c#L100`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L100), [`module/zfs/vdev.c#L103`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L103).
- Freed blocks are not reusable until `TXG_DEFER_SIZE` = 2 txgs later, a safety net for uberblock rollback — [`include/sys/txg.h#L49`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/txg.h#L49), [`include/sys/metaslab_impl.h#L295-L302`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/metaslab_impl.h#L295-L302).
- One-word space map entries have a 47-bit offset and a 15-bit run; two-word entries a 63-bit offset and a 36-bit run — [`include/sys/space_map.h#L166-L173`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L166-L173).
- Condensing happens when the on-disk map is at least `zfs_condense_pct` = 200% of its optimal size and larger than `zfs_metaslab_condense_block_threshold` = 4 blocks — [`module/zfs/metaslab.c#L89`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L89), [`module/zfs/metaslab.c#L104`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L104), [`module/zfs/metaslab.c#L3860-L3861`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L3860-L3861).
- Dynamic fit searches forward from a per-alignment cursor, up to `metaslab_df_max_search` = 16 MiB past the first candidate and at least `metaslab_min_search_count` = 100 segments ([`module/zfs/metaslab.c#L199`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L199)), before falling back to a size-ordered tree — [`module/zfs/metaslab.c#L192`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L192), [`module/zfs/metaslab.c#L1917-L1931`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L1917-L1931).
- The on-disk header `space_map_phys_t` holds the log length `smp_length`, the allocated total `smp_alloc` and a free-segment histogram — [`include/sys/space_map.h#L58-L83`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/space_map.h#L58-L83).
- A whole-pool bitmap, for scale: a pool of 16 TiB with 4 KiB sectors has 2^32 sectors, so one bit per sector is 512 MiB (arithmetic, not code).
- `zpool create` enables every supported feature unless given `-d` — [`cmd/zpool/zpool_main.c#L1959-L1961`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/cmd/zpool/zpool_main.c#L1959-L1961); `spacemap_v2` is then active at once (`ZFEATURE_FLAG_ACTIVATE_ON_ENABLE`, [`module/zcommon/zfeature_common.c#L427-L431`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfeature_common.c#L427-L431)), and `log_spacemap`, which depends on it, is enabled — [`module/zcommon/zfeature_common.c#L481-L491`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zfeature_common.c#L481-L491).
- With `log_spacemap`, a txg's changes for every metaslab go to one pool-wide log and stay in memory as unflushed changes; "a selected group of metaslabs" is flushed every txg, writing those changes to the metaslabs' own maps; the design targets random-write workloads, which "append some FREE records to almost every metaslab" each txg — [`module/zfs/spa_log_spacemap.c#L36-L52`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_log_spacemap.c#L36-L52). Without it, each dirty metaslab's map is written every txg, hence small 16 KiB blocks; with it, 128 KiB — [`module/zfs/metaslab.c#L66-L81`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/metaslab.c#L66-L81).

## Room: ZIL and SLOG

**Problem.** A txg is synced every few seconds, but `fsync()` and `O_SYNC` must return only once the data is on stable storage. Forcing a whole txg sync for each such call would rewrite large parts of the tree for a few bytes of data. ZFS instead keeps a per-dataset intent log (ZIL): a chain of log blocks that records just enough to replay the operation, written immediately and thrown away once the txg holding the real change has synced. A separate log device (SLOG) gives those log blocks a fast home.

**The idea in the code.**
- `itx_t` in [`include/sys/zil.h#L461`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L461) and `lwb_t` in [`include/sys/zil_impl.h#L109`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil_impl.h#L109) — an in-memory log record per operation, and the log write block that packs many of them into one on-disk block.
- `zil_commit_impl` in [`module/zfs/zil.c#L4067`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4067) — attaches a waiter to the log, issues the lwbs (`zil_commit_writer` [`module/zfs/zil.c#L3410`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L3410), `zil_lwb_write_issue` [`module/zfs/zil.c#L1938`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1938)) and sleeps until the lwb holding its record is written and flushed.
- `zio_alloc_zil` in [`module/zfs/zio.c#L4529`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4529) — allocates each next log block, trying the log class (SLOG devices) first.

**Excerpts.**

### 1. `zil_commit_impl` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4097-L4122

```c
	zil_commit_waiter_t *zcw = zil_alloc_commit_waiter();
	zil_commit_itx_assign(zilog, zcw);

	uint64_t wtxg = zil_commit_writer(zilog, zcw);
	zil_commit_waiter(zilog, zcw);

	int err = 0;
	if (zcw->zcw_error != 0) {
		/*
		 * If there was an error writing out the ZIL blocks that
		 * this thread is waiting on, then we fallback to
		 * relying on spa_sync() to write out the data this
		 * thread is waiting on. Obviously this has performance
		 * implications, but the expectation is for this to be
		 * an exceptional case, and shouldn't occur often.
		 */
		ZIL_STAT_BUMP(zilog, zil_commit_error_count);
		DTRACE_PROBE2(zil__commit__io__error,
		    zilog_t *, zilog, zil_commit_waiter_t *, zcw);
		err = txg_wait_synced_flags(zilog->zl_dmu_pool, 0,
		    TXG_WAIT_SUSPEND);
	} else if (wtxg != 0) {
		ZIL_STAT_BUMP(zilog, zil_commit_suspend_count);
		err = txg_wait_synced_flags(zilog->zl_dmu_pool, wtxg,
		    TXG_WAIT_SUSPEND);
	}
```

L4097-L4098: a commit waiter is created and placed in the log as a special "commit itx", behind every record that must reach disk before this call returns (asynchronous itxs for the file were moved to the sync list just before, zil.c L4080). L4100: `zil_commit_writer` turns pending itxs into lwbs and issues them. L4101: `zil_commit_waiter` sleeps until the lwb carrying this waiter has been written and the disk caches flushed; `zil_commit_waiter_done` sets `zcw_done` ([`module/zfs/zil.c#L1340-L1349`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1340-L1349)). L4104-L4117: on a log write error the code falls back to waiting for a full txg sync with `txg_wait_synced_flags`, which also makes the data durable, only slower.

### 2. `zil_lwb_write_issue` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2073-L2092

```c
		error = zio_alloc_zil(spa, zilog->zl_os, txg, bp,
		    min_size, max_size, &slog, flexible);
		if (error == 0) {
			if (closed_slim)
				ASSERT3U(BP_GET_LSIZE(bp), ==, max_size);
			else if (flexible)
				nlwb->lwb_sz = BP_GET_LSIZE(bp);
			else
				ASSERT3U(BP_GET_LSIZE(bp), ==, nlwb->lwb_sz);
		}
		if (flexible)
			mutex_exit(&nlwb->lwb_lock);
	}
	if (error == 0) {
		ASSERT3U(BP_GET_BIRTH(bp), ==, txg);
		BP_SET_CHECKSUM(bp, (nlwb->lwb_flags & LWB_FLAG_SLIM) ?
		    ZIO_CHECKSUM_ZILOG2 : ZIO_CHECKSUM_ZILOG);
		bp->blk_cksum = lwb->lwb_blk.blk_cksum;
		bp->blk_cksum.zc_word[ZIL_ZC_SEQ]++;
	}
```

Each lwb, when issued, allocates the block for the *next* lwb and stores its pointer in its own trailer (`zilc->zc_next_blk`, zil.c L2039), so log blocks form a singly linked chain starting at `zh_log` in the header. L2073-L2074: the allocation goes through `zio_alloc_zil`, which reports in `slog` whether a log device was used. L2087: the new block's birth is an open txg. L2088-L2091: the next block inherits this block's checksum seed with the sequence word incremented; replay uses this sequence number to tell a valid next block from stale data.

### 3. `zio_alloc_zil` — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4561-L4595

```c
	/* Try log class (dedicated slog devices) first */
	error = metaslab_alloc_range(spa, spa_log_class(spa), min_size,
	    max_size, new_bp, 1, txg, NULL, flags, &io_alloc_list, allocator,
	    NULL, &alloc_size);
	*slog = (error == 0);

	/* Try special_embedded_log class (reserved on special vdevs) */
	if (error != 0) {
		error = metaslab_alloc_range(spa,
		    spa_special_embedded_log_class(spa), min_size, max_size,
		    new_bp, 1, txg, NULL, flags, &io_alloc_list, allocator,
		    NULL, &alloc_size);
	}

	/* Try special class (general special vdev allocation) */
	if (error != 0) {
		error = metaslab_alloc_range(spa, spa_special_class(spa),
		    min_size, max_size, new_bp, 1, txg, NULL, flags,
		    &io_alloc_list, allocator, NULL, &alloc_size);
	}

	/* Try embedded_log class (reserved on normal vdevs) */
	if (error != 0) {
		error = metaslab_alloc_range(spa, spa_embedded_log_class(spa),
		    min_size, max_size, new_bp, 1, txg, NULL, flags,
		    &io_alloc_list, allocator, NULL, &alloc_size);
	}

	/* Finally fall back to normal class */
	if (error != 0) {
		ZIOSTAT_BUMP(ziostat_alloc_class_fallbacks);
		error = metaslab_alloc_range(spa, spa_normal_class(spa),
		    min_size, max_size, new_bp, 1, txg, NULL, flags,
		    &io_alloc_list, allocator, NULL, &alloc_size);
	}
```

This is where the SLOG enters. L4562-L4565: first choice is `spa_log_class` (dedicated log devices); success sets `*slog`, which becomes `LWB_FLAG_SLOG` on the lwb (zil.c L2118-L2119). L4568-L4587: next come log space reserved on special vdevs, the special class, and the "embedded log" metaslab reserved on normal vdevs. L4590-L4594: finally the normal class. All of these go through the same metaslab allocator as ordinary data (`metaslab_alloc_range`).

### 4. `zfs_log_write` — module/zfs/zfs_log.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_log.c#L627-L649

```c
	write_state = zil_write_state(zilog, resid, blocksize, o_direct,
	    commit);

	(void) sa_lookup(zp->z_sa_hdl, SA_ZPL_GEN(ZTOZSB(zp)), &gen,
	    sizeof (gen));

	while (resid) {
		itx_t *itx;
		lr_write_t *lr;
		itx_wr_state_t wr_state = write_state;
		ssize_t len = resid;

		/*
		 * A WR_COPIED record must fit entirely in one log block.
		 * Large writes can use WR_NEED_COPY, which the ZIL will
		 * split into multiple records across several log blocks
		 * if necessary.
		 */
		if (wr_state == WR_COPIED &&
		    resid > zil_max_copied_data(zilog))
			wr_state = WR_NEED_COPY;
		else if (wr_state == WR_INDIRECT)
			len = MIN(blocksize - P2PHASE(off, blocksize), resid);
```

L627-L628: the write state is chosen once per `write()` call, from its size (`resid`) and the file's block size `z_blksz`. `commit` comes from `zfs_write`: true when the file was opened with `O_SYNC` or `O_DSYNC`, or the dataset has `sync=always` ([`module/zfs/zfs_vnops.c#L756-L757`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L756-L757)); in that case `zfs_write` calls `zil_commit` itself before returning ([`module/zfs/zfs_vnops.c#L1091-L1092`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1091-L1092)). A plain `write()` followed by `fsync()` passes `commit` false; `fsync` then calls `zil_commit` ([`module/zfs/zfs_vnops.c#L117-L120`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L117-L120)). `o_direct` is true when the write took the Direct I/O path (`UIO_DIRECT`, [`module/zfs/zfs_vnops.c#L1042-L1043`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1042-L1043)); `O_DIRECT` alone is not enough: a write shorter than the file's block goes through the ARC ([`module/zfs/zfs_vnops.c#L296-L299`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L296-L299)). `blocksize` is the file's `z_blksz`: `recordsize` once the file spans more than one record, but for a file of a single block it grows with the file, up to `recordsize` ([`module/zfs/zfs_vnops.c#L808-L821`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L808-L821)). L645-L647: a WR_COPIED record must fit in one log block, so data larger than `zil_max_copied_data` (7680 bytes) is downgraded to WR_NEED_COPY. L648-L649: a WR_INDIRECT record covers at most one file block. Every `write()` makes an itx, synchronous or not; it is queued with `zil_itx_assign` (zfs_log.c L693) under the write's txg, with `lrc_txg` set to it ([`module/zfs/zil.c#L2776`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2776)).

### 5. `zil_write_state` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2212-L2246

```c
itx_wr_state_t
zil_write_state(zilog_t *zilog, uint64_t size, uint32_t blocksize,
    boolean_t o_direct, boolean_t commit)
{
	if (zilog->zl_logbias == ZFS_LOGBIAS_THROUGHPUT || o_direct)
		return (WR_INDIRECT);

	/*
	 * Don't use indirect for too small writes to reduce overhead.
	 * Don't use indirect if written less than a half of a block if
	 * we are going to commit it immediately, since next write might
	 * rewrite the same block again, causing inflation.  If commit
	 * is not planned, then next writes might coalesce, and so the
	 * indirect may be perfect.
	 */
	boolean_t indirect = (size >= zfs_immediate_write_sz &&
	    (size >= blocksize / 2 || !commit));

	if (spa_has_slogs(zilog->zl_spa)) {
		/* Dedicated slogs: never use indirect */
		indirect = B_FALSE;
	} else if (spa_has_special(zilog->zl_spa)) {
		/* Special vdevs: only when beneficial */
		boolean_t on_special = (blocksize <=
		    zilog->zl_os->os_zpl_special_smallblock);
		indirect &= (on_special || !zil_special_is_slog);
	}

	if (indirect)
		return (WR_INDIRECT);
	else if (commit)
		return (WR_COPIED);
	else
		return (WR_NEED_COPY);
}
```

L2216-L2217: `logbias=throughput` or a Direct I/O write: always WR_INDIRECT, whatever the pool has. L2227-L2228: otherwise indirect only for writes of at least `zfs_immediate_write_sz` (32 KiB, [`module/zfs/zil.c#L2191`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2191)), and, when the write is committed at once (`O_SYNC`/`O_DSYNC`), only if it covers at least half a block. L2230-L2232: a pool with dedicated log devices never logs indirect: `spa_has_slogs` is true as soon as the log class has a group, full or not ([`module/zfs/spa_misc.c#L2741-L2744`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa_misc.c#L2741-L2744)). L2233-L2238: on a pool with special vdevs and no SLOG, indirect only when the file's blocks go to the special class (or `zil_special_is_slog` is 0, default 1, [`module/zfs/zil.c#L2199`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2199)). L2240-L2245: not indirect: WR_COPIED (data copied into the record now) when committed at once, else WR_NEED_COPY (data read from the file and copied into the log block only when the record is written, `zfs_get_data` with a buffer, [`module/zfs/zfs_vnops.c#L1388-L1397`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1388-L1397)). For WR_INDIRECT the record carries only a block pointer, so that large data is not written twice, once in the log and once in the pool, as the comment in `zfs_get_data` says ([`module/zfs/zfs_vnops.c#L1381-L1386`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1381-L1386)): `zfs_get_data` writes the file's block in place with `dmu_sync` ([`module/zfs/zfs_vnops.c#L1467-L1468`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1467-L1468)), or, after a Direct I/O write, points to the block that write already put on disk ([`module/zfs/zfs_vnops.c#L1450-L1458`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zfs_vnops.c#L1455-L1458)).

### 6. `lwb_state_t` — include/sys/zil_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil_impl.h#L83-L92

```c
typedef enum {
    LWB_STATE_NEW,
    LWB_STATE_OPENED,
    LWB_STATE_CLOSED,
    LWB_STATE_READY,
    LWB_STATE_ISSUED,
    LWB_STATE_WRITE_DONE,
    LWB_STATE_FLUSH_DONE,
    LWB_NUM_STATES
} lwb_state_t;
```

The comment above it ([`include/sys/zil_impl.h#L39-L82`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil_impl.h#L39-L82)) gives the transitions: opened by `zil_lwb_write_open` on the first itx ([`module/zfs/zil.c#L1758`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1758)), closed by `zil_lwb_write_close` when full or at the end of a commit ([`module/zfs/zil.c#L1880`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1880)), which also allocates the next, still empty, lwb (L1931); ready when `zil_lwb_write_issue` has filled it ([`module/zfs/zil.c#L1972`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1972)); issued once the next block is allocated ([`module/zfs/zil.c#L2113`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2113)); write done when its write completes ([`module/zfs/zil.c#L1605`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1605)); flush done when the disk caches are flushed ([`module/zfs/zil.c#L1493`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1493)), which wakes the waiters attached to it ([`module/zfs/zil.c#L1508-L1524`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1508-L1524)). With one writer and nothing else in flight (`!zl_parallel`), the lwb holding a commit is closed and issued at once rather than kept open for more records ([`module/zfs/zil.c#L3375-L3379`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L3375-L3379)).

### 7. `zil_lwb_assign` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2334-L2369

```c
	lwb_sp = lwb->lwb_nmax - lwb->lwb_nused;
	max_log_data = zil_max_log_data(zilog, sizeof (lr_write_t));
	if (reclen > lwb_sp || (reclen + dlen > lwb_sp &&
	    lwb_sp < zil_max_waste_space(zilog) &&
	    (dlen % max_log_data == 0 ||
	    lwb_sp < reclen + dlen % max_log_data))) {
		list_insert_tail(ilwbs, lwb);
		lwb = zil_lwb_write_close(zilog, lwb);
		if (lwb == NULL)
			return (NULL);
		zil_lwb_write_open(zilog, lwb);
		lwb_sp = lwb->lwb_nmax - lwb->lwb_nused;
	}

	/*
	 * There must be enough space in the log block to hold reclen.
	 * For WR_COPIED, we need to fit the whole record in one block,
	 * and reclen is the write record header size + the data size.
	 * For WR_NEED_COPY, we can create multiple records, splitting
	 * the data into multiple blocks, so we only need to fit one
	 * word of data per block; in this case reclen is just the header
	 * size (no data).
	 */
	ASSERT3U(reclen + MIN(dlen, sizeof (uint64_t)), <=, lwb_sp);

	dnow = MIN(dlen, lwb_sp - reclen);
	if (dlen > dnow) {
		ASSERT3U(lr->lrc_txtype, ==, TX_WRITE);
		ASSERT3U(itx->itx_wr_state, ==, WR_NEED_COPY);
		citx = zil_itx_clone(itx);
		clr = &citx->itx_lr;
		lr_write_t *clrw = (lr_write_t *)clr;
		clrw->lr_length = dnow;
		lrw->lr_offset += dnow;
		lrw->lr_length -= dnow;
		zilog->zl_cur_left -= dnow;
```

How records are packed. L2334-L2346: a record that does not fit in the space left (`lwb_sp`) closes the lwb and opens the next one; the long condition only lets a WR_NEED_COPY record start in a nearly full block when that saves a split. L2359-L2369: a WR_NEED_COPY record larger than the space left is split: a clone takes what fits, the rest goes to the next block. A WR_COPIED record is never split (L2348-L2357). Each record then gets the next log sequence number, `lrc_seq` ([`module/zfs/zil.c#L2382`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2381)), and the lwb remembers the highest txg of its records, `lwb_max_txg` ([`module/zfs/zil.c#L2387`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2387)). Sizes: a write record header `lr_write_t` is 192 bytes ([`include/sys/zil.h#L353-L362`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L353-L360), with `lr_t` [L217-L222](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L217-L222)); the block trailer `zil_chain_t` is 184 bytes (L92-L97); the largest log block is 128 KiB (`zil_maxblocksize`, [`module/zfs/zil.c#L1783`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1783)), so a block holds 130,888 bytes of records, at most 130,696 bytes of data per write record (`zil_max_log_data`, [`module/zfs/zil.c#L2164-L2167`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2164-L2167)).

### 8. `zil_sync` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4206-L4224

```c
	while ((lwb = list_head(&zilog->zl_lwb_list)) != NULL) {
		zh->zh_log = lwb->lwb_blk;
		if (lwb->lwb_state != LWB_STATE_FLUSH_DONE ||
		    lwb->lwb_alloc_txg > txg || lwb->lwb_max_txg > txg)
			break;
		list_remove(&zilog->zl_lwb_list, lwb);
		if (!BP_IS_HOLE(&lwb->lwb_blk))
			zio_free(spa, txg, &lwb->lwb_blk);
		zil_free_lwb(zilog, lwb);

		/*
		 * If we don't have anything left in the lwb list then
		 * we've had an allocation failure and we need to zero
		 * out the zil_header blkptr so that we don't end
		 * up freeing the same block twice.
		 */
		if (list_is_empty(&zilog->zl_lwb_list))
			BP_ZERO(&zh->zh_log);
	}
```

Called in syncing context for each dataset whose log changed. L4206-L4210: from the head of the lwb list, a log block is freed once it is flushed and every record in it belongs to a txg that is now synced (`lwb_max_txg`), and its own block was allocated no later (`lwb_alloc_txg`); the header's `zh_log` moves to the first block that stays. The records' data is now in the synced txg, so the log is no longer needed for it. Separately, `zil_clean` drops the in-memory itxs of the synced txg that were never written to the log ([`module/zfs/zil.c#L2862`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2862)).

### 9. `zil_claim` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1232-L1253

```c
	 * Claim all log blocks if we haven't already done so, and remember
	 * the highest claimed sequence number.  This ensures that if we can
	 * read only part of the log now (e.g. due to a missing device),
	 * but we can read the entire log later, we will not try to replay
	 * or destroy beyond the last block we successfully claimed.
	 */
	ASSERT3U(zh->zh_claim_txg, <=, first_txg);
	if (zh->zh_claim_txg == 0) {
		(void) zil_parse(zilog, zil_claim_log_block,
		    zil_claim_log_record, tx, first_txg, B_FALSE);
		zh->zh_claim_txg = first_txg;
		zh->zh_claim_blk_seq = zilog->zl_parse_blk_seq;
		zh->zh_claim_lr_seq = zilog->zl_parse_lr_seq;
		if (zilog->zl_parse_lr_count || zilog->zl_parse_blk_count > 1)
			zh->zh_flags |= ZIL_REPLAY_NEEDED;
		zh->zh_flags |= ZIL_CLAIM_LR_SEQ_VALID;
		if (os->os_encrypted)
			os->os_next_write_raw[tx->tx_txg & TXG_MASK] = B_TRUE;
		dsl_dataset_dirty(dmu_objset_ds(os), tx);
	}

	ASSERT3U(first_txg, ==, (spa_last_synced_txg(zilog->zl_spa) + 1));
```

At import, in the pool's first txg ([`module/zfs/spa.c#L5697-L5699`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L5697-L5699)), every dataset's chain is walked from `zh_log` (`zil_parse`, [`module/zfs/zil.c#L499-L572`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L499-L572)) and its blocks are claimed, so the allocator does not hand them out again; so are the blocks WR_INDIRECT records point to (`zil_claim_write`, [`module/zfs/zil.c#L634-L655`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L634-L655)). The walk counts each block pointer it follows, including the last one, allocated but never written, where reading fails and the chain ends. L1239-L1244: the claim txg is that first txg, which is the last synced txg plus one (L1253). L1245-L1246: `ZIL_REPLAY_NEEDED` is set if a record was found or more than one block followed.

### 10. `zil_replay_log_record` — module/zfs/zil.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4696-L4712

```c
static int
zil_replay_log_record(zilog_t *zilog, const lr_t *lr, void *zra,
    uint64_t claim_txg)
{
	zil_replay_arg_t *zr = zra;
	const zil_header_t *zh = zilog->zl_header;
	uint64_t reclen = lr->lrc_reclen;
	uint64_t txtype = lr->lrc_txtype;
	int error = 0;

	zilog->zl_replaying_seq = lr->lrc_seq;

	if (lr->lrc_seq <= zh->zh_replay_seq)	/* already replayed */
		return (0);

	if (lr->lrc_txg < claim_txg)		/* already committed */
		return (0);
```

Replay runs at mount ([`module/os/linux/zfs/zfs_vfsops.c#L795-L801`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zfs_vfsops.c#L795-L801)); without `ZIL_REPLAY_NEEDED`, `zil_replay` only destroys the log ([`module/zfs/zil.c#L4801-L4803`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4801-L4803)). Otherwise each record of the chain, in order, reaches this function. L4708-L4709: a record already replayed before (`zh_replay_seq`, an earlier interrupted replay) is skipped. L4711-L4712: a record whose txg is older than the claim txg is skipped: that txg synced, its change is already in the tree. Every other record is applied again through the ZPL (`zfs_replay_write` for a write); then `zil_destroy` empties the log ([`module/zfs/zil.c#L4822-L4823`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4822-L4823)). Without a replay, `zil_destroy` is called with `keep_first`: the header is emptied, then names the chain's first block again under a new chain GUID ([`module/zfs/zil.c#L4181-L4192`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L4181-L4192)), and the next `zil_create` uses that block instead of allocating one ([`module/zfs/zil.c#L1004-L1011`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1004-L1011), L1032).

**What the animation shows.** (Simplifications and why they stay faithful: `DECISIONS.md` D8.2.)
- An application writes to a file that already spans several records, so its blocks are 128 KiB (`z_blksz` = `recordsize`, zfs_vnops.c L808-L821). Each `write()` makes a record card (itx) queued in memory under the open txg, whatever the flags — `zfs_log_write` excerpt 4, `zil_itx_assign` zil.c L2714, `lrc_txg` L2776.
- The card's state is `zil_write_state` (excerpt 5) followed by the downgrade of excerpt 4 (L645-L647), for the toggles "log device" (none, SLOG, SLOG full), `logbias` (latency, throughput), the file opened with `O_DSYNC` (`commit`) or not, `O_DIRECT` (the Direct I/O path only for the 128 KiB write, zfs_vnops.c L296-L299), and the size (4, 16, 48 or 128 KiB). A panel shows the decision and the line that makes it before the write. The pool has no special vdev, so L2233-L2238 is never taken; the model implements it and the unit tests cover it.
- `fsync()`, or the `write()` itself with `O_DSYNC`, runs a commit: the pending cards of the file go into lwbs in order, split or not as `zil_lwb_assign` decides (excerpt 7), the commit waiter is attached to the last one, and each lwb walks through `lwb_state_t` (excerpt 6): new, opened, closed, ready, issued, write done, flush done. The records are filled in just before "ready" (`zil_lwb_commit` for each itx, then `LWB_STATE_READY`, [`module/zfs/zil.c#L1950-L1972`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1950-L1972)): WR_NEED_COPY data is copied into the block, and for WR_INDIRECT the file's block is drawn written in place in the pool's data area.
- At "issued", the next block is allocated by `zio_alloc_zil` (excerpt 3), each class tried in order and shown as skipped (absent or full) or taken; the chain arrow (`zc_next_blk`, excerpt 2) is drawn to it. The first block of a chain comes from `zil_create`, through the same function, at `ZIL_MIN_BLKSZ`, 4 KiB ([`module/zfs/zil.c#L1022-L1023`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1022-L1023)).
- The first commit on a dataset without a log (`zh_log` a hole, as on the figure's fresh pool and after every replay): the commit calls `zil_create` before it walks the commit list ([`module/zfs/zil.c#L3157-L3164`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L3157-L3164)). `zil_create` allocates the first block in a tx of the open txg, commits the tx and waits for that txg to sync, because only `zil_sync` can put the block into `zh_log` ([`module/zfs/zil.c#L1011-L1026`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1011-L1026), [`module/zfs/zil.c#L1034-L1056`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1034-L1056)). The itxs on the commit list then belong to a synced txg (`synced`, [`module/zfs/zil.c#L3209`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L3209)), so they are destroyed instead of logged ([`module/zfs/zil.c#L3280-L3283`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L3280-L3283)); only the TX_COMMIT itx is assigned, and `zil_lwb_assign` opens the lwb for it ([`module/zfs/zil.c#L2301`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2301)) and links the waiter ([`module/zfs/zil.c#L2318-L2322`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2318-L2322)). The figure draws the wait as "create waits for txg n", the sync of that txg, then the dropped itxs; `fsync()` then returns on a log block that holds no record. Avoiding this wait is why `zil_destroy(keep_first)` keeps the first block of a log with nothing to replay ([`module/zfs/zil.c#L1074-L1078`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1074-L1078)).
- At "flush done" the waiting `fsync()` returns — L1508-L1524 of zil.c.
- "Sync txg": the open txg syncs. Every write of that txg is now in the tree; pending cards of that txg are dropped (`zil_clean`); log blocks whose records all belong to synced txgs are freed and drawn greyed, and `zh_log` moves to the first block that stays (excerpt 8).
- "Crash" (the visitor chooses when): memory is lost: pending cards, the open lwb. On disk stay the header and the written blocks. "Import": `zil_claim` walks the chain from `zh_log`, counts blocks and records, sets the claim txg and `ZIL_REPLAY_NEEDED` (excerpt 9). "Mount": `zil_replay` applies again each record whose txg is not older than the claim txg, or destroys a log with nothing to replay, keeping its first block for the next commit (excerpt 10). The file's writes are then drawn as: in the tree by a synced txg, replayed from the log, or lost (never synced, never logged: written without `fsync`).
- Simplified (D8.2): the first block of a new chain is `ZIL_MIN_BLKSZ`, 4 KiB, as in the code (L1022-L1023); every later log block is 128 KiB (the code sizes each block from the burst, `zil_lwb_plan` L1789), so the byte counts are those of 128 KiB blocks; one file, one writer, so a commit closes and issues its last lwb at once (L3375-L3379) and the commit timeout (`zfs_commit_timeout_pct`) never fires; each `write()` starts at the beginning of a file block, so a WR_INDIRECT write is one record; one txg in flight, synced in one pass; no I/O error, so no `txg_wait_synced` fallback; the flush is one step for the whole lwb (no per-vdev flush tree); `zil_slog_bulk` priority, Slim ZIL layout and encryption are not drawn (they change neither the state, nor the class, nor what is replayed).

**Facts for the text**

- The on-disk ZIL header lives in the objset (`os_zil_header`) and holds the claim txg, replay seq, `zh_log` (head of the chain), claim block/record seqs, flags — [`include/sys/zil.h#L63-L71`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L63-L71).
- Log blocks are at least `ZIL_MIN_BLKSZ` = 4096 bytes, and each block's trailer `zil_chain_t` holds `zc_next_blk` — [`include/sys/zil.h#L92-L99`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zil.h#L92-L99).
- Writes of at least `zfs_immediate_write_sz` = 32768 bytes may be logged as WR_INDIRECT (pointer to a block written in place), but not when the pool has dedicated slogs, unless the dataset has `logbias=throughput` or the write is O_DIRECT, which are always indirect — [`module/zfs/zil.c#L2216-L2217`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2216-L2217), [`module/zfs/zil.c#L2191`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2191), [`module/zfs/zil.c#L2227-L2232`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2227-L2232).
- A WR_COPIED record carries at most `zil_maxcopied` = 7680 bytes of data inline — [`module/zfs/zil.c#L2186`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L2186).
- Above `zil_slog_bulk` = 64 MiB per commit, SLOG writes are issued at async instead of sync priority — [`module/zfs/zil.c#L145`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L145), [`module/zfs/zil.c#L1988-L1992`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1988-L1992).
- Log blocks are claimed at import in the pool's first txg, setting `ZIL_REPLAY_NEEDED` when records are found; replay itself happens when the dataset is mounted — [`module/zfs/spa.c#L5697-L5699`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/spa.c#L5697-L5699), [`module/zfs/zil.c#L1245-L1246`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1245-L1246), [`module/os/linux/zfs/zfs_vfsops.c#L800-L801`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zfs_vfsops.c#L800-L801).
- `zil_write_state` for a file with 128 KiB blocks, no special vdev (the unit tests check every combination): `logbias=throughput`, or `O_DIRECT` on the 128 KiB write (shorter ones are not Direct I/O) → WR_INDIRECT. Otherwise, with `write()` then `fsync()` (`commit` false): under 32 KiB → WR_NEED_COPY; 32 KiB or more → WR_INDIRECT without a SLOG, WR_NEED_COPY with one. With `O_DSYNC` (`commit` true): up to 7680 bytes → WR_COPIED; larger but under 32 KiB, or under half a block (64 KiB) → WR_NEED_COPY (downgraded from WR_COPIED); 64 KiB or more → WR_INDIRECT without a SLOG, WR_NEED_COPY with one. A full SLOG still counts as a SLOG for the write state; only the allocation falls back. With `logbias=throughput` the data is written in place, but the log block that holds the record still comes from the log class first ([`module/zfs/zio.c#L4561-L4565`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4561-L4565)): `logbias` does not steer `zio_alloc_zil`.
- `zio_alloc_zil` class order: log (SLOG), special embedded log, special, embedded log (space reserved on normal vdevs), normal — excerpt 3. `*slog` is set only when the log class succeeded.

**Hand-checked cases** (the unit tests replay them; a file with 128 KiB blocks, txg 100 open, last synced txg 99, `zh_log` a hole: the dataset has never logged).

- *First commit, no SLOG* (`logbias=latency`, `write()` 4 KiB then `fsync()`): the itx is WR_NEED_COPY (4096 < 32768, `commit` false), `lrc_txg` 100. The commit finds no lwb: `zil_create` allocates block 1, 4096 bytes (`ZIL_MIN_BLKSZ`); log class empty, special embedded log and special absent, embedded log taken, `slog` false. It waits for txg 100 to sync: the write is in the tree; `zil_sync` finds lwb 1 new, so it stays, and `zh_log` = block 1. Txg 101 is open. The itx's txg 100 ≤ 100 is synced: destroyed, not logged. The commit itx opens lwb 1 and its waiter joins it; lwb 1 closed, lwb 2 created empty; lwb 1 ready, block 2 allocated (embedded log, txg 101), issued, write done, flush done: `fsync()` returns. No record has been written: `lrc_seq` is still 0.
- *Second commit*: `write()` 4 KiB then `fsync()`, under txg 101. lwb 2 is new and has its block: no `zil_create`. Record `lrc_seq` 1, `lrc_txg` 101, 192 + 4096 bytes in lwb 2; lwb 3 created; issuing lwb 2 allocates block 3. `fsync()` returns at lwb 2's flush done, the data in the log, txg 101 not synced.
- *Then crash before txg 101 syncs*: claim txg 101. The walk follows block 1 (no record), block 2 (1 record) and block 3 (never written, the end): 3 blocks, 1 record, `ZIL_REPLAY_NEEDED`. Mount: record 1, txg 101 ≥ 101, replayed; the second write is back, the first was synced. The log is destroyed, `zh_log` is a hole again: the next commit waits for a txg again.
- *Or crash right after the first commit*: claim txg 101; blocks 1 and 2, no record; more than one block, so `ZIL_REPLAY_NEEDED` is set ([`module/zfs/zil.c#L1245-L1246`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zil.c#L1245-L1246)). Mount: nothing to replay, the log is destroyed.
- *Or sync, then crash* (after the second commit): sync of txg 101: the write is in the tree; lwb 1 flushed, `lwb_alloc_txg` 100, `lwb_max_txg` 0: freed; lwb 2 flushed, allocated in 101, records of 101: freed; lwb 3 is new: `zh_log` = block 3. Crash: claim txg 102; the walk follows block 3 only (never written): 1 block, 0 records, no `ZIL_REPLAY_NEEDED`. Mount: nothing replayed; `zil_destroy` keeps block 3, and `zh_log` names it again. The next commit writes its record into block 3 (lwb 4) with no allocation and no txg wait.
- *Large write, no SLOG* (on the existing chain, 128 KiB, `write()` then `fsync()`): WR_INDIRECT (≥ 32 KiB, `commit` false). One record of 192 bytes; the file's block is written in place before lwb 2 is ready, the record points to it.
- *Large write, SLOG* (the same, the chain created on the SLOG): WR_NEED_COPY (a SLOG forbids indirect). Every block on the log class, `slog` true. The record has 131,072 bytes of data; lwb 2 has 130,888 bytes of room: 192 + 130,696 bytes go to lwb 2 (record `lrc_seq` 1), lwb 2 is full and closed, the remaining 376 bytes go to lwb 3 (`lrc_seq` 2, 192 + 376 bytes). The waiter is on lwb 3, then lwb 3 is closed and an empty lwb 4 created. Issuing lwb 2 allocates block 3 for lwb 3; issuing lwb 3 allocates block 4 for lwb 4. `fsync()` returns at lwb 3's flush done. A crash then claims 4 blocks and 2 records, and both are replayed.
- *SLOG full*: the same write state as with a SLOG (WR_NEED_COPY), but every log block falls back to the embedded log class, `slog` false.
- *`logbias=throughput`, SLOG, 4 KiB with `O_DSYNC`*: WR_INDIRECT; on the existing chain the 4 KiB write is committed by `write()` itself, its block written in place, the log block on the SLOG. As the very first commit, it is dropped like any itx of the synced txg, before any `dmu_sync`.
- *Write without `fsync()`, then crash*: the card stays in memory; nothing is written to the log; after the crash the write is lost, and nothing is replayed. That is allowed: the application did not ask for it to be stable. A `fsync()` after a sync has nothing to log and creates no log.

## Room: send / receive

**Problem.** Replicating a filesystem to another machine by comparing files is slow and blind to what changed. ZFS needs a way to produce exactly the difference between two snapshots without reading the parts that did not change, and to serialize it as a self-checking stream that the receiver can replay into an identical snapshot.

**The idea in the code.**
- `dmu_replay_record_t` in [`include/sys/zfs_ioctl.h#L246`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L246) — a stream is a sequence of fixed-size records, BEGIN ... OBJECT / WRITE / FREE ... END.
- `traverse_visitbp` in [`module/zfs/dmu_traverse.c#L231`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L231) — the traversal skips any block pointer whose birth txg is not after the from-snapshot's txg, and with it the whole subtree below.
- `send_traverse_thread` in [`module/zfs/dmu_send.c#L1204`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1204) — starts that traversal at `fromtxg` with `TRAVERSE_LOGICAL`, feeding `send_cb`.

**Excerpts.**

### 1. `dmu_replay_record_t` — include/sys/zfs_ioctl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L246-L259

```c
typedef struct dmu_replay_record {
	enum {
		DRR_BEGIN, DRR_OBJECT, DRR_FREEOBJECTS,
		DRR_WRITE, DRR_FREE, DRR_END, DRR_WRITE_BYREF,
		DRR_SPILL, DRR_WRITE_EMBEDDED, DRR_OBJECT_RANGE, DRR_REDACT,
		DRR_NUMTYPES
	} drr_type;
	uint32_t drr_payloadlen;
	union {
		struct drr_begin drr_begin;
		struct drr_end {
			zio_cksum_t drr_checksum;
			uint64_t drr_toguid;
		} drr_end;
```

L247-L252: the record types, in on-disk enum order: BEGIN, OBJECT, FREEOBJECTS, WRITE, FREE, END, WRITE_BYREF, SPILL, WRITE_EMBEDDED, OBJECT_RANGE, REDACT. L253: each record can be followed by a payload (`drr_payloadlen`; the data of a WRITE follows its header). L254-L255: the body is a union; BEGIN carries magic, creation time, `drr_toguid` and `drr_fromguid` ([`include/sys/zfs_ioctl.h#L235-L244`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L235-L244)). L256-L259: END carries the stream checksum and the GUID of the snapshot just sent.

### 2. `traverse_visitbp` — module/zfs/dmu_traverse.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L249-L279

```c
	if (BP_GET_LOGICAL_BIRTH(bp) == 0) {
		/*
		 * Since this block has a birth time of 0 it must be one of
		 * two things: a hole created before the
		 * SPA_FEATURE_HOLE_BIRTH feature was enabled, or a hole
		 * which has always been a hole in an object.
		 *
		 * If a file is written sparsely, then the unwritten parts of
		 * the file were "always holes" -- that is, they have been
		 * holes since this object was allocated.  However, we (and
		 * our callers) can not necessarily tell when an object was
		 * allocated.  Therefore, if it's possible that this object
		 * was freed and then its object number reused, we need to
		 * visit all the holes with birth==0.
		 *
		 * If it isn't possible that the object number was reused,
		 * then if SPA_FEATURE_HOLE_BIRTH was enabled before we wrote
		 * all the blocks we will visit as part of this traversal,
		 * then this hole must have always existed, so we can skip
		 * it.  We visit blocks born after (exclusive) td_min_txg.
		 *
		 * Note that the meta-dnode cannot be reallocated.
		 */
		if (!send_holes_without_birth_time &&
		    (!td->td_realloc_possible ||
		    zb->zb_object == DMU_META_DNODE_OBJECT) &&
		    td->td_hole_birth_enabled_txg <= td->td_min_txg)
			return (0);
	} else if (get_birth_time(td, bp) <= td->td_min_txg) {
		return (0);
	}
```

L277-L278: the incremental rule. If the block's birth time is less than or equal to `td_min_txg` (the from-snapshot's txg, set at [`module/zfs/dmu_traverse.c#L653`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L653)), the function returns before reading the block or calling the callback, so an unchanged indirect block prunes its entire subtree. For send, `get_birth_time` returns the logical birth because of `TRAVERSE_LOGICAL` ([`module/zfs/dmu_traverse.c#L78-L84`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L78-L84)). L249-L276: the special case of holes with birth 0 (never written, or written before the `hole_birth` feature). They are skipped only if `send_holes_without_birth_time` is 0 (L272), and it is 1 by default ([`module/zfs/dmu_traverse.c#L44`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L44)): a hole of birth 0 is always visited. A hole that was punched after `hole_birth` was enabled carries the txg of the free as its birth, and goes through the ordinary test of L277.

### 3. `receive_writer_thread` — module/zfs/dmu_recv.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3274-L3294

```c
/*
 * dmu_recv_stream's worker thread; pull records off the queue, and then call
 * receive_process_record  When we're done, signal the main thread and exit.
 */
static __attribute__((noreturn)) void
receive_writer_thread(void *arg)
{
	struct receive_writer_arg *rwa = arg;
	struct receive_record_arg *rrd;
	fstrans_cookie_t cookie = spl_fstrans_mark();

	for (rrd = bqueue_dequeue(&rwa->q); !rrd->eos_marker;
	    rrd = bqueue_dequeue(&rwa->q)) {
		/*
		 * If there's an error, the main thread will stop putting things
		 * on the queue, but we need to clear everything in it before we
		 * can exit.
		 */
		int err = 0;
		if (rwa->err == 0) {
			err = receive_process_record(rwa, rrd);
```

L3285-L3286: the receiver's writer thread dequeues parsed records until the end-of-stream marker. L3293-L3294: each record is dispatched to `receive_process_record`, which switches on `drr_type` (excerpt 11): OBJECT to `receive_object`, WRITE to `receive_process_write_record`, FREE to `receive_free`, and so on. L3287-L3291: the comment explains that after an error the queue must still be emptied before the thread can exit; L3293 applies a record only while `rwa->err` is zero.

### 4. `send_traverse_thread` — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1203-L1221

```c
static __attribute__((noreturn)) void
send_traverse_thread(void *arg)
{
	struct send_thread_arg *st_arg = arg;
	int err = 0;
	struct send_range *data;
	fstrans_cookie_t cookie = spl_fstrans_mark();

	err = traverse_dataset_resume(st_arg->os->os_dsl_dataset,
	    st_arg->fromtxg, &st_arg->resume,
	    st_arg->flags | TRAVERSE_LOGICAL, send_cb, st_arg);

	if (err != EINTR)
		st_arg->error_code = err;
	data = range_alloc(DATA, 0, 0, 0, B_TRUE);
	bqueue_enqueue_flush(&st_arg->q, data, sizeof (*data));
	spl_fstrans_unmark(cookie);
	thread_exit();
}
```

L1211-L1213: the traversal of the snapshot being sent, from `fromtxg` (the from-snapshot's creation txg, `dspp->ancestor_zb.zbm_creation_txg`, [`module/zfs/dmu_send.c#L2370`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2370); 0 for a full stream), with `TRAVERSE_LOGICAL` added to the flags set at [`module/zfs/dmu_send.c#L2088`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2088): `TRAVERSE_PRE | TRAVERSE_PREFETCH_METADATA`, so the callback runs on a block before its children. L1217-L1218: when the traversal is done, an end-of-stream marker goes on the queue. The ranges `send_cb` queues go through a merge thread and a reader thread (which reads the data of WRITEs) to the main thread, which turns each one into records with `do_dump` ([`module/zfs/dmu_send.c#L2568-L2574`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2568-L2574)); the queues keep the traversal's order.

### 5. `traverse_dnode` — module/zfs/dmu_traverse.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L534-L550

```c
	if (td->td_flags & TRAVERSE_PRE) {
		SET_BOOKMARK(&czb, objset, object, ZB_DNODE_LEVEL,
		    ZB_DNODE_BLKID);
		err = td->td_func(td->td_spa, NULL, bp, &czb, dnp,
		    td->td_arg);
		if (err == TRAVERSE_VISIT_NO_CHILDREN)
			return (0);
		if (err != 0)
			return (err);
	}

	for (j = 0; j < dnp->dn_nblkptr; j++) {
		SET_BOOKMARK(&czb, objset, object, dnp->dn_nlevels - 1, j);
		err = traverse_visitbp(td, dnp, &dnp->dn_blkptr[j], &czb);
		if (err != 0)
			break;
	}
```

Called for every dnode slot of a dnode block that was visited ([`module/zfs/dmu_traverse.c#L402-L404`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L402-L404)), and for the meta-dnode held in the objset block (L443-L444). L534-L543: with `TRAVERSE_PRE`, the callback runs for the dnode itself, at `ZB_DNODE_LEVEL`; there is no birth test here, so every dnode of a dnode block that changed reaches `send_cb`, changed or not. L545-L550: then each of the dnode's block pointers goes through `traverse_visitbp` and its birth test.

### 6. `send_cb`, dnodes and metadata — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1098-L1120

```c
	if (zb->zb_level == ZB_DNODE_LEVEL) {
		if (zb->zb_object == DMU_META_DNODE_OBJECT)
			return (0);
		record = range_alloc(OBJECT, zb->zb_object, 0, 0, B_FALSE);
		record->sru.object.bp = *bp;
		size_t size  = sizeof (*dnp) * (dnp->dn_extra_slots + 1);
		record->sru.object.dnp = kmem_alloc(size, KM_SLEEP);
		memcpy(record->sru.object.dnp, dnp, size);
		bqueue_enqueue(&sta->q, record, sizeof (*record));
		return (0);
	}
	if (zb->zb_level == 0 && zb->zb_object == DMU_META_DNODE_OBJECT &&
	    !BP_IS_HOLE(bp)) {
		record = range_alloc(OBJECT_RANGE, 0, zb->zb_blkid,
		    zb->zb_blkid + 1, B_FALSE);
		record->sru.object_range.bp = *bp;
		bqueue_enqueue(&sta->q, record, sizeof (*record));
		return (0);
	}
	if (zb->zb_level < 0 || (zb->zb_level > 0 && !BP_IS_HOLE(bp)))
		return (0);
	if (zb->zb_object == DMU_META_DNODE_OBJECT && !BP_IS_HOLE(bp))
		return (0);
```

L1098-L1108: a dnode becomes an OBJECT range (except the meta-dnode, object 0). L1109-L1116: a dnode block (level 0 of the meta-dnode) becomes an OBJECT_RANGE, which `do_dump` writes only for a raw stream ([`module/zfs/dmu_send.c#L894-L898`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L894-L898)). L1117-L1120: the objset block (level `ZB_ROOT_LEVEL`, -1, [`include/sys/zio.h#L346`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio.h#L346)) and every indirect block that is not a hole make no record: they are read only to reach what is below them.

### 7. `send_cb`, data and holes — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1130-L1146

```c
	if (!overflow_multiply(span, zb->zb_blkid, &start) || (!(zb->zb_blkid ==
	    DMU_SPILL_BLKID || DMU_OT_IS_METADATA(dnp->dn_type)) &&
	    span * zb->zb_blkid > dnp->dn_maxblkid)) {
		ASSERT(BP_IS_HOLE(bp));
		return (0);
	}

	if (zb->zb_blkid == DMU_SPILL_BLKID)
		ASSERT3U(BP_GET_TYPE(bp), ==, DMU_OT_SA);

	enum type record_type = DATA;
	if (BP_IS_HOLE(bp))
		record_type = HOLE;
	else if (BP_IS_REDACTED(bp))
		record_type = REDACT;
	else
		record_type = DATA;
```

L1130-L1135: a block past the end of the object (`dn_maxblkid`) makes no record. L1140-L1146: what is left is a level-0 block, or a hole at any level: DATA (a WRITE record), HOLE (a FREE record), or REDACT. A hole in the meta-dnode becomes FREEOBJECTS ([`module/zfs/dmu_send.c#L1012-L1017`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1012-L1017)); a hole in a file becomes FREE of its range ([`module/zfs/dmu_send.c#L1018-L1034`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L1018-L1034)).

### 8. `dump_dnode` — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L732-L742

```c
	if (dnp == NULL || dnp->dn_type == DMU_OT_NONE)
		return (dump_freeobjects(dscp, object, 1));

	if (dscp->dsc_pending_op != PENDING_NONE) {
		if (dump_record(dscp, NULL, 0) != 0)
			return (SET_ERROR(EINTR));
		dscp->dsc_pending_op = PENDING_NONE;
	}

	/* write an OBJECT record */
	memset(dscp->dsc_drr, 0, sizeof (dmu_replay_record_t));
```

L732-L733: a dnode slot that holds no object (`DMU_OT_NONE`, a deleted or never used object) becomes FREEOBJECTS for that one object. L735-L739: a pending FREE or FREEOBJECTS (excerpt 9) is written out first. L741-L742: then the OBJECT record, sent with the dnode's bonus buffer as payload ([`module/zfs/dmu_send.c#L793`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L793)), and right after it a FREE from the end of the object to `DMU_OBJECT_END` ([`module/zfs/dmu_send.c#L796-L799`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L796-L799)), so that a receiver whose copy of the file was longer cuts it.

### 9. `dump_free` — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L367-L403

```c
	if (dscp->dsc_pending_op == PENDING_FREE) {
		/*
		 * Check to see whether this free block can be aggregated
		 * with pending one.
		 */
		if (drrf->drr_object == object && drrf->drr_offset +
		    drrf->drr_length == offset) {
			if (offset + length < offset || length == UINT64_MAX)
				drrf->drr_length = UINT64_MAX;
			else
				drrf->drr_length += length;
			return (0);
		} else {
			/* not a continuation.  Push out pending record */
			if (dump_record(dscp, NULL, 0) != 0)
				return (SET_ERROR(EINTR));
			dscp->dsc_pending_op = PENDING_NONE;
		}
	}
	/* create a FREE record and make it pending */
	memset(dscp->dsc_drr, 0, sizeof (dmu_replay_record_t));
	dscp->dsc_drr->drr_type = DRR_FREE;
	drrf->drr_object = object;
	drrf->drr_offset = offset;
	if (offset + length < offset)
		drrf->drr_length = DMU_OBJECT_END;
	else
		drrf->drr_length = length;
	drrf->drr_toguid = dscp->dsc_toguid;
	if (length == DMU_OBJECT_END) {
		if (dump_record(dscp, NULL, 0) != 0)
			return (SET_ERROR(EINTR));
	} else {
		dscp->dsc_pending_op = PENDING_FREE;
	}

	return (0);
```

L367-L385: a FREE that continues the pending one (same object, the next offset) is merged into it; otherwise the pending one is written. L386-L401: the new FREE becomes the pending one, except a FREE to `DMU_OBJECT_END`, written at once (L396-L398). Any other record writes the pending one first: `dump_free` itself for FREEOBJECTS (L360-L365), `dmu_dump_write` for WRITE ([`module/zfs/dmu_send.c#L482-L486`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L482-L486)), `dump_dnode` for OBJECT (excerpt 8), and the end of the stream ([`module/zfs/dmu_send.c#L2604-L2606`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2604-L2606)). `dump_freeobjects` merges consecutive objects the same way ([`module/zfs/dmu_send.c#L683-L698`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L683-L698)), and drops objects past the last dnode block, which cannot exist on the receiver ([`module/zfs/dmu_send.c#L653-L666`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L653-L666)).

### 10. `dump_record` — module/zfs/dmu_send.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L257-L283

```c
/*
 * For all record types except BEGIN, fill in the checksum (overlaid in
 * drr_u.drr_checksum.drr_checksum).  The checksum verifies everything
 * up to the start of the checksum itself.
 */
static int
dump_record(dmu_send_cookie_t *dscp, void *payload, int payload_len)
{
	dmu_send_outparams_t *dso = dscp->dsc_dso;
	ASSERT3U(offsetof(dmu_replay_record_t, drr_u.drr_checksum.drr_checksum),
	    ==, sizeof (dmu_replay_record_t) - sizeof (zio_cksum_t));
	(void) fletcher_4_incremental_native(dscp->dsc_drr,
	    offsetof(dmu_replay_record_t, drr_u.drr_checksum.drr_checksum),
	    &dscp->dsc_zc);
	if (dscp->dsc_drr->drr_type == DRR_BEGIN) {
		dscp->dsc_sent_begin = B_TRUE;
	} else {
		ASSERT(ZIO_CHECKSUM_IS_ZERO(&dscp->dsc_drr->drr_u.
		    drr_checksum.drr_checksum));
		dscp->dsc_drr->drr_u.drr_checksum.drr_checksum = dscp->dsc_zc;
	}
	if (dscp->dsc_drr->drr_type == DRR_END) {
		dscp->dsc_sent_end = B_TRUE;
	}
	(void) fletcher_4_incremental_native(&dscp->dsc_drr->
	    drr_u.drr_checksum.drr_checksum,
	    sizeof (zio_cksum_t), &dscp->dsc_zc);
```

L268-L270: the running fletcher-4 checksum `dsc_zc` is carried on over the record, up to its last 32 bytes. L271-L277: except for BEGIN, that value is written into those 32 bytes, `drr_checksum` (overlaid on every record type, [`include/sys/zfs_ioctl.h#L374-L387`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L374-L387)). L281-L283: then the 32 bytes themselves are summed, and the payload after them ([`module/zfs/dmu_send.c#L295-L298`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L295-L298)). So `drr_checksum` of a record is the fletcher-4 of every byte of the stream before it, its own header up to the checksum included (as the comment at L258-L260 says). The END record also carries, in `drr_end.drr_checksum`, the checksum of everything before END ([`module/zfs/dmu_send.c#L2619-L2626`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2619-L2626)).

### 11. `receive_process_record` — module/zfs/dmu_recv.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3188-L3213

```c
	switch (rrd->header.drr_type) {
	case DRR_OBJECT:
	{
		struct drr_object *drro = &rrd->header.drr_u.drr_object;
		err = receive_object(rwa, drro, rrd->payload);
		vmem_free(rrd->payload, rrd->payload_size);
		rrd->payload = NULL;
		break;
	}
	case DRR_FREEOBJECTS:
	{
		struct drr_freeobjects *drrfo =
		    &rrd->header.drr_u.drr_freeobjects;
		err = receive_freeobjects(rwa, drrfo);
		break;
	}
	case DRR_WRITE:
	{
		err = receive_process_write_record(rwa, rrd);
		if (rwa->heal) {
			/*
			 * If healing - always free the abd after processing
			 */
			abd_free(rrd->abd);
			rrd->abd = NULL;
		} else if (err != EAGAIN) {
```

The dispatch by `drr_type`: OBJECT to `receive_object` (which creates the object, or keeps an existing one of the same shape, [`module/zfs/dmu_recv.c#L1968-L1989`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L1968-L1989)), FREEOBJECTS to `receive_freeobjects` (frees each object of the range that exists, [`module/zfs/dmu_recv.c#L2208-L2215`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L2208-L2215)), WRITE to `receive_process_write_record`. FREE goes to `receive_free`, which frees the range in the object ([`module/zfs/dmu_recv.c#L3235-L3240`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3235-L3240), [`module/zfs/dmu_recv.c#L2666-L2684`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L2666-L2684)).

### 12. `receive_read_payload_and_next_header` — module/zfs/dmu_recv.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L2843-L2868

```c
	/*
	 * Note: checksum is of everything up to but not including the
	 * checksum itself.
	 */
	ASSERT3U(offsetof(dmu_replay_record_t, drr_u.drr_checksum.drr_checksum),
	    ==, sizeof (dmu_replay_record_t) - sizeof (zio_cksum_t));
	receive_cksum(drc,
	    offsetof(dmu_replay_record_t, drr_u.drr_checksum.drr_checksum),
	    &drc->drc_next_rrd->header);

	zio_cksum_t cksum_orig =
	    drc->drc_next_rrd->header.drr_u.drr_checksum.drr_checksum;
	zio_cksum_t *cksump =
	    &drc->drc_next_rrd->header.drr_u.drr_checksum.drr_checksum;

	if (drc->drc_byteswap)
		byteswap_record(&drc->drc_next_rrd->header);

	if ((!ZIO_CHECKSUM_IS_ZERO(cksump)) &&
	    !ZIO_CHECKSUM_EQUAL(drc->drc_cksum, *cksump)) {
		kmem_free(drc->drc_next_rrd, sizeof (*drc->drc_next_rrd));
		drc->drc_next_rrd = NULL;
		return (SET_ERROR(ECKSUM));
	}

	receive_cksum(drc, sizeof (cksum_orig), &cksum_orig);
```

The receiver keeps its own running checksum, which starts over the whole BEGIN record ([`module/zfs/dmu_recv.c#L1304-L1306`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L1304-L1306)) and goes on over each payload ([`module/zfs/dmu_recv.c#L2813`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L2813)). L2843-L2851: it sums the next header up to its checksum. L2861-L2866: if that header's `drr_checksum` is not zero and differs, the receive fails with `ECKSUM`; a checksum of all zeros is not checked. L2868: the stored value is then summed, as the sender did. This runs when the reader thread has read a record's payload and the header after it; only then is the record put on the writer's queue ([`module/zfs/dmu_recv.c#L3500-L3513`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3500-L3513)), so a record whose bytes were damaged is never applied. END is checked again: `drr_end.drr_checksum` must equal the checksum before END ([`module/zfs/dmu_recv.c#L3000-L3007`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3000-L3007)). On an error, what the receive created is destroyed ([`module/zfs/dmu_recv.c#L3582-L3588`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L3582-L3588)): the receiver is left at the from-snapshot.

**What the animation shows.** (Simplifications and why they stay faithful: `DECISIONS.md` D9.2.)
- One filesystem, `tank/fs`, and its history: txg 10 creates files a, b, c (objects 1 to 3, four 512-byte blocks each) and takes `@s1`; txg 20 rewrites block 2 of a, `@s2`; txg 30 punches a hole in blocks 1 and 2 of b and creates file d (object 4), `@s3`; txg 40 deletes c, `@s4`. Copy-on-write gives every rewritten block, and every block above it up to the objset, the txg's birth; a punched hole carries the txg of the free (`hole_birth`).
- `@s4` is sent, as its tree: the objset block, the meta-dnode's indirect block, two dnode blocks of four slots (objects 0 to 3, 4 to 7), and for each file an indirect block over four data blocks. Every block pointer shows its logical birth — `get_birth_time` [`module/zfs/dmu_traverse.c#L78-L84`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L78-L84).
- The visitor picks the from-snapshot: none (a full stream, `fromtxg` 0), `@s1`, `@s2` or `@s3`. The traversal starts at the root of `@s4` with `td_min_txg` = F, the from-snapshot's txg (excerpt 4).
- At each block pointer the test `birth <= td_min_txg` is shown (excerpt 2). When true, the block pointer is dimmed with its whole subtree, never read. When false, the block is visited.
- Each dnode of a visited dnode block reaches `send_cb` (excerpt 5): object 0 makes nothing, a file makes OBJECT (followed by FREE from its end to `DMU_OBJECT_END`), an empty slot makes FREEOBJECTS (excerpts 6, 8). A visited data block makes WRITE with its 512 bytes as payload, a visited hole FREE (excerpt 7). Pending FREE and FREEOBJECTS are merged as `dump_free` and `dump_freeobjects` do (excerpt 9).
- Records go down a pipe as a strip: BEGIN, then the records in the traversal's order, then END. Each record but BEGIN shows its `drr_checksum`, the running fletcher-4 of the stream before it (excerpt 10).
- The receiver holds the from-snapshot's files (nothing for a full stream). It checks each header against its own running checksum (excerpt 12), then pops the record and dispatches it by type (excerpts 3, 11), and its files change accordingly. At END the two checksums are compared, and the received files are compared with `@s4`'s.
- A counter shows the block pointers visited and skipped; a table gives them for every from-snapshot: the count shrinks as F grows.
- "Flip a bit": one bit of the first WRITE's payload (or of the first record after BEGIN, for a stream without WRITE) is flipped on the way; the receiver stops with `ECKSUM` at the next header, and the damaged record is not applied.
- Simplified (D9.2): the real send pipeline has several threads (traversal, redaction list, merge, prefetch, reader) joined by queues; redaction, raw (encrypted) sends, compressed WRITE payloads, WRITE_BYREF, embedded data, spill blocks and resumable streams are not shown. The sizes are small: 512-byte data blocks, four pointers per indirect block, four dnodes per dnode block (32 in a real 16 KiB dnode block), no bonus buffer. Record headers are laid out as `dmu_replay_record_t`, but only the fields the figure uses are filled in.

**Facts for the text**
- The stream magic is `DMU_BACKUP_MAGIC 0x2F5bacbacULL` — [`include/sys/zfs_ioctl.h#L171`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L171).
- Eleven record types are defined, `DRR_BEGIN` through `DRR_REDACT` — [`include/sys/zfs_ioctl.h#L247-L252`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L247-L252).
- Every record header is a `dmu_replay_record_t` of 312 bytes; its last 32 bytes are `drr_checksum` — [`module/zfs/dmu_send.c#L266-L267`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L266-L267), [`include/sys/zfs_ioctl.h#L380-L387`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zfs_ioctl.h#L380-L387).
- Every record except BEGIN carries a running fletcher-4 checksum of the stream so far, overlaid in `drr_checksum` — [`module/zfs/dmu_send.c#L257-L283`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L257-L283).
- The incremental bound is the from-snapshot's creation txg: `fromtxg = dspp->ancestor_zb.zbm_creation_txg` — [`module/zfs/dmu_send.c#L2370`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2370).
- An incremental stream names the from-snapshot by GUID in BEGIN (`drr_fromguid`, [`module/zfs/dmu_send.c#L2049-L2050`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L2049-L2050)); the receiver looks for a snapshot with that GUID in the target and refuses the stream without one (`ENODEV`, [`module/zfs/dmu_recv.c#L463-L479`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_recv.c#L463-L479)).
- Send uses logical, not physical, birth (corrected in slice 9, D9.1). Per the comment, physical birth can be smaller than logical for dedup and block cloning and bigger for remapped and rewritten blocks, and logical birth is the one for incremental replication: a block deduplicated or cloned onto an older copy is still sent, since the user wrote it after the from-snapshot, and a block only rewritten or remapped on disk is not resent — [`module/zfs/dmu_traverse.c#L80-L81`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_traverse.c#L80-L81) and the comment at [`include/sys/spa.h#L483-L488`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L483-L488).
- Free records are sent even in a full stream, so that it can be received as a clone — [`module/zfs/dmu_send.c#L326-L328`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu_send.c#L326-L328).

**Hand-checked cases** (the unit tests replay them). Births in `@s4`: objset, meta-dnode indirect block and dnode block 0: 40; dnode block 1: 30; a's indirect block: 20, its blocks 10, 10, 20, 10; b's indirect block: 30, its blocks 10, hole 30, hole 30, 10; d's indirect block and blocks: 30. c is gone (slot 3 empty), slots 5 to 7 were never used. 19 block pointers in all.

- *Full stream* (F = 0): every test is false, 19 visited, 0 skipped. 21 records: BEGIN; OBJECT 1, FREE 1 from 2048 to the end, WRITE 1 at 0, 512, 1024, 1536; OBJECT 2, FREE 2 from 2048, WRITE 2 at 0, FREE 2 from 512 for 1024 bytes (the two holes, merged), WRITE 2 at 1536; FREEOBJECTS 3 (1 object); OBJECT 4, FREE 4 from 2048, four WRITEs; FREEOBJECTS 5 (3 objects, merged); END. The receiver, empty, ends with a, b (blocks 1 and 2 holes) and d: the files of `@s4`.
- *From `@s1`* (F = 10): a's indirect block (20) is visited, its blocks 0, 1, 3 (10) are skipped, block 2 (20) is sent; b's blocks 0 and 3 are skipped, the holes (30) are sent as one FREE. 14 visited, 5 skipped. 16 records: BEGIN, OBJECT 1, FREE 1 from 2048, WRITE 1 at 1024, OBJECT 2, FREE 2 from 2048, FREE 2 from 512 for 1024, FREEOBJECTS 3, OBJECT 4, FREE 4 from 2048, four WRITEs of d, FREEOBJECTS 5 (3), END. The receiver holds `@s1`: a gets block 2 again, b loses blocks 1 and 2, c is freed, d is created.
- *From `@s2`* (F = 20): a's indirect block (20 ≤ 20) is skipped, its four blocks never read. 12 visited, 3 skipped, 4 below them. 15 records: those of `@s1` without the WRITE of a.
- *From `@s3`* (F = 30): dnode block 1 (30) is skipped with d's subtree; in dnode block 0 (40), a's and b's indirect blocks (20, 30) are skipped. 3 visited (objset, meta-dnode indirect block, dnode block 0), 3 skipped, 13 below them. 7 records: BEGIN, OBJECT 1, FREE 1 from 2048, OBJECT 2, FREE 2 from 2048, FREEOBJECTS 3, END. a and b are sent as OBJECT records, without data, because they share a dnode block with c, whose removal rewrote it.
- *A flipped bit* in the payload of the first WRITE of the full stream (record 3): the receiver fails with `ECKSUM` when it checks record 4's header. BEGIN, OBJECT 1 and FREE 1 were applied; the WRITE never is, and the receive is undone.

## Room: Compression, dedup, encryption

**Problem.** Three features transform a block between the application and the disk. Compression must not waste CPU and metadata on data that barely shrinks. Dedup must recognise that a block already exists on disk and avoid writing it again, at the price of a table that must be consulted on every write. Encryption must protect user data while leaving enough in clear that the pool can still be scrubbed, resilvered and replicated without the key.

**The idea in the code.**
- `zio_get_compression_max_size` in [`module/zfs/zio.c#L1792`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1792) — compression must save at least 12.5%, rounded to the allocation size, or the block is stored uncompressed.
- `zio_ddt_write` in [`module/zfs/zio.c#L3795`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3795) — a dedup hit fills the new block pointer from the DDT entry and bumps a refcount instead of writing.
- `BP_IS_ENCRYPTED` in [`include/sys/spa.h#L456-L459`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L456-L459) — encrypted block pointers keep salt, IV and MAC in place of the third DVA and half the checksum.

**Excerpts.**

### 1. `zio_get_compression_max_size` — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1791-L1809

```c
size_t
zio_get_compression_max_size(enum zio_compress compress, uint64_t gcd_alloc,
    uint64_t min_alloc, size_t s_len)
{
	size_t d_len;

	/* minimum 12.5% must be saved (legacy value, may be changed later) */
	d_len = s_len - (s_len >> 3);

	/* ZLE can't use exactly d_len bytes, it needs more, so ignore it */
	if (compress == ZIO_COMPRESS_ZLE)
		return (d_len);

	d_len = d_len - d_len % gcd_alloc;

	if (d_len < min_alloc)
		return (BPE_PAYLOAD_SIZE);
	return (d_len);
}
```

L1797-L1798: the target size is the source size minus one eighth ("minimum 12.5% must be saved (legacy value, may be changed later)"). L1801-L1802: ZLE is exempt from the rounding. L1804: the target is rounded down to a multiple of the pool's allocation granularity, since a saving smaller than one sector saves nothing on disk. L1806-L1807: if that leaves less than the minimum allocation, the only acceptable result is one small enough to be embedded in the block pointer itself (`BPE_PAYLOAD_SIZE`). The compressor is given this as its output limit; `zio_compress_data` returns the original size if the output exceeds it ([`module/zfs/zio_compress.c#L148-L149`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_compress.c#L148-L149)), and the write path then sets `compress = ZIO_COMPRESS_OFF` ([`module/zfs/zio.c#L1998-L2001`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1998-L2001)).

### 2. `zio_ddt_write` — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3958-L3987

```c
		/*
		 * If there are enough DVAs in the entry to service our request,
		 * then we can just use them as-is.
		 */
		if (have_dvas >= need_dvas) {
			if (dde_io != NULL)
				mutex_exit(&dde_io->dde_io_lock);

			/*
			 * For rewrite operations, try preserving the original
			 * logical birth time.  If the result matches the
			 * original BP, this becomes a NOP.
			 */
			if (zp->zp_rewrite) {
				uint64_t orig_logical_birth =
				    BP_GET_LOGICAL_BIRTH(&zio->io_bp_orig);
				ddt_bp_fill(ddp, v, bp, orig_logical_birth);
				if (BP_EQUAL(bp, &zio->io_bp_orig)) {
					/* We can skip accounting. */
					ddt_exit(ddt);
					zio->io_flags |= ZIO_FLAG_NOPWRITE;
					return (zio);
				}
			}

			ddt_bp_fill(ddp, v, bp, txg);
			ddt_phys_addref(ddp, v);
			ddt_exit(ddt);
			return (zio);
		}
```

L3962: the DDT entry for this checksum already holds as many DVAs as this write needs (`copies=`). L3983: `ddt_bp_fill` copies the entry's DVAs into the new block pointer and sets its birth to (current txg, entry's physical birth) ([`module/zfs/ddt.c#L724-L726`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L724-L726)). L3984: `ddt_phys_addref` increments `ddp_refcnt` ([`module/zfs/ddt.c#L880-L888`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L880-L888)). L3986: the zio returns without issuing any write I/O. L3971-L3981: for a rewrite, the original logical birth is tried first; if the resulting pointer is identical, the operation becomes a no-op.

### 3. `BP_IS_ENCRYPTED` — include/sys/spa.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L238-L263

```c
 * The X bit being set indicates that this block is one of 3 types. If this is
 * a level 0 block with an encrypted object type, the block is encrypted
 * (see BP_IS_ENCRYPTED()). If this is a level 0 block with an unencrypted
 * object type, this block is authenticated with an HMAC (see
 * BP_IS_AUTHENTICATED()). Otherwise (if level > 0), this bp will use the MAC
 * words to store a checksum-of-MACs from the level below (see
 * BP_HAS_INDIRECT_MAC_CKSUM()). For convenience in the code, BP_IS_PROTECTED()
 * refers to both encrypted and authenticated blocks and BP_USES_CRYPT()
 * refers to any of these 3 kinds of blocks.
 *
 * The additional encryption parameters are the salt, IV, and MAC which are
 * explained in greater detail in the block comment at the top of zio_crypt.c.
 * The MAC occupies half of the checksum space since it serves a very similar
 * purpose: to prevent data corruption on disk. The only functional difference
 * is that the checksum is used to detect on-disk corruption whether or not the
 * encryption key is loaded and the MAC provides additional protection against
 * malicious disk tampering. We use the 3rd DVA to store the salt and first
 * 64 bits of the IV. As a result encrypted blocks can only have 2 copies
 * maximum instead of the normal 3. The last 32 bits of the IV are stored in
 * the upper bits of what is usually the fill count. Note that only blocks at
 * level 0 or -2 are ever encrypted, which allows us to guarantee that these
 * 32 bits are not trampled over by other code (see zio_crypt.c for details).
 * The salt and IV are not used for authenticated bps or bps with an indirect
 * MAC checksum, so these blocks can utilize all 3 DVAs and the full 64 bits
 * for the fill count.
 */
```

L238-L246: the X bit has three meanings: an encrypted level-0 block of an encrypted object type, an authenticated (HMAC only) level-0 block of an unencrypted type, or an indirect block whose MAC words hold a checksum of the MACs below. L250-L254: the MAC takes half of `blk_cksum`, so the remaining 128-bit checksum still lets scrub detect corruption without the key. L254-L256: salt and the first 64 bits of the IV occupy the third DVA, so encrypted blocks keep at most 2 copies. L256-L259: the last 32 bits of the IV sit in the upper half of the fill count. L260-L262: authenticated and indirect-MAC blocks keep all 3 DVAs.

### 4. `zio_write_compress`, the four outcomes — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1982-L2017

```c
	/* If it's a compressed write that is not raw, compress the buffer. */
	if (compress != ZIO_COMPRESS_OFF &&
	    !(zio->io_flags & ZIO_FLAG_RAW_COMPRESS)) {
		abd_t *cabd = NULL;
		if (abd_cmp_zero(zio->io_abd, lsize) == 0)
			psize = 0;
		else if (compress == ZIO_COMPRESS_EMPTY)
			psize = lsize;
		else
			psize = zio_compress_data(compress, zio->io_abd, &cabd,
			    lsize,
			    zio_get_compression_max_size(compress,
			    spa->spa_gcd_alloc, spa->spa_min_alloc, lsize),
			    zp->zp_complevel);
		if (psize == 0) {
			compress = ZIO_COMPRESS_OFF;
		} else if (psize >= lsize) {
			compress = ZIO_COMPRESS_OFF;
			if (cabd != NULL)
				abd_free(cabd);
		} else if (psize <= BPE_PAYLOAD_SIZE && !zp->zp_encrypt &&
		    zp->zp_level == 0 && !DMU_OT_HAS_FILL(zp->zp_type) &&
		    spa_feature_is_enabled(spa, SPA_FEATURE_EMBEDDED_DATA)) {
			void *cbuf = abd_borrow_buf_copy(cabd, lsize);
			encode_embedded_bp_compressed(bp,
			    cbuf, compress, lsize, psize);
			BPE_SET_ETYPE(bp, BP_EMBEDDED_TYPE_DATA);
			BP_SET_TYPE(bp, zio->io_prop.zp_type);
			BP_SET_LEVEL(bp, zio->io_prop.zp_level);
			abd_return_buf(cabd, cbuf, lsize);
			abd_free(cabd);
			BP_SET_LOGICAL_BIRTH(bp, zio->io_txg);
			zio->io_pipeline = ZIO_INTERLOCK_PIPELINE;
			ASSERT(spa_feature_is_active(spa,
			    SPA_FEATURE_EMBEDDED_DATA));
			return (zio);
```

L1986-L1987: before compressing, the block is compared with zeros; an all-zero block gets `psize = 0`. L1991-L1995: otherwise the compressor runs with the limit of excerpt 1 as its output size; `zio_compress_data` returns the source size when the output does not fit ([`module/zfs/zio_compress.c#L148-L149`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_compress.c#L148-L149)). L1996-L2001: `psize == 0` and `psize >= lsize` both turn compression off for this block. L2002-L2017: an output of at most `BPE_PAYLOAD_SIZE` (112) bytes is folded into the block pointer itself (`encode_embedded_bp_compressed`) if the block is not encrypted, is at level 0, its type has no fill count, and the `embedded_data` feature is enabled; the pipeline becomes `ZIO_INTERLOCK_PIPELINE`, with no allocation and no write. Without `compression` (`ZIO_COMPRESS_OFF`), none of this runs: an all-zero block is written like any other, unless dedup is on, which turns compression to `ZIO_COMPRESS_EMPTY` (zero detection only) "since storing many references to an all zeros block in the dedup table would be expensive" ([`module/zfs/dmu.c#L2465-L2472`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2465-L2472)).

### 5. `zio_write_compress`, rounding to the sector — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2018-L2039

```c
		} else {
			/*
			 * Round compressed size up to the minimum allocation
			 * size of the smallest-ashift device, and zero the
			 * tail. This ensures that the compressed size of the
			 * BP (and thus compressratio property) are correct,
			 * in that we charge for the padding used to fill out
			 * the last sector.
			 */
			size_t rounded = (size_t)zio_roundup_alloc_size(spa,
			    psize);
			if (rounded >= lsize) {
				compress = ZIO_COMPRESS_OFF;
				abd_free(cabd);
				psize = lsize;
			} else {
				abd_zero_off(cabd, psize, rounded - psize);
				psize = rounded;
				zio_push_transform(zio, cabd,
				    psize, lsize, NULL);
			}
		}
```

L2027-L2028: the compressed size is rounded up by `zio_roundup_alloc_size`: to `spa_min_alloc` if it is not above it, else to a multiple of `spa_gcd_alloc` ([`module/zfs/zio.c#L1783-L1789`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1783-L1789)). For a pool of plain disks of one ashift both are `1 << ashift` ([`module/zfs/vdev.c#L428-L437`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L428-L437), [`module/zfs/vdev.c#L1523-L1536`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L1523-L1536)). L2029-L2032: if the rounded size is not smaller than the logical size, the block is stored uncompressed. Since the limit of excerpt 1 is already a multiple of the sector for every compressor but ZLE, this branch is reached by ZLE, or by an output that fits under `BPE_PAYLOAD_SIZE` but cannot be embedded (an encrypted block, for instance). L2034-L2035: the tail is zeroed and PSIZE is the rounded size. Then, for `psize == 0`, the block pointer stays a hole; if the block existed before and the `hole_birth` feature is active, it keeps its logical size, type and level and is born in the current txg (`BP_SET_BIRTH(bp, zio->io_txg, 0)`, L2113), so an incremental send sees the hole; and the pipeline does no allocation ([`module/zfs/zio.c#L2107-L2115`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2107-L2115)); otherwise PSIZE, compression, checksum and the D bit are set, and a dedup write goes to `ZIO_DDT_WRITE_PIPELINE` ([`module/zfs/zio.c#L2116-L2132`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2116-L2132)). On a single-disk vdev, the space allocated is PSIZE rounded up to the sector ([`module/zfs/vdev.c#L368-L370`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L368-L370)).

### 6. `zio_ddt_write`, the lookup — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3816-L3832

```c
	ddt_enter(ddt);
	/*
	 * Search DDT for matching entry.  Skip DVAs verification here, since
	 * they can go only from override, and once we get here the override
	 * pointer can't have "D" flag to be confused with pruned DDT entries.
	 */
	IMPLY(zio->io_bp_override, !BP_GET_DEDUP(zio->io_bp_override));
	dde = ddt_lookup(ddt, bp, B_FALSE);
	if (dde == NULL) {
		/* DDT size is over its quota so no new entries */
		ddt_exit(ddt);
		zp->zp_dedup = B_FALSE;
		BP_SET_DEDUP(bp, B_FALSE);
		if (zio->io_bp_override == NULL)
			zio->io_pipeline = ZIO_WRITE_PIPELINE;
		return (zio);
	}
```

L3823: every dedup write looks its block pointer up in the DDT under the DDT lock. L3824-L3832: a NULL entry means the table is over its quota: the D bit is cleared and the block goes through the ordinary write pipeline. Otherwise `ddt_lookup` returns an entry, found or new; with `dedup_verify` the data is compared first ([`module/zfs/zio.c#L3834-L3855`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3834-L3855), not shown).

### 7. `ddt_lookup`, the quota — module/zfs/ddt.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L1374-L1387

```c
	boolean_t valid = B_TRUE;

	if (dde->dde_type == DDT_TYPES &&
	    dde->dde_class == DDT_CLASSES &&
	    ddt_over_quota(spa)) {
		/* Over quota. If no one is waiting, clean up right now. */
		if (dde->dde_waiters == 0) {
			avl_remove(&ddt->ddt_tree, dde);
			ddt_free(ddt, dde);
			return (NULL);
		}

		/* Flag cleanup required */
		dde->dde_flags |= DDE_FLAG_OVERQUOTA;
```

L1376-L1378: the lookup found the key in no type and no class (a block never seen) and the pool is over its quota (`ddt_over_quota`, [`module/zfs/ddt.c#L1136-L1163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L1136-L1163)): the new entry is dropped and NULL returned. A key that is found is still returned over quota, so a hit still deduplicates; only new entries are refused. The comment that introduces the quota says the same ([`module/zfs/ddt.c#L113-L127`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L113-L127)): "ddt_lookup() will only return entries for existing blocks, as updates are still possible".

### 8. `zio_ddt_write`, a miss — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4156-L4167

```c
	/*
	 * Optimistically increment the refcount for this dedup write.
	 * If the write fails, zio_ddt_child_write_done() will decrement
	 * for all non-DDT-child parents.
	 */
	ddt_phys_addref(ddp, v);

	ddt_exit(ddt);

	zio_nowait(cio);

	return (zio);
```

A new entry has no DVA, so `have_dvas` is 0 and the hit branch of excerpt 2 is not taken: a child write is issued with the entry attached ([`module/zfs/zio.c#L4110-L4114`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4110-L4114)). L4161: the entry's refcount is incremented now, before the write completes; a new entry goes from 0 to 1. If the write fails, the increment is undone ([`module/zfs/zio.c#L3726-L3738`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3726-L3738)).

### 9. `zio_ddt_child_write_ready` — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3756-L3792

```c
zio_ddt_child_write_ready(zio_t *zio)
{
	ddt_t *ddt = ddt_select(zio->io_spa, zio->io_bp);
	ddt_entry_t *dde = zio->io_private;

	zio_link_t *zl = NULL;
	ASSERT3P(zio_walk_parents(zio, &zl), !=, NULL);

	int p = DDT_PHYS_FOR_COPIES(ddt, zio->io_prop.zp_copies);
	ddt_phys_variant_t v = DDT_PHYS_VARIANT(ddt, p);

	if (ddt_phys_is_gang(dde->dde_phys, v)) {
		for (int i = 0; i < BP_GET_NDVAS(zio->io_bp); i++) {
			dva_t *d = &zio->io_bp->blk_dva[i];
			metaslab_group_alloc_decrement(zio->io_spa,
			    DVA_GET_VDEV(d), zio->io_allocator,
			    METASLAB_ASYNC_ALLOC, zio->io_size, zio);
		}
		zio->io_error = EAGAIN;
	}

	if (zio->io_error != 0)
		return;

	mutex_enter(&dde->dde_io->dde_io_lock);

	ddt_phys_extend(dde->dde_phys, v, zio->io_bp);

	zio_t *pio;
	zl = NULL;
	while ((pio = zio_walk_parents(zio, &zl)) != NULL) {
		if (!(pio->io_flags & ZIO_FLAG_DDT_CHILD))
			ddt_bp_fill(dde->dde_phys, v, pio->io_bp, zio->io_txg);
	}

	mutex_exit(&dde->dde_io->dde_io_lock);
}
```

L3782: when the child write has its DVAs, `ddt_phys_extend` copies them into the entry, which records them for the next hit. L3786-L3789: and every parent waiting on this write gets its block pointer filled from the entry.

### 10. The DDT and its log — module/zfs/ddt.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L136-L156

```c
 * ## Dedup log
 *
 * Historically, all entries modified on a txg were written back to dedup
 * storage objects at the end of every txg. This could cause significant
 * overheads, as each entry only takes up a tiny portion of a ZAP leaf node,
 * and so required reading the whole node, updating the entry, and writing it
 * back. On busy pools, this could add serious IO and memory overheads.
 *
 * To address this, the dedup log was added. If the "fast_dedup" feature is
 * enabled, at the end of each txg, modified entries will be copied to an
 * in-memory "log" object (ddt_log_t), and appended to an on-disk log. If the
 * same block is requested again, the in-memory object will be checked first,
 * and if its there, the entry inflated back onto the live tree without going
 * to storage. The on-disk log is only read at pool import time, to reload the
 * in-memory log.
 *
 * Each txg, some amount of the in-memory log will be flushed out to a DDT
 * storage object (ie ZAP) as normal. OpenZFS will try hard to flush enough to
 * keep up with the rate of change on dedup entries, but not so much that it
 * would impact overall throughput, and not using too much memory. See the
 * zfs_dedup_log_* tunables in zfs(4) for more details.
```

L138-L142: without the log, every entry modified in a txg is written back to its storage object at the end of the txg, and since an entry is a tiny part of a ZAP leaf, that means reading the whole leaf, updating the entry and writing the leaf back. L144-L150: with `fast_dedup`, modified entries are copied to an in-memory log and appended to an on-disk log, and a later lookup finds them there. L152-L156: some of the log is flushed to the ZAP every txg; the amount is governed by the `zfs_dedup_log_*` tunables, which the comment does not quantify here. The lookup itself is described at [`module/zfs/ddt.c#L72-L77`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L72-L77): "If its not found, the write proceeds as normal, and after it succeeds, a new entry is created. If it is found, we fill the BP with the DVAs from the entry, increment the refcount and cause the write IO to return immediately."

### 11. The encrypted block pointer — include/sys/spa.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L188-L225

```c
/*
 * The blkptr_t's of encrypted blocks also need to store the encryption
 * parameters so that the block can be decrypted. This layout is as follows:
 *
 *	64	56	48	40	32	24	16	8	0
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 0	|  pad  |	  vdev1         | pad   |	  ASIZE		|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 1	|G|			 offset1				|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 2	|  pad  |	  vdev2         | pad   |	  ASIZE		|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 3	|G|			 offset2				|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 4	|			salt					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 5	|			IV1					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 6	|BDX|lvl| type	| cksum |E| comp|    PSIZE	|     LSIZE	|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 7	|R|			padding					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 8	|			padding					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * 9	|			physical birth txg			|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * a	|			logical birth txg			|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * b	|		IV2		|	    fill count		|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * c	|			checksum[0]				|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * d	|			checksum[1]				|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * e	|			MAC[0]					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
 * f	|			MAC[1]					|
 *	+-------+-------+-------+-------+-------+-------+-------+-------+
```

L194-L201: words 0-3 are the first two DVAs, as in an ordinary block pointer ([`include/sys/spa.h#L123-L160`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L123-L160)). L202-L205: words 4 and 5, the third DVA elsewhere, hold the salt and the first 64 bits of the IV. L206-L215: words 6 to a do not change. L216: the upper 32 bits of word b hold the last 32 bits of the IV, the lower 32 the fill count. L218-L225: words c and d keep a 128-bit checksum, words e and f hold the 128-bit MAC. `BP_IS_ENCRYPTED` is the X bit (bit 61 of word 6) on a block at level 0 or below whose type is encrypted; with the X bit, a level-0 block of an unencrypted type is `BP_IS_AUTHENTICATED`, and a block at level 1 or more `BP_HAS_INDIRECT_MAC_CKSUM` ([`include/sys/spa.h#L452-L470`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L452-L470)). The IV2 accessors read and write bits 32-63 of `blk_fill` ([`include/sys/spa.h#L531-L538`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L531-L538)); `zio_crypt_encode_params_bp` writes the salt to `blk_dva[2].dva_word[0]`, the IV to `dva_word[1]` and IV2 ([`module/os/linux/zfs/zio_crypt.c#L751-L773`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L751-L773)), `zio_crypt_encode_mac_bp` the MAC to `zc_word[2]` and `zc_word[3]` of `blk_cksum` ([`module/os/linux/zfs/zio_crypt.c#L809-L827`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L809-L827)). Embedded block pointers cannot be encrypted: they use that space for their payload ([`include/sys/spa.h#L320-L322`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L320-L322)).

### 12. `zio_encrypt`, what each kind of block gets — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5123-L5153

```c
	/* indirect blocks only maintain a cksum of the lower level MACs */
	if (BP_GET_LEVEL(bp) > 0) {
		BP_SET_CRYPT(bp, B_TRUE);
		VERIFY0(zio_crypt_do_indirect_mac_checksum_abd(B_TRUE,
		    zio->io_orig_abd, BP_GET_LSIZE(bp), BP_SHOULD_BYTESWAP(bp),
		    mac));
		zio_crypt_encode_mac_bp(bp, mac);
		return (zio);
	}

	/*
	 * Objset blocks are a special case since they have 2 256-bit MACs
	 * embedded within them.
	 */
	if (ot == DMU_OT_OBJSET) {
		ASSERT0(DMU_OT_IS_ENCRYPTED(ot));
		ASSERT3U(BP_GET_COMPRESS(bp), ==, ZIO_COMPRESS_OFF);
		BP_SET_CRYPT(bp, B_TRUE);
		VERIFY0(spa_do_crypt_objset_mac_abd(B_TRUE, spa, dsobj,
		    zio->io_abd, psize, BP_SHOULD_BYTESWAP(bp)));
		return (zio);
	}

	/* unencrypted object types are only authenticated with a MAC */
	if (!DMU_OT_IS_ENCRYPTED(ot)) {
		BP_SET_CRYPT(bp, B_TRUE);
		VERIFY0(spa_do_crypt_mac_abd(B_TRUE, spa, dsobj,
		    zio->io_abd, psize, mac));
		zio_crypt_encode_mac_bp(bp, mac);
		return (zio);
	}
```

L5123-L5131: an indirect block is not encrypted; its block pointer carries, in the MAC words, a checksum of the MACs of the level below. L5137-L5144: the objset block carries two MACs inside the block itself. L5146-L5153: a level-0 block of an unencrypted type is only authenticated: a MAC in the block pointer, the data in clear. What is left is a level-0 block of an encrypted type: it is encrypted, and salt, IV and MAC are encoded in the block pointer ([`module/zfs/zio.c#L5183-L5199`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L5183-L5199)). In an encrypted dataset, `dmu_write_policy` caps `copies` at 2 for encrypted types, turns off nopwrite for them, and turns off dedup for the unencrypted ones ([`module/zfs/dmu.c#L2511-L2535`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2511-L2535)).

### 13. What stays in clear — module/os/linux/zfs/zio_crypt.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L85-L120

```c
 * Message Authentication Code (MAC)
 * The MAC is an output of authenticated encryption modes such as AES-GCM and
 * AES-CCM. Its purpose is to ensure that an attacker cannot modify encrypted
 * data on disk and return garbage to the application. Effectively, it is a
 * checksum that can not be reproduced by an attacker. We store the MAC in the
 * second 128 bits of blk_cksum, leaving the first 128 bits for a truncated
 * regular checksum of the ciphertext which can be used for scrubbing.
 *
 * OBJECT AUTHENTICATION:
 * Some object types, such as DMU_OT_MASTER_NODE cannot be encrypted because
 * they contain some info that always needs to be readable. To prevent this
 * data from being altered, we authenticate this data using SHA512-HMAC. This
 * will produce a MAC (similar to the one produced via encryption) which can
 * be used to verify the object was not modified. HMACs do not require key
 * rotation or IVs, so we can keep up to the full 3 copies of authenticated
 * data.
 *
 * ZIL ENCRYPTION:
 * ZIL blocks have their bp written to disk ahead of the associated data, so we
 * cannot store the MAC there as we normally do. For these blocks the MAC is
 * stored in the embedded checksum within the zil_chain_t header. The salt and
 * IV are generated for the block on bp allocation instead of at encryption
 * time. In addition, ZIL blocks have some pieces that must be left in plaintext
 * for claiming even though all of the sensitive user data still needs to be
 * encrypted. The function zio_crypt_init_uios_zil() handles parsing which
 * pieces of the block need to be encrypted. All data that is not encrypted is
 * authenticated using the AAD mechanisms that the supported encryption modes
 * provide for. In order to preserve the semantics of the ZIL for encrypted
 * datasets, the ZIL is not protected at the objset level as described below.
 *
 * DNODE ENCRYPTION:
 * Similarly to ZIL blocks, the core part of each dnode_phys_t needs to be left
 * in plaintext for scrubbing and claiming, but the bonus buffers might contain
 * sensitive user data. The function zio_crypt_init_uios_dnode() handles parsing
 * which pieces of the block need to be encrypted. For more details about
 * dnode authentication and encryption, see zio_crypt_init_uios_dnode().
```

L85-L91: the MAC takes the second half of `blk_cksum`, "leaving the first 128 bits for a truncated regular checksum of the ciphertext which can be used for scrubbing". L93-L100: object types that must stay readable, `DMU_OT_MASTER_NODE` among them, are only authenticated, and keep up to 3 copies. L115-L120: the core of each `dnode_phys_t` stays in plaintext "for scrubbing and claiming"; only the bonus buffers, which "might contain sensitive user data", are encrypted. The objset-level MACs and the reason indirect blocks hold a checksum of MACs rather than MACs of their own (raw sends) follow at [`module/os/linux/zfs/zio_crypt.c#L122-L145`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L122-L145).

### 14. The truncated checksum — module/zfs/zio_checksum.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L508-L526

```c
	/*
	 * MAC checksums are a special case since half of this checksum will
	 * actually be the encryption MAC. This will be verified by the
	 * decryption process, so we just check the truncated checksum now.
	 * Objset blocks use embedded MACs so we don't truncate the checksum
	 * for them.
	 */
	if (bp != NULL && BP_USES_CRYPT(bp) &&
	    BP_GET_TYPE(bp) != DMU_OT_OBJSET) {
		if (!(ci->ci_flags & ZCHECKSUM_FLAG_DEDUP)) {
			actual_cksum.zc_word[0] ^= actual_cksum.zc_word[2];
			actual_cksum.zc_word[1] ^= actual_cksum.zc_word[3];
		}

		actual_cksum.zc_word[2] = 0;
		actual_cksum.zc_word[3] = 0;
		expected_cksum.zc_word[2] = 0;
		expected_cksum.zc_word[3] = 0;
	}
```

L508-L511: for a block pointer with the X bit, half of the checksum is the MAC, "verified by the decryption process", so only the truncated checksum is compared here. L517-L520: for a checksum not flagged for dedup (fletcher-4, for instance), words 2 and 3 are first folded into words 0 and 1 with XOR, as the writer did ([`module/zfs/zio_checksum.c#L324-L341`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L324-L341)). L522-L525: words 2 and 3 are then ignored on both sides. Scrub reads with `ZIO_FLAG_RAW` ([`module/zfs/dsl_scan.c#L4841`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L4841)), which skips decryption, so this check is all it needs: no key. A read that must decrypt looks the key up and fails with `EACCES` when it is not loaded ([`module/zfs/dsl_crypt.c#L2818-L2823`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_crypt.c#L2818-L2823)).

### 15. `dmu_write_policy`, encrypted datasets — module/zfs/dmu.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dmu.c#L2511-L2535

```c
	/*
	 * All objects in an encrypted objset are protected from modification
	 * via a MAC. Encrypted objects store their IV and salt in the last DVA
	 * in the bp, so we cannot use all copies. Encrypted objects are also
	 * not subject to nopwrite since writing the same data will still
	 * result in a new ciphertext. Only encrypted blocks can be dedup'd
	 * to avoid ambiguity in the dedup code since the DDT does not store
	 * object types.
	 */
	if (os->os_encrypted && (wp & WP_NOFILL) == 0) {
		encrypt = B_TRUE;

		if (DMU_OT_IS_ENCRYPTED(type)) {
			copies = MIN(copies, SPA_DVAS_PER_BP - 1);
			gang_copies = MIN(gang_copies, SPA_DVAS_PER_BP - 1);
			nopwrite = B_FALSE;
		} else {
			dedup = B_FALSE;
		}

		if (level <= 0 &&
		    (type == DMU_OT_DNODE || type == DMU_OT_OBJSET)) {
			compress = ZIO_COMPRESS_EMPTY;
		}
	}
```

L2520-L2521: every block of an encrypted objset gets `zp_encrypt`. L2523-L2526: an encrypted type keeps at most `SPA_DVAS_PER_BP - 1` = 2 copies, since the third DVA holds salt and IV, and gives up nopwrite. L2527-L2529: an unencrypted type is not deduplicated, "since the DDT does not store object types". L2531-L2534: level-0 dnode and objset blocks are only checked for zeros, never compressed.

**What the animation shows.** (Simplifications and why they stay faithful: `DECISIONS.md` D10.2.)
- Compression: the visitor picks the logical size of the block (4, 8, 16 or 128 KiB), the pool's ashift (9, 12 or 13), the compression (off, LZ4 standing for every compressor but ZLE, or ZLE) and the data (all zeros, or data whose compressor output is given in bytes, with four presets). The bar of the block is drawn with the line `d_len = s_len - (s_len >> 3)` and the same line snapped down to the sector ([`module/zfs/zio.c#L1797-L1804`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1797-L1804)), or `BPE_PAYLOAD_SIZE` when the snapped line falls under one sector ([`module/zfs/zio.c#L1806-L1807`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1806-L1807)). The outcome follows `zio_write_compress` (excerpts 4 and 5): all zeros and compression on → a hole, nothing allocated; an output above the limit → stored uncompressed at LSIZE; an output of at most 112 bytes that can be embedded → in the block pointer, nothing allocated; else PSIZE is the output rounded up to the sector, unless that reaches LSIZE (ZLE). The sectors allocated are drawn ([`module/zfs/vdev.c#L370`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/vdev.c#L370)), and the block pointer with its PSIZE, compression and, for an embedded block, the payload words ([`include/sys/spa.h#L265-L294`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L265-L294)).
- Dedup: the visitor writes blocks of three contents, A, B and C, one per txg, with `dedup=on`, `copies=1`, and can put the DDT over its quota. Each write goes through `ddt_lookup` (excerpt 6). A miss: a new entry, refcount 1, the block written and its DVA copied into the entry (excerpts 8, 9). A hit: the new block pointer gets the entry's DVA, its logical birth is the current txg and its physical birth the entry's, the refcount goes up, nothing is written (excerpt 2, [`module/zfs/ddt.c#L724-L726`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L724-L726)). Over quota: a hit still deduplicates; a block never seen has its D bit cleared and is written as an ordinary block, with no entry (excerpts 6, 7). Counters: writes, DDT lookups (one per write), blocks written, entries.
- Encryption: the 16 words of a block pointer, for four kinds of block: not encrypted; a level-0 block of an encrypted type (words 4, 5, the top of b, e and f become salt, IV1, IV2 and MAC, excerpt 11); a level-0 block of an unencrypted type, authenticated (e and f are a MAC, three DVAs); an indirect block (e and f are a checksum of the MACs below, excerpt 12). Below, a small encrypted file: its dnode (core in clear, bonus buffer encrypted, excerpt 13), its indirect block (in clear) and three data blocks (encrypted). The visitor unloads the key: scrub still verifies every block's truncated checksum (words c and d, excerpt 14), the file's data reads as `EACCES`, the dnode core and the indirect block stay readable. A bit flipped in a data block on disk is caught by scrub with the key unloaded.
- Simplified: compressor output sizes are inputs, not computed by a real compressor; compression levels; the late-sync-pass "stop compressing" rule (`zfs_sync_pass_dont_compress = 8`, [`module/zfs/zio.c#L125`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L125)); raidz and mixed-ashift pools (`spa_min_alloc` differs from `spa_gcd_alloc`); dedup verify and collisions ([`module/zfs/zio.c#L3834`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3834)); more than one copy and the partial-DVA extension of fast dedup; two writes of the same block in one txg (the in-flight path, [`module/zfs/zio.c#L3994-L4083`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3994-L4083)); the dedup log and pruning are told in the text, not animated; the ciphertext, MACs, salt and IV of the figure are stand-ins, not AES; key rotation by salt, ZIL encryption and the objset-level MACs are not animated.

**Facts for the text**
- Minimum saving for compression is one eighth: `d_len = s_len - (s_len >> 3)` — [`module/zfs/zio.c#L1797-L1798`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1797-L1798); embedded block pointers hold at most `BPE_PAYLOAD_SIZE` = 14 words of 8 bytes, 112 bytes — [`include/sys/spa.h#L356-L357`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L356-L357).
- A DDT key is the 256-bit block checksum plus one word encoding LSIZE, PSIZE, compression and encryption — [`include/sys/ddt.h#L95-L105`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/ddt.h#L95-L105). The on-disk value is 256 bytes in the traditional format and 72 bytes in the "flat" format used by fast dedup — [`include/sys/ddt.h#L152`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/ddt.h#L152), [`include/sys/ddt.h#L161`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/ddt.h#L161). The code gives no figure for in-memory cost per entry beyond these sizes. The comments explain why the DDT costs I/O: each entry is a tiny part of a ZAP leaf, so updating one means reading and rewriting the whole node — [`module/zfs/ddt.c#L138-L142`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L138-L142).
- Fast dedup adds a dedup log: modified entries are appended to an on-disk log and kept in memory, flushed gradually to the ZAP — [`module/zfs/ddt.c#L144-L150`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L144-L150); log trees are swapped after at most `zfs_dedup_log_txg_max = 8` txgs — [`module/zfs/ddt_log.c#L41`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt_log.c#L41); a `dedup_table_quota` makes `ddt_lookup` refuse new entries — [`module/zfs/ddt.c#L115-L121`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L115-L121).
- Encryption is AES-GCM or AES-CCM with 128, 192 or 256-bit keys; authentication uses SHA512-HMAC — [`module/os/linux/zfs/zio_crypt.c#L39-L40`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L39-L40). Block parameters: salt 8 bytes, IV 12 bytes, MAC 16 bytes — [`include/sys/zio.h#L129-L131`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio.h#L129-L131).
- Per-dataset keys: a random master key, stored on disk encrypted with the user's wrapping key, so changing the passphrase does not re-encrypt data — [`module/zfs/dsl_crypt.c#L37-L41`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_crypt.c#L37-L41); `dsl_crypto_key_t` holds the master key `dck_key` and the wrapping key `dck_wkey` — [`include/sys/dsl_crypt.h#L111-L126`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/dsl_crypt.h#L111-L126); snapshots and clones share the same key — [`module/zfs/dsl_crypt.c#L60-L61`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_crypt.c#L60-L61).
- What stays in clear: object types like `DMU_OT_MASTER_NODE` are only authenticated — [`module/os/linux/zfs/zio_crypt.c#L94-L95`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L94-L95); the core of every `dnode_phys_t` stays in plaintext "for scrubbing and claiming", only bonus buffers are encrypted — [`module/os/linux/zfs/zio_crypt.c#L115-L118`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L115-L118); a key is rotated (new salt) after `ZFS_KEY_MAX_SALT_USES_DEFAULT` = 400000000 blocks — [`module/os/linux/zfs/zio_crypt.c#L187`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L187).
- Compression limit at the sizes the figure offers (`zio_get_compression_max_size`, excerpt 1): 128 KiB → 114,688 bytes at ashift 9, 12 and 13 (seven eighths of 128 KiB is already a multiple of 8 KiB); 16 KiB → 14,336 / 12,288 / 8,192; 8 KiB → 7,168 / 4,096 / 112 (embedding only); 4 KiB → 3,584 / 112 / 112. ZLE: always seven eighths, unsnapped.
- An entry's key, `ddt_key_t`, is 40 bytes: the 256-bit checksum and `ddk_prop` ([`include/sys/ddt.h#L95-L105`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/ddt.h#L95-L105)). The quota is on "the on-disk size of the dedup store" ([`module/zfs/ddt.c#L124-L127`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L124-L127)).
- Encrypted dedup: blocks that dedup together must share IV and key, so salt and IV come from an HMAC of the plaintext; dedup across encrypted datasets "will only work within a clone family" ([`module/os/linux/zfs/zio_crypt.c#L147-L163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L147-L163)).

- Order of the write stages: `ZIO_STAGE_WRITE_COMPRESS` (1 << 5), `ZIO_STAGE_ENCRYPT` (1 << 6), `ZIO_STAGE_CHECKSUM_GENERATE` (1 << 7), then `ZIO_STAGE_DDT_WRITE` (1 << 11) — [`include/sys/zio_impl.h#L135-L144`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L135-L144). The pipeline runs stages in bit order, so a block is compressed, then encrypted, then checksummed, and dedup looks up the checksum of the ciphertext.
- The dedup log is only for tables of the new format: `ddt_version_flags[DDT_VERSION_FDT] = DDT_FLAG_FLAT | DDT_FLAG_LOG`, legacy tables get no flag — [`module/zfs/ddt.c#L303-L310`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L303-L310). A table created before `fast_dedup` still rewrites its ZAP leaves every txg. The log comment bounds the flush by throughput and memory: "not so much that it would impact overall throughput, and not using too much memory" — [`module/zfs/ddt.c#L152-L156`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L152-L156).
- The quota's default is `auto`, stored as `UINT64_MAX` — [`module/zcommon/zpool_prop.c#L143-L145`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zcommon/zpool_prop.c#L143-L145). With `auto`, `ddt_over_quota` caps the table only by the space of a dedup or special vdev and otherwise returns false; 0 means no quota — [`module/zfs/ddt.c#L1136-L1163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L1136-L1163). On a pool of plain disks the table is not capped unless a size is set.
- Authenticated blocks "can keep up to the full 3 copies" — [`module/os/linux/zfs/zio_crypt.c#L95-L100`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L95-L100). Non-dedup blocks get a random IV — [`module/os/linux/zfs/zio_crypt.c#L52-L53`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L52-L53); only dedup writes derive salt and IV from an HMAC of the plaintext — [`module/os/linux/zfs/zio_crypt.c#L147-L163`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/os/linux/zfs/zio_crypt.c#L147-L163).
- A block whose truncated checksum fails is not decrypted: the read stops at `ECKSUM` and returns no plaintext (excerpt 14).

**Hand-checked cases** (the unit tests replay them).

- *Compression, LZ4, ashift 12.* 128 KiB, output 50,000 bytes: limit 114,688; PSIZE 53,248 (13 sectors), compressed. Output 114,000: PSIZE 114,688, the limit itself, compressed. Output 120,000: over the limit, stored at 131,072 (32 sectors), uncompressed. All zeros: a hole, 0 sectors. Output 90: embedded, 0 sectors. 4 KiB, output 2,000: limit 112, stored uncompressed at 4,096; output 90: embedded. 8 KiB, output 5,000: limit 4,096, uncompressed at 8,192. 16 KiB, output 12,000: limit 12,288, PSIZE 12,288.
- *Compression, LZ4, ashift 9.* 128 KiB, output 50,000: PSIZE 50,176 (98 sectors). 4 KiB, output 2,000: limit 3,584, PSIZE 2,048 (4 sectors).
- *Compression, ZLE, ashift 12.* 8 KiB, output 5,000: limit 7,168 (unsnapped), rounded to 8,192 = LSIZE, uncompressed. 4 KiB, output 3,000: limit 3,584, rounded to `spa_min_alloc` 4,096 = LSIZE, uncompressed. 16 KiB, output 12,000: PSIZE 12,288.
- *Compression off.* 128 KiB of zeros: written, 131,072 bytes, 32 sectors at ashift 12.
- *Encrypted, LZ4, ashift 12.* 4 KiB, output 90: not embedded; rounded to 4,096 = LSIZE, uncompressed. 128 KiB, output 90: PSIZE 4,096.
- *Dedup* (`copies=1`, one write per txg from txg 100). A (100): miss, entry A refcount 1, written at DVA d1. B (101): miss, entry B, d2. A (102): hit, the block pointer gets d1, logical birth 102, physical birth 100, A refcount 2, nothing written. Quota on. C (103): `ddt_lookup` returns NULL, D bit cleared, written at d3, no entry. A (104): hit, refcount 3. C (105): NULL again, written at d4, a second copy of C. Six writes, six lookups, four blocks written, two entries.
- *Encryption.* Word roles, from `spa.h`: not encrypted 0-5 DVAs 1-3, 6 properties, 7 R and padding, 8 padding, 9 physical birth, a logical birth, b fill, c-f checksum; encrypted level 0: 4 salt, 5 IV1, b IV2 and fill, c-d checksum, e-f MAC, at most 2 DVAs; authenticated level 0 and indirect: DVAs 1-3, c-d checksum, e-f MAC (indirect: of the MACs below). Key unloaded: scrub verifies the five blocks of the file (its dnode block, its indirect block, its three data blocks) by words c-d; reading a data block gives `EACCES`; the dnode core and the indirect block are in clear on disk, the bonus buffer and the data are not. A flipped bit in data block 1: scrub reports one checksum error, with or without the key.

**Short excerpts for the question-first room (v1.4, ALG-203).** The room shows only the lines that carry the idea; the longer excerpts above stay as the analysis. Excerpt 16 is new; 17 to 25 are cuts of excerpts 1, 4, 5, 6, 2, 8, 10, 3 and 14. Each is checked against the frozen commit like the others.

### 16. The write stages, in order — include/sys/zio_impl.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/zio_impl.h#L135-L144

```c
	ZIO_STAGE_WRITE_COMPRESS	= 1 << 5,	/* -W---- */

	ZIO_STAGE_ENCRYPT		= 1 << 6,	/* -W---- */
	ZIO_STAGE_CHECKSUM_GENERATE	= 1 << 7,	/* -W---- */

	ZIO_STAGE_NOP_WRITE		= 1 << 8,	/* -W---- */

	ZIO_STAGE_DDT_READ_START	= 1 << 9,	/* R----- */
	ZIO_STAGE_DDT_READ_DONE		= 1 << 10,	/* R----- */
	ZIO_STAGE_DDT_WRITE		= 1 << 11,	/* -W---- */
```

New. The stages of the write pipeline, in the order they run: L135 compression, L137 encryption, L138 the checksum of what will be written, L140 nop-write, L142-L144 the dedup stages. The dedup lookup therefore sees the checksum of the compressed and, in an encrypted dataset, encrypted block. For the room's "In the code" introduction; the bit values give the order, since `__zio_execute` moves from a stage to the next higher bit set in the zio's pipeline ([L2452-L2454](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2452-L2454)).

### 17. `zio_get_compression_max_size`, the limit — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1797-L1807

```c
	/* minimum 12.5% must be saved (legacy value, may be changed later) */
	d_len = s_len - (s_len >> 3);

	/* ZLE can't use exactly d_len bytes, it needs more, so ignore it */
	if (compress == ZIO_COMPRESS_ZLE)
		return (d_len);

	d_len = d_len - d_len % gcd_alloc;

	if (d_len < min_alloc)
		return (BPE_PAYLOAD_SIZE);
```

Excerpt 1 without its signature and last return. L1797-L1798: seven eighths of the source. L1800-L1802: ZLE is exempt from the snap. L1804: the snap down to a multiple of `spa_gcd_alloc`, the sector on a pool of plain disks of one ashift. L1806-L1807: below the minimum allocation, only an output that fits in a block pointer is worth keeping (`BPE_PAYLOAD_SIZE`, 112 bytes).

### 18. `zio_write_compress`, zeros, the compressor, the three early outcomes — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1986-L2004

```c
		if (abd_cmp_zero(zio->io_abd, lsize) == 0)
			psize = 0;
		else if (compress == ZIO_COMPRESS_EMPTY)
			psize = lsize;
		else
			psize = zio_compress_data(compress, zio->io_abd, &cabd,
			    lsize,
			    zio_get_compression_max_size(compress,
			    spa->spa_gcd_alloc, spa->spa_min_alloc, lsize),
			    zp->zp_complevel);
		if (psize == 0) {
			compress = ZIO_COMPRESS_OFF;
		} else if (psize >= lsize) {
			compress = ZIO_COMPRESS_OFF;
			if (cabd != NULL)
				abd_free(cabd);
		} else if (psize <= BPE_PAYLOAD_SIZE && !zp->zp_encrypt &&
		    zp->zp_level == 0 && !DMU_OT_HAS_FILL(zp->zp_type) &&
		    spa_feature_is_enabled(spa, SPA_FEATURE_EMBEDDED_DATA)) {
```

Excerpt 4 from the zero test to the embed test. L1986-L1987: an all-zero block gets PSIZE 0. L1991-L1995: the compressor runs with the limit of excerpt 17 as its output size; `zio_compress_data` returns the source size when the output does not fit ([`module/zfs/zio_compress.c#L148-L149`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_compress.c#L148-L149)). L1996-L1997: PSIZE 0, a hole. L1998-L2001: nothing saved, stored uncompressed. L2002-L2004: at most 112 bytes, not encrypted, level 0, a type without a fill count, `embedded_data` enabled: the data goes into the block pointer and the write stops (L2005-L2017).

### 19. `zio_write_compress`, rounding to the sector — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L2027-L2035

```c
			size_t rounded = (size_t)zio_roundup_alloc_size(spa,
			    psize);
			if (rounded >= lsize) {
				compress = ZIO_COMPRESS_OFF;
				abd_free(cabd);
				psize = lsize;
			} else {
				abd_zero_off(cabd, psize, rounded - psize);
				psize = rounded;
```

Excerpt 5 without its comment. L2027-L2028: the output rounded up to the minimum allocation (`zio_roundup_alloc_size`, [L1783-L1789](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L1783-L1789)). L2029-L2032: if that is not smaller than the block, it is stored uncompressed. L2034-L2035: otherwise the tail of the last sector is zeroed and PSIZE is the rounded size.

### 20. `zio_ddt_write`, the lookup and the quota — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3823-L3832

```c
	dde = ddt_lookup(ddt, bp, B_FALSE);
	if (dde == NULL) {
		/* DDT size is over its quota so no new entries */
		ddt_exit(ddt);
		zp->zp_dedup = B_FALSE;
		BP_SET_DEDUP(bp, B_FALSE);
		if (zio->io_bp_override == NULL)
			zio->io_pipeline = ZIO_WRITE_PIPELINE;
		return (zio);
	}
```

Excerpt 6 from the lookup on. L3823: every dedup write looks its block pointer up, keyed by its checksum. L3824-L3832: NULL means the table is over its quota and the key was not in it (`ddt_lookup`, excerpt 7): the D bit is cleared and the block goes down the ordinary write pipeline.

### 21. `zio_ddt_write`, a hit — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L3983-L3986

```c
			ddt_bp_fill(ddp, v, bp, txg);
			ddt_phys_addref(ddp, v);
			ddt_exit(ddt);
			return (zio);
```

Excerpt 2, its last four lines. L3983: `ddt_bp_fill` copies the entry's DVAs into the new block pointer, with the current txg as logical birth and the entry's as physical birth ([`module/zfs/ddt.c#L724-L726`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L724-L726)). L3984: `ddt_phys_addref` adds a reference ([`module/zfs/ddt.c#L880-L888`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L880-L888)). L3986: the zio returns with no write I/O.

### 22. `zio_ddt_write`, a miss — module/zfs/zio.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio.c#L4161-L4165

```c
	ddt_phys_addref(ddp, v);

	ddt_exit(ddt);

	zio_nowait(cio);
```

Excerpt 8, the reference and the write. L4161: the new entry's refcount goes up before the write completes; it is undone if the write fails (comment L4156-L4160). L4165: the child write is issued; `zio_ddt_child_write_ready` copies its DVA into the entry (excerpt 9).

### 23. The DDT, why updating it in place costs — module/zfs/ddt.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/ddt.c#L138-L142

```c
 * Historically, all entries modified on a txg were written back to dedup
 * storage objects at the end of every txg. This could cause significant
 * overheads, as each entry only takes up a tiny portion of a ZAP leaf node,
 * and so required reading the whole node, updating the entry, and writing it
 * back. On busy pools, this could add serious IO and memory overheads.
```

Excerpt 10, its first paragraph. Without the dedup log, every entry modified in a txg was written back at the end of the txg, and an entry is a small part of a ZAP leaf: the whole leaf is read, one entry updated, the leaf written back. The rest of excerpt 10 (L144-L156) describes the log that `fast_dedup` adds.

### 24. The encrypted block pointer, in one comment — include/sys/spa.h

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/include/sys/spa.h#L250-L257

```c
 * The MAC occupies half of the checksum space since it serves a very similar
 * purpose: to prevent data corruption on disk. The only functional difference
 * is that the checksum is used to detect on-disk corruption whether or not the
 * encryption key is loaded and the MAC provides additional protection against
 * malicious disk tampering. We use the 3rd DVA to store the salt and first
 * 64 bits of the IV. As a result encrypted blocks can only have 2 copies
 * maximum instead of the normal 3. The last 32 bits of the IV are stored in
 * the upper bits of what is usually the fill count. Note that only blocks at
```

Excerpt 3, the middle of the comment. L250-L254: the MAC takes half of the checksum; the other half still detects corruption on disk whether or not the key is loaded. L254-L256: the third DVA holds the salt and the first 64 bits of the IV, so an encrypted block keeps at most two copies. L256-L257: the last 32 bits of the IV sit in the upper half of the fill count.

### 25. `zio_checksum_error_impl`, the truncated comparison — module/zfs/zio_checksum.c

https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L515-L525

```c
	if (bp != NULL && BP_USES_CRYPT(bp) &&
	    BP_GET_TYPE(bp) != DMU_OT_OBJSET) {
		if (!(ci->ci_flags & ZCHECKSUM_FLAG_DEDUP)) {
			actual_cksum.zc_word[0] ^= actual_cksum.zc_word[2];
			actual_cksum.zc_word[1] ^= actual_cksum.zc_word[3];
		}

		actual_cksum.zc_word[2] = 0;
		actual_cksum.zc_word[3] = 0;
		expected_cksum.zc_word[2] = 0;
		expected_cksum.zc_word[3] = 0;
```

Excerpt 14 without its comment. L515-L516: a block pointer that uses encryption, except an objset block. L517-L520: for a checksum not made for dedup, words 2 and 3 are folded into words 0 and 1, as the writer did ([`module/zfs/zio_checksum.c#L324-L341`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/zio_checksum.c#L324-L341)). L522-L525: words 2 and 3, the MAC, are ignored on both sides; decryption checks the MAC. Scrub reads raw (`ZIO_FLAG_RAW`, [`module/zfs/dsl_scan.c#L4841`](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/module/zfs/dsl_scan.c#L4841)), so this comparison is all it needs, and it needs no key.

## The Hall's dedication: the AUTHORS file

The dedication says the release lists more than 700 people in its AUTHORS file:
[AUTHORS](https://github.com/openzfs/zfs/blob/71a9f9578616a90c3c14bb59629fb4d31bfd68d1/AUTHORS#L1-L729)
names 2 maintainers (lines 3–4), 1 past maintainer (line 8) and 718 contributors (lines 11–728),
721 names in all: `grep -c '^    ' AUTHORS` at the frozen commit (every name is indented by
four spaces, the section titles are not).

## Checking the excerpts

```sh
git clone https://github.com/openzfs/zfs ../openzfs
node scripts/check-permalinks.mjs ../openzfs 71a9f9578616a90c3c14bb59629fb4d31bfd68d1 ANALYSIS.md
```

The script checks, for every permalink: the SHA is the frozen one, the file exists at that SHA, the line range is inside the file; and for every excerpt (a permalink followed by a code block): the block equals the lines of `git show <sha>:<path>` byte for byte, the file's SPDX header is `CDDL-1.0`, and the excerpt is at most 40 lines. Result for this version of the file: see `BUILDLOG.md`, slice 0.
