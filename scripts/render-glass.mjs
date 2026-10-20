// Renders the Hall's exhibit, "Fig. 1": the uberblock under a reading glass.
// A strip of fan-fold listing paper carries lines 36-150 of
// include/sys/uberblock_impl.h, cut from OpenZFS zfs-2.4.4 (the frozen commit,
// read from a clone with `git show`, never typed); a round reading glass held
// above it magnifies `struct uberblock` (lines 122-128). DECISIONS.md D16.4.
//
// How: one WebGL2 fragment shader in headless Chromium ray-traces the scene in
// millimetres. The glass is a real biconvex lens (two spheres, BK7, refracted
// twice, a little dispersion at the rim, total internal reflection), so the text
// under it is the same texture seen through it, at the magnification its optics
// give. The lamp's light through the lens makes the caustic and the shadow on the
// paper the same way. The paper is a canvas texture drawn from the source text
// (DejaVu Sans Mono, checked by hash, so that the render is the same on every
// run), coloured as the site colours code. A second pass writes, for each pixel,
// the point of the page it shows, so the plate's callouts land where each token
// is actually seen, through the glass or not. Transparent ground, supersampled 2x.
// No randomness at all.
//
//   node scripts/render-glass.mjs <openzfs-clone> [out.webp] [plate.json]
//        (default: src/assets/glass.webp, src/assets/glass-plate.json)
//
// Chromium needs WebGL: on a machine without a GPU, SwiftShader is used.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [clone, out = join(root, "src/assets/glass.webp"), outPlate = join(root, "src/assets/glass-plate.json")] = process.argv.slice(2);
if (!clone) {
  console.error("usage: render-glass.mjs <openzfs-clone> [out.webp] [plate.json]");
  process.exit(2);
}

// The code: the frozen commit only (src/lib/openzfs.ts), lines 36-150 printed,
// 122-128 under the glass.
const SHA = "71a9f9578616a90c3c14bb59629fb4d31bfd68d1";
const TAG = "zfs-2.4.4";
const FILE = "include/sys/uberblock_impl.h";
const FIRST = 36, LAST = 150, LENS = [122, 128];
const source = execFileSync("git", ["-C", clone, "show", `${SHA}:${FILE}`], { encoding: "utf8" }).split("\n");
if (!/SPDX-License-Identifier: CDDL-1\.0/.test(source[0])) throw new Error(`${FILE}: not CDDL-1.0`);
const raw = source.slice(FIRST - 1, LAST);
// Tabs to the next multiple of 8, as the source is meant to be read.
const expand = (s) => s.replace(/[^\t]*\t/g, (m) => { const t = m.slice(0, -1); return t + " ".repeat(8 - (t.length % 8)); });
const lines = raw.map(expand);
if (lines[122 - FIRST].trim() !== "struct uberblock {" || !lines[46 - FIRST].includes("0x00bab10c")) throw new Error("the excerpt moved");

// The fonts: the listing's monospace, by path and hash (a system font is
// resolved per machine otherwise), and the site's Inter for the running head.
const MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf";
const MONO_SHA256 = "c805f9436dbc268644c1d9584f01a601a653e028e08fd74b9b949f6cf8304d88";
const mono = await readFile(MONO);
if (createHash("sha256").update(mono).digest("hex") !== MONO_SHA256) throw new Error(`${MONO}: not the expected DejaVu Sans Mono`);
const inter = await readFile(join(root, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"));

// The master: 5:4, as the v1.2 exhibit, larger than the largest served width.
const W = 1800, H = 1440, SS = 2;

const page = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">
<script type="module">
const LINES = ${JSON.stringify(lines)};
const FIRST = ${FIRST}, LENS = ${JSON.stringify(LENS)};
const W = ${W * SS}, H = ${H * SS};
const HEAD = ${JSON.stringify(`${FILE} · ${TAG} · ${SHA.slice(0, 12)}`)};
const mono = new FontFace("Mono", "url(data:font/ttf;base64,${mono.toString("base64")})");
const inter = new FontFace("Inter", "url(data:font/woff2;base64,${inter.toString("base64")})", { weight: "100 900" });
await Promise.all([mono.load(), inter.load()]);
document.fonts.add(mono);
document.fonts.add(inter);

// ---------------------------------------------------------------- the paper
// Fan-fold listing paper, in millimetres: 12 characters and 6 lines to the inch,
// 13 mm pin-feed margins with 4 mm holes every half inch.
const PW = 215, MARGIN = 13, CW = 25.4 / 12, LH = 25.4 / 6, TOP = 16, BOTTOM = 90; // blank paper after the last line, where the glass's shadow falls
const PL = TOP + LINES.length * LH + BOTTOM;
const GUTTER = MARGIN + 3; // the line numbers' left edge
const TEXT = GUTTER + 4 * CW; // the code's left edge: three digits and a space
const lineY = (n) => TOP + (n - FIRST) * LH; // top of line n
const colX = (c) => TEXT + c * CW;

// The site's light code colours (src/styles/tokens.css), as Shiki colours the excerpts.
const INK = { text: "#1f1b16", comment: "#6b6256", keyword: "#a2461e", type: "#6a3fa0", number: "#8a5a00", gutter: "#6e6559" };
const KEYWORDS = new Set(["struct", "union", "enum", "typedef", "do", "while", "if", "else", "for", "return", "static", "extern", "const", "void", "int", "char", "unsigned", "sizeof"]);
// One line into coloured runs; \`open\` says whether a /* comment runs on from the line before.
function runs(line, open) {
  const out = [];
  let i = 0;
  const push = (text, kind) => text && out.push([text, kind]);
  while (i < line.length) {
    if (open) {
      const e = line.indexOf("*/", i);
      if (e < 0) { push(line.slice(i), "comment"); return [out, true]; }
      push(line.slice(i, e + 2), "comment"); i = e + 2; open = false; continue;
    }
    const rest = line.slice(i);
    let m;
    if (rest.startsWith("/*")) { open = true; continue; }
    if ((m = /^#\\s*\\w+/.exec(rest))) { push(m[0], "keyword"); i += m[0].length; continue; }
    if ((m = /^0x[0-9a-fA-F]+|^\\d+/.exec(rest)) && !/\\w/.test(line[i - 1] ?? "")) { push(m[0], "number"); i += m[0].length; continue; }
    if ((m = /^[A-Za-z_]\\w*/.exec(rest))) {
      push(m[0], KEYWORDS.has(m[0]) ? "keyword" : /_t$/.test(m[0]) ? "type" : "text");
      i += m[0].length; continue;
    }
    push(line[i], "text"); i++;
  }
  return [out, open];
}

// The page as a canvas at \`ppm\` pixels per millimetre, over [y0, y1] of the strip.
function sheet(ppm, y0, y1) {
  const c = document.createElement("canvas");
  c.width = Math.round(PW * ppm);
  c.height = Math.round((y1 - y0) * ppm);
  const g = c.getContext("2d");
  g.scale(ppm, ppm);
  g.translate(0, -y0);
  // Paper, very slightly warmer toward the margins.
  g.fillStyle = "#e6dbc3";
  g.fillRect(0, y0, PW, y1 - y0);
  g.fillStyle = "#ddd0b4";
  g.fillRect(0, y0, MARGIN, y1 - y0);
  g.fillRect(PW - MARGIN, y0, MARGIN, y1 - y0);
  // The pin-feed perforations: a dotted line at each margin.
  g.fillStyle = "#c9bb9c";
  for (let y = 0; y < PL; y += 1.6) { g.fillRect(MARGIN - 0.15, y, 0.3, 0.8); g.fillRect(PW - MARGIN - 0.15, y, 0.3, 0.8); }
  // The highlighter over struct uberblock, multiplied into the paper.
  // Line by line, over each line's code (not its comment), so the mark follows the struct's shape.
  g.globalCompositeOperation = "multiply";
  g.fillStyle = "rgb(242 193 78 / 0.55)";
  for (let n = LENS[0]; n <= LENS[1]; n++) {
    const t = LINES[n - FIRST];
    const code = t.split("/*")[0].trimEnd();
    const a = code.search(/\S/), b = code.length;
    g.fillRect(colX(a) - 0.8, lineY(n) + 0.3, (b - a) * CW + 1.6, LH - 0.1);
  }
  g.globalCompositeOperation = "source-over";
  // The running head: our label, not code.
  g.font = "500 2.6px Inter";
  g.fillStyle = INK.gutter;
  g.textBaseline = "alphabetic";
  g.fillText(HEAD, TEXT, TOP - 5.2);
  g.fillRect(TEXT, TOP - 3.6, 79 * CW, 0.12);
  // The listing.
  g.font = "3.45px Mono";
  let open = false;
  LINES.forEach((line, k) => {
    const n = FIRST + k;
    const base = lineY(n) + LH * 0.74;
    g.fillStyle = INK.gutter;
    g.textAlign = "right";
    g.fillText(String(n), TEXT - CW, base);
    g.textAlign = "left";
    const [rs, o] = runs(line, open);
    open = o;
    let col = 0;
    for (const [text, kind] of rs) {
      g.fillStyle = INK[kind];
      // One glyph per cell, so the columns stay true to the source's.
      for (const ch of text) { if (ch !== " ") g.fillText(ch, colX(col), base); col++; }
    }
  });
  // The magic number, underlined in amber.
  const m = LINES[46 - FIRST].indexOf("0x00bab10c");
  g.fillStyle = "#c8742f";
  g.fillRect(colX(m), lineY(46) + LH * 0.86, 10 * CW, 0.55);
  // The sprocket holes, cut out: the ground shows through on both themes.
  g.globalCompositeOperation = "destination-out";
  for (let y = 6.35; y < PL; y += 12.7) for (const x of [MARGIN / 2, PW - MARGIN / 2]) { g.beginPath(); g.arc(x, y, 2, 0, 2 * Math.PI); g.fill(); }
  return c;
}

// The whole strip at 12 px/mm, and the lines under the glass at 32 px/mm.
const FULL = { ppm: 12, y0: 0, y1: PL };
const CROP = { ppm: 32, y0: lineY(110), y1: lineY(144) };
const full = sheet(FULL.ppm, FULL.y0, FULL.y1);
const crop = sheet(CROP.ppm, CROP.y0, CROP.y1);
// A canvas too large for the browser draws nothing: check that each sheet holds paper.
for (const c of [full, crop]) if (c.getContext("2d").getImageData(c.width - 2, Math.round(c.height / 2), 1, 1).data[0] < 150) throw new Error("a paper sheet is blank");

// ---------------------------------------------------------------- the scene
// World: z up, the table at z = 0. The strip lies along -y (line 36 farthest),
// turned by PHI about z; one crease (a ridge) across it.
const LENS_R = 60, LENS_T = 20, LENS_RC = 220, IOR = 1.517; // a 120 mm BK7 biconvex
// Thick-lens focal length, and the height for a magnification of 1.5 (M = f / (f - d)):
// the struct's 37 columns, 78 mm of print, fit in the 120 mm glass.
const F = 1 / ((IOR - 1) * (2 / LENS_RC - ((IOR - 1) * LENS_T) / (IOR * LENS_RC * LENS_RC)));
const MAG = 1.5;
const DH = F * (1 - 1 / MAG);
// The glass centred on line 125, column 18.5, the middle of the struct: all of it inside.
const aimPage = [colX(18.5), lineY(125) + LH * 0.5];

const canvas = document.createElement("canvas");
canvas.width = W; canvas.height = H;
document.body.append(canvas);
const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false });
if (!gl) throw new Error("no WebGL2");

const vs = \`#version 300 es
in vec2 p; out vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0, 1); }\`;
const fs = \`#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D tFull, tCrop;
uniform vec3 camPos, camFwd, camRight, camUp;
uniform float tanHalf, aspect;
uniform vec3 lensC, lensA, lampPos;
uniform vec2 aim;
uniform int mode;
uniform float focusDist;
uniform float PIX; // the angle of one pixel
uniform vec2 vigC; // the fade's centre (uv)
const float PW = \${PW.toFixed(4)}, PL = \${PL.toFixed(4)};
const float R = \${LENS_R.toFixed(1)}, T = \${LENS_T.toFixed(1)}, RC = \${LENS_RC.toFixed(1)}, IORc = \${IOR};
const float FOC = \${F.toFixed(4)};
const vec3 CROP = vec3(\${CROP.y0.toFixed(4)}, \${CROP.y1.toFixed(4)}, 0.0);
const float RIM_W = 6.0, RIM_H = 5.5;
// Handle: from the rim, down and to the right, in the lens plane.
uniform vec3 hA, hB, hC; // ferrule start, ferrule end / grip start, grip end
const float FER_R = 6.0, GRIP_R = 8.5;

// Strip coordinates <-> world. The strip's top (line 36) at +y, its left edge at -x.
uniform vec2 sOrigin; // world xy of the page point (0, 0)
uniform float phi;
vec2 toPage(vec3 w) {
  vec2 d = w.xy - sOrigin; float c = cos(phi), s = sin(phi);
  vec2 r = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  return vec2(r.x, -r.y);
}
// The crease: a ridge across the strip, 3.5 mm high, on 70 mm each side.
const float CREASE = \${(lineY(76)).toFixed(3)};
float height(vec2 pg) { return 3.5 * max(0.0, 1.0 - abs(pg.y - CREASE) / 70.0); }
float dheight(vec2 pg) { float d = pg.y - CREASE; return abs(d) < 70.0 ? -3.5 / 70.0 * sign(d) : 0.0; }

vec3 srgb2lin(vec3 c) { return pow(c, vec3(2.2)); }
// The mip level from the pixel's footprint on the page (mm), not from implicit
// derivatives: those are undefined in branches, and the render must not vary.
vec4 paper(vec2 pg, float foot, float bias) {
  if (pg.x < 0.0 || pg.x > PW || pg.y < 0.0 || pg.y > PL) return vec4(0);
  vec4 t;
  if (pg.y > CROP.x && pg.y < CROP.y) t = textureLod(tCrop, vec2(pg.x / PW, (pg.y - CROP.x) / (CROP.y - CROP.x)), max(0.0, log2(foot * \${CROP.ppm}.0) + bias));
  else t = textureLod(tFull, vec2(pg.x / PW, pg.y / PL), max(0.0, log2(foot * \${FULL.ppm}.0) + bias));
  // The far end fades out; the near end too, before the frame.
  float fade = smoothstep(0.0, 22.0, pg.y) * (1.0 - smoothstep(PL - 40.0, PL - 5.0, pg.y));
  return vec4(srgb2lin(t.rgb), t.a * fade);
}

// ---- intersections (t of the hit, or -1)
float sphere(vec3 ro, vec3 rd, vec3 c, float r, bool far) {
  vec3 oc = ro - c; float b = dot(oc, rd), q = dot(oc, oc) - r * r, h = b * b - q;
  if (h < 0.0) return -1.0; h = sqrt(h);
  float t = far ? -b + h : -b - h;
  return t > 1e-3 ? t : -1.0;
}
float capsule(vec3 ro, vec3 rd, vec3 pa, vec3 pb, float r) { // Inigo Quilez
  vec3 ba = pb - pa, oa = ro - pa;
  float baba = dot(ba, ba), bard = dot(ba, rd), baoa = dot(ba, oa), rdoa = dot(rd, oa), oaoa = dot(oa, oa);
  float a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba, h = b * b - a * c;
  if (h >= 0.0) {
    float t = (-b - sqrt(h)) / a, y = baoa + t * bard;
    if (y > 0.0 && y < baba && t > 1e-3) return t;
    vec3 oc = (y <= 0.0) ? oa : ro - pb;
    b = dot(rd, oc); c = dot(oc, oc) - r * r; h = b * b - c;
    if (h > 0.0) { t = -b - sqrt(h); if (t > 1e-3) return t; }
  }
  return -1.0;
}
vec3 capNormal(vec3 p, vec3 a, vec3 b, float r) { vec3 ba = b - a, pa = p - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return (pa - h * ba) / r; }
// The rim: a ring around the lens axis, radii R..R+RIM_W, heights -RIM_H..RIM_H.
float rim(vec3 ro, vec3 rd, out vec3 n) {
  vec3 a = lensA; vec3 o = ro - lensC;
  float best = 1e9; n = vec3(0);
  // Caps.
  for (int s = -1; s <= 1; s += 2) {
    float den = dot(rd, a);
    if (abs(den) > 1e-5) {
      float t = (float(s) * RIM_H - dot(o, a)) / den;
      vec3 q = o + t * rd; float r = length(q - dot(q, a) * a);
      if (t > 1e-3 && t < best && r > R && r < R + RIM_W) { best = t; n = float(s) * a; }
    }
  }
  // Outer and inner walls.
  vec3 rdp = rd - dot(rd, a) * a, op = o - dot(o, a) * a;
  float A = dot(rdp, rdp), B = dot(op, rdp);
  for (int k = 0; k < 2; k++) {
    float rr = k == 0 ? R + RIM_W : R;
    float C = dot(op, op) - rr * rr, h = B * B - A * C;
    if (h < 0.0 || A < 1e-8) continue;
    h = sqrt(h);
    for (int s = -1; s <= 1; s += 2) {
      float t = (-B + float(s) * h) / A;
      vec3 q = o + t * rd; float y = dot(q, a);
      if (t > 1e-3 && t < best && abs(y) < RIM_H) { best = t; vec3 radial = normalize(q - y * a); n = k == 0 ? radial : -radial; }
    }
  }
  return best < 1e9 ? best : -1.0;
}

// The lens surfaces: the top one belongs to the sphere centred below, and the reverse.
vec3 cTop() { return lensC + lensA * (T * 0.5 - RC); }
vec3 cBot() { return lensC - lensA * (T * 0.5 - RC); }
float radial(vec3 p) { vec3 q = p - lensC; return length(q - dot(q, lensA) * lensA); }

// The lamp: light at a point, a warm reading lamp out of frame, upper right.
// How much of it reaches p, through or around the glass, the rim and the handle.
float light(vec3 p) {
  vec3 l = lampPos - p; float dl = length(l); l /= dl;
  float s = 1.0;
  // Rim and handle: soft shadows, by how close the ray passes.
  vec3 nn;
  float tr = rim(p, l, nn);
  // A broad shade, not a point: the rim's shadow is a soft grey, not black, so it
  // reads as a shadow on the paper rather than a second ring.
  if (tr > 0.0 && tr < dl) s = 0.45;
  // The handle, softened by its distance to the light ray.
  for (int k = 0; k < 2; k++) {
    vec3 a = k == 0 ? hA : hB, b = k == 0 ? hB : hC; float r = k == 0 ? FER_R : GRIP_R;
    vec3 u = normalize(b - a); vec3 w = cross(l, u); float wl = length(w);
    if (wl < 1e-4) continue; w /= wl;
    float d = abs(dot(p - a, w));
    // Where along the light ray the closest approach is: ahead of p only.
    vec3 n2 = cross(u, w); float tl = dot(a - p, n2) / dot(l, n2);
    vec3 q = p + tl * l; float along = dot(q - a, u);
    if (tl > 0.0 && along > -r && along < length(b - a) + r) s *= smoothstep(r - 2.0, r + 3.0 + 0.04 * tl, d);
  }
  // The glass: the light that crossed it at radius rho lands at rho * (1 - d / f),
  // so the paper sees a bright spot and a dark ring around it.
  float den = dot(l, lensA);
  if (abs(den) > 1e-4) {
    float t = dot(lensC - p, lensA) / den;
    if (t > 0.0) {
      vec3 q = p + t * l; float rho = radial(q);
      float sc = clamp(1.0 - t / FOC, 0.25, 1.0);
      float pen = 6.0 + 0.14 * t; // the lamp is a broad shade, not a point
      float inside = 1.0 - smoothstep(R * sc - pen, R * sc + pen, rho);
      float under = 1.0 - smoothstep(R - pen, R + pen, rho);
      s *= mix(1.0, mix(0.78, min(2.0, 1.0 / (sc * sc)), inside), under);
    }
  }
  return s;
}

// Paper or table at the end of a ray: premultiplied colour and coverage, and
// the page point it shows (for the anchors).
vec4 ground(vec3 ro, vec3 rd, out vec2 pgOut, float foot0, float scale, float bias) {
  pgOut = vec2(-1);
  if (rd.z >= -1e-4) return vec4(0);
  float t = -ro.z / rd.z; vec3 p = ro + t * rd; vec2 pg = toPage(p);
  for (int i = 0; i < 3; i++) { float h = height(pg); t = (h - ro.z) / rd.z; p = ro + t * rd; pg = toPage(p); }
  // The footprint: the pixel's angle times the path length, stretched by the grazing angle.
  float foot = (foot0 + t) * PIX * scale / sqrt(max(-rd.z, 0.05));
  vec4 pc = paper(pg, foot, bias);
  // Lighting: the lamp's pool, centred on the glass, falls to about half at the ends.
  float dh = dheight(pg);
  float c = cos(phi), s = sin(phi);
  // Normal of the crease: the slope is along the strip's -y, i.e. world (s, c) in the plane.
  vec3 n = normalize(vec3(-dh * s, dh * c, 1.0));
  vec3 l = normalize(lampPos - p);
  float pool = mix(0.5, 1.0, exp(-dot(pg - aim, pg - aim) / (2.0 * 150.0 * 150.0)));
  float lit = light(p);
  vec3 key = vec3(1.0, 0.86, 0.68) * 1.05 * max(dot(n, l), 0.0) * lit * pool;
  vec3 fill = vec3(0.93, 0.93, 0.95) * 0.28;
  vec3 col = pc.rgb * (key + fill);
  // The table: transparent, but it takes the shadows of the glass and the handle.
  float shade = (1.0 - min(lit, 1.0)) * 0.07 * pool;
  vec3 shadowCol = vec3(0.02, 0.012, 0.006);
  float a = pc.a + (1.0 - pc.a) * shade;
  vec3 premul = col * pc.a + shadowCol * (1.0 - pc.a) * shade;
  if (pc.a > 0.01) pgOut = pg;
  return vec4(premul, a);
}

vec3 env(vec3 d) {
  // A dim warm room, a softbox window high on the left, the lamp upper right.
  vec3 c = vec3(0.03, 0.025, 0.02);
  vec3 w = normalize(vec3(-0.5, 0.6, 0.62));
  c += vec3(1.0, 0.97, 0.92) * 1.4 * smoothstep(0.93, 0.97, dot(d, w));
  vec3 lamp = normalize(lampPos - lensC);
  c += vec3(1.0, 0.8, 0.55) * 6.0 * smoothstep(0.995, 0.999, dot(d, lamp));
  return c;
}
float fresnel(float c) { return 0.04 + 0.96 * pow(1.0 - c, 5.0); }

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// Through the lens at one index: the ray out of the back face, or none.
bool through(vec3 ro, vec3 rd, float t0, float eta, out vec3 o2, out vec3 d2) {
  vec3 p = ro + t0 * rd; vec3 n = normalize(p - cTop());
  vec3 d = refract(rd, n, 1.0 / eta);
  float t1 = sphere(p, d, cBot(), RC, true);
  if (t1 < 0.0) return false;
  vec3 q = p + t1 * d;
  if (radial(q) > R) return false; // out through the edge: hidden by the rim
  vec3 nb = normalize(q - cBot());
  vec3 e = refract(d, -nb, eta);
  if (dot(e, e) < 0.5) return false; // total internal reflection
  o2 = q; d2 = e; return true;
}

void main() {
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rd = normalize(camFwd + ndc.x * tanHalf * aspect * camRight + ndc.y * tanHalf * camUp);
  vec3 ro = camPos;
  // Depth of field: a mip bias with the distance from the glass's plane of focus.
  float focus = focusDist;
  // Nearest of: lens top, rim, handle, ground.
  float tl = sphere(ro, rd, cTop(), RC, false);
  if (tl > 0.0 && radial(ro + tl * rd) > R) tl = -1.0;
  vec3 rn; float tr = rim(ro, rd, rn);
  float tf = capsule(ro, rd, hA, hB, FER_R), tg = capsule(ro, rd, hB, hC, GRIP_R), tk = sphere(ro, rd, hC, GRIP_R + 2.5, false);
  float best = 1e9; int hit = 0;
  if (tl > 0.0 && tl < best) { best = tl; hit = 1; }
  if (tr > 0.0 && tr < best) { best = tr; hit = 2; }
  if (tf > 0.0 && tf < best) { best = tf; hit = 3; }
  if (tg > 0.0 && tg < best) { best = tg; hit = 4; }
  if (tk > 0.0 && tk < best) { best = tk; hit = 5; }
  vec2 pg;
  vec4 c;
  if (hit == 0) {
    float tz = -ro.z / rd.z;
    c = ground(ro, rd, pg, 0.0, 1.0, clamp(abs(tz - focus) / 70.0, 0.0, 1.6) - 0.35);
  } else if (hit == 1) {
    vec3 p = ro + best * rd; vec3 n = normalize(p - cTop());
    float f = fresnel(max(dot(-rd, n), 0.0));
    float edge = radial(p) / R;
    // Dispersion near the rim only: three indices, one per channel.
    vec3 o2, d2; vec4 acc = vec4(0); vec2 pgc = vec2(-1);
    float spread = smoothstep(0.6, 1.0, edge) * 0.0015;
    for (int k = 0; k < 3; k++) {
      float eta = IORc + (float(k) - 1.0) * spread;
      vec2 pk; vec4 g = vec4(0);
      if (through(ro, rd, best, eta, o2, d2)) {
        float tz = length(o2 - camPos) + (-o2.z / d2.z);
        g = ground(o2, d2, pk, length(o2 - camPos), 1.0 / 1.6, clamp(abs(tz - focus) / 70.0, 0.0, 1.6) - 0.35);
        if (k == 1) pgc = pk;
      }
      if (k == 0) acc.r = g.r; else if (k == 1) { acc.g = g.g; acc.a = g.a; } else acc.b = g.b;
    }
    pg = pgc;
    // Glass: a faint grey-green body, a dark band at the very edge, the reflection.
    vec3 tint = vec3(0.97, 0.985, 0.975) * (1.0 - 0.55 * smoothstep(0.9, 1.0, edge));
    vec3 refl = env(reflect(rd, n)) * f;
    float body = 0.05 + 0.25 * smoothstep(0.85, 1.0, edge);
    c.rgb = acc.rgb * tint * (1.0 - f) + refl + vec3(0.01) * body;
    c.a = clamp(acc.a * (1.0 - f) + body + dot(refl, vec3(0.3)), 0.0, 1.0);
  } else {
    vec3 p = ro + best * rd; vec3 n; vec3 base; float rough; float metal;
    if (hit == 2) {
      n = rn;
      // Knurling on the outer wall.
      vec3 q = p - lensC; vec3 radialDir = normalize(q - dot(q, lensA) * lensA);
      if (dot(n, radialDir) > 0.9) { vec3 tang = cross(lensA, radialDir); float ang = atan(dot(q, tang), dot(q, cross(tang, lensA))); n = normalize(n + 0.25 * sin(ang * 180.0) * tang); }
      base = vec3(0.035, 0.028, 0.022); rough = 0.22; metal = 1.0;
    } else if (hit == 3) { n = capNormal(p, hA, hB, FER_R); base = vec3(0.6, 0.43, 0.2); rough = 0.3; metal = 1.0; }
    else if (hit == 4) { n = capNormal(p, hB, hC, GRIP_R); base = vec3(0.06, 0.052, 0.046); rough = 0.35; metal = 0.0; }
    else { n = normalize(p - hC); base = vec3(0.06, 0.052, 0.046); rough = 0.35; metal = 0.0; }
    vec3 v = -rd; vec3 l = normalize(lampPos - p); vec3 h = normalize(l + v);
    float sp = pow(max(dot(n, h), 0.0), mix(400.0, 30.0, rough));
    vec3 specCol = metal > 0.5 ? mix(vec3(1.0, 0.72, 0.4), base * 6.0, 0.3) : vec3(0.9, 0.85, 0.8);
    float f = fresnel(max(dot(v, n), 0.0));
    vec3 col = base * (0.25 + 0.9 * max(dot(n, l), 0.0)) * (1.0 - metal * 0.6)
      + specCol * sp * (metal > 0.5 ? 2.2 : 1.2)
      + env(reflect(rd, n)) * (metal > 0.5 ? base * 0.6 + 0.012 : vec3(f));
    // A cool rim light from behind, so that the black handle and rim hold their
    // silhouette on the dark theme.
    col += vec3(0.62, 0.68, 0.8) * 0.45 * pow(1.0 - max(dot(n, v), 0.0), 3.0);
    c = vec4(col, 1.0);
    pg = vec2(-1);
  }
  if (mode == 1) {
    // The page point this pixel shows, for the anchors: 16 bits for x, 16 for y.
    if (pg.x < 0.0) { o = vec4(0); return; }
    vec2 q = clamp(pg / vec2(PW, PL), 0.0, 1.0) * 65535.0;
    o = vec4(floor(q.x / 256.0), mod(q.x, 256.0), floor(q.y / 256.0), mod(q.y, 256.0)) / 255.0;
    return;
  }
  // Tone map the light, keep the coverage.
  vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0);
  rgb = pow(aces(rgb * 1.05), vec3(1.0 / 2.2));
  // The picture fades out toward its frame, so nothing is cut by it.
  // One elliptical falloff around the glass, and a thin one at the frame itself.
  vec2 e = min(uv, 1.0 - uv) * vec2(aspect, 1.0);
  float vig = (1.0 - smoothstep(0.55, 0.97, length((uv - vigC) / vec2(0.6, 0.66)))) * smoothstep(0.0, 0.03, min(e.x, e.y));
  o = vec4(rgb * c.a, c.a) * vig;
}\`;
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog);
if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
gl.useProgram(prog);
const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
const loc = gl.getAttribLocation(prog, "p");
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
const tex = (unit, img) => {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const ext = gl.getExtension("EXT_texture_filter_anisotropic");
  if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
};
tex(0, full);
tex(1, crop);
const U = (n) => gl.getUniformLocation(prog, n);
gl.uniform1i(U("tFull"), 0);
gl.uniform1i(U("tCrop"), 1);

// ---- placement
const v3 = { add: (a, b) => a.map((x, i) => x + b[i]), sub: (a, b) => a.map((x, i) => x - b[i]), mul: (a, k) => a.map((x) => x * k), dot: (a, b) => a.reduce((s, x, i) => s + x * b[i], 0), cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
v3.norm = (a) => v3.mul(a, 1 / Math.sqrt(v3.dot(a, a)));
const P = ${JSON.stringify("PARAMS")};
// The page point (0, 0) at the world origin; page (x, y) -> world.
const phi = P.phi * Math.PI / 180;
const toWorld = ([x, y], z = 0) => { const yy = -y; return [Math.cos(phi) * x - Math.sin(phi) * yy, Math.sin(phi) * x + Math.cos(phi) * yy, z]; };
const aimW = toWorld(aimPage);
// The lens axis: tilted toward the camera's side.
const camDir = [Math.sin(P.az * Math.PI / 180), -Math.cos(P.az * Math.PI / 180), 0];
const tilt = P.tilt * Math.PI / 180;
const lensA = v3.norm(v3.add([0, 0, Math.cos(tilt)], v3.mul(camDir, Math.sin(tilt))));
const camTarget = v3.add(aimW, P.lookOffset);
const el = P.el * Math.PI / 180, az = P.az * Math.PI / 180;
const camPos = v3.add(camTarget, v3.mul([Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)], P.dist));
const camFwd = v3.norm(v3.sub(camTarget, camPos));
const camRight = v3.norm(v3.cross(camFwd, [0, 0, 1]));
const camUp = v3.cross(camRight, camFwd);
const lamp = v3.add(aimW, P.lamp);
// The lens centre on the line from the eye to a page point, at the height (along
// its axis) that gives the magnification; the handle from the rim toward the
// camera's lower right, in the lens plane.
const inPlane = (d) => v3.norm(v3.sub(d, v3.mul(lensA, v3.dot(d, lensA))));
const hd = inPlane(v3.add(v3.mul(camRight, Math.cos(P.handle * Math.PI / 180)), v3.mul(v3.mul(camUp, -1), Math.sin(P.handle * Math.PI / 180))));
let lensC;
function place(target) {
  const tw = toWorld(target);
  const toEye = v3.norm(v3.sub(camPos, tw));
  lensC = v3.add(tw, v3.mul(toEye, DH / v3.dot(toEye, lensA)));
  const hA = v3.add(lensC, v3.mul(hd, LENS_R + 5));
  const hB = v3.add(hA, v3.mul(hd, 22));
  const hC = v3.add(hB, v3.mul(hd, P.grip));
  gl.uniform3fv(U("lensC"), lensC);
  gl.uniform3fv(U("hA"), hA); gl.uniform3fv(U("hB"), hB); gl.uniform3fv(U("hC"), hC);
}
gl.uniform3fv(U("camPos"), camPos); gl.uniform3fv(U("camFwd"), camFwd); gl.uniform3fv(U("camRight"), camRight); gl.uniform3fv(U("camUp"), camUp);
gl.uniform1f(U("tanHalf"), Math.tan((P.fov / 2) * Math.PI / 180)); gl.uniform1f(U("aspect"), W / H);
gl.uniform3fv(U("lensA"), lensA); gl.uniform3fv(U("lampPos"), lamp);
gl.uniform2fv(U("aim"), aimPage); gl.uniform1f(U("PIX"), (2 * Math.tan((P.fov / 2) * Math.PI / 180)) / H); gl.uniform1f(U("focusDist"), Math.hypot(...v3.sub(aimW, camPos))); gl.uniform2fv(U("sOrigin"), [0, 0]); gl.uniform1f(U("phi"), phi);
gl.viewport(0, 0, W, H);

const proj = (w) => { const d = v3.sub(w, camPos); const z = v3.dot(d, camFwd); const t = Math.tan((P.fov / 2) * Math.PI / 180); return [(v3.dot(d, camRight) / (z * t * (W / H)) + 1) / 2, (1 - v3.dot(d, camUp) / (z * t)) / 2]; };
// Pass 1: where each pixel looks on the page. Seen through a tilted glass from an
// angle, the page point at the glass's centre is not the one under the line of
// sight: read it, move the glass by the difference, three times.
gl.uniform1i(U("mode"), 1);
const one = new Uint8Array(4);
const seenAt = ([fx, fy]) => {
  gl.readPixels(Math.round(fx * W), Math.round((1 - fy) * H), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one);
  return [((one[0] * 256 + one[1]) / 65535) * PW, ((one[2] * 256 + one[3]) / 65535) * PL];
};
let target = aimPage.slice();
for (let k = 0; k < 3; k++) {
  place(target);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const seen = seenAt(proj(lensC));
  target = [target[0] + aimPage[0] - seen[0], target[1] + aimPage[1] - seen[1]];
}
place(target);
{ const [fx, fy] = proj(lensC); gl.uniform2fv(U("vigC"), [fx + 0.04, 1 - fy]); }
gl.drawArrays(gl.TRIANGLES, 0, 3);
const px = new Uint8Array(W * H * 4);
gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
const STEP = 2;
// Just after a token on the page (its line, one column past its end in the
// expanded text), so the callout's dot never covers the name it points at.
const tok = (n, word) => { const c = LINES[n - FIRST].indexOf(word); if (c < 0) throw new Error(word); return [colX(c + word.length + 1), lineY(n) + LH * 0.5]; };
const targets = {
  struct: tok(122, "struct uberblock {"),
  txg: tok(125, "ub_txg;"),
  rootbp: tok(128, "ub_rootbp;"),
  listing: [TEXT - 2.5 * CW, lineY(100) + LH * 0.5], // the gutter's line numbers
  aim: aimPage,
};
const near = {};
for (let y = 0; y < H; y += STEP)
  for (let x = 0; x < W; x += STEP) {
    const i = (y * W + x) * 4;
    if (!px[i] && !px[i + 1] && !px[i + 2] && !px[i + 3]) continue;
    const pgx = ((px[i] * 256 + px[i + 1]) / 65535) * PW, pgy = ((px[i + 2] * 256 + px[i + 3]) / 65535) * PL;
    for (const [k, [tx, ty]] of Object.entries(targets)) {
      const d = (pgx - tx) ** 2 + (pgy - ty) ** 2;
      if (!near[k] || d < near[k].d) near[k] = { d, at: [x / W, 1 - y / H] };
    }
  }
// The glass's centre, where it shows.
window.anchors = { ...Object.fromEntries(Object.entries(near).map(([k, v]) => [k, v.at])), lensCentre: proj(lensC) };
window.info = { focal: F, height: DH, magnification: MAG, missing: Object.keys(targets).filter((k) => !near[k]) };

// Pass 2: the picture.
gl.uniform1i(U("mode"), 0);
gl.drawArrays(gl.TRIANGLES, 0, 3);
window.png = canvas.toDataURL("image/png");
</script>`;

// The camera and the light, in one place (DECISIONS.md D16.4).
const PARAMS = {
  phi: -12, // the strip's turn on the table, degrees
  az: 6, // the camera's azimuth from the strip's near end, degrees
  el: 52, // its elevation
  fov: 28, // vertical
  dist: 580, // from the target, mm
  lookOffset: [45, 10, 0], // the target from the glass's aim point, mm
  tilt: 18, // the glass toward the camera
  handle: 32, // the handle's direction, degrees below the camera's right
  grip: 68, // the grip's length, mm
  lamp: [-10, 520, 700], // the lamp from the aim point, mm: high, beyond the glass along the strip, so the spot and the shadow fall in front of it, on the paper
};

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
await ctx.route("http://glass.local/**", (route) => route.fulfill({ contentType: "text/html", body: page.replace(JSON.stringify("PARAMS"), JSON.stringify(PARAMS)) }));
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto("http://glass.local/");
await Promise.race([
  p.waitForFunction(() => window.png || false, null, { timeout: 900_000 }),
  new Promise((_, reject) => p.on("pageerror", reject)),
]);
const png = Buffer.from((await p.evaluate(() => window.png)).split(",")[1], "base64");
const anchors = await p.evaluate(() => window.anchors);
const info = await p.evaluate(() => window.info);
await browser.close();
if (errors.length) console.error(errors.join("\n"));
if (info.missing.length) throw new Error(`anchors not seen in the picture: ${info.missing.join(", ")}`);

// Down to the final size (the supersampling). Nothing may touch the frame: the
// strip fades out at both ends and the handle ends inside it.
const small = await sharp(png).resize(W, H, { kernel: "lanczos3" }).png().toBuffer();
{
  const { data: px, info: s } = await sharp(small).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => px[(y * s.width + x) * s.channels + 3];
  let cut = 0;
  for (let x = 0; x < s.width; x++) cut = Math.max(cut, alpha(x, 0), alpha(x, s.height - 1));
  for (let y = 0; y < s.height; y++) cut = Math.max(cut, alpha(0, y), alpha(s.width - 1, y));
  if (cut > 8) console.warn(`warning: the frame cuts the picture (edge alpha ${cut})`);
}
const written = await sharp(small).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(out);
const r4 = (v) => +v.toFixed(4);
const plate = {
  width: W,
  height: H,
  image: { file: basename(out), sha256: createHash("sha256").update(await readFile(out)).digest("hex") },
  source: { file: FILE, tag: TAG, sha: SHA, printed: [FIRST, LAST], lens: LENS, sha256: createHash("sha256").update(raw.join("\n")).digest("hex") },
  optics: { focal: r4(info.focal), height: r4(info.height), magnification: info.magnification },
  anchors: Object.fromEntries(Object.entries(anchors).map(([k, [x, y]]) => [k, [r4(x), r4(y)]])),
};
await writeFile(outPlate, JSON.stringify(plate, null, 2) + "\n");
console.log(`${out}: ${written.width}x${written.height}, ${written.size} B; ${outPlate}; f = ${info.focal.toFixed(1)} mm, glass ${info.height.toFixed(1)} mm above the page`);
