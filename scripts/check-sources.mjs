#!/usr/bin/env node
// Checks that every source reference in the built site resolves to an entry of
// SOURCES.md, and the reverse (DECISIONS.md D2.3).
//   - An entry is a table row of SOURCES.md whose first cell is an id `S<nn>`;
//     ids are unique and each row has at least one http(s) link.
//   - A reference is an element with `data-source="S<nn>"` in a built page:
//     its id must be an entry, and the page must list that entry in its own
//     bibliography (`data-entry="S<nn>"`, or several ids separated by spaces
//     when one note stands for rows citing the same document), with only URLs
//     taken from each row.
//   - A milestone (`data-milestone="<id>"`) must carry at least one reference.
//   - Pages that declare the same `data-sourced-page` in different languages
//     (`<html lang>`) must cite the same entries for the same milestones: FR
//     and EN state the same facts.
//   - No orphan: every entry is referenced by at least one page.
// Network is never touched (link liveness is scripts/check-source-links.mjs).
// Usage: node scripts/check-sources.mjs SOURCES.md FILE.html...
import { readFileSync } from "node:fs";

const [sourcesFile, ...pages] = process.argv.slice(2);
if (!sourcesFile || pages.length === 0) {
  console.error("usage: check-sources.mjs SOURCES.md FILE.html...");
  process.exit(2);
}

const problems = [];
const fail = (msg) => problems.push(msg);

// 1. Entries.
const entries = new Map();
for (const [n, line] of readFileSync(sourcesFile, "utf8").split("\n").entries()) {
  const m = /^\|\s*(S\d{2,})\s*\|(.*)\|\s*$/.exec(line);
  if (!m) continue;
  const [, id, rest] = m;
  if (entries.has(id)) fail(`${sourcesFile}:${n + 1}: duplicate entry ${id}`);
  const urls = [...rest.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((x) => x[1]);
  if (urls.length === 0) fail(`${sourcesFile}:${n + 1}: entry ${id} has no link`);
  entries.set(id, { line: n + 1, urls: new Set(urls) });
}
if (entries.size === 0) fail(`${sourcesFile}: no entry found`);

// 2. Pages.
const unescape = (s) => s.replace(/&amp;/g, "&").replace(/&#38;/g, "&");
const referenced = new Set();
const groups = new Map(); // sourced-page key -> [{ file, lang, milestones }]
let refCount = 0;

for (const file of pages) {
  const html = readFileSync(file, "utf8");
  const refs = [...html.matchAll(/data-source="([^"]*)"/g)];
  const listed = new Map();
  for (const m of html.matchAll(/<li\b[^>]*\bdata-entry="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g)) {
    const hrefs = [...m[2].matchAll(/href="(https?:[^"]+)"/g)].map((x) => unescape(x[1]));
    for (const id of m[1].split(/\s+/).filter(Boolean)) {
      if (listed.has(id)) fail(`${file}: bibliography lists ${id} twice`);
      listed.set(id, hrefs);
    }
  }
  for (const [id, hrefs] of listed) {
    const e = entries.get(id);
    if (!e) {
      fail(`${file}: bibliography lists ${id}, which is not in ${sourcesFile}`);
      continue;
    }
    if (hrefs.length === 0) fail(`${file}: bibliography entry ${id} has no link`);
    for (const h of hrefs) if (!e.urls.has(h)) fail(`${file}: ${id} links to ${h}, not a URL of its row in ${sourcesFile}`);
  }

  // Milestones: everything between two `data-milestone` markers belongs to the first.
  const milestones = new Map();
  const marks = [...html.matchAll(/data-milestone="([^"]*)"/g)];
  for (const [i, m] of marks.entries()) {
    const end = i + 1 < marks.length ? marks[i + 1].index : html.indexOf("data-entry=", m.index) >>> 0;
    const ids = new Set([...html.slice(m.index, end).matchAll(/data-source="([^"]*)"/g)].map((x) => x[1]));
    if (milestones.has(m[1])) fail(`${file}: milestone ${m[1]} appears twice`);
    milestones.set(m[1], ids);
    if (ids.size === 0) fail(`${file}: milestone ${m[1]} has no source reference`);
  }

  for (const m of refs) {
    const id = m[1];
    refCount++;
    referenced.add(id);
    if (!entries.has(id)) fail(`${file}: reference ${id} has no entry in ${sourcesFile}`);
    else if (!listed.has(id)) fail(`${file}: reference ${id} is missing from the page's bibliography`);
  }
  for (const id of listed.keys())
    if (!refs.some((m) => m[1] === id)) fail(`${file}: bibliography lists ${id} but the page never cites it`);

  const key = /data-sourced-page="([^"]+)"/.exec(html)?.[1];
  if (key) {
    const lang = /<html[^>]*\blang="([^"]+)"/.exec(html)?.[1] ?? "?";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file, lang, milestones });
  }
}

// 3. Same facts in every language.
for (const [key, list] of groups) {
  const [first, ...others] = list;
  for (const o of others) {
    if (o.lang === first.lang) continue;
    const all = new Set([...first.milestones.keys(), ...o.milestones.keys()]);
    for (const ms of all) {
      const a = first.milestones.get(ms), b = o.milestones.get(ms);
      if (!a || !b) {
        fail(`${key}: milestone ${ms} is in ${a ? first.lang : o.lang} but not in ${a ? o.lang : first.lang}`);
        continue;
      }
      const sa = [...a].sort().join(" "), sb = [...b].sort().join(" ");
      if (sa !== sb) fail(`${key}: milestone ${ms} cites ${sa} in ${first.lang} but ${sb} in ${o.lang}`);
    }
  }
}

// 4. Orphans.
for (const [id, e] of entries)
  if (!referenced.has(id)) fail(`${sourcesFile}:${e.line}: entry ${id} is not cited by any page`);

for (const p of problems) console.log(`FAIL ${p}`);
console.log(`${entries.size} entries, ${refCount} references in ${pages.length} pages, ${problems.length} problems`);
process.exit(problems.length ? 1 : 0);
