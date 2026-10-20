#!/usr/bin/env node
// Checks every OpenZFS permalink in the given Markdown files against a local
// clone of openzfs/zfs at the frozen SHA.
//   - A permalink immediately followed by a fenced code block is an excerpt:
//     the block must equal lines Lx..Ly of `git show <sha>:<path>`, byte for byte.
//   - Any other permalink must point inside the file (line range in bounds).
//   - Every permalink must use the frozen SHA.
//   - Every excerpted file must carry `SPDX-License-Identifier: CDDL-1.0`
//     (we quote under CDDL with attribution; anything else is flagged).
// Usage: node scripts/check-permalinks.mjs <openzfs-clone> <sha> FILE.md...
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [repo, sha, ...files] = process.argv.slice(2);
if (!repo || !sha || files.length === 0) {
  console.error("usage: check-permalinks.mjs <openzfs-clone> <sha> FILE.md...");
  process.exit(2);
}

const cache = new Map();
function source(path) {
  if (!cache.has(path)) {
    try {
      const text = execFileSync("git", ["-C", repo, "show", `${sha}:${path}`], {
        encoding: "utf8",
        maxBuffer: 64 << 20,
        stdio: ["ignore", "pipe", "ignore"],
      });
      cache.set(path, text.split("\n"));
    } catch {
      cache.set(path, null);
    }
  }
  return cache.get(path);
}

const link = /https:\/\/github\.com\/openzfs\/zfs\/blob\/([0-9a-f]+)\/([^\s#)\]]+)#L(\d+)(?:-L(\d+))?/;
let excerpts = 0, refs = 0, failures = 0;

for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const all = [...lines[i].matchAll(new RegExp(link, "g"))];
    for (const m of all) {
      const [, linkSha, path, a, b] = m;
      const from = Number(a), to = Number(b ?? a);
      const where = `${file}:${i + 1} ${path}#L${from}${b ? `-L${to}` : ""}`;
      const fail = (msg) => { failures++; console.log(`FAIL ${where}: ${msg}`); };
      if (linkSha !== sha) { fail(`SHA ${linkSha} is not the frozen SHA`); continue; }
      const src = source(path);
      if (!src) { fail("file not found at frozen SHA"); continue; }
      if (from < 1 || to < from || to > src.length) { fail(`range out of bounds (file has ${src.length} lines)`); continue; }

      // Excerpt: the next non-blank line opens a code fence. Only a line with
      // exactly one link may introduce an excerpt; with two or more links the
      // fence would be left unchecked, so that is a failure, not a reference.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      const fenceNext = j < lines.length && lines[j].startsWith("```");
      if (fenceNext && all.length > 1) {
        if (m === all[0]) fail(`code fence follows a line with ${all.length} permalinks; an excerpt needs exactly one`);
        refs++;
        continue;
      }
      if (fenceNext) {
        const body = [];
        let k = j + 1;
        while (k < lines.length && !lines[k].startsWith("```")) body.push(lines[k++]);
        const want = src.slice(from - 1, to);
        excerpts++;
        if (!src.slice(0, 5).some((l) => l.includes("SPDX-License-Identifier: CDDL-1.0")))
          fail("excerpted file is not marked CDDL-1.0 in its SPDX header");
        if (body.length !== want.length) { fail(`excerpt has ${body.length} lines, permalink spans ${want.length}`); continue; }
        const bad = body.findIndex((l, n) => l !== want[n]);
        if (bad >= 0) fail(`line ${from + bad} differs:\n    md : ${JSON.stringify(body[bad])}\n    src: ${JSON.stringify(want[bad])}`);
        else if (want.length > 40) console.log(`WARN ${where}: excerpt is ${want.length} lines (> 40)`);
      } else {
        refs++;
      }
    }
  }
}

console.log(`${excerpts} excerpts, ${refs} line references, ${failures} failures`);
process.exit(failures ? 1 : 0);
