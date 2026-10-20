#!/usr/bin/env node
// Checks that the code printed in a rendered figure is the code of the frozen
// commit (DECISIONS.md D16.4): the plate's `source` names a file, a line range
// and the SHA-256 of those lines; they are read again from a clone of
// openzfs/zfs at the frozen SHA and must match, the range must lie inside the
// file, the lens range inside the printed one, and the file must be CDDL-1.0.
// If the plate names its `image` and that file's SHA-256, the image must match
// too, so a stale render cannot sit beside a regenerated plate.
// Usage: node scripts/check-plate.mjs <openzfs-clone> <sha> PLATE.json...
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [repo, sha, ...plates] = process.argv.slice(2);
if (!repo || !sha || plates.length === 0) {
  console.error("usage: check-plate.mjs <openzfs-clone> <sha> PLATE.json...");
  process.exit(2);
}
let failures = 0;
const fail = (msg) => (failures++, console.log(`FAIL ${msg}`));
for (const file of plates) {
  const { source: s, image } = JSON.parse(readFileSync(file, "utf8"));
  if (!s) { fail(`${file}: no source`); continue; }
  if (s.sha !== sha) { fail(`${file}: SHA ${s.sha} is not the frozen SHA`); continue; }
  let text;
  try {
    text = execFileSync("git", ["-C", repo, "show", `${sha}:${s.file}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n");
    if (text.at(-1) === "") text.pop(); // the file's final newline is not a line
  } catch {
    fail(`${file}: ${s.file} not found at the frozen SHA`);
    continue;
  }
  const [a, b] = s.printed;
  if (!(a >= 1 && b >= a && b <= text.length)) { fail(`${file}: lines ${a}-${b} out of ${s.file}`); continue; }
  if (s.lens && !(s.lens[0] >= a && s.lens[1] <= b && s.lens[1] >= s.lens[0])) fail(`${file}: lens lines ${s.lens} outside the printed ones`);
  if (!/SPDX-License-Identifier: CDDL-1\.0/.test(text.slice(0, 5).join("\n"))) fail(`${file}: ${s.file} is not CDDL-1.0`);
  if (image) {
    let bytes;
    try { bytes = readFileSync(join(dirname(file), image.file)); } catch { bytes = null; }
    if (!bytes) fail(`${file}: image ${image.file} not found`);
    else if (createHash("sha256").update(bytes).digest("hex") !== image.sha256) fail(`${file}: ${image.file} is not the image this plate was rendered with`);
  }
  const hash = createHash("sha256").update(text.slice(a - 1, b).join("\n")).digest("hex");
  if (hash !== s.sha256) fail(`${file}: lines ${a}-${b} of ${s.file} do not match the printed text`);
  else console.log(`ok ${file}: ${s.file} lines ${a}-${b} at ${sha.slice(0, 12)}`);
}
process.exit(failures ? 1 : 0);
