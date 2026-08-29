/**
 * ─────────────────────────────────────────────────────────────────────────
 *  SMART SCANNER v2  (zero-click auto-organisation)
 *  • Detects the FOLDER: education | id | marksheet | land | other
 *  • Detects the MEMBER by name / alias matching against the family roster
 *  • Extracts smart tags: card numbers, expiry, percentage, year,
 *    khasra/survey no., area, owner.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { DocumentTags, Member } from "@/db/schema";
import { devToLatin } from "./transliterate";

export type FolderKey = "education" | "id" | "marksheet" | "land" | "other" | "custom";
export const FOLDER_KEYS: FolderKey[] = ["education", "id", "marksheet", "land", "other"];

const RULES: { folder: FolderKey; keywords: string[] }[] = [
  {
    folder: "land",
    keywords: [
      "khasra","khatauni","khatoni","खसरा","खतौनी","खातौनी","खाता","jamabandi","जमाबंदी",
      "plot","प्लॉट","registry","रजिस्ट्री","mutation","दाखिल खारिज","दाखिल","खारिज",
      "bigha","बीघा","biswa","बिस्वा","kanal","कनाल","marla","मरला","hectare","हेक्टेयर",
      "acre","एकड़","sale deed","सेल डीड","बैनामा","बयाना","naksha","नक्शा","नकसा",
      "land","ज़मीन","जमीन","भूमि","फसल","gata","गाटा","survey no","सर्वे","khet","खेत",
      "tehsil","तहसील","patwari","पटवारी","bhu abhilekh","भू अभिलेख","farmer","किसान",
    ],
  },
  {
    folder: "id",
    keywords: [
      "aadhaar","aadhar","adhar","आधार"," uidai","pan card","pancard"," pan ","पैन","passport","पासपोर्ट",
      "voter","मतदाता","वोटर","ration","राशन","driving","ड्राइविंग","licence","license","लाइसेंस",
      "birth certificate","जन्म","मूल निवास","domicile","caste","जाति","आय प्रमाण","income certificate",
      "passbook","पासबुक","kyc","ई श्रम","eshram","abha","आयुष्मान","id card","आईडी",
    ],
  },
  {
    folder: "marksheet",
    keywords: [
      "marksheet","mark sheet","मार्कशीट","अंकतालिका","semester","सेमेस्टर","transcript","ट्रांसक्रिप्ट",
      "10th","12th","high school","हाईस्कूल","intermediate","इंटर","roll no","रोल नं","result","परिणाम",
      "grade card","ग्रेड","up board","cbse","icse","division","अंक सूची","प्रतिशत",
    ],
  },
  {
    folder: "education",
    keywords: [
      "degree","डिग्री","diploma","डिप्लोमा","प्रमाण पत्र","certificate","प्रमाणपत्र","convocation","दीक्षांत",
      "college","कॉलेज","school","स्कूल","university","विश्वविद्यालय","विद्यालय","board","बोर्ड",
      "admit card","प्रवेश पत्र","scholarship","छात्रवृत्ति","exam","परीक्षा","migration","स्थानांतरण",
      "transfer certificate","character certificate","शैक्षणिक","शिक्षा",
    ],
  },
];

export type ClassifyResult = {
  folder: FolderKey;
  confidence: number;
  tags: DocumentTags;
  matched: string[];
};

function normalize(s: string): string {
  return " " + s.toLowerCase().replace(/[_\-.()+#]+/g, " ").replace(/\s+/g, " ") + " ";
}

export function classify(rawText: string): ClassifyResult {
  const hay = normalize(rawText);
  const scores: Partial<Record<FolderKey, number>> = {};
  const matched: string[] = [];
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (hay.includes(kw.toLowerCase())) {
        scores[rule.folder] = (scores[rule.folder] ?? 0) + (kw.length >= 5 ? 2 : 1);
        matched.push(kw);
      }
    }
  }
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]) as [FolderKey, number][];
  const folder: FolderKey = entries.length && entries[0][1] > 0 ? entries[0][0] : "other";
  const confidence = Math.min(1, (entries[0]?.[1] ?? 0) / 4);
  const tags = extractMetadata(rawText, folder);
  tags.confidence = confidence;
  return { folder, confidence, tags, matched };
}

// ── Member detection ──────────────────────────────────────────────────
export type MemberGuess = { member: Member; score: number } | null;

/**
 * Scores every member alias (and latinised Devanagari aliases) against the
 * document text. Returns the leader only when it clears a small margin,
 * otherwise null → the UI asks "क्या यह पापा का है?"
 */
export function detectMember(rawText: string, roster: Member[]): MemberGuess {
  const hay = normalize(rawText);
  const hayLatin = " " + devToLatin(rawText).toLowerCase() + " ";
  let best: MemberGuess = null;
  let bestScore = 0;
  for (const m of roster) {
    let score = 0;
    for (const alias of [m.nameEn, m.nameHi, ...m.aliases]) {
      if (!alias || alias.length < 2) continue;
      const a = alias.toLowerCase();
      const parts = a.split(/\s+/).filter((p) => p.length > 1);
      let hits = 0;
      for (const part of parts) {
        if (hay.includes(` ${part} `) || hay.includes(part)) hits++;
        else if (hayLatin.includes(devToLatin(part).replace(/a$/, ""))) hits++;
      }
      if (parts.length > 0 && hits === parts.length) score += parts.length * 2 + (a.length > 5 ? 1 : 0);
      else if (hits > 0) score += hits;
    }
    if (score > bestScore) {
      bestScore = score;
      best = { member: m, score };
    }
  }
  return bestScore >= 3 ? best : null;
}

// ── Smart tag extraction ──────────────────────────────────────────────
export function extractMetadata(text: string, folder: FolderKey): DocumentTags {
  const tags: DocumentTags = {};
  const t = text.replace(/\s+/g, " ");

  // ── LAND: khasra / area / owner ──
  if (folder === "land" || folder === "other") {
    const survey = t.match(
      /(?:khasra|खसरा|survey|सर्वे|gata|गाटा|plot|प्लॉट|खाता|khata)\s*(?:no|number|नंबर|संख्या|न\.)?\s*[:#.\-]?\s*(\d[\d\/\-]{0,14})/i,
    );
    if (survey) tags.surveyNo = survey[1];
    const area = t.match(
      /(\d+(?:[.,]\d+)?)\s*(bigha|बीघा|biswa|बिस्वा|kanal|कनाल|marla|मरला|hectare|हेक्टेयर|acre|एकड़|sq\.?\s?ft|वर्ग\s?फुट|वर्गफुट)/i,
    );
    if (area) {
      tags.area = area[1].replace(",", ".");
      tags.areaUnit = area[2].toLowerCase();
    }
    const owner = t.match(
      /(?:owner|मालिक|नाम|name|खातेदार|cultivator)\s*[:：\-]\s*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .]{2,45})/i,
    );
    if (owner) {
      tags.owner = owner[1]
        .split(/\s+(?:area|khasra|village|tehsil|year|plot|khet|roll|result|क्षेत्र|गांव|ग्राम|तहसील|वर्ष|खसरा|बीघा|प्लॉट)\b/i)[0]
        .trim();
    }
  }

  // ── ID CARDS: type / number / expiry ──
  if (folder === "id" || folder === "other") {
    const aadhaar = t.replace(/\s/g, "").match(/\b[2-9]\d{11}\b/);
    if (aadhaar) {
      tags.cardType = "Aadhaar";
      tags.cardNo = `XXXX-XXXX-${aadhaar[0].slice(-4)}`;
    }
    const pan = t.match(/\b([A-Z]{5}\d{4}[A-Z])\b/);
    if (pan) {
      tags.cardType = tags.cardType ?? "PAN";
      tags.cardNo = pan[1].slice(0, 3) + "XX" + pan[1].slice(5);
    }
    const voter = t.match(/\b([A-Z]{3}\d{7})\b/);
    if (voter && !tags.cardNo) {
      tags.cardType = "Voter ID";
      tags.cardNo = voter[1].slice(0, 2) + "XXXX" + voter[1].slice(6);
    }
    const expiry = t.match(/(?:valid\s*till|expiry|expires|वैधता|समाप्ति)\s*[:：\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i);
    if (expiry) tags.expiry = expiry[1];
  }

  // ── MARKSHEET: percentage / year / person ──
  if (folder === "marksheet" || folder === "education" || folder === "other") {
    const pct = t.match(/(\d{1,2}(?:\.\d{1,2})?)\s*(?:%|percent|प्रतिशत)/i);
    if (pct && parseFloat(pct[1]) <= 100) tags.percentage = pct[1] + "%";
    const year = t.match(/\b((?:19|20)\d{2})\b/);
    if (year) tags.year = year[1];
  }

  // ── PERSON heuristic near identity keywords ──
  if (folder === "id" || folder === "land" || folder === "marksheet") {
    const kwMatch = t
      .toLowerCase()
      .match(/(?:aadhaar|aadhar|आधार|pan|पैन|passport|पासपोर्ट|voter|मतदाता|marksheet|मार्कशीट)[\s_\-–:]*(?:of|का|के)?[\s_\-–:]*/);
    if (kwMatch) {
      const rest = t.slice((kwMatch.index ?? 0) + kwMatch[0].length);
      const nameRun = rest.match(/([A-Z][a-z]+(?:[\s_]+[A-Z][a-z]+){0,2})/);
      if (nameRun && !/^(card|no|the|of|jpg|jpeg|png|pdf)$/i.test(nameRun[1])) {
        tags.person = nameRun[1].replace(/_/g, " ").trim();
      }
    }
  }
  return tags;
}

/** Extract the real text layer of a PDF so classification works on content, not just names. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const { extractText } = await import("unpdf");
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
    return (text || "").slice(0, 20000);
  } catch {
    return "";
  }
}
