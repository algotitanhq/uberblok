#!/usr/bin/env node
// Lighthouse on every page of the visit, every language (brief section 12):
// mobile, simulated 4G throttling (Lighthouse's default). Writes one JSON
// report per page to <out> and prints a Markdown table, with the JavaScript
// transferred at load (the 3D chunks are fetched only when 3D opens, so they
// are not in it; scripts/verify.mjs measures them).
//   CHROME_PATH=<chromium> node scripts/lighthouse.mjs http://127.0.0.1:4321 shots/lh [--insecure]
// --rooms=<id,...>: only those rooms. --insecure: accept a self-signed certificate (Best Practices over local HTTPS).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LANGS, ROOMS, roomUrl } from "../src/lib/rooms.ts";

const args = process.argv.slice(2);
const insecure = args.includes("--insecure");
// --rooms=hall,tree: only those rooms (every language).
const only = args.find((a) => a.startsWith("--rooms="))?.slice(8).split(",");
const [base = "http://127.0.0.1:4321", out = "shots/lh"] = args.filter((a) => !a.startsWith("--"));
mkdirSync(out, { recursive: true });

const flags = ["--headless=new", "--no-sandbox", ...(insecure ? ["--ignore-certificate-errors"] : [])];
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const s = (ms) => `${(ms / 1000).toFixed(1)} s`;
const rows = [];
for (const r of ROOMS.filter((x) => x.open && (!only || only.includes(x.id))))
  for (const lang of LANGS) {
    const path = roomUrl(lang, r.id);
    const file = join(out, `${r.id}-${lang}.json`);
    execFileSync(
      "npx",
      ["--yes", "lighthouse@13.5.0", base + path, "--quiet", "--output=json", `--output-path=${file}`, `--chrome-flags=${flags.join(" ")}`],
      { stdio: ["ignore", "ignore", "inherit"] },
    );
    const lh = JSON.parse(readFileSync(file, "utf8"));
    const c = lh.categories;
    const a = lh.audits;
    const reqs = a["network-requests"].details.items;
    const js = reqs.filter((q) => q.resourceType === "Script").reduce((t, q) => t + (q.transferSize || 0), 0);
    const all = reqs.reduce((t, q) => t + (q.transferSize || 0), 0);
    const bpFails = Object.values(a)
      .filter((x) => lh.categories["best-practices"].auditRefs.some((ref) => ref.id === x.id) && x.score !== null && x.score < 1 && x.scoreDisplayMode !== "informative" && x.scoreDisplayMode !== "notApplicable")
      .map((x) => x.id);
    const failed = (cat) =>
      lh.categories[cat].auditRefs.map((ref) => a[ref.id]).filter((x) => x.score !== null && x.score < 1 && x.scoreDisplayMode === "binary").map((x) => x.id);
    rows.push({
      page: `\`${path}\``,
      perf: Math.round(c.performance.score * 100),
      a11y: Math.round(c.accessibility.score * 100),
      bp: Math.round(c["best-practices"].score * 100),
      seo: Math.round(c.seo.score * 100),
      fcp: s(a["first-contentful-paint"].numericValue),
      lcp: s(a["largest-contentful-paint"].numericValue),
      tti: s(a.interactive.numericValue),
      tbt: `${Math.round(a["total-blocking-time"].numericValue)} ms`,
      cls: +a["cumulative-layout-shift"].numericValue.toFixed(3),
      js: kb(js),
      all: kb(all),
      misses: [...new Set([...bpFails, ...failed("accessibility"), ...failed("seo")])].join(", "),
    });
    console.error(`${path}: ${rows.at(-1).perf}/${rows.at(-1).a11y}/${rows.at(-1).bp}/${rows.at(-1).seo}`);
  }

console.log("| Page | Perf | A11y | Best pr. | SEO | FCP | LCP | TTI | TBT | CLS | JS transferred | Total transferred | Audits missed |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows)
  console.log(`| ${r.page} | ${r.perf} | ${r.a11y} | ${r.bp} | ${r.seo} | ${r.fcp} | ${r.lcp} | ${r.tti} | ${r.tbt} | ${r.cls} | ${r.js} | ${r.all} | ${r.misses || "none"} |`);
