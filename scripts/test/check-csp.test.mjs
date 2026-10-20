// Tests for scripts/check-csp.mjs. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, policy, sha256 } from "../check-csp.mjs";

const A = "console.log(1);";
const headers = (srcs) => `# comment\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${srcs}; object-src 'none'\n/en/*\n  Content-Security-Policy: script-src 'none'\n`;

test("reads the policy of the /* rule only", () => {
  assert.match(policy(headers("x")), /^default-src 'self'; script-src 'self' x;/);
  assert.equal(policy("/en/*\n  Content-Security-Policy: x\n"), null);
});

test("passes when every inline script has its hash, and ignores external and JSON scripts", () => {
  const html = `<script>${A}</script><script type="module" src="/a.js"></script><script type="application/ld+json">{}</script>`;
  assert.deepEqual(check(headers(sha256(A)), [["a.html", html]]), []);
});

test("flags a changed inline script, a stale hash, an event handler and unsafe-inline", () => {
  const p = check(headers(`${sha256(A)} 'unsafe-inline'`), [["a.html", `<script>${A} </script><button onclick="x()">`]]);
  assert.equal(p.length, 4);
  assert.ok(p.some((x) => x.includes("not in script-src")));
  assert.ok(p.some((x) => x.includes("matches no inline script")));
  assert.ok(p.some((x) => x.includes("onclick")));
  assert.ok(p.some((x) => x.includes("unsafe-inline")));
});

test("fails without a policy", () => {
  assert.deepEqual(check("/*\n  X-Frame-Options: DENY\n", []), ["no Content-Security-Policy in the /* rule"]);
});
