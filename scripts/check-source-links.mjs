#!/usr/bin/env node
// Link liveness for SOURCES.md, run by hand (DECISIONS.md D2.3): network
// flakiness must not break CI, so this is not a CI step. Its result goes to
// BUILDLOG.md. Every http(s) link of every entry is fetched (HEAD, then GET when
// HEAD is refused) with redirects followed; anything but a final 2xx is listed.
// Usage: node scripts/check-source-links.mjs [SOURCES.md]
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "SOURCES.md";
const links = [];
for (const line of readFileSync(file, "utf8").split("\n")) {
  const m = /^\|\s*(S\d{2,})\s*\|/.exec(line);
  if (!m) continue;
  for (const u of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) links.push({ id: m[1], url: u[1] });
}

async function status(url) {
  const opts = { redirect: "follow", signal: AbortSignal.timeout(30000), headers: { "user-agent": "uberblok-source-check/1.0" } };
  try {
    let r = await fetch(url, { ...opts, method: "HEAD" });
    if (r.status >= 400) r = await fetch(url, { ...opts, method: "GET" });
    return r.status;
  } catch (e) {
    return `error: ${e.cause?.code ?? e.name}`;
  }
}

let bad = 0;
const results = [];
for (let i = 0; i < links.length; i += 6) {
  const batch = links.slice(i, i + 6);
  results.push(...(await Promise.all(batch.map(async (l) => ({ ...l, status: await status(l.url) })))));
}
for (const r of results) {
  const ok = typeof r.status === "number" && r.status < 300;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${r.id} ${r.status} ${r.url}`);
}
console.log(`${results.length} links, ${results.length - bad} ok, ${bad} failing`);
process.exit(bad ? 1 : 0);
