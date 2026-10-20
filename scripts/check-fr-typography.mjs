#!/usr/bin/env node
// Fails on French punctuation spacing that lets a line break before the mark.
// Rule (DECISIONS.md D1.9): U+202F (narrow no-break space) before ; ! ?,
// U+00A0 (no-break space) before : and inside « ». Code is not French text, so
// <pre>, <code>, <script> and <style> are skipped; attribute values are checked
// too, since the figures read their FR strings from data-strings.
// Usage: node scripts/check-fr-typography.mjs <file.html|dir>...
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function files(p) {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((f) => files(join(p, f)));
  return p.endsWith(".html") ? [p] : [];
}

const strip = (s) =>
  s.replace(/<(pre|code|script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");

const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

// Other tags stay in the text: "</a> :" is caught by the space before the colon.
export function problems(html) {
  const text = strip(decode(strip(html)));
  const out = [];
  const rules = [
    [/[ \t\r\n\u00a0]+[;!?]/g, `before ; ! ? use U+202F`],
    [/[ \t\r\n\u202f]+:(?!\/\/)/g, `before : use U+00A0`],
    [/«(?!\u00a0)/g, `after « use U+00A0`],
    [/(?<!\u00a0)»/g, `before » use U+00A0`],
  ];
  for (const [re, why] of rules) {
    for (const m of text.matchAll(re)) {
      const at = m.index;
      out.push(`${why}: …${text.slice(Math.max(0, at - 30), at + 10).replace(/\s+/g, " ")}…`);
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targets = process.argv.slice(2).flatMap(files);
  if (!targets.length) {
    console.error("usage: check-fr-typography.mjs <file.html|dir>...");
    process.exit(2);
  }
  let failures = 0;
  for (const f of targets) {
    for (const p of problems(readFileSync(f, "utf8"))) {
      console.log(`FAIL ${f}: ${p}`);
      failures++;
    }
  }
  console.log(`${targets.length} files, ${failures} failures`);
  process.exit(failures ? 1 : 0);
}
