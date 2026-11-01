// The language for the root `/` (DECISIONS.md D20.1, D32.1): the one chosen before with the switch
// (the `lang` cookie), else the first of English, French and Spanish in the browser's own order of
// preference (Accept-Language by q-value, ties in the order listed), else English, as the inline
// script of src/pages/index.astro does with navigator.languages.
// Pure, so scripts/test/root-lang.test.mjs covers it.
const LANGS = ["en", "fr", "es"];

export function pickLang(cookieHeader, acceptLanguage) {
  const chosen = /(?:^|;\s*)lang=([a-z]{2})(?:;|$)/.exec(cookieHeader || "");
  if (chosen && LANGS.includes(chosen[1])) return chosen[1];
  const ranked = (acceptLanguage || "")
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const qp = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find(Boolean);
      const q = qp ? Number(qp[1]) : 1;
      return { lang: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((t) => t.lang && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.find((t) => LANGS.includes(t.lang))?.lang ?? "en";
}
