# Decisions

Each entry: context, options, choice, why. Newest at the bottom of each slice.

## Slice 0

### D0.1 Frozen OpenZFS commit: `zfs-2.4.4`

- **Context.** Every excerpt and permalink must point to one immutable commit.
- **Options.** `master` at a given SHA (newest code, but not a release: features can move
  or be reverted); the latest 2.3.x or 2.2.x maintenance release (older code); the latest
  release tag `zfs-2.4.4`.
- **Choice.** Tag `zfs-2.4.4`, commit `71a9f9578616a90c3c14bb59629fb4d31bfd68d1`
  (tagged 2026-08-21, the newest release tag on 2026-10-18; tag object is annotated, the SHA
  above is the commit it points to).
- **Why.** A release is what users run and what the OpenZFS documentation describes; it
  contains the current ARC balancing, RAID-Z expansion and fast dedup, so the museum does
  not describe obsolete code. Permalinks use the full commit SHA, never the tag name, so
  they cannot move.
- **Tree.** `https://github.com/openzfs/zfs/tree/71a9f9578616a90c3c14bb59629fb4d31bfd68d1`

### D0.2 Toolchain in user space on the build machine

The build machine (a shared Ubuntu 24.04 VM) has Node 18, no browser and no root. Everything is installed in the user's home:

| Tool | Version | How |
|---|---|---|
| nvm | 0.40.3 | official install script, `PROFILE=/dev/null` (no shell rc edited) |
| Node | 22.23.3 (npm 10.9.9) | `nvm install 22` |
| Playwright | 1.64.1 | `npx playwright install chromium` |
| Chromium | 156.0.8078.4 (Playwright build 1248, plus headless shell) | idem, in `~/.cache/ms-playwright` |
| Lighthouse | 13.5.0 | `npx lighthouse@13.5.0` |
| git | 2.43.0 | system |

- **Node 22 rather than 20.** Both satisfy "Node 20+"; 22 is the active LTS line and is
  supported by current Astro. One major to keep in CI and locally.
- **Missing system libraries.** Chromium needs `libatk-1.0`, `libatk-bridge-2.0`,
  `libcups2`, `libXdamage`, `libatspi` (and `libavahi-*` for cups), absent from the build machine.
  Without root, the Ubuntu 24.04 packages are fetched with `apt-get download` and unpacked
  with `dpkg-deb -x` into `~/.local/chromium-libs/root`; runs export
  `LD_LIBRARY_PATH=~/.local/chromium-libs/root/usr/lib/x86_64-linux-gnu`. Lighthouse also
  needs `CHROME_PATH` pointing to the Playwright Chromium. Rejected: asking for root to
  `apt install` (an access we do not need for a five-library gap).
- **Smoke test (2026-10-18).** Playwright launched Chromium and read a page; Lighthouse ran
  all categories on a test page served over HTTP (`file://` URLs are refused by Lighthouse).

### D0.3 Licences

- **Context.** The repo is public from day one; it will quote CDDL code.
- **Choice.** Site code under MIT; the site's texts and illustrations under CC BY 4.0;
  OpenZFS excerpts quoted under CDDL-1.0 with attribution and a permalink, no OpenZFS file
  copied into the repo.
- **Why.** MIT is the shortest permissive licence and matches the family's habits; CC BY
  lets others reuse the explanations with credit. CDDL is file-based copyleft: short
  quotations with attribution are fine, redistributing modified files would bind them to
  the CDDL, which we avoid by never copying files. The permalink checker also refuses an
  excerpt from a file whose SPDX header is not `CDDL-1.0` (some vendored code in OpenZFS,
  such as compressors, carries other licences).
- **Rejected.** CDDL for the site code (no reason to bind our code to it); GPL (would add
  friction for no gain on a static site).

### D0.4 Rooms and visit order

- **Context.** Brief section 13 lists the rooms in build order (slices); the mission lists
  them in visit order. These are two different orders.
- **Choice: visit order = the mission's order, unchanged.**

| # | Room | Slug (EN) | Built in slice |
|---|---|---|---|
| 0 | Hall: the uberblock | `/` | 1 (2D ring), 12 (3D object) |
| 1 | History wing | `history` | 2 |
| 2 | The tree and the uberblock | `tree` | 12 (3D) |
| 3 | Copy-on-write, checksums and self-healing | `copy-on-write` | 1 |
| 4 | Transaction groups | `txg` | 3 |
| 5 | The vdevs | `vdevs` | 11 (3D) |
| 6 | RAID-Z | `raidz` | 4 |
| 7 | Snapshots and clones | `snapshots` | 5 |
| 8 | The ARC | `arc` | 6 |
| 9 | Metaslabs and space maps | `metaslabs` | 7 |
| 10 | ZIL and SLOG | `zil` | 8 |
| 11 | send / receive | `send-receive` | 9 |
| 12 | Compression, dedup, encryption | `compression-dedup-encryption` | 10 |
| 13 | Engine room (colophon) | `engine-room` | 13 |

- **Why this order.** It follows the data: the root and the tree first, then how the tree
  changes (copy-on-write, txg), where blocks land (vdevs, RAID-Z), what the tree enables
  (snapshots), how it is read fast (ARC), how space is found (metaslabs), the fast path for
  synchronous writes (ZIL), and the features built on top (send/receive, compression,
  dedup, encryption). The analysis confirmed each room depends only on rooms before it,
  except two forward references that are acceptable: copy-on-write mentions the mirror
  (vdevs, room 5) for self-healing, and the ZIL mentions the log allocation class (vdevs
  and metaslabs). Both are one-sentence references with a link.
- **Linear visit with gaps.** Previous/next follow this table and skip rooms not built
  yet, so slice 1 ships Hall → Copy-on-write with no dead links.
  Slugs are localized in French in slice 1 (decided there, with the i18n routing).
- **Deviations from the brief.** None in the list. Two clarifications: "Hall/uberblock"
  and "tree and uberblock" are two rooms that share the same structures (`uberblock_t`,
  `vdev_label_t`); the Hall shows the ring and the choice of the active uberblock, the tree
  room shows the whole block pointer tree and the label write ordering that makes the flip
  atomic. `ANALYSIS.md` gives them distinct excerpts.

### D0.5 Permalink and excerpt check

- **Context.** "Every permalink checked" must be repeatable, by QA and by every later
  slice.
- **Choice.** `scripts/check-permalinks.mjs`, no dependency: for every permalink in a
  Markdown file, the SHA must be the frozen one, the file must exist at that SHA and the
  range be in bounds; when a fenced code block follows the permalink, it must equal those
  lines of `git show <sha>:<path>` byte for byte (tabs included) and come from a file
  whose SPDX header says `CDDL-1.0`; excerpts over 40 lines are warned.
- **Why.** Byte equality is the only check that proves "quoted, not paraphrased". Opening
  each link on GitHub by hand does not scale to a hundred links and is not repeatable.
  GitHub renders `blob/<sha>/<path>#Lx-Ly` from the same blob, so equality with
  `git show` implies the link opens on the quoted lines.
- **CI.** `.github/workflows/check.yml` runs it on every push, so a later slice that edits
  `ANALYSIS.md` cannot break an excerpt silently. Slice 1 adds the build and deploy jobs
  next to it.

### D0.6 Island framework: deferred to slice 1

Allowed by the issue. Slice 0 has no code beyond the checker.

### D0.7 "The ring of 128": what the Hall says

- **Context.** The mission describes the Hall object as « l'uberblock et son ring de 128 ».
  The frozen code says the ring is 128 KiB per label (`VDEV_UBERBLOCK_RING`,
  `include/sys/vdev_impl.h` L482) and a slot is `1 << clamp(ashift, 10, 13)` bytes
  (L491-L496), so the ring holds 128 slots at ashift 9-10, 32 at ashift 12 (4K-sector
  disks, the common case today) and 16 at ashift 13 or more.
- **Options.** (a) Say "128 uberblocks" without qualification: inexact for most pools in
  service, fails the north star. (b) Show only 32: exact for most pools, loses the
  mission's emblem and the original layout. (c) Show the ring as 128 KiB, drawn with 128
  slots labelled "ashift 9-10", with one control to switch to ashift 12 (slots merge 4 by 4
  into 32) and 13 (16), and a sentence stating it.
- **Choice.** (c), from slice 1 (2D) and kept in slice 12 (3D).
- **Amended in slice 1 (QA NIT, ALG-38).** The list missed ashift 11, which gives 64 slots of
  2 KiB. The Hall's switch has four positions: 9-10 (128), 11 (64), 12 (32), 13+ (16).
- **Why.** It keeps the image of the mission and is exact; the switch itself teaches that
  the on-disk layout is fixed in bytes and the slot size follows the sector size.

## Slice 1

### D1.1 Node toolchain: Node 22, pinned by `.nvmrc`

- **Context.** The brief asks for Node 20+ via nvm. Astro 7.4, the current release, declares
  `"node": ">=22.22.0"`.
- **Choice.** Node 22 (22.23.3 on the build machine, D0.2), written in `.nvmrc` and read by
  `actions/setup-node` in CI, so local and CI use the same major. `package.json` pins exact
  versions (`npm i -E`) and `package-lock.json` is committed; CI uses `npm ci`.
- **Rejected.** Node 20 with Astro 5 (an older major for no gain); Bun or pnpm (one more tool
  for a two-page site).

### D1.2 Island framework: none

- **Context.** Only the interactive figures need JavaScript (the Hall ring, the copy-on-write
  tree, the mirror).
- **Options.** Preact or Svelte islands; plain TypeScript in Astro `<script>` blocks.
- **Choice.** Plain TypeScript. Each figure is server-rendered markup plus one bundled script
  that draws its SVG or HTML with a ten-line helper (`src/lib/svg.ts`). Strings travel from
  the Astro component to the script as JSON in a `data-strings` attribute, so each language
  ships only its own text.
- **Why.** The figures are small state machines that redraw on a click; a framework runtime
  would cost more than the figures themselves. Measured: 2.1 KB of JS on the Hall, 6.3 KB on
  the room (transferred, compressed), against a 3 MB budget. If a later room (ARC simulator,
  3D) needs component state across many elements, Preact can be added to that room alone
  without touching these.

### D1.3 Design tokens: Almanak's Nocturne and Paper, carried to the web

- **Context.** Brief section 4: visual language of Almanak and Lukarne, dark by default, light
  available, elegant and precise, no kitsch.
- **Choice.** `src/styles/tokens.css` holds every colour, size, space and duration as CSS
  custom properties. Dark is Almanak's "Nocturne" (warm black `#0e0d0b`, paper ink `#f2ede4`,
  amber accent `#e89e5c`); light is its "Paper" (cream `#efe8da`, ink `#1f1b16`, burnt accent
  darkened to `#a2461e` so it reaches 5:1 as text). Type: Fraunces (display, light weights,
  tight tracking), Instrument Serif italic (kickers, captions), Inter (text), the system
  monospace for code. Fonts are self-hosted from Fontsource (OFL), variable `wght` axis only
  (Fraunces 37 KB instead of 121 KB for all axes). Motion: one slow ease-out
  (`cubic-bezier(0.2, 0.7, 0.2, 1)`), three durations, all set to 0 under
  `prefers-reduced-motion`. Code colours are tokens too (Shiki's CSS-variables theme), so
  excerpts follow the theme.
- **Contrast.** Every text colour was computed against both grounds: at least 4.5:1 (dark
  muted 8.9, light muted 6.7, light accent 5.0; code comment 5.9 dark and 4.9 light).
- **Theme choice.** Dark unless the visitor picks light with the header button (stored in
  `localStorage`, applied by an inline script before the first paint, so there is no flash).
  The OS preference is not followed: the brief says dark by default.
- **Lukarne.** Its design notes describe motion and remote ergonomics, not a palette, so
  Almanak is the source of the tokens.
- **Rejected.** A UI kit or Tailwind (a second vocabulary for a dozen components); Google Fonts
  links (third-party requests, tracking concerns).

### D1.4 i18n: Astro routing, both locales prefixed, slugs localized in one table

- **Choice.** Astro's built-in i18n with `locales: [en, fr]`, `prefixDefaultLocale: true`, so
  every page lives under `/en/` or `/fr/`. Slugs are localized in `src/lib/rooms.ts`, the one
  table of the visit (order from D0.4, title, teaser and slug per language, open or not):
  `/en/copy-on-write/` and `/fr/copie-sur-ecriture/`, and so on for every room
  (`histoire`, `arbre`, `instantanes`, `compression-dedup-chiffrement`,
  `salle-des-machines`; technical names such as `txg`, `raidz`, `arc`, `zil` stay as they
  are). Each page is a file per language (`src/pages/en/…`, `src/pages/fr/…`) holding its own
  prose; components take `lang`.
- **Switch.** The header link points to the same room in the other language, computed from the
  table, so one click keeps the room. Pages declare `hreflang` alternates and a canonical URL.
- **Root `/`.** Static hosting cannot read `Accept-Language`, so `/` is a tiny page whose
  inline script goes to the language last chosen with the switch, else the browser's (any
  `fr*` gives French), else English; both links are visible without JavaScript.
- **Rejected.** A dynamic `[lang]/[slug]` route with all prose in dictionaries (long texts are
  easier to write and proofread as pages); English unprefixed at `/` (two URL shapes for one
  site).

### D1.5 Deploy workflow, as blok, switched off until v1 validation (amended by D-R1)

- **Choice.** One workflow, `.github/workflows/ci.yml` (it replaces `check.yml`), on every
  push: checker tests, excerpt check on `ANALYSIS.md`, `npm ci`, `npm run build` (which runs
  `astro check` first), permalink check on every built HTML page, then the deploy step:
  `main` → `wrangler deploy`, any other branch → a preview version under a per-branch alias
  (blok's alias rule; removed by D-R1). The step runs only
  `if: vars.CLOUDFLARE_ACCOUNT_ID != ''`, so it is skipped until the owner sets the variables
  after v1 (board directive of 2026-10-18). `wrangler.jsonc` serves `dist/` as static assets
  (no Worker code, unlike blok, which needs one for Range requests), with `workers_dev` and
  `preview_urls`, `404-page` handling and automatic trailing slashes. Wrangler is pinned
  (4.142.0, blok's version) and run with `npx`, so it is not a dependency of the site.
- **Why one workflow.** The build and the deploy need the same checkout and the same `dist/`;
  two workflows would build twice.

### D1.6 Excerpts on the site are read from `ANALYSIS.md` at build time

- **Context.** The site must show excerpts that match the frozen SHA, and the checker already
  proves `ANALYSIS.md` does.
- **Choice.** `src/lib/excerpts.ts` imports `ANALYSIS.md` raw and returns the fenced block
  that follows a given permalink; the build fails if the permalink is not there or the block
  length differs. No excerpt is copied into the site's sources. Every other link on the site
  is built by `gh(path, from, to)` with the frozen SHA, and CI runs the checker on the built
  HTML (SHA, file and line range of each of the 92 links).
- **Why.** One source of truth, already verified; a site excerpt cannot drift from the
  analysis.

### D1.7 The copy-on-write room's numbers are computed, not drawn

- **Choice.** The figures compute fletcher4 exactly as `fletcher_4_scalar_native` does
  (`src/lib/fletcher4.ts`) over the bytes of the demo blocks. A parent's bytes are the block
  pointers it holds (address, birth, checksum), so changing a child really changes the
  parent's checksum. Block addresses and txg numbers are made up and the text says so. The
  facts this relies on (fletcher4 is the default, a mirror read with no good copy fails) were
  added to `ANALYSIS.md` with permalinks.
- **Why.** "Every claim maps to code": a checksum that changes because the code says it does
  is more honest than a random hex string.

### D1.8 HTML whitespace kept (`compressHTML: false`)

- **Context.** Astro's HTML compression removed the line break between a word and the
  following inline link ("the" + `<a>uberblock</a>` rendered "theuberblock"), seen on the
  first captures.
- **Choice.** Turn compression off. The pages are a few tens of KB of HTML, and the transfer
  is gzip/brotli-compressed by the host anyway.

### D1.9 French punctuation spacing, enforced by the build

- **Context.** QA on ALG-40: no French string had a no-break space, so a line could start
  with `:` or `;`, and « » could lose their content at a line break.
- **Options.** Typeset at build time (a transform over the HTML, which has to skip code and
  reach the strings the figures read from `data-strings`); or write the right characters in
  the sources and check the output.
- **Choice.** The characters are in the sources: U+202F (narrow no-break space) before
  `; ! ?`, U+00A0 (no-break space) before `:` and inside « ». `npm run build` ends with
  `scripts/check-fr-typography.mjs dist/fr`, which fails on any other space before those
  marks, in text and attribute values, skipping `<pre>`, `<code>`, `<script>` and `<style>`
  (tests in `scripts/test/`).
- **Why.** What the visitor gets is what the source says, the figures' strings included, and
  a missing space is caught at build time rather than by a reader. The characters are
  invisible in an editor; the check is what keeps them right.

## Slice 2

### D2.1 The History wing: eras, dated milestones, notes per sentence

- **Context.** The wing must read well at 390 px and 1440 px, in both languages, with a
  source behind every fact, and stay a reading page.
- **Options.** A horizontal, scrolling timeline (a figure with JavaScript, poor at 390 px
  and with a keyboard); one long essay with footnotes (hard to scan by date); a vertical
  list of dated milestones grouped in eras.
- **Choice.** Three eras (At Sun Microsystems 2001–2007; Oracle, illumos, Linux 2008–2013;
  OpenZFS 2013–2026), 21 milestones, in date order. A milestone is a date, a title and one or
  two short paragraphs. Each sentence that states a fact ends with a numbered note to its
  entry in `SOURCES.md`, and the page closes with the numbered list of sources, each with a
  link back to the milestone that cites it. Eras have anchor links at the top. Desktop puts
  the date in a column next to a thin rail; mobile stacks date, title and text on the rail.
  Content lives in `src/lib/history.ts` (FR and EN side by side, so a fact cannot be added
  in one language only without the check noticing), rendered by `Timeline.astro`.
- **Eras overlap on purpose.** Linux work starts in 2008 and the 2010 events sit between it
  and the 0.6.1 release: the middle era keeps them in date order instead of splitting
  Linux into its own era out of sequence.
- **Dates at the precision the source gives.** A day when a dated document says it (commit,
  announcement, dated post); a month for releases, whose tag, tagged commit and GitHub
  release can fall on different days (the month is what they agree on); a year when only
  the year is sourced (2001, 2008, Solaris 10 6/06). Dates are formatted by `Intl` (en-GB:
  "31 October 2005"; fr-FR: "31 octobre 2005").
- **No JavaScript, no figure, no image.** Anchors and `:target` do all the "interaction"
  (the targeted milestone's dot fills, the targeted source is highlighted). Nothing to
  enhance progressively; no third-party image, so no image licence to log.
- **French spacing.** The strings in `history.ts` are written with plain spaces and passed
  through a four-rule helper (`fr()`) that puts U+202F and U+00A0 where D1.9 wants them;
  the build's check (D1.9) still reads the output. On French pages `<q>` uses « » with
  no-break spaces, also around English quotations.

### D2.2 `SOURCES.md` is the one list of sources, read by the site

- **Context.** The issue asks for one entry per fact, date, quote and name, and that the
  page link each milestone to its sources.
- **Choice.** One table row per claim, with a stable id `S01`...`S40`, the claim in English
  as the site states it, the source as a Markdown link, the kind, the access date, and notes
  (the verbatim excerpt that supports the claim, original URL when the link is an archive,
  caveats). Several rows share a source when the source supports several claims: the unit
  is the claim, so a reviewer can check a single sentence. The site imports `SOURCES.md`
  at build time (`src/lib/sources.ts`); texts cite `[[S12]]`; an id with no row fails the
  build. The page's list of sources is built from the rows, so its links cannot drift from
  the file.
- **Rejected.** Sources declared in the page data with `SOURCES.md` generated from them (the
  reviewable document would be an artefact); a bibliography keyed by URL (one note would
  then cover several claims, which defeats checking claim by claim). The cost: the page's
  list repeats a source under several numbers, as footnotes do.

### D2.3 The source check runs in CI; link liveness runs by hand

- **Choice.** `scripts/check-sources.mjs SOURCES.md <built pages>` runs in CI after the
  build. It fails if a page cites an id that has no row; if a row is cited by no page
  (orphan); if a milestone has no citation; if a page's list of sources lacks a cited id,
  lists an uncited one, or links a URL that is not in the row; if the FR and EN pages differ
  in milestones or in the ids each milestone cites. Ten tests in `scripts/test/`.
  `scripts/check-source-links.mjs` fetches every link in `SOURCES.md` and reports anything
  but a final 2xx; it is not a CI step, because a slow archive or a bot wall must not turn a
  build red. Its result is recorded in `BUILDLOG.md` at each slice that touches sources.
- **Limit.** The check proves that every milestone and every note maps to a row, and that FR
  and EN cite the same rows; it cannot prove that a sentence says no more than its row. That
  part is the writing rule (D2.4) and QA's sampling.

### D2.4 Source policy: what counts as verifiable

- **Primary**: the person or organisation that did the thing, at the time: the authors'
  own blog posts and interviews, commits (`illumos-gate`, `freebsd-src`, `openzfs/zfs`),
  release notes and tags, press releases, official documentation, the project's own
  announcements.
- **First-hand**: a project's account of its own history (the openzfs.org "History" page),
  or an editor's introduction to an interview with the people concerned (ACM Queue).
  Accepted for facts the account states plainly; never stretched.
- **Secondary** (articles, encyclopedias, aggregators): not used on the page. None of the 40
  rows is secondary.
- Every source was opened and the supporting words found on the page (copied into the row's
  notes) before the claim was written. Dead or bot-walled pages are cited through the
  Wayback Machine with the capture timestamp in the URL; the original URL is in the notes.
- A sentence says no more than its row: no "founder", "creator" or "father of" unless a
  source says it; the licence is stated as the OpenZFS documentation states it, with no
  comment on the CDDL/GPL debate.

**Removed for lack of a verifiable source**

- The names of the "two engineers" of 2001. openzfs.org says "two engineers"; ACM Queue says
  Bonwick led and Moore was co-lead; the OpenZFS announcement calls Ahrens "one of the two
  original authors". No source pairs names with "two engineers", so the page states the
  three facts side by side and does not join them.
- Any role for Matt Ahrens beyond "one of the two original authors" (co-founder, co-creator).
- The exact day ZFS source appeared in OpenSolaris: only "November 2005" (Bonwick's post of
  17 November about "the ZFS launch today") and "build 27a".
- The exact availability day of Solaris 10 6/06 (a "26 June 2006" seen only in secondary
  sources). The page says 2006, Sun's announcement of 2 May for June, and Oracle's docs.
- Oracle's internal memo of August 2010 on the end of OpenSolaris: known only through a
  blog that republished it, whose author does not say he received it.
- The ZFS on Linux 0.6.1 announcement quote ("ready for wide scale deployment"): the
  original mailing-list post could not be opened; only LWN quotes it (secondary).
- Tom Caputi's employer: the commit shows an e-mail domain, which is not a statement.
- A design-goals quote by Jeff Bonwick from his 2005 post: the post tells the integration
  story; the goal quote on the page is Bill Moore's, from 2007, verbatim.
- The 2008-02-26 commit as the start of ZFS on Linux: it is the Solaris Porting Layer,
  merged into the repository in 2018. The page cites the first ZFS commit (2008-11-20).
- Mac OS X ports and other platforms: only named as communities in the OpenZFS launch
  announcement; no milestone without a primary source and a place in this story.

## Slice 3

### D3.1 The txg figure runs a model of the two threads, not a scripted animation

- **Context.** The issue asks that every visible state map to a state or a call in
  `ANALYSIS.md`, that the visitor can add writes, advance and pause, and that there is at
  most one txg per stage "as in the code". A scripted loop (open → quiescing → syncing every
  few seconds) would show a rhythm the code does not have: in `txg.c` nothing moves until a
  thread's wait condition becomes true.
- **Options.** A keyframed animation with a fixed cycle; a step-by-step story like the
  copy-on-write tree; a small discrete-event model of `txg_sync_thread` and
  `txg_quiesce_thread`.
- **Choice.** The model, `src/lib/txg.ts` (about 300 lines, no dependency). Its state is the
  code's: `tx_open_txg`, `tx_quiescing_txg`, `tx_quiesced_txg`, `tx_syncing_txg`,
  `tx_synced_txg`, `tx_sync_txg_waiting`, `tx_quiesce_txg_waiting`, `tc_count[cpu][txg &
  TXG_MASK]`, `dp_dirty_pertxg`, the sync thread's `start`. Each thread is its wait
  condition, written as in the code: the sync thread sleeps while the timer runs, nobody
  waits, and no txg is quiesced (txg.c L542-L553), then asks for a quiesce (L568-L577) and
  takes the hand-off (L589-L593); the quiesce thread sleeps while `tx_open_txg >=
  tx_quiesce_txg_waiting` or a quiesced txg is still waiting (L638-L641). One transition
  happens at a time, so "Next event" shows them one by one. Every event carries the
  permalink of its lines; the list is in `ANALYSIS.md`, room "Transaction groups", "What
  the animation shows".
- **What it showed that a script would have got wrong.** (a) The next txg normally stays
  open during a sync: the quiesce thread closes a txg only when asked, and the sync thread
  asks only when it is ready. All three stages are busy only after `txg_wait_open(dp, 0,
  B_TRUE)`, whose only caller at this tag is `dmu_free_long_range_impl` (dmu.c L1101-L1106);
  hence the "Free a large file" button. `ANALYSIS.md`'s note on L593 now says so. (b) The
  quiesced-but-not-taken state (`tx_quiesced_txg`) is a state of its own, drawn as such.
  (c) The 5 s timer runs from the start of the previous sync, not its end. (d) An empty txg
  goes through the pipeline and writes no uberblock (vdev_label.c L2071-L2077). (e) `zpool
  sync` waits for the open txg + `TXG_DEFER_SIZE`, so it syncs three txgs.
- **Simplified, and why it stays faithful.** 4 CPUs (`max_ncpus` is the machine's); one
  block per write and a 20-block `zfs_dirty_data_max`, so the 20% sync threshold is 4
  blocks and reachable by clicking; durations made up and slowed (holds last microseconds,
  syncs milliseconds to seconds); the `tc_open_lock` wait of a writer during a quiesce,
  the write throttle (`dmu_tx_delay`, waits at `zfs_dirty_data_max`), scans, synctasks, the
  ZIL and suspension left out; pass sizes illustrative (three passes for a non-empty txg).
  None of these changes which states exist, their order, or the one-per-stage rule: they
  change durations and thresholds, which the page says are illustrative.
- **Checked.** Seven unit tests (`scripts/test/txg-model.test.mjs`, run by `npm test` with
  Node's type stripping) assert the invariants after every 50 ms of simulated time (never
  both quiescing and quiesced, stages ordered behind the open txg, counts never negative,
  uberblock never ahead of `tx_synced_txg`) and each path: timeout, `txg_kick`, `zpool
  sync`, empty txg, three stages only through `txg_wait_open`, consecutive synced txgs.
- **Rejected.** An `fsync` button, which the slice-0 draft of the animation proposed:
  `zfs_fsync` calls `zil_commit` (zfs_vnops.c L117-L120) and does not wait for a txg. The
  page says so and points to the ZIL room.

### D3.2 HTML cards, not SVG, for the pipeline

- **Choice.** The three stages are server-rendered sections (title and state variable), so
  the page has its layout before the script runs (no shift); the script fills each with a
  card per txg: the per-CPU counters (with one dot per write holding the txg), the dirty
  meter, or the passes. A txg card keeps its element as it changes stage, and glides there
  (a FLIP transform of 450 ms, skipped under reduced motion). Columns at 1440 px, stacked
  at 390 px.
- **Why.** The figure is mostly numbers and labels that must stay legible at 390 px; HTML
  text reflows and scales where SVG text shrinks (the known limit of the copy-on-write
  tree). Same tokens, buttons, live region, text version and `data-strings` as slice 1
  (D1.2).

### D3.3 Motion, announcements and the reduced-motion path

- No autoplay: the figure waits for "Play" or "Next event". A background tab pauses it.
- Under `prefers-reduced-motion`, cards change stage without gliding and the dots do not
  drop (duration tokens are 0, D1.3). Play still runs the clock: time is the subject of the
  figure, not a decoration, and "Next event" gives the same states with no time running.
- The live region announces every event the visitor causes; while playing it announces only
  stage changes (quiesce, hand-off, sync, commit, synced), so a screen reader is not
  flooded. The event log (last 8, each with its code link) and the text version carry the
  rest.

### D3.4 Words: "quiescing" in French, and a shared French spacing helper

- **Quiescing** is "en clôture" (a txg being closed), quiesced "clos". The slice-1 teaser
  said "en attente", which reads as "quiesced, waiting" and would collide with the real
  waiting state; it now says "Ouvert, en clôture, en synchronisation".
- The `fr()` helper of the History wing (D2.1) moved to `src/lib/fr.ts`, so the txg
  figure's strings get the same no-break spaces (D1.9).

### D3.5 Visit order

Unchanged (D0.4): Hall → History → Copy-on-write → Transaction groups; the tree room (2) is
not built and is skipped. Opening the room is one flag in `src/lib/rooms.ts`; the Hall map,
previous/next and the language switch follow from the table.

## Slice 4

### D4.1 The RAID-Z figure runs a transcription of `vdev_raidz.c`, and tracks columns, not bytes

- **Context.** The issue asks that every layout the room shows be what
  `vdev_raidz_map_alloc` / `vdev_raidz_psize_to_asize` compute for the visitor's inputs at
  `zfs-2.4.4`, and a reconstruction step "as in `vdev_raidz_combrec`".
- **Options.** (a) Hand-drawn layouts for a few presets; (b) the textbook formula
  (data + parity, rounded) and a generic picture; (c) a line-by-line transcription of the
  functions, run for any input; for the read, (c1) real bytes with GF(2^8) P/Q/R parity and
  a real checksum, or (c2) the code's decisions with each column marked right or wrong.
- **Choice.** (c) and (c2), in `src/lib/raidz.ts` (no dependency, about 380 lines).
  `mapAlloc` is `vdev_raidz_map_alloc` (L612-L740) integer for integer, including `acols` /
  `scols` for blocks narrower than the vdev, the raidz1 1 MiB swap (L725-L734), and where
  `vdev_raidz_map_alloc_write` puts the skip sectors (L509-L580: after short columns from
  `rm_skipstart`, wrapping onto parity, zero-size columns counting as one each). `psizeToAsize`
  is L2315-L2317. `readBlock` follows the read path: data columns only unless data is missing
  (L2573-L2588), known-missing rebuild (L3712-L3739), checksum, read-all (L3886-L3910),
  `combrec`'s enumeration with its sentinels (L3523-L3598), `raidz_reconstruct`'s dead count
  and `EINVAL` (L3385-L3392), the parity choice of `vdev_raidz_reconstruct_row` and
  `vdev_raidz_math.c` (first valid of P, Q, R; PQ, PR, QR), the `ECKSUM` marking of simulated
  data columns (L3403-L3428), and `vdev_raidz_io_done_verified`'s parity check and repair
  writes (L3132-L3210). The grid is HTML rendered by `src/lib/raidz-view.ts`, at build time
  for the default layout (readable without JavaScript) and in the browser for the visitor's
  choices: same function, same output.
- **Why it stays faithful.** The layout half is the code's arithmetic, not a model of it:
  nothing is simplified for a non-expanded raidz. The read half drops the bytes, which
  changes nothing the figure shows: Reed-Solomon reconstruction over GF(2^8) is exact, so a
  rebuilt column is right exactly when every column it reads is right, and the checksum
  verifies exactly when every data column is right (a forged collision is not a case the
  figure needs). Byte-level parity (c1) would have added GF tables and matrix inversion
  to compute the same yes/no.
- **Left out, and said on the page.** RAIDZ expansion (several rows,
  `vdev_raidz_map_alloc_expanded`; one line points to it); dRAID; DTL-stale columns
  (`ESTALE`, read as missing in spirit but not modelled); slow-child outliers skipped on
  purpose; gang blocks; the scrub and resilver read paths (`ZIO_FLAG_SCRUB`/`RESILVER` read
  parity and repair differently); the repair write a missing child would be sent (it cannot
  land, so it is not drawn). Inputs are bounded for legibility: psize 512 B to 128 KiB in
  512-byte steps, 2 to 16 children (at least nparity + 1, as `vdev_raidz_open` requires),
  ashift 9 to 16.
- **Checked.** 17 unit tests (`scripts/test/raidz-model.test.mjs`): eight hand-worked layouts
  (the two `ANALYSIS.md` examples, 4K and 8K on a 12-wide raidz2, 24K on a 6-wide raidz2,
  skips wrapping onto P, `r = 0` with skips on parity, start offset and wrap to child 0, the
  raidz1 swap, 6K on a 7-wide raidz3), a property test over 30,240 inputs (parity 1-3,
  2-16 children, three ashifts, 40 sizes, six offsets: `tot + nskip == asize`, `asize` a
  multiple of `nparity + 1`, and the columns plus skip sectors cover exactly the `asize`
  consecutive sectors of the vdev from `b`), and the read path: healthy read, missing
  children (P, then Q, then too many), one silent error, bad P plus bad D1 (found at the
  pair (0, 3), D1 rebuilt from Q, P regenerated and rewritten), bad parity alone undetected,
  `combrec`'s 6-wide RAIDZ3 order equal to the comment above it (L3467-L3490), and `EINVAL`
  ending the search.

### D4.2 Resilver: only what the code basis supports

`ANALYSIS.md` lacked the scan side. Added (excerpt 5 and "Resilver, as far as this room
goes"): `vdev_raidz_need_resilver` (L4011-L4037), and the path from the block-tree walk to
it (`dsl_scan_recurse` L2248-L2255 → `dsl_scan_visitbp` L2440 → `dsl_scan_scrub_cb`, birth
window L4844-L4848 and L4878-L4880 → `dsl_scan_need_resilver` L3805 →
`vdev_dtl_need_resilver` vdev.c L3184-L3194), and where a healing resilver's txg window
comes from (`vdev_resilver_needed`, dsl_scan.c L914-L915). The room says a resilver walks
block pointers, skips blocks born outside the window, and asks the vdev per block; the
figure answers that question for the current block when a child is set missing. Not
claimed: scan queues, sorting, pacing, sequential rebuild.

### D4.3 No write hole: a static figure, and the page says which half is not RAID-Z code

The write hole is the problem the room starts from; its absence in ZFS rests on two facts
of different kinds: RAID-Z writes a whole new stripe computed from the block alone
(`vdev_raidz_io_start_write` L2443-L2462, parity from the block's columns), and
copy-on-write plus the txg commit keep the old block referenced until the new tree is
committed (copy-on-write and transaction groups rooms). The second is not in
`vdev_raidz.c`; `ANALYSIS.md` and the page say so. The figure is static (three states of a
RAID-5 stripe beside three of a RAID-Z block, the RAID-Z one laid out as `mapAlloc(8K, 12,
4, 1)` computes, skip sector included): an animated power cut would add motion and no
fact.

### D4.4 Words

- "Skip sector" is the code's word (`rm_nskip`, "skip sectors"); FR "secteur de saut",
  with "bourrage" (padding) to say what it is for.
- "Child" for a raidz child vdev, as the code says (`vdev_child`); the prose says "disk"
  where the reader thinks of one. FR "enfant".
- The text says "data columns are contiguous runs of the block, not one sector per disk in
  turn", the correction of `ANALYSIS.md` ("What the code says that common accounts get
  wrong").

### D4.5 Visit order

Unchanged (D0.4): Hall → History → Copy-on-write → Transaction groups → RAID-Z; the tree (2)
and vdevs (5) rooms are not built and are skipped. RAID-Z is the last open room, so its
"next" is the end-of-visit note.

## Slice 5

### D5.1 Code basis first: what was added to `ANALYSIS.md`, and what was left out

- **Context.** `ANALYSIS.md` covered birth time, `dsl_dataset_block_kill` and snapshot
  creation, not clones, the deadlist structure or snapshot destroy, and the issue asks for
  each claim to map to an excerpt or a line reference at `zfs-2.4.4`, or to be left out.
- **Added** (room "Snapshots and clones"), five excerpts and their notes:
  `dsl_deadlist_insert` (dsl_deadlist.c L487-L501, entries keyed by `mintxg`, "not
  inclusive"); the deadlist hand-off in `dsl_dataset_snapshot_sync_impl` (dsl_dataset.c
  L1830-L1839, with L1881-L1884); clone creation in `dsl_dataset_create_sync_dd`
  (L1213-L1227, with L1243-L1265 and dsl_dir.c L269-L270); `dsl_pool_sync`'s order, datasets
  before sync tasks (dsl_pool.c L747-L760, L845-L854); snapshot destroy
  (dsl_destroy.c L387-L424, with `dsl_deadlist_move_bpobj`, `dsl_deadlist_insert_bpobj`,
  `dsl_deadlist_remove_key`, `dsl_dir_remove_clones_key` and the `EEXIST` check). Also: where
  a block's birth is set (`metaslab_alloc` L6061), the three callers of the kill
  (`dbuf_write_done`, `dmu_objset_write_done`, `free_blocks`) and the pending-deadlist path,
  `EAGAIN` for a second snapshot in one txg, where a new filesystem's keys start (`$ORIGIN`,
  `crtxg = 1`), a hand-checked sequence of eight txgs, and a correction in "What the code
  says that common accounts get wrong": a snapshot's deadlist holds blocks the *previous*
  snapshot references, not "the blocks only it owns".
- **Left out, logged here, one line on the page at most:** bookmarks (`dsl_bookmark.c`, the
  `book_exists` branch of destroy); `zfs promote` (`dsl_dataset_promote_sync`, one link);
  livelists (clone destroy); space accounting (`ds_unique_bytes`, `used`, `snapused`);
  async destroy of a head; holds and deferred destroy; old-format deadlists
  (`process_old_deadlist`, one link). None changes whether a block is freed or kept by the
  operations the room shows.

### D5.2 The figure runs a transcription of the DSL code, over a small pool

- **Context.** Every free/deadlist outcome and owner range the room shows must match
  `dsl_dataset_block_kill` and birth-txg semantics at the tag, including a block born in the
  same txg as a snapshot and an overwrite inside a clone.
- **Options.** (a) Scripted scenes; (b) a model of "snapshots share blocks" with reference
  counts, drawn to look like ZFS; (c) a transcription of the functions, run on whatever the
  visitor does.
- **Choice: (c), `src/lib/snapshots.ts`** (no dependency, about 400 lines). `kill` is
  `dsl_dataset_block_kill`'s comparison and its two branches; `dlInsert`, `dlClone`,
  `dlAddKey`, `dlRemoveKey`, `dlMoveBpobj`, `dlMerge` are the `dsl_deadlist.c` functions on
  sorted entries; `snapshot`, `makeClone` and `destroy` follow the sync functions line by
  line (the comments give the lines); `sync` runs a txg in `dsl_pool_sync`'s order: each
  dataset's changes, a new root, the kills against `ds_prev_snap_txg` as it was before the
  txg's snapshots, then the sync tasks in the order asked. Datasets start as the code makes
  them: `fs` from `$ORIGIN`, `ds_prev_snap_txg` 1, deadlist keys {0}. `src/lib/snapshots-view.ts`
  draws a state as HTML, at build time for the opening state (txgs 8 to 10 of the
  hand-checked sequence, readable without JavaScript) and in the browser after.
- **What it simplifies, and why it stays faithful.**
  - The objset, dnodes and indirect blocks are one root block per dataset. In the code each
    is rewritten in every txg its dataset changes and killed through the same function
    (`dmu_objset_write_done`, `dbuf_write_done`), so one block with the same birth stands for
    the path; the room's text says so.
  - Four data blocks; a slot changes at most once per txg: the figure refuses a second
    change to a pending slot rather than model dirty records, and says it is pending. (What
    the code does with two writes to one buffer in one txg is not in the code basis, so the
    room says nothing about it.)
  - Up to four snapshots of `fs`; one clone, which can be written but not snapshotted or
    destroyed (so no clone of a clone, no clone livelist, no `after_branch_point` cases
    beyond `$ORIGIN`). The destroy of a snapshot older than the clone's origin does remove
    its key from the clone, as `dsl_dir_remove_clones_key` does.
  - Blocks moved to `dp_free_bpobj` (snapshot destroy) are drawn as freed at once; the code
    frees them in later txgs. Deferred frees of gang, dedup and BRT blocks are not modelled:
    they take the "free" branch and only defer the I/O.
  - No space accounting, holds, deferred destroy, bookmarks, old-format deadlists.
- **Checked.** 12 unit tests (`scripts/test/snapshots-model.test.mjs`): the hand-checked
  sequence of `ANALYSIS.md` txg by txg; the opening state; a block born in the same txg as a
  snapshot (held, deadlist on a later kill, since the test is strict); a block killed in the
  txg of a snapshot (not in it: kills run before sync tasks); `EAGAIN`; an overwrite inside
  a clone (shared blocks to the clone's deadlist, the clone's own freed, `fs` untouched);
  destroying the latest snapshot and a middle one older than a clone's origin (keys removed
  from the head and the clone); `dsl_deadlist_insert`'s exact-key and panic cases; and a
  property test over 400 random sequences of 30 txgs (12,000 txgs): no block freed while a
  dataset's tree references it, no block on disk that none references, every deadlist
  entry well formed (`key < birth <= next key`, born at or before the dataset's
  `ds_prev_snap_txg`, referenced by the previous snapshot and not by the dataset), and the
  owner range computed from birth txgs equal to the actual references.

### D5.3 "Which snapshot owns this block": computed from birth txgs, checked against the trees

Nothing in ZFS stores the answer, so the figure derives it the way the code's invariants
allow: a block of `fs` born in txg B and killed in txg K is held by the snapshots of `fs`
created in txgs B to K − 1 (sync tasks run after the kills of their txg, `dsl_pool_sync`
L747-L753), the head if it has not killed it, and the clone if its origin is in that range
and it has not killed it. The panel shows that range, the datasets whose tree holds the
block, where the block sits on deadlists, and, for a live block, what `dsl_dataset_block_kill`
would do now with the head's current `ds_prev_snap_txg`. The property test checks the range
against the trees on every state it reaches.

### D5.4 Interaction: queue in the open txg, then sync

- **Options.** (a) Every click applies at once, one txg per action; (b) the visitor queues
  changes and tasks in the open txg, then syncs it.
- **Choice: (b).** The same-txg cases are the point of the room's strict `>` (a block born
  in the txg of a snapshot is held by it; a block killed in that txg is not), and they only
  exist if two things can happen in one txg. The sync's log lists every birth, every kill
  with its two numbers and its outcome, and each sync task, each line with a link to its
  code. Motion: chips that move (to a deadlist, into a new snapshot or clone row) slide from
  where they were (FLIP with the Web Animations API, no library); freed blocks stay one sync
  in a "Freed in txg N" tray, struck through. With `prefers-reduced-motion`, nothing moves
  and the log appears at once. Every block, empty slot and action is a button; the figure is
  driven by Tab and Enter, and focus stays on the same control after each re-render.

### D5.5 Words

- "Kill" is the code's word (`dsl_dataset_block_kill`); the room explains it once ("lets go
  of a block"). FR « tuer », in quotes the first time.
- "Deadlist" is kept in French, as in the copy-on-write room (`deadlist du dataset`).
  Entries are written "&gt; k": the code says a key "is not inclusive", and the entry holds
  blocks born after `k`.
- "Head" for the writable dataset of a directory, as the code says (`dd_head_dataset_obj`,
  `ohds`); FR « tête ».

### D5.6 Visit order

Unchanged (D0.4): Hall → History → Copy-on-write → Transaction groups → RAID-Z → Snapshots
and clones; the tree (2) and vdevs (5) rooms are not built and are skipped. Snapshots and
clones is the last open room, so its "next" is the end-of-visit note, and RAID-Z's "next" is
now this room, in both languages.

## Slice 6

### D6.1 Code basis first: what was added to `ANALYSIS.md`, and what was left out

- **Context.** `ANALYSIS.md` had three ARC excerpts (the MRU branch of `arc_access`, the
  ghost-hit counters and the eviction order of `arc_evict`) and described the ghost
  branches, `arc_evict_adj`, the ghost caps and the L2ARC in prose only. The issue asks for
  each claim of the room, and each transition the figure shows, to map to an excerpt or a
  line reference at `zfs-2.4.4`.
- **Added** (room "The ARC"), six excerpts and their notes: the ghost branches of
  `arc_access` (arc.c L5429-L5449, L5450-L5472); `arc_evict_adj` (L4405-L4442), with a
  worked example of one ghost hit; the ghost-list trim of `arc_evict` (L4558-L4587);
  `arc_evict_hdr`'s live-to-ghost path (L3876-L3891, with L3828-L3830 and the ghost
  branch L3786-L3826); the miss path of `arc_read` (L6198-L6208); the L2ARC design comment
  (L8261-L8274). Line references for: the hit path (L6020-L6025); list order (head
  insertion `multilist.c` L184 through `remove_reference` L2369, `add_reference` L2334-L2338,
  `arc_change_state` L2473-L2493, eviction from the tail L4180, L3922-L3924); `arc_evict_impl`
  (L4386-L4398); when eviction runs (`arc_get_data_impl` L5251-L5252,
  `arc_is_overflowing` L5099-L5100, `zfs_max_recordsize`, the thread L4876-L4877,
  L4895-L4896); `arc_c` growth and its limits (`arc_adapt` L5056-L5082, block sizes in
  `zfs.h`); sublists (L7518-L7543, L4205-L4213); the prefetch lifetime (L3832-L3839); the
  L2ARC feed (L9771, L9791, L9491, L9530-L9538, L4928-L4931). "What the animation shows"
  is rewritten to match the figure, two facts and a hand-checked sequence are added, and
  `ARC_MINTIME`'s strictness and the fact that `b_arc_access` is refreshed only on promotion
  are written out (L5423-L5428).
- **`arc_p`.** The room says once that there is no `arc_p` in 2.4.4 and what replaces it;
  no text uses it as current.
- **Left out, logged here:** how `arc_c` shrinks (`arc_reduce_target_size`, one link) and
  memory pressure in general; dnode pruning (L4503-L4525, metadata only); the uncached
  state and prefetch beyond one sentence each; compressed and encrypted copies; L2ARC
  internals beyond the coda (write sizes, headroom, rebuild, persistent L2ARC). None
  changes a transition the figure shows.

### D6.2 The figure runs a transcription of `arc_access` and `arc_evict`, on data blocks only

- **Context.** Every transition the simulator shows must match `arc_access`, `arc_evict`
  and `arc_evict_hdr` at the tag: a scan over a hot set, a ghost hit in each ghost list and
  the direction the balance moves, a re-read within `ARC_MINTIME`. 2.4.4 is not textbook
  ARC: there is no `arc_p`, the balance is three fixed-point fractions moved by
  `arc_evict_adj`, and the ghost lists are capped at half of the other lists.
- **Options.** (a) Textbook ARC (T1/T2/B1/B2 with one target `p`), drawn as ZFS;
  (b) a scripted animation of a few scenes; (c) a transcription of the 2.4.4 functions, run
  on whatever the visitor reads.
- **Choice: (c), `src/lib/arc.ts`** (no dependency, about 280 lines). `read` is
  `arc_read`'s two paths: a hit calls the `arc_access` branch of its state; a miss, new or
  ghost, runs `arc_access` first (ghost hits counted in bytes into `arcs_hits`), then an
  eviction pass if the cache is over `arc_c`. `evict` is `arc_evict` line by line;
  `evictAdj` is `arc_evict_adj` in `BigInt`, masked to 64 bits where the C shifts; the
  `static` counters and ghost targets are kept in the state. `src/lib/arc-view.ts` draws a
  state as HTML, at build time for the opening state (readable without JavaScript) and in
  the browser after.
- **What it simplifies, and why it stays faithful.**
  - **Data only.** Every block is a data block of 128 KiB, uncompressed (`arc_hdr_size` =
    logical size). The metadata lists are empty, so `mrum` = `mfum` = 0 and the code is run
    with those terms at zero: the two metadata eviction steps evict nothing (their `e` is
    negative), `wt` is not reduced at L4544, and the ghost caps become half of MFU (MRU
    ghost) and half of MRU (MFU ghost). `arc_meta` and `arc_pm` still move in the code, but
    with no metadata they change no data target, so they are not drawn. Showing data and
    metadata faithfully would need metadata blocks with their own reads; that doubles the
    lists for no new idea, so they are collapsed, and the page says so. Consequence, shown
    as it is: with an empty MFU the MRU ghost list holds nothing (L4569).
  - **One list per state**, exact order of last release. The code hashes headers over
    sublists and evicts round-robin from a random one (L7518-L7543, L4205-L4213), so its
    order is approximately this one.
  - **One eviction pass right after each miss** that puts the cache over `arc_c`, with the
    block just read still held (counted in the size, not evictable, as `add_reference`
    makes it), and released to the head after. The code wakes an asynchronous thread past
    `arc_c + zfs_max_recordsize` (16 MiB, eight times the figure's whole cache) and loops
    until under `arc_c`. With blocks of one size the pass always finds the cache one block
    over and brings it back to `arc_c`, which is what the thread converges to; since a
    pass consumes the ghost hits accumulated since the previous one, running one per miss
    is the fastest adaptation the code allows (each pass moves a fraction by at most about
    1/32, L4417-L4421).
  - **`arc_c` fixed** at 16 blocks: `arc_adapt` returns once `arc_c` is at `arc_c_max`
    (L5069-L5070). Growth and shrinkage are another control, not driven by ghost hits; the
    page says so with links.
  - **Logical clock** in ms, `ARC_MINTIME` = 62 (the code's comment, `hz >> 4`); one second
    before each visitor action, or 10 ms if chosen; 1 ms between the reads of a scan or of
    the hot set.
  - **The reader releases each block at once** (no dbuf cache holding it); no read in
    flight; no prefetch (so no `ARC_FLAG_PREFETCH` branches, no minimum lifetime), no
    uncached or anon (dirty) buffers, no dnode pruning, no L2ARC (`l2c_only`).
  - **Scale.** 16 blocks. Sizes are bytes, so the `total < 32` early return of
    `arc_evict_adj` only bites before the first ghost targets exist, as in the code.
- **Checked.** 12 unit tests (`scripts/test/arc-model.test.mjs`): the hand-checked sequence
  of `ANALYSIS.md` step by step (opening; a scan over the hot set, first pass without
  adjustment; an MRU-ghost hit, `arc_pd` 2^31 → 2^31 + 2^27, MRU target 8 → 8.5 blocks;
  promotions; MFU giving up its tail when MRU is under its target; an MFU-ghost hit back to
  2^31); `ARC_MINTIME` (10 ms and exactly 62 ms stay in MRU and do not refresh
  `b_arc_access`, 63 ms promotes); an MFU hit; a forgotten block read again (new MRU, no
  ghost hit); `arc_evict_adj` on seven hand-computed cases (early returns, scaling, the
  shift for a large total, the slow-down near the ends, balance 500); and a property test
  over 300 random sequences of 80 actions: every transition as `arc_access`, no pass on a
  hit, the direction of `arc_pd` (never down on MRU-ghost hits alone, never up on MFU-ghost
  hits alone), the cache never over `arc_c`, ghost lists within their caps, every header
  in exactly one list.

### D6.3 Interaction and drawing

- **Lists, not a ring.** Four boxes, MRU ghost | MRU | MFU | MFU ghost on desktop (the
  usual left-to-right picture), MRU and MFU first on a phone (two columns); each list from
  head to tail, labelled. A gauge of 16 cells above shows MRU from the left, MFU from the
  right, and the MRU target as a line that moves with `arc_pd`. A "Forgotten" tray keeps
  the last eight headers destroyed from a ghost list, so the visitor can read one again and
  see that it is a new block, not a ghost hit.
- **Actions.** Read a new block, scan 12 new blocks, read the hot set again, select any
  block (cached, ghost, forgotten) to read it, start again; a choice of one second or 10 ms
  before the next read, for `ARC_MINTIME`. The log lists, for the last action, each read
  with its outcome, each pass with its ghost hits, `arc_pd` before and after and the MRU
  share, each eviction and each trim, each line with a link to its code.
- **Opening state.** The hot set H1 to H6 read twice, a second apart: all six in MFU, the
  cache not full. The first scan then shows the point of the room.
- **Motion.** Chips that change list slide from where they were (FLIP with the Web
  Animations API, as in slice 5), new ones fade in, the target line slides. With
  `prefers-reduced-motion`, nothing moves and the log appears at once. Every chip and
  control is a button or a radio; focus stays on the same block after a re-render.

### D6.4 Words

- MRU and MFU, `arc_c`, `arc_pd` and `ARC_MINTIME` are kept as the code names them, in both
  languages. "Ghost list" / « liste fantôme »; "ghost hit" / « succès fantôme »; "hit" /
  « succès »; a miss is « un échec ». "Header" / « en-tête ». "Head" and "tail" of a list /
  « tête » et « queue ». "Evict" / « évincer », « éviction ». "Hot set" / « ensemble
  chaud ». "Scan" / « parcours ». The code's comment is quoted in English in both pages.

### D6.5 Visit order

Unchanged (D0.4): … → RAID-Z → Snapshots and clones → The ARC; the tree (2) and vdevs (5)
rooms are not built and are skipped. The ARC is the last open room, so its "next" is the
end-of-visit note, and Snapshots and clones' "next" is now this room, in both languages.

### D6.6 Preload the body font

- **Context.** Lighthouse on the ARC room's preview gave CLS 0.111 on `/en/arc/`, stable over
  three runs: the lead paragraph is 29 px taller in the fallback font than in Inter at the
  mobile size, and on this page nothing above it changes with the font, so the paragraph
  under it moves when Inter arrives. Other rooms hide it by chance (their title reflows
  too); it is the same swap on every page.
- **Options.** Rewrite the lead until it wraps the same in both fonts (fragile, per
  language and width); fallback metric overrides (`size-adjust` and friends) for Inter;
  preload Inter's Latin file.
- **Choice: preload** (`Base.astro`, one `<link rel="preload">` to the same hashed file the
  CSS uses, so no second download). On a local build: CLS 0 on `/en/arc/`, `/fr/arc/`,
  `/en/snapshots/` and the Hall, Performance up (ARC EN 91 → 96, Hall 99), LCP unchanged.

## Slice 7

### D7.1 Code basis first: what was added to `ANALYSIS.md`, and what was left out

- **Context.** `ANALYSIS.md` had three excerpts for the room (`metaslab_block_alloc`, the
  space-map branch of `metaslab_sync`, `space_map_write_seg`) and described dynamic fit, the
  deferred frees, the load and the condense in prose only. The issue asks for every claim and
  every move of the figure to map to an excerpt or a line reference at `zfs-2.4.4`.
- **Added** (room "Metaslabs and space maps"), eleven excerpts with notes: the word choice of
  `space_map_write_impl` (space_map.c L704-L739), `space_map_write_intro_debug` (L529-L543),
  the entry layouts (space_map.h L104-L140) and the encoding macros (L175-L203),
  `metaslab_block_picker` (metaslab.c L1770-L1802), `metaslab_df_alloc` (L1905-L1931), the
  deferred frees of `metaslab_sync_done` (L4624-L4638), `space_map_load_callback`
  (space_map.c L401-L416), `metaslab_should_condense` (metaslab.c L3835-L3861),
  `space_map_estimate_optimal_size` (space_map.c L1033-L1069) and the rewrite of
  `metaslab_condense` (metaslab.c L3994-L4013). Line references for the rest: metaslab
  sizing (vdev.c L3006-L3026), `sm_shift` = `ashift` (L2920-L2921), the size-tree fallback
  (L1933-L1954), range-tree merging and histogram (range_tree.c L387-L394, L131-L132),
  frees in syncing context (L5518-L5528), the early return of `metaslab_sync`
  (L4279-L4284), the condense call (L4363-L4365), padding (space_map.c L615-L631),
  `BF64_ENCODE` (bitops.h L46-L48), the load (L2514, L2529-L2531, L2649-L2652),
  `spacemap_v2` activated on enable and `zpool create` enabling every feature, the log space
  map's design comment (spa_log_spacemap.c L36-L52). "What the animation shows" is rewritten
  to match the figure, and a hand-checked sequence gives every word in hexadecimal.
- **Left out, logged here:** metaslab weights and activation, the rotor over vdevs and
  `metaslab_aliquot`, allocation throttling and the log space map's flushing policy (as
  `ANALYSIS.md` already said); gang blocks, ditto copies, checkpoints, trim, the space map's
  histogram and the `ms_unflushed_*` trees. None changes an entry the tape shows.

### D7.2 The figure runs a transcription of metaslab.c and space_map.c, on one metaslab

- **Context.** QA replays a write then a delete, a long run that needs a two-word entry, a
  load, a condense refused then accepted. Every word on the tape must be what
  `space_map_write_seg` would write, and the condense button must follow
  `metaslab_should_condense`.
- **Options.** (a) A tape of labelled cells with no real encoding; (b) a scripted sequence;
  (c) a transcription run on whatever the visitor does, at real sizes.
- **Choice: (c), `src/lib/metaslab.ts`** (no dependency). Real sizes and constants: a vdev of
  `vdev_asize` 8 GiB, `ashift` 12, so 16 metaslabs of 512 MiB; `sm_shift` 12; space map
  blocks of 16 KiB; `zfs_condense_pct` 200, threshold 4 records; `SM_RUN_MAX` 2^15 units,
  128 MiB. Words are `BigInt`, built with `BF64_ENCODE` as the macros do. Dynamic fit is
  `metaslab_df_alloc` and `metaslab_block_picker` with their thresholds; the size-tree
  fallback picks the smallest segment that fits, lowest offset among equals.
  `src/lib/metaslab-view.ts` draws a state, at build time for the opening state (readable
  without JavaScript) and in the browser after.
- **What it simplifies, and why it stays faithful.**
  - **No log space map.** The 2.4.4 default writes each txg's changes to a pool-wide log and
    flushes metaslabs later (L4373-L4396). The figure takes the other branch of the same
    `if` (L4397-L4404): the metaslab's own map, written every txg. The entries, their
    encoding, the load and the condense are the same code either way; the log only delays
    and gathers them (in two-word entries with a vdev id). The page has a coda that says so.
  - **One metaslab** (no. 2, so that offsets on the tape are visibly relative to
    `ms_start`). Which metaslab an allocation goes to (weights, activation, the rotor) is
    another mechanism; a write that does not fit is refused instead of moving on.
  - **One txg in flight, one sync pass.** The open txg is synced at once when the visitor
    asks; quiescing is the Transaction groups room's subject. So `ms_allocating` has one tree
    in use and the debug words say pass 1. The deferred trees still follow `txg % 2` exactly.
  - **128 KiB blocks only**, so one dynamic-fit cursor (`ms_lbas[17]`); a file is a list of
    blocks, and blocks allocated one after the other merge into one extent, as the range tree
    merges them.
  - **Frees in the txg of the delete.** The code frees in syncing context; the figure puts a
    deleted file's blocks into `ms_freeing` of the open txg, which is the txg whose sync
    frees them. A file that changed in the open txg cannot be deleted until it is synced
    (otherwise the code would take the `metaslab_unalloc_dva` path).
  - **Load on a clean txg**: unload then load, as `metaslab_load_impl` does on a map whose
    synced length is its length.
  - **Condense.** The code condenses at sync pass 1 of a txg that writes to the map, when
    `metaslab_should_condense` says yes (L4363-L4365, L4279-L4284). The figure does the same
    at every sync, including the Condense button's, which only adds the refusal and its
    reasons, or says that the txg has nothing to write. The rewrite workload (a 64 MiB
    database, 128 random blocks rewritten per txg, a seeded generator) stops before such a
    sync, so the condense is seen; about 70 txgs reach the 64 KiB threshold.
- **Checked.** 17 unit tests (`scripts/test/metaslab-model.test.mjs`): one-word, two-word and
  debug words against values computed by hand from the macros (including `SM_RUN_MAX`,
  `SM2_RUN_MAX` and `SM_NO_VDEVID` masked to 0); the hand-checked sequence of `ANALYSIS.md`
  word by word (A and B, the delete of A and its two txgs of deferral, the 160 MiB two-word
  entry, the refusal at 96 bytes, dynamic fit past a hole then the size fallback, the
  condensed map's 13 words and its replay); the condense test on hand-built trees; the
  optimal-size estimate at the one-word/two-word boundary; padding before a two-word entry
  at a block boundary; the rewrite workload; and properties over 200 random sequences
  (every byte accounted once, replay of a clean map = free tree plus deferred frees,
  `smp_alloc` = what the replay leaves allocated, every word decodes to its entry).

### D7.3 Interaction and drawing

- **Four layers, top to bottom:** the vdev as 16 cells; metaslab 2 as a bar (free, allocated,
  allocated in the open txg, freed in the open txg, deferred, the cursor); the in-core trees
  and the files; the tape, then the selected entry's bits, then the two tests of
  `metaslab_should_condense` with a meter towards 64 KiB.
- **The tape** draws the whole map while it has at most 32 entries; past that, its first
  three entries (where a condensed map starts: the ALLOC of the whole metaslab) and the last
  29, with the number of words in between. One-word cells are half the width of two-word
  cells; debug words are dashed. Every entry is a button; arrow keys move along it.
- **The bits** are drawn in the header's order, each field as wide as its bits, with its
  value in hexadecimal and a sentence that says what the entry means and why it has one word
  or two.
- **Load** is drawn: the bar empties, then fills as the tape is replayed (at most 36 frames),
  then the deferred trees are taken out and the result is compared with the tree before.
- **Motion and access.** New words slide in, one after the other; with
  `prefers-reduced-motion` nothing moves and Load is immediate. Labels, ticks and the cursor
  are HTML over the SVG bar so they do not stretch on a phone. Every control is a button;
  focus stays on the same control after a re-render (or goes to Sync when a delete button
  disappears).

### D7.4 Words, and the French rules carried over from ALG-87

- "Space map", "metaslab", "dynamic fit", "extent", ALLOC and FREE, and the code's names are
  kept as the code names them, in both languages. "Free tree" / « arbre libre »; "deferred" /
  « différé »; "condense" / « condenser », « condensation »; "load" / « charger »; "run" /
  « longueur » in prose, `run` in the bit fields; the header's comment is quoted in English
  in both pages.
- **Counts in French** are singular for 0 and 1, plural from 2, in this room and in the ARC
  room's figure (`arc-view.ts`): every count with a unit now goes through one helper,
  including "au plus {n}" under the ghost lists, the MRU target and the ghost targets.
- **No elision before a code name** in French: « de <code>arc_p</code> », « de
  <code>ARC_MINTIME</code> », never « d’<code>arc_p</code> ». The two elided cases in the ARC
  room are rewritten; a search finds no other in the site.
- **QA round 1 on ALG-91**: the counts that bypassed the helper (« et 1 autres », « 1 entrée
  rejouées », « 0 octet libres », the padding words, `smp_length`, the cursor picks) now go
  through it, and the words that would have to agree with a number are reworded away
  (« libre : {free} », « la map est rejouée ({n}) », « décalage {off}, en unités de 4 Kio »).
  The room's strings moved from `MetaslabLab.astro` to `src/lib/metaslab-strings.ts` so that
  `scripts/test/metaslab-view.test.mjs` can draw every log line with counts 0, 1 and 2 in both
  languages and fail on a noun that disagrees.

### D7.5 Visit order

Unchanged (D0.4): … → Snapshots and clones → The ARC → Metaslabs and space maps. This room
is the last open one, so its "next" is the end-of-visit note, and the ARC's "next" is now this
room, in both languages.

## Slice 8

### D8.1 Code basis first: what was added to `ANALYSIS.md`, and what was left out

- **Context.** `ANALYSIS.md` had three excerpts for the room (`zil_commit_impl`,
  `zil_lwb_write_issue`, `zio_alloc_zil`) and named `zil_write_state`, the lwb states, the
  claim and the replay by line only. Reading the code at `zfs-2.4.4` for the figure showed
  that `zil_write_state` also depends on `commit` (the file opened with `O_SYNC`/`O_DSYNC`,
  or `sync=always`) and on whether the write covers half a block, and that `zfs_log_write`
  downgrades WR_COPIED over 7680 bytes: neither was in `ANALYSIS.md`, and a plain
  `write()` + `fsync()` is `commit` false, so a 4 KiB fsync'd write is WR_NEED_COPY, not
  WR_COPIED.
- **Added** (room "ZIL and SLOG"), seven excerpts with notes: `zfs_log_write` (zfs_log.c
  L627-L649), `zil_write_state` (zil.c L2212-L2246), `lwb_state_t` (zil_impl.h L83-L92),
  `zil_lwb_assign` (zil.c L2334-L2369), `zil_sync` (L4206-L4224), `zil_claim`
  (L1232-L1253), `zil_replay_log_record` (L4696-L4712). Line references for the rest: the
  `commit` flag and the commit in `zfs_write` (zfs_vnops.c L756-L757, L1091-L1092), Direct
  I/O (L1042-L1043, L1450-L1458), `zfs_get_data` and `dmu_sync` (L1381-L1397,
  L1467-L1468), `spa_has_slogs` (spa_misc.c L2741-L2744), each state transition (zil.c
  L1493, L1605, L1758, L1880, L1931, L1972, L2113), the waiters woken at flush done
  (L1508-L1524), the lwb closed at once with one writer (L3375-L3379), `zil_create`
  (L1022-L1023), record sizes (zil.h L92-L97, L217-L222, L353-L362; zil.c L1783,
  L2164-L2167), `zil_clean` (L2862), `zil_parse` and `zil_claim_write` (L499-L572,
  L634-L655), the mount (zfs_vfsops.c L795-L801) and `zil_destroy` (zil.c L4801-L4803,
  L4822-L4823). "What the animation shows" is rewritten to match the figure; the facts give
  the write state for every case of the figure, and hand-checked cases give every block,
  record and byte count the unit tests check.
- **Left out, logged here:** the special-vdev branch of `zil_write_state` (L2233-L2238) is
  in the model and its tests, but the figure's pool has no special vdev, so it is never
  taken on the page (the page says so); `zil_slog_bulk` priorities, Slim ZIL layout,
  encryption, the commit timeout, flush trees per vdev, I/O errors and the
  `txg_wait_synced` fallback, as `ANALYSIS.md` lists. No SLOG speed is claimed: the page
  says the code decides where a block goes, not how fast the device is.

### D8.2 The figure runs a transcription of zil.c, on one file

- **Context.** QA replays a small sync write without SLOG, a large write with and without
  SLOG, `logbias=throughput`, a crash before the txg sync then replay, a crash after the
  sync (nothing to replay). The write state shown must be `zil_write_state`'s for every
  toggle, the allocation order `zio_alloc_zil`'s, and the replay must bring back exactly the
  records not yet synced.
- **Options.** (a) A scripted animation of the five cases; (b) a transcription run on
  whatever the visitor does.
- **Choice: (b), `src/lib/zil.ts`** (no dependency). `zilWriteState` is `zil_write_state`
  line for line (including the special branch); `logWrite` is `zfs_log_write`'s loop (the
  downgrade, one indirect record per file block); `allocZil` tries the five classes in
  `zio_alloc_zil`'s order; the commit is `zil_lwb_assign` (with its fit and split rule and
  `zil_max_waste_space`) followed by close, ready, the next block's allocation, issued,
  write done, flush done; `sync` is the txg's writes made durable, `zil_clean` and the
  `zil_sync` loop; `crash`, `importPool` (`zil_claim` with `zil_parse`'s counts) and `mount`
  (`zil_replay` with `zil_replay_log_record`'s two filters, then `zil_destroy`).
  `src/lib/zil-view.ts` draws a state, and each step of a commit, at build time for the
  opening state and in the browser after.
- **What it simplifies, and why it stays faithful.**
  - **The first commit on a new log waits for a txg, as in the code** (QA round 1, item 1;
    the first version missed it). On a hole `zh_log`, `zil_create` allocates a 4 KiB
    (`ZIL_MIN_BLKSZ`) block in a tx and waits for that txg to sync (L1011-L1056); the itxs on
    the commit list are then of a synced txg and destroyed (L3209, L3280-L3283), and only the
    commit waiter goes into lwb 1. The model does exactly this (`create`, `createWait`, the
    sync, `dropSynced`, then lwb 1 with no record), and `fsync()` returns "through the txg
    sync, not through a record". Options considered: (a) model the wait, starting from the
    fresh pool; (b) start from a chain that already exists. Chosen: (a), because the wait
    also happens after every replay (the log is destroyed whole), and it is what
    `keep_first` exists to avoid (L1074-L1078): drawing it explains both. The page tells the
    visitor to fsync once before the crash-and-replay scenario. A consequence: a 4 KiB
    first block never holds a record in the figure (after a create it holds only the waiter;
    after a sync it is freed, and a kept block is the head of the chain then, a 128 KiB one).
  - **Every later log block is 128 KiB** (`zil_maxblocksize`). The code sizes each block
    after the first from the burst (`zil_lwb_plan`, `zil_lwb_predict`). With a fixed size,
    where a WR_NEED_COPY record splits is predictable and checkable by hand (a 128 KiB record:
    130,696 bytes then 376); the rules shown (records in order, WR_COPIED never split,
    WR_NEED_COPY split, each block chained to the next) hold for any size. The byte counts
    are those of 128 KiB blocks, which the page says; which writes are replayed does not
    depend on the sizes.
  - **One file, one writer.** With `!zl_parallel` the code closes and issues the lwb holding
    a commit at once (L3375-L3379), so the commit timeout never fires: not a simplification
    for this case, the figure's only case.
  - **Each `write()` starts at the beginning of a file block** (block `n` for write `n`), so a
    WR_INDIRECT write is one record and `zfs_log_write`'s cut at each block (L648-L649) is
    covered by a unit test rather than drawn. The file already spans several records, so its
    blocks are 128 KiB (`recordsize`): for a file of a single block, `zfs_write` sizes the
    block to the file (zfs_vnops.c L808-L821) and the half-block rule would use that size
    (a first 48 KiB `O_DSYNC` write to an empty file is WR_INDIRECT without a SLOG). The page
    says so.
  - **`O_DIRECT` is the Direct I/O path only for the 128 KiB write**, as
    `zfs_setup_direct` decides (zfs_vnops.c L296-L299: a write shorter than the file's block
    goes through the ARC, `o_direct` stays false). The model applies it (`directPath`) and
    the decision panel says why a short `O_DIRECT` write is not indirect. (Found by the code
    review: the first version treated every `O_DIRECT` write as Direct I/O.)
  - **A log with nothing to replay keeps its first block.** `zil_replay` calls
    `zil_destroy(keep_first)` (L4801-L4803); `zil_sync` names that block again in the
    emptied header under a new chain GUID (L4181-L4192), and the next `zil_create` uses it
    without allocating (L1004-L1011). The model does the same (`kept`); after a replay the
    chain is freed and `zh_log` is a hole. (Also found by the code review.)
  - **When the in-place block is drawn.** For a buffered WR_INDIRECT write, `dmu_sync`
    writes the block when the lwb is filled (`zil_lwb_commit`, just before
    `LWB_STATE_READY`, L1950-L1972); for a Direct I/O write it was written by the write
    itself. The figure draws both just before "ready": the timing differs for Direct I/O,
    never the outcome (the record points to a block written before the log block that
    holds it).
  - **One txg in flight, synced at once in one pass**, without quiescing (the Transaction
    groups room's subject). Allocation txgs are the open txg, so an lwb's block is freed in
    the sync of the txg it was written in, as `zil_sync` does when nothing else is in
    flight. Because the figure syncs only on demand, a record of an already synced txg is
    never left in the chain, so `zil_replay_log_record`'s txg filter skips nothing on the
    page; the model applies it and the random-sequence test checks that the replayed set is
    exactly the logged records of unsynced txgs.
  - **No I/O error and no interrupted replay**: `zh_replay_seq` stays 0, the error fallback
    to `txg_wait_synced` is not drawn.
  - **Statuses of a write**, drawn for the visitor: in memory, in the log, in the tree
    (its txg synced), replayed, lost (neither synced nor logged). A `write()` without
    `fsync()` then a power cut is lost, which `fsync()`'s contract allows.
- **Checked.** 17 unit tests (`scripts/test/zil-model.test.mjs`): the record and block sizes
  (192, 184, 130,888, 130,696, 7680, 8168); the 96 combinations of log device × logbias ×
  size × `O_DSYNC` × `O_DIRECT` against a table written from the code by hand; the
  boundaries (32,767 / 32,768 bytes, half a block, 7680 / 7681), the special branch and
  one indirect record per block; the class order with every fallback; the hand-checked
  cases of `ANALYSIS.md`, derived from the code and not from the model (QA round 1, item 5):
  the first commit on a hole `zh_log` as a full event list (a 4 KiB block, the txg wait, the
  itx dropped, no record, `lrc_seq` still 0), a commit on the existing chain that logs, a
  crash right after the first commit (2 blocks, 0 records, `ZIL_REPLAY_NEEDED`), the wait
  again after a replay, the kept block reused without a wait; then (lwb states in order, the next block allocated
  before "issued", `fsync()` returning after flush done, the split 128 KiB record on a
  SLOG, claim counts and `ZIL_REPLAY_NEEDED`, replay, nothing to replay after a sync, a
  write never fsynced lost); refusals out of order; and 300 random sequences (lwb states
  never go backwards along the list, records in order, every replay = the logged writes of
  unsynced txgs, synced writes stay, unlogged ones are lost, a commit that creates the log
  never logs a record). 12 view tests
  (`scripts/test/zil-view.test.mjs`): counts in both languages with 0, 1 and 2,
  keys and placeholders, every frame of a commit and of a first commit (`zh_log` stays a
  hole until the txg sync), and the decision panel for all 96
  combinations.

### D8.3 Interaction and drawing

- **Controls**: log device (none, SLOG, SLOG full), `logbias`, `O_DSYNC`, `O_DIRECT`, size
  (4, 16, 48, 128 KiB: each a different branch); actions `write()`, `fsync()`, Sync txg,
  Power cut, `zpool import`, `zfs mount`, Start again. Toggles are buttons with
  `aria-pressed`; actions that do not apply in the current phase are disabled, and focus
  moves to the next step (import after a power cut, mount after import).
- **The decision panel** runs `zil_write_state` and the downgrade for the current toggles
  before any write, and lists the lines that decide, each with its code link: the visitor
  (and QA) can read the state for every combination without writing.
- **Three panels**: the application's file (each write with its state and status), memory
  (itxs waiting for a commit; each lwb with its block, its seven states as a stepper, its
  fill and its records), disk (`zil_header_t`, the chain from `zh_log` with each block's
  class and records, and the devices: the SLOG, and the pool's vdevs with embedded log
  blocks and data written in place; freed blocks greyed and crossed through).
- **Motion**: a commit is drawn step by step (each lwb state, record and allocation, 230 to
  380 ms each), the lwb concerned outlined; with `prefers-reduced-motion`, the final state at
  once and nothing animates. During the drawing every control but Start again is
  `aria-disabled` (not `disabled`, so the focused button keeps the focus); steps that do not
  apply in the phase are `disabled`. The status line (`aria-live`) reads each action's
  result, and the new decision after a toggle.

### D8.4 Words

- The code's names stay as the code names them, in both languages: itx, lwb, the lwb
  states (`NEW` … `FLUSH_DONE`), WR_COPIED / WR_NEED_COPY / WR_INDIRECT, the class names
  in the log (`log`, special, embedded log, normal). "Intent log" / « journal
  d’intention »; "log write block" / « bloc d’écriture du journal »; "commit" (the ZIL's,
  not the txg's) / « validation »; "claim" / « réclamation »; "replay" / « rejeu ».
- D7.4 carried over: French counts singular for 0 and 1 through one helper, wording that
  avoids an adjective agreeing with a count (« Perte avec la mémoire, ni synchronisé ni
  journalisé : 1 écriture »), no elision before a code name (« le lwb », « un itx »), no
  stray space after an apostrophe; the summary's per-status counts have their own singular
  and plural (« 1 perdue », « 2 perdues »). The strings live in
  `src/lib/zil-strings.ts` so that the view test can draw every line.

### D8.5 Visit order

Unchanged (D0.4): … → The ARC → Metaslabs and space maps → ZIL and SLOG. This room is the
last open one, so its "next" is the end-of-visit note, and the Metaslabs room's "next" is
now this room, in both languages.

## Slice 9

### D9.1 Code basis first: what was added to `ANALYSIS.md`, and what was corrected

- **Context.** `ANALYSIS.md` had three excerpts for the room (`dmu_replay_record_t`,
  `traverse_visitbp`, `receive_writer_thread`) and named `send_cb`, `dump_record` and the
  receive dispatch by line only. The figure turns dnodes, data blocks and holes into
  records, merges FREEs, shows `drr_checksum` and the receiver's check: each needs its
  lines.
- **Added**, nine excerpts with notes: `send_traverse_thread` (dmu_send.c L1203-L1221),
  `traverse_dnode` (dmu_traverse.c L534-L550), `send_cb` twice (L1098-L1120,
  L1130-L1146), `dump_dnode` (L732-L742), `dump_free` (L367-L403), `dump_record`
  (L257-L283), `receive_process_record` (dmu_recv.c L3188-L3213),
  `receive_read_payload_and_next_header` (L2843-L2868; QA round 1: it ended one line short,
  on the blank L2867, without the final `receive_cksum`). Line references for the rest: the
  send flags (L2088), `do_dump`'s loop (L2568-L2574), OBJECT_RANGE only for raw streams
  (L894-L898), the FREE past the end of each file (L796-L799), FREEOBJECTS merging and
  clamping (L653-L698), the END record (L2619-L2626), BEGIN's GUIDs (L2049-L2050) and the
  receiver's `ENODEV` (dmu_recv.c L463-L479), the receiver's sum over BEGIN and payloads
  (L1304-L1306, L2813), the reader queueing a record only after the next header
  (L3500-L3513), the END check (L3000-L3007), the cleanup on error (L3582-L3588).
- **Corrected**: the note on `traverse_visitbp`'s birth-0 holes said they "may still need
  to be sent". `send_holes_without_birth_time` is 1 by default (dmu_traverse.c L44), so a
  hole of birth 0 is always visited; the skip of L272-L276 applies only with the tunable
  at 0. The model implements both and the tests cover both; the figure has no birth-0
  hole (D9.2).
- **Corrected, found by the code review**: the fact on logical birth said dedup and block
  cloning "do not cause unchanged data to be resent" (and the brief repeats it). The
  comment it cites (spa.h L483-L488) says the physical birth *can be* smaller than the
  logical one for dedup and cloning and bigger for remapped and rewritten blocks. With the
  physical birth, a block deduplicated or cloned after F onto an older copy would be
  skipped, and a block rewritten on disk resent; the logical birth sends the first and not
  the second. The page and `ANALYSIS.md` now say that.
- "What the animation shows", the facts and the hand-checked cases are rewritten for the
  figure; the old "Simplified" line stays out of the figure and is detailed in D9.2.

### D9.2 The figure runs a transcription of the send and receive code, on a small filesystem

- **Context.** QA replays a full stream, an incremental from the oldest and from the newest
  snapshot, a freed range producing FREE records, and the received tree compared with
  `@to`. The blocks visited must follow `traverse_visitbp`'s rule for every choice, the
  record types `send_cb`'s.
- **Options.** (a) A scripted animation of the four streams; (b) a transcription that
  builds the tree from a history and runs the traversal, `send_cb`, `do_dump` and the
  receiver on it.
- **Choice: (b), `src/lib/send.ts`** (no dependency). `snapshots()` applies a fixed
  history copy-on-write (each change gives its txg to the changed block and to every block
  above it, up to the objset; a punched hole carries the txg of the free, as with
  `hole_birth`). `send()` is `traverse_visitbp` with its birth test (birth-0 holes
  included, with `send_holes_without_birth_time`, `td_realloc_possible` and the
  `hole_birth` txg), `traverse_dnode` with `TRAVERSE_PRE`, `send_cb`'s range choice,
  `do_dump` / `dump_dnode` / `dump_free` / `dump_freeobjects` with the pending record and
  its merging, and `dump_record`'s running fletcher-4 over real bytes. `receive()` reads the
  headers back from the bytes, keeps its own sum, checks each header as
  `receive_read_payload_and_next_header` does, applies a record only after the next header
  is checked, and dispatches by type. `src/lib/send-view.ts` draws any frame.
- **What it simplifies, and why it stays faithful.**
  - **Sizes.** Data blocks of 512 bytes (`recordsize=512`), four pointers per file indirect
    block, four dnodes per dnode block (32 in a real 16 KiB block), a meta-dnode indirect
    block drawn with the two dnode blocks the history uses. The traversal rule, the record
    choice and the checksum do not depend on any size. The meta-dnode's unused pointers would
    be holes of birth 0: the code visits them (the tunable is 1) and `dump_freeobjects` drops
    them as objects that cannot exist (L653-L666), so they add visits and no record. Leaving
    them out keeps the counts readable; the page counts the 19 block pointers it draws.
  - **One sequence, not threads.** The code joins the traversal, a merge thread, a reader
    thread and the main thread with queues that keep the traversal's order; the model runs
    them one after the other, which writes the same records in the same order. The receiver
    starts once the stream is complete (in the code it reads a pipe as the stream comes);
    which records it applies, and when it stops, are the same.
  - **Record headers** are 312 bytes laid out as `dmu_replay_record_t` (type, payload length,
    the fields of each union member the figure uses, `drr_checksum` in the last 32 bytes),
    other fields zero; OBJECT has no bonus payload. The checksums are therefore real
    fletcher-4 sums of the model's bytes, not of a real stream's; what they show (each
    record's sum covers every byte before it and its own header up to the sum, BEGIN has none, END repeats the total, a
    flipped bit is caught at the next header) is the code's.
  - **The receiver's files** are compared by contents (object, blocks, holes), not by
    births: a received block is born in the receiver's own txg.
  - **The flipped bit** is in the first WRITE's payload (or the first record after BEGIN for
    a stream without WRITE). The receive is shown undone, as `dmu_recv_cleanup_ds` does on
    an error; resumable receives are left out.
  - **Not shown**, as `ANALYSIS.md` lists: redaction, raw (encrypted) and compressed
    streams, WRITE_BYREF, embedded data, spill blocks, resume tokens. No throughput.
- **Checked.** 14 model tests (`scripts/test/send-model.test.mjs`), from the hand-checked
  cases of `ANALYSIS.md`, not from the model: the births of `@s4`; for every from-snapshot
  (none, `@s1`, `@s2`, `@s3`) every test is `birth > F`, every block pointer is tested or
  under a skipped one, never both; visited / skipped / below: 19/0/0, 14/5/0, 12/3/4,
  3/3/13; the four record lists in full; the range `send_cb` makes for every visited block
  and dnode; every visited data block is one WRITE and every visited hole is inside a FREE;
  one BEGIN first, one END last, the header layout, the magic and the GUIDs;
  `drr_checksum` of every record but BEGIN recomputed as the fletcher-4 of all the bytes
  before it, and END's `drr_end.drr_checksum`; the incremental fletcher-4 equal to
  `fletcher_4_incremental_combine`; the receiver ends with `@s4`'s files for every choice;
  the step-by-step effects from `@s1`; a flipped bit (ECKSUM at record 4, three records
  applied); birth-0 holes under every setting. 6 view tests
  (`scripts/test/send-view.test.mjs`).

### D9.3 Interaction and drawing

- **Controls**: the from-snapshot (none, `@s1`, `@s2`, `@s3`, buttons with `aria-pressed`;
  `@s2` at first: it shows a skipped indirect block, merged FREEs and FREEOBJECTS); Play,
  Next step, Show the end, Start again; "Flip a bit on the way". Choosing a from-snapshot
  shows that stream finished at once, so the counts and the table can be compared; Play, or
  Next step at the end, replays it from BEGIN (frame 0, the bound and BEGIN, is shown
  first). Show the end is `aria-disabled` once the end is shown, never `disabled`, so that
  the focused button keeps the focus (found by the code review).
- **Three panels**: the sending side (the tree of `@s4`, each block pointer a chip with its
  logical birth, and after its test `> F` or `≤ F`; skipped chips dashed, their subtree
  faded; dnode slots ringed once `send_cb` has seen them), the stream (records top to
  bottom, numbered, each with the low 32 bits of the last word of its `drr_checksum`), the
  receiving side (its files, block by block; the block or file just changed outlined; the
  verdict after END). Below: the line that says what the last step did, with its code link
  (`aria-live`), and the table of all from-snapshots.
- **Motion**: Play advances one frame every 420 ms (traversal) or 300 ms (receive), the new
  card slides in, the current chip is outlined. With `prefers-reduced-motion`, Play shows
  the end at once and nothing animates. While playing, every control but Start again is
  `aria-disabled`.
- **Announcements** (QA round 1, item 5): the `aria-live` line is not rewritten during Play,
  which would announce about 60 frames for a full stream; Play announces its last frame
  and the summary once, and Next step, Show the end and Start again announce each frame.
  With reduced motion, Play is `aria-disabled` once the end is shown, like Show the end
  (item 11). The receiver's line for BEGIN links to its sum over BEGIN (dmu_recv.c
  L1304-L1306), for END to `receive_read_record`'s END check (L3000-L3007), not to the
  sender's END (item 4).
- **Without JavaScript**: the finished stream from `@s2` (tree, strip, receiver, verdict,
  table, text version) is rendered at build time; the controls stay hidden, and the
  `<noscript>` line says that the figure shown is that stream (QA round 1, item 10).

### D9.4 Words

- The code's names stay as the code names them in both languages: BEGIN, OBJECT, WRITE,
  FREE, FREEOBJECTS, END, OBJECT_RANGE, `send_cb`, `drr_checksum`, dnode, meta-dnode,
  objset, L1. "From-snapshot" / « instantané de départ »; "full stream" / « flux complet »;
  "record" / « enregistrement »; "block pointer" / « pointeur de bloc »; "hole" / « trou »;
  "receiver" / « récepteur ».
- D7.4 carried over: French counts singular for 0 and 1 through one helper (« 0 pointeur de
  bloc visité », « 1 enregistrement »), wording that keeps adjectives away from counts
  where it can (« visite de 12 pointeurs de bloc sur 19 », « b libère 2 blocs »), no
  elision before a code name, no stray space after an apostrophe; the strings live in
  `src/lib/send-strings.ts` so that the view test draws every frame in both languages.
- "txg" is masculine in this room (« le txg », « au txg »), as in the Snapshots room; the
  ZIL room says « la txg ». Both forms are in the site; aligning them is a site-wide edit
  left for later (BUILDLOG debt).

### D9.5 Visit order

Unchanged (D0.4): … → Metaslabs and space maps → ZIL and SLOG → send / receive. This room is
the last open one, so its "next" is the end-of-visit note, and the ZIL room's "next" is now
this room, in both languages. The slug is `send-receive` in both languages.

### D9.6 The private preview of `main` moves to the second build machine, and its address stays out of the repository

- **Context.** The brief asks for the `main` preview URL in the hand-off comment and in
  `README.md` "Preview". The README is the file a public import shows first, and D-D1 moved
  every note about the private build machine to `docs/dev.md`, which names no address
  (`<build-machine-ip>`).
- **Choice.** `README.md` gets a short "Preview" section that says a private preview of
  `main` is served on the team's build machine, reachable from the LAN and VPN only, and points to
  `docs/dev.md` for how it is run; the address itself (a LAN IP and port) goes in the
  hand-off comment of the project tracker, not in the repository.
- **Why.** A LAN address in a file that will be public the day the repository is is the kind
  of detail the hard rules ask to keep out of anything public; the people who need the
  link get it in the tracker.

## Slice 10

### D10.1 Code basis first: what was added to `ANALYSIS.md`

- **Context.** `ANALYSIS.md` had three excerpts for the room (`zio_get_compression_max_size`,
  the hit branch of `zio_ddt_write`, the X-bit comment of `spa.h`) and named the other branches
  by line. The figures show the four outcomes of `zio_write_compress`, the rounding, the miss and
  over-quota paths of dedup, the encrypted block pointer word by word, what `zio_encrypt` does to
  each kind of block, and a scrub without the key: each needs its lines.
- **Added**, twelve excerpts with notes (4 to 15): `zio_write_compress` twice (zio.c
  L1982-L2017, the outcomes; L2018-L2039, the rounding), `zio_ddt_write`'s lookup
  (L3816-L3832) and miss (L4156-L4167), `ddt_lookup`'s quota branch (ddt.c L1374-L1387),
  `zio_ddt_child_write_ready` (zio.c L3756-L3792), the dedup-log comment (ddt.c L136-L156),
  the encrypted `blkptr_t` layout (spa.h L188-L225), `zio_encrypt` by kind of block (zio.c
  L5123-L5153), the `zio_crypt.c` block comment on MAC, authentication and dnodes (L85-L120),
  `zio_checksum_error_impl`'s truncated comparison (zio_checksum.c L508-L526),
  `dmu_write_policy` for encrypted datasets (dmu.c L2511-L2535). Line references for the
  rest: `zio_roundup_alloc_size` (L1783-L1789), `spa_min_alloc` and `spa_gcd_alloc` on a pool
  of one ashift (vdev.c L428-L437, L1523-L1536), the allocated size on a disk (vdev.c
  L368-L370), the hole with `hole_birth` (zio.c L2107-L2115), dedup's zero detection with
  compression off (dmu.c L2465-L2472), the quota comment (ddt.c L113-L127), `ddt_bp_fill`'s
  births (ddt.c L724-L726), `ddt_phys_addref` (L880-L888), the IV2 accessors (spa.h
  L531-L538), `zio_crypt_encode_params_bp` and `zio_crypt_encode_mac_bp` (zio_crypt.c
  L751-L773, L809-L827), embedded pointers cannot be encrypted (spa.h L320-L322), scrub's raw
  reads (dsl_scan.c L4841), `EACCES` without the key (dsl_crypt.c L2818-L2823), encrypted
  dedup by HMAC (zio_crypt.c L147-L163).
- **Read in the code, and said so on the page**: over quota, `ddt_lookup` still returns
  entries that exist, so a duplicate is still deduplicated and only new entries are refused
  (the plan said "over quota → D bit cleared", which is true only for a block never seen);
  for a 128 KiB block the seven-eighths line is already a multiple of the sector at ashift 9,
  12 and 13, so the snap shows only on smaller blocks, and the figure offers 4, 8 and 16 KiB
  too; the zero check runs only with compression on (or with dedup, which turns it on); an
  encrypted block of 112 bytes or less is not embedded and is rounded up instead.
- "What the animation shows", the facts and the hand-checked cases are rewritten for the three
  figures; the "Simplified" line stays out of them and is detailed in D10.2.

### D10.2 The figures run a transcription of the three write-path rules

- **Context.** QA replays compressible, incompressible, all-zero and embeddable blocks at two
  ashifts, a dedup miss then a hit then over quota, and the encrypted block pointer with the
  key unloaded. Each outcome must follow the code's branches for any choice of the visitor.
- **Options.** (a) Scripted states for the cases QA names; (b) a transcription that computes
  every outcome from the visitor's inputs.
- **Choice: (b), `src/lib/transforms.ts`** (no dependency). `maxSize` is
  `zio_get_compression_max_size`; `compress` follows `zio_write_compress` branch by branch
  (compression off, zeros, the compressor's limit, embedding, `zio_roundup_alloc_size`, the
  rounded size against LSIZE) and the allocated size of `vdev_default_asize`; `dedupWrite`
  follows `zio_ddt_write` (lookup, NULL over quota for a new key only, hit with
  `ddt_bp_fill`'s births and `ddt_phys_addref`, miss with a new entry at refcount 1 and its
  DVA); `bpWords` gives the role of each of the 16 words for six kinds of block pointer, from
  the diagrams of `spa.h`; `cryptFile`, `scrub` and `readBlock` model a small encrypted file,
  with the checksum folded and truncated as `zio_checksum_error_impl` compares it.
  `src/lib/transforms-view.ts` draws every state.
- **What it simplifies, and why it stays faithful.**
  - **The compressor's output is an input**, set by presets or typed in bytes: the code
    decides what happens to an output of a given size, not how big an output is, and gives no
    ratio. LZ4 stands for every compressor but ZLE, since `zio_get_compression_max_size`
    treats them alike; compression levels change the output size only.
  - **A pool of plain disks of one ashift**, so `spa_min_alloc` and `spa_gcd_alloc` are both
    the sector. RAID-Z and mixed pools, where they differ, would change the numbers, not the
    branches. Level 0, a type with no fill count and `embedded_data` enabled are taken as
    given for embedding.
  - **Dedup** writes one block per txg, with `copies=1`: two writes of the same key in one
    txg take the in-flight path (zio.c L3994-L4083), more copies take partial-DVA extension;
    both are told, not drawn. Dedup verify and collisions are left out. The checksum shown is
    a stand-in (fletcher-4 of a made-up 4 KiB buffer, 8 hex digits): dedup uses a strong
    checksum, SHA-256 by default, and what the figure needs is only that equal data has equal
    keys. DVAs are made up. The dedup log, pruning and the DDT-first scrub are in the text.
  - **Encryption.** The ciphertext, salt, IV and MAC are deterministic stand-ins, not AES:
    what the figure shows is where each value lives and what can be checked without the key,
    not the cipher. The checksum is real fletcher-4 over the figure's bytes, folded and
    truncated as the code does, so a flipped bit is really caught by the truncated words. The
    dnode block is drawn as core (in clear) and bonus buffer (encrypted), as the
    `zio_crypt.c` comment describes; the objset block, its MACs, the ZIL and key rotation are
    not drawn.
- **Checked.** 12 model tests (`scripts/test/transforms-model.test.mjs`) from the
  hand-checked cases of `ANALYSIS.md`, not from the model: the limit at 4, 8, 16 and 128 KiB
  and ashift 9, 12, 13, ZLE unsnapped; `zio_roundup_alloc_size`; the four outcomes at ashift
  12 and 9 with PSIZE and sectors; ZLE reaching LSIZE after rounding; compression off writing
  zeros; an encrypted 90-byte output not embedded; dedup miss, miss, hit, over quota (new
  key), hit over quota, over quota again, with refcounts, DVAs, births and blocks on disk;
  a key first seen over quota, then a miss; the word roles of every kind; scrub without key,
  `EACCES`, and a flipped bit caught. 6 view tests (`scripts/test/transforms-view.test.mjs`).

### D10.3 Interaction and drawing

- **Three figures, one per part**, each with its own controls, the same visual language as the
  previous rooms (buttons with `aria-pressed`, panels, a live line under the figure, a text
  version), and no framework. The room's JS is three small scripts sharing the model and view.
- **Compression**: the data (four presets), the compressor's output (a range and a number
  field, both labelled; the range redraws while dragged and announces once, on release), the
  block size, the ashift, the compression. Three rows of bars (the block with its sectors, the
  seven-eighths line and the limit; the output against the limit; the sectors allocated), the
  branches of `zio_write_compress` in order with the one that decides in bold, the outcome and
  the block pointer's 16 words, and a table of the same data at every ashift. Default: 128 KiB,
  compressible, LZ4, ashift 12. When the output does not apply (zeros, compression off), its
  controls are `aria-disabled`, not `disabled`, and keep the focus.
- **Dedup**: Write A, B or C; "Dedup table over its quota"; Start again (empty pool). Panels:
  the last write's three steps, the DDT (key, data, refcount, DVA, physical birth), the block
  pointers (D bit, DVA, both births), the data blocks on disk with the pointers that reference
  them; counters of writes, lookups, blocks written, entries. Shown at first, and without
  JavaScript: A, B, then A again (miss, miss, hit).
- **Encryption**: four kinds of block pointer side by side with the words that differ from an
  ordinary one highlighted; then the file, with "Key loaded", "Scrub", "Read the file" and
  "Flip a bit in data block 1 on disk". Changing the key or the disk clears the last scrub and
  read, which no longer describe it.
- **Motion**: the branches light up in order (160 ms apart), new rows and changed words fade
  in. With `prefers-reduced-motion` nothing animates; every state is reached at once anyway.
- **Announcements**: one announcement per action (QA finding on slice 9): a button, the
  release of the range, or the number field's change. The visible line under each figure is
  not the live region (found by the code review): a visually hidden region, always in the page,
  is emptied and filled on the next frame, so that the same text twice is announced twice and
  the first action is not lost to a region that was `hidden`; it reads the line without its
  "code" links. Dragging the range redraws without animating or announcing. `verify.mjs`
  counts the announcements of a keyboard walk (six actions, six announcements).
- **The check mark of a pressed button** has an empty accessible name (`content: "✓ " / ""`):
  `aria-pressed` already says it, and Playwright, like screen readers, counted it in the
  button's name (code review). The older rooms keep the old rule: a site-wide fix is left for
  later (BUILDLOG debt).

### D10.4 Words

- The code's names stay as the code names them in both languages: PSIZE, LSIZE, ASIZE, DVA,
  DDT, ZAP, the D, E and X bits, `dedup=on`, `fast_dedup`, `dedup_table_quota`, ZLE, LZ4, IV,
  MAC, scrub, `EACCES`, `ECKSUM`, dnode, bonus. "Embedded" / « embarqué »; "hole" / « trou »;
  "refcount" / « compteur de références »; "salt" / « sel »; "wrapping key" / « clé
  d'enveloppe »; "master key" / « clé maîtresse ». English comments quoted from the code stay
  in English in the French page, followed by a French gloss in parentheses.
- D7.4 carried over: French counts singular for 0 and 1 through the helper (« 0 secteur,
  0 octet », « 0 erreur de somme de contrôle »), no elision before a code name, no stray space
  after an apostrophe. Strings live in `src/lib/transforms-strings.ts`, so the view test draws
  every state in both languages; it found one hard-coded colon without its no-break space,
  now a string. Sizes: KiB / Kio when whole, bytes / octets otherwise.

### D10.5 Visit order

Unchanged (D0.4): … → ZIL and SLOG → send / receive → Compression, dedup, encryption. This room
is now the last open one: its "next" is the end-of-visit note, and send / receive's "next" is
this room, in both languages. Slugs: `compression-dedup-encryption`,
`compression-dedup-chiffrement` (D1.4).

## Slice 11

### D11.1 Code basis first: what was added to `ANALYSIS.md`, and one deviation

- **Context.** `ANALYSIS.md` had three excerpts for the room (`struct vdev`, `vdev_ops_t`,
  `vdev_metaslab_group_create`) and named the rest by line. The figure shows where each kind of
  block lands, the fallback when special is full, ditto copies, the fan-out of each node type,
  the replacing and spare nodes, the end of a resilver and the dRAID layout: each needs its lines.
- **Added**, fourteen excerpts with notes (4 to 17): `vdev_mirror_io_start` (vdev_mirror.c
  L656-L693), `vdev_replacing_ops` (L997-L1021), `spa_vdev_attach` twice (spa.c L8324-L8360,
  replacing or spare; L8436-L8454, the new parent), `vdev_add_parent` (vdev.c L1418-L1449),
  `spa_vdev_resilver_done_hunt` (spa.c L9438-L9456), `spa_preferred_class` twice (spa_misc.c
  L2121-L2156, L2158-L2179), `zio_dva_allocate`'s fallback (zio.c L4368-L4407), ditto placement
  in `metaslab_alloc_dva_range` (metaslab.c L5401-L5427), and dRAID: `vdev_draid_generate_perms`
  (vdev_draid.c L506-L526), `vdev_draid_logical_to_physical` (L931-L954), the column loop of
  `vdev_draid_map_alloc_row` (L1042-L1064); after review, `spa_vdev_attach`'s refusal of a spare
  under log, special and dedup vdevs (spa.c L8279-L8293, excerpt 17). Line references for the rest: the mirror's child
  selection (DTL, distributed spare first, load), the root's NULL `io_start`, the new disk's DTL
  (spa.c L8472, L8499-L8500), `vdev_top_transfer`, `vdev_remove_parent`, `vdev_unspare`, the
  copies of `dmu_write_policy` and of the MOS, `special_small_blocks`' default, the dRAID map
  table, its checksum, `ngroups` in `zpool create`, the distributed spare's ops, I/O and name.
- **Deviation from the plan.** The plan's "Simplified" line said dRAID would be shown only as
  "a fixed set of permutations", since the permutation generation had not been read. It has now
  been read (excerpt 14) and transcribed: the figure generates the same 256-row map as the code
  and checks it against the checksum stored in `vdev_draid.c` (`0x2a1648d74` for five children;
  the maps for 2, 3, 4 and 6 children match too, in the unit tests). So the figure shows the
  real children of each group, not an illustration, and it is still "fixed permutations over all
  children". The generator, `vdev_draid_rand.c`, is public domain, not CDDL: it is linked, not
  quoted (the permalink check refuses non-CDDL excerpts, D0.3).
- **Corrected.** The fact "one metaslab class pointer per class" listed five classes; `spa_impl.h`
  L248-L253 has six (the special embedded log class was missing).

### D11.2 The figure runs a transcription of the vdev code, on one pool

- **Context.** QA replays each block kind landing in its class with and without a special vdev,
  an I/O down a mirror, a raidz and a dRAID, a replacement and a hot spare. Each outcome must follow
  the code for any sequence of the visitor's actions.
- **Options.** (a) Scripted states for the named cases; (b) a model that computes every outcome.
- **Choice: (b), `src/lib/vdevs.ts`** (no dependency; it reuses the RAID-Z room's `mapAlloc`).
  The tree is `vdev_t` nodes with parent, children, `vdev_id` and an ops table whose slots are
  those of 2.4.4; `preferredClass` is `spa_preferred_class` line by line, with the tried class;
  `chooseClass` adds `zio_dva_allocate`'s retry on `ENOSPC` and `zio_alloc_zil`'s order;
  `ioTrace` is the walk: the logical zio over the DVAs with the mirror's function, mirror,
  replacing and spare nodes to every child on a write and one on a read (skipping a child whose
  DTL misses the txg, a distributed spare first), raidz by `vdev_raidz_map_alloc`, dRAID by the
  transcribed permutations, `vdev_draid_logical_to_physical` and the column loop, a distributed
  spare redirected to the child holding the spare space of that row; `replace` and
  `resilverDone` follow `spa_vdev_attach`, `vdev_add_parent` and
  `spa_vdev_resilver_done_hunt`.
- **What it simplifies, and why it stays faithful.**
  - **Which vdev of a class gets the first copy** is the allocator's rotor, moved by block sizes,
    queue depths and free space (`metaslab_class_rotate`): the metaslabs room's subject. The figure
    moves each class's rotor on by one vdev per block, and says so. The later copies follow the code
    exactly: the next vdev of the class after the previous copy's. A dRAID copy goes to the start of
    the next group (so successive blocks show the permutations), a raidz copy after the last one.
  - **Block sizes are inputs**, after compression: ZIL 4 KiB, metadata (a dnode block) 16 KiB,
    DDT 8 KiB, small file block 4 KiB, large file block 128 KiB. The code decides the class and
    columns of a given size, not the size.
  - **Copies**, from the defaults: a file's data with `copies=1`, one DVA; metadata of a dataset one
    more (`redundant_metadata=all`); a DDT block three (the MOS's `os_copies` is
    `spa_max_replication`, 3, and metadata's +1 is capped); a ZIL block one.
  - **Fill.** Only the special class fills up, at three levels (under 75%, over 75%, full); its
    embedded log metaslab is a separate group and stays free, so a ZIL block with special full and
    no log still lands on special's embedded log. Log, dedup and normal never fill.
  - **A mirror's read** takes the first eligible child where the code takes the least loaded, at
    random among equals. Which child is eligible (DTL, distributed spare first) is the code's.
  - **DTL.** A new disk misses `[TXG_INITIAL, txg + TXG_CONCURRENT_STATES)`, the code's range;
    each block written is one txg. "Resilver done" empties every DTL at once: the resilver's order,
    its progress and the sequential rebuild are not drawn.
  - **The embedded log class** holds the normal vdevs only: the code moves a metaslab into
    `vdev_log_mg` only on normal and special vdevs with more than `zfs_embedded_slog_min_ms` (64)
    metaslabs (vdev.c L82-L88, L1689-L1696), and the figure takes every normal and special vdev to
    be that large. A dedup vdev has a `vdev_log_mg` (excerpt 3) but never gets that metaslab, so a
    ZIL block never lands on it (found in review; the first version listed it).
- **Checked.** 15 model tests (`scripts/test/vdevs-model.test.mjs`) from the hand-checked cases of
  `ANALYSIS.md`: the tree and its aux lists; every kind's class without log, special, dedup; with
  log and special; with `special_small_blocks=16K` under 75%, over 75%, full (with the decision
  steps); a dedup vdev; mirror, raidz (128 KiB and 4 KiB) and dRAID fan-out (groups 0, 1, 4, 5;
  4 KiB with a skip sector), reads included; the generated maps against their checksums; replace,
  hot spare, a replaced top-level disk, the distributed spare's redirection; spares refused under
  log, special and dedup; a block read back after a replacement. 5 view tests
  (`scripts/test/vdevs-view.test.mjs`).

### D11.3 Interaction and drawing

- **One figure, one scene**, as the brief asks for 3D: the pool's tree. Controls: the pool (log
  mirror, special mirror, dedup disk; changing them makes a new pool), `special_small_blocks` (0 or
  16 KiB), the special class's fill, five kinds of block to write, "Read the last block back",
  "Start again", "3D view". A node selector (a native `<select>`, keyboard-friendly in both views)
  shows the selected node's ops table and tree fields; for a disk, "Replace with a new disk", "Use
  the hot spare sdp", "Use the distributed spare draid1-2-0" (only on a dRAID child), "Resilver
  done". Unavailable actions are `aria-disabled` and keep the focus; pressing one says why.
- **The 2D view** is an SVG tree indented as `zpool status` lists it, top-level vdevs marked by
  their class colour (normal muted, log blue, special violet, dedup green: the code tokens), the
  nodes and edges of the last I/O lit depth by depth (180 ms apart), the sectors written or read
  at each leaf, and the blocks landed on each top-level vdev. Panels: the last block (class and
  why, copies and DVAs, the I/O as a nested list from the logical zio to the leaves, each hop with
  its function), the selected node, the classes with their vdevs and blocks. Hot spares and cache
  are a panel beside the tree, not in it.
- **One replacement per disk at a time**: a disk already under a replacing or spare node cannot be
  replaced again in the figure (the code allows more: multi-replace, a spare replacing a spare).
  A spare node stays after "Resilver done", since the code detaches a spare only when the original
  disk comes back or one of the two is detached, which the figure does not offer.
- **Spares stand in for normal vdevs only** (spa.c L8280-L8285, `ANALYSIS.md` excerpt 17): on a
  log, special or dedup disk the two spare buttons are disabled and say why; "Replace with a new
  disk" stays. The reasons of every disabled button are written under the buttons, once each.
- **"Read it back" reads the last block written**, also after a replacement or a resilver: its DVAs
  name top-level vdevs by `vdev_id` (excerpt 13, `vdev_lookup_top`), which the replacing node takes
  over (excerpt 8), so the read goes down the new node and skips the disk missing the block.
- **Announcements**: one per action (D10.3's live region: emptied, then filled on the next frame,
  without the "code" links). French no-break spaces are kept in the spoken text and the drawing's
  label (the shared `spoken` of the earlier rooms collapses them; this room's collapses ASCII white
  space only).

### D11.4 3D: what is in 3D, how it loads, what it costs

- **Context.** The brief allows Three.js in the two spatial rooms only, loaded on demand, never
  blocking first render, with a 2D fallback when WebGL is absent or reduced motion is set. Slice 12
  reuses the loader for the tree room and the Hall object.
- **Choice.**
  - `src/lib/lazy3d.ts` (shared, no Three.js import): `hasWebGL()`, `auto3d()`, `onVisible()`,
    `once()`. The page renders the readable text and the 2D SVG first; the room's script imports
    `src/lib/vdevs-3d.ts` (which imports `three`) with a dynamic import, either when the figure
    comes into view on a wide window with a fine pointer and motion allowed, or when the visitor
    presses "3D view". Never by itself with `prefers-reduced-motion`, on a small or touch screen,
    or without WebGL (then the button is hidden and a note says the figure stays in 2D). If the
    import or WebGL fails, the 2D view stays.
  - **In 3D**: the tree only, spatial because it is a tree: the root on top, top-level vdevs on a
    ring, each one's children on a ring below; spares and cache in a column apart, not linked.
    Nodes are boxes in their class colour with name and type; the last block falls onto its
    top-level vdevs, then a pulse runs down every edge the I/O takes, depth by depth (360 ms).
    **In 2D only**: the panels, the controls and the text version: the 3D view replaces the SVG
    drawing, nothing else. Both views draw the same state from the same model.
  - **Controls**: drag, or the arrow keys on the focused canvas, to turn; + and − to zoom; a click
    picks a node (the selector follows). The canvas has `role="img"`, a label and the help text as
    description. Renders only on change or while a pulse runs.
  - Three.js 0.186.1, named imports (core classes only, no addons: the orbit is a few lines).
- **Cost** (measured by `scripts/verify-vdevs.mjs`, uncompressed / gzipped): the room's JS before
  the 3D import 30.2 KB / 12.1 KB; after it 576.5 KB / 147.6 KB in total (the 3D chunk is
  546.1 KB / 135.6 KB). Budget: 3 MB. Other rooms' JS is unchanged, except that `raidz.ts`, now
  imported by this room too, became a shared chunk: the RAID-Z room loads the same code in two
  files instead of one (+80 bytes, +300 bytes gzipped, one more request).
- **Rejected**: 3D first with 2D as a fallback (blocks first render, heavier on phones); OrbitControls
  and CSS2DRenderer from the addons (more weight for drag and labels that a few lines and canvas
  sprites do); 3D for the panels or the excerpts (not spatial).

### D11.5 Words

- The code's names stay as the code names them in both languages: vdev, `vdev_t`, the ops table
  slots, the type names (`mirror`, `raidz`, `draid`, `replacing`, `spare`, `disk`, `dspare`), DVA,
  DTL, txg, MOS, DDT, ZIL, SLOG, `special_small_blocks`, resilver, ditto. Class names: normal /
  « normale », log, special, dedup, embedded log / « log embarqué », special embedded log / « log
  embarqué du special ». "Top-level vdev" / « vdev de premier niveau »; "hot spare" / « disque de
  secours »; "distributed spare" / « secours distribué »; "skip sector" / « secteur de bourrage ».
  English comments quoted from the code keep their English, followed by a French gloss.
- D7.4 carried over: French counts singular for 0 and 1 through the helper (« 1 DVA », « 0
  disque »), no elision before a code name, no stray space after an apostrophe; the view test checks
  the last two on every French string. Strings live in `src/lib/vdevs-strings.ts`.
- A no-break space (U+00A0) before % in this room (QA round 1). The typography check does not
  enforce it yet: the txg and metaslab rooms still use a plain space, and fixing them would change
  their pages and JS outside this slice. Left as a debt for the slice-13 pass over every room.
- A spare node's end is said in three cases, all in the code: the original disk is brought back
  (`vdev_unspare`), the original disk is replaced (that resilver detaches the spare, spa.c
  L9520-L9535), or the administrator detaches one of the two. The figure only offers the end of a
  replacing node's resilver (D11.3); the other cases are prose with line references.

### D11.6 Visit order

Unchanged (D0.4): … → Transaction groups → The vdevs → RAID-Z → …. The room opens between them:
the txg room's "next" and RAID-Z's "previous" are now this room, in both languages. Slugs:
`vdevs` in both languages (D1.4).

## Slice 12

### D12.1 Code basis first: what was added to `ANALYSIS.md`

- **Context.** `ANALYSIS.md` had three excerpts for the room (`vdev_label_offset`,
  `vdev_uberblock_sync`, the middle of `vdev_config_sync`) and named the rest by line. The figure
  also shows the tree's shape, the parent rewritten for a leaf, the flush, the odd labels, which
  label config wins on import, the comparison of uberblocks and which vdevs get labels at all:
  each needs its lines.
- **Added**, eight excerpts with notes (4 to 11): `objset_phys_t` (dmu_objset.h L80-L95),
  `dnode_phys_t` (dnode.h L213-L229), the parent in `dbuf_dirty` (dbuf.c L2537-L2554),
  `vdev_config_sync`'s flush (vdev_label.c L2085-L2098) and odd labels (L2144-L2161),
  `vdev_label_read_config`'s label choice (L832-L863), `vdev_uberblock_compare` (L1495-L1505),
  `spa_sync_rewrite_vdev_config` (spa.c L10792-L10819). Line references for the rest: `ds_bp`,
  `DN_MAX_INDBLKSHIFT`, `dnode_setdirty`, the dirty list walked by `vdev_label_sync_list`,
  `vdev_uberblock_sync`'s recursion to the leaves, `SPA_SYNC_MIN_VDEVS`, the config read at
  import (L1647) and `spa_first_txg` (spa.c L4750-L4751). Then the hand-checked cases the unit
  tests replay: slots for several txgs, label and slot offsets on a 1 GiB disk, ancestors for
  `epbs` 10 and the figure's 1, and the winner and config label after a cut during each beat.
- **Found while reading, and shown.** Labels are written only for vdevs on
  `spa_config_dirty_list`: in a txg where no vdev configuration changed, beats 2 and 4 write
  nothing, and the uberblock is the only new thing on the labels. The plan's beats assume a
  changed config; the figure has a switch for both. **Not a deviation, a precision**: the plan's
  "What the animation shows" list is kept as it is, with the switch on by default.
- **Corrected in my own excerpt notes before review**: `ub_timestamp` is compared at L1503, not
  L1502.
- **Known imprecision elsewhere, not fixed here**: the txg room says `vdev_config_sync` "writes the
  even labels, the uberblock and the odd labels, on every vdev if the configuration changed, else
  on up to three top-level vdevs". With no change, the three vdevs get the uberblock but no label.
  Left for the slice-13 pass over every room, since it changes that room's text.

### D12.2 The figure runs a transcription of the commit, on one disk

- **Context.** QA replays a leaf write and its rewritten ancestors, the four beats, a plug pulled at
  each beat with the tree that wins on import, and the slot chosen for several txgs. Each outcome
  must follow the code for any sequence of the visitor's actions.
- **Options.** (a) Scripted states for the named cases; (b) a model that computes every outcome.
- **Choice: (b), `src/lib/tree.ts`** (no dependency). `slotOf` is `vdev_uberblock_sync`'s slot
  (L1782-L1784, with the multihost slot), `labelOffset` is `vdev_label_offset`, `ancestors` is
  `dbuf_dirty`'s `blkid >> epbs`, `compareUb` is `vdev_uberblock_compare` without the MMP
  sequence. `writeLeaf` copies the leaf and every ancestor not yet copied in the open txg;
  `step` runs spa_sync's write (beat 0) then the four beats; `pullPlug` cuts the beat in progress;
  `readPool` is the import, every slot of every label, the best valid uberblock, then the label
  with the highest config txg not above it; `importPool` opens the pool on that tree, the next txg
  being the winner's + 1, with its config dirty: the import asks for a config update that marks
  every vdev dirty (spa.c L5721-L5736, L9757-L9769; spa_config.c L489-L491), so the first txg after
  an import rewrites the four labels and the switch is held on until it commits (found in review).
- **What it simplifies, and why it stays faithful.**
  - **The tree** has one file, `dn_nlevels` 3, four data blocks and two pointers per indirect block
    (`epbs` 1 instead of up to 10): the rule `blkid >> epbs` is the code's, only the fan-out is
    small. The meta-dnode's own indirect levels and the hop from the MOS to a filesystem's objset
    (its `ds_bp`) are folded into one block of dnodes under the objset: both repeat the same
    "a changed child changes its parent" step, which the figure already shows twice.
  - **One disk**, `psize` 1 GiB, ashift 9: 128 slots of 1 KiB, the case the brief names. A pool of
    one disk gets every uberblock and every label on it (`spa_sync_rewrite_vdev_config` with one
    top-level vdev). The Hall shows the slot count at other ashifts.
  - **A cut** falls in the beat in progress: the writes before the torn one landed, the torn one
    fails its checksum, the rest never happened. The code issues the writes of one beat together
    and they complete in any order; the figure lands them in a fixed order (L0 then L2, L1 then L3,
    uberblocks L0 to L3) and lets the visitor choose how many uberblock writes land before a cut in
    beat 3 (0 to 3). A cut during beat 1 loses the new blocks (not flushed); before beat 0, nothing
    of the txg was written.
  - **The ring's history** is one uberblock per txg for the last 128 txgs, and the labels' config of
    txg 4200. A real pool skips the uberblock of a txg with nothing to sync (the txg room); the
    figure always writes one, since every txg it syncs has a write.
  - **Not shown**: the config's content, the retry with `ZIO_FLAG_IO_RETRY`, multihost, RAID-Z
    expansion, sync passes, the free or deadlist of the replaced blocks (they are drawn as "no
    longer reached"), the deferred frees.
- **Checked.** 10 model tests (`scripts/test/tree-model.test.mjs`) from the hand-checked cases and 5
  view tests (`scripts/test/tree-view.test.mjs`); in the browser, `scripts/verify-tree.mjs`
  replays them against the model in FR and EN at 390 and 1440 px.

### D12.3 Interaction and drawing

- **One figure, one scene**, as the brief asks for 3D: the tree and the disk. Controls: write D0 to
  D3, "Next step" (spa_sync's write, then beats 1 to 4), "Pull the plug", "Import the pool",
  "Start again", "3D view", the switch "The vdev configuration changes in this txg" (set until
  spa_sync starts on the txg), and the number of uberblock writes that land before a cut in beat 3.
  Unavailable actions are `aria-disabled`, keep the focus, and say why; the reasons are written
  under the buttons, each once.
- **The first state** (also without JavaScript): txg 4210 synced, D2 written in txg 4211, its five
  new copies in memory beside the old ones. "Start again" goes back to it.
- **The 2D view**: the uberblock card on top, with its one arrow, `ub_rootbp`, to the objset it
  points to; old and new copies side by side, the shared blocks once, edges from each copy to the
  children it names; states by stroke: old (muted), new (accent), in memory or written but not
  flushed (dashed accent), lost in a cut (dashed red), no longer reached (dashed, faded). The card
  is the uberblock an import would pick now, so the arrow swings at beat 3, or when the plug is pulled
  during beat 3 after a write landed. Below,
  the disk: L0 L1, the boot area, the blocks, L2 L3 (not to scale), each label with its config txg
  and its ring, where the next txg's slot, the previous txg's and torn slots are marked; a marked
  slot is drawn wider than 1/128 of the ring so that it stays visible.
- **Panels**: the commit (beats 0 to 4: done, next, to do, cut), the last import (slots read, torn
  slots skipped, the winner and where it was found, the config label and why the others were
  passed over, the verdict with case (1) or (2)), the disk as a table (where each label starts on
  the 1 GiB disk, its config, the previous and the next slot with their offsets in the label).
- **Announcements**: one per action, as in D10.3 and D11.3.

### D12.4 3D in the room: the slice-11 loader as it is

- **Choice.** `src/lib/lazy3d.ts` unchanged; `TreeLab.astro` imports `src/lib/tree-3d.ts` with a
  dynamic import exactly as `VdevLab.astro` does (on view on a wide window with a fine pointer and
  motion allowed, or on the button; never with reduced motion, without WebGL, or on a small or
  touch screen by itself). The orbit and label code is repeated from `vdevs-3d.ts` rather than
  shared: two scenes, a few lines each, no new abstraction (brief).
- **In 3D**: the tree upright, the new copies in front of and beside the old ones, the uberblock
  slab with its arrow (it swings at beat 3, 600 ms), the disk strip with the four labels in their
  config's colour and the four rings lying flat, marked as in 2D. Panels, controls and text stay
  in 2D. The canvas takes the height of the 2D drawing it replaces, and the help line's room is kept
  in 2D (hidden, not removed), so opening 3D by itself does not move the page (CLS 0.004 measured
  on desktop, against 0.134 before this rule).
- **Three.js is one chunk now**, shared by the vdevs and tree scenes and the Hall object, instead of
  being inside `vdevs-3d`: the same bytes, cached once across the three pages.

### D12.5 The Hall object in 3D, the 2D ring first

- **Context.** The Hall's 2D ring (slice 1) gets its 3D form through the same loader; the Hall's
  first render must not move, and its JS before the 3D import must stay as it is.
- **Choice.** `UberblockRing.astro`'s script is left byte for byte as it was (its chunk keeps the
  same hash). A second script, in the same component, decides whether to load
  `src/lib/hall-3d.ts`, with the same rules as the rooms, and draws the same state: it reads the
  chosen ashift and the txg from the page after the 2D script has drawn them, so the two can never
  disagree. In 3D: the ring's slots on a circle seen from above at an angle, the newest raised in
  the accent colour, the previous one muted, the txg and slot in the middle. The canvas is the same
  square as the SVG it replaces and the help line lies over the bottom of that square: the swap
  does not move the page.
- **Cost before the 3D import** (raw / gzipped): 1.9 KB / 1.1 KB on `main`, 5.6 KB / 3.0 KB now.
  The 2D script and `svg.ts` are unchanged; the 3.6 KB added are the second script (1.4 KB) and the
  chunk of `lazy3d.ts` with Vite's preload helper (2.2 KB), shared with the two rooms. Turning the
  preload helper off (`vite.build.modulePreload: false`) changed nothing under Astro 7. Lighthouse
  on the Hall before and after: `BUILDLOG.md`, slice 12.
- **Rejected**: the 3D ring first (blocks first render), a 3D object without the 2D ring underneath
  (no fallback), moving the ring's state into a shared module (would change the 2D script).

### D12.6 Words

- The code's names stay in both languages: uberblock, txg, objset, MOS, dnode, meta-dnode,
  `blkptr_t`, label, config. "Beat" is « temps » (les quatre temps de la validation); "commit"
  « validation »; "pull the plug" « débrancher la prise »; "torn" « déchiré(e) »; "flush"
  « vidage du cache »; "slot" « case », as in the Hall.
- D7.4 carried over: singular for 0 and 1 in French through the helper (« 0 écriture
  d'uberblock », « 1 copie »), no elision before a code name, no stray space after an apostrophe
  (the view test checks both on every French string), U+00A0 before % (none in this room).

### D12.7 Visit order

Unchanged (D0.4): Hall → History → The tree and the uberblock → Copy-on-write → …. The room opens
between them: the history wing's "next" and the copy-on-write room's "previous" are now this room,
in both languages. Slugs: `tree`, `arbre` (D1.4).

## Release gate (ALG-68)

### D-R1 Deploy gated on PUBLIC_RELEASE, no public previews

- **Context.** Standing rule of 2026-10-18 (ALG-66): previews are private on the build machine with
  `preview`; nothing goes to a public host before the owner's Go on the first public
  release. D1.5 gated the deploy on `CLOUDFLARE_ACCOUNT_ID` alone and uploaded a preview
  version for every branch, so setting the keys would have published every branch.
- **Choice.** The deploy step runs only
  `if: vars.PUBLIC_RELEASE == 'true' && vars.CLOUDFLARE_ACCOUNT_ID != '' && github.ref == 'refs/heads/main' && github.event_name == 'push'`
  and only runs `wrangler deploy`. The branch preview upload and `scripts/alias.sh` are
  removed: branches build and test only. `preview_urls` is off in `wrangler.jsonc`, so no
  public preview URL exists even once the account is set. Slice branches are served with
  `preview up uberblok-<slice> <clone> <branch>` and taken down after merge.
- **Options rejected.** Keeping the upload behind the same variable (still a public URL per
  branch after the Go, which the rule does not ask for); a separate deploy job (the step
  needs the same `dist/`, D1.5).

## README to the GitHub rules (ALG-79)

### D-D1 README sections, private notes in docs/dev.md, one README image

- **Context.** ALG-77 README rules (accepted 2026-10-19): fixed section order, one image,
  no build-machine names, personal paths or LAN addresses in the README; private dev-infra notes in
  `docs/dev.md`.
- **Choice.** The README follows the order title · image · What it does · Status
  (prototype) · Getting started · Configuration (the deploy keys and where they live, no
  values) · Project layout · Licence and credits. The build machine's Chromium libraries, the
  `preview` LAN previews and the deploy switch-on procedure move to `docs/dev.md`.
  The image is a crop of the copy-on-write room (`docs/screens/uberblok-copy-on-write.png`),
  taken with Playwright at 1280 × 800, reduced motion, from the private preview of `main`
  (c848f4f); it shows only the room's synthetic block tree. `.gitignore` keeps ignoring
  images except `docs/screens/*.png`. The checks' OpenZFS clone goes to `../openzfs` in the
  README instead of a home path. `LICENSE` is the plain MIT text (the extra paragraph made
  GitHub read it as "Other"); the CDDL note on excerpts stays in the README's licence
  section.
- **Options rejected.** A Hall capture (mostly text, shows little); an animated GIF (more
  weight for a prototype whose rooms still change).

## Slice 13

### D13.1 The Engine room: a colophon that reads its facts from the build

- **Context.** The mission's last room: the stack, the frozen commit, how the site was built,
  the repository. Its facts (versions, how many excerpts, how many sources) drift if typed.
- **Choice.** A text room with no figure and no JavaScript, last stop of the visit
  (`/en/engine-room/`, `/fr/salle-des-machines/`, slugs of D1.4). Versions come from
  `package.json`, the excerpt count from `ANALYSIS.md`, the source count from `SOURCES.md` and the
  room count from `rooms.ts`, through `src/lib/stack.ts`. Four parts: the code it reads (tag,
  full SHA linked, the CDDL attribution as in the README), what the site is made of, how it was
  built (analysis first, slices, a QA review per slice, the checks, the browser runs, the written
  decisions), the repository and the licences. It says AI agents wrote the site, from a mission set by a
  human who validates the release, without naming anyone (wording of v1.1, D14.4). The repository link is
  plain, with no remark about its visibility.
- **Options rejected.** A figure of the slices or a timeline of the build (a visual for what one
  list says); listing every dependency (the four that shape the site are named, the rest is in
  `package.json`); a "made with" badge row (marketing).
- **End of the visit.** The last room's "next" becomes "End of the visit. Map of the visit"; the
  Hall no longer says rooms are in preparation.

### D13.2 Whole-visit audit script and axe-core

- **Context.** The per-room checks in `verify.mjs` cover each figure; the slice asks for the
  whole visit: contrast in both themes, the keyboard on every page, the previous/next chain,
  the language switch, reduced motion, live regions.
- **Choice.** `scripts/audit.mjs` runs axe-core (WCAG 2.2 A and AA rules) on every page in both
  languages, dark and light at 1440 px and dark at 390 px, walks every page with Tab, checks the
  chain and the switch, waits under reduced motion for endless animations or a canvas, and counts
  the announcements of one click on each figure. axe-core 4.14.0 becomes a pinned dev
  dependency (the version Lighthouse 13.5.0 ships). `scripts/lighthouse.mjs` runs Lighthouse on
  every page and prints the table of `BUILDLOG.md`.
- **Options rejected.** Lighthouse's accessibility score alone (dark theme only, one viewport);
  a hand walk only (not repeatable by QA).

### D13.3 Privacy pass on the repository: fix the tree, keep the history

- **Context.** The repository becomes public after the v1 validation. The secrets and privacy
  passes (`secrets-engineer`, `privacy-engineer`) found no secret, no address, no home path,
  no personal data; they found process traces of the build in a few tracked files.
- **Choice.** The traces are replaced by roles ("the build machine", "the owner", "the
  tracker"). Kept: issue ids (`ALG-n`, they tie the build log to its reviews and reveal
  nothing), home-relative tool paths in the toolchain notes. The public repository is a clean
  import of one commit (D14.5, `RELEASE.md`).

### D13.4 Best Practices measured over local HTTPS

- **Context.** The private preview is plain HTTP, so `is-on-https` and `redirects-http` fail by
  design (ALG-71); Best Practices reads 78 everywhere.
- **Choice.** A throwaway local HTTPS server on the build machine (self-signed certificate, a plain HTTP
  listener that redirects to it, not in the repository) serving the branch's `dist/`, and
  Lighthouse with `--ignore-certificate-errors` (`scripts/lighthouse.mjs --insecure`). The
  numbers are in `BUILDLOG.md`; the real check stays the first public deploy.

## v1.1 (ALG-112): the owner's feedback on v1

### D14.1 The 3D rooms open in 2D; 3D only on a press

- **Context.** The owner's feedback on v1: the animations are 2D by default, only a click on 3D
  switches to 3D (the Hall aside, D14.2). In v1, the vdevs and tree rooms opened their 3D view by
  themselves on a wide desktop with a fine pointer (`auto3d`, D11.4).
- **Choice.** `auto3d` is gone. Both rooms load and stay in 2D; the "3D view" button imports the
  scene module (and Three.js) on its first press and toggles back to 2D. Without WebGL or under
  reduced motion the button stays visible but disabled (`aria-disabled`, still focusable), with the
  reason beside it and in its description (`aria-describedby`); a press says the reason.
  `no3dReason()` in `src/lib/lazy3d.ts` returns the key of that sentence in the room's strings.
- **Why reduced motion disables 3D.** The 3D views are moving ones (the camera turns, the blocks
  travel); the 2D view shows the same state.
- **Cost.** JS before the press, gzipped: vdevs 12,569 B (12,585 at `ce196e5`), tree 9,149 B
  (9,165) on a phone; on a wide desktop, 12.6 KB and 9.1 KB instead of 149 KB and 146 KB, since
  Three.js no longer loads by itself. Raw, the room scripts are about 100 B larger.
- **Rejected.** Hiding the button without WebGL (the visitor would not know the 3D view exists or
  why it is off); keeping 3D allowed under reduced motion (the 3D view animates every action, and
  the issue asks for the button disabled there).

### D14.2 The Hall's ring: 3D on arrival, committing by itself, with a pause

- **Context.** The owner: the Hall's animation is the exception, 3D by default and animated, as if
  "Commit the next txg" were clicked, the block seen moving; the button goes. Constraints: the
  Hall's first render unchanged, Three.js after the first paint, a pause (WCAG 2.2.2: moving
  content over 5 s), the static 2D ring under reduced motion or without WebGL, a live region that
  does not speak on every tick, Lighthouse mobile ≥ 90.
- **Choice.** One script now (D12.5 had two: the 2D one left byte for byte, the 3D one reading the
  page; with the commit button gone, the state lives in one place). The 2D ring is drawn first, as
  before. When the ring comes within a quarter screen of the viewport (an `IntersectionObserver`,
  then a frame and a task, so after the first paint), `hall-3d.ts` is imported and the 3D view
  shown. A clock commits a txg every 3 s while the ring is near the screen, the tab visible and the
  visitor has not paused; in 3D, the newest uberblock flies from above the centre of the ring to
  its slot (0.9 s, ease-out) and settles raised in the accent colour. The pause button (Pause /
  Resume) stops the clock; the 3D button still toggles 2D and 3D, and the 2D ring keeps
  advancing. The live region is a separate, hidden element that speaks only on the visitor's
  actions (ashift, pause, resume); the visible summary is no longer `aria-live`.
- **On a phone.** Three.js loads when the visitor scrolls to the ring, not with the page: the
  Lighthouse load (no scroll) stays at 2.9 KB of JS. A vertical swipe over the canvas scrolls the
  page (`touch-action: pan-y`); a horizontal one turns the ring.
- **Reduced motion, no WebGL.** No clock, no pause button (nothing moves), the 3D button disabled
  with its reason; the 2D ring stays at txg 4211. Decided before the controls are shown, so the
  row does not move afterwards.
- **Rejected.** Loading Three.js at page load on every device (Lighthouse mobile: about 138 KB
  gzipped more JS on the critical path); a continuous rotation of the ring (a permanent animation
  frame loop for no added meaning); announcing each commit (a screen reader would talk every 3 s).

### D14.3 The Hall's illustration: a rendered platter (superseded by D15.2)

- **Context.** The owner: on the Hall, right column, a realistic hard-disk platter, glossy brown,
  generated, fitting the museum. No image service, no stock image.
- **Choice.** `scripts/render-platter.mjs` renders it with Three.js in headless Chromium
  (SwiftShader), physically based: a lathe-built 95 mm platter (25 mm hole, 1.27 mm thick) whose
  UVs follow the tracks, so the material's anisotropy streaks the highlights radially as on a real
  platter; `MeshPhysicalMaterial` with a clearcoat (the lubricated gloss), a radial colour and
  roughness texture (data zones a shade apart, the matte landing zone near the hub); a steel clamp
  with six screws; a dark studio environment (one softbox behind, one above, a strip light) for few,
  crisp reflections; AgX tone mapping; a warm, tight contact shadow; a transparent ground so it
  sits on both themes. Rendered 2× and downscaled, trimmed, written as a WebP master (58 KB,
  999 × 544); `astro:assets` `<Picture>` makes AVIF and WebP at 320 to 900 px with `width` and
  `height`. Deterministic (a seeded generator).
- **Attempts.** (1) The default room environment: copper-pink, washed out, many radial streaks.
  (2) A dark studio: a deep brown, glossy; the clamp too dark to read. (3) A large softbox behind:
  the reflection flooded the whole disc, the brown gone. (4) A smaller, dimmer softbox: kept for
  review. (5) After the `ui-designer` review: a warmer, more ochre oxide, a single broad highlight
  (anisotropy 0.45 → 0.25, a dimmer strip light), the camera a little lower, and a warm, tighter
  shadow (the black one showed as a grey cloud on the light theme).
- **Layout.** At 60 rem and wider, the hero is a grid: the text, then a 28 rem column with the
  platter, aligned on the content's right edge. Narrower, it follows the text at 20 rem. Loaded
  eagerly (it is in the first screen on a desktop), with its intrinsic size: no layout shift.
- **Rejected.** Blender (not installed, no root on the build machine); a 3D platter in the page
  (Three.js on the critical path for a still image); an SVG drawing (not photoreal).

### D14.4 The Engine room's sentence

- **Choice.** "The site was written by AI agents, from a mission set by a human who validates the
  release." FR: « Le site a été écrit par des agents d’IA, à partir d’une mission fixée par un
  humain qui en valide la publication. » No tool name. And "the history of every change" goes from
  the repository paragraph (EN and FR): the public repository holds one commit (D14.5).

### D14.5 The public repository: one commit, the tree publishable as is

- **Context.** The owner chose a new public repository holding one commit of the tree at merge
  time, so every tracked file is published as it is.
- **Choice.** Process traces (the owner's name in the v1 decisions, the build machines'
  name, a tool's trailer quoted in the build log) replaced by roles in `BUILDLOG.md`,
  `DECISIONS.md`, `docs/dev.md` and the CI comment; the v1 decisions addressed to the owner
  rewritten as a neutral summary. `RELEASE.md` gives the commands (`git archive` of the validated
  `main` into a fresh `git init`), the checks before publishing and the owner's publish step;
  none of it is run by the team. The list of private names to grep for stays out of the tree (a
  file listing them would publish them).
- **The README capture.** `docs/screens/uberblok-copy-on-write.png` matched a two-letter pattern
  in a grep: chance bytes inside its compressed image data. It has only the IHDR, IDAT and IEND
  chunks (no text, no EXIF) and its pixels show only the figure. Kept as it is.
- **Not changed.** Issue ids `ALG-n`, generic roles (QA, the owner, the subagents' role names),
  the design references Almanak and Lukarne, the private preview notes in `docs/dev.md` and the
  README (true until the release; the owner may drop them at import).

## v1.2 (ALG-114): a grander Hall, a faster ring, a dedication

### D15.1 The Hall's ring, faster

- **Context.** The owner liked the Hall's animation and asked for it a little faster (the issue:
  about 1.5× to 2×).
- **Choice.** A txg every 2 s instead of 3 s (1.5×), and the newest uberblock's flight to its slot
  in 0.6 s instead of 0.9 s (1.5×), so the block still rests 1.4 s in its slot before the next one
  leaves: the eye can follow where it landed. The 2D pulse stays at 560 ms (`--dur-3`). The
  status line says "one txg every two seconds" (FR « toutes les deux secondes »). Reduced motion
  and no WebGL: unchanged, nothing moves (D14.2).
- **Rejected.** 1.5 s (2×): the flight would take 40 % of each cycle and the ring reads as busy
  rather than as a commit; ZFS's own default is a txg every 5 s, so faster than 2 s says nothing
  truer.

### D15.2 The Hall's exhibit: Fig. 1, a hard disk exploded along its spindle

- **Context.** The owner kept the platter's brown but wanted something much grander for the Hall,
  that "breathes storage and engineering", integrated with the rest; carte blanche, an artist if
  needed. Generated by us, deterministic, no stock image or service; both themes, desktop and
  phone; no layout shift; ≤ 150 KB at the largest served size; Hall Lighthouse within 3 points.
- **Art direction.** The `ui-designer` proposed three directions: (A) an exploded 3.5-inch
  drive, the classic engineering figure; (B) an assembled drive with a quarter cut away; (C) a
  pool of open drives in a cradle. **A chosen**: it shows how a disk is built (the subject of the
  museum is what software does on top of it), the oxide platters stay the only saturated mass,
  and it is buildable from lathes, extrusions and boxes. B hides most of the brown under a grey
  casting; C reads as stock "data centre" art and turns to smudges on a phone.
- **Choice.** `scripts/render-drive.mjs` (Three.js in headless Chromium, as D14.3) models, in
  millimetres on the spindle's axis: the base casting (a 101.6 × 147 mm tub, bosses, machined
  rim), the spindle motor, three platters with the D14.3 material and their spacers, the clamp
  and its screws, the top cover drawn as a ghost (a faint sheet with tube outlines, so it does
  not hide the stack), the head stack on its pivot with a pair of arms around each platter, the
  heads loaded over the middle tracks, the voice coil and its magnet plates, the amber flex
  cable. Platters at 30/50/70 mm, clamp 96, cover 122: exploded, the arms still between the
  platters. Camera FOV 14°, elevation 26°, azimuth −32°; the D14.3 studio and key, a cool rim, a
  soft fill from the camera's side; a real shadow on a transparent ground (`ShadowMaterial`,
  warm, 0.28). Rendered 2×, downscaled, trimmed, padded to 5:4: a 1804 × 1443 WebP master. The
  script also writes `src/assets/drive-anchors.json`, the projected position of each part.
- **The plate is HTML, not pixels.** `HallExhibit.astro`: a dashed spindle axis and leaders in
  an SVG in the image's coordinates (non-scaling strokes), numerals in the caption serif at a
  fixed size, and a figcaption "Fig. 1. A 3.5-inch hard disk, exploded along its spindle." with
  the numbered parts, which is the accessible text (the alt stays short). On a phone the
  leaders would tangle: each numeral sits on its part. Both themes from one image: the colours of
  the plate come from the tokens.
- **Layout.** At 60 rem and wider: kicker, title and text on the left, the exhibit beside them
  over the three rows, in a 34 rem column that bleeds up to 6 rem into the right margin when
  there is one (`calc(-1 * min(6rem, max(0px, (100vw - 72rem) / 2)))`). Narrower: under the
  text, up to 34 rem. `<Picture>` AVIF/WebP at 360, 576, 720, 1152 px with `width` and `height`:
  no layout shift.
- **Attempts.** (1) The cover solid and low: it hid the platters, the casting too dark, the head
  stack lost. (2) The cover higher and pushed back: a grey slab over 40 % of the frame. (3) The
  heads loaded over the tracks, the pivot closer: the arms read. (4) After the `ui-designer`
  critique: the ghost cover, the D14.3 lighting back (the cool rim had turned the oxide pink),
  the magnet in place, the platters exploded, a flatter camera. (5) After its second critique,
  in the page: larger with the bleed, numerals out of the drive's silhouette, serif list
  numerals, a lighter casting and a fill light (the casting was near black on Paper).
- **Rejected.** Text in the raster (not translatable, not accessible, blurred when scaled);
  an SVG drawing (flat next to a physically based platter the owner liked); keeping the
  platter and adding parts around it at the old size (the owner asked for grander).
- **Not claimed.** The parts list says "Platters", not "iron oxide": no source here says which
  coating the platters of a 3.5-inch drive had; the brown is the owner's choice of colour.

### D15.3 "Why this museum?": a dedication by the exit

- **Context.** The owner: add a "why this site?" saying it is an homage to a major piece of
  software engineering on a critical subject, to its creators, and to the exceptional
  engineering at Sun at the time. Every name, date and quote needs a source (D2.4).
- **Placement** (with the `ui-designer`). The end of the Hall, after the map of the visit, like a
  plaque by the exit, with one italic line under the hero's text linking to it ("Why this
  museum? ↓"). Rejected: between the hero and the uberblock (200 words between the promise and
  the first object); a page of its own (too short, and the visit would end without it).
- **Title.** "Why this museum?" / « Pourquoi ce musée ? »: the site calls itself a museum
  everywhere; a kicker "Dedication" / « Dédicace ».
- **Text.** Four short paragraphs in the display serif, 34 rem wide: the subject (keeping data
  safe, Bill Moore's principle, S04); the creators (Jeff Bonwick, Bill Moore, Matt Ahrens,
  S02–S03; 2001, the integration and its "584 files" line, S01, S07, S08; Bonwick's thanks to
  his team, S41); Sun's engineering of those years, shown rather than praised (the slab
  allocator at USENIX 1994, S42; DTrace by Cantrill, Shapiro and Leventhal at USENIX 2004, S43;
  the ZFS source under the CDDL, S12); OpenZFS and its community (S28, S29, and the 721 names
  of the release's AUTHORS file, a code fact in `ANALYSIS.md`). Numbered notes as on the
  History page; `check-sources.mjs` checks them.
- **No superlative the sources cannot carry.** "Exceptional" is the owner's word; the text lets
  the facts say it. The `technical-writer` pass tightened two claims to their sources ("one of
  the principles", not "one principle"; "On 17 November", not "a few weeks later").
- **Left out.** Other Sun work of the era (Java, NFS, Solaris Zones and others): true, but each
  would need its own primary source and the paragraph would turn into a list.
- **Notes, one per reference** (Design/UX review). Several rows of `SOURCES.md` cite the same
  document for different claims (S02 and S04, the ACM Queue interview; S03, S28 and S29, the
  OpenZFS announcement; S01 and S12; S07 and S08). The dedication numbers its notes by
  reference: 7 notes, not 12, so the plaque does not read as an audit. Each note's `<li>` lists
  all its ids (`data-entry="S03 S28 S29"`) and every citation keeps its own `data-source`;
  `check-sources.mjs` accepts the list and checks each id's links against its own row. Rejected:
  merging the rows in `SOURCES.md` (one claim per row is how the History page cites them).

## v1.3 (ALG-117): navigation, a faster ring, Spanish, a new Fig. 1

### D16.1 Header and footer navigation

- **Context.** The owner asked for a GitHub link to the repository at the top, links that help
  moving around, a "Why this?" link to the « Why this museum? » section, the same useful links
  at the bottom, and a language switcher with small flags, as on his site blok.
- **Choice.** Header, on every page: the wordmark (home), then a `nav` "Main" with Hall,
  Rooms (the Hall's map, `#map`), History and "Why this?" (`#why`, the dedication), then a
  list of tools: the GitHub mark (`REPO_URL`, the future public repository, a 404 while it is
  private), the language switcher, the theme button. The switcher copies blok's markup and
  flags (Union Jack for English, the tricolour; the Spanish flag comes with ES, D16.3): the current language is a
  `span` with `aria-current="true"`, the others are links with `hreflang` and `lang`; the
  accessible name is the language's own name in visually hidden text (not `aria-label`, which
  is not allowed on a `span`), the visible code `EN`/`FR`/`ES` is `aria-hidden`. `aria-current="page"`
  marks Hall or History when on that page. Footer: three short lists under small headings,
  "The visit" (Hall, Map of the visit, History, Engine room), "About" (Why this museum?,
  Sources, which is `SOURCES.md` in the repository, the repository) and "Languages" (each
  language's name, the same page), then the colophon as before.
- **Phone.** Below 48 rem the header takes two rows: wordmark and tools, then the four links
  under a hairline. Below 24 rem the flags stand without their codes, as 36 px targets (above
  WCAG 2.5.8's 24 px), so the header fits 320 px. No sideways scroll at 320, 390 or 1440 px
  (`audit.mjs` fails a page that scrolls sideways at any of them); the three tables that pushed
  a 320 px page sideways (the DDT, the tree's disk, the send room's long identifier in prose)
  now scroll in their own focusable region or break.
- **French label.** « Pourquoi ce musée ? » rather than a literal « Pourquoi ? », which
  says nothing out of context; it fits the phone's second row.
- **Rejected.** A hamburger menu: four links fit on a phone, and a disclosure adds a click and
  a script. Flags in the footer too: the clip path of the Union Jack has an id, and the
  footer's text links are clearer at the end of a page.
- **Checks.** `audit.mjs` checks that the switcher links every other language to the same
  page, that the current one is marked, and the `hreflang` alternates (every language and
  `x-default`), instead of the single "other language" link of v1.

### D16.2 The Hall's ring, faster again

- **Context.** The owner: « L'animation très bien à l'accueil, on peut l'accélérer un peu plus
  encore ? » The issue: about 1.5× faster than v1.2, still readable.
- **Choice.** A txg every 1.3 s instead of 2 s (1.54×), and the uberblock's flight to its slot
  0.4 s instead of 0.6 s (1.5×): the block rests 0.9 s in its slot before the next one leaves,
  long enough to see where it landed. The 2D pulse stays 560 ms (`--dur-3`), within the tick.
  The status line says "one txg every 1.3 seconds" (FR « toutes les 1,3 seconde »). Reduced
  motion and no WebGL: unchanged, nothing moves (D14.2). `verify.mjs` measures the tick (the
  median gap between txg changes over 5.5 s) and fails beyond 1300 ± 100 ms.
- **Rejected.** 1 s (2×): the flight would take 40 % of the cycle, D15.1's reason against it
  still holds. D15.1's "faster than 2 s says nothing truer" stands: the ring is a picture of
  the order of writes, not of ZFS's 5 s default, which the txg room tells.

### D16.3 The Spanish version

- **Context.** The owner: « Ajoute une version ES de l'ensemble également, avec lien adéquat en
  haut de page (petits drapeaux pour les langues comme pour mon site blok) ». The issue: all 14
  stops at `/es/`, the same bar as FR and EN, code excerpts unchanged, every source reference
  kept, the CI checks extended, `hreflang` alternates for the three languages.
- **Routing.** `Lang` is `"en" | "fr" | "es"`; Astro's i18n lists `es`; every page has its
  Spanish twin under `/es/` with Spanish slugs (`arbol`, `copia-en-escritura`,
  `instantaneas`, `compresion-dedup-cifrado`, `sala-de-maquinas`, `historia`; the rest as in
  English). The root page sends a visitor to French if the browser lists French at all (as in
  v1), else to Spanish if it lists Spanish, else to English; a choice made with a switcher
  wins, as before. The 404 page says it in the three languages.
- **Checks.** `check-sources.mjs` already compares every language of a `data-sourced-page`:
  the Spanish History page and dedication must cite the same entries for the same milestones
  as FR and EN (0 problems, 156 references in 44 pages). `check-permalinks.mjs` reads every
  built page, Spanish included. `audit.mjs` and `lighthouse.mjs` take `LANGS`; `verify.mjs`
  captures the Spanish pages and fails on any console error there, while its scripted
  interactions stay in EN and FR (they name the buttons by their label; the figures run the
  same code in every language). The view tests check that each Spanish string table has the
  same keys, in the same order, with the same placeholders as English, draw every state in
  Spanish, and check Spanish counts.
- **Numbers.** One helper, `src/lib/l10n.ts`, for the three languages: Spanish takes a decimal
  comma and, after the RAE, a narrow no-break space between thousands from five digits on
  (`4211`, `92 000`). Plurals: singular for exactly 1, as in English. Lists end in « y ».
  French thousands in the compression room now use U+202F like the other rooms (a plain space
  before). The txg room's clock shows a decimal comma in French and Spanish (it showed a point).
- **Style.** Neutral Spanish with peninsular spelling, no « vosotros ». Controls in the
  infinitive (« Paso siguiente », « Cortar la corriente », « Iniciar », « Pausar »,
  « Reanudar »), as Spanish interfaces do; prose impersonal, « tú » where the English addresses
  the visitor. « » for our own quotations (`html[lang=es] q`, no inner spaces); quotations of
  English sources stay in English in `<q lang="en">`, with « traducción nuestra » where the
  French has « notre traduction ».
- **Terms.** Code names stay as the code has them (uberblock, txg, dnode, objset, metaslab,
  space map, vdev, ZIL, SLOG, ARC, MRU/MFU, DDT, `log` as a vdev class, dynamic fit, extent).
  Then: Hall « Vestíbulo », room « sala », History wing « Ala de la historia », Engine room
  « Sala de máquinas »; block pointer « puntero de bloque »; checksum « suma de comprobación »;
  self-healing « autorreparación »; copy-on-write « copia en escritura »; transaction group
  « grupo de transacciones », open / quiescing / syncing « abierto / en cierre / en
  sincronización »; commit « confirmar »; beat (tree room) « fase », step « paso »; label
  « etiqueta »; slot « ranura »; ring « anillo »; mirror « espejo »; stripe « banda »; skip
  sector « sector de relleno »; write hole « agujero de escritura » after « write hole » once;
  hole « hueco »; embedded « integrado »; flush « volcar, volcado »; snapshot « instantánea »;
  clone « clon »; birth time « fecha de nacimiento »; hit / miss « acierto / fallo »; ghost
  list « lista fantasma »; eviction « expulsión »; the intent log « el registro (de
  intención) » and a log record « una entrada »; a stream record and recordsize « registro »;
  replay « reproducción »; the dedup log « el log de la DDT »; stream « flujo »; encryption
  « cifrado », key « clave »; resilver kept, glossed once per page « (la resincronización de un
  disco) », because « reconstrucción » is the sequential rebuild; hot spare « disco de
  repuesto », distributed spare « repuesto distribuido »; top-level vdev « vdev de primer
  nivel »; range tree « árbol de rangos »; commit waiter « espera de confirmación »; torn
  « roto/a »; thread « hilo »; the DDT's refcount column « Refs. » (short like the English
  « Refcount », so the table fits a 390 px phone).
- **Rejected.** « Reproducir » for Play: it is also the word for the ZIL's replay; « Iniciar »
  is unambiguous. « Registro » for a ZIL log record: it collided with the log itself
  (« los registros van al registro »). « Vaciar » for flush, « incrustado » for embedded,
  « el map » for the space map: variants that crept in between rooms.
- **How.** Seven translators (agents) worked from the English with the French as a reference,
  one or two rooms each, from a brief and a shared glossary; then four `technical-writer`
  passes proofread every page and string table against the English for fidelity, natural
  Spanish and the glossary above (decided between the two passes, from the translators'
  questions), and made about 150 fixes (calques, agreement with placeholders, the terms
  above).
- **Debt.** The Engine room's "both languages" in the account of how v1 was built stays as it
  was (it was true of v1); its present-tense line now says three languages.

### D16.4 A new Fig. 1: the uberblock under the reading glass

- **Context.** The owner loves the v1.2 disk but asks whether it fits the subject, and gives
  carte blanche for something as grand that reflects « ZFS et son code source à la loupe ».
  Keep the disk somewhere fitting.
- **Directions** (`ui-designer`). A: a reading glass over fan-fold listing paper printing the
  source, magnifying `struct uberblock`. B: the struct cast in a bronze plate under a vitrine.
  C: a 2D engraving of a block-pointer tree growing from `ub_rootbp`. **A chosen**: it is the
  museum's method made literal (read in the source, on the exact lines the Hall quotes next),
  photoreal and warm like the disk. B monumentalises the code without reading it (and reads as
  a memorial plaque); C repeats the tree and copy-on-write rooms and becomes a thicket at 340 px.
- **What is printed.** `include/sys/uberblock_impl.h` lines 36–150 at `zfs-2.4.4`
  (`71a9f957`), read with `git show` from the clone, never typed; the glass over lines 122–128,
  `struct uberblock`. A quotation, not the whole file (the Engine room says the site does not
  redistribute OpenZFS files): no licence header, the caption names the file, the lines and the
  tag, with permalinks. `src/assets/glass-plate.json` records the file, the ranges, the SHA and
  the SHA-256 of the printed lines; `scripts/check-plate.mjs` (in CI, with a unit test)
  re-reads them from the frozen commit and fails on any difference; the plate also records the
  SHA-256 of `glass.webp`, so a stale image beside a regenerated plate fails too.
- **How.** `scripts/render-glass.mjs`: one WebGL2 fragment shader in headless Chromium
  (SwiftShader) ray-traces a biconvex BK7 lens (refraction twice, a little dispersion at the
  rim), so the text under the glass is the same page seen through it, at the magnification its
  optics give (×1.5); the lamp's light through the lens gives the caustic and the shadow. The
  paper texture is drawn from the source text in DejaVu Sans Mono, loaded by path and checked
  by hash, so two runs give byte-identical image and plate. A second pass writes the page point
  each pixel shows, so the callouts land where each token is actually seen, through the glass
  or not. Transparent ground, 1800 × 1440 master, 5:4 like the disk.
- **Critique rounds** (`ui-designer`, two). Round 1: the struct centred and legible (the glass
  is placed by reading back which page point its centre shows; the camera turned so the text
  runs about 15° from horizontal instead of 30°), the leaders kept on a phone with the numerals
  off the lens, the handle kept over the paper for the dark theme, a highlighter per line.
  Round 2: the dots sat on the names they label, now one column past `{`, `ub_txg;` and
  `ub_rootbp;`, numerals 2 and 3 on the right so no leader crosses the struct; the lens's rim
  shadow softened (a grey penumbra, not black) after a higher lamp put the ring across the
  struct. Left open for the Design/UX review: green-bar stripes on the paper in the light theme,
  a larger Fig. 2 on a phone.
- **Weight.** WebP keeps its alpha lossless by default and the figure's wide fade doubled its
  weight: Astro's sharp service now encodes WebP at quality 75 with a lossy alpha at 60
  (`astro.config.mjs`), with no visible artefact on either ground. Largest served size: 98.6 KB
  WebP and 68.2 KB AVIF at 1440 px, under the 150 KB budget.
- **The disk.** Kept, as Fig. 2 of the dedication « Why this museum? », beside its first
  paragraph: « never, ever trust the underlying hardware » is the disk ZFS does not trust.
  `Exhibit.astro` is the plate both figures share (image, leaders, numerals, list).
- **Rejected.** A hex dump of an uberblock under the glass: data, not code, and it cannot be
  checked against the clone. A system monospace: resolved per machine, so not deterministic.


## v1.3.1 (ALG-122): before the first public release

### D17.1 The current language and the current section, without colour

- **Context.** The Design/UX review of v1.3: the active language differed from the others by
  text colour and flag opacity only, almost nothing at 320 px where the codes are hidden; no
  header link was current on a room page; the Spanish nav wrapped at 320 px; Fig. 1's paper
  was the brightest object of the dark Hall.
- **Choice.** The active language takes the nav's mark: a 1 px accent line under the code and
  the flag, under the flag alone below 24 rem (a pseudo-element, so the 44 px target and the
  pill's hover border are unchanged); `aria-current="true"` stays. On every page other than
  the Hall and History, "Rooms" is current (`aria-current="true"`, the same underline): the
  Hall and History keep their own links. Below 22.5 rem (360 px) the nav's gap drops to
  0.5 rem and its text to 0.78 rem: Spanish needs 278 px of text in 288, so a gap alone could
  not hold one row. Fig. 1 takes `filter: brightness(0.91)` in the dark theme only, through
  an `Exhibit` prop (`dimInDark`), so Fig. 2 and the light theme are unchanged.
- **Rejected.** A ring around the flag: the underline is the mark the nav already uses, one
  sign for "current" in the header. A dimmer re-render of `glass.webp`: one master for both
  themes, and the render script stays deterministic. Spreading the links across the row:
  English and French then gape on a phone.

### D17.2 The release dry run, and paths out of the tree

- **Context.** The tree is about to be public (D14.5). `RELEASE.md` steps 1–2 were rehearsed on
  this branch's head; the extended list of private names found the build machine's working
  directory (a path under the home directory) in five lines, a layout detail of the team's machine.
- **Choice.** Those lines name the OpenZFS clone `../openzfs`, beside the repository, which any
  reader can reproduce. The issue ids (`ALG-n`) stay: bare identifiers, with no link to the
  team's tracker. The results are in the issue's `release-dryrun` document, not in the tree.

### D17.3 Who publishes

- **Context.** The public repository will be the new `algotitanhq/uberblok`, the name
  `REPO_URL` and `SOURCES_URL` already use; the private one becomes `algotitanhq/uberblok-private`
  at publish time.
- **Choice.** After the owner's Go, the team runs `RELEASE.md` steps 1 to 3 (check, one-commit
  export, rename then create and push); the owner sets only the Cloudflare secret and
  variables (step 4). The rename comes first since the two repositories cannot share the name,
  and GitHub's redirect from the old name ends when the new repository takes it, so clones of
  the private repository change their remote before the rename (`code-reviewer`: a clone
  left on the old URL could push the private history to the public repository). The first
  deploy is a manual CI run on `main`, which the deploy condition now accepts besides a push:
  the first push of the public repository comes before the Cloudflare keys.

### D18.1 The README for the public export

- **Context.** The release gate of ALG-122 (SHOULD 1–2, NIT 5): the README still said French
  and English only, "not deployed yet", and kept a section on the private preview; the font
  licence was named nowhere.
- **Choice.** Three languages throughout; the Status and Preview text that only held until
  publication goes, and the private preview stays in `docs/dev.md` alone. The Deploy section
  says the site is deployed to Cloudflare Workers from `main`, with no URL: the `workers.dev`
  subdomain is known only after the first deploy, and the URL comes in a later commit. The
  font licence (SIL OFL 1.1, Fraunces, Inter, Instrument Serif) goes in the README credits.
- **Rejected.** The credit in the Engine room: it would change three pages and their captures
  the night before publication, for a fact the licence file of each package already carries.

## Analytics (ALG-128)

### D18.2 Cloudflare Web Analytics, in the production build only

- **Context.** The owner wants visits counted on the public site (decision of 2026-10-20,
  ALG-127), with Cloudflare Web Analytics as on blok (`78c2ba8`: `config.extra.cf_web_analytics`
  and `BLOK_PROD=1`). Never in forge previews or any other build.
- **Where the token lives.** `CF_WEB_ANALYTICS_TOKEN` in `src/lib/analytics.ts`, the token the
  owner posted on ALG-127. It is a public value (it ships in every page), so a constant in the
  repository, not a secret or a CI variable. An empty token emits nothing. Typed `string` so
  `astro check` accepts both values.
- **The gate.** `ANALYTICS_ON` = `analyticsOn(PUBLIC_RELEASE, token)`: `PUBLIC_RELEASE === "true"`
  at build time and a non-empty token, a pure function that `scripts/test/analytics.test.mjs`
  covers. The same switch as the deploy (D-R1): the Build step in `ci.yml` sets it with the
  Deploy step's own condition, copied word for word (push or manual run on `main`; keep them
  identical), so only the build that ships has it; branches, PRs and `preview` never set it, nor
  local builds unless the developer exports it or puts it in a `.env` file. The Build step
  then fails both ways: a build without the switch that contains the beacon, and a release build with a page whose beacon is missing or has no token. The Deploy condition is unchanged.
- **Where.** `src/components/Analytics.astro` (Cloudflare's tag, `defer`) in the three HTML
  shells: `Base.astro`, the root `index.astro` and `404.astro`. The Content-Security-Policy
  of D19.2, which came after, allows the beacon's two hosts (D19.3).
- **What the site says.** The Engine room said "no analytics" in three languages. Its hosting
  line follows `ANALYTICS_ON`: unchanged when off; when on, it says Cloudflare Web Analytics
  counts visits without cookies or fingerprinting, and what the browser sends Cloudflare for
  it (page address, referrer, browser type, load times, IP address), as `privacy-engineer`
  advised: no banner is needed without cookies or storage, but the transfer is disclosed.
- **Rejected.** A CI variable for the token: one more setting for the owner to manage, for a
  value that is public anyway. Gating on Astro's production mode: `npm run build` is
  production mode on every machine, previews included.

## v1.3.3 (ALG-134): hardening after the launch

### D19.1 The account ID asked from Cloudflare and masked, never read from `vars`

- **Context.** The Deploy step's log showed `CLOUDFLARE_ACCOUNT_ID` in clear: it came from
  `vars`, and the runner prints each run step's `env` and script, expressions filled in, in the
  step's header. The brief proposed a first step `echo "::add-mask::${{ vars.CLOUDFLARE_ACCOUNT_ID }}"`.
  Since ALG-136 the keys live in the `algotitanhq` organization: the secret
  `CLOUDFLARE_API_TOKEN` and the *variable* `CLOUDFLARE_ACCOUNT_ID`, with no repository-level
  copies (ALG-137).
- **Choice.** No step reads the variable. The Deploy step gets only the token; it calls
  `GET /client/v4/accounts` with it, keeps the ID if the token sees exactly one account (else it
  stops with an error), registers it with `::add-mask::$account` (the header shows the shell
  variable's name, not its value) and exports it as `CLOUDFLARE_ACCOUNT_ID` for `wrangler`. The
  deploy condition no longer reads `CLOUDFLARE_ACCOUNT_ID` (`PUBLIC_RELEASE`, `main`, a push or
  a manual run), so not even a debug re-run prints the ID. Nothing
  new is needed from the owner. Proved on the branch with a temporary probe step (commit
  `94ce144`, run 39503479503, then removed): "token visible", "accounts seen: 1, success: true",
  the ID printed as `***`, and no 32-hex string in the whole log.
- **Rejected.** The `::add-mask::` step fed from `vars`: its own header prints the expanded
  command, so the ID would show once more, unmasked. Passing the value through the step's `env`:
  the header prints `env` too. An organization secret `CLOUDFLARE_ACCOUNT_ID` (the first
  version of this PR asked for a repository one, which ALG-137 forbids): one more key for the
  owner to set and keep in step with the variable, for a value the token already gives. Letting
  `wrangler` find the account by itself: same lookup, but the ID would not be masked before
  `wrangler` prints anything. The ID in `wrangler.jsonc`: it would be in the public tree.

### D19.2 Security headers in `public/_headers`, a CSP with script hashes

- **Context.** The public site had no security header (ALG-125, `static-check`). It is static
  assets only, no Worker code, and stays so.
- **Choice.** `public/_headers`, copied to `dist/` and applied by Workers static assets to every
  path: HSTS (one year, subdomains, no preload), `nosniff`, `strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` with `frame-ancestors 'none'`, a `Permissions-Policy` that turns off
  camera, microphone, geolocation, payment and USB, and a CSP. The CSP allows only the site's
  own origin for everything; `script-src` adds the sha256 of each of the three inline scripts
  (`Base.astro`: the theme before first paint and the theme button; `index.astro`: the
  language redirect), so no `'unsafe-inline'` for scripts. `style-src` keeps `'unsafe-inline'`:
  Astro's `<style>` blocks and some 28 000 `style` attributes in the SVG figures cannot be
  hashed. The 3D chunks, fonts and images are files under `/_astro/`, so `'self'` covers them;
  no `eval`, no worker, no `data:` or `blob:` URL in the build. `scripts/check-csp.mjs`, a CI
  step after the build, fails if an inline script has no hash in the policy, a hash matches no
  inline script, an inline event handler or a `javascript:` URL appears, a second policy, a
  `script-src-elem` or a `script-src-attr`
  appears, or `script-src` holds anything but `'self'`, `'none'` and hashes (a keyword such as
  `'unsafe-inline'` or `'strict-dynamic'`, a host, a scheme, a wildcard; since D19.3, one host
  is allowed, the analytics beacon's): an
  edit to an inline script then fails CI instead of breaking the theme on the live site.
- **Rejected.** `'unsafe-inline'` for scripts: it gives up most of what a CSP is for, for three
  stable scripts. Moving the three scripts to files: the theme script must run before first
  paint, inline. Astro's experimental CSP: it puts the policy in a `<meta>`, which cannot carry
  `frame-ancestors`, and adds a feature flag for three hashes. `upgrade-insecure-requests`: every
  URL is already same-origin and HSTS covers HTTPS; it would break `wrangler dev` over HTTP.

### D19.3 The CSP allows the analytics beacon's two hosts, and nothing else (ALG-140)

- **Context.** D18.2 (the Cloudflare Web Analytics beacon) and D19.2 (the CSP) were built in
  parallel; merged as they were, the browser would block the beacon on every page.
- **Choice.** Two sources added to `public/_headers`, exactly: `https://static.cloudflareinsights.com`
  in `script-src` (the beacon's file, an external script, so no hash) and
  `https://cloudflareinsights.com` in `connect-src` (where the beacon posts its report).
  `scripts/check-csp.mjs` now allows those two and nothing else: `script-src` may hold
  `'self'`, `'none'`, hashes and that one host; `connect-src` must be present and hold only
  `'self'`, `'none'` and the report host; `default-src` (the fallback of a missing directive)
  only `'self'` or `'none'`. Any other host, a wildcard, a bare scheme, a path, `http://` or
  upper case fails CI, and the test covers each. The Build step's guard against a beacon in a
  build that is not deployed reads only the HTML pages (`dist/_headers` names the hosts too),
  and its release check matches the whole beacon tag with its 32-hex token. Off (every build but the deployed one) the pages carry no beacon, so the two sources
  allow nothing that is there.
- **Rejected.** `https://*.cloudflareinsights.com` or the bare scheme `https:`: wider than the
  two hosts the beacon uses. Serving `beacon.min.js` from the site: Cloudflare updates it,
  and the report would still go to `cloudflareinsights.com`.

## Referrers (board, 2026-10-21)

### D20.1 The root `/` redirects in a Worker, so Web Analytics sees where visits come from

- **Context.** On the Show HN day every visit showed as "direct": `/` sent the visitor on with
  `location.replace()` before the beacon could report, so the landing page saw `/` as its
  referrer. The source (Hacker News, Reddit, a blog) was lost, and visits were undercounted,
  since a page reached from the site itself is not a new visit. This amends D1.4 (root `/`),
  D1.5 and D19.2 ("no Worker code, and stays so").
- **Choice.** A Worker that runs for `/` only (`run_worker_first: ["/"]`, `worker/index.js`)
  answers a 302 to `/en/`, `/fr/` or `/es/`, query string kept (UTM tags). The browser keeps
  the original Referer across an HTTP redirect, so the room's beacon reports the real source.
  The language rule is D1.4's: the one chosen with the switch, else French if the browser
  lists French at all, else Spanish, else English (`worker/root-lang.js`, pure, covered by
  `scripts/test/root-lang.test.mjs`; a language refused with `q=0` does not count). The switch
  now also sets a first-party `lang` cookie (one year, `SameSite=Lax`, `Secure`), a preference
  the visitor asked for, since a Worker cannot read `localStorage`; nothing else reads it. The
  redirect is `private, no-store` with `Vary: Accept-Language, Cookie` and carries the
  security headers that apply to a body-less response. Every other path is still static
  assets with `public/_headers`. `src/pages/index.astro` stays as the fallback for
  `astro preview` and any build served without the Worker. Checked with `wrangler dev`: the
  three languages, the cookie, the query string, `/index.html` → `/`, the 404 page, and in
  Chrome a cross-origin link to `/` lands on `/en/` with the linking page as `document.referrer`.
- **Rejected.** Delaying the client redirect until the beacon has sent (a visible pause, and
  `/` counted as a page). A `?ref=` parameter (Web Analytics reads `document.referrer`, not
  the URL). English unprefixed at `/` (rejected in D1.4).

## v1.4 pilot (ALG-173): the copy-on-write room as a question

### D21.1 The room format: a question, a plain answer, the figures, then Source notes

- **Context.** Readers of the launch threads (r/zfs, Hacker News) found the rooms hard to follow
  and the prose machine-like: « citing every line is not explanation or insight », « less AI-y
  texts », « Make the code open to the right instead of a new window ». The English
  copy-on-write room is the pilot; the other rooms follow it once it is approved.
- **Choice.** A room is laid out in this order:
  1. **One question as the `h1`**, asked as a reader would ("What happens when I change a
     block?"). The room's catalogue title stays as the kicker (`Room 3 · Copy-on-write, …`), so
     the Hall map, the room navigation and the other languages are unchanged.
  2. **A plain answer**, before anything else: three short paragraphs at most, no code, no link,
     for a ZFS operator who does not know the internals. The problem first, then the mechanism.
     A term of the trade is glossed the first time it appears ("a root record called the
     uberblock").
  3. **The figures**, each with a short paragraph that says what to try in it.
  4. **"In the code"**: one `h3` per place in the source, a short paragraph that may name a
     function, then one **Source note**. Only the lines that carry the idea: in this room 4
     excerpts and 34 lines instead of 3 and 93, and 14 links to GitHub instead of 32, none of
     them in the prose (measured on the built page).
  5. **What the figures leave out**, as before.
- **Source notes.** `SourceNote` is a `<details>` (label slot, body slot with an `Excerpt` and its
  notes); with no script it opens inline. `SourcePanel`, one per page, takes over at 64rem
  (1024 px) and wider: the summary's click moves the note's body into a non-modal
  `role="dialog"` panel fixed on the right, `body` gets the panel's width as right padding so
  nothing is hidden under it, and the summary is scrolled back to the same height on screen, so
  the reader keeps their line. Focus goes to the panel's title; Esc or the close button moves
  the body back and returns focus to the summary, and Tab off either end of the panel goes back
  there too. Opening another note swaps the panel's content. Narrowing below 64rem puts the
  body back inline, still open. GitHub links live only in the notes, pinned to `zfs-2.4.4`. The
  short excerpts are new entries of `ANALYSIS.md`, checked against the frozen commit like the
  others.
- **Scripts as files.** Astro inlines a component script under 4 KB, and an inline script needs
  its own hash in the CSP (D19.2). `vite.build.assetsInlineLimit` is a function that refuses
  `.js` chunks and returns `undefined` for anything else, so Astro and Vite keep their 4096-byte
  default for stylesheets and assets. The only change in the build is the panel's script as a
  file under `/_astro/` (checked: every other page's HTML is identical; a plain `0` would have
  turned some 40 inlined stylesheets into requests).
- **Style rules for room prose.** Written for the ear: short sentences, concrete words, one idea
  per sentence. No grand adjectives, no "it's not X, it's Y", no list of three for rhythm (a real
  sequence of events is fine), few dashes. Every claim stays as precise as the code (reads from
  disk are checked, not reads served by the ARC; `ECKSUM` rejects one copy of a mirror, not the
  read). The text goes past the `technical-writer` subagent, then is read aloud; if it sounds like
  a brochure, it is rewritten.
- **Rejected.** A modal dialog: it hides the text the reader wants to keep in view. Code
  excerpts left in the prose and only collapsed: the prose would still be cut by links and line
  ranges. A panel that overlays the text without padding: at 1024 px it would cover half of the
  paragraph being read. Opening GitHub in a new tab: the feedback asked for the code beside the
  text.

### D21.3 D21.1 on the Hall, the History wing and the Engine room

- **Context.** [ALG-205](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-205) carries the
  three pages that are not rooms about one mechanism. D21.1 was written for rooms that cite code;
  each page was checked against it on its own. On Hacker News a reader wrote of the Hall: « I was
  doing well until I got lost at Map of the Visit. I forgot I was pretending to be in a museum. »
- **The Hall: D21.1 applies in full to the uberblock section.** The Hall is the only one of the
  three that explains a mechanism. Its section asks "How does ZFS find its data after a crash?",
  answers in three plain paragraphs (txg and uberblock glossed once), says what to try in the
  ring, then shows the code in three Source notes (`struct uberblock`, the slot choice in
  `vdev_uberblock_sync`, the choice on import in `vdev_uberblock_load_done`): 15 lines of code,
  all new `ANALYSIS.md` entries. The page's `h1` stays the wordmark: the Hall is the home page,
  and its question is the section's `h2`.
- **The ring as a teaching figure.** A **Next txg** button commits one txg per press and stops
  the clock, so the reader sees one effect per action: the live line says which slot the txg
  takes and why (`txg mod slots`) and that the previous uberblock stays in its slot. It works
  with reduced motion or without WebGL (where the clock never runs) and the pulse animation now runs only under
  `prefers-reduced-motion: no-preference`. Without script the 2D ring stays as before. The ring
  was improved, not rebuilt.
- **Wayfinding in plain words.** The metaphor stays in the names of the rooms, not in the words
  that guide the reader: "Map of the visit" becomes **All rooms** (Toutes les salles, Todas las
  salas) as the Hall's section heading, the link under each room's navigation and the footer
  link (the header already said "Rooms"); the footer group
  "The visit" becomes **Contents**; "End of the visit." becomes "This is the last room.". The
  Hall's first screen links to All rooms beside "Why this museum?", and the uberblock section's
  kicker is "The uberblock" instead of "The object in the Hall". These labels live in
  `src/lib/ui.ts`, shared by every page: changed here because the feedback was filed on this
  issue, and only these strings.
- **The History wing: a question, no Source notes.** `h1` "Where does ZFS come from?", the
  catalogue title as the kicker, an intro without staged phrasing. The timeline cites sources,
  not code, so there is no "In the code" section. Its 40 numbered notes stay as they are: each
  points to a dated, named claim listed in `SOURCES.md`, and wrapping them in collapsible Source
  notes would hide the dates and names the timeline is made of and add a click per fact.
- **The Engine room: a question, nothing else of D21.1.** `h1` "How was this museum made?". It
  has no figure and no mechanism to explain, so there is no plain-answer block, no figure text
  and no "In the code"; its lead says in one sentence what the page covers.
- **Links outside Source notes.** Three GitHub links on the Hall stay outside the notes: two in
  the caption of Fig. 1 (where the plate's lines come from) and one in the Dedication (the
  `AUTHORS` file). They attribute a figure and a fact, like the History citations; they do not
  cut the prose that explains the uberblock.
- **Rejected.** A question as the Hall's `h1`: the home page's title is the site's name, and
  search results and shares show it. Dropping the museum vocabulary everywhere: the room names
  are the catalogue, and the feedback was about the words that guide the reader.

## v1.4 copy-on-write follow-up (ALG-183): FR and ES, teaching figures, panel fixes

### D21.2 The figures teach by acting; the panel after its design review

- **Context.** The roll-out of D21.1 to every room starts here. This issue also carries the
  pilot's design debt (two SHOULDs, four NITs on `SourceNote`/`SourcePanel`) and asks for figures
  where "the reader acts and the figure carries the explanation". It is the only roll-out issue
  that touches shared code, so the other rooms rebase onto it.
- **FR and ES.** Adapted from the English room, not translated line by line: vouvoiement in
  French, tuteo in Spanish (as in the rest of the site), French spacing by D1.9. The same four
  excerpts and the same notes' line ranges in the three languages, so `ANALYSIS.md` gets no new
  entry and the Engine room's count stays at 120.
- **Figures.** `CowTree` and `MirrorHeal` are improved, not rebuilt. Each action now shows one
  effect in the drawing: the picked block is outlined (and can be clicked; the radios stay the
  keyboard path); a snapshot puts an S on every block it reaches; after a power cut the blocks
  written for the next txg stay drawn, in red and under the tree the pool came back to, until
  the next action; a legend names the four looks. In `MirrorHeal` each damage says what it did in
  one line, and the expected checksum lights up while a block is compared. The narration is
  plain and carries no code links: D21.1 keeps GitHub links in Source notes only, and the
  figures' steps are the ones the four notes show. Without script the figures show their text
  version, as before.
- **Panel.** Below a 36rem panel body (windows from 1024 px to about 1350 px) a note's line
  range sits above its text, so the text keeps the panel's width; the code still scrolls
  sideways. The shadow is a theme token, `--panel-shadow`, faint in light. The open note's pill
  takes an accent fill; an inline note has a 2 px rule on its left; inside a note the Excerpt's
  symbol heading is hidden, since the note's label names it.
- **Rejected.** Making `--line-strong` stronger for the pills, as the review suggested: every
  figure card and button on the site uses it, so the pill gets its own mix
  (`--fg-faint` 65% into `--line-strong`, about 3:1) and no other room changes. Removing the
  power-cut blocks at once (as before): the reader could not see that they were written and
  are simply unreachable.
- **After the design review (ALG-183).** The picked block wore the accent outline that the key
  calls "new copy", so a picked old block looked new. The pick now has a ring of its own in the
  ink colour, with its own line in the key; the accent outline means a new copy only. The ghost
  labels of a stacked card ("R · snapshot") go from 10 to 11 units, 12 below 480 px (9.5 CSS px
  on a 390 px phone, from 7.7). They may run over the front card's top edge, short of the next
  card; a longer one is squeezed with `textLength` rather than made smaller.

## v1.4 transaction groups room (ALG-189)

### D24.1 The TXG room as a question, and a figure where each step outlines what it changed

- **Context.** The roll-out of D21.1 ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)),
  third room. It had 5 excerpts (148 lines of code) and 43 links to GitHub in each language,
  34 of them in the prose, plus a "code" link after every event the figure narrated.
- **Question.** "When does my write reach the disk?" (« Quand mon écriture arrive-t-elle sur le
  disque ? », « ¿Cuándo llega mi escritura al disco? »). The operator's question; the answer
  goes from the cost of committing every write to the batch, the five seconds, the commit by
  the uberblock, and what a power cut loses (and fsync and the ZIL).
- **Figure.** `TxgPipeline` is improved, not rebuilt; the model (`src/lib/txg.ts`) is unchanged.
  Each event outlines the one part of the figure it changed: the CPU cell a write joins or
  leaves, the dirty-data meter, the txg card that closes, drains or is taken, the pass row, the
  "On disk" line, or the thread row that woke or asked. The outline is static (it fades in only
  when motion is allowed), so it reads under reduced motion. Each stage has a one-line plain
  role under its name; a write's dot drops in only when it is new; a busy CPU cell no longer
  takes the accent border, which is kept for the outline. Next event is the first button. The
  two starting writes begin 0.3 s apart so that each ends on its own step. The narration and
  the log are plain and carry no code links (D21.1): the seven Source notes follow the same
  steps. Without script the text version is shown, as before.
- **Code.** Seven Source notes, 58 lines, all new short cuts in `ANALYSIS.md` (TXG room, 6 to
  12), checked against `zfs-2.4.4`. The "three depths" section is gone: its sentence and
  paragraph repeated the answer, and its detail now lives in the notes.
- **Rejected.** Narrating with the code names (`tc_count`, `txg_hold_open`): the reader the
  question speaks to does not know them, and the notes show them. Emitting one release per
  step inside the model: it changes a tested model to fix what staggering the first two writes
  fixes.
- **Phone (design review).** Below 40rem the figure is taller than the screen, so the outline
  was off screen for most presses. Next event and the narration now sit in a bar that sticks to
  the bottom of the screen while the figure is in view (`.live` and `.controls` lend no box
  there, so the bar's sticky range is the whole figure), and after a press the outlined part is
  scrolled into view above the bar if it is not visible. The other buttons stay where they were;
  the desktop layout is unchanged. The open txg card keeps its accent tint but takes the neutral
  border, so an accent frame means only "this changed". Rejected: scrolling alone, which moves
  Next event away from the thumb.

## v1.4 tree room (ALG-185)

### D22.1 The tree room as a question, and a figure that climbs one level per step

- **Context.** The roll-out of D21.1 (ALG-182)
  starts with the tree and the uberblock room, the most visited after the Hall. It had 12
  excerpts (255 lines of code) and 58 links to GitHub in each language, 27 of them in the
  prose. The issue asks for a figure where the reader changes a block and follows the new
  block pointers up to a new uberblock, one level per step.
- **Question.** "What if the power fails while ZFS is writing?" (« Et s’il y a une coupure de
  courant pendant que ZFS écrit ? », « ¿Qué pasa si se va la corriente mientras ZFS escribe? »). The answer does not
  repeat the copy-on-write room's: it is about the txg as a whole, the one root pointer, the
  flush before the uberblock, the ring of slots and what the import keeps.
- **Figure.** `step()` in `src/lib/tree.ts` now writes the open txg's new blocks one height
  per step, data first and the objset last (`HEIGHTS` = 5: data, L1, L2, the block of dnodes,
  the objset); beat 0 is done when the objset is written, then the four beats as before. This
  is the order of the code: a block's write I/O is the child of its parent's
  (`dbuf_write`, dbuf.c L5411), and `zio_write_compress` holds the parent until every child is
  ready, with its new address and checksum (zio.c L1932-L1939). In the drawing a new copy has a
  dashed outline while in memory, a solid one once written, and fills in at the flush; a pointer from a new copy to a child not
  yet written is dotted and muted, and turns into the accent once the child is written. The 3D
  view draws the same states (an in-memory copy is a faint box, a waiting pointer a faint line).
  Only what changed is animated, in 2D and 3D, and nothing under reduced motion. The commit
  panel marks beat 0 "under way" while the rows are being written. A cut halfway up is a new case
  (`during: 0`): the old tree wins, as with a cut during the flush. Writing a second block is
  refused once the first level is written, as the code quiesces the txg before `spa_sync`.
  The other controls, the text version and the no-script state are unchanged. The figure counts
  "rows" (data, L1, L2, dnodes, objset), not "levels", which the room keeps for indirect blocks.
- **Code.** Seven Source notes, 69 lines (`ANALYSIS.md` tree room, excerpts 7 and 12 to 17;
  six are new short cuts of longer excerpts, checked against `zfs-2.4.4`). The "three depths"
  section is gone: its one-paragraph summary repeated the answer, and its detail now lives in
  the notes.
- **Rejected.** A separate "climb" button beside Next step: two buttons that both advance the
  sync would make the reader guess which one to press. Drawing the climb as an animation inside
  one step: the issue asks for one level per step, and an animation cannot be paused or read
  under reduced motion.
- **After the design review.** The line that says what the last action did sits under the
  controls, above the tree, and is there from the start ("D2 has changed in txg 4211…"); it
  replaces the list of reasons why some buttons were disabled, which read as an instruction.
  A disabled button gives its reason in the same line, on its press only. The blocks the last
  step wrote carry a ring until the next action (a class, not an animation, so the same under
  reduced motion), and the legend lists every state from the start, so a step changes the
  drawing and never the key. Caption sentences say "the dnode block" and "the objset"; the
  drawing keeps the short labels.

## v1.4 RAID-Z room (ALG-187)

### D23.1 The RAID-Z room as a question; blocks written one after another, a read one step per press

- **Context.** Second room of the D21.1 roll-out ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)).
  The room had 5 excerpts (135 lines of code) and 47 links to GitHub in each language, 25 of
  them in the prose and 11 in the figure. The issue asks for a figure where the reader writes
  blocks of different sizes and sees the stripe width follow them, then fails a disk and
  watches the reconstruction, one step per action.
- **Question.** "What happens when a disk in my RAID-Z fails?" (« Que se passe-t-il quand un
  disque de mon RAID-Z lâche ? », « ¿Qué pasa cuando falla un disco de mi RAID-Z? »). The answer
  keeps D21.1's order, the problem first (the RAID-5 write hole, which shows when a disk dies),
  then the mechanism (one stripe per block, written to free space), then what happens on a
  failure (parity rebuilds a missing disk, the parent's checksum finds a disk that lies). The
  writing review suggested opening with the failure; D21.1's "problem first" wins.
- **The map** (`RaidzMap`, improved, not rebuilt). The size buttons (4, 8, 32 and 128 KiB) write
  a new block right after the last one, so the map holds several blocks: the live one in full,
  numbered by sector, the earlier ones faded and labelled with their letter. Each press shows
  one new stripe and its width; children the live block does not touch have a faint header.
  The psize field still edits the live block, `b` is where block A starts, and parity, children
  or ashift lay every block out again. Older blocks scroll off the top past 24 rows (and past
  11 blocks, when `b` moves past the dropped one); labels hide only when the live block alone
  is taller than 26 rows, as before. The counters of `vdev_raidz_map_alloc` move into a closed
  `<details>`, with `b` added.
- **The read.** "Read the last block" shows one step per press, from `readPlan()` in
  `raidz-view.ts`: each step is a line and its marks on the map (columns read or used, columns
  rebuilt from parity, children assumed wrong, columns written back), with a legend. Attempts
  of `vdev_raidz_combrec` are one step each (the first 12 and the last 3, the others in one
  line), and "Skip to the result" shows the rest. The read panel sits beside the map from about
  1000 px of figure width, so a step's marks stay in view; below that it wraps under the map. A
  visually hidden live region reads each new step once. The model (`raidz.ts`) is unchanged.
- **The write hole** (`WriteHole`). Four steps instead of three: the reboot and the disk failure
  are now separate, and the RAID-Z side gets its own disk failure, where A1 is rebuilt right.
  With script, Back and Next step through both sides at once and the live region reads the two
  new captions; without script every step shows, as before.
- **No code links in the figures.** The readout's "code" links and the read's links are gone;
  D21.1 keeps GitHub links in Source notes, and the five notes carry them (25 per language).
- **Code.** Five Source notes, 70 lines (`ANALYSIS.md` RAID-Z room, excerpts 6 to 10: short
  cuts of excerpts 1, 2, 3 and 5, and the read row, checked against `zfs-2.4.4`). The "three
  depths" section is gone: its sentence and paragraph repeated the answer, and its detail is
  in the notes. The raidz1 parity swap and RAID-Z expansion move to "What the figures leave
  out".
- **Rejected.** A per-child button on the map to fail a disk: the map is one `role="img"`, and
  buttons inside it would be hidden from screen readers; the per-child selects stay. Animating
  the read on a timer, as before: the issue asks for one step per action, and a timer cannot be
  read at the reader's pace. Placing blocks where a real metaslab would: the allocator is
  another room; consecutive blocks show the widths without it.
- **Design review fixes (2026-10-23).** The sentence that explains a write sits right under the
  size buttons, where the eye already is. Below 45rem the read panel's parts are ordered around
  the map (damage, map, read buttons, newest step, older steps, key), so one press and its effect
  fit on a phone screen; the step list shows newest first there (`column-reverse`), while screen
  readers keep the oldest-first order and the live region announces each new step. The key
  gains the two damage states, and the first read step says what each damaged child holds of
  the block, so damaging a parity-only or empty child explains why nothing is rebuilt.

## v1.4 vdevs room (ALG-191)

### D26.1 The vdevs room as a question; the figure says where each block landed

- **Context.** Fourth room of the D21.1 roll-out ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)).
  The room had 14 excerpts (411 lines of code), the most of any room, and 93 links to GitHub
  in each language: 48 in the prose, 7 in the figure's first state (more after each action),
  38 in the excerpts and their notes. The issue asks for a figure where the reader builds a
  pool layout and sees where each kind of block goes.
- **Question.** "Where does ZFS put a block in my pool?" (« Où ZFS range-t-il un bloc dans mon
  pool ? », « ¿Dónde pone ZFS un bloque en mi pool? »). The answer goes from the layouts an
  operator builds (data vdevs, log, special, dedup, a disk being replaced) to the two choices
  ZFS makes for each block: a class by the kind of block, then a path down the tree, where
  each node passes the I/O on with its own functions and a replacement is a temporary mirror.
- **Figure.** `VdevLab` is improved, not rebuilt; the model (`src/lib/vdevs.ts`) is unchanged.
  The line that says what the last action did moves from under the panels to right under the
  controls, and shows from the start (the default pool's last block). The last block's panel
  and the classes table sit beside the tree from 60rem, so a press and its effect share the
  screen; the selected node's table and the spares go below. After a write, the top-level
  vdevs that got a copy take a ring and their block count the accent fill (other counts are
  outlined), and the class row of the block is marked in the table, until the next action.
  These are classes, not animations, so they read the same under reduced motion. A key under
  the tree lists every look from the start. The narration says "copies" where it said DVAs
  and names no function (the class steps say "The special class: it is full", not
  `metaslab_alloc` and `ENOSPC`); the walk down the tree keeps the `io_start` of each node,
  which is the room's point. The list of reasons why buttons are disabled goes: a disabled
  button says its reason on its press, as in the tree room (D22.1). No code links in the
  figure (D21.1). Without script, the first state and the text version show as before.
- **Code.** Nine Source notes, 99 lines (`ANALYSIS.md` vdevs room, excerpts 18 to 26, all
  short cuts of excerpts 2, 4, 5, 8, 9, 10 to 13 and 16, checked against `zfs-2.4.4`): the
  ops table, the mirror's `io_start`, `spa_preferred_class`, the class fallback, the next
  copy on the next vdev, the replacing table, `vdev_add_parent`, the end of the resilver and
  the dRAID column placement. The "three depths" section is gone, as in the other rooms. Left
  out of the notes: `struct vdev`, `vdev_metaslab_group_create` and the embedded log classes,
  `spa_vdev_attach`, the dRAID permutation generator (each is linked from a note, or stays in
  `ANALYSIS.md`).
- **Rejected.** Dropping the function names from the walk down the tree: "each node passes it
  on with its own function" is what the room teaches, and the names are the evidence. A
  sticky bar for phones as in the TXG room (D24.1): here the line under the controls already
  says the effect in words; left to the design review. Rebuilding the figure around one pool
  layout builder: the issue asks to improve the existing figure.
- **Design review** ([ALG-191](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-191)). After a press, the ring and the
  class row were 400 to 1,050 px below the fold. The tree is capped at 24rem, near its natural
  width (12 px labels instead of 17); the classes table now comes before the last block's panel
  beside the tree; after a write or a read, the first vdev it reached is scrolled into view by the
  least amount if it is off screen (instant under reduced motion, as in the RAID-Z room); and the
  line under the controls puts the class's swatch before its name, for phones, where the table is
  below the tree. The answer's second paragraph keeps only the class rules (123 words in EN,
  from 192); the fallback, the spread within a class and the second copy move to what to try,
  where the figure shows each. The fill buttons get their own labelled group.

## v1.4 ARC room (ALG-193)

### D25.1 The ARC room as a question, and a figure that reads one block per press

- **Context.** The roll-out of D21.1 ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)),
  fifth room. It had 8 excerpts (199 lines of code) and 49 links to GitHub in each language, 37
  of them in the prose, plus a "code" link after every line of the figure's log. A scan read its
  12 blocks in one press, so the reader saw the end state and a log of 30 lines, not the blocks
  moving one by one.
- **Question.** "Why doesn't a big read empty my cache?" (« Pourquoi une grosse lecture ne
  vide-t-elle pas mon cache ? », « ¿Por qué una lectura grande no vacía mi caché? »). The
  operator's worry about a backup or a scan; the answer goes from the plain LRU problem to the
  two lists, the shares, and the ghost lists that move them.
- **Figure.** `ArcLab` is improved, not rebuilt; the model (`src/lib/arc.ts`) is unchanged.
  Next read is the first button, in the DOM and on screen, and reads one block per press. Scan 12
  new blocks and Read the hot set again read their first block at once and queue the others,
  which Next read then reads 1 ms apart, as `readAll` did in one go, so every state is the one the
  hand-checked sequence of `ANALYSIS.md` gives. With nothing queued, Next read reads a new block;
  a line above the narration says what it will read next. Read the rest finishes a queue in one
  press, for a reader who has seen enough. Each read outlines the block read (accent), the blocks
  it pushed out (dashed) and the balance line when `arc_pd` moved; the outlines are static, so
  they read under reduced motion. Each list has a one-line plain role under its name. The
  narration, in a live region, says the read in one or three short sentences; the log below gives
  the detail. Both are plain and carry no code links (D21.1); `arc_pd` stays named once, on the
  balance line, since the Source notes show it. Without script the board and the text version are
  shown, as before; the two new legend items need the outlines, so they are hidden too.
- **Phone.** As in the TXG room (D24.1), below 40rem Next read and the narration sit in a bar
  that sticks to the bottom of the screen while the figure is in view, and after a read the block
  read is scrolled into view above the bar. The figure is a flex column, and the bar is moved
  below the board with `order` only, so it stays first in the Tab order on every screen.
- **Code.** Eight Source notes, 70 lines, all new short cuts in `ANALYSIS.md` (ARC room, 10 to
  17), checked against `zfs-2.4.4`. The "three depths" section and the L2ARC coda are gone: their
  detail is in the notes, and the L2ARC is the last step of "In the code". The paragraph on when a
  pass runs and how `arc_c` grows moved to "What the figure leaves out", without links.
- **Rejected.** Keeping a scan in one press and only outlining: twelve outlined blocks show no
  order. A Play button: the reader would watch the scan rather than read it, and the TXG room's
  Play exists because time passes there between events; here nothing happens between reads.
  Putting the bar after the board in the DOM so it sticks on phones without `order`: on desktop
  Tab would reach Next read only after every block.
- **After the Design review.** On desktop the bar sits about 400 px above the board, so a reader
  who scrolled just far enough to see Next read did not see the block it read. `show()` now runs
  on every width: on a wide screen it scrolls just enough to bring the block read into view, never
  past the top of the bar, so Next read stays on screen (measured at 1280×720 to 1920×1080 in the
  three languages). Rejected: moving the second button row and the gap choice below the board;
  the controls would sit apart from the button they qualify. The nine-step tour paragraph is split
  at its three phases: the scan, the ghost hits, the 10 ms re-read.

## v1.4 metaslabs room (ALG-197)

### D27.1 The metaslabs room as a question, and a figure that outlines what each action changed

- **Context.** The roll-out of D21.1 ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)).
  The room had 10 excerpts (276 lines of code) and 66 links to GitHub in each language, 40 of
  them in the prose and a "code" link after every line the figure narrated. The issue asks for
  a figure where the reader allocates and frees blocks and watches the space map and the
  metaslab choice.
- **Question.** "How does ZFS know which space is free?" (« Comment ZFS sait-il quel espace est
  libre ? », « ¿Cómo sabe ZFS qué espacio está libre? »). The answer goes from the problem
  (copy-on-write allocates and frees all the time; a bitmap would be rewritten in place) to the
  mechanism (metaslabs, a free tree in memory, an append-only space map replayed on load), then
  the two-txg grace and condensing.
- **Figure.** `MetaslabLab` is improved, not rebuilt; the model (`src/lib/metaslab.ts`) is
  unchanged. `changes()` in `metaslab-view.ts` compares the state before and after an action, and
  the figure outlines exactly that in ink until the next action: the ranges of the metaslab
  whose state changed, the in-memory trees that changed, the file written or deleted, and the
  words the action wrote on the tape (the whole tape after a condense). Load changes nothing, and
  says the tree is the same. The outline is a class, not an animation, so it reads the same
  under reduced motion; the key gains "changed by the last action". The selected tape entry is
  now inverted, so an outline means only "changed". "What the last action did" moves from the
  bottom of the figure to just under the buttons, and its lines are plain sentences with no code
  links (D21.1) and fewer code names. The metaslab choice: a line under the vdev strip says that
  metaslab 2 is the active metaslab and how ZFS ranks and activates metaslabs, and a write that
  does not fit says ZFS would activate the next metaslab in rank; the "Choosing a metaslab" note
  shows the code. Without script the opening state and the text version show, as before.
  `scripts/verify-metaslabs.mjs` runs the room alone in EN, FR and ES (it was EN and FR inside
  `verify.mjs`) and checks the outline after a delete.
- **Code.** Eight Source notes, 58 lines (`ANALYSIS.md` metaslab room, 15 to 22: 15 is new,
  `metaslab_compare`; the others are short cuts of excerpts 9, 1, 2, 10, 11, 12 and 14, checked
  against `zfs-2.4.4`). The "three depths" section is gone, and the coda on the log space map
  moves into "What the figure leaves out", without links.
- **Rejected.** Modelling the weights of all sixteen metaslabs and moving a write to another
  metaslab when metaslab 2 is full: the segment-based weight needs every metaslab's free-segment
  histogram, and with fifteen empty metaslabs of equal weight the choice would teach nothing the
  sentence and the note do not. "About two hundred metaslabs" in the answer, as the writing
  review suggested: 200 is the target, but a vdev larger than 200 × 16 GiB gets more, so the
  answer keeps "a few hundred". Animating the outline: an animation cannot be read at the
  reader's pace or under reduced motion.

### D27.2 The metaslabs figure after the Design/UX review: contrast, one outline per run, the selected range

- **Context.** Design/UX on PR #14 at 0e331ca: three SHOULD, five NIT
  ([ALG-197](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-197), document `design-review`).
- **Allocated fill.** `--fg-faint` instead of `--line-strong`: 4.3:1 against the free fill
  (`--surface-2`) in both themes, over the 3:1 of WCAG 1.4.11 (it was 1.7:1). In the light theme no
  fill reaches 3:1 against the free fill and 4.5:1 under `--fg` text, so the file labels on the bar
  sit on a small `--surface` chip and keep their contrast on any fill.
- **One outline per run.** Changed ranges of the metaslab closer than 2.5 % of its size (12.8 MiB)
  merge into one dashed box; a rewrite of db touched hundreds of blocks and drew hundreds of boxes.
  The words an action wrote are always the end of the tape, so they are grouped in one nested list
  item outlined once (the whole tape after a condense). Rows of "In memory" and "Files" draw their
  outline inside the row, so two changed neighbours do not draw double lines. A single change looks
  as before.
- **The selected entry on the bar.** A 6 px ink strip just under the bar marks the range of the
  selected tape entry, at least 10 px wide, so B (4 MiB, 3 px on a phone) shows when its entry is
  selected at the opening. The key gains "range of the selected tape entry". Rejected: a label
  above narrow extents with a tick, which would still leave the reader to match the tape to the bar.
- **Smaller fixes.** The dynamic-fit cursor is clamped inside the bar at 0 and 512 MiB; the verdict's
  yes/no has no fixed width; file rows are a grid, so Delete stays on the right in FR on a phone;
  the offset field is named in the reader's language (« décalage », « desplazamiento »), as the
  sentence under it; the "what to try" text of section 1 is three short paragraphs, and says that
  rewrite db stops by itself when the test says yes.

## v1.4 send / receive room (ALG-201)

### D29.1 The send / receive room as a question; one press of Next step, one outlined effect

- **Context.** The roll-out of D21.1 ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)).
  The room had 8 excerpts (186 lines of code) and 48 links to GitHub in each language, 24 of
  them in the prose, plus a "code" link after every line the figure narrated (10 targets). The
  issue asks for a figure where the reader sends a full then an incremental stream and sees
  which blocks travel.
- **Question.** "How does ZFS send only what changed?" (« Comment ZFS n’envoie-t-il que ce qui a
  changé ? », « ¿Cómo envía ZFS solo lo que cambió? »). The answer goes from the cost of
  comparing files (rsync) to the birth txg in every block pointer, the subtree skipped whole
  because copy-on-write rewrites every block above a change, then the stream: records, a running
  checksum the receiver checks before it applies a record, and the from-snapshot named by GUID.
- **Figure.** `SendLab` is improved, not rebuilt; the model (`src/lib/send.ts`) is unchanged.
  Next step is the primary button and sits under the three panels with the line that says what
  the step did; the bar sticks to the bottom of the screen while the figure is in view, on every
  width, since the full stream makes the figure taller than a laptop screen too. Each press
  outlines, in the ink colour, what it did: the block pointer or dnode it tested, the records it
  wrote (`justWritten()` in `send-view.ts`), then on the receiving side the record checked and
  the blocks it changed, or the header refused. The outline is a class, not an animation, so it
  reads under reduced motion; nothing is outlined before the first press, nor without script.
  After a press the outlined part is scrolled into view above the bar if it is not visible. The
  tree's key gains the outline, the stream gets a key (the checksum value, applied, refused).
  The narration is plain: no code links (D21.1) and no function names (`send_cb`, `dump_dnode`,
  `td_min_txg`, `drr_checksum`, the receive functions); record types stay, since the stream
  shows them. "What to try" asks for a full stream first, then from `@s3`, with the numbers the
  table shows (21 records and 11,672 bytes, then 7 and 2,184). Without script the figure shows
  the finished stream from `@s2` and its text version, as before.
- **Code.** Six Source notes, 44 lines, all new short cuts in `ANALYSIS.md` (send / receive room,
  13 to 18), checked against `zfs-2.4.4`: the bound (`send_traverse_thread`), the skip
  (`traverse_visitbp`), data or hole (`send_cb`), the running checksum (`dump_record`), the check
  (`receive_read_payload_and_next_header`) and the from-snapshot found by GUID
  (`recv_begin_check_existing_impl`, which the room did not show before). The "three depths"
  section is gone; `traverse_dnode` and `receive_process_record` are named in a note and in
  "What the figure leaves out" instead of shown.
- **Rejected.** Starting the figure empty, at BEGIN: without script it would show nothing, and
  the finished stream is the figure's summary; the first press starts the send from BEGIN.
  Taking snapshots in the figure: the four snapshots are the history the model and its tests are
  hand-checked against; choosing the from-snapshot shows the same full-then-incremental sequence.
  A sticky bar on phones only, as in the TXG room: at 1280×900 the outlined record of a full
  stream was under the fold while Next step was in view.
- **After the Design/UX review.** On a phone the panels stack, so a step's records and the
  part it tested were rarely on screen together. When the outlined records would sit off
  screen, the step bar repeats them on one line above its text (a copy, `inert` and hidden from
  assistive technology, since the stream and the line already say it), and under the
  three-column width the line goes under the button at full width. A FREEOBJECTS that deletes a
  file draws it once more on the receiving side, dashed and marked deleted, then drops it on
  the next frame: the deletion is an absence and otherwise outlines nothing. The key item for
  the outline is shown by the script only, and the checksum key reads as one sentence.
  Rejected: scrolling to the records instead of the pointer (the reader loses the cause), and
  a second scroll after the first (the page jumps twice per press).

## v1.4 ZIL room (ALG-199)

### D30.1 The ZIL room as a question, and a figure that shows each action one step per press

- **Context.** The roll-out of D21.1 ([ALG-182](https://paperclip.cloudfrancois.ovh/ALG/issues/ALG-182)),
  sixth room. It had 9 excerpts (220 lines of code) and 79 links to GitHub in each language, 41
  of them in the prose and 7 in the figure. A commit was animated on its own after a press, so
  the reader watched about fifteen lwb transitions go by and read the end state.
- **Question.** "What does fsync() wait for?" (« Qu’attend fsync() ? », « ¿Qué espera
  fsync()? »). The operator's question about a database commit; the answer goes from the
  promise of fsync to the txg being too slow for it, the log written first, the replay after a
  power cut, and the SLOG.
- **Figure.** `ZilLab` is improved, not rebuilt; the model (`src/lib/zil.ts`) is unchanged. An
  action (write, fsync, sync, power cut, import, mount) shows its first step at once; Next step
  shows the next one, Show every step the rest. `frameAt` (`src/lib/zil-view.ts`) draws the
  state after each step from the state before the action and its events; a sync and a mount are
  drawn from the state before them until their last step, and the buttons follow the figure (the
  Sync button names the txg being synced). Each step rings what it changed (`targets()`): the
  record, the lwb, the block, the header, the write that returns; the ring is static, so it
  reads under reduced motion, and a key line explains it. The narration says "Step k of n" and
  the step in a plain sentence; the log keeps every step of the last action. Both carry no code
  links (D21.1). Without script the opening state and the text version are shown, as before.
- **Phone and keyboard.** As in the TXG and ARC rooms (D24.1, D25.1), Next step and the
  narration sit in a bar that sticks to the bottom of the screen while the figure is in view,
  and after a step the ringed part is scrolled into view above it. A part of the figure reached
  with Tab is scrolled above the bar too. After an action the focus goes to Next step; after
  Show every step and after the last step it stays in the bar, which is on screen, and a press
  there says the action is over and to choose the next one above. Moving the focus back to the
  action buttons was rejected: on a phone they are a screen away from the ring.
- **Scrolling to the ring, and a short narration (Design/UX review).** When a step rings
  several parts, the figure scrolls to fit all of them above the bar if they fit together, and
  otherwise to the first one, which is the part the narration names: at a replay, the write in
  the application's file comes before the record in the chain, since on a phone the file panel
  sits far above it. The narration says where a log block went and why it is not on the SLOG;
  the log under the figure keeps every class tried. The full list made the bar a quarter of a
  phone screen.
- **What to try.** The first `fsync()` on a dataset with no log creates the log, which takes a
  txg sync, so nothing is logged; the text says so and asks for a second `write()` and `fsync()`
  before the power cut, so that the mount has a record to replay. The 128 KiB example says it
  needs a dataset that already has a log, for the same reason.
- **Code.** Nine Source notes, 74 lines: eight new short cuts in `ANALYSIS.md` (ZIL room, 11 to
  18), checked against `zfs-2.4.4`, and the existing `lwb_state_t` excerpt (6). The "three
  depths" section is gone; its detail is in the notes. "Claim" is « s’approprier » in French and
  « apropiarse » in Spanish (« réclamer » and « reclamar » mean to ask back); "returns" is « rend
  la main » and « vuelve ».
- **Tests.** The `targets()` test runs each selector on the HTML of the step with `ultrahtml`
  (already in the tree through Astro, now a pinned dev dependency), including an `fsync()` with
  no write and more than five lwbs. `scripts/verify-zil.mjs` checks the room alone in the three
  languages on desktop and phone.
- **Rejected.** Keeping the commit animated with a Play button: the reader would watch fifteen
  transitions rather than read them. Telling `frameAt` the action's kind instead of reading it
  from its events: only `sync()` starts with a `sync` event and only `mount()` emits `destroy`,
  and the comment says so.
