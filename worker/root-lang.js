// The language for the root `/` (DECISIONS.md D20.1): the one chosen before with the switch
// (the `lang` cookie), else French if the browser lists French at all, else Spanish if it
// lists Spanish, else English, as the inline script of src/pages/index.astro does.
// Pure, so scripts/test/root-lang.test.mjs covers it.
const LANGS = ["en", "fr", "es"];

export function pickLang(cookieHeader, acceptLanguage) {
  const chosen = /(?:^|;\s*)lang=([a-z]{2})(?:;|$)/.exec(cookieHeader || "");
  if (chosen && LANGS.includes(chosen[1])) return chosen[1];
  const listed = (acceptLanguage || "")
    .split(",")
    .map((part) => part.trim().split(";"))
    .filter(([tag, ...params]) => tag && !params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p)))
    .map(([tag]) => tag.toLowerCase());
  const has = (code) => listed.some((tag) => tag === code || tag.startsWith(code + "-"));
  return has("fr") ? "fr" : has("es") ? "es" : "en";
}
