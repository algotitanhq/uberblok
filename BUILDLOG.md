# Build log

One entry per slice: what was done, how it was checked, measures, what is not done.

## Slice 0: analysis (2026-10-18)

Issue ALG-38. Branch `slice-0-analysis`. No site code in this slice, by design.

**Done**

- Repository bootstrap: `README.md` (what Uberblok is, status, licences), `LICENSE` (MIT,
  site code), `DECISIONS.md`, `SOURCES.md` (format and empty tables), this file,
  `.gitignore` (captures and media never go to git).
- OpenZFS frozen at `zfs-2.4.4`, commit `71a9f9578616a90c3c14bb59629fb4d31bfd68d1`
  (D0.1). Cloned outside the repository.
- Toolchain in user space on the build machine: Node 22.23.3 via nvm 0.40.3, Playwright 1.64.1 with
  Chromium 156.0.8078.4, Lighthouse 13.5.0 (D0.2). Five missing Chromium system libraries
  unpacked from Ubuntu packages without root. Smoke test: Playwright opened a page;
  Lighthouse scored a test page over HTTP in all categories.
- Rooms and visit order confirmed: the mission's order, no deviation (D0.4). Hall wording
  about "the ring of 128" made exact (D0.7).
- `ANALYSIS.md`: the architecture (source map with file counts, the ZPL → DMU → DSL → SPA
  → vdev layering, one buffered write and one read traced call by call with a permalink per
  hop), nine key structures with field tables, a list of points where the code differs from
  common accounts, and all twelve code rooms (problem, the 1-3 functions or structures that
  are the idea, excerpts, what the animation shows mapped to lines, facts for the texts).
  The History wing and the Engine room have no code by nature.
- `scripts/check-permalinks.mjs`: no dependency; checks every permalink and every excerpt
  against `git show <sha>:<path>` (D0.5). It runs in GitHub Actions on every push
  (`.github/workflows/check.yml`, OpenZFS fetched at the frozen SHA with depth 1).

**Checked**

- `node scripts/check-permalinks.mjs ../openzfs 71a9f9578616a90c3c14bb59629fb4d31bfd68d1 ANALYSIS.md`
  → `39 excerpts, 544 line references, 0 failures`, no excerpt over 40 lines, every
  excerpted file `CDDL-1.0`.
- The checker itself was tested on a deliberately wrong excerpt (reported as a failure with
  the differing line).
- Beyond the script, claims were re-read against the code by hand on a sample: uberblock
  magic and field order, label write ordering and flush, ring slot count per ashift,
  `zfs_sync_pass_rewrite`, both RAID-Z worked examples (recomputed), ARC constants
  (`ARC_MINTIME`, initial fractions, `arc_c` growth, ghost caps), the 12.5% compression
  rule, the snapshot kill rule, incremental send pruning on logical birth, `dd_origin_obj`.
  One error found and fixed: the ZIL text said a SLOG always prevents WR_INDIRECT; the code
  makes `logbias=throughput` and O_DIRECT writes indirect regardless (`zil.c` L2216-L2217).

**Measures**

None that apply: no site yet. Lighthouse and JS budgets start in slice 1.

**Not done, and known limits of the analysis**

- History facts: `SOURCES.md` has its format only; the history wing is slice 2.
- Island framework: deferred to slice 1 (allowed by the issue).
- Points the analysis states as not read, to read in the room's own slice before animating:
  dRAID permutation generation (vdevs), the full resilver flow in `dsl_scan.c` (RAID-Z),
  the log spacemap `spa_log_spacemap.c` (metaslabs), `vdev_queue` deferral (architecture),
  the FreeBSD copy of `zio_crypt.c` (encryption). Each room section says so where it
  matters.
- The room names used inside the key-structures tables are descriptive, not slugs.

## Slice 1: the living museum (2026-10-18)

Issue ALG-40. Branch `slice-1-living-museum`.

**Done**

- Astro 7.4 static site, TypeScript strict, Node 22 (`.nvmrc`), no island framework (D1.1,
  D1.2). Pages: `/en/` and `/fr/` (Hall), `/en/copy-on-write/` and
  `/fr/copie-sur-ecriture/` (room 3), `/` (language pick), `/404.html`.
- Design system in `src/styles/tokens.css`: Almanak's Nocturne (dark, default) and Paper
  (light), Fraunces, Instrument Serif italic, Inter, self-hosted (D1.3). Theme button in the
  header, remembered, no flash.
- FR/EN: Astro i18n routing, both prefixed, slugs localized in `src/lib/rooms.ts`; the header
  switch keeps the room (D1.4).
- Hall: manifesto, the uberblock explained from the code, 2D ring in SVG with the ashift
  switch 9-10 / 11 / 12 / 13+ (128 / 64 / 32 / 16 slots, QA NIT from ALG-38) and "commit the
  next txg" (slot = txg mod count), map of the visit with all 14 rooms, the 12 not built
  marked "in preparation" and not linked.
- Copy-on-write room, complete: the problem; figure 1, an interactive rewrite of a data
  block climbing to the uberblock step by step, old tree intact, a power cut before the
  commit, a snapshot that keeps the replaced blocks on the deadlist, the block-pointer table
  with real fletcher4 checksums; figure 2, a two-way mirror with bit rot, a lost write and a
  double failure, the read detecting each with the checksum held in the parent, reading the
  other side and repairing; three annotated excerpts read from `ANALYSIS.md` at build time
  (D1.6); explanation in one sentence, one paragraph, and in detail; what the figures leave
  out; text version of each figure; reduced-motion path; previous/next.
- `scripts/check-permalinks.mjs`: a code fence after a line with two or more permalinks is
  now a failure, not an unchecked reference (QA NIT from ALG-38), with tests
  (`scripts/test/`, `npm test`; the new case fails on the old checker).
- `ANALYSIS.md`: ashift 11 added to the ring facts; three facts the room needs, with
  permalinks (fletcher4 is the default checksum and its loop; a mirror read with no good copy
  fails; uberblock slot = txg mod count).
- Deploy workflow as blok (D1.5): `.github/workflows/ci.yml` builds and checks on every
  push, deploy step only `if: vars.CLOUDFLARE_ACCOUNT_ID != ''` (skipped);
  `wrangler.jsonc`; `scripts/alias.sh` (removed in ALG-68); README "Deployment" (now "Deploy").
- `scripts/verify.mjs`: the browser verification loop, reusable by the next slices.

**Checked** (on the local build, `astro preview`, Chromium 156 headless)

- `npm run build`: `astro check` 0 errors, 0 warnings, 0 hints; 6 pages.
- `npm test`: 5 of 5 pass.
- Checker on `ANALYSIS.md`: 39 excerpts, 548 line references, 0 failures. Checker on the
  built HTML: 92 links, 0 failures (every link on the site uses the frozen SHA and points to
  existing lines).
- `scripts/verify.mjs`: 0 console errors or warnings, 0 page errors, 0 failed requests on
  every page; 32 full-page captures (Hall and room x FR/EN x 390 px and 1440 px x dark and
  light) and 10 captures of the figures in motion (mid-rewrite, commit, snapshot, power cut,
  mirror damaged and healed, focus, reduced motion). Captures are attached to the issue, not
  committed.
- Keyboard only (FR and EN, 1440 px): 47 tab stops in the room, every one with a visible
  focus ring; leaf choice by arrow keys, the five steps of the rewrite by Enter, damage and
  read of the mirror by Enter all work; the Hall's commit button is reached and works.
- `prefers-reduced-motion: reduce`: duration tokens are 0, no running animation, "Play"
  completes the five steps in about 0.1 s instead of 7 s.
- Every claim in the room text and narration links to lines of the frozen source; every such
  line is in `ANALYSIS.md` (room "Copy-on-write" and its facts, plus the uberblock facts).

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s,
local build)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/` | 98 | 100 | 100 | 100 | 1.7 s | 1.7 s | 0 ms | 0.078 | 2.1 KB | 120 KB |
| `/fr/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.060 | 2.1 KB | 121 KB |
| `/en/copy-on-write/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.001 | 6.3 KB | 132 KB |
| `/fr/copie-sur-ecriture/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.051 | 6.3 KB | 133 KB |

The three fonts are 107 KB of the total. JS budget per room: 3 MB; used: 6.3 KB.

**Not done, and known limits**

- Lighthouse ran on the local build, not on a preview URL: deploy is off by the board
  directive of 2026-10-18.
- The CLS of the Hall (0.06-0.08, under the 0.1 threshold) comes from the ring's controls,
  hidden until the script runs. Kept: showing dead controls without JavaScript would be
  worse.
- The SVG labels of the tree figure are about 10 px on a 390 px screen; the block-pointer
  table under it carries the same information at text size.
- No screen-reader session (VoiceOver, NVDA) yet: accessibility is checked by Lighthouse/axe,
  the keyboard walk and the live regions' text. Planned in the slice 13 audit.

### Slice 1, QA round 1 (2026-10-18)

QA on ALG-40 asked for changes (1 blocker, 5 should, 5 nits). All of them are fixed.

- **Lost write (blocker).** In the mirror figure, a lost write of D2 now leaves stale bytes
  from an earlier, freed block at the new address, not "D2 version 1". Under copy-on-write
  the new D2 goes to a fresh address. The log line and the text version say so in FR and EN,
  and `ANALYSIS.md` has the fact (`metaslab.c` L4877, `zio.c` L4345-L4346).
- **Permalinks.** Step 3 of the tree ("a new copy of R points to the new I1") links to
  `dbuf_dirty(parent, tx)`, `dbuf.c` L2552, here and in `ANALYSIS.md`. "128-byte" links to
  `SPA_BLKPTRSHIFT` (`spa.h` L361). The ZIL claim links to the `zilog` and `zilog2` rows of
  the checksum table.
- **Wording.**
  - "The one exception to copy-on-write" now says "for blocks of the tree", in EN, FR and
    `ANALYSIS.md`.
  - "Authenticates" is now "vouches for" ("se porte garante" in FR).
  - "Every other write gives the block a new address" now says "normally", and the hole,
    dedup and nopwrite paths are named and linked (`zio.c` L2107-L2136, new fact in
    `ANALYSIS.md`).
- **French typography.** Spacing follows D1.9, enforced by `npm run build`. Also: "la
  validation" instead of "le commit", "s'altère en silence" and "dégradation silencieuse"
  instead of "bit pourri", "donne" instead of "calcule", "soit … soit", agreement in "vdevs
  indirects", and no repeated "code" in the Hall's description.
- **Hall.** A slot is "one sector, rounded up to 1 KiB and capped at 8 KiB". There is a
  note on `multihost=on` (the last slot is kept for MMP).
- **Other nits.** `engines.node` is now `>=22.22.0`. The tree figure's cards have an opaque
  underlay, so the old card's dashed outline no longer crosses the new card's text.

**Checked**

- `npm test`: 10 of 10 pass, including the 5 new typography cases.
- `npm run build`: `astro check` 0 errors, 0 warnings, 0 hints; 6 pages; FR typography 2
  files, 0 failures.
- Checker: `ANALYSIS.md` 39 excerpts, 556 line references, 0 failures; built HTML 108
  links, 0 failures.
- `scripts/verify.mjs`: 42 captures, 0 console errors. The keyboard walk visits 54 stops in
  FR and EN (the new links add 7), all with a visible focus ring. With reduced motion, Play
  finishes in 112 ms.

**Measures** (Lighthouse 13.5.0, same settings as above)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/` | 97 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.078 | 2.1 KB | 120 KB |
| `/fr/` | 97 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.077 | 2.1 KB | 121 KB |
| `/en/copy-on-write/` | 99 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.001 | 6.3 KB | 133 KB |
| `/fr/copie-sur-ecriture/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.070 | 6.3 KB | 134 KB |

## Slice 2: History wing (2026-10-18)

Issue ALG-46. Branch `slice-2-history`, from `main` at `2f79298`.

**Done**

- History wing, FR (`/fr/histoire/`) and EN (`/en/history/`): three eras, 21 dated
  milestones from 2001 to OpenZFS 2.4.4 (August 2026), each sentence with a numbered note to
  its source, the list of sources at the end with links back to the milestones, and a link
  to `SOURCES.md` on the repository (D2.1). Open in the visit: the Hall map links it, and
  previous/next run Hall → History → Copy-on-write in both languages. The FR/EN switch keeps
  the page.
- `SOURCES.md`: 40 rows, one per claim, each with the verbatim excerpt that supports it in
  its notes; 25 primary sources and 15 rows on first-hand sources, no secondary (D2.2,
  D2.4). Ten candidate facts removed for lack of a verifiable source, listed in D2.4.
- `src/lib/sources.ts` reads `SOURCES.md` at build time; `[[Sxx]]` with no row fails the
  build. `scripts/check-sources.mjs` checks the built pages against `SOURCES.md` in CI
  (references, orphans, milestones without a note, FR/EN parity), with 10 tests.
  `scripts/check-source-links.mjs` checks link liveness by hand (D2.3).
- Zero JavaScript on the wing (anchors and `:target` only); no image.
- `scripts/verify.mjs` covers the wing: captures, keyboard walk with a footnote followed and
  back by Enter, the language switch, previous/next across all open pages.

**Checked**

- Every quote, date and name was re-read on its source page before writing (the excerpt is
  in the row's notes). Commits checked in the local clones and on GitHub; release facts
  against the GitHub release notes and `git merge-base` (dRAID not in 2.0.0, in 2.1.0;
  RAID-Z expansion not in 2.2.0, in 2.3.0).
- `npm test`: 20 of 20 pass. `npm run build`: `astro check` 0 errors, 0 warnings, 0 hints; 8
  pages; FR typography 3 files, 0 failures.
- Source check on the built site: `40 entries, 80 references in 8 pages, 0 problems`.
  Mutations on a copy of `dist/` are caught: an unknown id in FR (3 failures reported,
  including the FR/EN mismatch), a milestone stripped of its note in EN (3 failures).
- Link liveness, `node scripts/check-source-links.mjs`, 2026-10-18: `41 links, 41 ok,
  0 failing`. openzfs.org and sec.gov put a bot check in front of automated readers, so
  those sources are cited through Wayback Machine captures (original URLs in the notes).
- Permalinks (no new excerpt in this slice): `ANALYSIS.md` 39 excerpts, 556 line
  references, 0 failures; built HTML 108 links, 0 failures.
- `scripts/verify.mjs`: 52 captures (Hall, History, room x FR/EN x 390/1440 px x dark/light,
  plus the room in motion and the wing's focus states), 0 console errors or warnings, 0
  page errors, 0 failed requests. Keyboard only on the wing (FR and EN, 1440 px): 133 tab
  stops, all with a visible focus ring; Enter on note 1 goes to `#src-S01`, Enter on its
  back link returns to `#m-2001-two-engineers`. Previous/next: Hall → History →
  Copy-on-write and back, the same in FR, and each page's language switch points to the
  same page in the other language.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s,
local build)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/history/` | 98 | 100 | 100 | 100 | 1.7 s | 1.7 s | 0 ms | 0.082 | 0 KB | 119 KB |
| `/fr/histoire/` | 99 | 100 | 100 | 100 | 1.7 s | 1.7 s | 0 ms | 0.039 | 0 KB | 120 KB |
| `/en/` | 97 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.078 | 2.0 KB | 118 KB |
| `/fr/` | 97 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.077 | 2.0 KB | 118 KB |
| `/en/copy-on-write/` | 99 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.001 | 6.1 KB | 130 KB |
| `/fr/copie-sur-ecriture/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.07 | 6.1 KB | 131 KB |

The wing ships no script file; its HTML carries the two small inline scripts every page has
(theme before first paint, theme and language switch). The first Lighthouse run gave the
wing 96 in accessibility: the "back to milestone" links were 22 px targets. They are 32 px
now.

**Not done, and known limits**

- The wing's CLS (0.04-0.08, under the 0.1 threshold) is the font swap moving the era links
  under the lead paragraph, as on the Hall. A site-wide fix (preloading the text font, or a
  metric-matched fallback) belongs to the slice 13 performance audit.
- The source check proves that every milestone and note maps to a row and that FR and EN
  cite the same rows; that a sentence says no more than its row rests on the writing rule
  and on QA's sampling (D2.3).
- Lighthouse on the local build, not on a preview URL (deploy off, board directive of
  2026-10-18). No screen-reader session yet (slice 13).

## Slice 3: Transaction groups room (2026-10-18)

Issue ALG-53. Branch `slice-3-txg`, from `main` at `fcdda25`.

**Done**

- Transaction groups room, EN (`/en/txg/`) and FR (`/fr/txg/`): the problem (consistency
  without fsck while writes keep coming, and why batch them); one idea (three txgs, one per
  stage); the figure; explanation in one sentence, one paragraph and in detail, with five
  annotated excerpts from `zfs-2.4.4` (`txg_sync_thread` wait loop L532-L553, `txg_quiesce`
  L395-L428, `txg_quiesce_thread` L628-L667, the `txg_sync_thread` hand-off L583-L610,
  `spa_sync_iterate_to_convergence` L10743-L10766); what the figure leaves out. Opened in
  the visit: Hall map link, Copy-on-write → Transaction groups in both languages, language
  switch keeps the page.
- The figure (D3.1, D3.2): a model of the two txg threads (`src/lib/txg.ts`) over the
  code's own variables, drawn as three stage columns with per-CPU `tc_count`, the dirty
  meter, the sync passes, the uberblock on disk, both threads' current wait, and a log of
  events, each linked to its lines. Controls: add a write, `zpool sync`, free a large file
  (`txg_wait_open`), background writes, play/pause, next event, reset. Text version,
  reduced-motion path, live region (D3.3).
- `ANALYSIS.md`: two new excerpts (txg.c L532-L553, L628-L667); the "What the animation
  shows" list rewritten to match the model; the L593 note corrected (three txgs in flight
  only when someone asked for a quiesce); facts added (timeout counted from the start of the
  previous sync, `zpool sync` → open + `TXG_DEFER_SIZE`, `txg_kick` and
  `zfs_dirty_data_sync_percent`, `txg_wait_open` callers, empty txg writes no uberblock,
  per-CPU counters, `dsl_scan_active`, pass contents, `fsync` → ZIL). Every link on the
  page is in this section.
- `scripts/test/txg-model.test.mjs`: 7 tests of the model (invariants and each path).
- `src/lib/fr.ts`: the French spacing helper, shared by the History wing and the figure.
- `scripts/verify.mjs` covers the room: captures, figure states, reduced motion, keyboard.

**Checked** (local build, `astro preview`, Chromium 156 headless)

- `npm test`: 27 of 27 pass (20 before, 7 new). `npm run build`: `astro check` 0 errors,
  0 warnings, 0 hints; 10 pages; FR typography 4 files, 0 failures.
- Permalinks: `ANALYSIS.md` 41 excerpts, 589 line references, 0 failures; built HTML 232
  links, 0 failures. Source check: 40 entries, 80 references in 10 pages, 0 problems.
- Every link on both txg pages is a range inside a permalink of `ANALYSIS.md` (script
  comparison of the built HTML against the file).
- `scripts/verify.mjs`: 82 captures, 0 console errors or warnings, 0 page errors, 0 failed
  requests. The figure, driven by its buttons in FR and EN at 390 and 1440 px, reaches
  open 43 / quiescing 42 / syncing 41 after "Free a large file" during a sync, writes the
  uberblock of the synced txg, and plays in real time (6.5 s: txg 42 committed, empty txg 43
  synced without uberblock). Keyboard only (FR and EN, 1440 px): 64 tab stops, all with a
  visible focus ring; Tab to "Add a write", Enter twice, "zpool sync", Enter, "Next event",
  Enter ×25 drives the pipeline through txgs 41 to 43. Reduced motion: duration tokens 0,
  no running animation while stepping. Previous/next: Hall → History → Copy-on-write →
  Transaction groups and back, the same in FR.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s,
local build)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/txg/` | 98 | 100 | 100 | 100 | 1.7 s | 1.8 s | 0 ms | 0.062 | 4.6 KB | 130 KB |
| `/fr/txg/` | 97 | 100 | 100 | 100 | 1.9 s | 2.0 s | 0 ms | 0.066 | 4.6 KB | 131 KB |

The room's script is 8.3 KB minified, 3.4 KB gzipped, plus the shared 0.6 KB helper.

**Not done, and known limits**

- The model's durations, thresholds (4-block sync threshold) and pass sizes are
  illustrative (D3.1); the page says so. The write throttle, scans, synctasks and the ZIL
  are left out.
- CLS 0.06 (under 0.1): the font swap, as on the other pages (slice 13 audit).
- Lighthouse on the local build, not a preview URL (deploy off, board directive of
  2026-10-18). No screen-reader session yet (slice 13).

### Slice 3, QA round 1 (2026-10-18)

- The middle column's caption follows the code: `tx_quiesced_txg` once the txg is
  quiesced and waits for the sync thread, `tx_quiescing_txg` otherwise (txg.c
  L662-L663). `scripts/verify.mjs` now checks the caption after every click of the figure
  and exits non-zero on a mismatch: 44 checks, 24 of them in the quiesced state, 0
  mismatches.
- FR "En une phrase": « l’écrit en une seule fois » instead of « d’un bloc », which read as
  a disk block.
- The convergence note of the `spa.c` excerpt and the `converged` event link point at
  L10765, the `while`, not the closing brace.
- `fsync` "normally" does not wait for a txg, in EN, FR and `ANALYSIS.md`, which cites the
  ZIL's fallbacks to `txg_wait_synced` (zil.c L2394-L2396, L2493-L2502).
- Re-run: `npm test` 27/27; build 0 errors, 10 pages, FR typography 0 failures; permalinks
  `ANALYSIS.md` 41 excerpts / 589 references and built HTML 232 references, 0 failures;
  sources 40 / 80, 0 problems; `verify.mjs` 82 captures, 0 console errors, keyboard 64
  stops with visible focus, reduced motion 0 animations. Lighthouse not re-run: the
  changes are one text node and wording.

## Slice 4: RAID-Z room (2026-10-18)

Issue ALG-58. Branch `slice-4-raidz`, from `main` at `a5acb12`.

**Done**

- RAID-Z room, EN (`/en/raidz/`) and FR (`/fr/raidz/`): the problem (RAID-5's in-place
  stripe update, the write hole, read-modify-write); one idea (every block is its own
  stripe, of variable width); the figure; the write hole and why RAID-Z has none (static
  figure, D4.3); explanation in one sentence, one paragraph and in detail, with five
  annotated excerpts from `zfs-2.4.4` (`vdev_raidz_map_alloc` L615-L649 and L677-L700,
  `vdev_raidz_psize_to_asize` L2305-L2317, `vdev_raidz_combrec` L3523-L3558,
  `vdev_raidz_need_resilver` L4011-L4037); what the figure leaves out, with one line on
  RAIDZ expansion. Opened in the visit: Hall map link, Transaction groups → RAID-Z in both
  languages, language switch keeps the page.
- The figure (D4.1): psize, raidz1/2/3, children, ashift and first sector `b` as inputs;
  the map (parity columns first, data columns as contiguous runs numbered by sector of the
  block, skip sectors hatched, neighbouring rows dashed), every counter of the code with its
  value and link (`s`, `f`, `o`, `q`, `r`, `bc`, `tot`, `acols`, `scols`, `rm_nskip`,
  `asize`), a summary with the space cost; "Write the block" fills data columns one after
  the other, then parity, then all columns at once. Then each child can be set healthy,
  missing or returning bad data, and "Read the block" walks the read path: first read,
  known-missing rebuild, checksum, read-all, every `combrec` combination with its outcome,
  the parity used, what is written back, bad parity left unseen, and whether a resilver
  would rewrite this block. Static default layout, readout and text version rendered at
  build time (readable without JavaScript); reduced-motion path; keyboard operable.
- `src/lib/raidz.ts` (model), `src/lib/raidz-view.ts` (HTML, shared by build and browser),
  `src/components/RaidzMap.astro`, `src/components/WriteHole.astro`.
- `ANALYSIS.md`, room RAID-Z: two new excerpts (L677-L700, L4011-L4037), "Resilver, as far
  as this room goes" (D4.2), "The read path, as the figure runs it", the "What the
  animation shows" list rewritten to match the figure, facts added (minimum children, space
  cost examples, how skip sectors are written, RAIDZ expansion pointer).
- `scripts/test/raidz-model.test.mjs`: 17 tests (layouts, a 30,240-input property test, the
  read path and `combrec`'s order).
- `scripts/verify.mjs` covers the room: captures of its states, reduced motion, no-JS,
  keyboard walk and drive.

**Checked** (local build, `astro preview`, Chromium headless)

- `npm test`: 44 of 44 pass (27 before, 17 new). `npm run build`: `astro check` 0 errors,
  0 warnings, 0 hints; 12 pages; FR typography 5 files, 0 failures.
- Permalinks: `ANALYSIS.md` 43 excerpts, 618 line references, 0 failures; built HTML 378
  links, 0 failures. Source check: 40 entries, 80 references in 12 pages, 0 problems.
- Every one of the 73 code links on each RAID-Z page is a range inside a permalink of
  `ANALYSIS.md` (script comparison of the built HTML against the file).
- Layouts read back from the page by `verify.mjs`, FR and EN at 390 and 1440 px: default
  raidz2 × 6, 24 KiB: s 6, q 1, r 2, bc 4, tot 10, nskip 2, asize 49152; raidz2 × 12,
  8 KiB: q 0, bc 4, tot 4, scols 6, nskip 2, asize 24576; raidz1 × 3, 16 KiB at b = 256:
  f 1, o 85, columns 0 and 1 swapped (children read D1 D0 P); raidz3 × 12, 8 KiB (driven by
  keyboard): bc 5, scols 8, nskip 3, asize 32768. Each equals the hand computation in the
  unit tests.
- Reconstruction, children 0 and 3 returning bad data on the default layout: found at
  attempt 10 (children 0 and 3, D1 rebuilt from Q), P and D1 written back, as the unit test
  predicts. Child 3 missing: D1 rebuilt from P, Q checked, resilver needed.
- `scripts/verify.mjs`: 113 captures, 0 console errors or warnings, 0 page errors, 0 failed
  requests. Keyboard only (FR and EN, 1440 px): 76 tab stops on the room, all with a visible
  focus ring; psize typed, parity by arrow keys, children by arrow keys, a child set missing
  from its select, "Read the block" by Enter. Reduced motion: no cell left pending after
  "Write the block", the read completes in under 0.1 s, 0 running animations. No JS: the 12
  cells of the default layout and asize 49152 are in the page, controls hidden.
  Previous/next: Hall → History → Copy-on-write → Transaction groups → RAID-Z and back,
  the same in FR.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s,
local build)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/raidz/` | 98 | 100 | 100 | 100 | 1.9 s | 2.0 s | 0 ms | 0.037 | 6.8 KB | 136 KB |
| `/fr/raidz/` | 98 | 100 | 100 | 100 | 1.8 s | 1.8 s | 0 ms | 0.061 | 6.8 KB | 137 KB |

The room's script is 13.9 KB minified, 5.5 KB gzipped, plus the shared 0.6 KB helper.

**Not done, and known limits**

- The read tracks columns as right or wrong, not bytes (D4.1). Scrub and resilver read
  paths, DTL-stale columns, slow-child outliers, gang blocks, dRAID and RAIDZ expansion are
  left out; the page says so.
- Resilver is shown only as far as the code basis goes (D4.2): the per-block decision, not
  the scan's queues or pacing.
- Lighthouse on the local build, not a preview URL (deploy off, board directive of
  2026-10-18). No screen-reader session yet (slice 13).

### Slice 4, QA round 1 (2026-10-19)

- Vdev state, EN and FR: `CANT_OPEN` only with more faulted children than parity; one up
  to `nparity` gives `DEGRADED` (vdev_raidz.c L3977-L3983), as `ANALYSIS.md` says. The old
  "with fewer" left exactly `nparity` missing matching neither branch.
- French units: the ashift selector reads `12 (4096 o)`, and byte counts under 1 KiB are
  in `o`, through the strings.
- Wide maps at 390 px: past 12 children the child and column labels drop to 0.5rem with 1px
  gaps, so `D10`, `D11`, `D12` stand apart (raidz3×16, 128 KiB: 0 labels overflowing their
  cell, page `scrollWidth` 390, last column ends at 374 px).
- Text version: a two-sector column reads "sectors 0 and 1" / « secteurs 0 et 1 ».
- Also: FR resilver line « Resilver (enfant 3) : … » instead of « Resilver de enfant 3 ».
- Re-run: `npm test` 44/44; build 0 errors, 12 pages, FR typography 0 failures; permalinks
  `ANALYSIS.md` 43 excerpts / 618 references and built HTML 378 references, 0 failures;
  sources 40 / 80, 0 problems; `verify.mjs` 113 captures, 0 console errors, keyboard 76
  stops on the room with visible focus, reduced motion 0 animations. Lighthouse not re-run:
  the changes are wording, two strings and a narrow-screen CSS rule.

## Slice 5: Snapshots and clones room (2026-10-19)

Issue ALG-71. Branch `slice-5-snapshots`, from `main` at `c848f4f`.

**Done**

- Snapshots and clones room, EN (`/en/snapshots/`) and FR (`/fr/instantanes/`): the problem
  (freeze a whole filesystem at once, then free space later without scanning snapshots or
  counting references); one idea (every block pointer carries its birth txg; one comparison
  with `ds_prev_snap_txg` decides "free now" or "deadlist"); the figure; the explanation in
  one sentence, one paragraph and in detail, with seven annotated excerpts from `zfs-2.4.4`
  (`dsl_dataset_block_kill` L294-L316, `dsl_dataset_snapshot_sync_impl` L1760-L1785 and
  L1830-L1839, `dsl_deadlist_insert` L487-L501, `dsl_pool_sync` L747-L760,
  `dsl_dataset_create_sync_dd` L1213-L1227, `dsl_destroy_snapshot_sync_impl` L387-L424);
  what the figure leaves out, with one line on bookmarks and `zfs promote`. Opened in the
  visit: Hall map link, RAID-Z → Snapshots and clones in both languages, language switch
  keeps the page.
- The figure (D5.2-D5.4): `fs`, its snapshots and one clone, each drawn as `ds_bp`, a root
  block and four data blocks labelled with their birth txg, and its deadlist entries keyed
  by txg. The visitor writes, overwrites and deletes blocks, takes snapshots, clones a
  snapshot, destroys one, all queued in the open txg, then syncs it: each birth, each kill
  with its two numbers and its outcome (freed, or the deadlist entry), each sync task, in a
  log linked to the code; blocks slide to where they go. "Which snapshot owns this block":
  any block shows its birth, the datasets that reference it, its deadlist entries, the
  range of snapshots holding it, and what a kill would do now. `EAGAIN` for a second
  snapshot in a txg and `EEXIST` for the origin of a clone are shown. The opening state
  (txgs 8 to 10), its text version and the legend are rendered at build time (readable
  without JavaScript); reduced-motion path; keyboard operable.
- `src/lib/snapshots.ts` (model, a transcription of the DSL functions),
  `src/lib/snapshots-view.ts` (HTML, shared by build and browser),
  `src/components/SnapshotLab.astro`.
- `ANALYSIS.md`, room Snapshots and clones (D5.1): five new excerpts, birth and kill
  callers, the same-txg order, where the keys start (`$ORIGIN`), clones, snapshot destroy,
  "What the animation shows" rewritten to match the figure, facts added, and a hand-checked
  eight-txg sequence; one correction added to "What the code says that common accounts get
  wrong".
- `scripts/test/snapshots-model.test.mjs`: 12 tests (the hand-checked sequence, the edge
  cases QA will replay, and a property test over 12,000 random txgs).
- `scripts/verify.mjs` covers the room: the QA sequences read back from the page, captures,
  reduced motion, no-JS, keyboard walk and drive.

**Checked** (local build and the private preview, Chromium headless)

- `npm test`: 56 of 56 pass (44 before, 12 new). `npm run build`: `astro check` 0 errors,
  0 warnings, 0 hints; 14 pages; FR typography 6 files, 0 failures.
- Permalinks: `ANALYSIS.md` 48 excerpts, 647 line references, 0 failures; built HTML 486
  references, 0 failures. Source check: 40 entries, 80 references in 14 pages, 0 problems.
- Every one of the 108 code links on the two room pages is a range inside a permalink of
  `ANALYSIS.md` (script comparison of the built HTML against the file).
- The model against the code (D5.2): the hand-checked sequence txg by txg; a block born in
  the txg of a snapshot (held by it, deadlist entry on a later kill, 20 > 20 false); a block
  killed in the txg of a snapshot (not in it); an overwrite inside a clone (shared blocks to
  the clone's entry 1, the clone's own freed, `fs` untouched); snapshot destroy (entries at
  or above the snapshot's `ds_prev_snap_txg` freed, its deadlist merged, its key removed
  from the head and from a younger clone); and over 12,000 random txgs, no block freed while
  referenced, none leaked, owner range = actual references.
- The same sequences replayed in the page by `verify.mjs`, FR and EN at 390 and 1440 px,
  read back from the DOM: write D and snapshot in txg 11 (`fs@s2` holds D11, R10 freed);
  overwrite D in txg 12 (D11 and R11 to `fs`'s entry 9, nothing freed); clone `fs@s1`, then
  overwrite B in the clone (B8 and R8 to the clone's entry 1); destroy `fs@s2` (D11 and R11
  freed, A8 and R8 merged into `fs`'s entry 1, `ds_prev_snap_txg` of `fs` back to 9). Each
  equals the model's tests.
- `scripts/verify.mjs`: 140 captures, 0 console errors or warnings, 0 page errors,
  0 failed requests. Keyboard only (FR and EN, 1440 px): 76 tab stops on the room, all
  with a visible focus ring; Write D, snapshot, sync, select D11, overwrite, sync, all by
  Tab and Enter. Reduced motion: the sync and its log complete in 66 ms, 0 running
  animations. No JS: the opening state (`fs`, `fs@s1`, 10 blocks) and its text version are
  in the page, controls hidden. Previous/next: … → RAID-Z → Snapshots and clones, then the
  end-of-visit note, the same in FR.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-5`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/snapshots/` | 96 | 100 | 78 (100) | 100 | 2.3 s | 2.3 s | 0 ms | 0.007 | 18.3 KB | 248 KB |
| `/fr/instantanes/` | 95 | 100 | 78 (100) | 100 | 2.4 s | 2.4 s | 0 ms | 0.037 | 18.3 KB | 252 KB |

Best practices is 78 on the preview URL itself because of two audits only, `is-on-https`
and `redirects-http`: the private preview is plain HTTP on a LAN address, by design
(D-R1). The same server reached through a loopback TCP relay (127.0.0.1, a secure context
for Chrome; same server, same bytes) scores 100, with the other three categories and every
timing unchanged. The preview's server does not compress: the room's script is 17.3 KB
raw, 6.1 KB gzipped, plus the shared 0.6 KB helper.

**Not done, and known limits**

- The model's scope (D5.2): one filesystem, four snapshots at most, one clone that cannot
  be snapshotted or destroyed, the metadata path drawn as one root block, frees from
  `dp_free_bpobj` drawn at once; no space accounting, livelists, bookmarks, promote, holds,
  deferred destroy or old-format deadlists. The page says so.
- What happens to two writes of one block in one txg is not in the code basis; the figure
  refuses a second change to a pending block instead.
- No screen-reader session yet (slice 13).

## Slice 6: The ARC room (2026-10-19)

Issue ALG-87. Branch `slice-6-arc`, from `main` at `0d402ae`.

**Done**

- The ARC room, EN (`/en/arc/`) and FR (`/fr/arc/`): the problem (one scan wipes an LRU
  cache; an LFU cache never forgets yesterday's hot set); one idea (MRU and MFU, ghost lists
  that keep the headers of evicted blocks, ghost hits that move the balance); the figure;
  the explanation in one sentence, one paragraph and in detail, with seven annotated
  excerpts of `arc.c` at `zfs-2.4.4` (`arc_access` L5398-L5428 and L5429-L5449,
  `arc_evict_hdr` L3876-L3891, `arc_evict` L4527-L4556, L4558-L4587 and L4479-L4497,
  `arc_evict_adj` L4405-L4442), a worked example of one ghost hit, when eviction runs and
  what moves `arc_c`; an L2ARC coda (the design comment, L8261-L8274); what the figure leaves
  out. No text uses `arc_p` as current. Opened in the visit: Hall map link, Snapshots and
  clones → The ARC in both languages, language switch keeps the page.
- The figure (D6.2, D6.3): MRU ghost, MRU, MFU and MFU ghost as lists from head to tail, a
  "Forgotten" tray, a gauge of `arc_c` (16 blocks of 128 KiB) with the MRU target, `arc_pd`
  and the ghost-hit counters. The visitor reads a new block, scans 12 new blocks, reads the
  hot set again or selects any block (cached, ghost or forgotten), one second or 10 ms
  after the previous action. Each read's outcome, each eviction pass (ghost hits, `arc_pd`
  before and after, which list gives up its tail), each eviction to a ghost list and each
  trim is logged with a link to its code; blocks slide to where they go. The opening state
  (the hot set in MFU), its text version and the legend are rendered at build time
  (readable without JavaScript); reduced-motion path; keyboard operable.
- `src/lib/arc.ts` (model, a transcription of `arc_access`, `arc_evict`, `arc_evict_adj` and
  `arc_evict_hdr`, data blocks only), `src/lib/arc-view.ts` (HTML, shared by build and
  browser), `src/components/ArcLab.astro`.
- `ANALYSIS.md`, room The ARC (D6.1): six new excerpts, line references for list order,
  the read path, when eviction runs, `arc_c` and the L2ARC feed, "What the animation shows"
  rewritten to match the figure, two facts and a hand-checked sequence.
- `scripts/test/arc-model.test.mjs`: 12 tests. `scripts/verify.mjs` covers the room.
- `Base.astro`: Inter's Latin file is preloaded (D6.6), which removed a layout shift.

**Checked** (local build and the private preview `uberblok-slice-6`, Chromium headless)

- `npm test`: 68 of 68 pass (56 before, 12 new). `npm run build`: `astro check` 0 errors,
  0 warnings, 0 hints; 16 pages; FR typography 7 files, 0 failures.
- Permalinks: `ANALYSIS.md` 55 excerpts, 680 line references, 0 failures; built HTML 0
  failures. Source check: 40 entries, 80 references in 16 pages, 0 problems. Every one of
  the 59 code links on each room page is a range inside a permalink of `ANALYSIS.md`
  (script comparison of the built HTML against the file).
- CI on the branch head: build, permalink check, source check and all unit tests green,
  deploy skipped.
- The model against the code (D6.2): the hand-checked sequence step by step, including the
  QA cases: a scan of 12 blocks over the hot set (S1 and S2 to the MRU ghost list, H1-H6
  stay in MFU, first pass without adjustment since `total < 32`); an MRU-ghost hit (S2 to
  MFU, `arc_pd` 2^31 → 2^31 + 2^27, 50 % → 53.125 %, MRU target 8 → 8.5 blocks, S3 evicted);
  an MFU-ghost hit (H1 back to MFU, `arc_pd` back to 2^31, H2 to the MFU ghost list); a
  re-read 10 ms and exactly 62 ms after `b_arc_access` stays in MRU without refreshing it,
  63 ms promotes. `arc_evict_adj` on seven hand-computed cases. Over 300 random sequences
  of 80 actions: every transition as `arc_access`, no pass on a hit, `arc_pd` never down on
  MRU-ghost hits alone and never up on MFU-ghost hits alone, never over `arc_c`, ghost
  lists within their caps.
- The same sequence replayed in the page by `verify.mjs`, FR and EN at 390 and 1440 px:
  every list, the forgotten tray and `arc_pd` read back from the DOM after each of 12 steps
  equal the model's; 0 mismatches. The 10 ms re-read of a new block stays in MRU, the read
  a second later promotes it.
- `scripts/verify.mjs` on the preview: 167 captures, 0 console errors or warnings, 0 page
  errors, 0 failed requests. Keyboard only (FR and EN, 1440 px): 76 tab stops on the room,
  all with a visible focus ring; scan, read S2, read a new block, switch to 10 ms with the
  arrow keys, read it again, all by Tab, Enter and arrows. Reduced motion: a scan and its
  log complete in 83 ms, 0 running animations. No JS: the opening state (H1-H6 in MFU,
  `arc_pd` 50 %) and its text version are in the page, controls hidden. Previous/next:
  … → Snapshots and clones → The ARC, then the end-of-visit note, the same in FR.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-6` at `e6a2662`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/arc/` | 96 | 100 | 78 | 100 | 2.1 s | 2.4 s | 0 ms | 0 | 10.0 KB | 246 KB |
| `/fr/arc/` | 96 | 100 | 78 | 100 | 2.1 s | 2.4 s | 0 ms | 0 | 10.0 KB | 250 KB |

Best practices is 78 because of two audits only, `is-on-https` and `redirects-http`: the
private preview is plain HTTP on a LAN address (ruled on ALG-71; the HTTPS check moves to
slice 13). The preview's server does not compress: the room's script is 9.2 KB raw, 4.0 KB
gzipped, plus the shared 0.6 KB helper (0.4 KB gzipped). Before D6.6 the same pages gave
Perf 91 and 94, CLS 0.111 and 0.057.

**Not done, and known limits**

- The model's scope (D6.2): data blocks only, all 128 KiB and uncompressed (no metadata
  lists, so `arc_meta` and `arc_pm` are not drawn); one list per state (exact order of last
  release, where the code's sublists give an approximate one); one eviction pass right
  after each miss, as soon as the cache is over `arc_c`; `arc_c` fixed; no prefetch, no
  uncached or dirty buffers, no L2ARC in the figure. The page says so.
- The L2ARC is a coda of text and one excerpt, not in the figure (P2).
- No screen-reader session yet (slice 13).

## Slice 7: Metaslabs and space maps room (2026-10-19)

Issue ALG-91. Branch `slice-7-metaslabs`, from `main` at `3a0792b`.

**Done**

- The Metaslabs and space maps room, EN (`/en/metaslabs/`) and FR (`/fr/metaslabs/`): the
  problem (copy-on-write allocates on every write; a whole-pool bitmap is 512 MiB for 16 TiB
  and would be rewritten in place); one idea (vdevs cut into metaslabs, a free tree in
  memory, an append-only space map of ALLOC and FREE extents, condensed when too long); the
  figure; the explanation in one sentence, one paragraph and in detail, with ten annotated
  excerpts at `zfs-2.4.4` (`metaslab_block_alloc`, `metaslab_df_alloc`, `metaslab_sync`,
  `space_map_write_impl`, the entry layouts of `space_map.h`, `space_map_write_seg`,
  `metaslab_sync_done`, `space_map_load_callback`, `metaslab_should_condense`,
  `metaslab_condense`); a coda on the log space map; what the figure leaves out. Opened in
  the visit: Hall map link, The ARC → Metaslabs and space maps in both languages, language
  switch keeps the page.
- The figure (D7.2, D7.3): a vdev of 8 GiB cut into 16 metaslabs of 512 MiB; metaslab 2 as
  a bar (free, allocated, allocated or freed in the open txg, deferred with the txg it comes
  back at, the dynamic-fit cursor); the in-core trees; the files; the space map as a tape of
  64-bit words, each a button; the selected entry bit by bit; the two tests of
  `metaslab_should_condense`. The visitor writes 4, 32 or 160 MiB, deletes a synced file,
  syncs, rewrites a 64 MiB database (128 random blocks per txg, up to 40 txgs, stopping
  before a sync that condenses), loads (drawn as a replay) and condenses (refused with its
  reasons, or the sync that condenses). Every step is logged with a link to its code. The
  opening state (A and B synced in txgs 10 and 11), its text version and the legend are
  rendered at build time; reduced-motion path; keyboard operable, arrows along the tape.
- `src/lib/metaslab.ts` (model), `src/lib/metaslab-view.ts` (HTML and SVG, shared by build
  and browser), `src/components/MetaslabLab.astro`.
- `ANALYSIS.md`, room Metaslabs and space maps (D7.1): eleven new excerpts, line references,
  "What the animation shows" rewritten, three facts, a hand-checked sequence with every word
  in hexadecimal.
- `scripts/test/metaslab-model.test.mjs`: 19 tests. `scripts/verify.mjs` covers the room.
- Carried over from QA on ALG-87 (D7.4): French counts singular for 0 and 1 in the ARC
  figure, including "au plus {n}" under the ghost lists; no elision before a code name.

**Checked** (local build and the private preview `uberblok-slice-7`, Chromium headless)

- `npm test`: 87 of 87 pass (68 before, 19 new). `npm run build`: `astro check` 0 errors,
  0 warnings, 0 hints; 18 pages; FR typography 8 files, 0 failures.
- Permalinks: `ANALYSIS.md` 66 excerpts, 735 line references, 0 failures; built HTML 758
  line references, 0 failures. Source check: 40 entries, 80 references in 18 pages, 0
  problems. Each of the 66 code links on each language page of the room is a range inside a
  permalink of `ANALYSIS.md` (script comparison of the built HTML against the file).
- CI on the branch head: build, permalink check, source check and all unit tests green,
  deploy skipped (run linked in the hand-off comment).
- The model against the code (D7.2), by the unit tests: words against the `space_map.h`
  macros (`0x0000000000001FFF`, `0x00000000200003FF`, `0x0000000000009FFF`, the two-word
  `0xC000009FFF000000` / `0x0000000000002400`, debug `0x800400000000000A`; `SM_NO_VDEVID`
  masked to 0); the hand-checked sequence word by word: a write then a delete (FREE entry,
  the space deferred until the end of the sync of txg 14), a 160 MiB run (40960 units >
  `SM_RUN_MAX`) as one two-word entry, dynamic fit past A's hole then the size fallback to
  it, a condense refused at 96 bytes (twice the optimal 32 but not over 65,536), the
  condensed map's 13 words and its replay; the condense test on hand-built trees; padding
  before a two-word entry on a block's last word; 200 random sequences (accounting, replay =
  free tree plus deferred frees, `smp_alloc`, decoding).
- The same sequences in the page by `verify.mjs`, FR and EN at 390 and 1440 px: a write then
  a delete, the two-word entry, a refused condense, a load ("the same tree as before"), the
  rewrites up to an accepted condense (66,432 → 3,376 bytes), a load after it; every word
  drawn on the tape after each step equals the model's: 0 mismatches.
- `scripts/verify.mjs` on the preview at `58e0499`: 194 captures, 0 console errors or
  warnings, 0 page errors, 0 failed requests. Keyboard only (FR and EN, 1440 px): 99 tab
  stops on the room, all with a visible focus ring; delete A, sync, select an entry and move
  along the tape with the arrow keys, all by Tab, Enter and arrows. Reduced motion: a load
  completes in 81 ms, 0 running animations. No JS: the opening tape (four words), the
  selected entry's bits and the text version are in the page, controls hidden.
  Previous/next: … → The ARC → Metaslabs and space maps, then the end-of-visit note, the
  same in FR; the Hall map links the room in both languages.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-7` at `14fa7b2`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/metaslabs/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0 | 22.6 KB | 301 KB |
| `/fr/metaslabs/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0 | 22.6 KB | 305 KB |

Best practices is 78 because of `is-on-https` and `redirects-http` only (the preview is
plain HTTP on a LAN address; ruling on ALG-71, HTTPS check at slice 13). The preview's
server does not compress: the room's script is 21.5 KB raw, 8.4 KB gzipped, plus the shared
0.6 KB helper (0.4 KB gzipped). A first run gave Accessibility 96 (the tape's accessible
names did not start with their visible text, and the bit ranges were at 4.27:1 in dark);
fixed in `14fa7b2`.

**Code review before QA** (`code-reviewer` subagent on the whole diff): encoding, condense
test, dynamic fit and replay found faithful; two bugs in the rewrite workload, fixed in
`58e0499` with a regression test each: the txg range it reported was one low when the open
txg had pending changes, and right after "Delete db" it ran 40 empty txgs instead of
writing db again. It now syncs pending changes before it starts.

**QA round 1** (review on ALG-91, head `d3858e1`; fixes in `e65a78d` and `ee78c09`)

- French counts that bypassed the helper are fixed (« et 1 autres », « 1 entrée rejouées »,
  « 0 octet libres », the padding words, `smp_length`, the cursor picks, the rewrite range),
  plus English "1 padding word"/"txgs 13 to 13" (D7.4). The strings moved to
  `src/lib/metaslab-strings.ts`; `scripts/test/metaslab-view.test.mjs` (6 tests) draws every
  log line with counts 0, 1 and 2 in both languages, and checks keys and placeholders.
- Dynamic fit: "16 MiB past the first candidate, and always at least 100 segments"
  (metaslab.c L1786-L1787, L199), in both pages and in ANALYSIS.md; condense only when the
  metaslab is loaded (L4363-L4364); metaslabs fewer and smaller on small vdevs; the
  `ePickMixed` reasons complete; FR « en plus court », « en cas de retour à un uberblock
  antérieur », « longueur − 1 ».
- The rewrite workload's figures (about 70 txgs, 189 segments, optimal 1,528 bytes, condensed
  to 3,256 bytes from the opening state) are in ANALYSIS.md and pinned by a model test.
- `npm test`: 99 of 99. CI green on `ee78c09`. `verify.mjs` on the preview at `ee78c09`: 194
  captures, 0 console errors, 0 mismatches. Lighthouse 13.5.0 on the same head, both pages:
  94 / 100 / 78 / 100, Best practices only `is-on-https` and `redirects-http`.
- `code-reviewer` pass on the fix diff: found the English "txgs 13 to 13" and the summary's
  byte count; both fixed in `ee78c09`.

**Not done, and known limits**

- The model's scope (D7.2): no log space map (the 2.4.4 default; the page has a coda on
  it), one metaslab, one txg in flight synced in one pass, 128 KiB blocks only, no metaslab
  selection, throttling, gang blocks, ditto copies, checkpoint, trim or histogram. The page
  says so.
- The tape draws at most 32 entries (the first three and the last 29 of a long map); the
  text version lists the last eight words.
- No screen-reader session yet (slice 13).

## Slice 8: ZIL and SLOG room (2026-10-19)

Issue ALG-96. Branch `slice-8-zil`, from `main` at `f4b60e5`. First slice built on the
second build machine (previous slices: the first one).

**Set up on the new build machine**

- `algotitanhq/uberblok` cloned, OpenZFS beside it in `../openzfs`
  (blobless clone) at tag `zfs-2.4.4`, checked: `71a9f9578616a90c3c14bb59629fb4d31bfd68d1`.
- Toolchain found in place: Node 24.22.0 and npm 11.19.1 (the repository asks for Node 22
  or later; `.nvmrc` says 22, the build machine's `preview` script installs it through nvm for the preview
  build), Playwright 1.64.1 with Chromium 156.0.8078.4 already in `~/.cache/ms-playwright`
  (it launches without missing libraries). Gap: no Lighthouse installed; run as
  `npx lighthouse@13.5.0` with `CHROME_PATH` set to Playwright's Chromium, the version used
  since slice 0. `npm ci`, `npm test` (99 tests) and `npm run build` passed on the clean
  clone before any change.

**Done**

- The ZIL and SLOG room, EN (`/en/zil/`) and FR (`/fr/zil/`): the problem (`fsync()` must
  return once the data is stable; a txg syncs every few seconds; a txg per `fsync()` would
  rewrite large parts of the tree); one idea (a per-dataset intent log of records, written
  at once, thrown away when the txg syncs, read only after a crash; a SLOG gives it a home);
  the figure; the explanation at three depths, with nine annotated excerpts at `zfs-2.4.4`
  (`zil_write_state`, `zil_commit_impl`, `lwb_state_t`, `zil_lwb_assign`,
  `zil_lwb_write_issue`, `zio_alloc_zil`, `zil_sync`, `zil_claim`,
  `zil_replay_log_record`); what the figure leaves out. Opened in the visit: Hall map link,
  Metaslabs → ZIL and SLOG in both languages, language switch keeps the page.
- The figure (D8.2, D8.3): toggles for the log device (none, SLOG, SLOG full), `logbias`,
  `O_DSYNC`, `O_DIRECT` and the size (4, 16, 48, 128 KiB), with a panel that runs
  `zil_write_state` for them and lists the deciding lines; `write()`, `fsync()`, Sync txg,
  Power cut, `zpool import`, `zfs mount`. The file's writes with their state and status;
  in memory the waiting itxs and each lwb with its seven states, fill and records; on disk
  `zil_header_t`, the chain from `zh_log` and the devices (SLOG, embedded log, data written
  in place, freed blocks greyed). A commit is drawn step by step; reduced-motion path;
  keyboard operable; text version; the opening state rendered at build time.
- `src/lib/zil.ts` (model), `src/lib/zil-view.ts` (HTML, shared by build and browser),
  `src/lib/zil-strings.ts`, `src/components/ZilLab.astro`.
- `ANALYSIS.md`, room ZIL and SLOG (D8.1): seven new excerpts, line references, "What the
  animation shows" rewritten, the write state for every case of the figure, hand-checked
  cases.
- `scripts/test/zil-model.test.mjs` (15 tests) and `scripts/test/zil-view.test.mjs`
  (11 tests); `scripts/verify.mjs` covers the room.

**Checked** (local build and the private preview `uberblok-slice-8`, Chromium headless)

- `npm test`: 125 of 125 pass (99 before, 26 new). `npm run build`: `astro check` 0
  errors, 0 warnings (1 hint, in the slice 7 view test); 20 pages; FR typography 9 files,
  0 failures.
- Permalinks: `ANALYSIS.md` 73 excerpts, 775 line references, 0 failures; built HTML 956
  line references, 0 failures. Source check: 40 entries, 80 references in 20 pages, 0
  problems.
- The model against the code (D8.2), by the unit tests: the 96 combinations of log
  device × `logbias` × size × `O_DSYNC` × `O_DIRECT` against a table written by hand from
  `zil_write_state`, `zfs_log_write` and `zfs_setup_direct`; boundaries (32,767 / 32,768
  bytes, half a block, 7680 / 7681); the class order with every fallback; the hand-checked
  cases event by event (4 KiB `fsync()` without SLOG: block b1 then b2 in the embedded
  log, `fsync()` returning after flush done; crash: claim txg 100, 2 blocks, 1 record,
  replayed; sync then crash: claim txg 101, 1 block, nothing replayed, b2 kept and reused;
  128 KiB without SLOG: one 192-byte WR_INDIRECT record; with a SLOG: 130,696 + 376 bytes
  in two lwbs, blocks b1-b3 on the log class); 300 random sequences (replay = the logged
  writes of unsynced txgs, exactly).
- The same sequences in the page by `verify.mjs`, FR and EN at 390 and 1440 px, with
  motion: small sync write then crash, sync then crash, large write with and without SLOG,
  `logbias=throughput` with `O_DSYNC`, a write without `fsync()` then crash; after every
  step the writes' states and statuses, the header and the chain drawn equal the model's:
  0 mismatches. The decision panel for all 96 combinations, EN and FR: 0 mismatches.
- `scripts/verify.mjs` on the preview at `57444d6`: 249 captures, 0 console errors or
  warnings, 0 page errors, 0 failed requests. Keyboard only (FR and EN, 1440 px): 109 tab
  stops, all with a visible focus ring; SLOG, 128 KiB, `write()`, `fsync()`, power cut,
  import, mount by Tab and Enter, focus moving to the next step each time; the write ends
  replayed. Reduced motion: `fsync()` of the split write completes in 55 ms, 0 running
  animations. No JS: the decision panel (WR_NEED_COPY, two reasons) and the text version
  are in the page, controls hidden. Previous/next: … → Metaslabs and space maps → ZIL and
  SLOG, then the end-of-visit note, the same in FR; the Hall map links the room in both
  languages.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-8` at `57444d6`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/zil/` | 95 | 100 | 78 | 100 | 2.2 s | 2.4 s | 0 ms | 0.001 | 23.3 KB | 286 KB |
| `/fr/zil/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0 | 23.3 KB | 291 KB |

Best practices is 78 because of `is-on-https` and `redirects-http` only (plain HTTP on a
LAN address; ruling on ALG-71, HTTPS check at slice 13). The preview's server does not
compress: the room's script is 22.3 KB raw, 8.1 KB gzipped.

**Code review before QA** (`code-reviewer` subagent on the whole diff): the transcription
was found faithful on the write state, class order, packing, lwb states, `zil_sync`, claim
counts and replay filters; it found that a short `O_DIRECT` write is not Direct I/O
(`zfs_setup_direct`), that a log with nothing to replay keeps its first block
(`zil_destroy(keep_first)`), that the 128 KiB block size had to be stated, plus frames
showing the header and waiter early, FR thousands with a breakable space, toggles silently
ignored during a commit, and live-region gaps. All fixed in `57444d6` (D8.2, D8.3), with
tests.

**Not done, and known limits**

- The model's scope (D8.2): every log block after a chain's first (4 KiB) is 128 KiB, one file and one writer, writes at
  block starts in a file of 128 KiB blocks, one txg in flight, no I/O error, no special
  vdev on the page, no `zil_slog_bulk`, Slim ZIL layout or encryption. The page says so.
- The figure lists the last eight writes and the last five lwbs.
- No screen-reader session yet (slice 13).

### Slice 8, QA round 1 (2026-10-19)

QA's review of `3cadc92`: 3 blockers, 3 shoulds, 6 nits, all fixed.

- **Blocker 1, the first commit on a new log.** On a hole `zh_log`, `zil_create` allocates
  a 4 KiB block and waits for the open txg to sync (zil.c L1011-L1056); the itxs of that txg
  are then destroyed as synced (L3209, L3280-L3283) and only the commit waiter goes into
  lwb 1. The model now does this, and the page says so in EN and FR. QA's scenarios run on a
  chain that a first `fsync()` has created; after every replay the wait comes back (D8.2).
- **Blocker 2**: "With a SLOG, unless `logbias=throughput` or Direct I/O, the data always
  goes into the log." **Blocker 3**: rebased on `main` (`fc988c9`); the README conflict is
  resolved with seven rooms listed.
- **Shoulds**: the "leaves out" section now says only later blocks are 128 KiB and the byte
  counts are those of 128 KiB blocks; the tests are hand-derived from the code (the first
  commit as a full event list, the commit on an existing chain, a crash right after the
  first commit, the wait after a replay, the kept block reused without a wait); the lwb step
  labels use `--fg-muted`.
- **Nits**: `dmu_sync` drawn before READY; `lostLwbs` removed; the `zil_parse` link is
  L499-L572; "(no special vdev)" on the embedded-log fallback; pool toggles disabled after a
  crash; `logbias=throughput` still takes the log block from the SLOG (zio.c L4561-L4565).
- Found while deriving the cases: the commit itx opens the lwb (L2301), so a waiter-only
  lwb goes through OPENED. The `code-reviewer` pass on the fix found the write row still
  said "in memory" after the txg sync during the animation; fixed, with a test.

**Verification** (head `c696cd9`; the code is the same at the final head)

- `npm test`: 128 of 128 (zil model 17, zil view 12). Build: 20 pages, FR typography 0
  failures. Permalinks: `ANALYSIS.md` 73 excerpts and 786 line references, dist 972, 0
  failures. Sources: 0 problems.
- `scripts/verify.mjs` on a local server of the build: 277 captures, 0 console errors.
  There are seven ZIL sequences (the first commit then a crash, plus QA's five on an existing
  chain, plus a write without `fsync()`), each in EN and FR at 390 and 1440 px. After every
  step, the page and the model show the same thing: 0 mismatches. The decision panel shows
  96 combinations in each language, with 0 mismatches. The keyboard walk covers 115 stops,
  all with visible focus, and focus follows import and mount. Reduced motion and no-JS pass.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling, private preview at `c696cd9`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/zil/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0.001 | 24.0 KB | 291 KB |
| `/fr/zil/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0 | 24.0 KB | 296 KB |

Best practices 78: `is-on-https` and `redirects-http` only (ALG-71).

## Slice 9: send / receive room (2026-10-19)

Issue ALG-105. Branch `slice-9-send`, from `main` at `26ba533`. Built on the build machine.

**Done**

- The send / receive room, EN (`/en/send-receive/`) and FR (`/fr/send-receive/`): the
  problem (copying by comparing files reads everything to find what changed); one idea (the
  difference between two snapshots is read from logical birth txgs, unchanged subtrees are
  skipped whole, and the result is a stream of records that checks itself); the figure; the
  explanation at three depths with eight annotated excerpts at `zfs-2.4.4`
  (`send_traverse_thread`, `traverse_visitbp`, `traverse_dnode`, `send_cb` twice,
  `dump_record`, `receive_read_payload_and_next_header`, `receive_process_record`); what the
  figure leaves out. Opened in the visit: Hall map link, ZIL and SLOG → send / receive in
  both languages, language switch keeps the page.
- The figure (D9.2, D9.3): the history of `tank/fs` (four txgs, four snapshots), the tree of
  `@s4` with the logical birth of its 19 block pointers, the from-snapshot to choose (none,
  `@s1`, `@s2`, `@s3`), the birth test at each pointer with skipped subtrees faded, the
  stream of records with each `drr_checksum`, the receiver checking and dispatching each
  record until its files equal `@s4`'s, a flipped bit giving ECKSUM, the counters and a
  table of every from-snapshot. Play, Next step, Show the end, Start again; reduced-motion
  path; keyboard operable; text version; the finished stream from `@s2` rendered at build
  time.
- `src/lib/send.ts` (model), `src/lib/send-view.ts`, `src/lib/send-strings.ts`,
  `src/components/SendLab.astro`; `fletcher4Inc` added to `src/lib/fletcher4.ts`.
- `ANALYSIS.md`, room send / receive (D9.1): nine excerpts added, line references, the
  animation plan, facts and hand-checked cases rewritten; two claims corrected (birth-0
  holes are visited by default; what logical birth means for dedup and cloning).
- `scripts/test/send-model.test.mjs` (14 tests) and `scripts/test/send-view.test.mjs`
  (6 tests); `scripts/verify.mjs` covers the room.
- The private preview of `main` now runs on the new build machine (`preview up uberblok … main`); the
  slice 8 preview is down. The address is in the hand-off, not in the repository (D9.6).

**Checked** (local build and the private preview `uberblok-slice-9`, Chromium headless)

- `npm test`: 148 of 148 pass (128 before, 20 new). `npm run build`: `astro check` 0
  errors, 0 warnings; 22 pages; FR typography 10 files, 0 failures.
- Permalinks: `ANALYSIS.md` 82 excerpts, 810 line references, 0 failures; built HTML 1,084
  line references, 0 failures. Source check: 40 entries, 80 references in 22 pages, 0
  problems. CI on `61d20f9`: green, deploy skipped.
- The model against the code (D9.2), by the unit tests, from the hand-checked cases: births
  of `@s4`; every test is `birth > F` for every from-snapshot; visited / skipped / below
  19/0/0 (full), 14/5/0 (`@s1`), 12/3/4 (`@s2`), 3/3/13 (`@s3`); the four streams record by
  record (21, 16, 15 and 7 records; the two holes of b merged into one FREE; FREEOBJECTS 5
  to 7 merged); `drr_checksum` of each record recomputed from the bytes; the receiver ends
  with `@s4`'s files every time; a flipped bit stops it at record 4 with nothing kept.
- The same streams in the page by `verify.mjs`, FR and EN at 390 and 1440 px: for each
  from-snapshot (none, `@s1`, `@s3`, `@s2`), the record types drawn in the strip, the
  visited count and the verdict equal the model's (0 mismatches); the received files equal
  `@s4`'s; FREE records in every stream (4, 4, 4, 2). A flipped bit: ECKSUM at record 4,
  record 3 marked never applied, the receiver left as before. Mid-play captures after 9
  steps.
- `scripts/verify.mjs` on a local server of the build of `218dc17` without its last two
  details (record 3 marked never applied, table cells kept on one line; both checked by the
  view test and by captures in a real browser after the change, 0 console errors):
  294 captures, 0 console errors or warnings, 0 page errors, 0 failed requests. Keyboard
  only (FR and EN, 1440 px): 75 tab stops, all with a visible focus ring; from `@s3`, Start
  again, then Next step by Enter to the verdict, focus kept on the button. Reduced motion:
  Play shows the end in 70 ms, 0 running animations. No JS: the finished stream from
  `@s2` (15 records, the verdict, the table) is in the page, controls hidden.
  Previous/next: … → ZIL and SLOG → send / receive, then the end-of-visit note, the same in
  FR; the Hall map links the room in both languages.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-9`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/send-receive/` | 95 | 100 | 78 | 100 | 2.2 s | 2.4 s | 0 ms | 0 | 22.7 KB | 283 KB |
| `/fr/send-receive/` | 95 | 100 | 78 | 100 | 2.2 s | 2.4 s | 0 ms | 0 | 22.7 KB | 286 KB |

At `218dc17`. Best practices is 78 because of `is-on-https` and `redirects-http` only
(ALG-71). The first run (at `29118b4`) gave Accessibility 96: the "never read" chips used
opacity and failed contrast; fixed in `61d20f9`. The preview's server does not compress:
the room's script is 21.0 KB raw, 7.9 KB gzipped.

**Code review before QA** (`code-reviewer` subagent on the whole diff): the transcription
was found faithful for every stream of `@s4` (birth test, callback order, `send_cb`'s
ranges, merging and flushes, `dump_record`, the receiver's checks). It found a model branch
wrong for other target snapshots (a hole among the dnode blocks made a FREE of object 0
instead of FREEOBJECTS), the FREEOBJECTS line naming "3" instead of c, a failed receive
returning the damaged contents, the logical-birth sentence backwards, imprecise wording of
what `drr_checksum` covers, focus lost at the last frame, Play skipping frame 0, and two
tests that could pass for the wrong reason. All fixed in `29118b4`, with tests (D9.1, D9.3).

**QA round 1** (changes requested on `1f94ddf`, 1 BLOCKER, 5 SHOULD, 6 NIT): all twelve
fixed. The receiver's excerpt now ends on L2868, its final `receive_cksum`, in both pages,
`ANALYSIS.md` and D9.1; the intro says each record but BEGIN carries a sum and that the
receiver checks record by record; the note on L2861-L2866 says an all-zero sum is not
checked; the logical-birth text says "can be" as `spa.h` does; the receiver's END line
names `receive_read_record` and links to its END check, BEGIN's to the receiver's sum over
BEGIN; Play no longer rewrites the live line every frame (one announcement at its end,
checked in Chromium: one mutation of the live line per Play, EN and FR); with reduced
motion Play is `aria-disabled` at the end; FR « repart » replaced; the room's
`<noscript>` line says the static figure is the `@s2` stream; D9.2 counts 14 tests (D9.3).

**Not done, and known limits**

- The figure's scope (D9.2): one target snapshot (`@s4`), small sizes, one sequence instead
  of the send threads, the receive after the send; no redaction, raw, compressed or
  resumable streams. The page says so.
- "txg" is masculine in this room and the Snapshots room, feminine in the ZIL room; a
  site-wide alignment is left for later (D9.4).
- No screen-reader session yet (slice 13).

## Slice 10: Compression, dedup, encryption room (2026-10-19)

Issue ALG-106. Branch `slice-10-transforms`, from `main` at `37a3e81`. Built on the build machine.

**Done**

- The compression, dedup and encryption room, EN (`/en/compression-dedup-encryption/`) and
  FR (`/fr/compression-dedup-chiffrement/`): the problem (three features transform a block
  between the application and the disk, each with a cost paid on every write); one part per
  feature, each with its figure; the explanation at three depths with thirteen annotated
  excerpts at `zfs-2.4.4`; the honest cost of dedup (a lookup per write, entries that are a
  tiny part of a ZAP leaf, the log, the quota; no memory or ratio figure, since the code gives
  none); what the figures leave out. Opened in the visit: Hall map link, send / receive →
  this room in both languages, language switch keeps the page.
- **Compression figure** (D10.2, D10.3): data (four presets, or the compressor's output typed
  or dragged in bytes), block size (4, 8, 16, 128 KiB), ashift (9, 12, 13), compression (off,
  LZ4, ZLE); the block with its sectors, the seven-eighths line and the limit, the output
  against it, the sectors allocated; the branches of `zio_write_compress` with the one that
  decides; the block pointer's 16 words (hole and embedded included); the same data at every
  ashift.
- **Dedup figure**: Write A, B or C, one per txg; the DDT over its quota; the last write's
  lookup and outcome, the DDT with refcounts and physical births, the block pointers with
  their D bit, DVA and two births, the data blocks on disk with the pointers that reference
  them; counters of writes, lookups, blocks written and entries.
- **Encryption figure**: the 16 words of a block pointer for four kinds of block (not
  encrypted, encrypted, authenticated, indirect), the words that change highlighted; a small
  encrypted file (dnode block with its core in clear and bonus encrypted, indirect block in
  clear, three encrypted data blocks): key loaded or not, scrub, read, a bit flipped on disk.
- `src/lib/transforms.ts` (model), `src/lib/transforms-view.ts`,
  `src/lib/transforms-strings.ts`, `src/components/CompressLab.astro`, `DedupLab.astro`,
  `CryptLab.astro`, `src/styles/transforms.css`.
- `ANALYSIS.md`, room compression, dedup, encryption (D10.1): twelve excerpts added (4 to 15),
  line references, the animation plan, facts and hand-checked cases rewritten; read in the
  code and said on the page: over quota, existing entries are still found; the snap shows on
  small blocks only; zeros are detected only with compression or dedup on; an encrypted block
  is never embedded.
- `scripts/test/transforms-model.test.mjs` (14 tests) and
  `scripts/test/transforms-view.test.mjs` (6 tests); `scripts/verify.mjs` covers the room.
- Previews: `uberblok-slice-10` up, `uberblok-slice-9` down; the `main` preview on the build machine is on
  `37a3e81`. Addresses in the hand-off, not in the repository (D9.6).

**Checked** (local build and the private preview `uberblok-slice-10`, Chromium headless)

- `npm test`: 168 of 168 pass (148 before, 20 new). `npm run build`: `astro check` 0
  errors, 0 warnings; 24 pages; FR typography 11 files, 0 failures.
- Permalinks: `ANALYSIS.md` 94 excerpts, 837 line references, 0 failures; built HTML 1,246
  line references, 0 failures. Source check: 40 entries, 80 references in 24 pages, 0
  problems.
- The model against the code (D10.2), by the unit tests, from the hand-checked cases: the
  limit at 4, 8, 16, 128 KiB and ashift 9, 12, 13, ZLE unsnapped; the four outcomes with
  PSIZE and sectors (128 KiB at ashift 12: 13 sectors compressed, 32 uncompressed, 0 for a
  hole or an embedded block); ZLE reaching LSIZE after rounding; an encrypted 90-byte output
  not embedded; dedup miss, miss, hit, over quota, hit over quota, over quota again, with
  refcounts, DVAs and births; the 16 words of each kind of block pointer; the truncated
  comparison computed by hand on two words; scrub without the key, `EACCES`, a flipped bit.
- The same cases in the page by `verify.mjs`, FR and EN at 390 and 1440 px, against the
  model: compressible, already compressed, all zeros and almost empty data at 128 KiB and
  4 KiB, ashift 12 and 9 (32 runs, 0 mismatches); A, A, then over quota C, A, C (A refcount
  3, three blocks on disk, C twice with D=0); the encrypted block pointer (words 4, 5, b, e, f
  changed), the key unloaded, scrub (5 blocks verified), read (`EACCES`, no plaintext shown),
  a flipped bit (one checksum error, block 1).
- `scripts/verify.mjs` on the build of `fab3b0d`: 321 captures, 0 console errors or
  warnings, 0 page errors, 0 failed requests. Keyboard only (FR and EN, 1440 px): 111 tab
  stops, all with a visible focus ring; all zeros, compressible, an output typed in the number
  field, Write A, the key, Scrub, by Enter and Space: the expected outcomes, focus kept, six
  announcements for six actions, none ending with the "code" link. Reduced motion: 0
  running animations after actions. No JS: the three figures' first states in the page
  (compressed block, two DDT entries, 16 words), controls hidden. Previous/next: … →
  send / receive → this room, then the end-of-visit note, the same in FR; the Hall map links
  the room in both languages.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-10`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/compression-dedup-encryption/` | 93 | 100 | 78 | 100 | 2.4 s | 2.7 s | 0 ms | 0 | 22.1 KB | 348 KB |
| `/fr/compression-dedup-chiffrement/` | 91 | 100 | 78 | 100 | 2.6 s | 3.0 s | 0 ms | 0.001 | 22.1 KB | 357 KB |

At `fc9ac33`. Best practices is 78 because of `is-on-https` and `redirects-http` only
(ALG-71). The first run (at `fab3b0d`) gave Accessibility 99: the panels' `h4` followed an
`h2` (heading-order); they are `h3` since `fc9ac33`. The preview's server does not
compress: the room's own scripts (three figures, the shared view and model, `svg`,
`fletcher4`) are 21.0 KB raw, 9.0 KB gzipped.

**Code review before QA** (`code-reviewer` subagent on the whole diff): the model was found
faithful to `zfs-2.4.4` (limit, ZLE, zeros only with compression on, embedding conditions,
rounding, dedup miss / hit / over quota with existing entries still found, births, refcounts,
the `spa.h` layouts, the truncated comparison), and every number on the pages right. It
found two `verify.mjs` bugs (the check mark of a pressed button counted in its accessible
name, so an exact-name click timed out; the keyboard walk typed an output while "All zeros"
made the field inert), "after" sync pass 8 where the code says "from", a hole said to keep
its size unconditionally, the compression-off sentence missing the dedup exception, "MAC of
MACs" where the code says a checksum of the MACs, the zeros note never shown, a live region
that started `hidden` and read the "code" links, animations restarted while dragging, model
tests that checked the model against itself, verify not gating on announcements, focus, no-JS
and reduced motion, and three French agreements. All fixed in `fab3b0d` (D10.3).

**QA round 1** (changes requested on `2a8f799`, 2 BLOCKER, 6 SHOULD, 5 NIT): all thirteen
fixed. The intro and the paragraph depth now give the stage order of `zio_impl.h`
L135-L144: compression, encryption, checksum, then the dedup lookup by the checksum of the
ciphertext. A hole that replaces a block keeps LSIZE, type and level and is born in the
current txg (`zio.c` L2113), in both pages, the strings and `ANALYSIS.md`. With the key loaded,
the flipped block shows "fails its checksum" and no plaintext, with a unit test for it. The
dedup cost note says `auto` caps the table only with a dedup or special vdev, and that only
FDT tables get the log. FR has the cost sentence. "keeps a block compressed". The FR
wording and calques are fixed. Other fixes: "up to three copies", the hole and "saved
nothing" notes split, "with dedup" for the HMAC IV, and `L.gcd` linked. The unused links are
dropped. New facts in `ANALYSIS.md`, Facts for the text. A `code-reviewer` pass on this
round found the intro claimed the room follows the pipeline order while its sections do not;
reworded in both languages, with three French nits.

**Not done, and known limits**

- The figures' scope (D10.2): compressor outputs are inputs; one ashift, plain disks; dedup one
  block per txg with `copies=1`, no verify; stand-in ciphertext, salt, IV and MAC. The page
  says so.
- The check mark of pressed buttons in the older rooms still counts in their accessible name
  (`content: "✓ "`); fixed in this room only, a site-wide fix is left for later (D10.3).
- "txg" stays masculine in this room, as in send / receive (D9.4 debt unchanged).
- No screen-reader session yet (slice 13).

## Slice 11: The vdevs room, first 3D room (2026-10-19)

Issue ALG-107. Branch `slice-11-vdevs`, from `main` at `b0964b8`. Built on the build machine.

**Done**

- The vdevs room, EN (`/en/vdevs/`) and FR (`/fr/vdevs/`): the problem (a pool nests mirrors,
  RAID-Z, dRAID, log, special, dedup, spares and replacements in any combination, and the I/O
  path must not grow a case per combination); the answer, a tree of `vdev_t` whose type is the
  ops table it points to; one part per idea (the tree, classes, the I/O walk, replacements);
  one figure; the explanation at three depths with excerpts at `zfs-2.4.4`. Opened in the
  visit between Transaction groups and RAID-Z (D11.6), Hall map link, language switch keeps
  the page.
- **The figure** (D11.2, D11.3): the tree from `spa_root_vdev` to the leaves, hot spare,
  distributed spare and cache beside it; each node's ops table; options log, special, dedup,
  `special_small_blocks` 0 or 16 KiB, special under 75%, over 75% or full; five kinds of block
  (ZIL, metadata, DDT, small, large) landing in their class with the decision steps and DVAs;
  the write and "Read it back" walking down the tree, fanning out per node type (mirror,
  raidz, dRAID by its permutation rows, distributed spare redirected); replace with a new disk,
  the hot spare or the distributed spare, then "Resilver done" (replacing collapses, spare
  stays).
- **3D** (D11.4): the same tree in Three.js, loaded by dynamic import only on this page, when
  the figure comes into view or on the "3D" button; the static page and the SVG 2D view come
  first and stay when WebGL is absent or reduced motion is set. `src/lib/lazy3d.ts` is the
  loader slice 12 reuses.
- `src/lib/vdevs.ts` (model), `vdevs-view.ts`, `vdevs-strings.ts`, `vdevs-3d.ts`, `lazy3d.ts`,
  `src/components/VdevLab.astro`. `ANALYSIS.md`, room The vdevs: fourteen excerpts added (4 to
  17), facts and hand-checked cases (D11.1).
- `scripts/test/vdevs-model.test.mjs` (15 tests), `scripts/test/vdevs-view.test.mjs` (5);
  `scripts/verify-vdevs.mjs`, called by `scripts/verify.mjs`.
- Previews: `uberblok-slice-11` up, `uberblok-slice-10` down; the `main` preview on the build machine is on
  `b0964b8`. Addresses in the hand-off, not in the repository (D9.6).

**Checked** (local build and the private preview `uberblok-slice-11`, Chromium headless)

- `npm test`: 188 of 188 pass (168 before, 20 new). `npm run build`: `astro check` 0 errors;
  26 pages; FR typography 12 files, 0 failures.
- Permalinks: `ANALYSIS.md` 108 excerpts, 898 line references, 0 failures; built HTML 1,468
  line references, 0 failures. Source check: 40 entries, 80 references in 26 pages, 0 problems.
- The model against the code, by the unit tests, from the hand-checked cases: every kind's
  class without log, special, dedup, with them, with `special_small_blocks=16K` under 75%,
  over 75%, full; mirror, raidz (128 KiB and 4 KiB) and dRAID fan-out (groups 0, 1, 4, 5), the
  generated dRAID maps against their checksums; replace, hot spare, a replaced top-level disk,
  the distributed spare's redirection; spares refused under log, special and dedup; a block
  read back after a replacement.
- The same cases in the page by `verify-vdevs.mjs`, FR and EN, against the model: 136 runs, 0
  mismatches. `verify.mjs` over the whole site: 355 captures, 0 console errors, every room's
  replay 0 mismatches. 3D in SwiftShader: canvas drawn, no WebGL error. WebGL off: no 3D
  button, the note, the 2D tree, no 3D script fetched. Reduced motion: 3D not started, no
  animation running. No JS: the static tree (20 nodes, the last write lit). Keyboard: 129 tab
  stops per language, all with a visible focus, the figure driven by keys alone.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on
the private preview `uberblok-slice-11` at `c340ae1`)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/vdevs/` | 91 | 100 | 78 | 100 | 2.6 s | 2.9 s | 0 ms | 0.001 | 31.3 KB | 355 KB |
| `/fr/vdevs/` | 91 | 100 | 78 | 100 | 2.6 s | 2.9 s | 0 ms | 0 | 31.3 KB | 360 KB |

Best practices is 78 because of `is-on-https` and `redirects-http` only (ALG-71). Lighthouse
does not scroll to the figure, so its run is the page before the 3D import. The room's JS,
measured by `verify-vdevs.mjs` (uncompressed / gzipped): before the 3D import 30.7 KB /
12.2 KB; after it 577.0 KB / 147.8 KB (budget 3 MB). Other rooms' JS is unchanged, except
the RAID-Z room, whose `raidz.ts` became a chunk shared with this room (+80 bytes, one more
request; D11.4).

**Code review before QA** (`code-reviewer` subagent on the whole diff, then on the fixes): two
divergences from the code, fixed in `c1e0414`: the embedded log class listed the dedup vdev
(only normal and special vdevs get the embedded slog metaslab, vdev.c L1689-L1696), and a spare
could replace a log, special or dedup disk (refused by spa.c L8280-L8285, now `ANALYSIS.md`
excerpt 17). Also fixed: one 3D load at a time, "Read it back" keeps the last block after a
replacement (its DVAs follow the `vdev_id`), "Resilver done" says a spare node stays only when
one was waiting, and every disabled button says why (`c340ae1`), with the FR spare wording.

**Not done, and known limits**

- The figure's scope (D11.2): one pool shape; the allocator's choice of a vdev within a class,
  block sizes and fill levels are inputs; one replacement per disk; resilver order, progress
  and the sequential rebuild are not drawn; dRAID shown only as fixed permutations.
- No screen-reader session yet (slice 13).

**QA round 1** (review of `07a29f0`): fixed the two blockers, the embedded log group gets a
metaslab only on normal and special vdevs with more than 64 metaslabs (vdev.c L1689-L1697, said
in FR and EN, and in what the figure leaves out), and a spare node also ends when the original disk
is replaced (spa.c L9520-L9535, now in `ANALYSIS.md`), with `vdev_unspare` set by zed's online or a
cleared fault. Also: the copies cap (dmu.c L2542), the short dRAID column's skip sector
(vdev_draid.c L676-L683), "reads its only DVA" (tested), the FR wording, U+00A0 before %, "at
least 75%", the `vdev_add_parent` note pointing at spa_vdev_attach, unused links removed, and the
3D spares column spaced so labels clear the boxes. Rerun: build, 188 tests, permalinks (ANALYSIS
901 refs, dist 1486 refs, 0 failures), `verify-vdevs.mjs` 26 captures with 0 console errors, 136
runs with 0 mismatches, keyboard 138 stops; JS unchanged (12.2 KB gzip before 3D, 147.8 KB after).

## Slice 12: The tree and the uberblock room, and the Hall object in 3D (2026-10-19)

Issue ALG-108. Branch `slice-12-tree`, from `main` at `8241784`. Built on the build machine.

**Done**

- The tree and the uberblock room, EN (`/en/tree/`) and FR (`/fr/arbre/`): the problem (no fsck;
  after a crash the pool opens in the old or the new txg, never a mixture, so the change of state
  must come down to one small write that cannot destroy the previous state if torn); one idea per
  part (everything hangs from one pointer; a write copies its whole path; the commit in four beats;
  pull the plug, then import); one figure; the explanation at three depths with eleven excerpts at
  `zfs-2.4.4`. Opened in the visit between the History wing and Copy-on-write (D12.7), Hall map
  link, language switch keeps the page.
- **The figure** (D12.2, D12.3): a file's tree under the objset and the uberblock, D0 to D3 to
  write (the leaf and every ancestor copied, shared blocks once), spa_sync's write then the four
  beats of `vdev_config_sync` (flush, even labels, the uberblock into slot `txg % 128` of the four
  labels, odd labels), the root arrow swinging at beat 3; "Pull the plug" at any step, with 0 to 3
  uberblock writes landed in beat 3; "Import the pool" (the winner by `vdev_uberblock_compare`, the
  config label by `vdev_label_read_config`, cases (1) and (2)); the switch "The vdev configuration
  changes in this txg" (labels are written only for dirty vdevs), held on after an import (it marks
  every vdev dirty). The disk: four labels at their offsets on a 1 GiB disk, configs, rings.
- **3D** (D12.4): the same state in Three.js through the slice-11 loader, unchanged; the 2D page
  first and as the fallback. **The Hall object** (D12.5): the ring in 3D through the same loader,
  the 2D ring's script byte for byte unchanged.
- `src/lib/tree.ts` (model), `tree-view.ts`, `tree-strings.ts`, `tree-3d.ts`, `hall-3d.ts`,
  `src/components/TreeLab.astro`, `src/styles/tree.css`. `ANALYSIS.md`, room The tree and the
  uberblock: eight excerpts added (4 to 11), facts and hand-checked cases (D12.1).
- `scripts/test/tree-model.test.mjs` (11 tests), `scripts/test/tree-view.test.mjs` (6);
  `scripts/verify-tree.mjs`, called by `scripts/verify.mjs`.
- README status: the eleven open rooms (it still listed eight).
- Previews: `uberblok-slice-12` up, `uberblok-slice-11` down; the `main` preview on the build machine rebuilt on
  `8241784`. Addresses in the hand-off, not in the repository (D9.6).

**Checked** (local build and the private preview `uberblok-slice-12`, Chromium headless)

- `npm test`: 205 of 205 pass (188 before, 17 new). `npm run build`: `astro check` 0 errors; 28
  pages; FR typography 13 files, 0 failures.
- Permalinks: `ANALYSIS.md` 116 excerpts, 0 failures; built HTML 0 failures. Source check: 40
  entries, 80 references in 28 pages, 0 problems. CI green on the branch head.
- The model against the code, by the unit tests, from the hand-checked cases: slots for txgs 4083
  to 4338 at ashift 9 and 12, multihost; label and slot offsets on a 1 GiB disk; ancestors for
  `epbs` 10 and 1; a leaf write and a second one in the same txg; the four beats; the winner and
  the config label after a cut during each beat, beat 3 with 0 to 3 writes landed, config changed
  or not; the import's next txg and the label rewrite it forces; `vdev_uberblock_compare`'s tie.
- The same cases in the page by `verify-tree.mjs`, FR and EN, 390 and 1440 px, against the model:
  272 runs, 0 mismatches. `verify.mjs` over the whole site: 393 captures, 0 console errors, every
  room's replay 0 mismatches; previous/next: History → this room → Copy-on-write in both
  languages. 3D in SwiftShader (room and Hall): canvas drawn, no WebGL error. WebGL off: no 3D
  button, the note, the 2D views, no 3D script fetched (room and Hall). Reduced motion: 3D not
  started, no animation running (room and Hall). No JS: the static tree (14 blocks, 5 new, the
  arrow on the old objset). Keyboard: 94 tab stops per language, all with a visible focus; the
  figure driven by keys alone (a write, three steps, the landed count, the plug, the import, the
  3D view: 8 announcements); the Hall's 3D button and commit by keys.
- Layout shift when 3D opens by itself on desktop: 0.004 (room), Hall at load 0.0009 as on `main`.

**Measures** (Lighthouse 13.5.0, mobile, simulated throttling 150 ms RTT and 1.6 Mbit/s, on the
private previews: `uberblok-slice-12` at `31c23fe`, and `main` at `8241784` for the Hall before)

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TBT | CLS | JS transferred | Total transferred |
|---|---|---|---|---|---|---|---|---|---|---|
| `/en/tree/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 10 ms | 0.002 | 22.1 KB | 278 KB |
| `/fr/arbre/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 0 ms | 0.001 | 22.1 KB | 282 KB |
| `/en/` (Hall) | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 0 ms | 0 | 6.2 KB | 147 KB |
| `/fr/` (Hall) | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 0 ms | 0 | 6.2 KB | 148 KB |
| `/en/` (Hall, `main`) | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 0 ms | 0 | 2.2 KB | 142 KB |
| `/fr/` (Hall, `main`) | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 0 ms | 0 | 2.2 KB | 143 KB |

Best practices is 78 because of `is-on-https` and `redirects-http` only (ALG-71). The preview
serves files uncompressed. JS measured by `verify-tree.mjs` (uncompressed / gzipped):

- This room: before the 3D import 22.0 KB / 9.1 KB; after it 571.5 KB / 145.7 KB (budget 3 MB).
- The Hall: before the 3D import 5.6 KB / 3.0 KB, against 1.9 KB / 1.1 KB on `main` (the 2D
  ring's script unchanged, same file; added: the loader script and the shared `lazy3d` chunk,
  D12.5); FCP, LCP, TBT and CLS unchanged. After the import 551.8 KB / 138.2 KB.
- Other rooms' JS is unchanged, byte for byte, except the vdevs room: `lazy3d.ts` and Vite's
  preload helper moved from its chunk to one shared with this room and the Hall (+0.3 KB, one
  more request), and Three.js is now one chunk shared by the three 3D scenes (same bytes).

**Code review before QA** (`code-reviewer` subagent on the whole diff): no blocker; every outcome
and line reference checked against the code. Fixed in `31c23fe`: an import marks every vdev
dirty, so the next txg rewrites the four labels (spa.c L5721-L5736, L9757-L9769; spa_config.c
L489-L491; the model kept a torn label forever); the import's reason when the cut txg wrote no
label; a cut before spa_sync no longer says the blocks are on disk; two link ranges in
`ANALYSIS.md`; per-draw geometry freed in the 3D scenes; the Hall says so when 3D cannot start.
After reading the 3D captures: the labels of an old copy and of its new copy overlapped; the old
copy's label now stands beside its box (`tree-3d.ts`; 272 runs rerun, 0 mismatches, 0 console
errors).

**Not done, and known limits**

- The figure's scope (D12.2): one file, two pointers per indirect block, the meta-dnode's levels
  and the dataset hop folded; one disk at ashift 9; the writes of a beat land in a fixed order.
- The txg room's sentence on labels with no config change (D12.1), for the slice-13 pass.
- No screen-reader session yet (slice 13).

## Slice 13: audits, Engine room, v1 ready (2026-10-19)

Issue ALG-109. Branch `slice-13-audits`, from `main` at `408287e`. Built on the build machine.

**Done**

- **The Engine room**, EN (`/en/engine-room/`) and FR (`/fr/salle-des-machines/`), last stop of the
  visit and on the Hall map (D13.1): the code it reads (`zfs-2.4.4`, the full SHA linked, the CDDL
  attribution), what the site is made of (versions read from `package.json`), how it was built
  (analysis first, fourteen slices, a QA review per slice, the checks, the browser runs, the written
  decisions), the repository and the licences. The last room's "next" now says "End of the visit";
  the Hall no longer announces rooms in preparation.
- **Carried NITs of slice 12**: the 3D `objset` label of the new copy stands beside its box, out of
  the uberblock's arrow (`tree-3d.ts`); the txg room says labels are rewritten only on vdevs whose
  configuration changed, and the uberblock is then the only new thing in their labels (D12.1).
- **Proofreading** of every EN and FR text: EN by the `technical-writer` subagent (about 65
  wording edits: typographic apostrophes, `%`, KiB, run-ons); FR by me (txg masculine everywhere,
  about 120 replacements; elision before code names; U+00A0 before `%`; the `;` and `:` that the
  figures build at run time; singular for 0 and 1 in the RAID-Z, txg, ZIL and snapshot strings,
  with the EN singular too). Parity: the 14 page pairs have the same paragraphs, headings, excerpts,
  notes and permalinks in the same order. Meaning fixes, each checked against the code: the slot is
  `ub_txg` mod the number of slots (tree room, not "mod 128"); an lwb is freed when its block was
  allocated in this txg or earlier (`zil_sync` L4208-L4210); the clones whose origin is younger
  than the snapshot (`dsl_destroy.c` L230); `ECKSUM` compares the block pointer's checksum with the
  bytes read; RAID-Z's "too many missing" and `combrec` lines.
- **Accessibility fixes**: one live region and one announcement per action in the snapshots and
  metaslabs figures (three and two before); snapshot chips named from their visible text
  (`label-content-name-mismatch`); the three tables that scroll sideways on a phone are focusable,
  named regions (`scrollable-region-focusable`); the selected metaslab tape entry keeps a focus
  ring of its own (the selection outline hid it in the dark theme).
- **Repository ready to go public**: README (status v1, Deploy, Preview, the audit commands,
  licences), `LICENSE` (MIT); the secrets and privacy passes on every tracked file, findings below;
  process traces replaced by roles in tracked files (D13.3).
- `scripts/audit.mjs` (whole visit: axe-core in both themes, keyboard, chain, switch, reduced
  motion, live regions) and `scripts/lighthouse.mjs` (every page, the table below), axe-core 4.14.0
  as a pinned dev dependency (D13.2); `verify.mjs` covers the Engine room.
- Previews: `uberblok-slice-13` up, `uberblok-slice-12` down; the `main` preview on the build machine
  rebuilt on `408287e`. Addresses in the hand-off, not in the repository (D9.6).

**Checked** (local build, `astro preview`, and the private preview `uberblok-slice-13`; Chromium
headless)

- `npm test`: 205 of 205. `npm run build`: `astro check` 0 errors; 30 pages; FR typography 14
  files, 0 failures. Permalinks: `ANALYSIS.md` 116 excerpts, 916 line references, 0 failures; built
  HTML 1626 line references, 0 failures. Sources: 40 entries, 80 references in 30 pages, 0 problems.
- `verify.mjs` over the whole site: 401 captures, 0 console errors; every room's replay 0
  mismatches (tree 272 runs, ZIL 96 combinations per language, the others as before); keyboard
  drives of every figure pass, every stop with a visible focus.
- `audit.mjs`, 28 pages: 0 problems. axe-core (WCAG 2.2 A/AA, contrast included): 0 violations in
  dark and light at 1440 px and in dark at 390 px. `html lang`, one `h1` and a localized title on
  every page; the language switch goes to the same page in the other language everywhere; the
  previous/next chain runs Hall → History → … → Compression → Engine room in both languages, and
  the Hall map links all 14 stops. Keyboard: Tab stops per page from 19 (Engine room) to 139
  (vdevs), every stop with a focus ring that focus changes. Reduced motion: no endless animation
  and no canvas on any page. Live regions: one click on each figure's first control makes exactly
  one announcement (the 12 pages with a figure; History and the Engine room have none).
- No screen-reader session with a real reader (none on the build machine): the live-region and naming
  checks are automated only.

**Measures**

Lighthouse 13.5.0, mobile, simulated throttling (150 ms RTT, 1.6 Mbit/s: Lighthouse's "slow 4G"),
on the private preview `uberblok-slice-13` at `e8b747f` (plain HTTP, files uncompressed):

| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TTI | TBT | CLS | JS transferred | Total transferred | Audits missed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `/en/` | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 1.8 s | 0 ms | 0 | 6.2 KB | 147.3 KB | is-on-https, redirects-http |
| `/fr/` | 99 | 100 | 78 | 100 | 1.7 s | 1.8 s | 1.8 s | 0 ms | 0 | 6.2 KB | 148.1 KB | is-on-https, redirects-http |
| `/en/history/` | 98 | 100 | 78 | 100 | 1.8 s | 2.0 s | 2.0 s | 0 ms | 0.001 | 0.0 KB | 168.5 KB | is-on-https, redirects-http |
| `/fr/histoire/` | 98 | 100 | 78 | 100 | 1.8 s | 2.0 s | 2.0 s | 0 ms | 0 | 0.0 KB | 170.0 KB | is-on-https, redirects-http |
| `/en/tree/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0.002 | 22.1 KB | 278.0 KB | is-on-https, redirects-http |
| `/fr/arbre/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0.001 | 22.1 KB | 281.8 KB | is-on-https, redirects-http |
| `/en/copy-on-write/` | 98 | 100 | 78 | 100 | 1.8 s | 2.1 s | 2.1 s | 0 ms | 0.002 | 9.8 KB | 197.6 KB | is-on-https, redirects-http |
| `/fr/copie-sur-ecriture/` | 98 | 100 | 78 | 100 | 1.8 s | 2.1 s | 2.1 s | 0 ms | 0.001 | 9.8 KB | 200.1 KB | is-on-https, redirects-http |
| `/en/txg/` | 98 | 100 | 78 | 100 | 2.0 s | 2.1 s | 2.1 s | 0 ms | 0.001 | 9.4 KB | 222.4 KB | is-on-https, redirects-http |
| `/fr/txg/` | 97 | 100 | 78 | 100 | 2.0 s | 2.1 s | 2.1 s | 0 ms | 0 | 9.4 KB | 225.8 KB | is-on-https, redirects-http |
| `/en/vdevs/` | 91 | 100 | 78 | 100 | 2.6 s | 2.9 s | 2.9 s | 0 ms | 0.001 | 31.1 KB | 349.7 KB | is-on-https, redirects-http |
| `/fr/vdevs/` | 91 | 100 | 78 | 100 | 2.6 s | 2.9 s | 2.9 s | 0 ms | 0 | 31.1 KB | 354.4 KB | is-on-https, redirects-http |
| `/en/raidz/` | 97 | 100 | 78 | 100 | 2.0 s | 2.3 s | 2.3 s | 0 ms | 0.001 | 15.1 KB | 232.3 KB | is-on-https, redirects-http |
| `/fr/raidz/` | 97 | 100 | 78 | 100 | 2.0 s | 2.3 s | 2.3 s | 0 ms | 0 | 15.1 KB | 235.1 KB | is-on-https, redirects-http |
| `/en/snapshots/` | 96 | 100 | 78 | 100 | 2.0 s | 2.3 s | 2.3 s | 0 ms | 0.041 | 18.2 KB | 243.5 KB | is-on-https, redirects-http |
| `/fr/instantanes/` | 95 | 100 | 78 | 100 | 2.3 s | 2.5 s | 2.5 s | 0 ms | 0 | 18.2 KB | 246.8 KB | is-on-https, redirects-http |
| `/en/arc/` | 97 | 100 | 78 | 100 | 2.1 s | 2.3 s | 2.3 s | 0 ms | 0 | 10.0 KB | 246.6 KB | is-on-https, redirects-http |
| `/fr/arc/` | 97 | 100 | 78 | 100 | 2.1 s | 2.3 s | 2.3 s | 0 ms | 0 | 10.0 KB | 249.7 KB | is-on-https, redirects-http |
| `/en/metaslabs/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0 | 22.4 KB | 295.5 KB | is-on-https, redirects-http |
| `/fr/metaslabs/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0 | 22.4 KB | 299.1 KB | is-on-https, redirects-http |
| `/en/zil/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0.001 | 23.6 KB | 284.1 KB | is-on-https, redirects-http |
| `/fr/zil/` | 94 | 100 | 78 | 100 | 2.3 s | 2.6 s | 2.6 s | 0 ms | 0 | 23.6 KB | 288.9 KB | is-on-https, redirects-http |
| `/en/send-receive/` | 95 | 100 | 78 | 100 | 2.2 s | 2.4 s | 2.4 s | 0 ms | 0 | 22.3 KB | 278.4 KB | is-on-https, redirects-http |
| `/fr/send-receive/` | 95 | 100 | 78 | 100 | 2.2 s | 2.4 s | 2.4 s | 0 ms | 0 | 22.3 KB | 281.3 KB | is-on-https, redirects-http |
| `/en/compression-dedup-encryption/` | 92 | 100 | 78 | 100 | 2.6 s | 2.9 s | 2.9 s | 0 ms | 0 | 21.7 KB | 342.4 KB | is-on-https, redirects-http |
| `/fr/compression-dedup-chiffrement/` | 92 | 100 | 78 | 100 | 2.6 s | 2.9 s | 2.9 s | 0 ms | 0.001 | 21.7 KB | 351.8 KB | is-on-https, redirects-http |
| `/en/engine-room/` | 100 | 100 | 78 | 100 | 1.2 s | 1.7 s | 1.7 s | 0 ms | 0 | 0.0 KB | 130.8 KB | is-on-https, redirects-http |
| `/fr/salle-des-machines/` | 99 | 100 | 78 | 100 | 1.4 s | 1.8 s | 1.8 s | 0 ms | 0 | 0.0 KB | 131.5 KB | is-on-https, redirects-http |

All pages meet §12: Performance ≥ 90 (the two 3D rooms ≥ 80), Accessibility, SEO 100. Best
Practices is 78 only because of `is-on-https` and `redirects-http` (ALG-71).

**Best Practices over HTTPS** (D13.4): the branch head `e8b747f` served on the build machine by a local
HTTPS server with a self-signed certificate and gzip, Lighthouse with
`--ignore-certificate-errors` (`shots/`, not committed): **Best Practices 100 on all 28 pages**,
Performance 96 to 99, Accessibility and SEO 100, no audit missed. Through the HTTP listener that
redirects to HTTPS: `is-on-https` passes, `redirects-http` is not applicable on `localhost`. The
real check is the first public deploy.

**First interactive room under 2 s**: the Hall, first stop, is interactive at 1.8 s (TTI) over
HTTP; over HTTPS with gzip, 2.0 s, because the simulated TLS handshake costs round trips. The
other rooms: 1.7 to 2.9 s over HTTP uncompressed, 2.0 to 2.3 s over HTTPS with gzip. What remains
is the web fonts: the largest text is painted when the body font arrives. Inlining every
stylesheet was tried (no change: Hall 2.04 → 2.01 s, compression room 2.10 → 2.31 s) and dropped.
Cloudflare compresses with Brotli and serves over HTTP/2 or 3; the public deploy will tell.

**JS per room** (`verify.mjs`, uncompressed / gzipped; Lighthouse's column above is what the page
loads):

- The tree room: before the 3D import 22.0 KB / 9.2 KB; after it 571.7 KB / 145.8 KB.
- The vdevs room: before 31.0 KB / 12.6 KB; after 580.4 KB / 149.2 KB.
- The Hall: before 5.6 KB / 3.0 KB; after 551.8 KB / 138.2 KB.
- Every other room loads less than 25 KB; History and the Engine room load none. Budget 3 MB:
  the largest room uses 0.6 MB.

**Secrets and privacy** (subagents `secrets-engineer` and `privacy-engineer`, read-only, on the
138 tracked files)

- Secrets: none. Hits were references only (`${{ secrets.CLOUDFLARE_API_TOKEN }}`), `sha512`
  integrity hashes in `package-lock.json`, and commit SHAs in OpenZFS, FreeBSD and illumos links.
  No `.env`, key or token.
- Privacy: no LAN address, no `/home/…` path, no personal email or phone. The two images (the
  README capture and the favicon) were opened and are clean.
- Process traces replaced by roles in the tree. Kept: issue ids `ALG-n`, home-relative tool
  paths in the toolchain notes. The public repository is a clean import (decision 1 below).

**Code review before QA** (`code-reviewer` subagent on the whole diff): no blocker; key sets and
placeholders identical in EN and FR across every strings object; plural rules right. Fixed:
`audit.mjs` now flags a click that announces nothing, judges the focus ring by what focus changes,
and records console errors from every run (it then found the metaslab focus ring); the snapshots
figure announces its summary after a sync with no event; the Engine room says "theme and
language" and "From the first page on".

**Not done, and known limits**

- No session with a real screen reader; no test on a real iPhone (the v1 validation will be the
  first).
- Best Practices over real HTTPS, and the 2 s target on a real network, wait for the first public
  deploy.
- P2 of the brief: extra interactions inside rooms (the L2ARC coda exists as text in the ARC
  room).
- `lighthouse.mjs` reports; it is not a gate in CI (Lighthouse needs a browser and minutes per
  page).

## v1

Every room of the mission is built, reviewed by QA slice by slice, and measured: the Hall, the
History wing, eleven technical rooms and the Engine room, in French and English, dark and light.
Nothing is deployed: the repository is private and `PUBLIC_RELEASE` is unset.

### Three decisions for the owner at v1

1. **Public repository: history or clean import.** Proposed: publish the repository with its
   history. Answered: a new public repository holding one commit, the tree of the validated
   `main`, so that no process trace of the build reaches the public; the commands are in
   `RELEASE.md` (v1.1).
2. **Saying in the Engine room that AI agents wrote the site.** Proposed: keep the sentence,
   name no one. Answered with v1.1's wording: "written by AI agents, from a mission set by a
   human who validates the release", without the tool's name.
3. **Where the public repository lives.** Proposed: keep the organisation already named by
   `REPO_URL` and `SOURCES_URL` (`src/lib/stack.ts`, `src/lib/sources.ts`); moving it means
   changing those two constants. Open until the release.

## v1.1, the owner's feedback (2026-10-20)

Issue ALG-112. Branch `alg-112-v1-1-feedback`, from `main` at `ce196e5`. One commit per point.

**What changed**

- The vdevs and tree rooms open in 2D; 3D only on a press of "3D view", and back. Without WebGL
  or under reduced motion the button stays, disabled, with the reason beside it (D14.1).
- The Hall's ring opens in 3D after the first paint and commits a txg every 3 s by itself: the
  newest uberblock flies to its slot. "Commit the next txg" is gone; a Pause / Resume button
  stops the clock (WCAG 2.2.2); the live region speaks only on the visitor's actions. Reduced
  motion or no WebGL: the still 2D ring (D14.2).
- The Engine room: "written by AI agents, from a mission set by a human who validates the
  release", FR the same; the repository paragraph no longer promises a history (D14.4).
- The Hall's illustration: a rendered hard-disk platter, glossy brown iron oxide, steel clamp,
  beside the title (desktop) or under the text (phone), in both themes (D14.3).
- The tree is publishable as is for a one-commit public repository; `RELEASE.md` has the
  commands, not run (D14.5).

**Checks** (local build, Chromium 156 with SwiftShader)

- `npm test` and `npm run build` (`astro check`: 0 errors; FR typography: 0 failures).
- `scripts/verify.mjs`: 401 captures, 0 console errors, 0 mismatches in every room (run on the
  head before the review fixes); `verify-vdevs.mjs` (136 runs) and `verify-tree.mjs` (272 runs)
  rerun on the final head: 0 mismatches. New checks: no 3D fetched or drawn before the press on
  a wide desktop; back to 2D; the disabled button and its reason without WebGL and under reduced
  motion, a press that loads nothing; the Hall's ring in 3D with no press, three commits by
  itself, paused from the keyboard (txg unchanged 3.5 s later), 2D and back; no clock, no pause
  button, no Three.js under reduced motion or without WebGL; the reasons in FR too.
- `scripts/audit.mjs`: 28 pages, 0 problems (axe-core in both themes at 1440 px and at 390 px,
  keyboard, chain, switch, reduced motion; the Hall's Pause announces once).
- Layout shift: the Hall's hero image 0 on a phone, 0.0007 on a desktop (fonts); under reduced
  motion, vdevs 0.0009 and tree 0.0013 with the reason shown.

**JavaScript before a press of "3D view"** (gzipped, the same script on `ce196e5` and the head)

| Page | `ce196e5` phone | head phone | `ce196e5` desktop | head desktop |
| --- | --- | --- | --- | --- |
| Vdevs | 12,585 B | 12,569 B | 149,194 B (3D by itself) | 12,569 B |
| Tree | 9,165 B | 9,149 B | 145,757 B (3D by itself) | 9,149 B |
| Hall, at load | 3,028 B | 2,937 B | 3,028 B | 2,937 B |

The Hall imports its 3D (135 KB gzipped) when the ring nears the screen, on purpose (D14.2).
Raw, the room scripts are about 100 B larger than at `ce196e5`.

**The platter image**: master 999 × 544 WebP, 58 KB, rendered by `scripts/render-platter.mjs`
(five attempts, D14.3). Served as AVIF / WebP at 320, 480, 640 and 900 px with `width` and
`height`: a phone (2×) takes the 640 px AVIF, 10.5 KB; a 1440 px desktop the 480 px AVIF,
7.1 KB. The largest WebP fallback is 30.8 KB.

**Lighthouse** (mobile, simulated 4G, Lighthouse 13.5.0, every page; `scripts/lighthouse.mjs`)

| Page | Perf | A11y | BP | SEO | LCP | TBT | CLS | JS at load |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hall EN | 99 | 100 | 100 | 100 | 1.8 s | 0 ms | 0 | 4.2 KB |
| Hall FR | 99 | 100 | 100 | 100 | 1.8 s | 0 ms | 0 | 4.2 KB |
| Tree EN / FR | 99 | 100 | 100 | 100 | 1.8 s | 0 ms | 0.001 | 10.2 KB |
| Vdevs EN / FR | 98 | 100 | 100 | 100 | 2.0 s | 0 ms | ≤ 0.001 | 13.9 KB |
| Engine room EN / FR | 100 | 100 | 100 | 100 | 1.7 s | 0 ms | 0 | 0 |

Every other page: Performance 99, the rest 100. Desktop preset on the Hall: 100 everywhere,
LCP 0.4 s, CLS 0.001. Served from `127.0.0.1`, which Chromium treats as secure, so Best
Practices reads 100 here; over the private preview's plain HTTP it stays 78 (D13.4).

**Reviews before QA**

- `code-reviewer` on the whole diff: the FR Hall strings for the disabled 3D button were
  missing (a no-break space defeated the edit), a `RELEASE.md` grep matched its own line, three
  browser checks could pass without testing (the Hall's pause not scrolled into view nor
  asserted, the no-WebGL Hall not scrolled), `RELEASE.md` took the current `main` instead of the
  validated SHA, the pause button shown where no observer could start the clock. All fixed.
- `ui-designer` on the platter: the black shadow showed as a grey cloud on the light theme, the
  image too large on a phone, not on the right edge; optional: less vinyl-like streaks, a more
  ochre brown, a lower camera, a 28 rem column. All applied (attempt 5).
- `privacy-engineer` and `secrets-engineer` on the 143 tracked files: no secret, no personal
  data, no address, no home path, images clean. Fixed: the Engine room's "history of every
  change", the tool's name in D13.1, notes that pointed at a private history; `RELEASE.md`
  widened (more token patterns, `git init --template=`, a noreply author). Kept, with reasons in
  D14.5: issue ids, generic roles, the design references, the private preview notes.

**Not done, and known limits**

- The actions in CI are pinned by tag, not by SHA (`secrets-engineer`, low); a deploy
  environment restricted to `main` is for the owner to set at the release.
- No real phone yet: the Hall's 3D on a phone and its swipe behaviour were checked in an
  emulated iPhone viewport with touch only.

## v1.2, a grander Hall, a faster ring, a dedication (2026-10-20)

The report of ALG-114 (this project keeps its slice reports here). Decisions D15.1 to D15.3.

**What works**

- **Fig. 1.** The Hall's single platter is replaced by a 3.5-inch hard disk exploded along its
  spindle, rendered by `scripts/render-drive.mjs` (Three.js, headless Chromium, deterministic:
  two runs give byte-identical `drive.webp` and `drive-anchors.json`). The plate is HTML over
  the image: dashed spindle axis, leaders, seven numerals, the figcaption and its parts list, in
  both languages and both themes. Art direction by the `ui-designer` (three directions, A
  chosen), two critique rounds, five attempts (D15.2).
- **The ring, faster.** A txg every 2 s (was 3 s), the uberblock's flight 0.6 s (was 0.9 s):
  1.5× (D15.1). `verify.mjs`: the Hall's ring moves, the keyboard reaches Pause, Enter stops it.
  Reduced motion: unchanged, nothing moves.
- **"Why this museum?"** A dedication at the end of the Hall, linked from the hero: ZFS as
  engineering on keeping data safe, Jeff Bonwick, Bill Moore, Matt Ahrens, Sun's engineering of
  those years (slab allocator 1994, DTrace 2004, the ZFS source under the CDDL), OpenZFS and the
  721 names of its AUTHORS file. Seven numbered notes, one per reference (D15.3); new sources S41 (Bonwick's 17 November
  2005 post), S42 (USENIX 1994 abstract), S43 (USENIX 2004 abstract), all primary. Proofread by
  the `technical-writer`, which held two claims to their sources (D15.3).

**Measures**

| Measure | v1.1 | v1.2 |
| --- | --- | --- |
| Hall Lighthouse mobile, EN / FR (Perf / A11y / BP / SEO) | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 |
| Hall LCP mobile (simulated 4G) | 1.8 s (build log) · 2.0 s (same run as v1.2) | 2.0 s |
| Hall CLS mobile, EN / FR | 0 (build log) · 0.0004 (same run) | 0.002 / 0.004 |
| Hall Lighthouse desktop preset | 100, LCP 0.4 s | 100 everywhere, LCP 0.4 s, CLS 0.002 / 0.003 |
| JS at load on the Hall | 4.2 KB | 4.2 KB |
| Hall bytes transferred (mobile) | — | 154.6 KB EN, 155.3 KB FR |
| Image, largest served | 30.8 KB WebP 900 px | 104.0 KB WebP 1440 px; AVIF 36.7 KB |
| Image a phone (2×) gets | 10.5 KB AVIF 640 px | 28.5 KB AVIF 720 px |
| Image a 1440 px desktop gets | 7.1 KB AVIF 480 px | 28.5 KB AVIF 720 px (1× DPR) |
| Ring tick / flight | 3 s / 0.9 s | 2 s / 0.6 s |

Served sizes: AVIF 7.5, 12.4, 16.2, 28.5, 36.7 KB and WebP 12.6, 23.8, 33.6, 65.5, 90.7,
104.0 KB at 360, 576, 720, 1152, 1440 px; master 1670 × 1336 WebP, 132 KB (not served).

Lighthouse 13.5.0 over every page (`scripts/lighthouse.mjs`): every page Performance 99 or 100,
the rest 100. `audit.mjs`: 28 pages, axe 0, 0 problems. `verify.mjs`: 0 errors, 401 captures.
`npm test`: 205 pass. `check-sources`: 43 entries, 104 references in 30 pages, 0 problems.
`check-permalinks`: 0 failures (ANALYSIS.md and the built pages).

**Reviews before QA**

- `ui-designer`: art direction (three directions, A), a critique of attempt 3 (ghost cover, the
  D14.3 lighting back, the magnet in place, the platters exploded, a flatter camera) and of the
  page (bigger with a bleed, numerals outside the drive, serif list numerals, a lighter casting;
  the dedication at the end, as a plaque by the exit). All applied, except the full-width title
  (it left a void beside it): the exhibit spans the three rows instead.
- `technical-writer` on the FR and EN text: two claims beyond their sources, the name as S03
  gives it, French calques, "iron oxide" dropped from the parts list (no source). All applied
  but "œuvre d'ingénierie" (the owner's own word is « pièce ») and the "reads" of "the release
  this museum reads" (the site's idiom).
- `code-reviewer` on the whole diff: no blocker; fixed the text column just above 60 rem, the
  `sizes`/`widths` (1440 px added), the AUTHORS count's wording, a render that waited 15 min on
  a page error, leader dots too small.

**Design/UX review, round 1** (changes requested, 2 SHOULD, 2 NIT; all applied)

- Fig. 1 cut its casting at the bottom edge: the camera now frames the whole piece
  (`* 0.94` of the bounding-sphere distance, was `0.82`), and `render-drive.mjs` fails if a
  visible pixel touches the canvas edge before the trim (checked: the old framing fails it,
  edge alpha 255). Re-rendered; the anchors follow.
- The dedication's 12 notes were 7 references: one note per reference now (D15.3);
  `check-sources.mjs` takes several ids per note, three new tests.
- `zfs-2.4.4` and the commit no longer break in the hero; "Matt Ahrens was one of its two
  original authors" / « en fut l’un des deux auteurs originels ».
- Measured again (Lighthouse 13.5.0, mobile, local server): Hall EN and FR 99 / 100 / 100 /
  100, LCP 2.0 s, CLS 0.002 / 0.004. `npm test`: 208 pass; `check-sources`: 0 problems. `code-reviewer` on the round: no blocker;
  the edge check now as strict as the trim, an id listed in two notes fails.

**Debts and known limits**

- **CLS 0.002–0.004 on the Hall** (v1.1: 0.0004 in the same run), under the 0.1 "good"
  threshold by a factor of 25. Lighthouse attributes it to web fonts loading only (the image's
  explicit size is now recognised); it weighs more than in v1.1 because the exhibit is in the
  phone's first screen. Preloading Fraunces and Instrument Serif would remove it at an LCP
  cost; left for the owner's call.
- The image a desktop or phone downloads is about 3–4 times v1.1's (30 KB instead of 7–10 KB):
  a larger, detailed picture. Within the 150 KB budget; Performance unchanged.
- In the French dedication, the English quotes take English quotation marks (`<q lang="en">`),
  as on the History page.

## v1.3, navigation, a faster ring, Spanish, the uberblock under the glass (2026-10-20)

The report of ALG-117 (this project keeps its slice reports here). Decisions D16.1 to D16.4.

**What works**

- **Header and footer** (D16.1). Every page: Hall, Rooms, History, "Why this museum?" (the
  dedication's anchor), the repository on GitHub (`REPO_URL`, a 404 while the repository is
  private), a language switcher with flags as on blok (`li.langues`, `hreflang`,
  `aria-current` on the active language, an accessible name per language), the theme button.
  The footer: the visit, about (Why this museum, Sources, the repository) and languages. Two
  rows on a phone; no sideways scroll at 320, 390 or 1440 px (`audit.mjs` checks all three).
- **The ring, faster again** (D16.2). A txg every 1.3 s (was 2 s), the flight 0.4 s (was
  0.6 s): 1.5×. `verify.mjs` measured a 1299 ms tick and fails outside 1300 ± 100 ms. Reduced
  motion: nothing moves, as before.
- **Spanish** (D16.3). All 14 stops at `/es/` with Spanish slugs, the root and the 404 in three
  languages, `hreflang` alternates for FR, EN and ES on every page. Code excerpts unchanged;
  `check-sources` holds the Spanish pages to the same entries as FR and EN. Translated by seven
  agents from a shared glossary, then four `technical-writer` passes (about 150 fixes); the terms
  are in D16.3.
- **Fig. 1, the uberblock under the reading glass** (D16.4). Lines 36–150 of
  `include/sys/uberblock_impl.h` at `zfs-2.4.4` printed on fan-fold listing paper, a ray-traced
  BK7 reading glass over `struct uberblock` (lines 122–128), four callouts. Art direction by the
  `ui-designer` (three directions, A), two critique rounds. `scripts/render-glass.mjs` is
  deterministic (two runs: byte-identical `glass.webp`, SHA-256 `d735c313…`, and plate);
  `scripts/check-plate.mjs` re-reads the printed lines from the frozen commit, in CI. The v1.2
  disk is kept as Fig. 2 of the dedication, beside « never, ever trust the underlying hardware ».

**Measures**

| Measure | v1.2 | v1.3 |
| --- | --- | --- |
| Hall Lighthouse mobile, EN / FR / ES (Perf / A11y / BP / SEO) | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 in all three |
| Hall LCP / CLS mobile | 2.0 s / 0.002–0.004 | 2.0 s / 0.002 EN, 0.004 FR and ES |
| Tree room Lighthouse mobile, EN / FR / ES | 99 | 98 / 98 / 98; CLS 0.001, 0.001, 0.037 |
| JS at load on the Hall | 4.2 KB | 4.2 KB |
| Hall bytes transferred (mobile) | 154.6 KB EN | 179.7 KB EN, 180.5 KB FR and ES |
| Fig. 1, largest served | 104.0 KB WebP, 36.7 KB AVIF (1440 px) | 98.6 KB WebP, 68.2 KB AVIF (1440 px) |
| Ring tick / flight | 2 s / 0.6 s | 1.3 s / 0.4 s (measured tick 1299 ms) |

Fig. 1 served sizes: AVIF 9.4, 19.3, 26.7, 52.1, 68.2 KB and WebP 13.1, 26.9, 37.9, 74.6,
98.6 KB; master 1800 × 1440 WebP, 318 KB (not served). WebP is encoded at quality 75 with a
lossy alpha at 60 (`astro.config.mjs`): the figure's wide fade had doubled the weight with a
lossless alpha.

Lighthouse 13.5.0 (`scripts/lighthouse.mjs --rooms=hall,tree`, mobile, local server). `audit.mjs`:
42 pages, axe 0, 0 problems. `verify.mjs`: 457 captures, 0 console errors, every figure 0
mismatches. `npm test`: 221 pass. `check-sources`: 43 entries, 156 references in 44 pages, 0
problems. `check-permalinks`: 0 failures (ANALYSIS.md and the built pages). `check-plate`: ok.

**Reviews before QA**

- `ui-designer`: three directions for Fig. 1 (A chosen) and two critique rounds (D16.4).
- `technical-writer`: four passes over the Spanish (D16.3).
- `code-reviewer` on the whole diff: no blocker. Fixed: `check-plate` counted the file's final
  newline as a line, and could not tell a stale image beside a regenerated plate (the plate now
  records the image's SHA-256); a no-break space before KiB in the Spanish ZIL room. Left: the
  footer's `aria-current="true"` (valid) and `fetchpriority` on Fig. 1 (LCP already 2.0 s).

**Debts and known limits**

- The GitHub link is a 404 until the repository is public (expected, the issue says so).
- `/es/arbol/` CLS 0.037 against 0.001 in EN and FR: under the 0.1 "good" threshold. Cause
  not investigated yet (runs vary by a few thousandths; this is ten times that). Left as is.
- The Hall weighs about 25 KB more than v1.2: the new figure has more detail (text) than the
  disk. Performance unchanged.
- Left open for the Design/UX review (D16.4): green-bar stripes on the paper in the light theme,
  a larger Fig. 2 on a phone.

## v1.3.1, before the first public release (2026-10-20)

The report of ALG-122. Decisions D17.1 to D17.3.

**What works**

- **The current language without colour** (D17.1). The active language carries the nav's 1 px
  accent underline, under the code and the flag, and under the flag alone at 320 px where the
  codes are hidden; `aria-current="true"` kept. FR, EN and ES, dark and light, 320 and 1440 px.
- **"Rooms" current on room pages**: `aria-current="true"` and the same underline on every page
  but the Hall and History, which keep their own links.
- **Spanish nav on one row at 320 px**: below 360 px the gap goes to 0.5 rem and the text to
  0.78 rem (Spanish needs 278 px of text in 288). One row in all 24 header captures (three
  languages, Hall and a room, 320 and 1440 px, two themes), no sideways scroll.
- **Fig. 1 dimmed in dark**: `brightness(0.91)` on the Hall's figure in the dark theme only
  (computed style checked: Fig. 1 dark `brightness(0.91)`, light `none`; Fig. 2 `none`).
- **Release dry run** (`RELEASE.md` steps 1–2 on this branch's head, D17.2): the export holds one
  commit and as many files as `git ls-tree`; the three `git grep` checks and `gitleaks` find
  nothing; the four images carry no metadata. Five lines naming the build machine's working
  directory now name `../openzfs`. Results in the issue's `release-dryrun` document.
- **Who publishes** (D17.3): `RELEASE.md` §3, the team renames the private repository and
  creates `algotitanhq/uberblok` after the owner's Go; §4, the owner sets the Cloudflare
  secret and variables. `REPO_URL` and `SOURCES_URL` already name `algotitanhq/uberblok`;
  nothing in the tree depends on the private repository's name.

**Measures**

| Measure | v1.3 | v1.3.1 |
| --- | --- | --- |
| Hall Lighthouse mobile, EN / FR / ES (Perf / A11y / BP / SEO) | 99 / 100 / 100 / 100 | 99 / 100 / 100 / 100 in all three |
| Tree room Lighthouse mobile, EN / FR / ES | 98 / 98 / 98 | 98 / 98 / 98 |
| Hall LCP / CLS mobile | 2.0 s / 0.002–0.004 | 2.0 s / 0.002 EN, 0.004 FR and ES |
| JS at load on the Hall | 4.2 KB | 4.2 KB |

Lighthouse 13.5.0 (`scripts/lighthouse.mjs --rooms=hall,tree`, mobile, local server).
`audit.mjs`: 42 pages, axe 0, 0 problems. `npm test`: 221 pass. `astro check` and the French
typography check pass in `npm run build`.

**Reviews before Design/UX**

- `code-reviewer` on the whole diff. Fixed: `RELEASE.md` §3 now points every private clone at
  `uberblok-private` before the rename and the public repository's creation (a clone left on
  the old URL could have pushed the private history to the public repository), and checks that
  the directory it publishes holds one commit and no remote; the first deploy is defined (a
  manual CI run on `main`, now allowed by the deploy condition); "Rooms" is current only on the
  pages of `ROOMS`, not on any page but two.
- `security-auditor` on the tree about to be public: no secret, private address, home path,
  personal data or image metadata. Fixed: actions pinned by commit SHA, checkout without a
  persisted token.

**Debts and known limits**

- For the public repository, from the `security-auditor` (left for a later slice): the
  Cloudflare token as a GitHub Environment secret limited to `main`, with a separate deploy
  job, and branch protection on `main` (today any branch's workflow could read a
  repository-level secret); `wrangler` in `devDependencies`, so its tree is in the lockfile,
  rather than `npx --yes` at deploy time; the "Private previews" section of `docs/dev.md`,
  which stops being true after the release.
- `/es/arbol/` CLS 0.037, unchanged from v1.3 (under 0.1).
- Below 360 px the nav's text is 0.78 rem (about 12.5 px), a step under the rest of the
  header; 360 px and up are unchanged.

## v1.3.2, the README for the public export (2026-10-20)

The report of ALG-129. Decision D18.1.

**What works**

- `README.md` names French, English and Spanish (intro, Status, `src/pages/{en,fr,es}/`); no
  "not deployed" or private-preview text is left (`grep -i -E 'french and english|not
  deployed|private|until the first'` finds nothing). The Deploy section says the site is deployed to Cloudflare
  Workers from `main`, without a URL until the first deploy gives one.
- The credits name the three typefaces and their licence, SIL OFL 1.1 (checked in each
  Fontsource package's `LICENSE`).
- `RELEASE.md` step 1 re-run on this branch's head; results in the issue's `release-dryrun`
  document.

**Debts** (after publication): from the release gate, the 768 px FR/ES nav, wrangler in
`devDependencies`, a separate deploy job; `site` in `astro.config.mjs` names the expected
`workers.dev` URL and is checked against the real one after the first deploy, with the README URL.

## v1.3.3, hardening after the launch (2026-10-20)

The report of ALG-134. Decisions D19.1 and D19.2.

**What works**

- The deploy no longer reads the variable `CLOUDFLARE_ACCOUNT_ID`: it asks Cloudflare for the
  token's one account and masks its ID before `wrangler` runs; the condition no longer reads
  the variable. Proved on the branch (temporary probe, run 39503479503): 1 account seen, the ID shown
  as `***`, no 32-hex string in the log. Nothing new is needed from the owner. Rebased on
  ALG-137 (keys from the organization), so both merge, and deploy, once.
- `public/_headers` is in `dist/` and served on every path by `wrangler dev` (4.142.0): HSTS,
  `nosniff`, the referrer policy, `X-Frame-Options: DENY`, a `Permissions-Policy` and the CSP;
  `/_headers` itself is not served (404). `wrangler.jsonc` still has `assets` and no `main`; no
  `_worker.js`, no `functions/`.
- Under that CSP: `scripts/verify.mjs` on the whole visit, 457 captures, 0 console errors;
  a sweep of the 44 pages (EN, FR, ES and the root redirect) with a `securitypolicyviolation`
  listener, every 3D view opened (Hall, tree, vdevs) and the theme button pressed, 0 violations
  and 0 console errors (the table is in the issue's `headers-check` document).
- `scripts/check-csp.mjs` passes on the build and runs in CI; 9 tests.
- Lighthouse mobile on the Hall, local through `wrangler dev`: 99/100/100/100 in EN, FR and ES,
  with `csp-xss` and `has-hsts` now passing; the same server without `_headers` also gives 99
  (LCP 2.0 s), so the headers cost nothing. ALG-125 measured 100 on the live HTTPS site; to
  re-measure there after the merge deploy.
- gitleaks 8.30.1 on the tree and the history: no leak.

**Debts**

- Run 39495463987 (the first deploy, before this PR) still shows the account ID in clear in
  its Deploy header: its logs are to be deleted (Actions, that run, "Delete all logs").
- Deploy runs in the build job, after `npm ci` and the build, with the token in its env; a
  separate deploy job fed the built `dist/` (and `wrangler` from the lockfile) would keep
  install scripts away from the token (`security-auditor`, medium; older than this PR).
- The organization variable `CLOUDFLARE_ACCOUNT_ID` is no longer read by this repository; it
  can stay for other sites, which should follow D19.1 rather than read it.
- `style-src` keeps `'unsafe-inline'` (D19.2).

## Analytics beacon, gated (ALG-128, 2026-10-20)

Cloudflare Web Analytics in the production build only (DECISIONS.md D18.2), with the site's
real token (posted by the owner on ALG-127). CI sets `PUBLIC_RELEASE=true` for the build only
when the Deploy step ships it: the repository variable is `true` since the first public release,
so the push of this change to `main` deploys the beacon; branches, PRs and `preview` never have it.

**Proof** (`npm run build`, 44 HTML pages each):

| Build | Pages with the beacon |
|---|---|
| real token, `PUBLIC_RELEASE=true` | 44 / 44 |
| real token, `PUBLIC_RELEASE` unset (as `preview`) | 0 / 44 |
| empty token (a local edit, not committed), `PUBLIC_RELEASE=true` | 0 / 44, and the Build step's release guard fails it |

The CI Build step checks both directions: no beacon in a build that is not deployed, and in a
release build no page without a beacon carrying a token. Its `PUBLIC_RELEASE` uses the Deploy step's condition word for
word, `workflow_dispatch` included (the first deploy is a manual run, `RELEASE.md` step 4).
`scripts/test/analytics.test.mjs` covers the rule (`analyticsOn`): on, off without the switch,
off with an empty token. With the beacon on, the Engine room's hosting line names Cloudflare Web
Analytics in EN, FR and ES (the FR typography check passes). `npm test`: 225 pass.

**Debts.** None new.

**Rebased on ALG-134 (ALG-140, 2026-10-21).** The CSP landed first, so the beacon would have
been blocked: `public/_headers` now allows `https://static.cloudflareinsights.com` in
`script-src` and `https://cloudflareinsights.com` in `connect-src`, and `scripts/check-csp.mjs`
allows exactly those two, requires `connect-src` and keeps `default-src` to `'self'` (D19.3;
1 new test, `npm test`: 235 pass). The Build step's `PUBLIC_RELEASE` condition again equals
Deploy's word for word (ALG-134 removed `vars.CLOUDFLARE_ACCOUNT_ID != ''` from Deploy). The
step's guard against a beacon in an undeployed build now reads only `*.html`: `dist/_headers`
names the hosts too and would have failed every branch build (`code-reviewer`); its release check
matches the whole beacon tag. The Build step's script, run as is: release 44/44 pages with the
beacon, otherwise 0/44, both exit 0; `check-csp` passes on both. Release build served by `wrangler dev` 4.142.0 with
`_headers`, 44 pages in Chromium: the CSP header on all 44, 0 `securitypolicyviolation`, the
beacon loaded on 44 and its report sent on 44; the only console errors (88) are Cloudflare
refusing the report's CORS for `localhost`, expected off the site's own host.

## v1.4 pilot (ALG-173): the copy-on-write room as a question

**What changed.** The English copy-on-write room asks one question, "What happens when I change
a block?", answers it in three plain paragraphs, keeps its two figures, then shows the code in
four Source notes (D21.1). `SourceNote` and `SourcePanel` are generic: at 1024 px and wider a
note opens in a panel on the right; narrower, it opens inline. The French and Spanish rooms
are byte-identical to `main`'s build; the only other page change is the Engine room's excerpt
count (116 → 120, computed from `ANALYSIS.md`).

**Measures** (built EN page, `<article>` only):

| | `main` | this branch |
|---|---|---|
| GitHub links in the article | 32 | 14 |
| of them in the prose | 20 | 0 |
| Code excerpts | 3 | 4 |
| Lines of code shown | 93 | 34 |

**Proof.** `npm run build`, `npm test` (240 pass), `check-permalinks` (ANALYSIS.md 120 excerpts,
built site 2430 references), `check-sources`, `check-csp` (44 pages, no new hash) and
`check-plate`: all pass. `scripts/audit.mjs` over the whole visit: 42 pages, 0 problems (axe
WCAG 2.2 AA in both themes, keyboard, no sideways scroll at 1440/390/320). `scripts/verify.mjs`:
457 captures, 0 console errors. A panel check in Chromium (not committed, `shots/`) at 1440
dark and light, 1024 and 390: the summary keeps its height on screen when the panel opens
(drift 0 px), focus goes to the panel title, Esc and the close button return it to the
summary, Tab off either end of the panel returns to the note, Esc from a figure's button closes
the panel and leaves focus on the button, a second note swaps the panel and puts the first one
back, narrowing from 1440 to 800 with the panel open puts the note back inline, open; axe finds
nothing with the panel open or closed; no sideways scroll.

**Reviews.** `technical-writer` on the room text: four claims were sharper than the code
(every read checked, while the ARC's hits are not; `ECKSUM` failing the read, while on a mirror
it rejects one copy; a crash leaving the pool "as before", without the ZIL; every write getting a
new address, without dedup and nopwrite), one rhythmic triad, missing glosses for uberblock,
txg and MOS: all fixed. `code-reviewer` on the diff: tab order out of the panel, Esc scope, a note
opened by find-in-page, one panel per page, print: fixed or documented.

**Debts.** The other rooms and the FR/ES copy of this one keep the old format until the pilot
is approved. The figures' own "see the code" links stay inside the figures.

## v1.4 transaction groups room (ALG-189): a question, and a figure that outlines each step

**What changed.** The transaction groups room, in EN, FR and ES, asks one question ("When does
my write reach the disk?"), answers it in three plain paragraphs, keeps its figure with what to
try, then shows the code in seven Source notes (D21.1, D24.1). In the figure, each event now
outlines the one part it changed (a CPU cell, the dirty-data meter, a txg card, a pass row, the
"On disk" line or a thread row); the narration and the log are plain, with no code links; each
stage says its role in one line; Next event is the first button. The model is unchanged. Seven
short excerpts are new in `ANALYSIS.md` (TXG room, 6 to 12). No shared code changed; the other
rooms are unchanged, except the Engine room's computed excerpt count (120 → 127).

**Measures** (built pages, `<article>` only; the same in EN, FR and ES):

| | `main` | this branch |
|---|---|---|
| GitHub links in the article | 43 | 35 |
| of them in the prose | 34 | 0 |
| in excerpts and Source notes | 9 | 35 |
| "code" links the figure adds as it runs | 1 per event (19 targets) | 0 |
| Code excerpts | 5 | 7 |
| Lines of code shown | 148 | 58 |

**Proof.** `npm run build` (0 errors, French typography 14 files), `npm test` (240 pass),
`check-permalinks` (ANALYSIS.md 127 excerpts, 932 line references, 0 failures).
`scripts/verify-txg.mjs` (new, scoped to this room): EN, FR, ES on desktop and a 390 px phone,
each Next event press outlines exactly one part and announces it, no link in the narration or
log, no horizontal overflow, no console error; after `zpool sync` txg 41 waits in the middle for
its writes; a long free during a sync fills all three stages; reduced motion runs no animation;
with no script the text version is shown; Tab reaches Next event, Enter and Space press it with
a visible focus ring; at 1280 px a Source note opens in the side panel. 48 captures, 0 problems.

**Reviews.** `technical-writer` on the EN text (25 fixes: `txg_kick` raises the wait to the dirty
txg, not open + 2; `timer` is a countdown; the ZIL saves what a power cut would lose; the
uberblock write is several writes; "what to try" matched to the model step by step; fragments
and a staged reveal), then on FR and ES (39 fixes: opening fragments, referents, "pour qu'un seul
txg", calques). `code-reviewer` on the diff: the outline was lost on minor events while playing,
and a txg closed with no writes said "waits for 0 writes": both fixed, plus capture names and
dead constants.

**Debts.** Inside a Source note the Excerpt's own symbol heading still shows; ALG-183 hides it
in shared code, and this room gets it on rebase. `scripts/verify.mjs` still checks this room
in EN and FR only; `verify-txg.mjs` covers ES.
