// The tree and the uberblock room, and the Hall object, in a real browser
// (brief section 8), called by scripts/verify.mjs, or alone against a running
// build:
//   node scripts/verify-tree.mjs http://127.0.0.1:4321 shots/tree
// QA's replay against the model (src/lib/tree.ts): a leaf write and its
// rewritten ancestors; the new tree written one height per step, then the four beats; the plug pulled before, during and after (and
// after 0 to 3 uberblock writes in beat 3), with the tree that wins on import;
// the slot of several txgs. Then the 3D view (SwiftShader), WebGL off,
// reduced motion, no JavaScript, a keyboard-only walk, and the JavaScript
// transferred before and after the 3D import, for this room and the Hall.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) {
        try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !s.endsWith(".ts")) return next(s + ".ts", c); throw e; }
      }`,
    ),
);
const M = await import("../src/lib/tree.ts");

export const TR = { id: "tree", en: "/en/tree/", fr: "/fr/arbre/", es: "/es/arbol/" };
const HALL = { en: "/en/", fr: "/fr/" };
/** SwiftShader: software WebGL, so the 3D view renders on a machine without a GPU (brief section 6). */
export const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

/** What the page shows: the blocks and their states, the root arrow, the disk, the last import. */
const trRead = (page) =>
  page.evaluate(() => {
    const fig = document.querySelector("[data-tree-lab]");
    const blocks = Object.fromEntries([...fig.querySelectorAll("[data-tree] [data-block]")].map((g) => [g.dataset.block, g.dataset.state]));
    const rows = [...fig.querySelectorAll("[data-disk-table] tbody tr")].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()));
    const heads = [...fig.querySelectorAll("[data-disk-table] thead th")].map((th) => th.textContent.trim());
    const v = fig.querySelector("[data-import] .imp-verdict");
    return {
      blocks, rows, heads,
      root: fig.querySelector("[data-tree] .root")?.dataset.root ?? null,
      ub: fig.querySelector("[data-tree] [data-ub]")?.dataset.ub ?? null,
      winner: v?.dataset.winner ?? null, won: v?.dataset.treeWon ?? null,
      beats: [...fig.querySelectorAll("[data-beats] li")].map((li) => li.className),
      live: fig.querySelector("[data-live]")?.textContent ?? "",
    };
  });

const WORDS = { en: { torn: "torn", empty: "empty" }, fr: { torn: "déchirée", empty: "vide" } };
/** The model's view of the same state, in the page's terms. */
function expect(p, lang) {
  const ub = M.newestOnDisk(p);
  const work = p.open?.txg ?? p.synced + 1;
  const sn = M.slotOf(work, p.ashift);
  const W = WORDS[lang];
  const cell = (s) => (!s ? W.empty : s.torn ? W.torn : `txg ${s.txg}`);
  return { root: ub.root, ub: String(ub.txg), slots: p.labels.map((l) => cell(l.ring[sn])), configs: p.labels.map((l) => (l.configTorn ? W.torn : `txg ${l.config}`)), slot: sn };
}

export async function verifyTree({ browser, open, base, out, report, VIEWPORTS }) {
  const R = (report.tree = { runs: {}, mismatches: [], js: {}, hall: {}, noJs: null, webglOff: null, reduced: null });
  const miss = (where, got, want) => R.mismatches.push({ where, got, want });
  const shot = async (loc, name) => {
    await loc.page().waitForTimeout(500);
    await loc.screenshot({ path: join(out, name) });
    report.captures.push(name);
  };

  for (const lang of ["en", "fr"]) {
    for (const vp of ["iphone", "desktop"]) {
      const { ctx, page } = await open(VIEWPORTS[vp], TR[lang]);
      const fig = page.locator("[data-tree-lab]");
      // 2D for the checks: the 3D view draws the same state (verified below).
      if ((await fig.locator("[data-view3d]").getAttribute("aria-pressed")) === "true") await fig.locator("[data-view3d]").click();
      const k = (x) => `${lang}-${vp}-${x}`;
      let model;
      const compare = async (where) => {
        const got = await trRead(page);
        const want = expect(model, lang);
        const slots = got.rows.map((r) => r[3]);
        const configs = got.rows.map((r) => r[1]);
        R.runs[k(where)] = { root: got.root, ub: got.ub, slots: slots.join("|"), configs: configs.join("|") };
        if (got.root !== want.root || got.ub !== want.ub || slots.join() !== want.slots.join() || configs.join() !== want.configs.join() || !got.heads[4]?.includes(String(want.slot)))
          miss(k(where), got, want);
        return got;
      };
      const restart = async () => {
        await fig.locator("[data-act=restart]").click();
        model = M.writeLeaf(M.createPool(), 2).pool;
      };
      const stepN = async (n) => {
        for (let i = 0; i < n; i++) {
          await fig.locator("[data-act=step]").click();
          model = M.step(model);
        }
      };
      const setConfig = async (on) => {
        if ((await fig.locator("[data-act=config]").getAttribute("aria-pressed")) !== String(on)) await fig.locator("[data-act=config]").click();
        model = { ...model, configDirty: on };
      };

      // A leaf write and its ancestors: D2 (on the page), then D3 in the same txg.
      await restart();
      {
        await fig.locator("[data-leaf='3']").click();
        const r = M.writeLeaf(model, 3);
        model = r.pool;
        const got = await trRead(page);
        const fresh = Object.entries(got.blocks).filter(([, s]) => s === "mem").map(([id]) => id).sort();
        const want = Object.values(model.blocks).filter((b) => b.birth === 4211).map((b) => b.id).sort();
        R.runs[k("write-D2-D3")] = { fresh: fresh.join(","), rewritten: r.rewritten.join(",") };
        if (fresh.join() !== want.join() || r.rewritten.join() !== "D3") miss(k("write-D2-D3"), fresh, want);
        await shot(fig.locator(".tr-stage"), `tree-${lang}-${vp}-write.png`);
      }
      // spa_sync writes the new tree one height per step, then the four beats, checked after each step.
      for (let i = 0; i < M.HEIGHTS + 4; i++) {
        await stepN(1);
        const name = model.open.beat === null ? `height-${model.open.wrote}` : `beat-${model.open.beat}`;
        await compare(name);
        if (model.open.beat === null || model.open.beat === 0) {
          // The blocks written so far: every new copy below the height reached.
          const got = await trRead(page);
          const written = Object.entries(got.blocks).filter(([, s]) => s === "unflushed").map(([id]) => id).sort();
          const want = Object.values(model.blocks).filter((b) => b.birth === 4211 && M.height(b.key) < model.open.wrote).map((b) => b.id).sort();
          R.runs[k(`${name}-written`)] = written.join(",");
          if (written.join() !== want.join()) miss(k(`${name}-written`), written, want);
        }
        if (name === "height-2") await shot(fig.locator(".tr-stage"), `tree-${lang}-${vp}-height2.png`);
        if (name === "beat-3") await shot(fig, `tree-${lang}-${vp}-beat3.png`);
      }
      // The plug pulled before any write, halfway up the tree and at each beat, config changed
      // and not, beat 3 with 0 to 3 writes landed. `done`: beats done, -1 with blocks still to write.
      const cases = [];
      for (const dirty of [true, false])
        for (const steps of [0, 2, ...[0, 1, 2, 3, 4].map((b) => M.HEIGHTS + b)])
          for (const landed of steps === M.HEIGHTS + 2 ? [0, 1, 2, 3] : [0]) cases.push({ dirty, steps, done: steps < M.HEIGHTS ? -1 : steps - M.HEIGHTS, landed });
      for (const c of cases) {
        await restart();
        await setConfig(c.dirty);
        await stepN(c.steps);
        await fig.locator(`[data-landed='${c.landed}']`).click();
        await fig.locator("[data-act=plug]").click();
        model = M.pullPlug(model, c.landed);
        const name = `plug-${c.dirty ? "cfg" : "nocfg"}-steps${c.steps}-landed${c.landed}`;
        await compare(name + "-cut");
        await fig.locator("[data-act=import]").click();
        const r = M.importPool(model);
        model = r.pool;
        const got = await compare(name + "-import");
        R.runs[k(name)] = { winner: got.winner, tree: got.won };
        if (got.winner !== String(r.result.winner.txg) || got.won !== r.result.tree) miss(k(name), { winner: got.winner, won: got.won }, { winner: r.result.winner.txg, won: r.result.tree });
        if (c.dirty && ((c.done === 2 && c.landed <= 1) || c.done === 1 || c.steps === 2)) await shot(fig, `tree-${lang}-${vp}-${name}.png`);
      }
      // The slot of several txgs: four commits in a row.
      await restart();
      await setConfig(true);
      for (let i = 0; i < 4; i++) {
        if (i) {
          await fig.locator(`[data-leaf='${i % 4}']`).click();
          model = M.writeLeaf(model, i % 4).pool;
        }
        await stepN(M.HEIGHTS + 4);
        const got = await compare(`commit-${model.open.txg}`);
        R.runs[k(`slot-${model.open.txg}`)] = { slot: got.heads[4] };
      }
      await ctx.close();
    }
  }

  // The 3D view in software WebGL, with the JavaScript it costs: this room, then the Hall.
  const jsRun = async (path, figSel, btnSel, canvasSel, shotName, act, opensItself = false) => {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    const js = [];
    page.on("response", async (r) => {
      if (r.request().resourceType() !== "script") return;
      try {
        const body = await r.body();
        js.push({ url: r.url().replace(base, ""), raw: body.length, gzip: gzipSync(body).length });
      } catch {}
    });
    await page.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    // First the page as a phone loads it: the JS of the first load, before any 3D import
    // (the Hall imports its 3D only as the ring nears the screen, so it is counted before the scroll).
    const phone = await gl.newContext({ ...VIEWPORTS.iphone });
    const pp = await phone.newPage();
    const before = [];
    pp.on("response", async (r) => {
      if (r.request().resourceType() !== "script") return;
      try {
        const body = await r.body();
        before.push({ url: r.url().replace(base, ""), raw: body.length, gzip: gzipSync(body).length });
      } catch {}
    });
    await pp.goto(base + path, { waitUntil: "networkidle" });
    const firstLoad = [...before];
    await pp.locator(figSel).scrollIntoViewIfNeeded();
    await pp.waitForTimeout(800);
    await phone.close();
    await page.goto(base + path, { waitUntil: "networkidle" });
    const fig = page.locator(figSel);
    await fig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    if (opensItself) await page.waitForSelector(canvasSel, { timeout: 30000 });
    const auto = await page.locator(canvasSel).count();
    if (!!auto !== opensItself) miss(`3d-on-arrival-${path}`, auto ? "on view" : "button", opensItself ? "on view" : "button");
    if (!auto) await fig.locator(btnSel).click();
    await page.waitForSelector(canvasSel);
    await page.waitForLoadState("networkidle");
    if (act) await act(page, fig);
    await page.waitForTimeout(1500);
    await fig.screenshot({ path: join(out, shotName) });
    report.captures.push(shotName);
    await page.locator(canvasSel).focus();
    for (const key of ["ArrowLeft", "ArrowUp", "+"]) await page.keyboard.press(key);
    const sum = (xs) => xs.reduce((a, x) => ({ raw: a.raw + x.raw, gzip: a.gzip + x.gzip }), { raw: 0, gzip: 0 });
    const res = { before: { ...sum(firstLoad), files: firstLoad.map((x) => x.url) }, after3d: { ...sum(js), files: js.map((x) => x.url) }, auto: auto ? "on view" : "button", cls: await page.evaluate(() => window.__cls), errors };
    if (errors.length) miss(`3d-errors-${path}`, errors, []);
    await gl.close();
    return res;
  };
  R.js = await jsRun(TR.en, "[data-tree-lab]", "[data-view3d]", ".tr-canvas", "tree-en-desktop-3d.png", async (page, fig) => {
    for (let i = 0; i < M.HEIGHTS + 3; i++) await fig.locator("[data-act=step]").click();
  });
  R.hall.js = await jsRun(HALL.en, "[data-ring]", "[data-ring3d-btn]", ".ring-canvas", "hall-en-desktop-3d.png", async (page) => {
    // The ring commits by itself: three ticks, then mid-flight of the fourth block.
    const t0 = Number(await page.evaluate(() => document.querySelector('[data-field="txg"]').textContent));
    await page.waitForFunction((t) => Number(document.querySelector('[data-field="txg"]').textContent) >= t + 3, t0, { timeout: 15000 });
  }, true);
  // FR, light theme, 3D: a cut during beat 3 and its import.
  {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop });
    await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
    const page = await ctx.newPage();
    await page.goto(base + TR.fr, { waitUntil: "networkidle" });
    const fig = page.locator("[data-tree-lab]");
    await fig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    if ((await fig.locator("[data-view3d]").getAttribute("aria-pressed")) !== "true") await fig.locator("[data-view3d]").click();
    await page.waitForSelector(".tr-canvas");
    for (let i = 0; i < M.HEIGHTS + 2; i++) await fig.locator("[data-act=step]").click();
    await fig.locator("[data-landed='1']").click();
    await fig.locator("[data-act=plug]").click();
    await page.waitForTimeout(1200);
    await fig.locator(".tr-stage").screenshot({ path: join(out, "tree-fr-desktop-3d-light-cut.png") });
    report.captures.push("tree-fr-desktop-3d-light-cut.png");
    const p2 = await ctx.newPage();
    await p2.goto(base + HALL.fr, { waitUntil: "networkidle" });
    await p2.locator("[data-ring]").scrollIntoViewIfNeeded();
    await p2.waitForSelector(".ring-canvas", { timeout: 30000 });
    await p2.locator("label", { hasText: "9–10" }).click();
    await p2.waitForTimeout(3600);
    await p2.locator("[data-ring]").screenshot({ path: join(out, "hall-fr-desktop-3d-light-128.png") });
    report.captures.push("hall-fr-desktop-3d-light-128.png");
    await gl.close();
  }

  // WebGL off: the 2D views stay, the 3D buttons are shown disabled with the reason, no scene fetched.
  {
    const nogl = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis"] });
    const ctx = await nogl.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    await page.goto(base + TR.en, { waitUntil: "networkidle" });
    await page.locator("[data-tree-lab]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    // A press on the disabled button (Playwright would wait for it to be enabled).
    await page.locator("[data-view3d]").click({ force: true });
    R.webglOff = await page.evaluate(() => ({
      button: !document.querySelector("[data-view3d]").hidden,
      disabled: document.querySelector("[data-view3d]").getAttribute("aria-disabled"),
      note: !document.querySelector("[data-no3d]").hidden,
      canvas: !!document.querySelector(".tr-canvas"),
      tree: !document.querySelector("[data-tree]").hidden,
      scripts: performance.getEntriesByType("resource").filter((e) => /tree-3d|three\.module/.test(e.name)).length,
    }));
    if (!R.webglOff.button || R.webglOff.disabled !== "true" || !R.webglOff.note || R.webglOff.canvas || !R.webglOff.tree || R.webglOff.scripts) miss("webgl-off", R.webglOff, {});
    await page.locator("[data-tree-lab]").screenshot({ path: join(out, "tree-en-desktop-webgl-off.png") });
    report.captures.push("tree-en-desktop-webgl-off.png");
    await page.goto(base + HALL.en, { waitUntil: "networkidle" });
    await page.locator("[data-ring]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(3600);
    R.hall.webglOff = await page.evaluate(() => ({
      disabled: document.querySelector("[data-ring3d-btn]").getAttribute("aria-disabled"),
      why: document.querySelector("[data-ring3d-why]").textContent,
      pause: !document.querySelector("[data-pause]").hidden,
      txg: document.querySelector('[data-field="txg"]').textContent,
      canvas: !!document.querySelector(".ring-canvas"),
      svg: getComputedStyle(document.querySelector("[data-ring] svg")).display !== "none",
      scripts: performance.getEntriesByType("resource").filter((e) => /hall-3d|three\.module/.test(e.name)).length,
    }));
    if (R.hall.webglOff.disabled !== "true" || !R.hall.webglOff.why || R.hall.webglOff.pause || R.hall.webglOff.txg !== "4211" || R.hall.webglOff.canvas || !R.hall.webglOff.svg || R.hall.webglOff.scripts) miss("hall-webgl-off", R.hall.webglOff, {});
    await page.locator("[data-ring]").screenshot({ path: join(out, "hall-en-desktop-webgl-off.png") });
    report.captures.push("hall-en-desktop-webgl-off.png");
    // The same in French: the reason is there in both languages.
    await page.goto(base + HALL.fr, { waitUntil: "networkidle" });
    await page.locator("[data-ring]").scrollIntoViewIfNeeded();
    R.hall.webglOffFr = await page.evaluate(() => ({ disabled: document.querySelector("[data-ring3d-btn]").getAttribute("aria-disabled"), why: document.querySelector("[data-ring3d-why]").textContent }));
    if (R.hall.webglOffFr.disabled !== "true" || !/WebGL/.test(R.hall.webglOffFr.why)) miss("hall-webgl-off-fr", R.hall.webglOffFr, {});
    await nogl.close();
  }

  // Reduced motion: no 3D by itself, nothing animates after a step; the Hall stays in 2D.
  {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop, reducedMotion: "reduce" });
    // The reason shown beside the disabled 3D button must not move the page.
    await ctx.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    const page = await ctx.newPage();
    await page.goto(base + TR.en, { waitUntil: "networkidle" });
    const fig = page.locator("[data-tree-lab]");
    await fig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await fig.locator("[data-act=step]").click();
    R.reduced = await page.evaluate(() => ({
      pressed: document.querySelector("[data-view3d]").getAttribute("aria-pressed"),
      canvas: !!document.querySelector(".tr-canvas"),
      cls: window.__cls,
      running: document.getAnimations().filter((a) => a.playState === "running").length,
    }));
    if (R.reduced.pressed !== "false" || R.reduced.canvas || R.reduced.running) miss("reduced-motion", R.reduced, {});
    await fig.screenshot({ path: join(out, "tree-en-desktop-reduced-motion.png") });
    report.captures.push("tree-en-desktop-reduced-motion.png");
    await page.goto(base + HALL.en, { waitUntil: "networkidle" });
    await page.locator("[data-ring]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(3600);
    R.hall.reduced = await page.evaluate(() => ({
      canvas: !!document.querySelector(".ring-canvas"),
      svg: getComputedStyle(document.querySelector("[data-ring] svg")).display !== "none",
      txg: document.querySelector('[data-field="txg"]').textContent,
      pause: !document.querySelector("[data-pause]").hidden,
      disabled: document.querySelector("[data-ring3d-btn]").getAttribute("aria-disabled"),
      scripts: performance.getEntriesByType("resource").filter((e) => /hall-3d|three\.module/.test(e.name)).length,
    }));
    if (R.hall.reduced.canvas || !R.hall.reduced.svg || R.hall.reduced.txg !== "4211" || R.hall.reduced.pause || R.hall.reduced.disabled !== "true" || R.hall.reduced.scripts) miss("hall-reduced-motion", R.hall.reduced, {});
    await page.locator("[data-ring]").screenshot({ path: join(out, "hall-en-desktop-reduced-motion.png") });
    report.captures.push("hall-en-desktop-reduced-motion.png");
    await page.goto(base + HALL.fr, { waitUntil: "networkidle" });
    R.hall.reducedFr = await page.evaluate(() => ({ disabled: document.querySelector("[data-ring3d-btn]").getAttribute("aria-disabled"), why: document.querySelector("[data-ring3d-why]").textContent }));
    if (R.hall.reducedFr.disabled !== "true" || !/animations/.test(R.hall.reducedFr.why)) miss("hall-reduced-fr", R.hall.reducedFr, {});
    await gl.close();
  }

  // No JavaScript: the first state is in the page, the controls hidden.
  {
    const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(base + TR.en);
    R.noJs = await page.evaluate(() => ({
      blocks: document.querySelectorAll("[data-tree-lab] [data-tree] [data-block]").length,
      fresh: document.querySelectorAll("[data-tree-lab] [data-tree] [data-state=mem]").length,
      root: document.querySelector("[data-tree-lab] .root")?.dataset.root,
      barsHidden: [...document.querySelectorAll("[data-tree-lab] .tr-bar")].every((b) => b.hidden),
    }));
    if (!R.noJs.barsHidden || R.noJs.blocks !== 14 || R.noJs.fresh !== 5 || R.noJs.root !== "OS@4210") miss("nojs", R.noJs, {});
    await page.screenshot({ path: join(out, "tree-en-iphone-nojs.png"), fullPage: true });
    report.captures.push("tree-en-iphone-nojs.png");
    await ctx.close();
  }

  // Keyboard only: every stop has a visible focus; drive the figure from the keyboard, in 2D and 3D.
  for (const lang of ["en", "fr"]) {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    await page.goto(base + TR[lang], { waitUntil: "networkidle" });
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
          key: el.tagName + "|" + (el.getAttribute("href") || "") + "|" + Object.entries(el.dataset ?? {}).join(",") + "|" + el.textContent?.slice(0, 40) + "|" + el.id,
        };
      });
      if (!info) continue;
      if (stops.length && info.key === stops[0].key) break;
      stops.push(info);
    }
    await page.goto(base + TR[lang], { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__said = [];
      const el = document.querySelector("[data-tree-lab] [data-live]");
      new MutationObserver(() => el.textContent && window.__said.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
    });
    async function tabTo(sel) {
      for (let i = 0; i < 400; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate((s) => document.activeElement?.matches(s), sel)) return true;
      }
      return false;
    }
    const drive = {};
    drive.leaf = await tabTo("[data-leaf='0']");
    await page.keyboard.press("Enter");
    drive.focusKept = await page.evaluate(() => document.activeElement?.dataset.leaf === "0");
    drive.step = await tabTo("[data-act=step]");
    for (let i = 0; i < M.HEIGHTS + 2; i++) await page.keyboard.press("Enter");
    drive.landed = await tabTo("[data-landed='1']");
    await page.keyboard.press("Space");
    drive.plug = await tabTo("[data-act=plug]");
    await page.keyboard.press("Enter");
    drive.imp = await tabTo("[data-act=import]");
    await page.keyboard.press("Enter");
    const got = await trRead(page);
    drive.winner = got.winner;
    drive.v3d = await tabTo("[data-view3d]");
    const wasOn = await page.evaluate(() => document.querySelector("[data-view3d]").getAttribute("aria-pressed"));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    drive.toggled = wasOn !== (await page.evaluate(() => document.querySelector("[data-view3d]").getAttribute("aria-pressed")));
    await page.waitForTimeout(300);
    drive.said = await page.evaluate(() => window.__said);
    // Twelve actions: a write, seven steps (five heights, two beats), the landed count, the plug, the import, the view.
    drive.ok = drive.leaf && drive.focusKept && drive.step && drive.plug && drive.imp && drive.winner === "4211" && drive.toggled && drive.said.length === M.HEIGHTS + 7 && !drive.said.some((t) => /\bcode\b$/.test(t));
    if (!drive.ok) miss(`keyboard-${lang}`, drive, {});
    if (lang === "en") {
      await page.screenshot({ path: join(out, "tree-en-desktop-keyboard.png") });
      report.captures.push("tree-en-desktop-keyboard.png");
    }
    const noFocus = stops.filter((s) => !s.ok).map((s) => s.label);
    if (noFocus.length) miss(`focus-${lang}`, noFocus, []);
    report.keyboard[`tree-${lang}`] = { stops: stops.length, withoutVisibleFocus: noFocus, drive: { ok: drive.ok, said: drive.said.length, winner: drive.winner } };
    // The Hall: Tab to the 3D button, open it, commit from the keyboard.
    await page.goto(base + HALL[lang], { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const hall = {};
    // The ring opens in 3D by itself; from the keyboard: pause it, then 2D and back to 3D.
    await page.locator("[data-ring]").scrollIntoViewIfNeeded();
    await page.waitForSelector(".ring-canvas", { timeout: 30000 });
    await page.locator("body").focus();
    hall.pause = await tabTo("[data-pause]");
    await page.keyboard.press("Enter");
    const t0 = await page.evaluate(() => document.querySelector('[data-field="txg"]').textContent);
    await page.waitForTimeout(3500);
    hall.paused = t0 === (await page.evaluate(() => document.querySelector('[data-field="txg"]').textContent));
    hall.btn = await tabTo("[data-ring3d-btn]");
    await page.keyboard.press("Enter");
    hall.in2d = await page.evaluate(() => document.querySelector("[data-ring3d]").hidden && getComputedStyle(document.querySelector("[data-ring] svg")).display !== "none");
    await page.keyboard.press("Enter");
    hall.canvas = await page.evaluate(() => !document.querySelector("[data-ring3d]").hidden);
    report.keyboard[`hall3d-${lang}`] = hall;
    if (!hall.pause || !hall.paused || !hall.btn || !hall.in2d || !hall.canvas) miss(`hall-keyboard-${lang}`, hall, {});
    await gl.close();
  }
  return R;
}

// Run alone.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = "http://127.0.0.1:4321", out = "shots/tree"] = process.argv.slice(2);
  mkdirSync(out, { recursive: true });
  const VIEWPORTS = {
    iphone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  };
  const report = { base, errors: [], captures: [], keyboard: {} };
  const browser = await chromium.launch({ args: GL_ARGS });
  async function open(ctxOpts, path, theme = "dark") {
    const ctx = await browser.newContext(ctxOpts);
    await ctx.addInitScript((t) => localStorage.setItem("theme", t), theme);
    const page = await ctx.newPage();
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && report.errors.push({ path, type: m.type(), text: m.text() }));
    page.on("pageerror", (e) => report.errors.push({ path, type: "pageerror", text: String(e) }));
    await page.goto(base + path, { waitUntil: "networkidle" });
    return { ctx, page };
  }
  const R = await verifyTree({ browser, open, base, out, report, VIEWPORTS });
  await browser.close();
  writeFileSync(join(out, "report-tree.json"), JSON.stringify(report, null, 2));
  console.log(`${report.captures.length} captures, ${report.errors.length} console errors`);
  for (const e of report.errors) console.log("ERROR", JSON.stringify(e));
  for (const [k, v] of Object.entries(report.keyboard)) console.log("keyboard", k, JSON.stringify(v));
  console.log("tree js", JSON.stringify(R.js));
  console.log("hall", JSON.stringify(R.hall));
  console.log("tree webgl off", JSON.stringify(R.webglOff), "reduced", JSON.stringify(R.reduced), "nojs", JSON.stringify(R.noJs));
  console.log("tree runs", Object.keys(R.runs).length, "mismatches", JSON.stringify(R.mismatches, null, 1));
  if (R.mismatches.length || report.errors.length) process.exitCode = 1;
}
