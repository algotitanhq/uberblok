// The compression, dedup and encryption room in a real browser (brief section 8),
// called by scripts/verify.mjs, or alone against a running build:
//   node scripts/verify-transforms.mjs http://127.0.0.1:4321 shots/transforms
// QA's replays in EN, FR and ES, phone and desktop, each checked against the
// model (src/lib/transforms.ts): compressible, incompressible, all-zero and
// embeddable blocks at ashift 9 and 12; a dedup miss, a hit, then over quota;
// the encrypted block pointer, the key unloaded, scrub and read. After one
// action in each figure, the outline of what it changed is checked, and the
// figures carry no link (D31.1); a Source note opens in the side panel on
// desktop. Then reduced motion, no JavaScript, and a keyboard-only walk.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { register } from "node:module";

// transforms.ts imports "./fletcher4" as Astro's bundler does, without the extension.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const trModel = await import("../src/lib/transforms.ts");

export const TRP = { id: "transforms", en: "/en/compression-dedup-encryption/", fr: "/fr/compression-dedup-chiffrement/", es: "/es/compresion-dedup-cifrado/" };

const TRL = {
  en: { comp: "Compressible", rnd: "Already compressed", zero: "All zeros", tiny: "Almost empty", quota: "Dedup table over its quota", key: "Unload the key", keyLoad: "Load the key", scrub: "Scrub", read: "Read the file", enc: "an encrypted data block", ind: "an indirect block", flip: "Flip a bit in data block 1 on disk" },
  fr: { comp: "Compressibles", rnd: "Déjà compressées", zero: "Que des zéros", tiny: "Presque vides", quota: "Table de déduplication au-dessus de son quota", key: "Décharger la clé", keyLoad: "Charger la clé", scrub: "Scrub", read: "Lire le fichier", enc: "d’un bloc de données chiffré", ind: "d’un bloc indirect", flip: "Inverser un bit du bloc de données 1 sur disque" },
  es: { comp: "Comprimibles", rnd: "Ya comprimidos", zero: "Solo ceros", tiny: "Casi vacíos", quota: "Tabla de deduplicación por encima de su cuota", key: "Descargar la clave", keyLoad: "Cargar la clave", scrub: "Hacer un scrub", read: "Leer el archivo", enc: "un bloque de datos cifrado", ind: "un bloque indirecto", flip: "Invertir un bit del bloque de datos 1 en el disco" },
};
const TR_OUT = { text: (l) => Math.round(l * 0.38), random: (l) => l + 64, tiny: () => 90 };

const trRead = (page) => page.evaluate(() => {
  const c = document.querySelector("[data-compress]");
  const d = document.querySelector("[data-dedup]");
  const e = document.querySelector("[data-crypt]");
  return {
    taken: c.querySelector("[data-path] li.taken")?.dataset.i,
    outcome: c.querySelector("[data-result] .outcome")?.className.replace("outcome ", "").replace(" chg", ""),
    sectors: c.querySelectorAll("[data-bars] .sec").length,
    entries: [...d.querySelectorAll(".ddt tbody tr")].map((tr) => [tr.children[1].textContent, Number(tr.children[2].textContent)]),
    bps: [...d.querySelectorAll(".bps li")].map((li) => [li.querySelector(".ct").textContent, li.querySelector(".dbit").textContent, li.querySelector("code").textContent]),
    disk: d.querySelectorAll(".disk li").length,
    diff: [...e.querySelectorAll("[data-words] tr.diff th")].map((th) => th.textContent),
    scrub: [...e.querySelectorAll("[data-file] .sc")].map((x) => x.classList.contains("ok")),
    readout: (e.querySelector("[data-file] .readout")?.textContent ?? "") + (e.querySelector("[data-file] .rd")?.textContent ?? ""),
    keyBtn: e.querySelector("button[data-key]").textContent.trim(),
    plainShown: e.querySelectorAll("[data-file] .plain").length,
    live: [...document.querySelectorAll("[aria-live]")].map((x) => x.textContent.trim()).filter(Boolean),
  };
});

/** What is outlined in each figure, the links in the figures, and where each plain line sits. */
const trOutlines = (page) => page.evaluate(() => {
  const c = document.querySelector("[data-compress]");
  const d = document.querySelector("[data-dedup]");
  const e = document.querySelector("[data-crypt]");
  const above = (a, b) => !a.hidden && a.getBoundingClientRect().bottom <= b.getBoundingClientRect().top + 1;
  return {
    compress: { rows: c.querySelectorAll("[data-bars] .row.chg").length, branch: c.querySelectorAll("[data-path] li.chg").length, outcome: c.querySelectorAll("[data-result] .outcome.chg").length },
    dedup: { rows: [...d.querySelectorAll(".ddt tr.chg")].map((tr) => tr.children[1].textContent), bps: d.querySelectorAll(".bps li.chg").length, disk: d.querySelectorAll(".disk li.chg").length, counters: [...d.querySelectorAll(".counters .chg")].map((x) => x.className.replace(" chg", "").replace("n-", "")), quota: d.querySelectorAll(".quota-note.chg").length },
    crypt: { blocks: e.querySelectorAll("[data-file] li.chg").length, key: e.querySelectorAll("[data-file] .keystate.chg").length },
    links: [c, d, e].map((f) => f.querySelectorAll("a").length),
    lineUnderButtons: [above(c.querySelector("[data-now]"), c.querySelector(".cl-grid")), above(d.querySelector("[data-now]"), d.querySelector("[data-view]")), above(e.querySelector("[data-now]"), e.querySelector("[data-file]"))],
  };
});

export async function verifyTransforms({ browser, open, base, out, report, VIEWPORTS }) {
  report.transforms = { runs: {}, mismatches: [], outlines: {}, panel: {} };
  const bad = (where, x) => report.transforms.mismatches.push({ where, ...x });
  for (const lang of ["en", "fr", "es"])
    for (const vp of ["iphone", "desktop"]) {
      const { ctx, page } = await open(VIEWPORTS[vp], TRP[lang]);
      const L = TRL[lang];
      const shot = async (loc, name) => {
        await page.waitForTimeout(1300);
        await loc.screenshot({ path: join(out, name) });
        report.captures.push(name);
      };
      const cl = page.locator("[data-compress]");
      const dd = page.locator("[data-dedup]");
      const cr = page.locator("[data-crypt]");
      if (vp === "desktop") {
        await page.screenshot({ path: join(out, `transforms-${lang}-desktop-page.png`), fullPage: true });
        report.captures.push(`transforms-${lang}-desktop-page.png`);
        // A Source note, opened: at 1440 px it goes to the side panel (D21.1).
        await page.locator("[data-source-note] summary").first().click();
        await page.waitForTimeout(400);
        report.transforms.panel[lang] = await page.evaluate(() => !!document.querySelector('[role="dialog"]:not([hidden]) pre'));
        if (!report.transforms.panel[lang]) bad(`${lang}-${vp}`, { k: "the Source note did not open in the panel" });
        await page.screenshot({ path: join(out, `transforms-${lang}-desktop-panel.png`) });
        report.captures.push(`transforms-${lang}-desktop-panel.png`);
        await page.keyboard.press("Escape");
      } else {
        await page.screenshot({ path: join(out, `transforms-${lang}-iphone-page.png`), fullPage: true });
        report.captures.push(`transforms-${lang}-iphone-page.png`);
      }
      // One action in each figure, one outlined effect: all zeros; A written again (a hit); the key unloaded.
      await cl.getByRole("button", { name: L.zero, exact: true }).click();
      await dd.locator('button[data-write="A"]').click();
      await cr.locator("button[data-key]").click();
      const o = await trOutlines(page);
      report.transforms.outlines[`${lang}-${vp}`] = o;
      // The key button names its next action, so it never contradicts the key's state.
      const kb = (await trRead(page)).keyBtn;
      if (kb !== L.keyLoad) bad(`${lang}-${vp}-key-button`, { kb });
      if (o.compress.rows !== 3 || o.compress.branch !== 1 || o.compress.outcome !== 1 || o.dedup.rows.join() !== "A" || o.dedup.bps !== 1 || o.dedup.disk !== 1 || o.dedup.counters.join() !== "write,lookup" || o.crypt.blocks !== 4 || o.crypt.key !== 1 || o.links.some(Boolean) || !o.lineUnderButtons.every(Boolean))
        bad(`${lang}-${vp}`, { k: "outline after one action per figure", o });
      await shot(dd, `transforms-${lang}-${vp}-dedup-hit.png`);
      await shot(cr, `transforms-${lang}-${vp}-key-off.png`);
      await cr.locator("button[data-key]").click();
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
          if (got.outcome !== want.outcome || got.sectors !== want.sectors) bad(k, { got, want: { outcome: want.outcome, sectors: want.sectors } });
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
      await dd.locator('[data-act="restart"]').click();
      for (const c of ["A", "A"]) await dd.locator(`button[data-write="${c}"]`).click();
      await dd.getByRole("button", { name: L.quota }).click();
      const q = await trOutlines(page);
      if (q.dedup.quota !== 1 || q.dedup.rows.length || q.dedup.bps) bad(`${lang}-${vp}-quota`, { o: q.dedup });
      for (const c of ["C", "A", "C"]) await dd.locator(`button[data-write="${c}"]`).click();
      {
        const got = await trRead(page);
        let m = trModel.dedupStart();
        for (const [c, qq] of [["A", false], ["A", false], ["C", true], ["A", true], ["C", true]]) m = trModel.dedupWrite(m, c, qq);
        const want = { entries: m.entries.map((e) => [e.content, e.refcnt]), bps: m.bps.map((b) => [b.content, `D=${b.dedup ? 1 : 0}`, b.dva]), disk: m.disk.length };
        report.transforms.runs[`${lang}-${vp}-dedup`] = { entries: got.entries, disk: got.disk };
        if (JSON.stringify([got.entries, got.bps, got.disk]) !== JSON.stringify([want.entries, want.bps, want.disk])) bad(`${lang}-${vp}-dedup`, { got, want });
      }
      await shot(dd, `transforms-${lang}-${vp}-dedup.png`);
      // Encryption: the encrypted bp, the key unloaded, scrub, read; then a flipped bit.
      await cr.getByRole("button", { name: L.enc }).click();
      await cr.locator("button[data-key]").click();
      await cr.getByRole("button", { name: L.scrub, exact: true }).click();
      const s1 = await trRead(page);
      await cr.getByRole("button", { name: L.read }).click();
      const s2 = await trRead(page);
      report.transforms.runs[`${lang}-${vp}-nokey`] = { diff: s1.diff, scrub: s1.scrub, readout: s2.readout, plainShown: s2.plainShown };
      if (s1.diff.join() !== "4,5,b,e,f" || !s1.scrub.every(Boolean) || s1.scrub.length !== 5 || !/EACCES/.test(s2.readout) || s2.plainShown !== 0) bad(`${lang}-${vp}-nokey`, { s1, s2 });
      await shot(cr, `transforms-${lang}-${vp}-nokey.png`);
      await cr.getByRole("button", { name: L.flip }).click();
      await cr.getByRole("button", { name: L.scrub, exact: true }).click();
      const s3 = await trRead(page);
      report.transforms.runs[`${lang}-${vp}-flip`] = { scrub: s3.scrub };
      if (JSON.stringify(s3.scrub) !== JSON.stringify([true, true, true, false, true])) bad(`${lang}-${vp}-flip`, { s3 });
      const links = (await trOutlines(page)).links;
      if (links.some(Boolean)) bad(`${lang}-${vp}-links`, { links });
      await shot(cr, `transforms-${lang}-${vp}-flip.png`);
      await ctx.close();
    }
  {
    // Reduced motion: no animation runs after an action; the outlines are there all the same.
    const { ctx, page } = await open({ ...VIEWPORTS.iphone, reducedMotion: "reduce" }, TRP.en);
    await page.locator("[data-compress]").getByRole("button", { name: "All zeros" }).click();
    await page.locator('[data-dedup] button[data-write="B"]').click();
    await page.locator("[data-crypt]").getByRole("button", { name: "an indirect block" }).click();
    await page.locator("[data-crypt] button[data-key]").click();
    const o = await trOutlines(page);
    report.reducedMotion.transforms = { running: await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length), outlined: o.compress.rows + o.dedup.bps + o.crypt.blocks };
    if (report.reducedMotion.transforms.running || !report.reducedMotion.transforms.outlined) bad("reduced-motion", report.reducedMotion.transforms);
    await page.screenshot({ path: join(out, "transforms-en-iphone-reduced-motion.png"), fullPage: true });
    report.captures.push("transforms-en-iphone-reduced-motion.png");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(base + TRP.en);
    report.transforms.noJs = await page.evaluate(() => ({
      compress: document.querySelector("[data-compress] [data-result] .outcome")?.textContent?.slice(0, 40),
      ddtRows: document.querySelectorAll("[data-dedup] .ddt tbody tr").length,
      words: document.querySelectorAll("[data-crypt] [data-words] tbody tr").length,
      barsHidden: [...document.querySelectorAll(".cl-bar, [data-dedup] .tr-bar, [data-crypt] .tr-bar")].every((b) => b.hidden),
      outlined: document.querySelectorAll("[data-compress] .chg, [data-dedup] .chg, [data-crypt] .chg").length,
    }));
    const nj = report.transforms.noJs;
    if (!nj.barsHidden || nj.ddtRows !== 2 || nj.words !== 16 || !nj.compress || nj.outlined) bad("nojs", { nj });
    await page.screenshot({ path: join(out, "transforms-en-iphone-nojs.png"), fullPage: true });
    report.captures.push("transforms-en-iphone-nojs.png");
    await ctx.close();
  }
  for (const lang of ["en", "fr", "es"]) {
    const { ctx, page } = await open(VIEWPORTS.desktop, TRP[lang]);
    const stops = [];
    for (let i = 0; i < 400; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return {
          label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
          // A focus ring is solid; the outline of what changed is dashed.
          ok: el.matches(":focus-visible") && cs.outlineStyle === "solid" && parseFloat(cs.outlineWidth) > 0,
          key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + Object.entries(el.dataset ?? {}).join(",") + "|" + el.textContent + "|" + el.id,
        };
      });
      if (!info) continue;
      if (stops.length && info.key === stops[0].key) break;
      stops.push(info);
    }
    await page.goto(base + TRP[lang]);
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
    await page.waitForTimeout(200);
    // Six actions: all zeros, compressible, the typed output, a write, the key, scrub.
    drive.said = await page.evaluate(() => window.__said);
    drive.ok = drive.said.length === 6 && drive.zeroOutcome === "hole" && drive.numOutcome === "compressed" && drive.focusKept && st.scrub.length === 5 && st.scrub.every(Boolean) && st.entries.find((e) => e[0] === "A")?.[1] === 3;
    if (!drive.ok) bad(`keyboard-${lang}`, { drive, st });
    if (lang === "en") {
      await page.screenshot({ path: join(out, "transforms-en-desktop-keyboard.png") });
      report.captures.push("transforms-en-desktop-keyboard.png");
    }
    const noFocus = stops.filter((s) => !s.ok).map((s) => s.label);
    if (noFocus.length) bad(`focus-${lang}`, { noFocus });
    report.keyboard[`transforms-${lang}`] = { stops: stops.length, withoutVisibleFocus: noFocus, drive: { ok: drive.ok, zero: drive.zeroOutcome, num: drive.numOutcome, focusKept: drive.focusKept, said: drive.said.length } };
    await ctx.close();
  }
  return report.transforms;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = "http://127.0.0.1:4321", out = "shots/transforms"] = process.argv.slice(2);
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
  const R = await verifyTransforms({ browser, open, base, out, report, VIEWPORTS });
  await browser.close();
  writeFileSync(join(out, "report-transforms.json"), JSON.stringify(report, null, 2));
  console.log(`${report.captures.length} captures, ${report.errors.length} console errors`);
  for (const e of report.errors) console.log("ERROR", JSON.stringify(e));
  for (const [k, v] of Object.entries(report.keyboard)) console.log("keyboard", k, JSON.stringify(v));
  console.log("outlines", JSON.stringify(R.outlines));
  console.log("panel", JSON.stringify(R.panel));
  console.log("reduced", JSON.stringify(report.reducedMotion.transforms), "nojs", JSON.stringify(R.noJs));
  console.log("runs", Object.keys(R.runs).length);
  console.log("mismatches", JSON.stringify(R.mismatches, null, 1));
  if (R.mismatches.length || report.errors.length) process.exitCode = 1;
}
