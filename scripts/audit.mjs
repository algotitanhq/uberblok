#!/usr/bin/env node
// Whole-visit audit (slice 13, brief sections 8 and 12), against a running build:
//   node scripts/audit.mjs http://127.0.0.1:4321 shots/audit
// For every page of the visit, in every language:
// - no console error, page error or failed request;
// - <html lang>, a title, the header's switcher pointing at the same page in
//   every other language, the current one marked, and the hreflang alternates;
// - no sideways scroll, at 1440, 390 and 320 px;
// - previous/next: one chain through the whole visit, the same in every language,
//   and the Hall map linking every room;
// - axe-core (WCAG 2.2 A and AA rules, contrast included) in the dark and the
//   light theme at 1440 px, and in the dark theme at 390 px;
// - keyboard only: Tab through the page, every stop with a visible focus;
// - reduced motion: no animation still running two seconds after load;
// - live regions: how many announcements one click on the figure's first button makes.
// Writes <out>/audit.json and prints a summary; exits 1 on any problem.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { LANGS, ROOMS, roomUrl } from "../src/lib/rooms.ts";

const [base = "http://127.0.0.1:4321", out = "shots/audit"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const open = ROOMS.filter((r) => r.open);
const browser = await chromium.launch();
const report = { base, pages: [], problems: [] };
const problem = (path, what) => report.problems.push(`${path}: ${what}`);

async function load(path, ctxOpts, { theme = "dark", reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({ ...ctxOpts, reducedMotion });
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => errors.push(`failed ${r.url()}`));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return {
    ctx: { close: async () => (errors.length && problem(path, `console (${theme}, ${ctxOpts.viewport.width} px, ${reducedMotion}): ${errors.join(" | ")}`), ctx.close()) },
    page,
    errors,
  };
}

async function axe(page) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(" ") }));
  }, AXE_TAGS);
}

for (const r of open)
  for (const lang of LANGS) {
    const path = roomUrl(lang, r.id);
    // The header's switcher and the alternates: every other language, same page.
    const others = Object.fromEntries(LANGS.filter((l) => l !== lang).map((l) => [l, roomUrl(l, r.id)]));
    const rec = { id: r.id, lang, path };
    report.pages.push(rec);

    // Structure, navigation and axe in the dark theme, desktop.
    {
      const { ctx, page, errors } = await load(path, DESKTOP);
      Object.assign(
        rec,
        await page.evaluate(() => ({
          htmlLang: document.documentElement.lang,
          title: document.title,
          h1: document.querySelectorAll("h1").length,
          switches: Object.fromEntries([...document.querySelectorAll(".site-header a.langue")].map((a) => [a.hreflang, a.getAttribute("href")])),
          current: document.querySelector(".site-header .langue[aria-current]")?.getAttribute("lang") ?? null,
          alternates: Object.fromEntries([...document.querySelectorAll("link[rel=alternate][hreflang]")].map((l) => [l.hreflang, new URL(l.href).pathname])),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          prev: document.querySelector(".room-nav a[rel=prev]")?.getAttribute("href") ?? null,
          next: document.querySelector(".room-nav a[rel=next]")?.getAttribute("href") ?? null,
          map: [...document.querySelectorAll(".map li")].map((li) => li.querySelector("a")?.getAttribute("href") ?? null),
          liveRegions: document.querySelectorAll("[aria-live], [role=status], [role=alert]").length,
        })),
      );
      rec.axeDark = await axe(page);
      rec.consoleErrors = errors;
      await ctx.close();
    }
    if (rec.htmlLang !== lang) problem(path, `html lang is ${rec.htmlLang}`);
    if (!rec.title) problem(path, "no title");
    if (rec.h1 !== 1) problem(path, `${rec.h1} h1`);
    if (JSON.stringify(rec.switches) !== JSON.stringify(others)) problem(path, `language switches ${JSON.stringify(rec.switches)}, expected ${JSON.stringify(others)}`);
    if (rec.overflowX) problem(path, "the page scrolls sideways at 1440 px");
    if (rec.current !== lang) problem(path, `the switcher marks ${rec.current} as current`);
    for (const l of LANGS) if (rec.alternates[l] !== roomUrl(l, r.id)) problem(path, `hreflang ${l} is ${rec.alternates[l]}`);
    if (rec.alternates["x-default"] !== "/") problem(path, "no x-default alternate");
    for (const v of rec.axeDark) problem(path, `axe dark 1440: ${v.id} (${v.impact}, ${v.nodes} nodes, ${v.sample})`);

    // axe in the light theme, desktop, and in the dark theme on a phone.
    for (const [key, opts, theme] of [["axeLight", DESKTOP, "light"], ["axePhone", PHONE, "dark"]]) {
      const { ctx, page } = await load(path, opts, { theme });
      rec[key] = await axe(page);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) problem(path, `${key}: the page scrolls sideways`);
      for (const v of rec[key]) problem(path, `${key}: ${v.id} (${v.impact}, ${v.nodes} nodes, ${v.sample})`);
      await ctx.close();
    }
    // The narrowest phone still in use (320 px): nothing scrolls sideways either.
    {
      const { ctx, page } = await load(path, { ...PHONE, viewport: { width: 320, height: 640 } }, { theme: "dark" });
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) problem(path, "the page scrolls sideways at 320 px");
      await ctx.close();
    }

    // Keyboard only.
    {
      const { ctx, page } = await load(path, DESKTOP);
      const stops = [];
      for (let i = 0; i < 400; i++) {
        await page.keyboard.press("Tab");
        const info = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("value") || "").trim().replace(/\s+/g, " ").slice(0, 50);
          // A ring is visible when focus changes the outline or the shadow.
          const focused = { outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, shadow: cs.boxShadow };
          el.blur();
          const rest = getComputedStyle(el);
          const ring =
            (focused.outline !== `${rest.outlineStyle} ${rest.outlineWidth} ${rest.outlineColor}` && !focused.outline.startsWith("none")) ||
            focused.shadow !== rest.boxShadow;
          el.focus();
          return { key: `${el.tagName}|${label}|${el.getAttribute("href") || ""}|${el.getAttribute("name") || ""}`, label, ring };
        });
        if (!info) continue;
        if (stops.length && info.key === stops[0].key) break;
        stops.push(info);
      }
      rec.tabStops = stops.length;
      rec.noFocusRing = stops.filter((s) => !s.ring).map((s) => s.label);
      if (rec.noFocusRing.length) problem(path, `no visible focus on: ${rec.noFocusRing.join(" | ")}`);
      await ctx.close();
    }

    // Reduced motion: nothing still animating after two seconds.
    {
      const { ctx, page } = await load(path, DESKTOP, { reducedMotion: "reduce" });
      await page.waitForTimeout(2000);
      rec.reducedMotion = await page.evaluate(() => ({
        running: document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().endTime === Infinity).length,
        canvas: document.querySelectorAll("canvas").length,
      }));
      if (rec.reducedMotion.running) problem(path, `${rec.reducedMotion.running} endless animation(s) under reduced motion`);
      if (rec.reducedMotion.canvas) problem(path, `a canvas (3D) under reduced motion`);
      await ctx.close();
    }

    // Live regions: announcements made by one click on the figure's first button.
    if (rec.liveRegions) {
      const { ctx, page } = await load(path, DESKTOP);
      await page.evaluate(() => {
        window.__said = [];
        for (const el of document.querySelectorAll("[aria-live], [role=status], [role=alert]")) {
          if (el.getAttribute("aria-live") === "off") continue;
          new MutationObserver(() => window.__said.push(el.textContent.trim())).observe(el, { childList: true, subtree: true, characterData: true });
        }
      });
      const btn = page.locator("main figure button:visible, main [data-lab] button:visible, main section button:visible").first();
      if (await btn.count()) {
        rec.clicked = (await btn.textContent())?.trim().slice(0, 40);
        await btn.click();
        await page.waitForTimeout(1500);
        const said = await page.evaluate(() => window.__said);
        // A region rewritten several times with the same text announces once; count distinct texts.
        rec.announcements = [...new Set(said.filter(Boolean))].length;
        if (rec.announcements === 0) problem(path, `one click on “${rec.clicked}” announced nothing`);
        if (rec.announcements > 1) problem(path, `one click on “${rec.clicked}” made ${rec.announcements} announcements`);
      }
      await ctx.close();
    }
    console.error(`${path}: ${rec.tabStops} stops, axe ${rec.axeDark.length}/${rec.axeLight.length}/${rec.axePhone.length}, live ${rec.liveRegions}${rec.clicked ? `, “${rec.clicked}” → ${rec.announcements}` : ""}`);
  }

// The visit's chain: next of each page is the following page, prev the one before.
for (const lang of LANGS) {
  const pages = report.pages.filter((p) => p.lang === lang);
  pages.forEach((p, i) => {
    const want = { prev: pages[i - 1]?.path ?? null, next: pages[i + 1]?.path ?? null };
    if (p.prev !== want.prev) problem(p.path, `previous is ${p.prev}, expected ${want.prev}`);
    if (p.next !== want.next) problem(p.path, `next is ${p.next}, expected ${want.next}`);
  });
  const hall = pages[0];
  const expected = ROOMS.map((r) => (r.open ? roomUrl(lang, r.id) : null));
  if (JSON.stringify(hall.map) !== JSON.stringify(expected)) problem(hall.path, `map ${JSON.stringify(hall.map)}`);
  if (hall.map.includes(null)) problem(hall.path, "a room of the map has no link");
}

await browser.close();
writeFileSync(join(out, "audit.json"), JSON.stringify(report, null, 2));
console.log(`${report.pages.length} pages, ${report.problems.length} problems`);
for (const p of report.problems) console.log(`- ${p}`);
process.exit(report.problems.length ? 1 : 0);
