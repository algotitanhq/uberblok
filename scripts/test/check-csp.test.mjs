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
  for (const html of ['<a xlink:href="javascript:x()">', '<a href="java&#115;cript:x()">', '<b onclick=x()>', '<b onclick = "x()">', '<a title="a > b" onclick="x()">', '<a href="javascript:x()">']) {
    assert.equal(check(headers(""), [["a.html", html]]).length, 1, html);
  }
  assert.deepEqual(check(headers(""), [["a.html", '<a title="onclick=x" data-x="a > b">t</a>']]), []);
});

test("hashes an inline script with a data-src attribute", () => {
  assert.equal(check(headers(""), [["a.html", `<script data-src="x">${A}</script>`]]).length, 1);
  assert.equal(check(headers(""), [["a.html", `<script data-note=" src=x">${A}</script>`]]).length, 1);
});

test("runs as a command and reports the pages it checked", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const d = mkdtempSync(join(tmpdir(), "csp-"));
  writeFileSync(join(d, "_headers"), headers(sha256(A)));
  writeFileSync(join(d, "a.html"), `<script>${A}</script>`);
  const out = execFileSync(process.execPath, [new URL("../check-csp.mjs", import.meta.url).pathname, join(d, "_headers"), join(d, "a.html")], { encoding: "utf8" });
  assert.match(out, /^1 pages, every inline script allowed by its hash/);
});

test("flags a second policy, an overriding directive and weakening sources", () => {
  const h = `/*\n  Content-Security-Policy: script-src 'self' 'unsafe-eval' https: *; script-src-elem 'self'\n/en/*\n  Content-Security-Policy: script-src 'none'\n`;
  const p = check(h, []);
  for (const s of ["rule /en/*", "script-src-elem", "'unsafe-eval'", "https:", "allows *"]) assert.ok(p.some((x) => x.includes(s)), s);
  const q = check(`/*\n  Content-Security-Policy: script-src 'self' cdn.example.com https://*.example.com; SCRIPT-SRC-ATTR 'unsafe-inline'\n`, []);
  for (const s of ["cdn.example.com", "https://*.example.com", "script-src-attr"]) assert.ok(q.some((x) => x.includes(s)), s);
});

test("reads a _headers file with CRLF line endings", () => {
  assert.match(policy("/*\r\n  Content-Security-Policy: script-src 'self'\r\n"), /^script-src 'self'$/);
});

test("allows exactly the two Cloudflare Web Analytics hosts, nowhere else", () => {
  const ok = `/*\n  Content-Security-Policy: script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com\n`;
  assert.deepEqual(check(ok, [["a.html", '<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"x"}\'></script>']]), []);
  const bad = `/*\n  Content-Security-Policy: script-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com/ http://static.cloudflareinsights.com https://*.cloudflareinsights.com; connect-src 'self' https://static.cloudflareinsights.com https://example.com *\n`;
  const p = check(bad, []);
  assert.equal(p.length, 7, p.join("\n"));
  for (const s of ["script-src allows https://cloudflareinsights.com", "script-src allows https://static.cloudflareinsights.com/", "http://static", "https://*.", "connect-src allows https://static.cloudflareinsights.com", "connect-src allows https://example.com", "connect-src allows *"]) assert.ok(p.some((x) => x.includes(s)), s);
});
