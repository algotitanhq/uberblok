// A few lines to build SVG and HTML without a framework.
const SVG = "http://www.w3.org/2000/svg";

type Attrs = Record<string, string | number | boolean | undefined>;

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  el.append(...kids);
  return el;
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export const wait = (ms: number) => new Promise((r) => setTimeout(r, reducedMotion() ? 0 : ms));

/** Strings handed from the Astro component to its script as JSON. */
export function strings<T>(root: HTMLElement): T {
  return JSON.parse(root.dataset.strings ?? "{}") as T;
}

/** Fill a template: "slot {n} of {count}". */
export const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
