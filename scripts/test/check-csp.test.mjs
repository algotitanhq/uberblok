// Tests for scripts/check-csp.mjs. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { check, policy, sha256 } from "../check-csp.mjs";

const A = "console.log(1);";
const headers = (srcs) => `# comment\n/*\n  X-Frame-Options: DENY\n  Content-Security-Policy: default-src 'self'; script-src 'self' ${srcs}; object-src 'none'\n`;

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

test("catches event handlers in every form, and javascript: URLs", () => {
  for (const html of ['<b onclick=x()>', '<b onclick = "x()">', '<a title="a > b" onclick="x()">', '<a href="javascript:x()">']) {
    assert.equal(check(headers(""), [["a.html", html]]).length, 1, html);
  }
  assert.deepEqual(check(headers(""), [["a.html", '<a title="onclick=x" data-x="a > b">t</a>']]), []);
});

test("hashes an inline script with a data-src attribute", () => {
  assert.equal(check(headers(""), [["a.html", `<script data-src="x">${A}</script>`]]).length, 1);
});

test("flags a second policy, an overriding directive and weakening sources", () => {
  const h = `/*\n  Content-Security-Policy: script-src 'self' 'unsafe-eval' https: *; script-src-elem 'self'\n/en/*\n  Content-Security-Policy: script-src 'none'\n`;
  const p = check(h, []);
  for (const s of ["rule /en/*", "script-src-elem", "'unsafe-eval'", "https:", "allows *"]) assert.ok(p.some((x) => x.includes(s)), s);
});

test("reads a _headers file with CRLF line endings", () => {
  assert.match(policy("/*\r\n  Content-Security-Policy: script-src 'self'\r\n"), /^script-src 'self'$/);
});
