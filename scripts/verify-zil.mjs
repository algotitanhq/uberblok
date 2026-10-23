#!/usr/bin/env node
// The ZIL room alone (D30.1): every language, desktop and phone. Writes,
// fsyncs, cuts the power, imports and mounts, one press of Next step at a
// time, and checks that each step rings a part of the figure, that the
// narration counts the steps and carries no link, that on a phone the ringed
// part and Next step are on screen, that reduced motion runs no animation,
// that with no script the text version is there and the controls are not, and
// that the keyboard reaches and presses Next step. Captures the figure at each
// stage and the whole page.
//   node scripts/verify-zil.mjs http://127.0.0.1:4321 shots/zil
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base = "http://127.0.0.1:4321", out = "shots/zil"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VP = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const report = { problems: [], captures: [], steps: {} };
const problem = (x) => report.problems.push(x);
const browser = await chromium.launch();

const state = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-zl]");
    const bar = f.querySelector(".stepbar");
    const floor = Math.min(bar.getBoundingClientRect().top, innerHeight);
    const hit = f.querySelector(".hit");
    const r = hit?.getBoundingClientRect();
    const b = f.querySelector('[data-step="next"]').getBoundingClientRect();
    return {
      hits: f.querySelectorAll(".hit").length,
      key: !f.querySelector(".khit").hidden,
      narration: f.querySelector("[data-now]").textContent.trim(),
      live: f.querySelector("[data-now]").getAttribute("aria-live"),
      stepping: f.querySelector('[data-step="next"]').getAttribute("aria-disabled") === "false",
      focus: document.activeElement?.dataset.step ?? document.activeElement?.dataset.act ?? null,
      links: f.querySelectorAll(".stepbar a, .zl-log a, [data-writes] a, [data-memory] a, [data-disk] a").length,
      overflow: document.documentElement.scrollWidth > innerWidth,
      seen: { hit: !!r && r.top >= 0 && r.top < floor, next: b.top >= 0 && b.bottom <= innerHeight },
    };
  });

for (const lang of ["en", "fr", "es"]) {
  for (const [vp, opts] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: opts.deviceScaleFactor ?? 1, isMobile: !!opts.isMobile, hasTouch: !!opts.hasTouch });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/${lang}/zil/`, { waitUntil: "networkidle" });
    const fig = page.locator("[data-zl]");
    const shot = async (name) => {
      await page.waitForTimeout(500);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const tag = `${lang}-${vp}`;
    await page.screenshot({ path: join(out, `zil-${tag}-page.png`), fullPage: true });
    report.captures.push(`zil-${tag}-page.png`);
    if (vp === "desktop") {
      // A Source note, opened: at 1280 px it goes to the side panel.
      await page.locator("[data-source-note] summary").nth(2).click();
      await page.waitForTimeout(400);
      const panel = await page.evaluate(() => !!document.querySelector('[role="dialog"] [data-source-body]'));
      if (!panel) problem(`${tag}: the Source note did not open in the panel`);
      await page.screenshot({ path: join(out, `zil-${tag}-panel.png`) });
      report.captures.push(`zil-${tag}-panel.png`);
      await page.keyboard.press("Escape");
    }
    await fig.scrollIntoViewIfNeeded();
    await shot(`zil-${tag}-0-start.png`);
    // Each action, one step per press of Next step.
    const seq = [];
    // The first fsync() creates the log, which syncs the txg; the second write is the one replayed.
    for (const [i, act] of ["write", "fsync", "write", "fsync", "crash", "import", "mount"].entries()) {
      await fig.locator(`[data-act="${act}"]`).click();
      let n = 0;
      for (;;) {
        await page.waitForTimeout(vp === "phone" ? 500 : 60);
        const st = await state(page);
        n++;
        seq.push(`${i} ${act} ${n}: ${st.narration}`);
        if (!st.hits || !st.key) problem(`${tag} ${act} step ${n}: nothing ringed`);
        if (st.links) problem(`${tag} ${act} step ${n}: links in the figure`);
        if (st.live !== "polite" || !st.narration) problem(`${tag} ${act} step ${n}: narration "${st.narration}"`);
        if (vp === "phone" && !(st.seen.hit && st.seen.next)) problem(`${tag} ${act} step ${n}: ringed part or Next step off screen ${JSON.stringify(st.seen)}`);
        if (st.stepping && st.focus !== "next") problem(`${tag} ${act} step ${n}: focus on ${st.focus}, not Next step`);
        if (n === 2 && i === 3) await shot(`zil-${tag}-1-fsync-step.png`);
        if (n === 2 && act === "mount") await shot(`zil-${tag}-3-replay-step.png`);
        if (!st.stepping || n > 40) break;
        await fig.locator('[data-step="next"]').click();
      }
      if (n < 2 && (act === "mount" || i === 3)) problem(`${tag} ${act}: only ${n} step`);
      if (act === "crash") await shot(`zil-${tag}-2-crash.png`);
    }
    await shot(`zil-${tag}-4-mounted.png`);
    report.steps[tag] = seq;
    // Show every step ends an action at once; the focus stays in the bar.
    await fig.locator('[data-act="reset"]').click();
    await fig.locator('[data-act="write"]').click();
    await fig.locator('[data-act="fsync"]').click();
    await fig.locator('[data-step="skip"]').click();
    const sk = await state(page);
    if (sk.stepping || sk.focus !== "skip") problem(`${tag}: Show every step left ${JSON.stringify({ stepping: sk.stepping, focus: sk.focus })}`);
    // A setting changed after an action draws the panels again with no ring, and the ring's key goes.
    await fig.locator("[data-size]").nth(1).click();
    if (!(await fig.locator(".khit").isHidden())) problem(`${tag}: the ring's key stays with no ring`);
    if (sk.overflow) problem(`${tag}: horizontal overflow`);
    if (errors.length) problem(`${tag}: console ${errors.join(" / ")}`);
    await ctx.close();
  }
}
// Reduced motion: no animation runs.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/zil/`, { waitUntil: "networkidle" });
  const fig = page.locator("[data-zl]");
  let running = 0;
  await fig.locator('[data-act="write"]').click();
  await fig.locator('[data-act="fsync"]').click();
  for (let i = 0; i < 6; i++) {
    if ((await fig.locator('[data-step="next"]').getAttribute("aria-disabled")) === "true") break;
    await fig.locator('[data-step="next"]').click();
    running = Math.max(running, await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length));
  }
  if (running) problem(`reduced motion: ${running} animations running`);
  report.reducedMotion = running;
  await fig.screenshot({ path: join(out, "zil-en-phone-reduced.png") });
  report.captures.push("zil-en-phone-reduced.png");
  await ctx.close();
}
// No script: the figure and the text version, no controls.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/zil/`);
  const ns = await page.evaluate(() => {
    const f = document.querySelector("[data-zl]");
    const shown = (sel) => getComputedStyle(f.querySelector(sel)).display !== "none";
    return { bar: shown(".zl-bar"), stepbar: shown(".stepbar"), log: shown(".zl-log"), keyHit: shown(".khit"), disk: f.querySelector("[data-disk]").textContent.trim().length, text: f.querySelector("[data-describe]").textContent.trim().length };
  });
  if (ns.bar || ns.stepbar || ns.log || ns.keyHit || ns.disk < 10 || ns.text < 100) problem(`no script: ${JSON.stringify(ns)}`);
  report.noScript = ns;
  await page.locator("[data-zl]").screenshot({ path: join(out, "zil-en-desktop-noscript.png") });
  report.captures.push("zil-en-desktop-noscript.png");
  await ctx.close();
}
// Keyboard: Enter on write() and fsync(), then Space on Next step; the focus is visible.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/en/zil/`, { waitUntil: "networkidle" });
  let first = null;
  for (let i = 0; i < 200 && !first; i++) {
    await page.keyboard.press("Tab");
    first = await page.evaluate(() => (document.activeElement?.closest("[data-zl]") ? (document.activeElement.dataset.pool ?? document.activeElement.dataset.act ?? document.activeElement.tagName) : null));
  }
  await page.locator('[data-zl] [data-act="write"]').focus();
  await page.keyboard.press("Enter");
  await page.locator('[data-zl] [data-act="fsync"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const s1 = await state(page);
  await page.keyboard.press(" ");
  await page.waitForTimeout(100);
  const s2 = await state(page);
  const visible = await page.evaluate(() => document.activeElement.matches(":focus-visible") && getComputedStyle(document.activeElement).outlineStyle !== "none");
  report.keyboard = { first, afterFsync: s1.narration, focus: s1.focus, afterSpace: s2.narration, visible };
  if (!first || s1.focus !== "next" || s1.narration === s2.narration || !visible) problem(`keyboard: ${JSON.stringify(report.keyboard)}`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`${report.captures.length} captures, ${report.problems.length} problems`);
for (const p of report.problems) console.log(" -", p);
