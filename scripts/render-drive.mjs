// Renders the Hall's exhibit: a 3.5-inch hard disk exploded along its spindle,
// "Fig. 1" of the museum. From the bottom: the base casting, the spindle motor,
// three platters with their spacers (the glossy brown iron oxide of D14.3), the
// clamp and its screws, the top cover lifted highest; the head stack stays on its
// pivot with its arms spread between the platters' heights, parked off their edge;
// the voice coil behind the pivot with the magnet's top plate lifted above it; the
// amber flex cable to the connector. Built from primitives (lathe, extrude, box),
// physically based (Three.js MeshPhysicalMaterial), drawn by headless Chromium,
// supersampled 2x, on a transparent ground with a soft shadow so that it sits on
// both themes. Also writes the projected position of each part (the plate's
// callouts are HTML/SVG, drawn over the image; no text in the raster).
// Deterministic: no randomness but a seeded generator. DECISIONS.md D15.2.
//
//   node scripts/render-drive.mjs [out.webp] [anchors.json]
//        (default: src/assets/drive.webp, src/assets/drive-anchors.json)
//
// Chromium needs WebGL: on a machine without a GPU, SwiftShader is used.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.argv[2] ?? join(root, "src/assets/drive.webp");
const outAnchors = process.argv[3] ?? join(root, "src/assets/drive-anchors.json");
// The master: 5:4, the size of the largest served width and more.
const W = 1800;
const H = 1440;
const SS = 2;

const page = `<!doctype html><meta charset="utf-8">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<body style="margin:0;background:transparent">
<script type="module">
import * as T from "three";

const W = ${W * SS}, H = ${H * SS};
// Seeded generator (mulberry32): the same image on every run.
let seed = 0x0bab10c;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = T.AgXToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.body.append(renderer.domElement);

const scene = new T.Scene();
const pmrem = new T.PMREMGenerator(renderer);
// The dark studio of the platter (D14.3): warm-grey walls, a softbox behind, one
// above, a strip light to the right. Few, crisp reflections.
const studio = new T.Scene();
const room = new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: 0x1c1712, side: T.BackSide }));
room.position.y = 4;
studio.add(room);
const panel = (w, h, c, pos, look) => {
  const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
  m.position.set(...pos);
  m.lookAt(...look);
  studio.add(m);
};
panel(2.6, 1.6, new T.Color(0xfff1e0).multiplyScalar(2.2), [-3.5, 5, -7.5], [0, 0, 0]);
panel(6, 4, new T.Color(0xffe8d2).multiplyScalar(0.9), [-3, 7, 4], [0, 0, 0]);
panel(1.2, 8, new T.Color(0xffe2c4).multiplyScalar(1.4), [7, 3, -3], [0, 0, 0]);
panel(10, 3, new T.Color(0x4a3a2c), [0, 1.5, -9.8], [0, 1.5, 0]);
scene.environment = pmrem.fromScene(studio, 0.02).texture;
scene.environmentIntensity = 1;

// Everything below is in millimetres; the spindle axis is +y, at the origin.
// A warm key from the upper left (it casts the shadows), a cool rim from behind right.
const key = new T.DirectionalLight(0xffd9b0, 1.3);
key.position.set(-90, 480, 140);
key.castShadow = true;
key.shadow.mapSize.set(4096, 4096);
key.shadow.radius = 6;
key.shadow.bias = -0.0004;
Object.assign(key.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 100, far: 900 });
scene.add(key);
const rim = new T.DirectionalLight(0xcfe0ff, 0.6);
rim.position.set(220, 140, -260);
scene.add(rim);
// A soft fill from the camera's side, so that the casting's walls read on the Paper theme.
const fill = new T.DirectionalLight(0xfff4e8, 0.9);
fill.position.set(-200, 120, 320);
scene.add(fill);

// Materials (DECISIONS.md D15.2).
const castAl = new T.MeshPhysicalMaterial({ color: 0xb4b1ab, metalness: 0.1, roughness: 0.6 });
const machined = new T.MeshPhysicalMaterial({ color: 0xc9c4ba, metalness: 1, roughness: 0.35, envMapIntensity: 1.4 });
const stainless = new T.MeshPhysicalMaterial({ color: 0xc4c0b8, metalness: 1, roughness: 0.3, anisotropy: 0.6 });
const steel = new T.MeshPhysicalMaterial({ color: 0xe6e2da, metalness: 1, roughness: 0.15, anisotropy: 0.4 });
const darkSteel = new T.MeshPhysicalMaterial({ color: 0xa8a39a, metalness: 1, roughness: 0.38 });
const copper = new T.MeshPhysicalMaterial({ color: 0xb8733f, metalness: 1, roughness: 0.35 });
const kapton = new T.MeshPhysicalMaterial({ color: 0xd98a3d, metalness: 0, roughness: 0.4, clearcoat: 0.5, side: T.DoubleSide });
const nickel = new T.MeshPhysicalMaterial({ color: 0x8f8a82, metalness: 1, roughness: 0.3 });
const blackMat = new T.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8 });

const drive = new T.Group();
scene.add(drive);
const add = (mesh, parent = drive) => { mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh; };

// A rounded rectangle, as a shape in the plane (x, -z), so that an extrusion
// turned by -90 degrees about x runs up the y axis.
const rrect = (path, x0, z0, x1, z1, r) => {
  const a = -z1, b = -z0; // shape y = -z
  path.moveTo(x0 + r, a);
  path.lineTo(x1 - r, a); path.quadraticCurveTo(x1, a, x1, a + r);
  path.lineTo(x1, b - r); path.quadraticCurveTo(x1, b, x1 - r, b);
  path.lineTo(x0 + r, b); path.quadraticCurveTo(x0, b, x0, b - r);
  path.lineTo(x0, a + r); path.quadraticCurveTo(x0, a, x0 + r, a);
  return path;
};
const up = (shape, depth, y, bevel = 0.4) => {
  const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
};

// The footprint: 101.6 x 147 mm, the spindle at 50.8 and 52 mm from a corner.
const X0 = -50.8, X1 = 50.8, Z0 = -52, Z1 = 95;
const PIVOT = new T.Vector3(28, 0, 56);

// 1. The base casting: a tub, 20 mm deep, 3 mm walls, and its bosses.
{
  const wall = rrect(new T.Shape(), X0, Z0, X1, Z1, 6);
  wall.holes.push(rrect(new T.Path(), X0 + 3, Z0 + 3, X1 - 3, Z1 - 3, 3.5));
  add(new T.Mesh(up(wall, 19.2, 0), castAl));
  add(new T.Mesh(up(rrect(new T.Shape(), X0 + 0.5, Z0 + 0.5, X1 - 0.5, Z1 - 0.5, 5.5), 3, 0), castAl));
  // The machined rim on which the cover's gasket sits.
  const rimS = rrect(new T.Shape(), X0 + 0.2, Z0 + 0.2, X1 - 0.2, Z1 - 0.2, 5.8);
  rimS.holes.push(rrect(new T.Path(), X0 + 2.6, Z0 + 2.6, X1 - 2.6, Z1 - 2.6, 3.6));
  add(new T.Mesh(up(rimS, 0.6, 19.4, 0), machined));
  // The spindle motor's seat, the pivot's boss, four screw bosses in the corners.
  const seat = add(new T.Mesh(new T.CylinderGeometry(17, 18.5, 4, 96), machined));
  seat.position.y = 5;
  const boss = add(new T.Mesh(new T.CylinderGeometry(5, 6.5, 6, 64), machined));
  boss.position.set(PIVOT.x, 6, PIVOT.z);
  for (const [x, z] of [[X0 + 5, Z0 + 5], [X1 - 5, Z0 + 5], [X0 + 5, Z1 - 5], [X1 - 5, Z1 - 5]]) {
    const s = add(new T.Mesh(new T.CylinderGeometry(3, 3.4, 17, 32), castAl));
    s.position.set(x, 11.5, z);
    const h = add(new T.Mesh(new T.CylinderGeometry(1.3, 1.3, 0.3, 24), blackMat));
    h.position.set(x, 20.05, z);
  }
}

// 2. The spindle motor hub.
{
  const prof = [[0, 7], [15, 7], [15, 8.5], [12.5, 9], [12.5, 26], [11.8, 26.6], [0, 26.6]].map(([x, y]) => new T.Vector2(x, y)).reverse();
  add(new T.Mesh(new T.LatheGeometry(prof, 128), steel));
}

// 3. The platters, as in D14.3 (in units of their radius, then scaled to 47.5 mm).
const R = 1, RI = 25 / 95, TH = 1.27 / 47.5;
const h = TH / 2, b = 0.004;
const prof = [];
prof.push(new T.Vector2(RI, -h + b), new T.Vector2(RI, h - b), new T.Vector2(RI + b, h));
const N = 96;
for (let i = 1; i < N; i++) prof.push(new T.Vector2(RI + b + ((R - RI - 2 * b) * i) / N, h));
prof.push(new T.Vector2(R - b, h), new T.Vector2(R, h - b), new T.Vector2(R, -h + b), new T.Vector2(R - b, -h));
prof.push(new T.Vector2(RI + b, -h));
const L = prof.length - 1;
const vHub = (L - 2) / L, vRim = (L - N - 2) / L;
const platterGeo = new T.LatheGeometry(prof.reverse(), 512);
const tex = (fn) => {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 2048;
  const g = c.getContext("2d");
  const img = g.createImageData(4, 2048);
  for (let y = 0; y < 2048; y++) {
    const v = 1 - y / 2047;
    const r = v > vHub || v < vRim ? -1 : (vHub - v) / (vHub - vRim);
    const [cr, cg, cb] = fn(r);
    for (let x = 0; x < 4; x++) img.data.set([cr, cg, cb, 255], (y * 4 + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new T.CanvasTexture(c);
  t.wrapS = T.RepeatWrapping;
  return t;
};
const zones = [0, 0.12, 0.3, 0.47, 0.62, 0.76, 0.88, 1];
const band = Array.from({ length: 2048 }, () => rnd());
const color = tex((r) => {
  if (r < 0) return [92, 46, 22];
  const landing = r < 0.07 ? 0.9 : 1;
  const zone = zones.findIndex((z) => r < z);
  const zshift = zone % 2 ? 1.0 : 0.965;
  const fine = 0.985 + 0.03 * band[Math.floor(r * 2047)];
  const k = landing * zshift * fine;
  return [Math.min(255, 104 * k), Math.min(255, 56 * k), Math.min(255, 26 * k)];
});
color.colorSpace = T.SRGBColorSpace;
const rough = tex((r) => [0, r < 0 ? 120 : r < 0.07 ? 150 : 60 + 25 * band[Math.floor(r * 2047)], 0]);
const oxide = new T.MeshPhysicalMaterial({
  color: 0xffffff, map: color, roughnessMap: rough, roughness: 1, metalness: 0.15,
  clearcoat: 1, clearcoatRoughness: 0.05, anisotropy: 0.25, anisotropyRotation: 0,
  specularIntensity: 0.7, specularColor: new T.Color(0xffd9b8),
});
const PLATTERS = [30, 50, 70];
for (const y of PLATTERS) {
  const p = add(new T.Mesh(platterGeo, oxide));
  p.scale.setScalar(47.5);
  p.position.y = y;
}
// Spacer rings between the platters.
for (const y of [40, 60]) {
  const s = add(new T.Mesh(new T.CylinderGeometry(15.5, 15.5, 1.5, 96, 1, true), steel));
  s.position.y = y;
  const top = add(new T.Mesh(new T.RingGeometry(12.6, 15.5, 96), steel));
  top.rotation.x = -Math.PI / 2;
  top.position.y = y + 0.75;
}

// 4. The clamp and its six screws (the D14.3 clamp, at 47.5 mm).
const CLAMP = 96;
{
  const clampProf = [
    [0, h + 0.07], [0.05, h + 0.07], [0.07, h + 0.064], [0.09, h + 0.05], [0.2, h + 0.046], [0.3, h + 0.04],
    [0.335, h + 0.03], [0.35, h + 0.012], [0.352, h], [0.26, h], [0.26, -h - 0.02], [0, -h - 0.02],
  ].map(([x, y]) => new T.Vector2(x, y)).reverse();
  const g = new T.Group();
  g.add(new T.Mesh(new T.LatheGeometry(clampProf, 256), steel));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const s = new T.Mesh(new T.CylinderGeometry(0.03, 0.034, 0.016, 48), darkSteel);
    s.position.set(0.175 * Math.cos(a), h + 0.054, 0.175 * Math.sin(a));
    const slot = new T.Mesh(new T.BoxGeometry(0.044, 0.006, 0.008), blackMat);
    slot.position.copy(s.position).setY(h + 0.0605);
    slot.rotation.y = a * 3;
    g.add(s, slot);
  }
  const cap = new T.Mesh(new T.CylinderGeometry(0.045, 0.05, 0.02, 64), darkSteel);
  cap.position.y = h + 0.078;
  g.add(cap);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; } });
  g.scale.setScalar(47.5);
  g.position.y = CLAMP;
  drive.add(g);
}

// 5. The top cover, lifted highest on the spindle's axis: drawn as a ghost,
// a faint sheet with its edges outlined, as on an engineering plate, so that it
// does not hide the stack below it.
const COVER = 122;
{
  const g = new T.Group();
  const ghost = new T.MeshPhysicalMaterial({ color: 0xc4c0b8, metalness: 0.6, roughness: 0.35, transparent: true, opacity: 0.12, depthWrite: false });
  const edge = new T.MeshBasicMaterial({ color: 0x8a8378, transparent: true, opacity: 0.85, toneMapped: false });
  g.add(new T.Mesh(up(rrect(new T.Shape(), X0, Z0, X1, Z1, 6), 1, 0, 0), ghost));
  // The outline: thin tubes along the sheet's edge, the lip's lower edge and the pressed bosses.
  const loop = (path, y) => {
    const pts = path.getSpacedPoints(400).map((v) => new T.Vector3(v.x, y, -v.y));
    g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts, true), 800, 0.45, 6, true), edge));
  };
  loop(rrect(new T.Path(), X0, Z0, X1, Z1, 6), 1);
  loop(rrect(new T.Path(), X0, Z0, X1, Z1, 6), -2);
  const ring = (x, z, r, y) => { const c = new T.Path(); c.absarc(x, -z, r, 0, Math.PI * 2, false); loop(c, y); };
  ring(0, 0, 11, 1);
  ring(0, 0, 9, 2.2);
  ring(PIVOT.x, PIVOT.z, 5, 1);
  ring(PIVOT.x, PIVOT.z, 4, 2.2);
  for (const [x, z] of [[X0 + 5, Z0 + 5], [X1 - 5, Z0 + 5], [X0 + 5, Z1 - 5], [X1 - 5, Z1 - 5]]) ring(x, z, 1.6, 1);
  g.position.y = COVER;
  drive.add(g);
}

// 6. The head stack: the E-block on its pivot, a pair of arms around each
// platter, their suspensions and sliders; parked just off the platters' edge.
const ARM = 47; // pivot to slider, mm
// The angle at which the slider flies over the middle tracks (30 mm from the
// spindle): of the two, the one on the camera's side.
let theta = 0;
{
  let best = Infinity;
  for (let a = 0; a < Math.PI * 2; a += 0.0005) {
    const x = PIVOT.x + ARM * Math.cos(a), z = PIVOT.z + ARM * Math.sin(a);
    const d = Math.abs(Math.hypot(x, z) - 30) - x * 1e-3;
    if (d < best && x < PIVOT.x) { best = d; theta = a; }
  }
}
const stack = new T.Group();
stack.position.set(PIVOT.x, 0, PIVOT.z);
stack.rotation.y = -theta; // the arms run along +x of the group
drive.add(stack);
{
  const bearing = add(new T.Mesh(new T.CylinderGeometry(4.2, 4.2, 66, 64), machined), stack);
  bearing.position.y = 9 + 33;
  // The E-block: a comb seen from above, a tapered slab.
  const eb = new T.Shape();
  eb.moveTo(-6, -7); eb.lineTo(8, -5.5); eb.lineTo(8, 5.5); eb.lineTo(-6, 7); eb.lineTo(-8, 0); eb.lineTo(-6, -7);
  const block = add(new T.Mesh(up(eb, 50, 24, 0.5), castAl), stack);
  block.material = machined;
  // An arm: tapered, with a lightening hole.
  const armS = new T.Shape();
  armS.moveTo(6, -5.5); armS.lineTo(30, -2.4); armS.lineTo(31, 0); armS.lineTo(30, 2.4); armS.lineTo(6, 5.5); armS.lineTo(6, -5.5);
  const hole = new T.Path();
  hole.moveTo(12, -2.6); hole.lineTo(22, -1.3); hole.lineTo(22, 1.3); hole.lineTo(12, 2.6); hole.lineTo(12, -2.6);
  armS.holes.push(hole);
  const armG = up(armS, 1, 0, 0.15);
  // A suspension: a thin stainless load beam, then the slider.
  const susS = new T.Shape();
  susS.moveTo(29, -2.2); susS.lineTo(ARM - 1.2, -0.7); susS.lineTo(ARM - 1.2, 0.7); susS.lineTo(29, 2.2); susS.lineTo(29, -2.2);
  const susG = up(susS, 0.3, 0, 0);
  for (const py of PLATTERS) {
    for (const s of [-1, 1]) {
      const y = py + s * 2.6;
      const arm = add(new T.Mesh(armG, machined), stack);
      arm.position.y = y - 0.5;
      const sus = add(new T.Mesh(susG, stainless), stack);
      sus.position.y = y - s * 0.9;
      const slider = add(new T.Mesh(new T.BoxGeometry(1.2, 0.3, 1.0), blackMat), stack);
      slider.position.set(ARM - 0.8, y - s * 1.3, 0);
    }
  }
  // 7. The voice coil behind the pivot (an extruded trapezoid ring) and the magnet's plates.
  const coil = new T.Shape();
  coil.moveTo(-7, -5); coil.lineTo(-27, -11); coil.lineTo(-27, 11); coil.lineTo(-7, 5); coil.lineTo(-7, -5);
  const ch = new T.Path();
  ch.moveTo(-10, -2.6); ch.lineTo(-24, -6.6); ch.lineTo(-24, 6.6); ch.lineTo(-10, 2.6); ch.lineTo(-10, -2.6);
  coil.holes.push(ch);
  add(new T.Mesh(up(coil, 4, 42, 0.4), copper), stack);
  // The magnet's plates: a crescent around the coil's swing, one on the base, one over the coil.
  const cres = new T.Shape();
  cres.absarc(0, 0, 30, Math.PI * 0.84, Math.PI * 1.16, false);
  cres.absarc(0, 0, 13, Math.PI * 1.2, Math.PI * 0.8, true);
  const lower = add(new T.Mesh(up(cres, 3, 3, 0.4), nickel), stack);
  add(new T.Mesh(up(cres, 3, 49.5, 0.4), nickel), stack);
  add(new T.Mesh(up(cres, 2.4, 47, 0.3), new T.MeshPhysicalMaterial({ color: 0x55524d, metalness: 0.6, roughness: 0.5 })), stack);
}

// 8. The flex cable: an amber Kapton ribbon from the E-block to the connector on the casting.
{
  const toWorld = (x, y, z) => new T.Vector3(x, y, z).applyAxisAngle(new T.Vector3(0, 1, 0), -theta).add(new T.Vector3(PIVOT.x, 0, PIVOT.z));
  const conn = new T.Vector3(X1 - 6, 8, Z1 - 30);
  const a = toWorld(-2, 46, -8);
  const curve = new T.CatmullRomCurve3([a, toWorld(-4, 40, -16), new T.Vector3((a.x + conn.x) / 2 + 6, 22, (a.z + conn.z) / 2 - 4), new T.Vector3(conn.x - 2, 12, conn.z + 4), conn]);
  const pts = curve.getPoints(160);
  const pos = [], idx = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    pos.push(p.x, p.y - 4, p.z, p.x, p.y + 4, p.z); // a vertical ribbon, 8 mm wide
    if (i) idx.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  add(new T.Mesh(g, kapton));
  const c = add(new T.Mesh(new T.BoxGeometry(5, 9, 14), blackMat));
  c.position.copy(conn).setY(10);
}

// The ground: only the shadow, warm, so that the piece sits on both themes.
const ground = new T.Mesh(new T.PlaneGeometry(1200, 1200), new T.ShadowMaterial({ color: 0x28180c, opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Three-quarter view from above: the drive's long side from lower left to upper right.
const box = new T.Box3().setFromObject(drive);
const centre = box.getCenter(new T.Vector3());
const radius = box.getBoundingSphere(new T.Sphere()).radius;
const FOV = 14, EL = (26 * Math.PI) / 180, AZ = (-32 * Math.PI) / 180;
const cam = new T.PerspectiveCamera(FOV, W / H, 1, 5000);
const dist = (radius / Math.sin(((FOV / 2) * Math.PI) / 180)) * 0.94; // the whole casting and its shadow in frame
cam.position.set(centre.x + dist * Math.cos(EL) * Math.sin(AZ), centre.y + dist * Math.sin(EL), centre.z + dist * Math.cos(EL) * Math.cos(AZ));
cam.lookAt(centre);
renderer.render(scene, cam);

// Where each part shows in the image (0..1 of the canvas), for the plate's callouts.
const at = (x, y, z) => { const v = new T.Vector3(x, y, z).project(cam); return [(v.x + 1) / 2, (1 - v.y) / 2]; };
const coverPt = new T.Vector3(X0, COVER + 1, 20);
const sl = (x, y, z) => { const v = new T.Vector3(x, y, z).applyAxisAngle(new T.Vector3(0, 1, 0), -theta).add(new T.Vector3(PIVOT.x, 0, PIVOT.z)); return at(v.x, v.y, v.z); };
window.anchors = {
  cover: at(coverPt.x, coverPt.y, coverPt.z),
  clamp: at(0, CLAMP + 3, 0),
  platters: at(-44 * Math.sin(0.6), 70.7, 44 * Math.cos(0.6)),
  motor: at(-15 * Math.sin(0.56), 17, 15 * Math.cos(0.56)),
  heads: sl(22, 70 + 2.6, 0),
  coil: sl(-20, 46, 0),
  base: at(X0, 12, 40),
  axisTop: at(0, COVER + 16, 0),
  axisBottom: at(0, 0, 0),
};
window.png = renderer.domElement.toDataURL("image/png");
</script>`;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
const types = { ".js": "text/javascript" };
await ctx.route("http://drive.local/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/") return route.fulfill({ contentType: "text/html", body: page });
  if (!path.startsWith("/three/")) return route.fulfill({ status: 404 });
  const body = await readFile(join(root, "node_modules", path));
  return route.fulfill({ contentType: types[extname(path)] ?? "application/octet-stream", body });
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await p.goto("http://drive.local/");
// The render, or the first error of the page (no WebGL, a failed import): no waiting for the timeout.
await Promise.race([
  p.waitForFunction(() => window.png || false, null, { timeout: 900_000 }),
  new Promise((_, reject) => p.on("pageerror", reject)),
]);
const png = Buffer.from((await p.evaluate(() => window.png)).split(",")[1], "base64");
const anchors = await p.evaluate(() => window.anchors);
await browser.close();
if (errors.length) console.error(errors.join("\n"));

// Down to the final size (the supersampling), trimmed to the object and its
// shadow, then padded back to 5:4 with a small margin; the anchors follow.
const small = await sharp(png).resize(W, H, { kernel: "lanczos3" }).png().toBuffer();
// The frame must hold the whole piece: a visible pixel on the canvas edge means the
// camera cut something off (ALG-114 design review: the casting was sheared). Any
// alpha counts, as the trim below keeps every pixel that is not fully transparent.
{
  const { data: px, info: s } = await sharp(small).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => px[(y * s.width + x) * s.channels + 3];
  let cut = 0;
  for (let x = 0; x < s.width; x++) cut = Math.max(cut, alpha(x, 0), alpha(x, s.height - 1));
  for (let y = 0; y < s.height; y++) cut = Math.max(cut, alpha(0, y), alpha(s.width - 1, y));
  if (cut > 0) throw new Error(`render cut by the frame (edge alpha ${cut}): move the camera back`);
}
const { data: trimmed, info: t } = await sharp(small).trim({ threshold: 1 }).png().toBuffer({ resolveWithObject: true });
const m = 24;
let fw = t.width + 2 * m, fh = t.height + 2 * m;
if (fw / fh > 5 / 4) fh = Math.round((fw * 4) / 5);
else fw = Math.round((fh * 5) / 4);
const left = Math.floor((fw - t.width) / 2), top = Math.floor((fh - t.height) / 2);
const info = await sharp(trimmed)
  .extend({ top, bottom: fh - t.height - top, left, right: fw - t.width - left, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .webp({ quality: 90, alphaQuality: 100, effort: 6 })
  .toFile(out);
const ox = -t.trimOffsetLeft, oy = -t.trimOffsetTop; // sharp gives negative offsets
const map = ([x, y]) => [+(((x * W - ox + left) / fw).toFixed(4)), +(((y * H - oy + top) / fh).toFixed(4))];
const json = { width: fw, height: fh, anchors: Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, map(v)])) };
await writeFile(outAnchors, JSON.stringify(json, null, 2) + "\n");
console.log(`${out}: ${info.width}x${info.height}, ${info.size} B; ${outAnchors}`);
