// SOURCES.md is the one list of sources (DECISIONS.md D2.2): the History wing
// reads its entries at build time, so the page and the file cannot drift. A
// citation `[[S01]]` in a text becomes a footnote; an unknown id fails the build.
// scripts/check-sources.mjs then checks the built pages against the same file.
import raw from "../../SOURCES.md?raw";

export interface Source {
  id: string;
  claim: string;
  /** The Source cell as HTML: its Markdown links become links, nothing else. */
  html: string;
  kind: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cellHtml(cell: string): string {
  let out = "";
  let last = 0;
  for (const m of cell.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)) {
    out += esc(cell.slice(last, m.index)) + `<a href="${esc(m[2])}">${esc(m[1].replace(/\\\|/g, "|"))}</a>`;
    last = m.index! + m[0].length;
  }
  return out + esc(cell.slice(last));
}

export const SOURCES: Map<string, Source> = new Map();
for (const line of raw.split("\n")) {
  const m = /^\|\s*(S\d{2,})\s*\|(.*)\|\s*$/.exec(line);
  if (!m) continue;
  const cells = m[2].split(/(?<!\\)\|/).map((c) => c.trim());
  const [claim, source, kind] = cells;
  SOURCES.set(m[1], { id: m[1], claim, html: cellHtml(source), kind });
}

export function source(id: string): Source {
  const s = SOURCES.get(id);
  if (!s) throw new Error(`[[${id}]] is cited but has no entry in SOURCES.md`);
  return s;
}

export const CITE = /\[\[(S\d{2,})\]\]/g;

export const SOURCES_URL = "https://github.com/algotitanhq/uberblok/blob/main/SOURCES.md";
