#!/usr/bin/env node
// The Transaction groups room alone (D24.1): every language, desktop and phone.
// Steps through the figure, checks that each press outlines one part and
// announces it, that the narration has no links, that reduced motion runs no
// animation, and that with no script the text version is there. Captures the
// figure at each stage and the whole page.
//   node scripts/verify-txg.mjs http://127.0.0.1:4321 shots/txg
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base = "http://127.0.0.1:4321", out = "shots/txg"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VP = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const B = {
  en: { step: "Next event", write: "Add a write", zsync: "zpool sync", free: "Free a large file", reset: "Reset", play: "Play", pause: "Pause" },
  fr: { step: "Événement suivant", write: "Ajouter une écriture", zsync: "zpool sync", free: "Libérer un gros fichier", reset: "Recommencer", play: "Lecture", pause: "Pause" },
  es: { step: "Evento siguiente", write: "Añadir una escritura", zsync: "zpool sync", free: "Liberar un archivo grande", reset: "Reiniciar", play: "Iniciar", pause: "Pausar" },
};
const report = { problems: [], captures: [], steps: {} };
const problem = (x) => report.problems.push(x);
const browser = await chromium.launch();

const state = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-txg]");
    return {
      stages: [...f.querySelectorAll(".stage")].map((s) => s.querySelector(".num")?.textContent ?? "-"),
      ub: f.querySelector("[data-ub]")?.textContent,
      narration: f.querySelector(".narration")?.textContent,
      links: f.querySelectorAll(".narration a, .log a").length,
      hits: [...f.querySelectorAll(".hit")].map((x) => x.className + (x.dataset.cpu ? ` cpu${x.dataset.cpu}` : "") + (x.dataset.pass ? ` pass${x.dataset.pass}` : "")),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });

for (const lang of ["en", "fr", "es"]) {
  const L = B[lang];
  for (const [vp, opts] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.deviceScaleFactor ?? 1, isMobile: !!opts.isMobile, hasTouch: !!opts.hasTouch });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/${lang}/txg/`, { waitUntil: "networkidle" });
    const fig = page.locator("[data-txg]");
    const btn = (n) => fig.getByRole("button", { name: n, exact: true });
    const shot = async (name) => {
      await page.waitForTimeout(500);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const tag = `${lang}-${vp}`;
    if (vp === "desktop") {
      await page.screenshot({ path: join(out, `txg-${tag}-page.png`), fullPage: true });
      report.captures.push(`txg-${tag}-page.png`);
      // The second Source note, opened: at 1280 px it goes to the side panel.
      await page.locator("[data-source-note] summary").nth(1).click();
      await page.waitForTimeout(400);
      const panel = await page.evaluate(() => !!document.querySelector('[role="dialog"] .source-body, [role="dialog"] [data-source-body]'));
      if (!panel) problem(`${tag}: the Source note did not open in the panel`);
      await page.screenshot({ path: join(out, `txg-${tag}-panel.png`) });
      report.captures.push(`txg-${tag}-panel.png`);
      await page.keyboard.press("Escape");
    }
    await fig.scrollIntoViewIfNeeded();
    await shot(`txg-${tag}-0-start.png`);
    // Plain path: one effect per press.
    const seq = [];
    for (let i = 0; i < 12; i++) {
      await btn(L.step).click();
      const st = await state(page);
      seq.push({ narration: st.narration, hits: st.hits, stages: st.stages });
      if (st.hits.length !== 1) problem(`${tag} step ${i}: ${st.hits.length} outlined parts`);
      if (st.links) problem(`${tag} step ${i}: links in the narration or log`);
      if (i === 3) await shot(`txg-${tag}-1-quiesce.png`);
      if (i === 6) await shot(`txg-${tag}-2-pass.png`);
      if (i === 9) await shot(`txg-${tag}-3-commit.png`);
    }
    report.steps[tag] = seq;
    // zpool sync at once: the drain.
    await btn(L.reset).click();
    await btn(L.zsync).click();
    for (let i = 0; i < 3; i++) await btn(L.step).click();
    const drain = await state(page);
    if (drain.stages[1] !== "txg 41") problem(`${tag}: txg 41 not quiescing after zpool sync (${drain.stages})`);
    await shot(`txg-${tag}-4-drain.png`);
    // A long free during a sync: three stages busy.
    for (let i = 0; i < 20 && (await state(page)).stages[2] === "-"; i++) await btn(L.step).click();
    await btn(L.write).click();
    await btn(L.free).click();
    await btn(L.step).click();
    const three = await state(page);
    if (three.stages.includes("-")) problem(`${tag}: three stages not busy (${three.stages})`);
    await shot(`txg-${tag}-5-three.png`);
    await btn(L.play).click();
    await page.waitForTimeout(4000);
    await btn(L.pause).click();
    const played = await state(page);
    if (played.overflow) problem(`${tag}: horizontal overflow`);
    await shot(`txg-${tag}-6-played.png`);
    if (errors.length) problem(`${tag}: console ${errors.join(" / ")}`);
    await ctx.close();
  }
}
// Reduced motion: no animation runs.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/txg/`, { waitUntil: "networkidle" });
  const fig = page.locator("[data-txg]");
  let running = 0;
  await fig.getByRole("button", { name: "zpool sync", exact: true }).click();
  for (let i = 0; i < 12; i++) {
    await fig.getByRole("button", { name: "Next event", exact: true }).click();
    running = Math.max(running, await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length));
  }
  if (running) problem(`reduced motion: ${running} animations running`);
  report.reducedMotion = running;
  await fig.screenshot({ path: join(out, "txg-en-phone-reduced.png") });
  await ctx.close();
}
// No script: the text version, no live part.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/txg/`);
  const ns = await page.evaluate(() => ({ live: !document.querySelector("[data-txg] .live")?.hidden, items: document.querySelectorAll("[data-txg] .text-version li").length }));
  if (ns.live || ns.items < 5) problem(`no script: ${JSON.stringify(ns)}`);
  report.noScript = ns;
  await page.locator("[data-txg]").screenshot({ path: join(out, "txg-en-desktop-noscript.png") });
  await ctx.close();
}
// Keyboard: Tab reaches Next event, Enter and Space press it, focus is visible.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/txg/`, { waitUntil: "networkidle" });
  let found = false;
  for (let i = 0; i < 200 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.getAttribute("data-act") === "step");
  }
  const before = await page.evaluate(() => document.querySelector("[data-txg] .narration").textContent);
  await page.keyboard.press("Enter");
  const afterEnter = await page.evaluate(() => document.querySelector("[data-txg] .narration").textContent);
  await page.keyboard.press(" ");
  const afterSpace = await page.evaluate(() => document.querySelector("[data-txg] .narration").textContent);
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  report.keyboard = { found, enter: before !== afterEnter, space: afterEnter !== afterSpace, outline };
  if (!found || before === afterEnter || afterEnter === afterSpace || outline === "none") problem(`keyboard: ${JSON.stringify(report.keyboard)}`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`${report.captures.length} captures, ${report.problems.length} problems`);
for (const p of report.problems) console.log(" -", p);
