// Tests for the analytics gate (src/lib/analytics.ts, DECISIONS.md D18.2): the beacon
// only with PUBLIC_RELEASE=true and a non-empty token.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

const M = await import("../../src/lib/analytics.ts");

test("beacon with PUBLIC_RELEASE=true and a token", () => {
  assert.equal(M.analyticsOn("true", "0123456789abcdef0123456789abcdef"), true);
});

test("no beacon without PUBLIC_RELEASE=true (previews, branches, local builds)", () => {
  for (const release of [undefined, "", "false", "1", "TRUE"]) assert.equal(M.analyticsOn(release, "0123456789abcdef0123456789abcdef"), false, String(release));
});

test("no beacon with an empty token, even in a release build", () => {
  assert.equal(M.analyticsOn("true", ""), false);
});

test("the committed token is a Cloudflare site token or empty, and off outside a build", () => {
  assert.match(M.CF_WEB_ANALYTICS_TOKEN, /^([0-9a-f]{32})?$/);
  assert.equal(M.ANALYTICS_ON, false);
});
