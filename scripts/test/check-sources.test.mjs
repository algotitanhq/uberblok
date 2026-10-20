// Tests for scripts/check-sources.mjs on small fixtures (no network, no build).
// Run: node --test scripts/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checker = join(dirname(fileURLToPath(import.meta.url)), "..", "check-sources.mjs");

const SOURCES = `# Sources
| ID | Claim | Source | Kind | Accessed | Notes |
|---|---|---|---|---|---|
| S01 | A happened in 2001. | [Post](https://example.org/a) · [archive](https://web.archive.org/web/2006/https://example.org/a) | primary | 2026-10-18 | |
| S02 | B happened in 2005. | [Commit](https://example.org/b) | primary | 2026-10-18 | |
`;

const page = (lang, { milestones, bib }) => `<!doctype html><html lang="${lang}"><body data-sourced-page="history">
${milestones.map(([id, refs]) => `<li data-milestone="${id}"><p>Text${refs.map((r) => ` <a href="#src-${r}" data-source="${r}">1</a>`).join("")}</p></li>`).join("\n")}
<ol>${bib.map(([id, urls]) => `<li id="src-${id}" data-entry="${id}">${urls.map((u) => `<a href="${u}">x</a>`).join(" ")}</li>`).join("")}</ol>
</body></html>`;

const BIB = [["S01", ["https://example.org/a"]], ["S02", ["https://example.org/b"]]];
const GOOD = { milestones: [["m1", ["S01"]], ["m2", ["S02"]]], bib: BIB };

function check(sources, pages) {
  const dir = mkdtempSync(join(tmpdir(), "sources-"));
  writeFileSync(join(dir, "SOURCES.md"), sources);
  const files = pages.map(([lang, p], i) => {
    const f = join(dir, `p${i}.html`);
    writeFileSync(f, page(lang, p));
    return f;
  });
  const r = spawnSync(process.execPath, [checker, join(dir, "SOURCES.md"), ...files], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
}

test("matching pages in both languages pass", () => {
  const r = check(SOURCES, [["en", GOOD], ["fr", GOOD]]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /2 entries, 4 references in 2 pages, 0 problems/);
});

test("archive link from the row is accepted in the bibliography", () => {
  const bib = [["S01", ["https://example.org/a", "https://web.archive.org/web/2006/https://example.org/a"]], BIB[1]];
  const r = check(SOURCES, [["en", { ...GOOD, bib }]]);
  assert.equal(r.code, 0, r.out);
});

test("a reference with no entry fails", () => {
  const p = { milestones: [["m1", ["S01"]], ["m2", ["S02", "S09"]]], bib: BIB };
  const r = check(SOURCES, [["en", p]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /reference S09 has no entry/);
});

test("an orphan entry fails", () => {
  const p = { milestones: [["m1", ["S01"]]], bib: [BIB[0]] };
  const r = check(SOURCES, [["en", p]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /entry S02 is not cited by any page/);
});

test("a milestone without a reference fails", () => {
  const p = { milestones: [["m1", ["S01", "S02"]], ["m2", []]], bib: BIB };
  const r = check(SOURCES, [["en", p]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /milestone m2 has no source reference/);
});

test("languages citing different sources for a milestone fail", () => {
  const fr = { milestones: [["m1", ["S01", "S02"]], ["m2", ["S02"]]], bib: BIB };
  const r = check(SOURCES, [["en", GOOD], ["fr", fr]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /milestone m1 cites S01 in en but S01 S02 in fr/);
});

test("a milestone missing in one language fails", () => {
  const fr = { milestones: [["m1", ["S01", "S02"]]], bib: BIB };
  const r = check(SOURCES, [["en", GOOD], ["fr", fr]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /milestone m2 is in en but not in fr/);
});

test("a bibliography URL not in the row fails", () => {
  const bib = [["S01", ["https://example.org/elsewhere"]], BIB[1]];
  const r = check(SOURCES, [["en", { ...GOOD, bib }]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /S01 links to https:\/\/example.org\/elsewhere/);
});

test("a cited entry missing from the page bibliography fails", () => {
  const r = check(SOURCES, [["en", { ...GOOD, bib: [BIB[0]] }]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /reference S02 is missing from the page's bibliography/);
});

test("duplicate ids and rows without a link fail", () => {
  const bad = SOURCES + "| S02 | Again. | no link | primary | 2026-10-18 | |\n";
  const r = check(bad, [["en", GOOD]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /duplicate entry S02/);
  assert.match(r.out, /entry S02 has no link/);
});

test("one note may stand for several ids citing the same document", () => {
  const same = SOURCES + "| S03 | C, from the same post. | [Post](https://example.org/a) | primary | 2026-10-18 | |\n";
  const p = { milestones: [["m1", ["S01", "S03"]], ["m2", ["S02"]]], bib: [["S01 S03", ["https://example.org/a"]], BIB[1]] };
  const r = check(same, [["en", p]]);
  assert.equal(r.code, 0, r.out);
});

test("a shared note still checks its links against each id's row", () => {
  const p = { milestones: [["m1", ["S01", "S02"]]], bib: [["S01 S02", ["https://example.org/a"]]] };
  const r = check(SOURCES, [["en", p]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /S02 links to https:\/\/example.org\/a, not a URL of its row/);
});

test("an id in two notes fails", () => {
  const p = { milestones: [["m1", ["S01"]], ["m2", ["S02"]]], bib: [...BIB, ["S01 S02", ["https://example.org/a"]]] };
  const r = check(SOURCES, [["en", p]]);
  assert.equal(r.code, 1);
  assert.match(r.out, /bibliography lists S0[12] twice/);
});
