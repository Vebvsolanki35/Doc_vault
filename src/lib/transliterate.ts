/**
 * Devanagari → Latin phonetic transliteration for search.
 * Dad says "रमेश" but files are often named "Ramesh" — this bridges the two.
 * Variants include a schwa-deleted final vowel ("ramesha" → "ramesh"),
 * covering the vast majority of Indian name spellings.
 */
const CONS: Record<string, string> = {
  "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n",
  "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
  "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
  "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
  "य": "y", "र": "r", "ल": "l", "व": "v",
  "श": "sh", "ष": "sh", "स": "s", "ह": "h",
};
const INDEP: Record<string, string> = {
  "अ": "a", "आ": "a", "इ": "i", "ई": "i", "उ": "u", "ऊ": "u",
  "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e",
};
const MATRA: Record<string, string> = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ri",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ं": "n", "ँ": "n", "ः": "",
};

export function hasDevanagari(s: string): boolean {
  return /[\u0900-\u097F]/.test(s);
}

export function devToLatin(input: string): string {
  let out = "";
  const chars = [...input];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (CONS[c]) {
      const next = chars[i + 1];
      if (next === "्") { out += CONS[c]; i++; continue; }
      if (next !== undefined && MATRA[next] !== undefined) { out += CONS[c] + MATRA[next]; i++; continue; }
      out += CONS[c] + "a";
      continue;
    }
    if (INDEP[c]) { out += INDEP[c]; continue; }
    if (MATRA[c] !== undefined && out) { out += MATRA[c]; continue; }
    out += c;
  }
  return out.toLowerCase();
}

/** All matchable variants of a query term (original + latinised + schwa-deleted). */
export function termVariants(term: string): string[] {
  const variants = new Set<string>([term.toLowerCase()]);
  if (hasDevanagari(term)) {
    const latin = devToLatin(term);
    variants.add(latin);
    if (latin.endsWith("a") && latin.length > 2) variants.add(latin.slice(0, -1));
  }
  return [...variants];
}
