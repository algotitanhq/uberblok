#!/usr/bin/env node
// Checks the Content-Security-Policy of public/_headers against the built site
// (DECISIONS.md D19.2):
//   - the `/*` rule carries one Content-Security-Policy with a script-src;
//   - every inline <script> of a built page has its sha256 in script-src, and
//     every hash in script-src belongs to an inline script (none stale);
//   - no page carries an inline event handler (on...="..."), which no hash allows.
// Network is never touched.
// Usage: node scripts/check-csp.mjs public/_headers FILE.html...
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// The value of Content-Security-Policy in the `/*` rule of a _headers file.
export function policy(headers) {
  let inAll = false;
  for (const line of headers.split("\n")) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    if (!/^\s/.test(line)) { inAll = line.trim() === "/*"; continue; }
    const m = /^\s+Content-Security-Policy:\s*(.+)$/i.exec(line);
    if (inAll && m) return m[1].trim();
  }
  return null;
}

export function scriptSources(csp) {
  const d = csp.split(";").map((s) => s.trim().split(/\s+/)).find((t) => t[0] === "script-src");
  return d ? d.slice(1) : null;
}

export function inlineScripts(html) {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/type="application\/(ld\+)?json"/i.test(m[1]))
    .map((m) => m[2]);
}

export function check(headers, pages) {
  const problems = [];
  const csp = policy(headers);
  if (!csp) return ["no Content-Security-Policy in the /* rule"];
  const sources = scriptSources(csp);
  if (!sources) return ["no script-src in the Content-Security-Policy"];
  if (sources.includes("'unsafe-inline'")) problems.push("script-src allows 'unsafe-inline'");
  const allowed = new Set(sources.filter((s) => s.startsWith("'sha256-")));
  const used = new Set();
  for (const [file, html] of pages) {
    for (const body of inlineScripts(html)) {
      const h = sha256(body);
      used.add(h);
      if (!allowed.has(h)) problems.push(`${file}: inline script ${h} not in script-src`);
    }
    for (const m of html.matchAll(/<[a-z][^>]*\s(on[a-z]+)=["']/gi)) problems.push(`${file}: inline event handler ${m[1]}`);
  }
  for (const h of allowed) if (!used.has(h)) problems.push(`script-src hash ${h} matches no inline script`);
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [headersFile, ...files] = process.argv.slice(2);
  if (!headersFile || files.length === 0) {
    console.error("usage: check-csp.mjs public/_headers FILE.html...");
    process.exit(2);
  }
  const problems = check(readFileSync(headersFile, "utf8"), files.map((f) => [f, readFileSync(f, "utf8")]));
  for (const p of [...new Set(problems)]) console.error(p);
  if (problems.length) process.exit(1);
  console.log(`${files.length} pages, every inline script allowed by its hash`);
}
