#!/usr/bin/env node
// The ARC room alone (D25.1): every language, desktop and phone. Reads blocks
// one press at a time and checks that each press outlines the block read and
// the blocks it pushed out, as the model says, that the narration is plain and
// announced, that on a phone the block read and Next read are on screen, that
// reduced motion runs no animation, that with no script the text version is
// there, and that Tab reaches Next read before the blocks. Captures the figure
// at each stage and the whole page.
//   node scripts/verify-arc.mjs http://127.0.0.1:4321 shots/arc
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as arc from "../src/lib/arc.ts";

const [base = "http://127.0.0.1:4321", out = "shots/arc"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VP = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const B = {
  en: { next: "Next read", scan: "Scan 12 new blocks", hot: "Read the hot set again", rest: "Read the rest", reset: "Start again", ms10: "10 ms", s1: "1 s" },
  fr: { next: "Lecture suivante", scan: "Parcourir 12 nouveaux blocs", hot: "Relire l’ensemble chaud", rest: "Lire le reste", reset: "Recommencer", ms10: "10 ms", s1: "1 s" },
  es: { next: "Lectura siguiente", scan: "Recorrer 12 bloques nuevos", hot: "Volver a leer el conjunto caliente", rest: "Leer el resto", reset: "Reiniciar", ms10: "10 ms", s1: "1 s" },
};
const report = { problems: [], captures: [], steps: {} };
const problem = (x) => report.problems.push(x);
const browser = await chromium.launch();

// The model's view of the same reads: the scan, one block per press, 1 ms apart
// after a one-second gap (what readAll did in one go before D25.1).
const L = (s) => ({ mru: s.lists.mru.join(" "), mfu: s.lists.mfu.join(" "), mru_ghost: s.lists.mru_ghost.join(" "), mfu_ghost: s.lists.mfu_ghost.join(" ") });
const expected = (() => {
  const m = arc.opening();
  const ids = arc.next(m, "S", 12);
  const steps = [];
  ids.forEach((id, i) => {
    m.now += i ? 1 : 1000;
    const ev = arc.read(m, id);
    steps.push({ id, out: ev.filter((e) => e.k === "evict" || e.k === "forget").map((e) => e.id), ...L(m) });
  });
  m.now += 1000;
  const ev = arc.read(m, "S2");
  return { steps, s2: { out: ev.filter((e) => e.k === "evict" || e.k === "forget").map((e) => e.id), pd: arc.pct(m.pd), ...L(m) } };
})();

const state = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-arc]");
    const list = (st) => [...f.querySelectorAll(`.list[data-st="${st}"] .chip`)].map((c) => c.textContent).join(" ");
    const bar = f.querySelector(".stepbar");
    const sticky = getComputedStyle(bar).position === "sticky";
    const floor = sticky ? bar.getBoundingClientRect().top : innerHeight;
    const hit = f.querySelector(".hit .chip");
    const r = hit?.getBoundingClientRect();
    const dy = hit ? new DOMMatrix(getComputedStyle(hit).transform).m42 : 0;
    const b = f.querySelector('[data-act="next"]').getBoundingClientRect();
    return {
      mru: list("mru"),
      mfu: list("mfu"),
      mru_ghost: list("mru_ghost"),
      mfu_ghost: list("mfu_ghost"),
      hit: [...f.querySelectorAll(".hit .chip")].map((c) => c.textContent),
      out: [...f.querySelectorAll(".out .chip")].map((c) => c.textContent),
      balanceHit: f.querySelector(".arc-gauge").classList.contains("hit"),
      balance: f.querySelector("[data-balance]").textContent,
      narration: f.querySelector("[data-narration]").textContent,
      live: f.querySelector("[data-narration]").getAttribute("aria-live"),
      queue: f.querySelector("[data-queue]").textContent,
      links: f.querySelectorAll(".stepbar a, .arc-log a").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      seen: { hit: !!r && r.top - dy >= 0 && r.bottom - dy <= floor + 1, next: b.top >= 0 && b.bottom <= innerHeight },
    };
  });

for (const lang of ["en", "fr", "es"]) {
  const T = B[lang];
  for (const [vp, opts] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.deviceScaleFactor ?? 1, isMobile: !!opts.isMobile, hasTouch: !!opts.hasTouch });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/${lang}/arc/`, { waitUntil: "networkidle" });
    const fig = page.locator("[data-arc]");
    const btn = (n) => fig.getByRole("button", { name: n, exact: true });
    const shot = async (name) => {
      await page.waitForTimeout(700);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const tag = `${lang}-${vp}`;
    await page.screenshot({ path: join(out, `arc-${tag}-page.png`), fullPage: true });
    report.captures.push(`arc-${tag}-page.png`);
    if (vp === "desktop") {
      // The fifth Source note, opened: at 1280 px it goes to the side panel.
      await page.locator("[data-source-note] summary").nth(4).click();
      await page.waitForTimeout(400);
      const panel = await page.evaluate(() => !!document.querySelector('[role="dialog"] [data-source-body]'));
      if (!panel) problem(`${tag}: the Source note did not open in the panel`);
      await page.screenshot({ path: join(out, `arc-${tag}-panel.png`) });
      report.captures.push(`arc-${tag}-panel.png`);
      await page.keyboard.press("Escape");
    }
    await fig.scrollIntoViewIfNeeded();
    await shot(`arc-${tag}-0-start.png`);
    // The scan, one block per press: each press outlines the block read and what it pushed out.
    const seq = [];
    await btn(T.scan).click();
    for (let i = 0; i < 12; i++) {
      if (i) await btn(T.next).click();
      // The narration is set on the next frame (announced even when it repeats).
      await page.waitForTimeout(vp === "phone" ? 700 : 80);
      const st = await state(page);
      const want = expected.steps[i];
      seq.push({ hit: st.hit, out: st.out, narration: st.narration });
      if (st.hit.join() !== want.id) problem(`${tag} read ${i + 1}: outlined ${st.hit} instead of ${want.id}`);
      if (st.out.join() !== want.out.join()) problem(`${tag} read ${i + 1}: pushed out ${st.out} instead of ${want.out}`);
      for (const k of ["mru", "mfu", "mru_ghost", "mfu_ghost"]) if (st[k] !== want[k]) problem(`${tag} read ${i + 1}: ${k} "${st[k]}" instead of "${want[k]}"`);
      if (!st.narration.includes(want.id) || st.live !== "polite") problem(`${tag} read ${i + 1}: narration "${st.narration}"`);
      if (st.links) problem(`${tag} read ${i + 1}: links in the narration or log`);
      if (vp === "phone" && !(st.seen.hit && st.seen.next)) problem(`${tag} read ${i + 1}: block read or Next read off screen ${JSON.stringify(st.seen)}`);
      if (i === 10) await shot(`arc-${tag}-1-scan-full.png`);
    }
    report.steps[tag] = seq;
    // A ghost hit: S2 from the MRU ghost list.
    await fig.locator('button.chip[data-id="S2"]').click();
    if (vp === "phone") await page.waitForTimeout(700);
    const g = await state(page);
    if (g.hit.join() !== "S2" || g.out.join() !== expected.s2.out.join() || !g.balanceHit) problem(`${tag} S2: ${JSON.stringify({ hit: g.hit, out: g.out, balanceHit: g.balanceHit })}`);
    const pd = Number(g.balance.match(/arc_pd ([\d.,]+)/)?.[1].replace(",", "."));
    if (Math.abs(pd - expected.s2.pd) > 0.05) problem(`${tag} S2: arc_pd ${pd} instead of ${expected.s2.pd}`);
    if (vp === "phone" && !(g.seen.hit && g.seen.next)) problem(`${tag} S2: off screen ${JSON.stringify(g.seen)}`);
    await shot(`arc-${tag}-2-ghost-hit.png`);
    // The hot set, then Read the rest: the queue empties and Next read reads a new block.
    await btn(T.hot).click();
    await btn(T.rest).click();
    const h = await state(page);
    // A block read and then pushed out within Read the rest is outlined as pushed out.
    if (h.hit.some((id) => !h.mru.split(" ").includes(id) && !h.mfu.split(" ").includes(id))) problem(`${tag}: a block outlined as read is not in the cache (${h.hit})`);
    if (!/N1/.test(h.queue)) problem(`${tag}: after Read the rest the queue says "${h.queue}"`);
    await btn(T.next).click();
    const n = await state(page);
    if (n.hit.join() !== "N1") problem(`${tag}: Next read with an empty queue read ${n.hit}`);
    // At 10 ms a re-read of N1 stays in MRU.
    await fig.getByLabel(T.ms10).check();
    await fig.locator('button.chip[data-id="N1"]').click();
    const m = await state(page);
    if (!m.mru.split(" ").includes("N1")) problem(`${tag}: N1 left MRU after 10 ms`);
    await shot(`arc-${tag}-3-mintime.png`);
    if (m.overflow) problem(`${tag}: horizontal overflow`);
    if (errors.length) problem(`${tag}: console ${errors.join(" / ")}`);
    await ctx.close();
  }
}
// Reduced motion: no animation runs.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/arc/`, { waitUntil: "networkidle" });
  const fig = page.locator("[data-arc]");
  let running = 0;
  await fig.getByRole("button", { name: "Scan 12 new blocks", exact: true }).click();
  for (let i = 0; i < 11; i++) {
    await fig.getByRole("button", { name: "Next read", exact: true }).click();
    running = Math.max(running, await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length));
  }
  if (running) problem(`reduced motion: ${running} animations running`);
  report.reducedMotion = running;
  await fig.screenshot({ path: join(out, "arc-en-phone-reduced.png") });
  report.captures.push("arc-en-phone-reduced.png");
  await ctx.close();
}
// No script: the board and the text version, no controls.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/arc/`);
  const ns = await page.evaluate(() => {
    const f = document.querySelector("[data-arc]");
    const shown = (sel) => getComputedStyle(f.querySelector(sel)).display !== "none";
    return { bar: shown(".arc-bar"), stepbar: shown(".stepbar"), log: shown(".arc-log"), extraLegend: [...f.querySelectorAll(".js-only")].some((x) => getComputedStyle(x).display !== "none"), mfu: f.querySelectorAll('.list[data-st="mfu"] .chip').length, text: f.querySelector("[data-describe]").textContent.trim().length };
  });
  if (ns.bar || ns.stepbar || ns.log || ns.extraLegend || ns.mfu !== 6 || ns.text < 100) problem(`no script: ${JSON.stringify(ns)}`);
  report.noScript = ns;
  await page.locator("[data-arc]").screenshot({ path: join(out, "arc-en-desktop-noscript.png") });
  report.captures.push("arc-en-desktop-noscript.png");
  await ctx.close();
}
// Keyboard: Tab reaches Next read before any block, Enter and Space press it, focus is visible.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/arc/`, { waitUntil: "networkidle" });
  let first = null;
  for (let i = 0; i < 200 && !first; i++) {
    await page.keyboard.press("Tab");
    first = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest("[data-arc]") ? el.dataset.act ?? el.dataset.id ?? el.tagName : null;
    });
  }
  const narr = () => page.evaluate(() => document.querySelector("[data-arc] [data-narration]").textContent);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const afterEnter = await narr();
  await page.keyboard.press(" ");
  await page.waitForTimeout(100);
  const afterSpace = await narr();
  const focus = await page.evaluate(() => ({ act: document.activeElement?.dataset.act, visible: document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle !== "none" }));
  // Read the rest disables itself: the focus goes to Next read.
  await page.locator('[data-arc] [data-act="scan"]').click();
  await page.locator('[data-arc] [data-act="rest"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  const rest = await page.evaluate(() => ({ act: document.activeElement?.dataset.act, disabled: document.querySelector('[data-arc] [data-act="rest"]').disabled }));
  report.keyboard = { first, enter: afterEnter, space: afterSpace, focus, rest };
  if (first !== "next" || !/N1/.test(afterEnter) || !/N2/.test(afterSpace) || focus.act !== "next" || !focus.visible || rest.act !== "next" || !rest.disabled) problem(`keyboard: ${JSON.stringify(report.keyboard)}`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`${report.captures.length} captures, ${report.problems.length} problems`);
for (const p of report.problems) console.log(" -", p);
