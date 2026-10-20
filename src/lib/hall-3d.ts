// The Hall object in 3D: one label's uberblock ring as a ring of slots in
// space, the slot of the newest txg raised in the accent colour, the previous
// one muted, the txg in the middle. The same state as the 2D ring (ashift and
// txg, handed by it), never more. Loaded only by a dynamic import from
// UberblockRing.astro after its first paint (DECISIONS.md D12.5, D14.2).
import {
  AmbientLight, BoxGeometry, CanvasTexture, Color, DirectionalLight, Group, Mesh, MeshLambertMaterial,
  PerspectiveCamera, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, WebGLRenderer,
} from "three";

// The newest uberblock's flight to its slot: 0.4 s of a 1.3 s txg (DECISIONS.md D16.2).
const FLIGHT_MS = 400;

export interface Ring3d {
  draw(count: number, txg: number, animate: boolean): void;
  dispose(): void;
}

function text(lines: [string, string][], color: string): Sprite {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  lines.forEach(([t, font], i) => {
    g.fillStyle = color;
    g.font = font;
    g.fillText(t, 256, 110 + i * 70, 500);
  });
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const sp = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(4, 2, 1);
  return sp;
}

export function mount(host: HTMLElement, opts: { label: string; describedBy?: string; slotOf: (n: number, count: number) => string }): Ring3d {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", opts.label);
  if (opts.describedBy) canvas.setAttribute("aria-describedby", opts.describedBy);
  canvas.className = "ring-canvas";
  host.append(canvas);

  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.1, 100);
  scene.add(new AmbientLight(0xffffff, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 5);
  scene.add(sun);
  const world = new Group();
  scene.add(world);
  const view = { yaw: 0, pitch: 0.75, dist: 14 };
  const target = new Vector3(0, 0.3, 0);
  const frame = () => {
    camera.position.set(
      view.dist * Math.cos(view.pitch) * Math.sin(view.yaw),
      view.dist * Math.sin(view.pitch),
      view.dist * Math.cos(view.pitch) * Math.cos(view.yaw),
    );
    camera.lookAt(target);
    renderer.render(scene, camera);
  };
  // A square, like the 2D ring it replaces: the swap does not move the page.
  const resize = () => {
    const w = host.clientWidth || 400;
    renderer.setSize(w, w, false);
    canvas.style.width = "100%";
    canvas.style.height = `${w}px`;
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    frame();
  };

  let raf = 0;
  let disposed = false;
  // The newest uberblock flies from the middle of the ring to its slot, then settles raised.
  let rise: { mesh: Mesh; t0: number; x: number; z: number; a: number } | null = null;

  function draw(count: number, txg: number, animate: boolean) {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim() || "#888";
    for (const o of [...world.children]) {
      world.remove(o);
      o.traverse((x) => {
        const m = x as Mesh & { material?: { map?: { dispose(): void }; dispose(): void } };
        m.material?.map?.dispose();
        m.material?.dispose?.();
        // The sprite's geometry is Three.js's own, shared by every sprite.
        if (!(x as Sprite).isSprite) m.geometry?.dispose();
      });
    }
    const n = txg % count;
    const pn = (txg - 1) % count;
    const R = 3.2;
    const arc = (2 * Math.PI * R) / count;
    const geo = new BoxGeometry(Math.max(0.04, arc * 0.78), 0.32, 0.6);
    const mats = { slot: new MeshLambertMaterial({ color: new Color(v("--line-strong")) }), prev: new MeshLambertMaterial({ color: new Color(v("--fg-muted")) }), now: new MeshLambertMaterial({ color: new Color(v("--accent")), emissive: new Color(v("--accent")), emissiveIntensity: 0.3 }) };
    rise = null;
    for (let i = 0; i < count; i++) {
      // Slot 0 at the top, clockwise, as in the 2D ring.
      const a = ((i + 0.5) / count) * Math.PI * 2;
      const m = new Mesh(geo, i === n ? mats.now : i === pn ? mats.prev : mats.slot);
      m.position.set(R * Math.sin(a), i === n ? 0.35 : 0, -R * Math.cos(a));
      m.rotation.y = -a;
      if (i === n) m.scale.y = 2;
      world.add(m);
      if (i === n && animate) {
        rise = { mesh: m, t0: performance.now(), x: m.position.x, z: m.position.z, a: -a };
        m.position.set(0, 1.95, 0);
        m.rotation.y = 0;
      }
    }
    const label = text([[`txg ${txg}`, "300 64px Georgia, serif"], [opts.slotOf(n, count), "italic 40px Georgia, serif"]], v("--fg"));
    label.position.set(0, 0.4, 0);
    world.add(label);
    frame();
    if (rise) loop();
  }

  function loop() {
    cancelAnimationFrame(raf);
    const tick = (now: number) => {
      if (disposed || !rise) return;
      const k = Math.min(1, (now - rise.t0) / FLIGHT_MS);
      const e = 1 - (1 - k) ** 3;
      // From above the middle, along an arc, to the slot; it turns to face the ring as it goes.
      rise.mesh.position.set(rise.x * e, 0.35 + 1.6 * (1 - e) + 0.8 * Math.sin(Math.PI * e), rise.z * e);
      rise.mesh.rotation.y = rise.a * e;
      frame();
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  // Turning the ring: drag, arrow keys; + and − zoom.
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    view.yaw -= (e.clientX - drag.x) * 0.008;
    view.pitch = Math.min(1.45, Math.max(0.1, view.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
    frame();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "ArrowLeft") view.yaw -= 0.15;
    else if (k === "ArrowRight") view.yaw += 0.15;
    else if (k === "ArrowUp") view.pitch = Math.min(1.45, view.pitch + 0.1);
    else if (k === "ArrowDown") view.pitch = Math.max(0.1, view.pitch - 0.1);
    else if (k === "+" || k === "=") view.dist = Math.max(8, view.dist - 0.5);
    else if (k === "-" || k === "−") view.dist = Math.min(22, view.dist + 0.5);
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
