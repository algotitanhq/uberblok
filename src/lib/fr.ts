// French punctuation spacing (DECISIONS.md D1.9): U+202F before ; ! ?, U+00A0
// before : and % and inside « ». Strings are written with plain spaces and passed
// through this; the build's typography check reads the output.
export const fr = (s: string) =>
  s
    .replace(/ ([;!?])/g, " $1")
    .replace(/ :/g, " :")
    .replace(/ %/g, " %")
    .replace(/« /g, "« ")
    .replace(/ »/g, " »");
