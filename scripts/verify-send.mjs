#!/usr/bin/env node
// The send / receive room alone (D29.1): every language, desktop and phone.
// Sends a full stream, then an incremental one from @s3, one press of Next step
// at a time, and checks that each press outlines what the model says it did
// (send-view.ts justWritten, the tested pointer), that the line is plain (no
// link, no code name), that the outlined part and Next step are both on screen
// (desktop and phone), that reduced motion runs no animation, that with no script the
// step bar is hidden and nothing is outlined, and that Next step works from the
// keyboard with the focus kept. Captures the figure at each stage and the page.
//   node scripts/verify-send.mjs http://127.0.0.1:4321 shots/send
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

// send.ts imports "./fletcher4" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const M = await import("../src/lib/send.ts");
const V = await import("../src/lib/send-view.ts");

const [base = "http://127.0.0.1:4321", out = "shots/send"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const VP = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } };
const URL = { en: "/en/send-receive/", fr: "/fr/send-receive/", es: "/es/send-receive/" };
const report = { problems: [], captures: [], runs: {} };
const problem = (x) => report.problems.push(x);
const browser = await chromium.launch();

const snaps = M.snapshots();
const froms = [null, ...snaps.slice(0, 3)];
const model = (fi) => {
  const snd = M.send(snaps[3], froms[fi]);
  const rcv = M.receive(froms[fi] ? M.contentOf(froms[fi].root) : {}, M.streamBytes(snd.records));
  return { snd, rcv };
};

async function state(page) {
  return page.evaluate(() => {
    const f = document.querySelector("[data-send]");
    const inView = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const bar = f.querySelector(".sr-stepbar").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= Math.min(innerHeight, getComputedStyle(f.querySelector(".sr-stepbar")).position === "sticky" ? bar.top + 1 : innerHeight);
    };
    const btn = f.querySelector('.sr-stepbar [data-act="step"]').getBoundingClientRect();
    const cur = f.querySelector("[data-tree] .cur");
    const just = [...f.querySelectorAll("[data-strip] .rec.just")].map((e) => Number(e.dataset.rec));
    const recv = f.querySelector("[data-receiver] .verdict, [data-receiver] .blk.new, [data-receiver] li.new");
    return {
      line: f.querySelector("[data-now]").innerHTML,
      cur: cur?.dataset.bp ?? f.querySelector("[data-tree] .slot.cur")?.dataset.dn ?? null,
      just,
      curInView: inView(cur ?? f.querySelector("[data-tree] .slot.cur")),
      recvInView: inView(recv),
      justInView: inView(f.querySelector("[data-strip] .rec.just")),
      buttonInView: btn.top >= 0 && btn.bottom <= innerHeight,
      running: document.getAnimations().filter((a) => a.playState === "running").length,
    };
  });
}

for (const lang of ["en", "fr", "es"])
  for (const [vp, view] of Object.entries(VP)) {
    const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.deviceScaleFactor ?? 1, isMobile: !!view.isMobile, hasTouch: !!view.hasTouch, reducedMotion: vp === "phone" && lang === "en" ? "reduce" : "no-preference" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(base + URL[lang]);
    const fig = page.locator("[data-send]");
    const run = (report.runs[`${lang}-${vp}`] = { presses: 0, outlinedOk: 0 });
    const s0 = await state(page);
    if (s0.just.length) problem({ where: `${lang}-${vp}`, what: "outlined before any step", just: s0.just });
    if (!s0.line) problem({ where: `${lang}-${vp}`, what: "no line on load" });

    for (const [fi, presses] of [[0, 4], [3, 6]]) {
      await fig.locator(`.sr-bar button[data-from="${fi}"]`).click();
      const { snd, rcv } = model(fi);
      const last = V.lastFrame(snd, rcv);
      // The first press at the end starts again from BEGIN (t = 0).
      for (let t = 0; t < (fi === 3 ? last + 1 : presses); t++) {
        await fig.locator('.sr-stepbar [data-act="step"]').click();
        await page.waitForTimeout(450);
        const s = await state(page);
        run.presses++;
        const want = [...V.justWritten(snd, rcv, t)];
        const wantCur = t > 0 && t <= snd.steps.length ? snd.steps[t - 1] : null;
        const curOk = !wantCur || (wantCur.k === "test" ? s.cur === wantCur.bp.id : s.cur === String(wantCur.dn.object));
        if (JSON.stringify(s.just) !== JSON.stringify(want) || !curOk) problem({ where: `${lang}-${vp}-from${fi}-t${t}`, got: { just: s.just, cur: s.cur }, want: { just: want, cur: wantCur?.bp?.id ?? wantCur?.dn?.object } });
        else run.outlinedOk++;
        if (/<a\b|send_cb|dump_|td_min_txg|drr_checksum|receive_\w+/.test(s.line)) problem({ where: `${lang}-${vp}-t${t}`, what: "code in the line", line: s.line });
        {
          const seen = t > 0 && t <= snd.steps.length ? s.curInView : t > snd.steps.length + 1 ? s.recvInView ?? s.justInView : s.justInView;
          if (!s.buttonInView || seen === false) problem({ where: `${lang}-${vp}-from${fi}-t${t}`, what: "off screen", button: s.buttonInView, seen });
        }
        if (vp === "phone" && lang === "en" && s.running) problem({ where: `reduced-motion-t${t}`, running: s.running });
        if (fi === 0 && t === 3) {
          await page.screenshot({ path: join(out, `send-${lang}-${vp}-full-step3.png`) });
          report.captures.push(`send-${lang}-${vp}-full-step3.png`);
        }
        if (fi === 3 && t === 2) {
          await page.screenshot({ path: join(out, `send-${lang}-${vp}-s3-skip.png`) });
          report.captures.push(`send-${lang}-${vp}-s3-skip.png`);
        }
      }
      if (fi === 3) {
        await page.screenshot({ path: join(out, `send-${lang}-${vp}-s3-receive.png`) });
        report.captures.push(`send-${lang}-${vp}-s3-receive.png`);
      }
    }
    if (lang !== "es" || vp === "desktop") {
      await fig.screenshot({ path: join(out, `send-${lang}-${vp}-figure.png`) });
      report.captures.push(`send-${lang}-${vp}-figure.png`);
    }
    if (errors.length) problem({ where: `${lang}-${vp}`, errors });
    await ctx.close();
  }

// No script: the finished stream, no step bar, nothing outlined.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + URL.en);
  report.noJs = await page.evaluate(() => ({
    stepbarHidden: getComputedStyle(document.querySelector("[data-send] .sr-stepbar")).display === "none",
    outlined: document.querySelectorAll("[data-send] .rec.just, [data-send] [data-tree] .cur").length,
    records: document.querySelectorAll("[data-send] [data-strip] .rec").length,
  }));
  if (!report.noJs.stepbarHidden || report.noJs.outlined) problem({ where: "noJs", ...report.noJs });
  await ctx.close();
}

// Keyboard: Tab to Next step, Enter steps, the focus stays on the button.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + URL.en);
  let found = false;
  for (let i = 0; i < 80 && !found; i++) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(() => document.activeElement?.matches('[data-send] .sr-stepbar [data-act="step"]'));
  }
  const lines = [];
  for (let i = 0; i < 3 && found; i++) {
    await page.keyboard.press("Enter");
    lines.push(await page.evaluate(() => document.querySelector("[data-send] [data-now]").textContent));
  }
  const kept = await page.evaluate(() => document.activeElement?.matches('[data-send] .sr-stepbar [data-act="step"]'));
  report.keyboard = { found, kept, distinct: new Set(lines).size };
  if (!found || !kept || new Set(lines).size !== 3) problem({ where: "keyboard", ...report.keyboard });
  await page.screenshot({ path: join(out, "send-en-desktop-keyboard.png") });
  report.captures.push("send-en-desktop-keyboard.png");
  await ctx.close();
}

// The whole page, desktop and phone, in English.
for (const [vp, view] of Object.entries(VP)) {
  const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(base + URL.en);
  await page.screenshot({ path: join(out, `send-en-${vp}-page.png`), fullPage: true });
  report.captures.push(`send-en-${vp}-page.png`);
  await ctx.close();
}

await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
for (const [k, v] of Object.entries(report.runs)) console.log("run", k, JSON.stringify(v));
console.log("noJs", JSON.stringify(report.noJs), "keyboard", JSON.stringify(report.keyboard));
console.log("problems", report.problems.length, JSON.stringify(report.problems.slice(0, 8)));
if (report.problems.length) process.exitCode = 1;
