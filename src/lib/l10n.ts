// Numbers and lists in the page's language (DECISIONS.md D16.3). English: a comma
// between thousands, a decimal point. French: a narrow no-break space between
// thousands, a decimal comma. Spanish: a decimal comma, and a narrow no-break
// space between thousands from five digits on (RAE: 4211 but 92 000).

/** Groups the digits of a whole number (a leading minus sign is kept). */
export function group(lang: string, digits: string): string {
  if (lang === "es" && digits.replace(/^-/, "").length < 5) return digits;
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, lang === "en" ? "," : " ");
}

/** A decimal written with a point, in the page's language. */
export const decimal = (lang: string, s: string): string => (lang === "en" ? s : s.replace(".", ","));

/** The last separator of a list: "a, b and c", « a, b et c », "a, b y c". */
export const and = (lang: string): string => (lang === "fr" ? " et " : lang === "es" ? " y " : " and ");
