// On-demand 3D for the two spatial rooms (the vdevs; the tree and the
// uberblock, with the Hall object). Nothing here imports Three.js: a room's
// scene module does, and the room loads that module with a dynamic import
// only when this file says so, so the page renders and works in 2D first
// (DECISIONS.md D11.4). The rooms open in 2D and switch to 3D only when the
// visitor presses the 3D button (D14.1); the Hall opens in 3D, after its first
// paint (D14.2). Without WebGL, or under reduced motion, the 2D view stays.
import { reducedMotion } from "./svg";

let gl: boolean | undefined;

/** Can this browser draw WebGL? Asked once, on a throwaway canvas. */
export function hasWebGL(): boolean {
  if (gl === undefined) {
    try {
      const c = document.createElement("canvas");
      gl = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      gl = false;
    }
  }
  return gl;
}

/**
 * Why the 3D view cannot be offered here, as the key of its sentence in the
 * room's strings: "no3d" without WebGL, "reduced3d" when the visitor asks for
 * reduced motion (a 3D view is a moving one); "" when it can. The rooms keep
 * their 3D button visible but disabled, with this sentence beside it.
 */
export const no3dReason = () => (!hasWebGL() ? "no3d" : reducedMotion() ? "reduced3d" : "");

/** Call `cb` once, the first time `el` comes near the view (a quarter of a screen ahead). */
export function onVisible(el: Element, cb: () => void): void {
  if (!("IntersectionObserver" in window)) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      io.disconnect();
      cb();
    }
  }, { rootMargin: "25% 0px 25% 0px" });
  io.observe(el);
}

/** Load a scene module once; later calls share the same promise. */
export function once<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= load());
}
