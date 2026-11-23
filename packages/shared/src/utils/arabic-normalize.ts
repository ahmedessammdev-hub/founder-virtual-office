/**
 * Normalizes Arabic and English text for FTS5 indexing and search matching.
 * Strips Arabic diacritics and tatweel, unifies alef/yeh/teh-marbuta variants,
 * lowercases Latin text, and collapses whitespace while leaving source files intact.
 */
export function normalizeForSearch(input: string): string {
  if (!input) {
    return "";
  }

  return input
    .normalize("NFKC")
    // Strip Arabic diacritics & Quranic/harakat marks + superscript alef
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    // Strip tatweel (kashida)
    .replace(/\u0640/g, "")
    // Unify Arabic letter variants
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    // Lowercase Latin characters
    .toLowerCase()
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();
}
