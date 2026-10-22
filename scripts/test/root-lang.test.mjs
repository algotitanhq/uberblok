import { test } from "node:test";
import assert from "node:assert/strict";
import { pickLang } from "../../worker/root-lang.js";

test("the switch's cookie wins over the browser", () => {
  assert.equal(pickLang("theme=x; lang=es", "fr-CA,fr;q=0.9"), "es");
  assert.equal(pickLang("lang=en", "fr"), "en");
});

test("an unknown or malformed cookie falls back to the browser", () => {
  assert.equal(pickLang("lang=de", "fr"), "fr");
  assert.equal(pickLang("xlang=es", "en"), "en");
  assert.equal(pickLang("lang=esp", "en"), "en");
});

test("French if listed at all, else Spanish, else English", () => {
  assert.equal(pickLang(null, "en-US,en;q=0.9,fr;q=0.3"), "fr");
  assert.equal(pickLang(null, "en-US,es-419;q=0.8"), "es");
  assert.equal(pickLang(null, "FR-ca"), "fr");
  assert.equal(pickLang(null, "de-DE,de;q=0.9"), "en");
  assert.equal(pickLang(null, null), "en");
  assert.equal(pickLang(null, "*"), "en");
});

test("a language refused with q=0 does not count", () => {
  assert.equal(pickLang(null, "en, fr;q=0"), "en");
  assert.equal(pickLang(null, "en, fr;q=0.0, es;q=0.5"), "es");
});

test("a tag that only starts with the letters is not the language", () => {
  assert.equal(pickLang(null, "fra"), "en");
  assert.equal(pickLang(null, "fy-NL"), "en");
});
