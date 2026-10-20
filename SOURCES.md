# Sources

Every historical fact on the site (in the History wing or anywhere else) has a line here.
No fact, date, quote or name without a verifiable source. When in doubt, the fact is removed,
not softened.

## Format

One table per period. One row per claim, with a stable id (`S01`, `S02`, ...). The History
wing cites a row by its id, the page's numbered notes are built from this file, and CI
(`scripts/check-sources.mjs`) fails if a page cites an id that is not here, or if a row here
is cited by no page. Several rows may share one source: the unit is the claim, not the URL.

| ID | Claim (as stated on the site, in English) | Source (URL) | Kind | Date accessed | Notes |
|---|---|---|---|---|---|

- **Claim**: one checkable sentence, exactly what the site says. The French text says the
  same thing, no more.
- **Source**: a URL that a reader can open. Prefer primary sources: the authors' own talks
  and blog posts, commits, mailing-list posts, release notes, official announcements. A
  secondary source (article, encyclopedia) is accepted only when it cites a primary one;
  then cite both.
- **Kind**: `primary` (author, commit, release note, announcement), `first-hand` (a
  project's account of its own history, an editor's introduction to an interview with the
  people concerned) or `secondary`. The History wing uses no secondary source (DECISIONS.md
  D2.4).
- **Date accessed**: `YYYY-MM-DD`. When the original page is gone or blocks automated
  readers, the link is the Wayback Machine copy (with its timestamp) and the original URL
  is in the notes.
- A person is named on the site only if a row here supports it.
- A quotation is verbatim, in its original language, with its source; a translation is
  marked as ours.

## Code facts

Facts about the code (constants, structures, behaviours) do not go here: they are quoted
from the frozen OpenZFS commit in [`ANALYSIS.md`](ANALYSIS.md) with permalinks.

## History

### Origins at Sun Microsystems

| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S01 | Development of ZFS started in 2001 with two engineers at Sun Microsystems. | [openzfs.org wiki, “History” (archived 2020-05-14)](https://web.archive.org/web/20200514210405/https://openzfs.org/wiki/History) | first-hand | 2026-10-18 | Original: https://openzfs.org/wiki/History (behind a bot check). The OpenZFS project's own account. Quote: “2001 – Development of ZFS started with two engineers at Sun Microsystems.” |
| S02 | Jeff Bonwick led the development of ZFS, with Bill Moore as co-lead. | [“A Conversation with Jeff Bonwick and Bill Moore”, ACM Queue 5(6), November 2007 (archived 2011-07-16)](https://web.archive.org/web/20110716221142/http://queue.acm.org/detail.cfm?id=1317400) | first-hand | 2026-10-18 | Editor's introduction to an interview with both: “Jeff Bonwick, CTO for storage at Sun, led development of the ZFS file system” and “Bonwick and his co-lead, Sun Distinguished Engineer Bill Moore, developed ZFS”. |
| S03 | The OpenZFS launch announcement calls Matt Ahrens one of the two original authors of ZFS. | [OpenZFS launch announcement, open-zfs.org (archived 2013-09-20)](https://web.archive.org/web/20130920013942/http://www.open-zfs.org:80/wiki/Announcement) | first-hand | 2026-10-18 | Archived three days after the announcement. Current copy: https://openzfs.org/wiki/Announcement. Quote: “including Matt Ahrens, one of the two original authors of ZFS”. The site does not say who the second was: no source found that says it. |
| S04 | Bill Moore, 2007: “one of the design principles we set for ZFS was: never, ever trust the underlying hardware.” | [“A Conversation with Jeff Bonwick and Bill Moore”, ACM Queue 5(6), November 2007 (archived 2011-07-16)](https://web.archive.org/web/20110716221142/http://queue.acm.org/detail.cfm?id=1317400) | primary | 2026-10-18 | Verbatim; the interview marks Moore's answers “BM”. French page: original kept, translation marked as ours. |
| S05 | On 31 October 2001 the user-level prototype of ZFS worked. | [Jeff Bonwick, “ZFS: The Last Word in Filesystems”, blog post of 31 October 2005 (archived 2007-02-07)](http://web.archive.org/web/20070207073849/http://blogs.sun.com:80/bonwick/entry/zfs_the_last_word_in) | primary | 2026-10-18 | Original: http://blogs.sun.com/bonwick/entry/zfs_the_last_word_in (gone). Quote: “On 10/31/2001, we got the user-level prototype working.” |
| S06 | On 31 October 2002 ZFS was mounted in the kernel for the first time. | [Jeff Bonwick, “ZFS: The Last Word in Filesystems”, blog post of 31 October 2005 (archived 2007-02-07)](http://web.archive.org/web/20070207073849/http://blogs.sun.com:80/bonwick/entry/zfs_the_last_word_in) | primary | 2026-10-18 | Quote: “On 10/31/2002, we got the first in-kernel mount.” |

### Solaris, OpenSolaris

| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S07 | ZFS was integrated into Solaris on 31 October 2005. | [Jeff Bonwick, “ZFS: The Last Word in Filesystems”, blog post of 31 October 2005 (archived 2007-02-07)](http://web.archive.org/web/20070207073849/http://blogs.sun.com:80/bonwick/entry/zfs_the_last_word_in) | primary | 2026-10-18 | Quote: “And today, 10/31/2005, we integrated into Solaris.” |
| S08 | Jeff Bonwick summed up the integration as “584 files, 92,000 lines of change, 56 patents, 5 years”. | [Jeff Bonwick, “ZFS: The Last Word in Filesystems”, blog post of 31 October 2005 (archived 2007-02-07)](http://web.archive.org/web/20070207073849/http://blogs.sun.com:80/bonwick/entry/zfs_the_last_word_in) | primary | 2026-10-18 | Verbatim, from the same post. |
| S09 | The integration commit, dated 31 October 2005, is titled “PSARC 2002/240 ZFS” and “6338653 Integrate ZFS”, and is preserved in illumos-gate. | [illumos-gate commit fa9e4066f08b](https://github.com/illumos/illumos-gate/commit/fa9e4066f08beec538e775443c5be79dd423fcab) | primary | 2026-10-18 | Commit date 2005-10-31T19:33:35Z, author field “ahrens”. The site does not read more into the author field than the commit shows. |
| S10 | ZFS was available in build 27a of OpenSolaris and Solaris Express. | [OpenSolaris ZFS community page (archived 2006-01-04)](https://web.archive.org/web/20060104033309/http://www.opensolaris.org/os/community/zfs/) | primary | 2026-10-18 | Quote: “ZFS is available in build 27a of OpenSolaris and Solaris Express: Community edition.” Original: http://www.opensolaris.org/os/community/zfs/ (gone). |
| S11 | On 17 November 2005 Jeff Bonwick wrote of “the ZFS launch today”. | [Jeff Bonwick, blog, posts of November 2005, “Thank You” of 17 November 2005 (archived 2006-12-19)](http://web.archive.org/web/20061219204948/http://blogs.sun.com:80/bonwick/date/200511) | primary | 2026-10-18 | Quote: “There's been such a tremendous outpouring of energy and passion for the ZFS launch today”. The exact day of the source release is not stated anywhere we found; the site says November 2005. |
| S12 | The ZFS source code was released under the CDDL as part of OpenSolaris. | [openzfs.org wiki, “History” (archived 2020-05-14)](https://web.archive.org/web/20200514210405/https://openzfs.org/wiki/History) | first-hand | 2026-10-18 | Quote: “The source code for ZFS was released under the CDDL as part of the OpenSolaris operating system”. |
| S13 | On 2 May 2006 Sun announced that Solaris ZFS 1.0 would be available in June, in Solaris 10 6/06. | [Sun Microsystems press release, 2 May 2006 (archived 2006-12-30)](https://web.archive.org/web/20061230113756/http://www.sun.com/smi/Press/sunflash/2006-05/sunflash.20060502.5.xml) | primary | 2026-10-18 | Quote: “Solaris ZFS 1.0 will be available in June as part of the next commercial release of the Solaris 10 Operating System” and “Solaris 10 6/06”. The exact availability day was not found; the site gives none. |
| S14 | Oracle's Solaris documentation lists ZFS as new in the Solaris 10 6/06 release. | [Oracle Solaris 10 documentation, “What’s New in Solaris 10 6/06”](https://docs.oracle.com/cd/E19253-01/817-0547/gbrew/index.html) | primary | 2026-10-18 | Quote: “This file system enhancement is new in the Solaris 10 6/06 release.” |
| S15 | Pawel Jakub Dawidek committed ZFS to FreeBSD on 6 April 2007: “Please welcome ZFS - The last word in file systems.” | [FreeBSD commit f0a75d274af3](https://github.com/freebsd/freebsd-src/commit/f0a75d274af375d15b97b830966b99a02b7db911) | primary | 2026-10-18 | Commit date 2007-04-06T01:09:06Z. The message also says “The code in under CDDL license.” |
| S16 | FreeBSD 7.0, announced on 27 February 2008, shipped experimental support for ZFS. | [FreeBSD 7.0-RELEASE announcement](https://www.freebsd.org/releases/7.0R/announce/) | primary | 2026-10-18 | Quote: “Experimental support for Sun's ZFS filesystem.” Mail date: 27 Feb 2008. |

### Oracle, illumos, the ports

| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S17 | Oracle completed its acquisition of Sun Microsystems on 27 January 2010. | [Oracle press release, 27 January 2010, filed with the SEC as exhibit 99.1 (archived 2026-03-03)](https://web.archive.org/web/20260303160146/https://www.sec.gov/Archives/edgar/data/1341439/000119312510015241/dex991.htm) | primary | 2026-10-18 | Quote: “January 27, 2010—Oracle Corporation (NASDAQ: ORCL) announced today that it had completed its acquisition of Sun Microsystems, Inc.” Original on sec.gov (blocks automated readers); the oracle.com copy is gone. |
| S18 | Garrett D’Amore announced the illumos project on 3 August 2010. | [Garrett D’Amore, “Illumos Announcement”, blog post of 3 August 2010](https://garrett.damore.org/2010/08/illumos-announcement.html) | primary | 2026-10-18 | Quote: “Today we announced the Illumos Project.” Dated 3 August 2010. |
| S19 | illumos described itself as “a community maintained derivative of the OpenSolaris ON source”. | [illumos.org home page (archived 2010-08-17)](https://web.archive.org/web/20100817060139/http://www.illumos.org/) | primary | 2026-10-18 | Verbatim. Same page: “Illumos project announced 2010-08-03”. |
| S20 | OpenSolaris was discontinued in 2010, and further development of ZFS on Solaris was no longer open source. | [openzfs.org wiki, “History” (archived 2020-05-14)](https://web.archive.org/web/20200514210405/https://openzfs.org/wiki/History) | first-hand | 2026-10-18 | Quote: “2010 – OpenSolaris was discontinued, the last release was forked. Further development of ZFS on Solaris was no longer open source.” |
| S21 | On 19 August 2010 Garrett D’Amore reported the last update of Oracle's public ON repository and wrote: “From here on out, Illumos and Oracle Solaris diverge.” | [Garrett D’Amore, “The Tap Is Turned Off”, blog post of 19 August 2010](https://garrett.damore.org/2010/08/tap-is-turned-off.html) | primary | 2026-10-18 | Verbatim. The post names changeset 13149 of 18 August 2010 as the last one. |
| S22 | Development of a native Linux port started in 2008. | [openzfs.org wiki, “History” (archived 2020-05-14)](https://web.archive.org/web/20200514210405/https://openzfs.org/wiki/History) | first-hand | 2026-10-18 | Quote: “2008 – Development of a native Linux port started.” |
| S23 | The first commit of the ZFS code in the Linux port, “Initial Linux ZFS GIT Repo”, is by Brian Behlendorf, on 20 November 2008. | [openzfs/zfs commit 34dc7c2f2553](https://github.com/openzfs/zfs/commit/34dc7c2f2553220ebc6e29ca195fb6d57155f95f) | primary | 2026-10-18 | The repository's oldest commit (2008-02-26) is the Solaris Porting Layer, merged in 2018; the site cites the first ZFS commit. |
| S24 | Brian Behlendorf was the principal developer of the ZFS on Linux port, a computer scientist at Lawrence Livermore National Laboratory. | [AUTHORS file of ZFS on Linux 0.6.1](https://github.com/openzfs/zfs/blob/zfs-0.6.1/AUTHORS) | primary | 2026-10-18 | Quote: “Brian Behlendorf is the principal developer of the ZFS on Linux port. He works full time as a computer scientist at Lawrence Livermore National Laboratory”. |
| S25 | The OpenZFS documentation states that the code is under the CDDL, that this prevents distributing it as part of the Linux kernel binary, and that nothing prevents distributing it as a binary module or as source code. | [OpenZFS documentation, “License”](https://openzfs.github.io/openzfs-docs/License.html) | primary | 2026-10-18 | Quotes: “licensed under the Common Development and Distribution License (CDDL) unless otherwise noted”; “this prevents us from distributing OpenZFS as part of the Linux Kernel binary. However, there is nothing in either license that prevents distributing it in the form of a binary module or in the form of source code.” The site states the project's position and takes none. |
| S26 | ZFS on Linux 0.6.1 was released in March 2013, produced at Lawrence Livermore National Laboratory. | [zfsonlinux.org home page (archived 2013-04-09)](https://web.archive.org/web/20130409152930/http://zfsonlinux.org/) | primary | 2026-10-18 | Quotes: “spl-0.6.1 / zfs-0.6.1 ... Mar 27 2013”; “Produced at Lawrence Livermore National Laboratory”. The git tag zfs-0.6.1 is dated 2013-03-26; the GitHub release entry was created in 2015. The site gives the month only. |
| S27 | The OpenZFS project's history records 2013 as the year of the first stable release of ZFS on Linux. | [openzfs.org wiki, “History” (archived 2020-05-14)](https://web.archive.org/web/20200514210405/https://openzfs.org/wiki/History) | first-hand | 2026-10-18 | Quote: “2013 – The first stable release of ZFS on Linux.” |

### OpenZFS

| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S28 | OpenZFS was announced on 17 September 2013 as “the truly open source successor to the ZFS project”. | [OpenZFS launch announcement, open-zfs.org (archived 2013-09-20)](https://web.archive.org/web/20130920013942/http://www.open-zfs.org:80/wiki/Announcement) | primary | 2026-10-18 | Quote: “OpenZFS launch announcement, September 17th, 2013: Today we announce OpenZFS: the truly open source successor to the ZFS project.” |
| S29 | OpenZFS was founded by members of the Linux, FreeBSD, Mac OS X and illumos communities. | [OpenZFS launch announcement, open-zfs.org (archived 2013-09-20)](https://web.archive.org/web/20130920013942/http://www.open-zfs.org:80/wiki/Announcement) | primary | 2026-10-18 | Quote: “Founded by members of the Linux, FreeBSD, Mac OS X, and illumos communities”. |
| S30 | Native encryption was committed by Tom Caputi on 14 August 2017. | [openzfs/zfs commit b52563034230, “Native Encryption for ZFS on Linux”](https://github.com/openzfs/zfs/commit/b52563034230b35f0562b6f40ad1a00f02bd9a05) | primary | 2026-10-18 | Commit date 2017-08-14. His employer is not stated in the commit text; the site does not name one. |
| S31 | Native encryption first shipped in ZFS on Linux 0.8.0, in May 2019. | [OpenZFS release notes, zfs-0.8.0](https://github.com/openzfs/zfs/releases/tag/zfs-0.8.0) | primary | 2026-10-18 | Quote: “Native encryption #5769 - The encryption property enables the creation of encrypted filesystems and volumes.” Tag dated 2019-05-21, release published 2019-05-23. |
| S32 | dRAID was committed on 13 November 2020, co-authored by Isaac Huang, Mark Maybee, Don Brady, Matthew Ahrens and Brian Behlendorf. | [openzfs/zfs commit b2255edcc009, “Distributed Spare (dRAID) Feature”](https://github.com/openzfs/zfs/commit/b2255edcc0099e62ad46a3dd9d64537663c6aee3) | primary | 2026-10-18 | Names from the Co-authored-by trailers, in their order. |
| S33 | dRAID first shipped in OpenZFS 2.1.0, in July 2021: a distributed variant of RAIDZ with integrated hot spares and much faster resilvering. | [OpenZFS release notes, zfs-2.1.0](https://github.com/openzfs/zfs/releases/tag/zfs-2.1.0) | primary | 2026-10-18 | Quote: “Create pools using a new distributed variant of RAIDZ which enables dramatically faster resilver times using integrated hot spares.” Tag and release: 2021-07-02. Not in zfs-2.0.0 (checked with git merge-base). |
| S34 | OpenZFS 2.0.0, tagged on 30 November 2020, supports Linux and FreeBSD from the same repository; ZFS on Linux was renamed OpenZFS. | [OpenZFS release notes, OpenZFS 2.0.0](https://github.com/openzfs/zfs/releases/tag/zfs-2.0.0) | primary | 2026-10-18 | Quote: “The ZFS on Linux project has been renamed OpenZFS! Both Linux and FreeBSD are now supported from the same repository”. |
| S35 | In FreeBSD 13.0, announced on 13 April 2021, the ZFS implementation is provided by OpenZFS. | [FreeBSD 13.0-RELEASE release notes](https://www.freebsd.org/releases/13.0R/relnotes/) · [announcement](https://www.freebsd.org/releases/13.0R/announce/) | primary | 2026-10-18 | Quotes: “The ZFS implementation is now provided by OpenZFS.”; “Date: April 13, 2021”. |
| S36 | OpenZFS 2.2.0, in October 2023, brought block cloning: a file can be copied by referencing its existing blocks. | [OpenZFS release notes, zfs-2.2.0](https://github.com/openzfs/zfs/releases/tag/zfs-2.2.0) | primary | 2026-10-18 | Quote: “Block cloning is a facility that allows a file (or parts of a file) to be ‘cloned’, that is, a shallow copy made where the existing data blocks are referenced rather than copied.” Tag 2023-10-12, release published 2023-10-13: the site gives the month. |
| S37 | RAID-Z expansion was committed on 8 November 2023; the commit names Matthew Ahrens as author. | [openzfs/zfs commit 5caeef02fa53, “RAID-Z expansion feature”](https://github.com/openzfs/zfs/commit/5caeef02fa531238b4554afc977533382e43314f) | primary | 2026-10-18 | Trailers: “Authored-by: Matthew Ahrens”, “Signed-off-by: Don Brady”, sponsors The FreeBSD Foundation, iXsystems, vStack. |
| S38 | OpenZFS 2.3.0, in January 2025, shipped RAIDZ expansion, fast dedup, Direct IO and JSON output. | [OpenZFS release notes, zfs-2.3.0](https://github.com/openzfs/zfs/releases/tag/zfs-2.3.0) | primary | 2026-10-18 | Quote: “RAIDZ Expansion (#15022): Add new devices to an existing RAIDZ pool, increasing storage capacity without downtime.” then “Fast Dedup”, “Direct IO”, “JSON”. Tag 2025-01-13. |
| S39 | OpenZFS 2.4.0, in December 2025, added default quotas, uncached IO and unified allocation throttling. | [OpenZFS release notes, zfs-2.4.0](https://github.com/openzfs/zfs/releases/tag/zfs-2.4.0) | primary | 2026-10-18 | Quotes: “Allow setting default user/group/project quotas”, “Uncached IO”, “Unified allocation throttling: A new algorithm designed to reduce vdev fragmentation”. Tag 2025-12-18. |
| S40 | OpenZFS 2.4.4, in August 2026, is a point release supporting Linux 4.18 to 7.2 and FreeBSD 13.3 and later. | [OpenZFS release notes, zfs-2.4.4](https://github.com/openzfs/zfs/releases/tag/zfs-2.4.4) | primary | 2026-10-18 | Quote: “Linux: compatible with 4.18 - 7.2 kernels”, “FreeBSD: compatible with releases starting from 13.3+, 14.0+”. Tag 2026-08-21. The museum quotes the code of this release (DECISIONS.md D0.1). |

### The Hall's dedication

| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S41 | Jeff Bonwick, 17 November 2005: “I'm incredibly proud of the ZFS team, and deeply grateful: no one person can do something on this scale.” | [Jeff Bonwick, blog, posts of November 2005, “Thank You” of 17 November 2005 (archived 2006-12-19)](http://web.archive.org/web/20061219204948/http://blogs.sun.com:80/bonwick/date/200511) | primary | 2026-10-20 | Verbatim. Original: http://blogs.sun.com/bonwick/date/200511 (gone). Same post as S11. French page: original kept, translation marked as ours. |
| S42 | Jeff Bonwick, of Sun Microsystems, presented the slab allocator, the kernel memory allocator of SunOS 5.4, at the USENIX Summer 1994 Technical Conference. | [USENIX, abstract of “The Slab Allocator: An Object-Caching Kernel Memory Allocator”, Summer 1994 Technical Conference (archived 2001-02-21)](http://web.archive.org/web/20010221084002/http://www.usenix.org:80/publications/library/proceedings/bos94/bonwick.html) | primary | 2026-10-20 | Quotes: “Jeff Bonwick Sun Microsystems”; “This paper presents a comprehensive design overview of the SunOS 5.4 kernel memory allocator.” Current copy: https://www.usenix.org/legacy/publications/library/proceedings/bos94/bonwick.html (behind a bot check). |
| S43 | Bryan Cantrill, Michael Shapiro and Adam Leventhal, of Sun Microsystems, presented DTrace at the USENIX 2004 Annual Technical Conference: dynamic instrumentation of production systems. | [USENIX, abstract of “Dynamic Instrumentation of Production Systems”, 2004 Annual Technical Conference (archived 2006-01-07)](http://web.archive.org/web/20060107022700/http://www.usenix.org:80/events/usenix04/tech/general/cantrill.html) | primary | 2026-10-20 | Quotes: “Bryan M. Cantrill, Michael W. Shapiro, and Adam H. Leventhal, Sun Microsystems”; “This paper presents DTrace, a new facility for dynamic instrumentation of production systems.” Current copy: https://www.usenix.org/legacy/publications/library/proceedings/usenix04/tech/general/cantrill.html (behind a bot check). |

## Removed for lack of a source

Listed in `DECISIONS.md` (D2.4) with the reason for each.
