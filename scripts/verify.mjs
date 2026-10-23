#!/usr/bin/env node
// Verification loop in a real browser (brief section 8), against a running
// build (`npm run preview`). Writes captures and a JSON report to <out>, which
// must stay out of git (shots/ is ignored).
//   node scripts/verify.mjs http://127.0.0.1:4321 shots/slice-1
// Checks: no console error or page error on any page; captures FR/EN x 390/1440
// x dark/light; reduced-motion run of the room; keyboard-only walk with visible
// focus on every stop; the room's interactions driven from the keyboard.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";
import * as arcModel from "../src/lib/arc.ts";
import * as msModel from "../src/lib/metaslab.ts";
import * as zilModel from "../src/lib/zil.ts";

// send.ts imports "./fletcher4" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const sendModel = await import("../src/lib/send.ts");
const trModel = await import("../src/lib/transforms.ts");
const { verifyVdevs, VD, GL_ARGS } = await import("./verify-vdevs.mjs");
const { verifyTree, TR: TREE } = await import("./verify-tree.mjs");

const [base = "http://127.0.0.1:4321", out = "shots/verify"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const PAGES = [
  { id: "hall", en: "/en/", fr: "/fr/", es: "/es/" },
  { id: "history", en: "/en/history/", fr: "/fr/histoire/", es: "/es/historia/" },
  TREE,
  { id: "cow", en: "/en/copy-on-write/", fr: "/fr/copie-sur-ecriture/", es: "/es/copia-en-escritura/" },
  { id: "txg", en: "/en/txg/", fr: "/fr/txg/", es: "/es/txg/" },
  VD,
  { id: "raidz", en: "/en/raidz/", fr: "/fr/raidz/", es: "/es/raidz/" },
  { id: "snapshots", en: "/en/snapshots/", fr: "/fr/instantanes/", es: "/es/instantaneas/" },
  { id: "arc", en: "/en/arc/", fr: "/fr/arc/", es: "/es/arc/" },
  { id: "metaslabs", en: "/en/metaslabs/", fr: "/fr/metaslabs/", es: "/es/metaslabs/" },
  { id: "zil", en: "/en/zil/", fr: "/fr/zil/", es: "/es/zil/" },
  { id: "send", en: "/en/send-receive/", fr: "/fr/send-receive/", es: "/es/send-receive/" },
  { id: "transforms", en: "/en/compression-dedup-encryption/", fr: "/fr/compression-dedup-chiffrement/", es: "/es/compresion-dedup-cifrado/" },
  { id: "engine-room", en: "/en/engine-room/", fr: "/fr/salle-des-machines/", es: "/es/sala-de-maquinas/" },
];
const TXG = PAGES.find((p) => p.id === "txg");
const COW = PAGES.find((p) => p.id === "cow");
const VIEWPORTS = {
  iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const report = { base, errors: [], captures: [], keyboard: {}, reducedMotion: {} };

// Software WebGL (SwiftShader) so that the 3D views (the vdevs and tree rooms, the Hall) can open (brief section 6).
const browser = await chromium.launch({ args: GL_ARGS });

async function open(ctxOpts, path, theme = "dark") {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") report.errors.push({ path, theme, type: m.type(), text: m.text() });
  });
  page.on("pageerror", (e) => report.errors.push({ path, theme, type: "pageerror", text: String(e) }));
  page.on("requestfailed", (r) => report.errors.push({ path, theme, type: "requestfailed", text: r.url() }));
  await page.goto(base + path, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

// 1. Captures: every page x language x viewport x theme, full page.
// Spanish (D16.3) is captured and checked for console errors with the others; the
// interactions below are driven in English and French, whose labels they name.
for (const p of PAGES)
  for (const lang of ["en", "fr", "es"])
    for (const [vp, opts] of Object.entries(VIEWPORTS))
      for (const theme of ["dark", "light"]) {
        const { ctx, page } = await open(opts, p[lang], theme);
        const file = `${p.id}-${lang}-${vp}-${theme}.png`;
        await page.screenshot({ path: join(out, file), fullPage: true });
        report.captures.push(file);
        await ctx.close();
      }

// 2. The room in motion: mid-rewrite, after commit, after a crash, mirror read.
for (const lang of ["en", "fr"]) {
  const L = lang === "en" ? { next: "Next step", crash: "Cut the power", rot: "Flip a bit in D1 on disk A", lost: "Lose a write of D2 on disk A", read: "Read the file", snap: "Take a snapshot" }
    : { next: "Étape suivante", crash: "Couper le courant", rot: "Inverser un bit de D1 sur le disque A", lost: "Perdre une écriture de D2 sur le disque A", read: "Lire le fichier", snap: "Prendre un instantané" };
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], COW[lang]);
    const cow = page.locator("[data-cow]");
    const shot = async (loc, name) => {
      await page.waitForTimeout(700);
      await loc.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    await cow.getByRole("button", { name: L.snap }).click();
    for (let i = 0; i < 3; i++) await cow.getByRole("button", { name: L.next }).click();
    await shot(cow, `cow-${lang}-${vp}-step3.png`);
    await cow.getByRole("button", { name: L.next }).click();
    await shot(cow, `cow-${lang}-${vp}-commit.png`);
    await cow.getByRole("button", { name: L.next }).click();
    await shot(cow, `cow-${lang}-${vp}-snapshot-kept.png`);
    for (let i = 0; i < 2; i++) await cow.getByRole("button", { name: L.next }).click();
    await cow.getByRole("button", { name: L.crash }).click();
    await shot(cow, `cow-${lang}-${vp}-crash.png`);
    const mirror = page.locator("[data-mirror]");
    await mirror.getByRole("button", { name: L.rot }).click();
    await mirror.getByRole("button", { name: L.lost }).click();
    await shot(mirror, `mirror-${lang}-${vp}-damaged.png`);
    await mirror.getByRole("button", { name: L.read }).click();
    await page.waitForFunction(() => document.querySelector("[data-mirror] .result")?.textContent?.trim().length > 0, null, { timeout: 30000 });
    await shot(mirror, `mirror-${lang}-${vp}-healed.png`);
    await ctx.close();
  }
}

// 3. prefers-reduced-motion: Play finishes at once, nothing animates.
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, COW.en);
  const t0 = Date.now();
  await page.locator("[data-cow]").getByRole("button", { name: "Play" }).click();
  await page.waitForFunction(() => /Step 5 of 5/.test(document.querySelector("[data-cow] .stepno")?.textContent ?? ""));
  report.reducedMotion.playMs = Date.now() - t0;
  report.reducedMotion.durations = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--dur-3").trim());
  report.reducedMotion.animations = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
  await page.screenshot({ path: join(out, "cow-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("cow-en-iphone-reduced-motion.png");
  await ctx.close();
}

// 4. Keyboard only: Tab through the whole room, record every stop and whether
//    a focus indicator is drawn, then drive both figures with Enter and arrows.
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, COW[lang]);
  const stops = [];
  for (let i = 0; i < 200; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("value") || "").trim().replace(/\s+/g, " ").slice(0, 60);
      return {
        tag: el.tagName.toLowerCase(),
        label,
        focusVisible: el.matches(":focus-visible"),
        outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + label + "|" + (el.getAttribute("href") || ""),
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  if (lang === "en") {
    await page.keyboard.press("Tab");
    await page.screenshot({ path: join(out, "cow-en-desktop-focus.png") });
    report.captures.push("cow-en-desktop-focus.png");
  }
  // Drive by keyboard: focus a control by Tab, then Enter / arrows.
  async function tabTo(pred, arg) {
    for (let i = 0; i < 200; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(pred, arg)) return true;
    }
    return false;
  }
  const drive = {};
  const L = lang === "en" ? { next: "Next step", read: "Read the file", rot: "Flip a bit in D1 on disk A" } : { next: "Étape suivante", read: "Lire le fichier", rot: "Inverser un bit de D1 sur le disque A" };
  await page.goto(base + COW[lang]);
  drive.radio = await tabTo(() => document.activeElement?.matches?.("[data-cow] input[type=radio]"));
  await page.keyboard.press("ArrowRight");
  drive.radioValue = await page.evaluate(() => document.querySelector("[data-cow] input[type=radio]:checked")?.value);
  drive.next = await tabTo((l) => document.activeElement?.textContent?.trim() === l, L.next);
  for (let i = 0; i < 5; i++) await page.keyboard.press("Enter");
  drive.cowStep = await page.evaluate(() => document.querySelector("[data-cow] .stepno")?.textContent);
  drive.rot = await tabTo((l) => document.activeElement?.textContent?.trim() === l, L.rot);
  await page.keyboard.press("Enter");
  drive.read = await tabTo((l) => document.activeElement?.textContent?.trim() === l, L.read);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-mirror] .result")?.textContent?.trim().length > 0, null, { timeout: 30000 });
  drive.mirrorResult = await page.evaluate(() => document.querySelector("[data-mirror] .result")?.textContent);
  report.keyboard[lang] = {
    stops: stops.length,
    withoutVisibleFocus: stops.filter((s) => !(s.focusVisible && s.outline)).map((s) => s.label),
    list: stops.map((s) => `${s.tag}: ${s.label}`),
    drive,
  };
  await ctx.close();
}

// Hall: the ring commits by itself; keyboard reaches its pause button, and Enter stops the clock.
{
  const { ctx, page } = await open(VIEWPORTS.desktop, PAGES[0].en);
  const txg = () => page.evaluate(() => document.querySelector('[data-field="txg"]')?.textContent);
  await page.locator("[data-ring]").scrollIntoViewIfNeeded();
  const start = await txg();
  // The tick, measured (D16.2: a txg every 1.3 s): the times the txg changes over 5.5 s.
  const ticks = await page.evaluate(
    () =>
      new Promise((done) => {
        const el = document.querySelector('[data-field="txg"]');
        const at = [];
        const mo = new MutationObserver(() => at.push(performance.now()));
        mo.observe(el, { childList: true, characterData: true, subtree: true });
        setTimeout(() => (mo.disconnect(), done(at)), 5500);
      }),
  );
  const gaps = ticks.slice(1).map((t, i) => t - ticks[i]).sort((a, b) => a - b);
  const tickMs = Math.round(gaps[gaps.length >> 1] ?? 0);
  const moved = (await txg()) !== start;
  await page.evaluate(() => window.scrollTo(0, 0));
  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement?.matches?.("[data-pause]"));
  }
  await page.keyboard.press("Enter");
  const t0 = await txg();
  await page.waitForTimeout(3500);
  report.keyboard.hallPause = { moved, tickMs, reached, paused: (await txg()) === t0, label: await page.evaluate(() => document.querySelector("[data-pause]")?.textContent) };
  const hp = report.keyboard.hallPause;
  if (!hp.moved || Math.abs(hp.tickMs - 1300) > 100 || !hp.reached || !hp.paused || hp.label !== "Resume") throw new Error(`Hall pause check failed: ${JSON.stringify(hp)}`);
  // Next txg (D21.2): the next Tab stop; Enter commits exactly one txg and says where it went.
  await page.keyboard.press("Tab");
  const onStep = await page.evaluate(() => document.activeElement?.matches?.("[data-step]"));
  const before = Number(await txg());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  report.keyboard.hallStep = {
    onStep,
    added: Number(await txg()) - before,
    live: await page.evaluate(() => document.querySelector("[data-live]")?.textContent ?? ""),
  };
  const hs = report.keyboard.hallStep;
  if (!hs.onStep || hs.added !== 1 || !hs.live.includes(`Txg ${before + 1} goes to slot`)) throw new Error(`Hall step check failed: ${JSON.stringify(hs)}`);
  await ctx.close();
}

// History wing: keyboard-only walk (every stop has a visible focus), a footnote
// followed and back by Enter, the language switch keeps the page.
for (const lang of ["en", "fr"]) {
  const H = PAGES.find((p) => p.id === "history");
  const { ctx, page } = await open(VIEWPORTS.desktop, H[lang]);
  const stops = [];
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  await page.goto(base + H[lang]);
  const drive = {};
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.matches?.("a.fn"))) break;
  }
  if (lang === "en") {
    await page.screenshot({ path: join(out, "history-en-desktop-focus-footnote.png") });
    report.captures.push("history-en-desktop-focus-footnote.png");
  }
  await page.keyboard.press("Enter");
  drive.footnote = await page.evaluate(() => location.hash);
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((h) => document.activeElement?.closest?.("li")?.id === h.slice(1) && document.activeElement.closest(".back"), drive.footnote)) break;
  }
  await page.keyboard.press("Enter");
  drive.back = await page.evaluate(() => location.hash);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "history-en-desktop-back-target.png") });
    report.captures.push("history-en-desktop-back-target.png");
  }
  drive.langSwitch = await page.evaluate(() => document.querySelector(".site-header .lang")?.getAttribute("href"));
  report.keyboard[`history-${lang}`] = {
    stops: stops.length,
    withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label),
    drive,
  };
  await ctx.close();
}

// Transaction groups room: the figure in its states, reduced motion, keyboard.
const TL = {
  en: { write: "Add a write", zsync: "zpool sync", free: "Free a large file", step: "Next event", play: "Play", pause: "Pause", quiesced: "Quiesced, waiting for the sync thread" },
  fr: { write: "Ajouter une écriture", zsync: "zpool sync", free: "Libérer un gros fichier", step: "Événement suivant", play: "Lecture", pause: "Pause", quiesced: "Clos, attend le thread de synchronisation" },
};
const txgState = (page) =>
  page.evaluate(() => ({
    stages: [...document.querySelectorAll("[data-txg] .stage")].map((s) => s.querySelector(".num")?.textContent ?? "-"),
    ub: document.querySelector("[data-txg] [data-ub]")?.textContent,
    narration: document.querySelector("[data-txg] .narration")?.textContent?.slice(0, 90),
    caption: document.querySelector('[data-txg] [data-stage="quiescing"] .var code')?.textContent,
    middle: document.querySelector('[data-txg] [data-stage="quiescing"] .card .state')?.textContent ?? null,
  }));
// The middle column names the variable that holds its txg: tx_quiesced_txg once the txg is quiesced
// (txg.c L662-L663), tx_quiescing_txg otherwise.
const captionSeen = { tx_quiescing_txg: 0, tx_quiesced_txg: 0 };
const captionMismatches = [];
const checkCaption = (st, lang, where) => {
  if (st.middle === null) return;
  const want = st.middle === TL[lang].quiesced ? "tx_quiesced_txg" : "tx_quiescing_txg";
  captionSeen[want]++;
  if (st.caption !== want) captionMismatches.push({ where, middle: st.middle, caption: st.caption });
};
report.txg = {};
for (const lang of ["en", "fr"]) {
  const L = TL[lang];
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], TXG[lang]);
    const fig = page.locator("[data-txg]");
    const shot = async (name) => {
      await page.waitForTimeout(600);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const b0 = (n) => fig.getByRole("button", { name: n, exact: true });
    const b = (n) => ({
      click: async () => {
        await b0(n).click();
        checkCaption(await txgState(page), lang, `${lang}-${vp} after ${n}`);
      },
    });
    await shot(`txg-${lang}-${vp}-start.png`);
    await b(L.write).click();
    await b(L.zsync).click();
    for (let i = 0; i < 4; i++) await b(L.step).click();
    await shot(`txg-${lang}-${vp}-quiescing.png`);
    // Step until a txg syncs, then a long free: all three stages busy.
    for (let i = 0; i < 30; i++) {
      const st = await txgState(page);
      if (st.stages[2] !== "-") break;
      await b(L.step).click();
    }
    await b(L.write).click();
    await b(L.free).click();
    await b(L.step).click();
    const three = await txgState(page);
    await shot(`txg-${lang}-${vp}-three-stages.png`);
    for (let i = 0; i < 40; i++) {
      const st = await txgState(page);
      if (/uberblock (of|du) txg 4[1-9]/.test(st.ub) && !st.ub.includes(" 40,")) break;
      await b(L.step).click();
    }
    await shot(`txg-${lang}-${vp}-commit.png`);
    // Play in real time for a few seconds.
    await b(L.play).click();
    await page.waitForTimeout(6500);
    const played = await txgState(page);
    await b(L.pause).click();
    await shot(`txg-${lang}-${vp}-played.png`);
    checkCaption(played, lang, `${lang}-${vp} played`);
    report.txg[`${lang}-${vp}`] = { three, played };
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, TXG.en);
  const fig = page.locator("[data-txg]");
  await fig.getByRole("button", { name: "Add a write", exact: true }).click();
  await fig.getByRole("button", { name: "zpool sync", exact: true }).click();
  let running = 0;
  for (let i = 0; i < 12; i++) {
    await fig.getByRole("button", { name: "Next event", exact: true }).click();
    running = Math.max(running, await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length));
  }
  report.reducedMotion.txgRunningAnimations = running;
  report.reducedMotion.txgState = await txgState(page);
  await fig.screenshot({ path: join(out, "txg-en-iphone-reduced-motion.png") });
  report.captures.push("txg-en-iphone-reduced-motion.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, TXG[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Drive the figure from the keyboard alone: Tab to a button, Enter.
  await page.goto(base + TXG[lang]);
  const L = TL[lang];
  async function tabTo(label) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((l) => document.activeElement?.closest?.("[data-txg]") && document.activeElement.textContent.trim() === l, label)) return true;
    }
    return false;
  }
  const drive = { write: await tabTo(L.write) };
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  drive.zsync = await tabTo(L.zsync);
  await page.keyboard.press("Enter");
  drive.step = await tabTo(L.step);
  for (let i = 0; i < 25; i++) await page.keyboard.press("Enter");
  drive.state = await txgState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "txg-en-desktop-focus.png") });
    report.captures.push("txg-en-desktop-focus.png");
  }
  report.keyboard[`txg-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive };
  await ctx.close();
}

// RAID-Z room: the map for a few inputs (numbers read back from the page),
// the write, a read with damaged children, reduced motion, keyboard only.
const RZ = PAGES.find((p) => p.id === "raidz");
const RL = {
  en: { write: "Write the block", read: "Read the block", bad: "returns bad data", missing: "missing" },
  fr: { write: "Écrire le bloc", read: "Lire le bloc", bad: "données fausses", missing: "absent" },
};
const rzState = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-raidz]");
    const dl = Object.fromEntries([...f.querySelectorAll(".rz-readout > div")].map((d) => [d.querySelector("dt").textContent, d.querySelector("strong").textContent]));
    const roles = [...f.querySelectorAll(".rz-grid .role")].map((r) => r.textContent).join(" ");
    return { dl, roles, summary: f.querySelector("[data-summary]").textContent, result: f.querySelector("[data-result]").textContent.slice(0, 160) };
  });
async function setInputs(page, v) {
  const f = page.locator("[data-raidz]");
  if (v.nparity) await f.locator(`input[name=nparity][value="${v.nparity}"]`).check({ force: true });
  for (const k of ["psize", "dcols", "b"]) if (v[k] !== undefined) await f.locator(`input[name=${k}]`).fill(String(v[k]));
  if (v.ashift) await f.locator("select[name=ashift]").selectOption(String(v.ashift));
}
report.raidz = {};
for (const lang of ["en", "fr"]) {
  const L = RL[lang];
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], RZ[lang]);
    const fig = page.locator("[data-raidz]");
    const shot = async (name) => {
      await page.waitForTimeout(400);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const r = {};
    r.default = await rzState(page);
    await fig.getByRole("button", { name: L.write, exact: true }).click();
    await page.waitForTimeout(700);
    await shot(`raidz-${lang}-${vp}-writing.png`);
    await setInputs(page, { nparity: 2, dcols: 12, psize: 8192, ashift: 12, b: 0 });
    r.wideSmall = await rzState(page);
    await shot(`raidz-${lang}-${vp}-wide-raidz2-8k.png`);
    await setInputs(page, { nparity: 1, dcols: 3, psize: 16384, ashift: 12, b: 256 });
    r.swap = await rzState(page);
    await shot(`raidz-${lang}-${vp}-raidz1-swap.png`);
    await setInputs(page, { nparity: 2, dcols: 6, psize: 24576, ashift: 12, b: 0 });
    const hs = fig.locator("[data-health] select");
    await hs.nth(0).selectOption("corrupt");
    await hs.nth(3).selectOption("corrupt");
    await fig.getByRole("button", { name: L.read, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-raidz] [data-result]")?.textContent?.length > 0, null, { timeout: 30000 });
    r.corrupt = await rzState(page);
    await shot(`raidz-${lang}-${vp}-reconstruction.png`);
    await fig.getByRole("button", { name: lang === "en" ? "Heal all" : "Tout réparer", exact: true }).click();
    await hs.nth(3).selectOption("missing");
    await fig.getByRole("button", { name: L.read, exact: true }).click();
    await page.waitForFunction(() => document.querySelector("[data-raidz] [data-result]")?.textContent?.length > 0, null, { timeout: 30000 });
    r.missing = await rzState(page);
    await shot(`raidz-${lang}-${vp}-missing-resilver.png`);
    report.raidz[`${lang}-${vp}`] = r;
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, RZ.en);
  const fig = page.locator("[data-raidz]");
  await fig.getByRole("button", { name: "Write the block", exact: true }).click();
  const pending = await page.evaluate(() => document.querySelectorAll("[data-raidz] .cell.pending").length);
  await fig.locator("[data-health] select").nth(2).selectOption("corrupt");
  const t0 = Date.now();
  await fig.getByRole("button", { name: "Read the block", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("[data-raidz] [data-result]")?.textContent?.length > 0);
  report.reducedMotion.raidz = { pendingAfterWrite: pending, readMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "raidz-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("raidz-en-iphone-reduced-motion.png");
  await ctx.close();
}
// No JavaScript: the static default layout and its numbers are there.
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + RZ.en);
  report.raidz.noJs = await page.evaluate(() => ({
    cells: document.querySelectorAll("[data-raidz] .cell[data-n]").length,
    asize: [...document.querySelectorAll(".rz-readout > div")].find((d) => d.querySelector("dt").textContent === "asize")?.querySelector("strong").textContent,
    controlsHidden: document.querySelector(".rz-controls").hidden,
  }));
  await page.screenshot({ path: join(out, "raidz-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("raidz-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, RZ[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const target = el.matches(".segmented input") ? el.closest("label") : el;
      const ts = getComputedStyle(target);
      return {
        label: (el.getAttribute("aria-label") || el.getAttribute("name") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && ts.outlineStyle !== "none" && parseFloat(ts.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + (el.getAttribute("name") || "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Drive the figure with the keyboard alone.
  await page.goto(base + RZ[lang]);
  const L = RL[lang];
  async function tabTo(pred, arg) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(pred, arg)) return true;
    }
    return false;
  }
  const drive = {};
  drive.psize = await tabTo(() => document.activeElement?.matches?.("[data-raidz] input[name=psize]"));
  await page.keyboard.press("Control+A");
  await page.keyboard.type("8192");
  drive.parity = await tabTo(() => document.activeElement?.matches?.("[data-raidz] input[name=nparity]"));
  await page.keyboard.press("ArrowRight"); // raidz2 -> raidz3
  drive.dcols = await tabTo(() => document.activeElement?.matches?.("[data-raidz] input[name=dcols]"));
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowUp"); // 6 -> 12
  drive.health = await tabTo(() => document.activeElement?.matches?.("[data-raidz] [data-health] select"));
  await page.keyboard.press("ArrowDown"); // child 0 -> missing
  drive.read = await tabTo((l) => document.activeElement?.closest?.("[data-raidz]") && document.activeElement.textContent.trim() === l, L.read);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-raidz] [data-result]")?.textContent?.length > 0, null, { timeout: 30000 });
  drive.state = await rzState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "raidz-en-desktop-keyboard.png") });
    report.captures.push("raidz-en-desktop-keyboard.png");
  }
  report.keyboard[`raidz-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive };
  await ctx.close();
}

// Previous/next across the open rooms, both languages.
// Snapshots and clones room: the sequences QA replays (a block born in the
// same txg as a snapshot, an overwrite inside a clone, a destroy), read back
// from the page; reduced motion; no JS; keyboard only.
const SN = PAGES.find((p) => p.id === "snapshots");
const SNL = {
  en: { sync: /^Sync txg \d+$/, snap: "Snapshot fs", clone: "Clone", destroy: "Destroy", ow: (d) => `Overwrite in ${d}`, write: "Write D", reset: "Start again" },
  fr: { sync: /^Synchroniser le txg \d+$/, snap: "Instantané de fs", clone: "Cloner", destroy: "Détruire", ow: (d) => `Réécrire dans ${d}`, write: "Écrire D", reset: "Recommencer" },
};
const snState = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-snaps]");
    const rows = Object.fromEntries(
      [...f.querySelectorAll(".ds")].map((d) => [
        d.dataset.ds,
        {
          prev: d.querySelector(".meta strong").textContent,
          tree: [...d.querySelectorAll(".tree .chip")].map((c) => c.textContent).join(" "),
          dl: [...d.querySelectorAll(".entry")].map((e) => e.querySelector(".key").textContent.replace(/\s/g, "") + ":" + [...e.querySelectorAll(".chip")].map((c) => c.textContent).join(",")).join(" "),
        },
      ]),
    );
    return { txg: f.querySelector("[data-txg]").textContent, rows, freed: [...f.querySelectorAll(".freed .chip")].map((c) => c.textContent).join(" "), log: [...f.querySelectorAll("[data-log] li")].map((l) => l.textContent.trim().replace(/\s+/g, " ").replace(/ code$/, "")), owner: f.querySelector("[data-owner]").textContent.trim().replace(/\s+/g, " ") };
  });
const chipIn = (fig, ds, name) => fig.locator(`.ds[data-ds="${ds}"] .tree button.chip`).filter({ hasText: new RegExp(`^${name}$`) });
report.snapshots = {};
for (const lang of ["en", "fr"]) {
  const L = SNL[lang];
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], SN[lang]);
    const fig = page.locator("[data-snaps]");
    const b = (name) => fig.getByRole("button", { name, exact: typeof name === "string" });
    const shot = async (name) => {
      await page.waitForTimeout(900);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const r = { opening: await snState(page) };
    // Txg 11: write D and take a snapshot in the same txg.
    await b(L.write).click();
    await b(L.snap).click();
    await b(L.sync).click();
    r.sameTxg = await snState(page);
    await shot(`snapshots-${lang}-${vp}-same-txg.png`);
    // Txg 12: overwrite D; D11 is born in the txg of @s2: deadlist, not free.
    await chipIn(fig, "fs", "D11").click();
    await b(L.ow("fs")).click();
    await b(L.sync).click();
    r.overwriteD = await snState(page);
    await chipIn(fig, "s2", "D11").click();
    r.ownerD11 = (await snState(page)).owner;
    await shot(`snapshots-${lang}-${vp}-owner.png`);
    // Txg 13: clone @s1. Txg 14: overwrite B in the clone.
    await fig.locator('.ds[data-ds="s1"]').getByRole("button", { name: L.clone, exact: true }).click();
    await b(L.sync).click();
    await chipIn(fig, "clone", "B8").click();
    await b(L.ow("clone")).click();
    await b(L.sync).click();
    r.cloneOverwrite = await snState(page);
    await shot(`snapshots-${lang}-${vp}-clone.png`);
    // Txg 15: destroy @s2 (not a branch point).
    await fig.locator('.ds[data-ds="s2"]').getByRole("button", { name: L.destroy, exact: true }).click();
    await b(L.sync).click();
    r.destroy = await snState(page);
    await shot(`snapshots-${lang}-${vp}-destroy.png`);
    report.snapshots[`${lang}-${vp}`] = r;
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, SN.en);
  const fig = page.locator("[data-snaps]");
  await chipIn(fig, "fs", "B8").click();
  await fig.getByRole("button", { name: "Overwrite in fs", exact: true }).click();
  await fig.getByRole("button", { name: "Snapshot fs", exact: true }).click();
  const t0 = Date.now();
  await fig.getByRole("button", { name: /^Sync txg/ }).click();
  await page.waitForFunction(() => document.querySelector("[data-snaps] [data-log] li.synced"));
  report.reducedMotion.snapshots = { syncMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "snapshots-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("snapshots-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + SN.en);
  report.snapshots.noJs = await page.evaluate(() => ({
    datasets: [...document.querySelectorAll("[data-snaps] .ds")].map((d) => d.dataset.ds),
    chips: document.querySelectorAll("[data-snaps] .board .chip").length,
    barHidden: document.querySelector(".sn-bar").hidden,
    textVersion: document.querySelector("[data-snaps] [data-describe]").textContent.trim().slice(0, 80),
  }));
  await page.screenshot({ path: join(out, "snapshots-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("snapshots-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, SN[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + (el.dataset?.b ?? "") + (el.dataset?.at ?? "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Drive the figure with the keyboard alone: Write D, snapshot, sync, select D, overwrite, sync.
  await page.goto(base + SN[lang]);
  const L = SNL[lang];
  async function tabTo(pred, arg) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(pred, arg)) return true;
    }
    return false;
  }
  const pText = (a) => !!document.activeElement?.closest?.("[data-snaps]") && document.activeElement.textContent.trim() === a;
  const pSync = () => !!document.activeElement?.closest?.("[data-snaps]") && document.activeElement.dataset.act === "sync";
  const pChip = (a) => !!document.activeElement?.closest?.("[data-snaps]") && document.activeElement.dataset.at === "tree:fs" && document.activeElement.textContent === a;
  const drive = {};
  drive.write = await tabTo(pText, L.write);
  await page.keyboard.press("Enter");
  drive.snap = await tabTo(pText, L.snap);
  await page.keyboard.press("Enter");
  drive.sync = await tabTo(pSync);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("[data-snaps] [data-log] li.synced"));
  drive.chip = await tabTo(pChip, "D11");
  await page.keyboard.press("Enter");
  drive.overwrite = await tabTo(pText, L.ow("fs"));
  await page.keyboard.press("Enter");
  drive.sync2 = await tabTo(pSync);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll("[data-snaps] [data-log] li.dead").length > 0);
  drive.state = await snState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "snapshots-en-desktop-keyboard.png") });
    report.captures.push("snapshots-en-desktop-keyboard.png");
  }
  report.keyboard[`snapshots-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive };
  await ctx.close();
}

// The ARC room: the hand-checked sequence of ANALYSIS.md replayed in the page,
// each state read back from the DOM and compared with the model (src/lib/arc.ts).
const ARC = PAGES.find((p) => p.id === "arc");
const ARL = {
  en: { scan: "Scan 12 new blocks", new: "Read a new block", hot: "Read the hot set again", reset: "Start again", ms10: "10 ms", s1: "1 s" },
  fr: { scan: "Parcourir 12 nouveaux blocs", new: "Lire un nouveau bloc", hot: "Relire l’ensemble chaud", reset: "Recommencer", ms10: "10 ms", s1: "1 s" },
};
const arcState = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-arc]");
    const list = (st) => [...f.querySelectorAll(`.list[data-st="${st}"] .chip`)].map((c) => c.textContent).join(" ");
    return {
      mru: list("mru"),
      mfu: list("mfu"),
      mru_ghost: list("mru_ghost"),
      mfu_ghost: list("mfu_ghost"),
      gone: [...f.querySelectorAll(".list.gone .chip")].map((c) => c.textContent).join(" "),
      balance: f.querySelector("[data-balance]").textContent,
      log: [...f.querySelectorAll("[data-log] li")].map((l) => l.textContent.trim().replace(/\s+/g, " ")),
    };
  });
const arcExpected = () => {
  // The same actions on the model: one second before each action, 10 ms where the page uses it.
  const m = arcModel.opening();
  const L = (s) => ({ mru: s.lists.mru.join(" "), mfu: s.lists.mfu.join(" "), mru_ghost: s.lists.mru_ghost.join(" "), mfu_ghost: s.lists.mfu_ghost.join(" "), gone: s.forgotten.join(" "), pd: arcModel.pct(s.pd) });
  const out = { opening: L(m) };
  const step = (k, gap, ids) => { m.now += gap; ids.length === 1 ? arcModel.read(m, ids[0]) : arcModel.readAll(m, ids); out[k] = L(m); };
  step("scan", 1000, arcModel.next(m, "S", 12));
  step("s2", 1000, ["S2"]);
  step("s12", 1000, ["S12"]);
  step("s11", 1000, ["S11"]);
  step("s10", 1000, ["S10"]);
  step("n1", 1000, arcModel.next(m, "N"));
  step("h1", 1000, ["H1"]);
  step("n2", 1000, arcModel.next(m, "N"));
  step("n2at10", 10, ["N2"]);
  step("n2at20", 10, ["N2"]);
  step("n2later", 1000, ["N2"]);
  return out;
};
report.arc = { expected: arcExpected(), runs: {}, mismatches: [] };
const sameLists = (got, want, where) => {
  for (const k of ["mru", "mfu", "mru_ghost", "mfu_ghost", "gone"]) if (got[k] !== want[k]) report.arc.mismatches.push({ where, k, got: got[k], want: want[k] });
  const pd = Number(got.balance.match(/arc_pd ([\d.,]+)/)[1].replace(",", "."));
  if (Math.abs(pd - want.pd) > 0.05) report.arc.mismatches.push({ where, k: "pd", got: pd, want: want.pd });
};
for (const lang of ["en", "fr"]) {
  const L = ARL[lang];
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], ARC[lang]);
    const fig = page.locator("[data-arc]");
    const b = (name) => fig.getByRole("button", { name, exact: true });
    const chip = (id) => fig.locator(`button.chip[data-id="${id}"]`);
    const shot = async (name) => {
      await page.waitForTimeout(800);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const exp = report.arc.expected;
    const r = {};
    const check = async (k) => {
      await page.waitForTimeout(150);
      r[k] = await arcState(page);
      sameLists(r[k], exp[k], `${lang}-${vp}-${k}`);
    };
    await check("opening");
    await b(L.scan).click();
    await check("scan");
    await shot(`arc-${lang}-${vp}-scan.png`);
    await chip("S2").click();
    await check("s2");
    await shot(`arc-${lang}-${vp}-mru-ghost-hit.png`);
    for (const id of ["S12", "S11", "S10"]) {
      await chip(id).click();
      await check(id.toLowerCase());
    }
    await b(L.new).click();
    await check("n1");
    await chip("H1").click();
    await check("h1");
    await shot(`arc-${lang}-${vp}-mfu-ghost-hit.png`);
    await b(L.new).click();
    await check("n2");
    await fig.getByLabel(L.ms10).check();
    await chip("N2").click();
    await check("n2at10");
    await chip("N2").click();
    await check("n2at20");
    await shot(`arc-${lang}-${vp}-mintime.png`);
    await fig.getByLabel(L.s1).check();
    await chip("N2").click();
    await check("n2later");
    report.arc.runs[`${lang}-${vp}`] = { s2: r.s2.log, h1: r.h1.log, n2at10: r.n2at10.log, n2later: r.n2later.log };
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, ARC.en);
  const fig = page.locator("[data-arc]");
  const t0 = Date.now();
  await fig.getByRole("button", { name: "Scan 12 new blocks", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-arc] [data-log] li").length >= 16);
  report.reducedMotion.arc = { scanMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "arc-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("arc-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + ARC.en);
  report.arc.noJs = await page.evaluate(() => ({
    mfu: [...document.querySelectorAll('[data-arc] .list[data-st="mfu"] .chip')].map((c) => c.textContent).join(" "),
    balance: document.querySelector("[data-arc] [data-balance]").textContent,
    barHidden: document.querySelector(".arc-bar").hidden,
    textVersion: document.querySelector("[data-arc] [data-describe]").textContent.trim().replace(/\s+/g, " ").slice(0, 120),
  }));
  await page.screenshot({ path: join(out, "arc-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("arc-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, ARC[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || el.value || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + (el.dataset?.id ?? "") + "|" + (el.value ?? "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Drive the figure with the keyboard alone: scan, read S2 (ghost hit), switch to 10 ms, read a new block twice.
  await page.goto(base + ARC[lang]);
  const L = ARL[lang];
  async function tabTo(pred, arg) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(pred, arg)) return true;
    }
    return false;
  }
  const pText = (a) => !!document.activeElement?.closest?.("[data-arc]") && document.activeElement.textContent.trim() === a;
  const pChip = (a) => !!document.activeElement?.closest?.("[data-arc]") && document.activeElement.dataset.id === a;
  const pRadio = () => document.activeElement?.type === "radio";
  const drive = {};
  drive.scan = await tabTo(pText, L.scan);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  drive.s2 = await tabTo(pChip, "S2");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  drive.newBlock = await tabTo(pText, L.new);
  await page.keyboard.press("Enter");
  drive.radio = await tabTo(pRadio);
  await page.keyboard.press("ArrowRight"); // 1 s -> 10 ms
  drive.gap = await page.evaluate(() => document.activeElement.value);
  drive.n1 = await tabTo(pChip, "N1");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  drive.state = await arcState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "arc-en-desktop-keyboard.png") });
    report.captures.push("arc-en-desktop-keyboard.png");
  }
  report.keyboard[`arc-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive: { ...drive, state: { mru: drive.state.mru, mfu: drive.state.mfu, mru_ghost: drive.state.mru_ghost, balance: drive.state.balance, last: drive.state.log.at(-1) } } };
  await ctx.close();
}

// The Metaslabs and space maps room: QA's sequences (a write then a delete, a
// two-word entry, a load, a condense refused then accepted) replayed in the
// page; every word drawn on the tape is compared with the model's
// (src/lib/metaslab.ts), and the log is read back.
const MSR = PAGES.find((p) => p.id === "metaslabs");
const MSL = {
  en: { sync: /^Sync txg/, mib160: "160 MiB", load: "Load", condense: "Condense", rewrite: "Rewrite db, up to 40 txgs", del: (id) => `Delete file ${id}`, refused: /Condense refused/, condensed: /says yes: sync of txg \d+ condenses first/, same: /the same tree as before/ },
  fr: { sync: /^Synchroniser le txg/, mib160: "160 Mio", load: "Charger", condense: "Condenser", rewrite: "Réécrire db, jusqu’à 40 txg", del: (id) => `Supprimer le fichier ${id}`, refused: /Condensation refusée/, condensed: /dit oui : la synchronisation du txg \d+ condense d’abord/, same: /le même arbre qu’avant/ },
};
const msState = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-msl]");
    return {
      cells: [...f.querySelectorAll("[data-e]")].map((c) => [Number(c.dataset.e), c.dataset.w]),
      log: [...f.querySelectorAll("[data-log] li")].map((l) => l.textContent.trim().replace(/\s+/g, " ")),
      check: f.querySelector("[data-check] .verdict").textContent.trim().replace(/\s+/g, " "),
    };
  });
report.metaslabs = { runs: {}, mismatches: [] };
const msSame = (got, m, where) => {
  const want = new Map(m.tape.map((e, i) => [i, e.words.map(msModel.hex).join(" ")]));
  if (!got.cells.length && m.tape.length) report.metaslabs.mismatches.push({ where, k: "empty tape" });
  for (const [i, w] of got.cells) if (want.get(i) !== w) report.metaslabs.mismatches.push({ where, i, got: w, want: want.get(i) });
};
for (const lang of ["en", "fr"]) {
  const L = MSL[lang];
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], MSR[lang]);
    const fig = page.locator("[data-msl]");
    const b = (name) => fig.getByRole("button", { name, exact: true });
    const sync = () => fig.getByRole("button", { name: L.sync }).click();
    const shot = async (name) => {
      await page.waitForTimeout(900);
      await fig.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    const m = msModel.opening();
    const r = {};
    const check = async (k, pause = 200) => {
      await page.waitForTimeout(pause);
      r[k] = await msState(page);
      msSame(r[k], m, `${lang}-${vp}-${k}`);
    };
    await check("opening");
    await b(L.del("A")).click(); msModel.del(m, "A");
    await sync(); msModel.sync(m);
    await check("deleteA");
    await shot(`metaslabs-${lang}-${vp}-delete.png`);
    for (let i = 0; i < 2; i++) { await sync(); msModel.sync(m); }
    await b(L.mib160).click(); msModel.write(m, 160 * msModel.MIB);
    await sync(); msModel.sync(m);
    await check("twoWord");
    await fig.locator(`[data-e="${m.tape.length - 1}"]`).click();
    await shot(`metaslabs-${lang}-${vp}-two-word.png`);
    await b(L.del("C")).click(); msModel.del(m, "C");
    await sync(); msModel.sync(m);
    await b(L.condense).click(); msModel.condenseNow(m);
    await check("refused");
    if (!L.refused.test(r.refused.log.join(" "))) report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "no refusal", log: r.refused.log });
    await shot(`metaslabs-${lang}-${vp}-condense-refused.png`);
    await b(L.load).click(); msModel.load(m);
    await check("load", 3500);
    if (!L.same.test(r.load.log.join(" "))) report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "load", log: r.load.log });
    let stopped = false;
    for (let i = 0; i < 4 && !stopped; i++) {
      await b(L.rewrite).click();
      stopped = msModel.churn(m).some((e) => e.k === "churn" && e.stopped);
    }
    await check("beforeCondense", 1500);
    await b(L.condense).click(); msModel.condenseNow(m);
    await check("condensed", 1500);
    if (!L.condensed.test(r.condensed.log.join(" "))) report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "no condense", log: r.condensed.log });
    await shot(`metaslabs-${lang}-${vp}-condensed.png`);
    await b(L.load).click(); msModel.load(m);
    await check("loadAfter", 3500);
    if (!L.same.test(r.loadAfter.log.join(" "))) report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "load after condense", log: r.loadAfter.log });
    report.metaslabs.runs[`${lang}-${vp}`] = { deleteA: r.deleteA.cells.slice(-2), twoWord: r.twoWord.cells.slice(-2), refused: r.refused.log, load: r.load.log, condensed: r.condensed.log.slice(0, 2), condensedHead: r.condensed.cells.slice(0, 3), loadAfter: r.loadAfter.log };
    await ctx.close();
  }
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, MSR.en);
  const fig = page.locator("[data-msl]");
  const t0 = Date.now();
  await fig.getByRole("button", { name: "Load", exact: true }).click();
  await page.waitForFunction(() => /same tree/.test(document.querySelector("[data-msl] [data-log]").textContent));
  report.reducedMotion.metaslabs = { loadMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "metaslabs-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("metaslabs-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + MSR.en);
  report.metaslabs.noJs = await page.evaluate(() => ({
    words: [...document.querySelectorAll("[data-msl] [data-e]")].map((c) => c.dataset.w),
    bits: document.querySelector("[data-msl] [data-bits] h4")?.textContent,
    barHidden: document.querySelector(".msl-bar").hidden,
    textVersion: document.querySelector("[data-msl] [data-describe]").textContent.trim().replace(/\s+/g, " ").slice(0, 120),
  }));
  await page.screenshot({ path: join(out, "metaslabs-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("metaslabs-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, MSR[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + (el.dataset?.e ?? "") + "|" + (el.dataset?.act ?? "") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Keyboard alone: delete A, sync, select the new FREE entry, step left along the tape with an arrow.
  await page.goto(base + MSR[lang]);
  async function tabTo(pred, arg) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate(pred, arg)) return true;
    }
    return false;
  }
  const pDel = (a) => document.activeElement?.dataset?.del === a;
  const pAct = (a) => document.activeElement?.dataset?.act === a;
  const pEntry = () => !!document.activeElement?.dataset?.e;
  const drive = {};
  drive.del = await tabTo(pDel, "A");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  await page.keyboard.press("Shift+Tab");
  drive.sync = await tabTo(pAct, "sync");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  drive.entry = await tabTo(pEntry);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  drive.at = await page.evaluate(() => document.activeElement.dataset.e);
  await page.keyboard.press("ArrowLeft");
  drive.left = await page.evaluate(() => ({ e: document.activeElement.dataset.e, pressed: document.activeElement.getAttribute("aria-pressed"), bits: document.querySelector("[data-msl] [data-bits] h4").textContent }));
  drive.state = await msState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "metaslabs-en-desktop-keyboard.png") });
    report.captures.push("metaslabs-en-desktop-keyboard.png");
  }
  report.keyboard[`metaslabs-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive: { ...drive, state: { cells: drive.state.cells.length, last: drive.state.log.at(-1) } } };
  await ctx.close();
}

// The ZIL and SLOG room: QA's sequences (a small sync write without SLOG, a
// large write with and without SLOG, logbias=throughput, a crash before the
// txg sync then replay, a crash after it, a write never fsynced) replayed in
// the page, with motion, against the model (src/lib/zil.ts): every write's
// state and status, the header and the chain drawn after each step must be the
// model's. Then the decision panel for every combination of the buttons.
const ZR = PAGES.find((p) => p.id === "zil");
const ZL = {
  en: { waits: /waits for txg 100 to sync/, viaSync: /through the txg sync that creating the log forced/, claim0yes: /0 records\. ZIL_REPLAY_NEEDED: yes/, returns: /fsync\(\) returns/, wreturns: /write\(\) returns/, claim1: /1 record\. ZIL_REPLAY_NEEDED: yes/, claim0: /0 records\. ZIL_REPLAY_NEEDED: no/, replay: /Replay #1/, lost: /neither synced nor logged: 1 write/ },
  fr: { waits: /attend la synchronisation du txg 100/, viaSync: /par la synchronisation de txg que la création du journal a imposée/, claim0yes: /0 enregistrement\. ZIL_REPLAY_NEEDED : oui/, returns: /fsync\(\) rend la main/, wreturns: /write\(\) rend la main/, claim1: /1 enregistrement\. ZIL_REPLAY_NEEDED : oui/, claim0: /0 enregistrement\. ZIL_REPLAY_NEEDED : non/, replay: /Rejeu #1/, lost: /ni synchronisé ni journalisé : 1 écriture/ },
};
const zilState = (page) =>
  page.evaluate(() => {
    const f = document.querySelector("[data-zl]");
    return {
      writes: [...f.querySelectorAll(".writes .w")].map((w) => [w.querySelector(".wr").textContent, [...w.classList].find((c) => c !== "w")]),
      header: [...f.querySelectorAll(".hdr dd")].map((d) => d.textContent.trim()),
      chain: [...f.querySelectorAll(".chain .blk")].map((b) => [b.querySelector(".bid").textContent, [...b.classList].find((c) => c !== "blk")]),
      data: f.querySelectorAll(".cell.data").length,
      log: [...f.querySelectorAll("[data-log] li")].map((l) => l.textContent.trim().replace(/\s+/g, " ")).join(" | "),
    };
  });
const zilWant = (m) => ({
  writes: m.writes.map((w) => [w.state, w.status]),
  header: [m.header.log === null ? null : `b${m.header.log}`, String(m.header.claimTxg), m.header.replayNeeded ? "ZIL_REPLAY_NEEDED" : "0", String(m.header.replaySeq)],
  chain: m.phase !== "running" ? m.disk.map((d) => [`b${d.blk.id}`, d.written ? "written" : "end"])
    : m.kept && !m.lwbs.length ? [[`b${m.kept.id}`, "end"]]
    : m.lwbs.filter((l) => l.blk).map((l) => [`b${l.blk.id}`, l.state === "FLUSH_DONE" ? "written" : "end"]),
  data: m.inPlace.length,
});
report.zil = { runs: {}, mismatches: [], decision: {} };
// "write", "fsync" first creates the log (the first commit waits for txg 100 and logs nothing);
// QA's scenarios then run on the existing chain.
const PRIME = ["write", "fsync"];
const ZSEQ = [
  { id: "first-commit-crash", set: [], steps: ["write", "fsync", "crash", "import", "mount"], expect: ["waits", "viaSync", "claim0yes"] },
  { id: "small-crash", set: [], steps: [...PRIME, "write", "fsync", "crash", "import", "mount"], expect: ["returns", "claim1", "replay"] },
  { id: "sync-then-crash", set: [], steps: [...PRIME, "write", "fsync", "sync", "crash", "import", "mount"], expect: ["returns", "claim0"] },
  { id: "large-no-slog", set: ['[data-size="131072"]'], steps: [...PRIME, "write", "fsync", "crash", "import", "mount"], expect: ["returns", "claim1"] },
  { id: "large-slog", set: ['[data-pool="slog"]', '[data-size="131072"]'], steps: [...PRIME, "write", "fsync", "crash", "import", "mount"], expect: ["returns", "replay"] },
  { id: "throughput", set: ['[data-pool="slog"]', '[data-bias="throughput"]', '[data-flag="dsync"]'], steps: ["write", "write", "sync", "crash", "import", "mount"], expect: ["viaSync", "wreturns", "claim0"] },
  { id: "no-fsync", set: [], steps: ["write", "crash", "import", "mount"], expect: ["lost"] },
];
for (const lang of ["en", "fr"]) {
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], ZR[lang]);
    const fig = page.locator("[data-zl]");
    for (const sq of ZSEQ) {
      await fig.locator('[data-act="reset"]').click();
      const m = zilModel.empty();
      for (const sel of sq.set) {
        await fig.locator(sel).click();
        if (sel.includes("pool")) m.pool = { slog: sel.match(/"(\w+)"/)[1] };
        if (sel.includes("bias")) m.logbias = "throughput";
      }
      const size = sq.set.some((x) => x.includes("131072")) ? 131072 : 4096;
      const flags = { dsync: sq.set.some((x) => x.includes("dsync")), direct: false };
      const logs = [];
      for (const step of sq.steps) {
        await fig.locator(`[data-act="${step}"]`).click();
        await page.waitForFunction(() => !document.querySelector("[data-zl]").hasAttribute("data-busy"), null, { timeout: 60000 });
        ({ write: () => zilModel.write(m, size, flags), fsync: () => zilModel.fsync(m), sync: () => zilModel.sync(m), crash: () => zilModel.crash(m), import: () => zilModel.importPool(m), mount: () => zilModel.mount(m) })[step]();
        const got = await zilState(page);
        const want = zilWant(m);
        got.header[0] = /^b\d+$/.test(got.header[0]) ? got.header[0] : null;
        for (const k of ["writes", "header", "chain", "data"])
          if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) report.zil.mismatches.push({ where: `${lang}-${vp}-${sq.id}-${step}`, k, got: got[k], want: want[k] });
        logs.push(got.log);
        if (step === "fsync" || (step === "write" && flags.dsync) || step === "import") {
          await page.waitForTimeout(150);
          const name = `zil-${lang}-${vp}-${sq.id}-${step}.png`;
          await fig.screenshot({ path: join(out, name) });
          report.captures.push(name);
        }
      }
      const all = logs.join(" | ");
      for (const e of sq.expect) if (!ZL[lang][e].test(all)) report.zil.mismatches.push({ where: `${lang}-${vp}-${sq.id}`, k: `log ${e}`, log: all.slice(0, 400) });
      report.zil.runs[`${lang}-${vp}-${sq.id}`] = { writes: zilWant(m).writes, header: zilWant(m).header, steps: logs.length };
    }
    await ctx.close();
  }
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open({ ...VIEWPORTS.desktop, reducedMotion: "reduce" }, ZR[lang]);
  const fig = page.locator("[data-zl]");
  let n = 0;
  const bad = [];
  for (const slog of ["none", "slog", "full"])
    for (const bias of ["latency", "throughput"])
      for (const size of zilModel.SIZES)
        for (const dsync of [false, true])
          for (const direct of [false, true]) {
            await fig.locator(`[data-pool="${slog}"]`).click();
            await fig.locator(`[data-bias="${bias}"]`).click();
            await fig.locator(`[data-size="${size}"]`).click();
            for (const [k, v] of [["dsync", dsync], ["direct", direct]])
              if ((await fig.locator(`[data-flag="${k}"]`).getAttribute("aria-pressed")) !== String(v)) await fig.locator(`[data-flag="${k}"]`).click();
            const shown = await fig.locator("[data-decision] .verdict .wr").textContent();
            const m = zilModel.empty();
            m.pool = { slog };
            m.logbias = bias;
            const want = zilModel.logWrite(zilModel.stateInput(m, size, { dsync, direct }), 0)[0].state;
            n++;
            if (shown !== want) bad.push({ slog, bias, size, dsync, direct, shown, want });
          }
  report.zil.decision[lang] = { combinations: n, mismatches: bad };
  if (bad.length) report.zil.mismatches.push(...bad.map((b) => ({ where: `decision-${lang}`, ...b })));
  await ctx.close();
}
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, ZR.en);
  const fig = page.locator("[data-zl]");
  await fig.locator('[data-pool="slog"]').click();
  await fig.locator('[data-size="131072"]').click();
  await fig.locator('[data-act="write"]').click();
  const t0 = Date.now();
  await fig.locator('[data-act="fsync"]').click();
  await page.waitForFunction(() => /fsync\(\) returns/.test(document.querySelector("[data-zl] [data-log]").textContent));
  report.reducedMotion.zil = { fsyncMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "zil-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("zil-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + ZR.en);
  report.zil.noJs = await page.evaluate(() => ({
    decision: document.querySelector("[data-zl] [data-decision] .wr")?.textContent,
    reasons: document.querySelectorAll("[data-zl] .reasons li").length,
    barHidden: document.querySelector(".zl-bar").hidden,
    textVersion: document.querySelector("[data-zl] [data-describe]").textContent.trim().replace(/\s+/g, " ").slice(0, 120),
  }));
  await page.screenshot({ path: join(out, "zil-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("zil-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, ZR[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + Object.entries(el.dataset ?? {}).join(",") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  // Keyboard alone: SLOG, 128 KiB, write(), fsync(), power cut, import, mount; focus follows the next step.
  await page.goto(base + ZR[lang]);
  async function tabTo(sel) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return true;
    }
    return false;
  }
  const idle = () => page.waitForFunction(() => !document.querySelector("[data-zl]").hasAttribute("data-busy"), null, { timeout: 60000 });
  const drive = {};
  drive.slog = await tabTo('[data-pool="slog"]');
  await page.keyboard.press("Enter");
  drive.size = await tabTo('[data-size="131072"]');
  await page.keyboard.press("Enter");
  drive.write = await tabTo('[data-act="write"]');
  await page.keyboard.press("Enter");
  await idle();
  await page.keyboard.press("Tab");
  drive.fsyncFocused = await page.evaluate(() => document.activeElement?.dataset.act);
  await page.keyboard.press("Enter");
  await idle();
  drive.crash = await tabTo('[data-act="crash"]');
  await page.keyboard.press("Enter");
  await idle();
  drive.afterCrash = await page.evaluate(() => document.activeElement?.dataset.act);
  await page.keyboard.press("Enter");
  await idle();
  drive.afterImport = await page.evaluate(() => document.activeElement?.dataset.act);
  await page.keyboard.press("Enter");
  await idle();
  drive.afterMount = await page.evaluate(() => document.activeElement?.dataset.act);
  drive.state = await zilState(page);
  if (lang === "en") {
    await page.screenshot({ path: join(out, "zil-en-desktop-keyboard.png") });
    report.captures.push("zil-en-desktop-keyboard.png");
  }
  report.keyboard[`zil-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive: { ...drive, state: { writes: drive.state.writes, header: drive.state.header } } };
  await ctx.close();
}

// The send / receive room: QA's replays (a full stream, an incremental from
// the oldest and from the newest snapshot, a freed range giving FREE records,
// the received files compared with @s4) driven in the page; the records drawn
// in the strip, the counters and the verdict are compared with the model
// (src/lib/send.ts). Then motion (mid-play capture), a flipped bit, reduced
// motion, no JavaScript, keyboard only.
report.send = { runs: {}, mismatches: [] };
const SR = PAGES.find((p) => p.id === "send");
const srSnaps = sendModel.snapshots();
const srFroms = [null, ...srSnaps.slice(0, 3)];
const srWant = (i) => {
  const snd = sendModel.send(srSnaps[3], srFroms[i]);
  return { types: snd.records.map((r) => r.type), visited: snd.visited, records: snd.records.length, frees: snd.records.filter((r) => r.type === "FREE").length };
};
async function srRead(page) {
  return page.evaluate(() => {
    const f = document.querySelector("[data-send]");
    return {
      types: [...f.querySelectorAll("[data-strip] .rec .ty")].map((x) => x.textContent),
      done: f.querySelectorAll("[data-strip] .rec.done").length,
      visited: Number(f.querySelector("[data-counters] b")?.textContent.replace(/\D/g, "")),
      verdict: f.querySelector("[data-receiver] .verdict")?.className ?? null,
      verdictText: f.querySelector("[data-receiver] .verdict")?.textContent ?? null,
    };
  });
}
for (const lang of ["en", "fr"])
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], SR[lang]);
    const fig = page.locator("[data-send]");
    for (const i of [0, 1, 3, 2]) {
      await fig.locator(`button[data-from="${i}"]`).click();
      const got = await srRead(page);
      const want = srWant(i);
      const ok = JSON.stringify(got.types) === JSON.stringify(want.types) && got.visited === want.visited && got.done === want.records && /\bok\b/.test(got.verdict ?? "");
      report.send.runs[`${lang}-${vp}-from${i}`] = { visited: got.visited, records: got.types.length, frees: got.types.filter((t) => t === "FREE").length, verdict: got.verdictText };
      if (!ok) report.send.mismatches.push({ where: `${lang}-${vp}-from${i}`, got, want });
    }
    if (vp === "desktop" || lang === "en") {
      // Mid-play: from @s1, a few steps in.
      await fig.locator('button[data-from="1"]').click();
      await fig.locator('[data-act="restart"]').click();
      for (let k = 0; k < 9; k++) await fig.locator('[data-act="step"]').click();
      await page.waitForTimeout(500);
      await fig.screenshot({ path: join(out, `send-${lang}-${vp}-step9.png`) });
      report.captures.push(`send-${lang}-${vp}-step9.png`);
      await fig.locator('[data-act="play"]').click();
      await page.waitForFunction(() => document.querySelector("[data-send] [data-receiver] .verdict"), null, { timeout: 60000 });
      await page.waitForTimeout(400);
      // A flipped bit on the full stream.
      await fig.locator('button[data-from="0"]').click();
      await fig.locator("[data-flip]").click();
      const flipped = await srRead(page);
      report.send.runs[`${lang}-${vp}-flip`] = { verdict: flipped.verdict, text: flipped.verdictText, bad: await page.evaluate(() => document.querySelector("[data-send] .rec.bad")?.dataset.rec) };
      if (!/bad/.test(flipped.verdict ?? "")) report.send.mismatches.push({ where: `${lang}-${vp}-flip`, flipped });
      await fig.screenshot({ path: join(out, `send-${lang}-${vp}-flip.png`) });
      report.captures.push(`send-${lang}-${vp}-flip.png`);
    }
    await ctx.close();
  }
{
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, SR.en);
  const fig = page.locator("[data-send]");
  await fig.locator('[data-act="restart"]').click();
  const t0 = Date.now();
  await fig.locator('[data-act="play"]').click();
  await page.waitForFunction(() => document.querySelector("[data-send] [data-receiver] .verdict"));
  report.reducedMotion.send = { playMs: Date.now() - t0, running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  await page.screenshot({ path: join(out, "send-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("send-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + SR.en);
  report.send.noJs = await page.evaluate(() => ({
    records: document.querySelectorAll("[data-send] [data-strip] .rec").length,
    verdict: document.querySelector("[data-send] .verdict")?.textContent,
    barHidden: document.querySelector(".sr-bar").hidden,
    tableRows: document.querySelectorAll("[data-send] .cmp-table tbody tr").length,
  }));
  await page.screenshot({ path: join(out, "send-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("send-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, SR[lang]);
  const stops = [];
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + Object.entries(el.dataset ?? {}).join(",") + "|" + el.textContent,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  await page.goto(base + SR[lang]);
  async function tabTo(sel) {
    for (let i = 0; i < 300; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return true;
    }
    return false;
  }
  const drive = {};
  drive.from3 = await tabTo('button[data-from="3"]');
  await page.keyboard.press("Enter");
  drive.restart = await tabTo('[data-act="restart"]');
  await page.keyboard.press("Enter");
  drive.step = await tabTo('[data-act="step"]');
  for (let k = 0; k < 60 && !(await page.evaluate(() => document.querySelector("[data-send] [data-receiver] .verdict"))); k++) await page.keyboard.press("Enter");
  drive.focusKept = await page.evaluate(() => document.activeElement?.dataset.act === "step");
  drive.state = await srRead(page);
  drive.ok = drive.focusKept && JSON.stringify(drive.state.types) === JSON.stringify(srWant(3).types) && /\bok\b/.test(drive.state.verdict ?? "");
  if (!drive.ok) report.send.mismatches.push({ where: `keyboard-${lang}`, drive });
  if (lang === "en") {
    await page.screenshot({ path: join(out, "send-en-desktop-keyboard.png") });
    report.captures.push("send-en-desktop-keyboard.png");
  }
  report.keyboard[`send-${lang}`] = { stops: stops.length, withoutVisibleFocus: stops.filter((s) => !s.ok).map((s) => s.label), drive: { from3: drive.from3, restart: drive.restart, step: drive.step, focusKept: drive.focusKept, ok: drive.ok, verdict: drive.state.verdictText } };
  await ctx.close();
}

// The compression, dedup and encryption room: QA's replays, each checked
// against the model (src/lib/transforms.ts): compressible, incompressible,
// all-zero and embeddable blocks at ashift 9 and 12; a dedup miss, a hit, then
// over quota; the encrypted block pointer, the key unloaded, scrub and read.
// Then reduced motion, no JavaScript, and a keyboard-only walk.
report.transforms = { runs: {}, mismatches: [] };
const TR = PAGES.find((p) => p.id === "transforms");
const TRL = {
  en: { comp: "Compressible", rnd: "Already compressed", zero: "All zeros", tiny: "Almost empty", quota: "Dedup table over its quota", key: "Key loaded", scrub: "Scrub", read: "Read the file", enc: "an encrypted data block", flip: "Flip a bit in data block 1 on disk" },
  fr: { comp: "Compressibles", rnd: "Déjà compressées", zero: "Que des zéros", tiny: "Presque vides", quota: "Table de déduplication au-dessus de son quota", key: "Clé chargée", scrub: "Scrub", read: "Lire le fichier", enc: "d’un bloc de données chiffré", flip: "Inverser un bit du bloc de données 1 sur disque" },
};
const TR_OUT = { text: (l) => Math.round(l * 0.38), random: (l) => l + 64, tiny: () => 90 };
const trRead = (page) => page.evaluate(() => {
  const c = document.querySelector("[data-compress]");
  const d = document.querySelector("[data-dedup]");
  const e = document.querySelector("[data-crypt]");
  return {
    taken: c.querySelector("[data-path] li.taken")?.dataset.i,
    outcome: c.querySelector("[data-result] .outcome")?.className.replace("outcome ", ""),
    ashiftRow: c.querySelector("[data-table] tr.cur th")?.textContent,
    sectors: c.querySelectorAll("[data-bars] .sec").length,
    entries: [...d.querySelectorAll(".ddt tbody tr")].map((tr) => [tr.children[1].textContent, Number(tr.children[2].textContent)]),
    bps: [...d.querySelectorAll(".bps li")].map((li) => [li.querySelector(".ct").textContent, li.querySelector(".dbit").textContent, li.querySelector("code").textContent]),
    disk: d.querySelectorAll(".disk li").length,
    diff: [...e.querySelectorAll("[data-words] tr.diff th")].map((th) => th.textContent),
    scrub: [...e.querySelectorAll("[data-file] .sc")].map((x) => x.classList.contains("ok")),
    readout: e.querySelector("[data-file] .readout")?.textContent ?? "",
    plainShown: e.querySelectorAll("[data-file] .plain").length,
    live: [...document.querySelectorAll("[aria-live]")].map((x) => x.textContent.trim()).filter(Boolean),
  };
});
for (const lang of ["en", "fr"])
  for (const vp of ["iphone", "desktop"]) {
    const { ctx, page } = await open(VIEWPORTS[vp], TR[lang]);
    const L = TRL[lang];
    const cl = page.locator("[data-compress]");
    const shot = async (loc, name) => {
      await page.waitForTimeout(1300);
      await loc.screenshot({ path: join(out, name) });
      report.captures.push(name);
    };
    // Compression: four data at two ashifts, each against the model.
    for (const [lsize, ashift] of [[131072, 12], [131072, 9], [4096, 12], [4096, 9]]) {
      await cl.locator(`button[data-lsize="${lsize}"]`).click();
      await cl.locator(`button[data-ashift="${ashift}"]`).click();
      for (const [preset, name] of [["text", L.comp], ["random", L.rnd], ["zero", L.zero], ["tiny", L.tiny]]) {
        await cl.getByRole("button", { name, exact: true }).click();
        const got = await trRead(page);
        const want = trModel.compress({ lsize, ashift, algo: "lz4", zero: preset === "zero", out: preset === "zero" ? 0 : TR_OUT[preset](lsize) });
        const k = `${lang}-${vp}-${lsize}-a${ashift}-${preset}`;
        report.transforms.runs[k] = { outcome: got.outcome, sectors: got.sectors };
        if (got.outcome !== want.outcome || got.sectors !== want.sectors) report.transforms.mismatches.push({ where: k, got, want: { outcome: want.outcome, sectors: want.sectors } });
      }
    }
    await cl.locator('button[data-lsize="4096"]').click();
    await cl.locator('button[data-ashift="12"]').click();
    await cl.getByRole("button", { name: L.tiny, exact: true }).click();
    await shot(cl, `transforms-${lang}-${vp}-embedded.png`);
    await cl.locator('button[data-lsize="131072"]').click();
    await cl.getByRole("button", { name: L.comp, exact: true }).click();
    await shot(cl, `transforms-${lang}-${vp}-compressed.png`);
    // Dedup: start again, A (miss), A (hit), then over quota: C, A, C.
    const dd = page.locator("[data-dedup]");
    await dd.locator('[data-act="restart"]').click();
    for (const c of ["A", "A"]) await dd.locator(`button[data-write="${c}"]`).click();
    await dd.getByRole("button", { name: L.quota }).click();
    for (const c of ["C", "A", "C"]) await dd.locator(`button[data-write="${c}"]`).click();
    {
      const got = await trRead(page);
      let m = trModel.dedupStart();
      for (const [c, q] of [["A", false], ["A", false], ["C", true], ["A", true], ["C", true]]) m = trModel.dedupWrite(m, c, q);
      const want = { entries: m.entries.map((e) => [e.content, e.refcnt]), bps: m.bps.map((b) => [b.content, `D=${b.dedup ? 1 : 0}`, b.dva]), disk: m.disk.length };
      report.transforms.runs[`${lang}-${vp}-dedup`] = { entries: got.entries, disk: got.disk };
      if (JSON.stringify([got.entries, got.bps, got.disk]) !== JSON.stringify([want.entries, want.bps, want.disk])) report.transforms.mismatches.push({ where: `${lang}-${vp}-dedup`, got, want });
    }
    await shot(dd, `transforms-${lang}-${vp}-dedup.png`);
    // Encryption: the encrypted bp, the key unloaded, scrub, read; then a flipped bit.
    const cr = page.locator("[data-crypt]");
    await cr.getByRole("button", { name: L.enc }).click();
    await cr.getByRole("button", { name: L.key }).click();
    await cr.getByRole("button", { name: L.scrub, exact: true }).click();
    const s1 = await trRead(page);
    await cr.getByRole("button", { name: L.read }).click();
    const s2 = await trRead(page);
    report.transforms.runs[`${lang}-${vp}-nokey`] = { diff: s1.diff, scrub: s1.scrub, readout: s2.readout, plainShown: s2.plainShown };
    if (s1.diff.join() !== "4,5,b,e,f" || !s1.scrub.every(Boolean) || s1.scrub.length !== 5 || !/EACCES/.test(s2.readout) || s2.plainShown !== 0)
      report.transforms.mismatches.push({ where: `${lang}-${vp}-nokey`, s1, s2 });
    await shot(cr, `transforms-${lang}-${vp}-nokey.png`);
    await cr.getByRole("button", { name: L.flip }).click();
    await cr.getByRole("button", { name: L.scrub, exact: true }).click();
    const s3 = await trRead(page);
    report.transforms.runs[`${lang}-${vp}-flip`] = { scrub: s3.scrub };
    if (JSON.stringify(s3.scrub) !== JSON.stringify([true, true, true, false, true])) report.transforms.mismatches.push({ where: `${lang}-${vp}-flip`, s3 });
    await ctx.close();
  }
{
  // Reduced motion: no animation runs after an action.
  const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, TR.en);
  await page.locator("[data-compress]").getByRole("button", { name: "All zeros" }).click();
  await page.locator('[data-dedup] button[data-write="B"]').click();
  await page.locator("[data-crypt]").getByRole("button", { name: "an indirect block" }).click();
  report.reducedMotion.transforms = { running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length) };
  if (report.reducedMotion.transforms.running) report.transforms.mismatches.push({ where: "reduced-motion", running: report.reducedMotion.transforms.running });
  await page.screenshot({ path: join(out, "transforms-en-iphone-reduced-motion.png"), fullPage: true });
  report.captures.push("transforms-en-iphone-reduced-motion.png");
  await ctx.close();
}
{
  const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(base + TR.en);
  report.transforms.noJs = await page.evaluate(() => ({
    compress: document.querySelector("[data-compress] [data-result] .outcome")?.textContent?.slice(0, 40),
    ddtRows: document.querySelectorAll("[data-dedup] .ddt tbody tr").length,
    words: document.querySelectorAll("[data-crypt] [data-words] tbody tr").length,
    barsHidden: [...document.querySelectorAll(".cl-bar, [data-dedup] .tr-bar, [data-crypt] .tr-bar")].every((b) => b.hidden),
  }));
  const nj = report.transforms.noJs;
  if (!nj.barsHidden || nj.ddtRows !== 2 || nj.words !== 16 || !nj.compress) report.transforms.mismatches.push({ where: "nojs", nj });
  await page.screenshot({ path: join(out, "transforms-en-iphone-nojs.png"), fullPage: true });
  report.captures.push("transforms-en-iphone-nojs.png");
  await ctx.close();
}
for (const lang of ["en", "fr"]) {
  const { ctx, page } = await open(VIEWPORTS.desktop, TR[lang]);
  const stops = [];
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return {
        label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
        ok: el.matches(":focus-visible") && cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
        key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + Object.entries(el.dataset ?? {}).join(",") + "|" + el.textContent + "|" + el.id,
      };
    });
    if (!info) continue;
    if (stops.length && info.key === stops[0].key) break;
    stops.push(info);
  }
  await page.goto(base + TR[lang]);
  async function tabTo(sel) {
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press("Tab");
      if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return true;
    }
    return false;
  }
  // Keyboard only: all zeros by Enter, the output typed in the number field, a dedup hit, the key unloaded and a scrub.
  const drive = {};
  await page.evaluate(() => {
    window.__said = [];
    for (const el of document.querySelectorAll("[data-live]"))
      new MutationObserver(() => el.textContent && window.__said.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
  });
  drive.zero = await tabTo('button[data-preset="zero"]');
  await page.keyboard.press("Enter");
  drive.zeroOutcome = (await trRead(page)).outcome;
  drive.comp = await tabTo('button[data-preset="text"]');
  await page.keyboard.press("Enter");
  drive.num = await tabTo("[data-out-num]");
  await page.keyboard.press("Control+a");
  await page.keyboard.type("50000");
  await page.keyboard.press("Enter");
  drive.numOutcome = (await trRead(page)).outcome;
  drive.write = await tabTo('button[data-write="A"]');
  await page.keyboard.press("Enter");
  drive.focusKept = await page.evaluate(() => document.activeElement?.dataset.write === "A");
  drive.key = await tabTo("button[data-key]");
  await page.keyboard.press("Enter");
  drive.scrub = await tabTo('button[data-act="scrub"]');
  await page.keyboard.press("Space");
  const st = await trRead(page);
  drive.live = st.live;
  await page.waitForTimeout(200);
  // Six actions: all zeros, compressible, the typed output, a write, the key, scrub.
  drive.said = await page.evaluate(() => window.__said);
  drive.ok = drive.said.length === 6 && !drive.said.some((t) => /\bcode\b$/.test(t)) && drive.zeroOutcome === "hole" && drive.numOutcome === "compressed" && drive.focusKept && st.scrub.length === 5 && st.scrub.every(Boolean) && st.entries.find((e) => e[0] === "A")?.[1] === 3;
  if (!drive.ok) report.transforms.mismatches.push({ where: `keyboard-${lang}`, drive, st });
  if (lang === "en") {
    await page.screenshot({ path: join(out, "transforms-en-desktop-keyboard.png") });
    report.captures.push("transforms-en-desktop-keyboard.png");
  }
  const noFocus = stops.filter((s) => !s.ok).map((s) => s.label);
  if (noFocus.length) report.transforms.mismatches.push({ where: `focus-${lang}`, noFocus });
  report.keyboard[`transforms-${lang}`] = { stops: stops.length, withoutVisibleFocus: noFocus, drive: { ok: drive.ok, zero: drive.zeroOutcome, num: drive.numOutcome, focusKept: drive.focusKept, said: drive.said.length } };
  await ctx.close();
}

await verifyVdevs({ browser, open, base, out, report, VIEWPORTS });
await verifyTree({ browser, open, base, out, report, VIEWPORTS });

report.nav = {};
// Spanish (D16.3) is captured and checked for console errors with the others; the
// interactions below are driven in English and French, whose labels they name.
for (const p of PAGES)
  for (const lang of ["en", "fr", "es"]) {
    const { ctx, page } = await open(VIEWPORTS.desktop, p[lang]);
    report.nav[p[lang]] = await page.evaluate(() => ({
      prev: document.querySelector(".room-nav a[rel=prev]")?.getAttribute("href") ?? null,
      next: document.querySelector(".room-nav a[rel=next]")?.getAttribute("href") ?? null,
      lang: document.querySelector(".site-header .lang")?.getAttribute("href"),
    }));
    await ctx.close();
  }

await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`${report.captures.length} captures, ${report.errors.length} console errors`);
for (const e of report.errors) console.log("ERROR", JSON.stringify(e));
for (const [k, v] of Object.entries(report.keyboard)) console.log("keyboard", k, JSON.stringify(v.drive ?? v), v.stops ? `stops=${v.stops} noFocus=${JSON.stringify(v.withoutVisibleFocus)}` : "");
for (const [k, v] of Object.entries(report.nav)) console.log("nav", k, JSON.stringify(v));
console.log("reduced motion", JSON.stringify(report.reducedMotion));
for (const [k, v] of Object.entries(report.txg)) console.log("txg", k, JSON.stringify(v));
for (const [k, v] of Object.entries(report.raidz)) console.log("raidz", k, JSON.stringify(v));
for (const [k, v] of Object.entries(report.snapshots)) console.log("snapshots", k, JSON.stringify(v));
for (const [k, v] of Object.entries(report.arc.runs)) console.log("arc", k, JSON.stringify(v));
console.log("arc noJs", JSON.stringify(report.arc.noJs));
console.log("arc mismatches", JSON.stringify(report.arc.mismatches));
if (report.arc.mismatches.length) process.exitCode = 1;
for (const [k, v] of Object.entries(report.metaslabs.runs)) console.log("metaslabs", k, JSON.stringify(v));
console.log("metaslabs noJs", JSON.stringify(report.metaslabs.noJs));
console.log("metaslabs mismatches", JSON.stringify(report.metaslabs.mismatches));
if (report.metaslabs.mismatches.length) process.exitCode = 1;
for (const [k, v] of Object.entries(report.zil.runs)) console.log("zil", k, JSON.stringify(v));
console.log("zil decision", JSON.stringify(Object.fromEntries(Object.entries(report.zil.decision).map(([k, v]) => [k, { combinations: v.combinations, mismatches: v.mismatches.length }]))));
console.log("zil noJs", JSON.stringify(report.zil.noJs));
console.log("zil mismatches", JSON.stringify(report.zil.mismatches));
if (report.zil.mismatches.length) process.exitCode = 1;
for (const [k, v] of Object.entries(report.send.runs)) console.log("send", k, JSON.stringify(v));
console.log("send noJs", JSON.stringify(report.send.noJs));
console.log("send mismatches", JSON.stringify(report.send.mismatches));
if (report.send.mismatches.length) process.exitCode = 1;
for (const [k, v] of Object.entries(report.transforms.runs)) console.log("transforms", k, JSON.stringify(v));
console.log("transforms noJs", JSON.stringify(report.transforms.noJs));
console.log("transforms mismatches", JSON.stringify(report.transforms.mismatches));
if (report.transforms.mismatches.length) process.exitCode = 1;
for (const [k, v] of Object.entries(report.vdevs.runs)) console.log("vdevs", k, JSON.stringify(v));
console.log("vdevs js", JSON.stringify(report.vdevs.js));
console.log("vdevs webgl off", JSON.stringify(report.vdevs.webglOff), "reduced", JSON.stringify(report.vdevs.reduced), "noJs", JSON.stringify(report.vdevs.noJs));
console.log("vdevs mismatches", JSON.stringify(report.vdevs.mismatches));
if (report.vdevs.mismatches.length) process.exitCode = 1;
console.log("tree runs", Object.keys(report.tree.runs).length, "js", JSON.stringify(report.tree.js), "hall", JSON.stringify(report.tree.hall));
console.log("tree webgl off", JSON.stringify(report.tree.webglOff), "reduced", JSON.stringify(report.tree.reduced), "noJs", JSON.stringify(report.tree.noJs));
console.log("tree mismatches", JSON.stringify(report.tree.mismatches));
if (report.tree.mismatches.length) process.exitCode = 1;
console.log("txg caption", JSON.stringify({ seen: captionSeen, mismatches: captionMismatches }));
if (captionMismatches.length || !captionSeen.tx_quiesced_txg || !captionSeen.tx_quiescing_txg) process.exitCode = 1;
