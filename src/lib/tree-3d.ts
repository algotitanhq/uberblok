// The tree and the uberblock room's 3D view: the same state as the 2D
// drawing, in space. The block pointer tree stands upright, the uberblock on
// top with its one arrow, ub_rootbp; the open txg's new copies stand in front
// of the old ones, so the shared blocks are visibly shared. Below, the disk:
// a strip with its two front and two back labels, each with its ring of 128
// uberblock slots lying flat above it. Loaded only by a dynamic import from
// TreeLab.astro (src/lib/lazy3d.ts, DECISIONS.md D11.4 and D12.4).
import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, ConeGeometry, DirectionalLight, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial, PerspectiveCamera,
  Scene, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3, WebGLRenderer,
} from "three";
import { VDEV_LABELS, newestOnDisk, place, slotOf, type Pool } from "./tree";
import { centreX, drawn, fill, placeName, workTxg, type BlockState, type TrStrings } from "./tree-view";

export interface Scene3d {
  draw(p: Pool, animate: boolean): void;
  dispose(): void;
}

interface Palette {
  fg: string; muted: string; line: string; accent: string; surface: string; bad: string; old: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim() || "#888";
  return { fg: v("--fg"), muted: v("--fg-muted"), line: v("--line-strong"), accent: v("--accent"), surface: v("--surface-2"), bad: v("--bad"), old: v("--old") };
}

/** A text label as a sprite, drawn once on a canvas. */
function label(text: string, sub: string, pal: Palette, w = 2.2): Sprite {
  const c = document.createElement("canvas");
  const s = 2;
  c.width = 256 * s;
  c.height = 64 * s;
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.textAlign = "center";
  g.fillStyle = pal.fg;
  g.font = "600 24px ui-monospace, Menlo, Consolas, monospace";
  g.fillText(text, 128, 28, 250);
  g.fillStyle = pal.muted;
  g.font = "italic 20px Georgia, serif";
  g.fillText(sub, 128, 54, 250);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(w, w / 4, 1);
  return sp;
}

const ROW_Y: Record<string, number> = { OS: 5.0, DN: 3.8 };
/** Where a block stands: x from the 2D layout, y by row, the new copy in front. */
function at(key: string, pair: "solo" | "left" | "right"): Vector3 {
  const pl = place(key);
  const y = ROW_Y[key] ?? 2.6 - (2 - pl.level) * 1.2;
  return new Vector3((centreX(key) - 270) / 35 + (pair === "right" ? 0.95 : pair === "left" ? -0.45 : 0), y, pair === "right" ? 1.1 : pair === "left" ? -0.4 : 0);
}
const LABEL_X = [-6.4, -5.4, 5.4, 6.4];
const DISK_Y = -2.1;

export function mount(host: HTMLElement, opts: { label: string; describedBy?: string; S: TrStrings; height?: number }): Scene3d {
  const S = opts.S;
  let pal = palette();
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label);
  if (opts.describedBy) canvas.setAttribute("aria-describedby", opts.describedBy);
  canvas.className = "tr-canvas";
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 10, 8);
  scene.add(sun);
  const world = new Group();
  scene.add(world);

  // The camera orbits the scene: yaw, pitch, distance.
  const view = { yaw: 0.35, pitch: 0.22, dist: 19 };
  const target = new Vector3(0, 1.6, 0);
  const place3 = () => {
    camera.position.set(
      target.x + view.dist * Math.cos(view.pitch) * Math.sin(view.yaw),
      target.y + view.dist * Math.sin(view.pitch),
      target.z + view.dist * Math.cos(view.pitch) * Math.cos(view.yaw),
    );
    camera.lookAt(target);
  };

  const resize = () => {
    const w = host.clientWidth || 600;
    // The height of the 2D drawing it replaces, when known: the swap does not move the page.
    const h = opts.height ?? Math.max(340, Math.min(640, Math.round(w * 0.66)));
    renderer.setSize(w, h, false);
    canvas.style.width = "100%";
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frame();
  };

  const boxGeo = new BoxGeometry(1.25, 0.62, 0.5);
  const ubGeo = new BoxGeometry(3.4, 0.7, 0.3);
  const slotGeo = new BoxGeometry(0.09, 0.09, 0.14);
  const ringGeo = new TorusGeometry(0.62, 0.035, 6, 64);
  const labGeo = new BoxGeometry(0.92, 0.42, 0.9);
  const coneGeo = new ConeGeometry(0.14, 0.34, 12);
  const shared = new Set<BufferGeometry>([boxGeo, ubGeo, slotGeo, ringGeo, labGeo, coneGeo]);
  let grows: { mesh: Mesh; t0: number }[] = [];
  let swing: { from: Vector3; to: Vector3; t0: number } | null = null;
  let lastRoot: Vector3 | null = null;
  let arrowLine: LineSegments | null = null;
  let arrowHead: Mesh | null = null;
  const ubBottom = new Vector3(0, 6.05, 0);
  let raf = 0;
  let disposed = false;

  const colorOf = (s: BlockState) => (s === "old" || s === "dead" ? pal.old : s === "lost" ? pal.bad : s === "live" ? pal.muted : pal.accent);

  const seg = (arr: number[], color: string, opacity: number) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(arr, 3));
    return new LineSegments(g, new LineBasicMaterial({ color: new Color(color), transparent: true, opacity }));
  };

  function setArrow(end: Vector3) {
    const pos = arrowLine!.geometry.getAttribute("position") as Float32BufferAttribute;
    pos.setXYZ(1, end.x, end.y + 0.5, end.z);
    pos.needsUpdate = true;
    arrowHead!.position.set(end.x, end.y + 0.5, end.z);
    // The cone points along +y; turn it to point from the uberblock to the objset.
    const dir = new Vector3(end.x, end.y + 0.5, end.z).sub(ubBottom).normalize();
    arrowHead!.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  }

  function draw(p: Pool, animate: boolean) {
    pal = palette();
    for (const o of [...world.children]) {
      world.remove(o);
      o.traverse((x) => {
        const m = x as Mesh & { material?: { map?: { dispose(): void }; dispose(): void } };
        m.material?.map?.dispose();
        m.material?.dispose?.();
        // Geometry made for one draw (lines, the strip) goes too; the shared shapes stay.
        if (m.geometry && !shared.has(m.geometry) && !(x as Sprite).isSprite) m.geometry.dispose();
      });
    }
    grows = [];
    const ds = drawn(p);
    const pos = new Map(ds.map((d) => [d.blk.id, { v: at(d.blk.key, d.pair), state: d.state }]));
    // Edges: block pointers, old tree muted, the new copies' in the accent.
    const plain: number[] = [];
    const hot: number[] = [];
    const lost: number[] = [];
    for (const d of ds) {
      const from = pos.get(d.blk.id)!.v;
      for (const k of d.blk.kids) {
        const to = pos.get(k)?.v;
        if (!to) continue;
        // A pointer in memory to a child not written yet stays muted, as in 2D.
        const waiting = d.state === "mem" && pos.get(k)!.state === "mem";
        const arr = d.state === "live" || d.state === "old" || d.state === "dead" || waiting ? plain : d.state === "lost" ? lost : hot;
        arr.push(from.x, from.y - 0.31, from.z, to.x, to.y + 0.31, to.z);
      }
    }
    world.add(seg(plain, pal.line, 0.9), seg(hot, pal.accent, 1), seg(lost, pal.bad, 0.8));
    for (const d of ds) {
      const v = pos.get(d.blk.id)!.v;
      const m = new Mesh(boxGeo, new MeshLambertMaterial({ color: new Color(colorOf(d.state)), transparent: d.state === "dead" || d.state === "lost", opacity: d.state === "dead" || d.state === "lost" ? 0.45 : 1, emissive: new Color(d.state === "new" || d.state === "mem" || d.state === "unflushed" ? pal.accent : "#000000"), emissiveIntensity: d.state === "unflushed" || d.state === "mem" ? 0.15 : d.state === "new" ? 0.4 : 0 }));
      m.position.copy(v);
      world.add(m);
      if (animate && (d.state === "mem" || d.state === "unflushed")) grows.push({ mesh: m, t0: performance.now() });
      const sp = label(placeName(S, d.blk.key), String(d.blk.birth), pal, 2);
      // The old copy of a rewritten block stands behind its new copy: its label goes on its
      // left, beside the box, so the two labels never overlap.
      // The uberblock's arrow comes down onto the top of the objset: the new objset's label goes
      // on its right, out of the arrow's way.
      if (d.pair === "left") sp.position.set(v.x - 1.05, v.y, v.z);
      else if (d.pair === "right" && d.blk.key === "OS") sp.position.set(v.x + 1.05, v.y, v.z);
      else sp.position.set(v.x, v.y + 0.62, v.z);
      world.add(sp);
    }
    // The uberblock an import would pick, and its one pointer.
    const ub = newestOnDisk(p);
    const card = new Mesh(ubGeo, new MeshLambertMaterial({ color: new Color(pal.accent), emissive: new Color(pal.accent), emissiveIntensity: 0.25 }));
    card.position.set(0, 6.4, 0);
    world.add(card);
    const cl = label(fill(S.ubCard, { txg: ub.txg }), fill(S.ubSlot, { slot: slotOf(ub.txg, p.ashift) }), pal, 3.4);
    cl.position.set(0, 7.2, 0.2);
    world.add(cl);
    const end = ub.root && pos.get(ub.root) ? pos.get(ub.root)!.v.clone() : new Vector3(0, 5, 0);
    arrowLine = seg([ubBottom.x, ubBottom.y, ubBottom.z, end.x, end.y + 0.5, end.z], pal.accent, 1);
    arrowHead = new Mesh(coneGeo, new MeshLambertMaterial({ color: new Color(pal.accent) }));
    world.add(arrowLine, arrowHead);
    if (animate && lastRoot && !lastRoot.equals(end)) swing = { from: lastRoot.clone(), to: end.clone(), t0: performance.now() };
    setArrow(swing ? swing.from : end);
    lastRoot = end;

    // The disk: a strip, two labels at each end, a ring of slots above each.
    const strip = new Mesh(new BoxGeometry(14.4, 0.16, 0.7), new MeshLambertMaterial({ color: new Color(pal.surface) }));
    strip.position.set(0, DISK_Y - 0.2, 0);
    world.add(strip);
    const work = workTxg(p);
    const sn = slotOf(work, p.ashift);
    const sp = slotOf(work - 1, p.ashift);
    for (let l = 0; l < VDEV_LABELS; l++) {
      const lab = p.labels[l];
      const x = LABEL_X[l];
      const c = lab.configTorn ? pal.bad : lab.config === work ? pal.accent : pal.old;
      const box = new Mesh(labGeo, new MeshLambertMaterial({ color: new Color(c) }));
      box.position.set(x, DISK_Y, 0);
      world.add(box);
      const ll = label(`L${l}`, lab.configTorn ? S.cellTorn : `${S.c_config} ${lab.config}`, pal, 1.8);
      ll.position.set(x, DISK_Y - 0.75, 0.6);
      world.add(ll);
      const ring = new Mesh(ringGeo, new MeshLambertMaterial({ color: new Color(pal.line) }));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, DISK_Y + 0.55, 0);
      world.add(ring);
      lab.ring.forEach((s, n) => {
        const col = s?.torn ? pal.bad : n === sn && s?.txg === work ? pal.accent : n === sp && s?.txg === work - 1 ? pal.muted : null;
        if (!col) return;
        const a = (n / lab.ring.length) * Math.PI * 2;
        const m = new Mesh(slotGeo, new MeshLambertMaterial({ color: new Color(col), emissive: new Color(col), emissiveIntensity: 0.3 }));
        m.position.set(x + Math.sin(a) * 0.62, DISK_Y + 0.62, -Math.cos(a) * 0.62);
        m.rotation.y = -a;
        m.scale.setScalar(1.8);
        world.add(m);
      });
    }
    for (const g of grows) g.mesh.scale.setScalar(0.01);
    frame();
    if (grows.length || swing) loop();
  }

  function frame() {
    place3();
    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now: number) => {
      if (disposed) return;
      let busy = false;
      for (const g of grows) {
        const k = Math.min(1, (now - g.t0) / 360);
        g.mesh.scale.setScalar(Math.max(0.01, 1 - (1 - k) ** 3));
        if (k < 1) busy = true;
      }
      if (swing) {
        const k = Math.min(1, (now - swing.t0) / 600);
        setArrow(new Vector3().lerpVectors(swing.from, swing.to, 1 - (1 - k) ** 3));
        if (k < 1) busy = true;
        else swing = null;
      }
      frame();
      if (busy) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // Turning the scene: drag, arrow keys; + and − zoom.
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.008;
    view.pitch = Math.min(1.2, Math.max(-0.3, view.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
    frame();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") view.yaw -= 0.15;
    else if (k === "ArrowRight") view.yaw += 0.15;
    else if (k === "ArrowUp") view.pitch = Math.min(1.2, view.pitch + 0.1);
    else if (k === "ArrowDown") view.pitch = Math.max(-0.3, view.pitch - 0.1);
    else if (k === "+" || k === "=") view.dist = Math.max(10, view.dist - 1);
    else if (k === "-" || k === "−") view.dist = Math.min(30, view.dist + 1);
    else return;
    e.preventDefault();
    frame();
  });

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  return {
    draw,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      canvas.remove();
    },
  };
}
