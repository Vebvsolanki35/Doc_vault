/**
 * Number helpers for the bilingual vault.
 * Displays figures as Devanagari digits AND Hindi words so amounts
 * (land area, khasra numbers, money) are unmistakable for seniors.
 */

const DEV_DIGITS: Record<string, string> = {
  "0": "०", "1": "१", "2": "२", "3": "३", "4": "४",
  "5": "५", "6": "६", "7": "७", "8": "८", "9": "९",
};

export function toDevanagariDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (d) => DEV_DIGITS[d]);
}

/** 0..99 in Hindi words — the irregular base table every larger number builds on. */
const HI_WORDS = [
  "शून्य","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ",
  "दस","ग्यारह","बारह","तेरह","चौदह","पंद्रह","सोलह","सत्रह","अठारह","उन्नीस",
  "बीस","इक्कीस","बाईस","तेईस","चौबीस","पच्चीस","छब्बीस","सत्ताईस","अट्ठाईस","उनतीस",
  "तीस","इकतीस","बतीस","तैंतीस","चौंतीस","पैंतीस","छत्तीस","सैंतीस","अड़तीस","उनतालीस",
  "चालीस","इकतालीस","बयालीस","तैंतालीस","चवालीस","पैंतालीस","छियालीस","सैंतालीस","अड़तालीस","उनचास",
  "पचास","इक्यावन","बावन","तिरपन","चौवन","पचपन","छप्पन","सत्तावन","अठावन","उनसठ",
  "साठ","इकसठ","बासठ","तिरसठ","चौंसठ","पैंसठ","छियासठ","सड़सठ","अड़सठ","उनहत्तर",
  "सत्तर","इकहत्तर","बहत्तर","तिहत्तर","चौहत्तर","पचहत्तर","छिहत्तर","सतहत्तर","अठहत्तर","उन्यासी",
  "अस्सी","इक्यासी","बयासी","तिरासी","चौरासी","पचासी","छियासी","सत्तासी","अठासी","नवासी",
  "नब्बे","इक्यानवे","बानवे","तिरानवे","चौरानवे","पंचानवे","छियानवे","सत्तानवे","अट्ठानवे","निन्यानवे",
];

function belowThousand(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h > 0) parts.push(HI_WORDS[h], "सौ");
  if (rest > 0) parts.push(HI_WORDS[rest]);
  return parts.join(" ");
}

/** Full Indian-system number → Hindi words (…करोड़ / लाख / हज़ार / सौ). */
export function numberToHindiWords(input: number): string {
  if (!Number.isFinite(input)) return String(input);
  const isNeg = input < 0;
  let n = Math.abs(input);
  const frac = n % 1;
  n = Math.floor(n);
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const hazar = Math.floor(n / 1e3); n %= 1e3;
  if (crore > 0) parts.push(belowThousand(crore) + (crore >= 1000 ? "" : ""), "करोड़");
  if (lakh > 0) parts.push(HI_WORDS[lakh], "लाख");
  if (hazar > 0) parts.push(HI_WORDS[hazar], "हज़ार");
  if (n > 0) parts.push(belowThousand(n));
  if (parts.length === 0) parts.push(HI_WORDS[0]);
  let out = parts.join(" ");
  if (frac > 0) {
    const dec = Math.round(frac * 100);
    if (dec > 0) out += " दशमलव " + belowThousand(dec);
  }
  return (isNeg ? "ऋण " : "") + out;
}

/** "1,000" Indian-digit-grouping formatting. */
export function formatIndian(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

/**
 * Dual display:  "2.5 बीघा" →
 *    en: "2.5 / ढाई बीघा"  |  hi: "२.५ / ढाई बीघा"
 * (approximation for common fractional forms)
 */
export function dualNumber(n: number, lang: "en" | "hi"): string {
  const dev = toDevanagariDigits(formatIndian(n));
  const words = numberToHindiWords(n);
  return lang === "hi" ? `${dev} — ${words}` : `${formatIndian(n)} — ${words}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
