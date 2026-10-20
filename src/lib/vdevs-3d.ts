// The vdevs room's 3D view: the same tree as the 2D drawing, in space. The
// root on top, the top-level vdevs on a ring below it, each one's children on
// a smaller ring under it; the hot spares and the cache device float apart,
// not linked to the tree (spa_spares and spa_l2cache are lists beside
// spa_root_vdev). An I/O is a pulse that runs down the edges it takes, depth
// by depth; a block lands on the top-level vdevs of its DVAs. Loaded only by
// a dynamic import from VdevLab.astro (src/lib/lazy3d.ts, DECISIONS.md D11.4).
import {
  AmbientLight, BoxGeometry, BufferGeometry, CanvasTexture, Color, DirectionalLight, Float32BufferAttribute,
  Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera,
  Raycaster, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3, WebGLRenderer,
} from "three";
import { OPS, classOfTop, topLevels, type Hop, type Pool, type Vdev } from "./vdevs";
import { blocksPerTop, type LastIo } from "./vdevs-view";

export interface Scene3d {
  draw(p: Pool, io: LastIo | null, selected: string | null, animate: boolean): void;
  dispose(): void;
}

interface Palette {
  bg: string; fg: string; muted: string; line: string; accent: string; surface: string; bad: string; old: string;
  normal: string; log: string; special: string; dedup: string;
}

function palette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim() || "#888";
  return {
    bg: v("--bg"), fg: v("--fg"), muted: v("--fg-muted"), line: v("--line-strong"), accent: v("--accent"), surface: v("--surface-2"), bad: v("--bad"), old: v("--old"),
    normal: v("--fg-muted"), log: v("--code-function"), special: v("--code-type"), dedup: v("--code-string"),
  };
}

/** A text label as a sprite, drawn once on a canvas. */
function label(text: string, sub: string, pal: Palette): Sprite {
  const c = document.createElement("canvas");
  const s = 2;
  c.width = 256 * s;
  c.height = 64 * s;
  const g = c.getContext("2d")!;
  g.scale(s, s);
  g.textAlign = "center";
  g.fillStyle = pal.fg;
  g.font = "600 22px ui-monospace, Menlo, Consolas, monospace";
  g.fillText(text, 128, 28, 250);
  g.fillStyle = pal.muted;
  g.font = "italic 18px Georgia, serif";
  g.fillText(sub, 128, 52, 250);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(3.2, 0.8, 1);
  return sp;
}

/** Where each node sits: the root on top, rings below. */
function layout(p: Pool): Map<string, Vector3> {
  const pos = new Map<string, Vector3>();
  pos.set("root", new Vector3(0, 3.4, 0));
  const tops = topLevels(p);
  const R = 3.2 + tops.length * 0.25;
  tops.forEach((t, i) => {
    const a = (i / tops.length) * Math.PI * 2;
    const tp = new Vector3(Math.sin(a) * R, 1.2, Math.cos(a) * R);
    pos.set(t.id, tp);
    const place = (v: Vdev, at: Vector3, y: number, r: number, around: number) => {
      v.kids.forEach((k, j) => {
        const n = v.kids.length;
        const b = around + (n === 1 ? 0 : ((j - (n - 1) / 2) / n) * Math.PI * 1.1);
        const kp = new Vector3(at.x + Math.sin(b) * r, y, at.z + Math.cos(b) * r);
        pos.set(k, kp);
        const kv = p.vdevs[k];
        if (kv.kids.length) place(kv, kp, y - 1.7, 0.8, b);
      });
    };
    place(t, tp, -0.9, 1.6, a);
  });
  // Beside the tree: spares, then cache, in a column apart.
  const aux = [...p.spares, ...p.l2cache].filter((id) => !p.vdevs[id].parent);
  aux.forEach((id, i) => pos.set(id, new Vector3(R + 2.6, 2.6 - i * 1.6, 0)));
  return pos;
}

export function mount(host: HTMLElement, opts: { onPick: (id: string) => void; label: string; describedBy?: string }): Scene3d {
  let pal = palette();
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label);
  if (opts.describedBy) canvas.setAttribute("aria-describedby", opts.describedBy);
  canvas.className = "vd-canvas";
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(4, 10, 6);
  scene.add(sun);
  const world = new Group();
  scene.add(world);

  // The camera orbits the tree: yaw, pitch, distance.
  const view = { yaw: 0.5, pitch: 0.38, dist: 15 };
  const target = new Vector3(0, 0.6, 0);
  const place = () => {
    camera.position.set(
      target.x + view.dist * Math.cos(view.pitch) * Math.sin(view.yaw),
      target.y + view.dist * Math.sin(view.pitch),
      target.z + view.dist * Math.cos(view.pitch) * Math.cos(view.yaw),
    );
    camera.lookAt(target);
  };

  const resize = () => {
    const w = host.clientWidth || 600;
    const h = Math.max(320, Math.min(620, Math.round(w * 0.62)));
    renderer.setSize(w, h, false);
    canvas.style.width = "100%";
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    frame();
  };

  const boxGeo = new BoxGeometry(1.5, 0.42, 0.7);
  const leafGeo = new BoxGeometry(0.9, 0.32, 0.5);
  const blockGeo = new BoxGeometry(0.22, 0.22, 0.22);
  const pulseGeo = new SphereGeometry(0.09, 12, 8);
  const meshes = new Map<string, Mesh>();
  let pulses: { mesh: Mesh; from: Vector3; to: Vector3; t0: number; dur: number }[] = [];
  let falls: { mesh: Mesh; from: Vector3; to: Vector3; t0: number; dur: number }[] = [];
  let raf = 0;
  let disposed = false;
  let fitted = false;

  const colorOf = (v: Vdev) => {
    if (v.id === "root") return pal.muted;
    if (v.parent === "root") return pal[classOfTop(v) as "normal" | "log" | "special" | "dedup"];
    if (v.type === "replacing" || v.type === "spare") return pal.bad;
    return pal.old;
  };

  function draw(p: Pool, io: LastIo | null, selected: string | null, animate: boolean) {
    pal = palette();
    for (const o of [...world.children]) {
      world.remove(o);
      o.traverse((x) => {
        const m = x as Mesh & { material?: { map?: { dispose(): void }; dispose(): void } };
        m.material?.map?.dispose();
        m.material?.dispose?.();
      });
    }
    meshes.clear();
    pulses = [];
    falls = [];
    const pos = layout(p);
    if (!fitted) {
      // Frame the whole scene once; later draws keep the visitor's view.
      const lo = new Vector3(Infinity, Infinity, Infinity);
      const hi = new Vector3(-Infinity, -Infinity, -Infinity);
      for (const v of pos.values()) {
        lo.min(v);
        hi.max(v);
      }
      target.copy(lo).add(hi).multiplyScalar(0.5);
      view.dist = Math.max(10, hi.distanceTo(lo) * 0.95);
      fitted = true;
    }
    const lit = new Set<string>();
    const order: { from: string; to: string; depth: number }[] = [];
    const go = (h: Hop, parent: string, depth: number) => {
      if (h.vdev !== "zio") {
        lit.add(h.vdev);
        order.push({ from: parent, to: h.vdev, depth });
      }
      for (const k of h.kids) go(k, h.vdev === "zio" ? "root" : h.vdev, depth + 1);
    };
    if (io) go(io.trace, "root", 0);

    // Edges of the tree; the lit ones in the accent colour.
    const plain: number[] = [];
    const hot: number[] = [];
    for (const [id, at] of pos) {
      const v = p.vdevs[id];
      if (!v?.parent) continue;
      const from = pos.get(v.parent)!;
      (lit.has(id) ? hot : plain).push(from.x, from.y - 0.2, from.z, at.x, at.y + 0.2, at.z);
    }
    const seg = (arr: number[], color: string, opacity: number) => {
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(arr, 3));
      return new LineSegments(g, new LineBasicMaterial({ color: new Color(color), transparent: true, opacity }));
    };
    world.add(seg(plain, pal.line, 0.9), seg(hot, pal.accent, 1));

    // Nodes and labels.
    for (const [id, at] of pos) {
      const v = p.vdevs[id];
      const leaf = OPS[v.type].leaf;
      const m = new Mesh(leaf ? leafGeo : boxGeo, new MeshLambertMaterial({ color: new Color(colorOf(v)), emissive: new Color(lit.has(id) ? pal.accent : "#000000"), emissiveIntensity: lit.has(id) ? 0.45 : 0 }));
      m.position.copy(at);
      m.userData.id = id;
      if (id === selected) m.scale.setScalar(1.18);
      world.add(m);
      meshes.set(id, m);
      const sp = label(v.name, OPS[v.type].type, pal);
      sp.position.set(at.x, at.y + (leaf ? 0.62 : 0.75), at.z);
      world.add(sp);
    }
    // The hot spares and cache, captioned as the lists they are.
    const aux = [...p.spares, ...p.l2cache].filter((id) => !p.vdevs[id].parent);
    if (aux.length) {
      const first = pos.get(aux[0])!;
      const cap = label("spa_spares · spa_l2cache", "", pal);
      cap.position.set(first.x, first.y + 1.5, first.z);
      world.add(cap);
    }

    // Blocks landed on each top-level vdev, stacked; the last one falls from the root.
    const counts = blocksPerTop(p);
    const last = io?.type === "write" ? new Set(io.block.dvas.map((d) => d.top)) : new Set<string>();
    const bmat = new MeshBasicMaterial({ color: new Color(pal.accent) });
    for (const [top, n] of counts) {
      const at = pos.get(top);
      if (!at) continue;
      for (let i = 0; i < Math.min(n, 12); i++) {
        const m = new Mesh(blockGeo, bmat);
        const to = new Vector3(at.x - 0.6 + (i % 6) * 0.24, at.y + 0.33 + Math.floor(i / 6) * 0.24, at.z);
        m.position.copy(to);
        world.add(m);
        if (animate && last.has(top) && i === Math.min(n, 12) - 1) falls.push({ mesh: m, from: pos.get("root")!.clone(), to, t0: performance.now(), dur: 520 });
      }
    }
    // Pulses down the edges, depth by depth, after the block has landed.
    if (animate && io) {
      const t0 = performance.now() + (io.type === "write" ? 480 : 0);
      for (const o of order) {
        const from = pos.get(o.from);
        const to = pos.get(o.to);
        if (!from || !to) continue;
        const mesh = new Mesh(pulseGeo, new MeshBasicMaterial({ color: new Color(pal.accent) }));
        mesh.visible = false;
        world.add(mesh);
        pulses.push({ mesh, from, to, t0: t0 + o.depth * 360, dur: 340 });
      }
    }
    for (const f of falls) f.mesh.position.copy(f.from);
    frame();
    if (pulses.length || falls.length) loop();
  }

  function frame() {
    place();
    renderer.render(scene, camera);
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now: number) => {
      if (disposed) return;
      let busy = false;
      for (const f of falls) {
        const k = Math.min(1, Math.max(0, (now - f.t0) / f.dur));
        f.mesh.position.lerpVectors(f.from, f.to, 1 - (1 - k) ** 3);
        if (k < 1) busy = true;
      }
      for (const x of pulses) {
        const k = (now - x.t0) / x.dur;
        x.mesh.visible = k >= 0 && k <= 1;
        if (k < 1) busy = true;
        if (x.mesh.visible) x.mesh.position.lerpVectors(x.from, x.to, k);
      }
      frame();
      if (busy) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // Turning the tree: drag, arrow keys; + and − zoom; a click picks a node.
  let drag: { x: number; y: number; moved: boolean } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    view.yaw -= dx * 0.008;
    view.pitch = Math.min(1.2, Math.max(-0.2, view.pitch + dy * 0.006));
    frame();
  });
  const ray = new Raycaster();
  canvas.addEventListener("pointerup", (e) => {
    const was = drag;
    drag = null;
    if (!was || was.moved) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...meshes.values()], false)[0];
    if (hit) opts.onPick(hit.object.userData.id);
  });
  canvas.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") view.yaw -= 0.15;
    else if (k === "ArrowRight") view.yaw += 0.15;
    else if (k === "ArrowUp") view.pitch = Math.min(1.2, view.pitch + 0.1);
    else if (k === "ArrowDown") view.pitch = Math.max(-0.2, view.pitch - 0.1);
    else if (k === "+" || k === "=") view.dist = Math.max(9, view.dist - 1);
    else if (k === "-" || k === "−") view.dist = Math.min(26, view.dist + 1);
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
