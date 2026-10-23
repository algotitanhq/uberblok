// The Metaslabs and space maps room in a real browser (brief section 8),
// called by scripts/verify.mjs, or alone against a running build:
//   node scripts/verify-metaslabs.mjs http://127.0.0.1:4321 shots/metaslabs
// QA's sequences (a write then a delete, a two-word entry, a load, a condense
// refused then accepted) replayed in the page in EN, FR and ES, phone and
// desktop; every word drawn on the tape is compared with the model's
// (src/lib/metaslab.ts), the log is read back, and the outline of what an
// action changed is checked after a delete (D27.1). Then reduced motion, no
// JavaScript, and a keyboard-only walk.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as msModel from "../src/lib/metaslab.ts";

export const MSR = { id: "metaslabs", en: "/en/metaslabs/", fr: "/fr/metaslabs/", es: "/es/metaslabs/" };

export async function verifyMetaslabs({ browser, open, base, out, report, VIEWPORTS }) {
  // The Metaslabs and space maps room: QA's sequences (a write then a delete, a
  // two-word entry, a load, a condense refused then accepted) replayed in the
  // page; every word drawn on the tape is compared with the model's
  // (src/lib/metaslab.ts), and the log is read back.
  const MSL = {
    en: { sync: /^Sync txg/, mib160: "160 MiB", load: "Load", condense: "Condense", rewrite: "Rewrite db, up to 40 txgs", del: (id) => `Delete file ${id}`, refused: /Condense refused/, condensed: /the sync of txg \d+ rewrites it first/, same: /the same tree as before/ },
    fr: { sync: /^Synchroniser le txg/, mib160: "160 Mio", load: "Charger", condense: "Condenser", rewrite: "Réécrire db, jusqu’à 40 txg", del: (id) => `Supprimer le fichier ${id}`, refused: /Condensation refusée/, condensed: /la synchronisation du txg \d+ la réécrit d’abord/, same: /le même arbre qu’avant/ },
    es: { sync: /^Sincronizar el txg/, mib160: "160\u00a0MiB", load: "Cargar", condense: "Condensar", rewrite: "Reescribir db, hasta 40 txg", del: (id) => `Borrar el archivo ${id}`, refused: /Condensación rechazada/, condensed: /la sincronización del txg \d+ lo reescribe primero/, same: /el mismo árbol que antes/ },
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
  report.metaslabs = { runs: {}, mismatches: [], outlines: {}, panel: {} };
  const msSame = (got, m, where) => {
    const want = new Map(m.tape.map((e, i) => [i, e.words.map(msModel.hex).join(" ")]));
    if (!got.cells.length && m.tape.length) report.metaslabs.mismatches.push({ where, k: "empty tape" });
    for (const [i, w] of got.cells) if (want.get(i) !== w) report.metaslabs.mismatches.push({ where, i, got: w, want: want.get(i) });
  };
  for (const lang of ["en", "fr", "es"]) {
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
      if (vp === "desktop") {
        await page.screenshot({ path: join(out, `metaslabs-${lang}-desktop-page.png`), fullPage: true });
        report.captures.push(`metaslabs-${lang}-desktop-page.png`);
        // A Source note, opened: at 1440 px it goes to the side panel (D21.1).
        await page.locator("[data-source-note] summary").first().click();
        await page.waitForTimeout(400);
        report.metaslabs.panel[lang] = await page.evaluate(() => !!document.querySelector('[role="dialog"]:not([hidden]) pre'));
        if (!report.metaslabs.panel[lang]) report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "the Source note did not open in the panel" });
        await page.screenshot({ path: join(out, `metaslabs-${lang}-desktop-panel.png`) });
        report.captures.push(`metaslabs-${lang}-desktop-panel.png`);
        await page.keyboard.press("Escape");
      } else {
        await page.screenshot({ path: join(out, `metaslabs-${lang}-iphone-page.png`), fullPage: true });
        report.captures.push(`metaslabs-${lang}-iphone-page.png`);
      }
      await b(L.del("A")).click(); msModel.del(m, "A");
      // One action, one outlined effect: A's range on the metaslab, ms_freeing, file A; the line under the buttons says it.
      report.metaslabs.outlines[`${lang}-${vp}`] = await page.evaluate(() => {
        const f = document.querySelector("[data-msl]");
        return {
          bar: f.querySelectorAll("[data-ms] rect.chg").length,
          trees: [...f.querySelectorAll("[data-trees] li.chg .tn")].map((x) => x.textContent),
          files: [...f.querySelectorAll("[data-files] li.chg .fid")].map((x) => x.textContent),
          tape: f.querySelectorAll("[data-tape] .chg").length,
          links: f.querySelectorAll("a").length,
          logAboveVdev: f.querySelector(".msl-log").getBoundingClientRect().bottom <= f.querySelector(".msl-vdev").getBoundingClientRect().top,
        };
      });
      const o = report.metaslabs.outlines[`${lang}-${vp}`];
      if (o.bar !== 1 || o.trees.join() !== "ms_freeing" || o.files.join() !== "A" || o.tape !== 0 || o.links !== 0 || !o.logAboveVdev)
        report.metaslabs.mismatches.push({ where: `${lang}-${vp}`, k: "outline after delete", o });
      await shot(`metaslabs-${lang}-${vp}-delete-pending.png`);
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
  for (const lang of ["en", "fr", "es"]) {
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
  return report.metaslabs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = "http://127.0.0.1:4321", out = "shots/metaslabs"] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const VIEWPORTS = {
    iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  };
  const report = { base, errors: [], captures: [], keyboard: {}, reducedMotion: {} };
  const browser = await chromium.launch();
  async function open(ctxOpts, path, theme = "dark") {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && report.errors.push({ path, type: m.type(), text: m.text() }));
    page.on("pageerror", (e) => report.errors.push({ path, type: "pageerror", text: String(e) }));
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page };
  }
  const R = await verifyMetaslabs({ browser, open, base, out, report, VIEWPORTS });
  await browser.close();
  writeFileSync(join(out, "report-metaslabs.json"), JSON.stringify(report, null, 2));
  console.log(`${report.captures.length} captures, ${report.errors.length} console errors`);
  for (const e of report.errors) console.log("ERROR", JSON.stringify(e));
  for (const [k, v] of Object.entries(report.keyboard)) console.log("keyboard", k, JSON.stringify(v));
  for (const [k, v] of Object.entries(R.runs)) console.log("metaslabs", k, JSON.stringify(v));
  console.log("outlines", JSON.stringify(R.outlines));
  console.log("panel", JSON.stringify(R.panel));
  console.log("reduced", JSON.stringify(report.reducedMotion.metaslabs), "nojs", JSON.stringify(R.noJs));
  console.log("mismatches", JSON.stringify(R.mismatches, null, 1));
  if (R.mismatches.length || report.errors.length) process.exitCode = 1;
}
