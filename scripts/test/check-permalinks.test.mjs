// Tests for scripts/check-permalinks.mjs against a throwaway git repository
// holding one CDDL file, so they need neither network nor the OpenZFS clone.
// Run: node --test scripts/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const checker = join(dirname(fileURLToPath(import.meta.url)), "..", "check-permalinks.mjs");
const repo = mkdtempSync(join(tmpdir(), "permalinks-repo-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
mkdirSync(join(repo, "module"));
const source = ["// SPDX-License-Identifier: CDDL-1.0", "int a;", "int b;", "int c;", "int d;"];
writeFileSync(join(repo, "module", "x.c"), source.join("\n") + "\n");
git("add", ".");
git("-c", "user.name=t", "-c", "user.email=t@t.invalid", "commit", "-qm", "fixture");
const sha = git("rev-parse", "HEAD");
const url = (range) => `https://github.com/openzfs/zfs/blob/${sha}/module/x.c#${range}`;

function check(markdown) {
  const dir = mkdtempSync(join(tmpdir(), "permalinks-md-"));
  const file = join(dir, "doc.md");
  writeFileSync(file, markdown);
  const r = spawnSync(process.execPath, [checker, repo, sha, file], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
}

test("an exact excerpt passes", () => {
  const r = check(`${url("L2-L3")}\n\n\`\`\`c\nint a;\nint b;\n\`\`\`\n`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /1 excerpts, 0 line references, 0 failures/);
});

test("a paraphrased excerpt fails", () => {
  const r = check(`${url("L2-L3")}\n\n\`\`\`c\nint a;\nint B;\n\`\`\`\n`);
  assert.equal(r.code, 1);
  assert.match(r.out, /line 3 differs/);
});

test("a range out of bounds fails", () => {
  const r = check(`See [x](${url("L4-L9")}).\n`);
  assert.equal(r.code, 1);
  assert.match(r.out, /out of bounds/);
});

test("a code fence after a line with two permalinks fails instead of being skipped", () => {
  const r = check(`[a](${url("L2")}) and [b](${url("L3")})\n\n\`\`\`c\nnot the source\n\`\`\`\n`);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /code fence follows a line with 2 permalinks/);
  assert.match(r.out, /0 excerpts, 2 line references, 1 failures/);
});

test("two permalinks on a line with no fence after it are references", () => {
  const r = check(`[a](${url("L2")}) and [b](${url("L3")})\n\nText.\n`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /0 excerpts, 2 line references, 0 failures/);
});
