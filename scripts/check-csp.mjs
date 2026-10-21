#!/usr/bin/env node
// Checks the Content-Security-Policy of public/_headers against the built site
// (DECISIONS.md D19.2):
//   - the `/*` rule carries the only Content-Security-Policy, with a script-src
//     and no script-src-elem or script-src-attr (which would override it), and
//     script-src holds only 'self', 'none', sha256 hashes and the one host of the
//     Cloudflare Web Analytics beacon (no 'unsafe-inline', 'unsafe-eval', other host,
//     scheme or wildcard), connect-src is present and holds only 'self' and the
//     beacon's report host, and default-src only 'self' or 'none' (D19.3);
//   - every inline <script> of a built page has its sha256 in script-src, and
//     every hash in script-src belongs to an inline script (none stale);
//   - no page carries an inline event handler (on...=) or a javascript: URL,
//     which no hash allows.
// Network is never touched.
// Usage: node scripts/check-csp.mjs public/_headers FILE.html...
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const sha256 = (text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

// Every Content-Security-Policy of a _headers file, with the rule it sits in.
export function policies(headers) {
  const found = [];
  let rule = null;
  for (const line of headers.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === "") continue;
    if (!/^\s/.test(line)) { rule = line.trim(); continue; }
    const m = /^\s+Content-Security-Policy:\s*(.+)$/i.exec(line);
    if (m) found.push({ rule, value: m[1].trim() });
  }
  return found;
}

// The value of Content-Security-Policy in the `/*` rule of a _headers file.
export const policy = (headers) => policies(headers).find((p) => p.rule === "/*")?.value ?? null;

const directive = (csp, name) =>
  csp.split(";").map((s) => s.trim().split(/\s+/)).find((t) => t[0].toLowerCase() === name)?.slice(1) ?? null;

export const scriptSources = (csp) => directive(csp, "script-src");

// The only sources script-src may hold: anything else (a keyword, a host, a scheme) widens it.
// The one host is the Cloudflare Web Analytics beacon's script (D19.3).
const STRICT = /^('self'|'none'|'sha256-[A-Za-z0-9+/]+=*'|https:\/\/static\.cloudflareinsights\.com)$/;
// And the only sources connect-src may hold: the beacon reports to this host.
const CONNECT = /^('self'|'none'|https:\/\/cloudflareinsights\.com)$/;

const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ":").replace(/&tab;|&newline;/gi, "");

export function inlineScripts(html) {
  return [...html.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\ssrc\s*=/i.test(m[1].replace(/"[^"]*"|'[^']*'/g, '""')))
    .filter((m) => !/type="application\/(ld\+)?json"/i.test(m[1]))
    .map((m) => m[2]);
}

export function check(headers, pages) {
  const problems = [];
  const csp = policy(headers);
  if (!csp) return ["no Content-Security-Policy in the /* rule"];
  for (const p of policies(headers)) if (p.rule !== "/*") problems.push(`a second Content-Security-Policy, in rule ${p.rule}`);
  const sources = scriptSources(csp);
  if (!sources) return [...problems, "no script-src in the Content-Security-Policy"];
  for (const d of ["script-src-elem", "script-src-attr"]) if (directive(csp, d)) problems.push(`${d} overrides script-src`);
  for (const s of sources) if (!STRICT.test(s)) problems.push(`script-src allows ${s}`);
  const connect = directive(csp, "connect-src");
  if (!connect) problems.push("no connect-src in the Content-Security-Policy");
  for (const s of connect ?? []) if (!CONNECT.test(s)) problems.push(`connect-src allows ${s}`);
  for (const s of directive(csp, "default-src") ?? []) if (!/^('self'|'none')$/.test(s)) problems.push(`default-src allows ${s}`);
  const allowed = new Set(sources.filter((s) => s.startsWith("'sha256-")));
  const used = new Set();
  for (const [file, html] of pages) {
    for (const body of inlineScripts(html)) {
      const h = sha256(body);
      used.add(h);
      if (!allowed.has(h)) problems.push(`${file}: inline script ${h} not in script-src`);
    }
    // Attribute values blanked first, so a ">" or a quoted "on...=" inside one cannot hide or fake a match.
    const tags = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script>").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style>");
    for (const tag of tags.match(/<[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
      const bare = tag.replace(/"[^"]*"|'[^']*'/g, '""');
      for (const m of bare.matchAll(/\s(on[a-z]+)\s*=/gi)) problems.push(`${file}: inline event handler ${m[1]}`);
      if (/[\s:](?:href|src|action|formaction)\s*=\s*["']?\s*javascript:/i.test(decode(tag).replace(/[\t\n\r]/g, ""))) problems.push(`${file}: javascript: URL`);
    }
  }
  for (const h of allowed) if (!used.has(h)) problems.push(`script-src hash ${h} matches no inline script`);
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
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
