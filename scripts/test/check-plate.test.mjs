// Tests for scripts/check-plate.mjs against a throwaway git repository holding
// one CDDL file, so they need neither network nor the OpenZFS clone.
// Run: node --test scripts/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checker = join(dirname(fileURLToPath(import.meta.url)), "..", "check-plate.mjs");
const repo = mkdtempSync(join(tmpdir(), "plate-repo-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
mkdirSync(join(repo, "include"));
const source = ["// SPDX-License-Identifier: CDDL-1.0", "struct a {", "\tint b;", "};", "int c;"];
writeFileSync(join(repo, "include", "x.h"), source.join("\n") + "\n");
git("add", ".");
git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "fixture");
const sha = git("rev-parse", "HEAD");
const hash = (lines) => createHash("sha256").update(lines.join("\n")).digest("hex");

function check(source, s = sha) {
  const dir = mkdtempSync(join(tmpdir(), "plate-json-"));
  const file = join(dir, "plate.json");
  writeFileSync(file, JSON.stringify({ source }));
  const r = spawnSync(process.execPath, [checker, repo, s, file], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
}
const good = { file: "include/x.h", sha, printed: [2, 4], lens: [3, 3], sha256: hash(source.slice(1, 4)) };

test("the printed lines of the frozen commit pass", () => {
  const r = check(good);
  assert.equal(r.code, 0, r.out);
});

test("a printed text that differs from the file fails", () => {
  const r = check({ ...good, sha256: hash(["struct a {", "\tint B;", "};"]) });
  assert.equal(r.code, 1);
  assert.match(r.out, /do not match/);
});

test("another commit, a range out of the file, a lens outside the print: each fails", () => {
  assert.match(check({ ...good, sha: "0".repeat(40) }).out, /not the frozen SHA/);
  assert.match(check({ ...good, printed: [2, 9] }).out, /out of/);
  assert.match(check({ ...good, lens: [1, 3] }).out, /outside the printed/);
});

test("a range one past the last line fails (the final newline is not a line)", () => {
  assert.match(check({ ...good, printed: [2, 6], sha256: hash([...source.slice(1), ""]) }).out, /out of/);
});

test("the image the plate names must be the one it was rendered with", () => {
  const dir = mkdtempSync(join(tmpdir(), "plate-img-"));
  writeFileSync(join(dir, "fig.webp"), "rendered");
  const file = join(dir, "plate.json");
  const run = (sha256) => {
    writeFileSync(file, JSON.stringify({ image: { file: "fig.webp", sha256 }, source: good }));
    return spawnSync(process.execPath, [checker, repo, sha, file], { encoding: "utf8" });
  };
  assert.equal(run(createHash("sha256").update("rendered").digest("hex")).status, 0);
  const stale = run(createHash("sha256").update("older").digest("hex"));
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /not the image/);
});
