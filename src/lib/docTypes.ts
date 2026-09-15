/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DOCUMENT TYPE CATALOGUE  (the "Aadhaar-wise / PAN-wise" layer)
 *  A folder tells you *where* a paper lives; the docType tells you *what*
 *  it is. Every type knows its folder, bilingual label and the words that
 *  identify it in a file name, PDF text or a spoken search.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { FolderKey } from "./classifier";

export type DocTypeKey =
  | "aadhaar" | "pan" | "voter" | "passport" | "driving" | "ration" | "birth" | "caste" | "income" | "domicile" | "bank" | "health_card"
  | "marksheet" | "degree" | "certificate" | "admit_card"
  | "khasra" | "registry" | "naksha" | "mutation"
  | "medical" | "insurance" | "bill" | "photo" | "other";

export type DocTypeDef = {
  key: DocTypeKey;
  folder: FolderKey;
  en: string;
  hi: string;
  /** lower-cased needles; Devanagari kept as-is */
  keywords: string[];
  /** stronger evidence (e.g. a number pattern) adds +3 */
  pattern?: RegExp;
};

export const DOC_TYPES: DocTypeDef[] = [
  // ── Identity ──
  { key: "aadhaar", folder: "id", en: "Aadhaar Card", hi: "आधार कार्ड", keywords: ["aadhaar", "aadhar", "adhar", "adhaar", "आधार", "uidai", "uid "], pattern: /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/ },
  { key: "pan", folder: "id", en: "PAN Card", hi: "पैन कार्ड", keywords: ["pan card", "pancard", "pan_", "_pan", " pan ", "पैन", "income tax department", "permanent account"], pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/ },
  { key: "voter", folder: "id", en: "Voter ID", hi: "वोटर आईडी", keywords: ["voter", "epic", "मतदाता", "वोटर", "election commission", "निर्वाचन"], pattern: /\b[A-Z]{3}\d{7}\b/ },
  { key: "passport", folder: "id", en: "Passport", hi: "पासपोर्ट", keywords: ["passport", "पासपोर्ट", "republic of india"], pattern: /\b[A-Z]\d{7}\b/ },
  { key: "driving", folder: "id", en: "Driving Licence", hi: "ड्राइविंग लाइसेंस", keywords: ["driving", "licence", "license", "ड्राइविंग", "लाइसेंस", " dl "] },
  { key: "ration", folder: "id", en: "Ration Card", hi: "राशन कार्ड", keywords: ["ration", "राशन"] },
  { key: "birth", folder: "id", en: "Birth Certificate", hi: "जन्म प्रमाण पत्र", keywords: ["birth certificate", "birth cert", "जन्म प्रमाण", "जन्म"] },
  { key: "caste", folder: "id", en: "Caste Certificate", hi: "जाति प्रमाण पत्र", keywords: ["caste", "जाति", "obc", "sc/st"] },
  { key: "income", folder: "id", en: "Income Certificate", hi: "आय प्रमाण पत्र", keywords: ["income certificate", "आय प्रमाण", "income cert"] },
  { key: "domicile", folder: "id", en: "Domicile Certificate", hi: "मूल निवास", keywords: ["domicile", "मूल निवास", "निवास प्रमाण", "residence certificate"] },
  { key: "bank", folder: "id", en: "Bank Passbook", hi: "बैंक पासबुक", keywords: ["passbook", "पासबुक", "bank", "बैंक", "ifsc", "account no", "खाता संख्या", "cheque", "चेक"] },
  { key: "health_card", folder: "id", en: "Health Card", hi: "स्वास्थ्य कार्ड", keywords: ["ayushman", "आयुष्मान", "abha", "health card", "स्वास्थ्य कार्ड", "e-shram", "eshram", "ई श्रम", "ई-श्रम"] },
  // ── Education ──
  { key: "marksheet", folder: "marksheet", en: "Marksheet", hi: "अंकतालिका", keywords: ["marksheet", "mark sheet", "markssheet", "marks statement", "statement of marks", "मार्कशीट", "अंकतालिका", "अंक सूची", "grade card", "total marks", "marks obtained", "percent", "result: pass", "semester", "सेमेस्टर", "10th", "12th", "class 10", "class 12", "high school", "intermediate", "हाईस्कूल", "इंटर"] },
  { key: "degree", folder: "education", en: "Degree", hi: "डिग्री", keywords: ["degree", "डिग्री", "diploma", "डिप्लोमा", "convocation", "दीक्षांत", "b.sc", "bsc", "b.a", "b.com", "bcom", "b.tech", "btech", "m.a", "msc", "mba", "provisional"] },
  { key: "certificate", folder: "education", en: "Certificate", hi: "प्रमाण पत्र", keywords: ["certificate", "प्रमाण पत्र", "प्रमाणपत्र", "transfer certificate", "character certificate", "migration", "स्थानांतरण", "scholarship", "छात्रवृत्ति", "training", "प्रशिक्षण"] },
  { key: "admit_card", folder: "education", en: "Admit Card", hi: "प्रवेश पत्र", keywords: ["admit card", "hall ticket", "प्रवेश पत्र", "exam centre", "examination centre", "reporting time"] },
  // ── Land ──
  { key: "khasra", folder: "land", en: "Khasra / Khatauni", hi: "खसरा / खतौनी", keywords: ["khasra", "khatauni", "khatoni", "khata", "खसरा", "खतौनी", "खातौनी", "खाता", "jamabandi", "जमाबंदी", "bhulekh", "भूलेख", "bhu abhilekh", "भू अभिलेख", "gata", "गाटा", "survey no", "सर्वे", "patwari", "पटवारी", "land record", "भूमि"] },
  { key: "registry", folder: "land", en: "Registry / Sale Deed", hi: "रजिस्ट्री / बैनामा", keywords: ["registry", "रजिस्ट्री", "sale deed", "sale-deed", "सेल डीड", "बैनामा", "बयाना", "agreement", "इकरारनामा", "stamp", "स्टाम्प", "sub registrar", "उप निबंधक"] },
  { key: "naksha", folder: "land", en: "Land Map (Naksha)", hi: "नक्शा", keywords: ["naksha", "नक्शा", "नकसा", "land map", "village map", "plot map", "layout"] },
  { key: "mutation", folder: "land", en: "Mutation (Dakhil-Kharij)", hi: "दाखिल-ख़ारिज", keywords: ["mutation", "dakhil", "दाखिल", "खारिज", "ख़ारिज", "namantaran", "नामांतरण"] },
  // ── Other useful ──
  { key: "medical", folder: "other", en: "Medical Report", hi: "मेडिकल रिपोर्ट", keywords: ["medical", "मेडिकल", "report", "रिपोर्ट", "prescription", "पर्ची", "hospital", "अस्पताल", "doctor", "डॉक्टर", "x-ray", "xray", "blood", "lab"] },
  { key: "insurance", folder: "other", en: "Insurance", hi: "बीमा", keywords: ["insurance", "बीमा", "policy", "पॉलिसी", "lic", "premium", "प्रीमियम"] },
  { key: "bill", folder: "other", en: "Bill / Receipt", hi: "बिल / रसीद", keywords: ["bill", "बिल", "receipt", "रसीद", "invoice", "इनवॉइस", "electricity", "बिजली", "rent", "किराया", "challan", "चालान"] },
  { key: "photo", folder: "other", en: "Photo", hi: "फोटो", keywords: ["passport photo", "passport size", "पासपोर्ट साइज", "photo", "फोटो", "selfie", "img ", "dsc ", "whatsapp image"], pattern: /\b(?:img|dsc|dscn|pv)\d{3,}\b/i },
];

export const DOC_TYPE_MAP: Record<string, DocTypeDef> = Object.fromEntries(DOC_TYPES.map((d) => [d.key, d]));

export function docTypeLabel(key: string | null | undefined, lang: "en" | "hi"): string {
  const def = key ? DOC_TYPE_MAP[key] : undefined;
  if (!def) return lang === "hi" ? "अन्य" : "Other";
  return lang === "hi" ? def.hi : def.en;
}

/** Types grouped by folder — used by the "Browse by type" chips. */
export function docTypesForFolder(folder: FolderKey | "all"): DocTypeDef[] {
  return folder === "all" ? DOC_TYPES : DOC_TYPES.filter((d) => d.folder === folder);
}

function normalize(s: string): string {
  return " " + s.toLowerCase().replace(/[_\-.()+#,]+/g, " ").replace(/\s+/g, " ") + " ";
}

/**
 * Detect the most likely document type from a file name / extracted text.
 * Returns null when nothing convincing matched.
 */
export function detectDocType(rawText: string): { type: DocTypeKey; score: number; folder: FolderKey } | null {
  const hay = normalize(rawText);
  let best: { type: DocTypeKey; score: number; folder: FolderKey } | null = null;
  for (const def of DOC_TYPES) {
    let score = 0;
    for (const kw of def.keywords) {
      const needle = kw.toLowerCase();
      if (hay.includes(needle)) score += needle.length >= 6 ? 3 : needle.length >= 4 ? 2 : 1;
    }
    if (def.pattern && def.pattern.test(rawText)) score += 3;
    if (score > (best?.score ?? 0)) best = { type: def.key, score, folder: def.folder };
  }
  return best && best.score >= 2 ? best : null;
}
