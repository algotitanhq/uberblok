// Excerpts are never copied into the site's sources: they are read at build
// time from ANALYSIS.md, the file scripts/check-permalinks.mjs proves
// byte-identical to OpenZFS at the frozen SHA. An unknown permalink fails the build.
import raw from "../../ANALYSIS.md?raw";
import { OPENZFS_SHA } from "./openzfs";

const analysis: string[] = raw.split("\n");

export interface Excerpt {
  url: string;
  path: string;
  from: number;
  to: number;
  code: string;
}

export function excerpt(path: string, from: number, to: number): Excerpt {
  const url = `https://github.com/openzfs/zfs/blob/${OPENZFS_SHA}/${path}#L${from}-L${to}`;
  const at = analysis.findIndex((l) => l.trim() === url);
  if (at < 0) throw new Error(`excerpt ${path}#L${from}-L${to} is not in ANALYSIS.md`);
  let j = at + 1;
  while (j < analysis.length && analysis[j].trim() === "") j++;
  if (!analysis[j]?.startsWith("```")) throw new Error(`no code fence after ${url} in ANALYSIS.md`);
  const body: string[] = [];
  for (let k = j + 1; k < analysis.length && !analysis[k].startsWith("```"); k++) body.push(analysis[k]);
  if (body.length !== to - from + 1) throw new Error(`excerpt ${url} has ${body.length} lines`);
  return { url, path, from, to, code: body.join("\n") };
}

/** How many excerpts ANALYSIS.md holds (each is a permalink followed by a code fence). */
export function excerptCount(): number {
  let n = 0;
  for (let i = 0; i < analysis.length; i++) {
    if (!analysis[i].trim().startsWith(`https://github.com/openzfs/zfs/blob/${OPENZFS_SHA}/`)) continue;
    let j = i + 1;
    while (j < analysis.length && analysis[j].trim() === "") j++;
    if (analysis[j]?.startsWith("```")) n++;
  }
  return n;
}
