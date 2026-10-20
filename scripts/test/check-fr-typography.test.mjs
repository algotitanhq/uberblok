// Tests for scripts/check-fr-typography.mjs. Run: node --test scripts/test/
import { test } from "node:test";
import assert from "node:assert/strict";
import { problems } from "../check-fr-typography.mjs";

test("correct spacing passes", () => {
  assert.deepEqual(problems("<p>Un écart\u202f; une erreur\u00a0: «\u00a0label\u00a0»\u202f? Oui\u202f!</p>"), []);
});

test("a plain space before ; : ! ? fails", () => {
  assert.equal(problems("<p>a ; b : c ! d ?</p>").length, 4);
});

test("the wrong no-break space fails", () => {
  assert.equal(problems("<p>a\u00a0; b\u202f:</p>").length, 2);
});

test("plain spaces inside guillemets fail", () => {
  assert.equal(problems("<p>« label »</p>").length, 2);
});

test("attribute values are checked, code and URLs are not", () => {
  assert.equal(problems('<meta content="Hall : uberblock">').length, 1);
  assert.deepEqual(problems("<pre>a ? b : c;</pre><code>x ? y : z</code><a href=\"https://x\">x</a>"), []);
  assert.equal(problems('<div data-strings="{&quot;a&quot;:&quot;D1 : ok&quot;}"></div>').length, 1);
});
