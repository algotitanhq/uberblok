// The vdevs room in a real browser (brief section 8), called by
// scripts/verify.mjs, or alone against a running build:
//   node scripts/verify-vdevs.mjs http://127.0.0.1:4321 shots/vdevs
// QA's replay against the model (src/lib/vdevs.ts): every kind of block with
// and without log, special and dedup vdevs, special_small_blocks and a special
// class over 75% or full; the I/O down a mirror, a raidz and a dRAID; a
// replacement, a hot spare, the end of the resilver. Then the 3D view
// (SwiftShader), WebGL off, reduced motion, no JavaScript, a keyboard-only
// walk, and the JavaScript transferred before and after the 3D import.
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
const M = await import("../src/lib/vdevs.ts");

export const VD = { id: "vdevs", en: "/en/vdevs/", fr: "/fr/vdevs/", es: "/es/vdevs/" };
/** SwiftShader: software WebGL, so the 3D view renders on a machine without a GPU (brief section 6). */
export const GL_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];

const LABELS = {
  en: { replaceNew: "Replace with a new disk", spare: "Use the hot spare sdp", dspare: "Use the distributed spare draid1-2-0", done: "Resilver done", read: "Read the last block back", restart: "Start again", view3d: "3D view" },
  fr: { replaceNew: "Remplacer par un disque neuf", spare: "Prendre le disque de secours sdp", dspare: "Prendre le secours distribué draid1-2-0", done: "Resilver terminé", read: "Relire le dernier bloc", restart: "Recommencer", view3d: "Vue 3D" },
};

/** What the page shows: the last block, the lit vdevs, the tree. */
const vdRead = (page) =>
  page.evaluate(() => {
    const fig = document.querySelector("[data-vdevs]");
    const head = fig.querySelector("[data-last] .last-head");
    const lit = [...fig.querySelectorAll("[data-tree] .n.on")].map((g) => g.getAttribute("data-node"));
    const leaves = [...fig.querySelectorAll("[data-tree] .n.on.t-disk, [data-tree] .n.on.t-dspare")].map((g) => g.getAttribute("data-node"));
    const tree = [...fig.querySelectorAll("[data-tree] .n")].map((g) => g.getAttribute("data-node"));
    const types = Object.fromEntries([...fig.querySelectorAll("[data-tree] .n")].map((g) => [g.getAttribute("data-node"), [...g.classList].find((c) => c.startsWith("t-")).slice(2)]));
    return {
      kind: head?.dataset.kind ?? null, cls: head?.dataset.cls ?? null, tops: head?.dataset.tops?.split(",") ?? [], io: head?.dataset.io ?? null,
      lit: lit.sort(), leaves: leaves.sort(), tree, types,
      live: fig.querySelector("[data-live]")?.textContent ?? "",
    };
  });

export async function verifyVdevs({ browser, open, base, out, report, VIEWPORTS }) {
  const R = (report.vdevs = { runs: {}, mismatches: [], js: {}, noJs: null, webglOff: null, reduced: null });
  const miss = (where, got, want) => R.mismatches.push({ where, got, want });
  const shot = async (loc, name) => {
    await loc.page().waitForTimeout(500);
    await loc.screenshot({ path: join(out, name) });
    report.captures.push(name);
  };

  for (const lang of ["en", "fr"]) {
    const T = LABELS[lang];
    for (const vp of ["iphone", "desktop"]) {
      const { ctx, page } = await open(VIEWPORTS[vp], VD[lang]);
      const fig = page.locator("[data-vdevs]");
      // 2D for the checks: the 3D view draws the same state (verified below).
      if ((await fig.locator("[data-view3d]").getAttribute("aria-pressed")) === "true") await fig.locator("[data-view3d]").click();
      const k = (x) => `${lang}-${vp}-${x}`;
      let opts = { ...M.DEFAULT_OPTIONS };
      // The page's pool after a pool option: a new pool, then a metadata block and a large file block.
      const fresh = () => [M.writeBlock(M.createPool(opts), "meta").pool].map((p) => M.writeBlock(p, "large").pool)[0];
      let model = fresh();
      const setOpt = async (name, on) => {
        if (opts[name] === on) return;
        await fig.locator(`button[data-opt="${name}"]`).click();
        opts = { ...opts, [name]: on };
        model = fresh();
      };
      const setSmall = async (v) => {
        await fig.locator(`button[data-small="${v}"]`).click();
        opts = { ...opts, smallblk: v };
        model = { ...model, opts: { ...model.opts, smallblk: v } };
      };
      const setFill = async (v) => {
        await fig.locator(`button[data-fill="${v}"]`).click();
        opts = { ...opts, specialFill: v };
        model = { ...model, opts: { ...model.opts, specialFill: v } };
      };
      const drop = async (kind, where) => {
        await fig.locator(`button[data-kind="${kind}"]`).click();
        const r = M.writeBlock(model, kind);
        model = r.pool;
        const got = await vdRead(page);
        const want = { cls: r.block.cls, tops: r.block.dvas.map((d) => d.top), leaves: [...new Set(M.leavesOf(r.trace))].sort() };
        R.runs[k(where)] = { cls: got.cls, tops: got.tops.join(","), leaves: got.leaves.join(",") };
        if (got.cls !== want.cls || got.tops.join() !== want.tops.join() || got.leaves.join() !== want.leaves.join()) miss(k(where), got, want);
        return r;
      };
      // Classes: every kind, in five pools.
      for (const kind of M.KINDS) await drop(kind, `default-${kind}`);
      await shot(fig, `vdevs-${lang}-${vp}-default.png`);
      await setOpt("log", false);
      await setOpt("special", false);
      for (const kind of M.KINDS) await drop(kind, `bare-${kind}`);
      await setOpt("special", true);
      await setSmall(16384);
      for (const kind of ["small", "large", "zil"]) await drop(kind, `small16k-${kind}`);
      await setFill("over75");
      for (const kind of ["small", "meta"]) await drop(kind, `over75-${kind}`);
      await setFill("full");
      for (const kind of ["meta", "ddt", "zil"]) await drop(kind, `full-${kind}`);
      await setOpt("dedup", true);
      await drop("ddt", "dedup-ddt");
      await shot(fig, `vdevs-${lang}-${vp}-full-special-dedup.png`);
      // Fan-out: a bare pool; large blocks go round mirror, raidz, dRAID.
      await setFill("low");
      await setSmall(0);
      await setOpt("special", false);
      await setOpt("dedup", false);
      await fig.getByRole("button", { name: T.restart, exact: true }).click();
      model = M.createPool(opts);
      const seen = new Set();
      for (let i = 0; i < 4; i++) {
        const r = await drop("large", `fanout-${i}`);
        seen.add(model.vdevs[r.block.dvas[0].top].type);
        if (model.vdevs[r.block.dvas[0].top].type === "draid") await shot(fig, `vdevs-${lang}-${vp}-draid-write.png`);
      }
      if (![...["mirror", "raidz", "draid"]].every((t) => seen.has(t))) miss(k("fanout-types"), [...seen], ["mirror", "raidz", "draid"]);
      // A read back of the last block.
      await fig.getByRole("button", { name: T.read, exact: true }).click();
      {
        const last = model.blocks[model.blocks.length - 1];
        const want = [...new Set(M.leavesOf(M.ioTrace(model, last, "read")))].sort();
        const got = await vdRead(page);
        R.runs[k("read")] = { leaves: got.leaves.join(",") };
        if (got.io !== "read" || got.leaves.join() !== want.join()) miss(k("read"), got.leaves, want);
      }
      // Replace sdd (raidz child 1); write until a block lands on the raidz; read it back.
      await fig.locator("[data-pick]").selectOption("sdd");
      await fig.getByRole("button", { name: T.replaceNew, exact: true }).click();
      {
        const r = M.replace(model, "sdd", "new");
        model = r.pool;
        const got = await vdRead(page);
        const want = M.walk(model).map((x) => x.v.id);
        R.runs[k("replace")] = { types: got.types[r.node], tree: got.tree.join(",") };
        if (got.tree.join() !== want.join() || got.types[r.node] !== "replacing") miss(k("replace"), got.tree, want);
        for (let i = 0; i < 3; i++) {
          const w = await drop("large", `replace-write-${i}`);
          if (w.block.dvas[0].top === "raidz") {
            await shot(fig, `vdevs-${lang}-${vp}-replacing-write.png`);
            await fig.getByRole("button", { name: T.read, exact: true }).click();
            const want2 = [...new Set(M.leavesOf(M.ioTrace(model, w.block, "read")))].sort();
            const got2 = await vdRead(page);
            R.runs[k("replace-read")] = { leaves: got2.leaves.join(",") };
            if (got2.leaves.join() !== want2.join()) miss(k("replace-read"), got2.leaves, want2);
          }
        }
      }
      // Hot spare for sda, then the end of the resilver.
      await fig.locator("[data-pick]").selectOption("sda");
      await fig.getByRole("button", { name: T.spare, exact: true }).click();
      model = M.replace(model, "sda", "spare").pool;
      await drop("large", "spare-write");
      await shot(fig.locator(".vd-stage"), `vdevs-${lang}-${vp}-spare.png`);
      await fig.getByRole("button", { name: T.done, exact: true }).click();
      model = M.resilverDone(model).pool;
      {
        const got = await vdRead(page);
        const want = M.walk(model).map((x) => x.v.id);
        R.runs[k("resilver")] = { tree: got.tree.join(",") };
        if (got.tree.join() !== want.join()) miss(k("resilver"), got.tree, want);
      }
      // The distributed spare for a dRAID child.
      await fig.locator("[data-pick]").selectOption("sdf");
      await fig.getByRole("button", { name: T.dspare, exact: true }).click();
      model = M.replace(model, "sdf", "dspare").pool;
      for (let i = 0; i < 3; i++) await drop("large", `dspare-write-${i}`);
      await ctx.close();
    }
  }

  // The 3D view in software WebGL, with the JavaScript it costs.
  {
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
        js.push({ url: r.url().replace(base, ""), raw: body.length, gzip: gzipSync(body).length, t: Date.now() });
      } catch {}
    });
    await page.goto(base + VD.en, { waitUntil: "networkidle" });
    const sum = (xs) => xs.reduce((a, x) => ({ raw: a.raw + x.raw, gzip: a.gzip + x.gzip }), { raw: 0, gzip: 0 });
    R.js.before = { ...sum(js), files: js.map((x) => x.url) };
    const n0 = js.length;
    const fig = page.locator("[data-vdevs]");
    await fig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    // 2D first: in view on a wide desktop, nothing 3D is fetched or drawn before the press.
    R.js.first = await page.evaluate(() => ({ pressed: document.querySelector("[data-view3d]").getAttribute("aria-pressed"), canvas: !!document.querySelector(".vd-canvas") }));
    R.js.auto3d = n0 === js.length && !R.js.first.canvas ? "button" : "on view";
    if (R.js.auto3d !== "button" || R.js.first.pressed !== "false") miss("2d-first", R.js.first, {});
    await fig.locator("[data-view3d]").click();
    await page.waitForSelector(".vd-canvas");
    await page.waitForLoadState("networkidle");
    R.js.after3d = { ...sum(js), files: js.slice(n0).map((x) => x.url) };
    for (const kind of ["meta", "large"]) await fig.locator(`button[data-kind="${kind}"]`).click();
    await page.waitForTimeout(2600);
    await fig.locator(".vd-stage").screenshot({ path: join(out, "vdevs-en-desktop-3d.png") });
    report.captures.push("vdevs-en-desktop-3d.png");
    // A click on a node in 3D selects it (the ops panel follows).
    const box = await page.locator(".vd-canvas").boundingBox();
    await page.locator(".vd-canvas").focus();
    for (const key of ["ArrowLeft", "ArrowUp", "+"]) await page.keyboard.press(key);
    R.js.canvas = { width: Math.round(box.width), height: Math.round(box.height), errors };
    // And back to 2D.
    await fig.locator("[data-view3d]").click();
    R.js.back2d = await page.evaluate(() => ({ tree: !document.querySelector("[data-vdevs] [data-tree]").hidden, canvas: !document.querySelector("[data-vdevs] [data-3d]").hidden, pressed: document.querySelector("[data-view3d]").getAttribute("aria-pressed") }));
    if (!R.js.back2d.tree || R.js.back2d.canvas || R.js.back2d.pressed !== "false") miss("back-to-2d", R.js.back2d, {});
    await ctx.addInitScript(() => localStorage.setItem("theme", "light"));
    const p2 = await ctx.newPage();
    await p2.goto(base + VD.fr, { waitUntil: "networkidle" });
    const f2 = p2.locator("[data-vdevs]");
    await f2.scrollIntoViewIfNeeded();
    await p2.waitForTimeout(800);
    await f2.locator("[data-view3d]").click();
    await p2.waitForSelector(".vd-canvas");
    await f2.locator("[data-pick]").selectOption("sdf");
    await f2.getByRole("button", { name: LABELS.fr.dspare, exact: true }).click();
    for (let i = 0; i < 6; i++) await f2.locator('button[data-kind="large"]').click();
    await p2.waitForTimeout(2600);
    await f2.locator(".vd-stage").screenshot({ path: join(out, "vdevs-fr-desktop-3d-light-dspare.png") });
    report.captures.push("vdevs-fr-desktop-3d-light-dspare.png");
    if (errors.length) miss("3d-errors", errors, []);
    await gl.close();
  }

  // WebGL off: the 2D view stays, the 3D button is shown disabled, the note says why.
  {
    const nogl = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis"] });
    const ctx = await nogl.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    await page.goto(base + VD.en, { waitUntil: "networkidle" });
    await page.locator("[data-vdevs]").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    // A press on the disabled button (Playwright would wait for it to be enabled).
    await page.locator("[data-view3d]").click({ force: true });
    R.webglOff = await page.evaluate(() => ({
      button: !document.querySelector("[data-view3d]").hidden,
      disabled: document.querySelector("[data-view3d]").getAttribute("aria-disabled"),
      note: !document.querySelector("[data-no3d]").hidden && document.querySelector("[data-no3d]").textContent,
      canvas: !!document.querySelector(".vd-canvas"),
      tree: !document.querySelector("[data-tree]").hidden,
      scripts: performance.getEntriesByType("resource").filter((e) => /vdevs-3d/.test(e.name)).length,
    }));
    if (!R.webglOff.button || R.webglOff.disabled !== "true" || !/WebGL/.test(R.webglOff.note) || R.webglOff.canvas || !R.webglOff.tree || R.webglOff.scripts) miss("webgl-off", R.webglOff, {});
    await page.locator("[data-vdevs]").screenshot({ path: join(out, "vdevs-en-desktop-webgl-off.png") });
    report.captures.push("vdevs-en-desktop-webgl-off.png");
    await nogl.close();
  }

  // Reduced motion: the 3D button disabled with its reason, a press does nothing, nothing animates after a write.
  {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop, reducedMotion: "reduce" });
    // The reason shown beside the disabled 3D button must not move the page.
    await ctx.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__cls += e.value))).observe({ type: "layout-shift", buffered: true });
    });
    const page = await ctx.newPage();
    await page.goto(base + VD.en, { waitUntil: "networkidle" });
    const fig = page.locator("[data-vdevs]");
    await fig.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await fig.locator("[data-view3d]").click({ force: true });
    await fig.locator('button[data-kind="ddt"]').click();
    R.reduced = await page.evaluate(() => ({
      pressed: document.querySelector("[data-view3d]").getAttribute("aria-pressed"),
      disabled: document.querySelector("[data-view3d]").getAttribute("aria-disabled"),
      note: !document.querySelector("[data-no3d]").hidden && document.querySelector("[data-no3d]").textContent,
      canvas: !!document.querySelector(".vd-canvas"),
      cls: window.__cls,
      running: document.getAnimations().filter((a) => a.playState === "running").length,
    }));
    if (R.reduced.pressed !== "false" || R.reduced.disabled !== "true" || !/[Rr]educed motion/.test(R.reduced.note) || R.reduced.canvas || R.reduced.running) miss("reduced-motion", R.reduced, {});
    await fig.screenshot({ path: join(out, "vdevs-en-desktop-reduced-motion.png") });
    report.captures.push("vdevs-en-desktop-reduced-motion.png");
    await gl.close();
  }

  // No JavaScript: the first state is in the page, the controls hidden.
  {
    const ctx = await browser.newContext({ ...VIEWPORTS.iphone, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(base + VD.en);
    R.noJs = await page.evaluate(() => ({
      nodes: document.querySelectorAll("[data-vdevs] [data-tree] .n").length,
      lit: [...document.querySelectorAll("[data-vdevs] [data-tree] .n.on")].map((g) => g.getAttribute("data-node")).join(","),
      last: document.querySelector("[data-vdevs] .last-head")?.dataset.cls,
      barsHidden: [...document.querySelectorAll("[data-vdevs] .vd-bar")].every((b) => b.hidden),
    }));
    if (!R.noJs.barsHidden || R.noJs.nodes < 15 || R.noJs.last !== "normal" || R.noJs.lit !== "mirror,sda,sdb") miss("nojs", R.noJs, {});
    await page.screenshot({ path: join(out, "vdevs-en-iphone-nojs.png"), fullPage: true });
    report.captures.push("vdevs-en-iphone-nojs.png");
    await ctx.close();
  }

  // Keyboard only: every stop has a visible focus; drive the figure from the keyboard.
  for (const lang of ["en", "fr"]) {
    const gl = await chromium.launch({ args: GL_ARGS });
    const ctx = await gl.newContext({ ...VIEWPORTS.desktop });
    const page = await ctx.newPage();
    await page.goto(base + VD[lang], { waitUntil: "networkidle" });
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
    await page.goto(base + VD[lang], { waitUntil: "networkidle" });
    await page.evaluate(() => {
      window.__said = [];
      const el = document.querySelector("[data-vdevs] [data-live]");
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
    drive.meta = await tabTo('button[data-kind="meta"]');
    await page.keyboard.press("Enter");
    drive.metaCls = (await vdRead(page)).cls;
    drive.focusKept = await page.evaluate(() => document.activeElement?.dataset.kind === "meta");
    drive.pick = await tabTo("[data-pick]");
    await page.keyboard.press("ArrowUp"); // sdd -> sdc
    drive.picked = await page.evaluate(() => document.querySelector("[data-pick]").value);
    drive.rep = await tabTo('button[data-rep="new"]');
    await page.keyboard.press("Space");
    drive.tree = (await vdRead(page)).types;
    drive.replaced = Object.values(drive.tree).includes("replacing");
    drive.v3d = await tabTo("button[data-view3d]");
    const wasOn = await page.evaluate(() => document.querySelector("[data-view3d]").getAttribute("aria-pressed"));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    drive.toggled = wasOn !== (await page.evaluate(() => document.querySelector("[data-view3d]").getAttribute("aria-pressed")));
    await page.waitForTimeout(300);
    drive.said = await page.evaluate(() => window.__said);
    // Four actions: a write, a selection, a replacement, the view.
    drive.ok = drive.meta && drive.metaCls === "special" && drive.focusKept && drive.picked === "sdc" && drive.replaced && drive.toggled && drive.said.length === 4 && !drive.said.some((t) => /\bcode\b$/.test(t));
    if (!drive.ok) miss(`keyboard-${lang}`, drive, {});
    if (lang === "en") {
      await page.screenshot({ path: join(out, "vdevs-en-desktop-keyboard.png") });
      report.captures.push("vdevs-en-desktop-keyboard.png");
    }
    const noFocus = stops.filter((s) => !s.ok).map((s) => s.label);
    if (noFocus.length) miss(`focus-${lang}`, noFocus, []);
    report.keyboard[`vdevs-${lang}`] = { stops: stops.length, withoutVisibleFocus: noFocus, drive: { ok: drive.ok, said: drive.said.length, picked: drive.picked } };
    await gl.close();
  }
  return R;
}

// Run alone.
if (import.meta.url === `file://${process.argv[1]}`) {
  const [base = "http://127.0.0.1:4321", out = "shots/vdevs"] = process.argv.slice(2);
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
  const R = await verifyVdevs({ browser, open, base, out, report, VIEWPORTS });
  await browser.close();
  writeFileSync(join(out, "report-vdevs.json"), JSON.stringify(report, null, 2));
  console.log(`${report.captures.length} captures, ${report.errors.length} console errors`);
  for (const e of report.errors) console.log("ERROR", JSON.stringify(e));
  for (const [k, v] of Object.entries(report.keyboard)) console.log("keyboard", k, JSON.stringify(v));
  console.log("vdevs js", JSON.stringify(R.js));
  console.log("vdevs webgl off", JSON.stringify(R.webglOff), "reduced", JSON.stringify(R.reduced), "nojs", JSON.stringify(R.noJs));
  console.log("vdevs runs", Object.keys(R.runs).length, "mismatches", JSON.stringify(R.mismatches, null, 1));
  if (R.mismatches.length || report.errors.length) process.exitCode = 1;
}
