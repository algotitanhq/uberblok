// What the Engine room states about the site itself, read from the files that
// define it, so the colophon cannot drift from the build.
import pkg from "../../package.json";
import { excerptCount } from "./excerpts";
import { SOURCES } from "./sources";
import { ROOMS } from "./rooms";

export const REPO_URL = "https://github.com/algotitanhq/uberblok";
export const repoFile = (path: string) => `${REPO_URL}/blob/main/${path}`;

const dep = pkg.dependencies as Record<string, string>;
export const VERSIONS = {
  astro: dep.astro,
  three: dep.three,
  shiki: dep.shiki,
  typescript: (pkg.devDependencies as Record<string, string>).typescript,
  playwright: (pkg.devDependencies as Record<string, string>).playwright,
};

export const COUNTS = {
  excerpts: excerptCount(),
  sources: SOURCES.size,
  /** Technical rooms: every room but the Hall, the History wing and this one. */
  rooms: ROOMS.filter((r) => !["hall", "history", "engine-room"].includes(r.id)).length,
};
