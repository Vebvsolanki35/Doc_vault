/**
 * ─────────────────────────────────────────────────────────────────────────
 *  VOICE / TEXT QUERY UNDERSTANDING v2
 *  Parses English or Hindi queries into: family MEMBER, FOLDER,
 *  time range, and free-text terms (names, khasra numbers…).
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { DictKey } from "./i18n";
import type { FolderKey } from "./classifier";

export type ParsedIntent = {
  folder: FolderKey | null;
  memberKey: "papa" | "mummy" | "me" | null;
  memberBoost: "me" | null; // soft hint from possessive "मेरा/my"
  from: Date | null;
  to: Date | null;
  timeLabelKey: DictKey | null;
  terms: string[];
};

const FOLDER_WORDS: Record<string, FolderKey> = {
  // land
  land: "land", "भूमि": "land", "जमीन": "land", "ज़मीन": "land", khasra: "land", "खसरा": "land",
  khatauni: "land", "खतौनी": "land", khatoni: "land", plot: "land", "प्लॉट": "land", registry: "land", "रजिस्ट्री": "land",
  mutation: "land", "दाखिल": "land", jamabandi: "land", "जमाबंदी": "land", naksha: "land", "नक्शा": "land",
  bigha: "land", "बीघा": "land",
  // id
  aadhaar: "id", aadhar: "id", adhar: "id", "आधार": "id",
  pan: "id", "पैन": "id", passport: "id", "पासपोर्ट": "id",
  voter: "id", "मतदाता": "id", ration: "id", "राशन": "id",
  licence: "id", license: "id", "लाइसेंस": "id", "पहचान": "id", id: "id",
  // marksheet
  marksheet: "marksheet", mark: "marksheet", "मार्कशीट": "marksheet", "अंकतालिका": "marksheet",
  semester: "marksheet", "सेमेस्टर": "marksheet", result: "marksheet", "परिणाम": "marksheet",
  "10th": "marksheet", "12th": "marksheet", transcript: "marksheet",
  // education
  degree: "education", "डिग्री": "education", diploma: "education", "डिप्लोमा": "education",
  certificate: "education", "प्रमाण": "education", college: "education", "कॉलेज": "education",
  school: "education", "स्कूल": "education", "शिक्षा": "education", scholarship: "education", "छात्रवृत्ति": "education",
};

const MEMBER_WORDS: Record<string, "papa" | "mummy" | "me"> = {
  papa: "papa", "पापा": "papa", pitaji: "papa", "पिताजी": "papa", "पिता": "papa",
  father: "papa", "बाबूजी": "papa", babuji: "papa", bauji: "papa", dad: "papa", "बाबा": "papa",
  mummy: "mummy", "मम्मी": "mummy", mataji: "mummy", "माताजी": "mummy", "माता": "mummy",
  mother: "mummy", mom: "mummy", ammi: "mummy", "अम्मी": "mummy", ma: "mummy", "माँ": "mummy",
  self: "me", myself: "me", mine: "me",
};

const STOPWORDS = new Set([
  "show","me","find","get","the","a","of","please","i","want","see","open","give","all","document","documents","doc","docs","file","files","record","records","card","that","was","uploaded","s","'s","tell","my","mine",
  "मुझे","दिखाओ","दिखाइए","दिखा","बताओ","बताइए","दो","दीजिए","चाहिए","का","की","के","को","से","है","और","वाला","वाली","कृपया","खोजो","निकालो","लाओ","जो","डाला","था","अपलोड","किया","गया","दस्तावेज़","कागज","कागज़","कार्ड","पहचान","रिकॉर्ड","फाइल","फ़ाइल","पत्र","मेरा","मेरी","मेरे",
  "last","this","from","in","ago",
  "पिछले","पिछला","इस",
]);

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
  "जनवरी": 0, "फ़रवरी": 1, "फरवरी": 1, "मार्च": 2, "अप्रैल": 3, "मई": 4, "जून": 5,
  "जुलाई": 6, "अगस्त": 7, "सितंबर": 8, "अक्टूबर": 9, "नवंबर": 10, "दिसंबर": 11,
};

export function parseIntent(raw: string, now = new Date()): ParsedIntent {
  const text = raw.trim();
  const low = text.toLowerCase().replace(/['’]s\b/g, ""); // "Papa's" → "papa"
  const tokens = low.split(/[\s,।.?!;:'"()]+/).filter(Boolean);

  let folder: FolderKey | null = null;
  let memberKey: ParsedIntent["memberKey"] = null;
  let memberBoost: ParsedIntent["memberBoost"] = null;
  let from: Date | null = null;
  let to: Date | null = null;
  let timeLabelKey: DictKey | null = null;

  const usedTokens = new Set<string>();
  for (const tok of tokens) {
    if (FOLDER_WORDS[tok]) { folder = FOLDER_WORDS[tok]; usedTokens.add(tok); }
    if (MEMBER_WORDS[tok]) { memberKey = MEMBER_WORDS[tok]; usedTokens.add(tok); }
  }
  if (low.includes("mark sheet") || low.includes("मार्क शीट")) folder = "marksheet";
  if (low.includes("land record") || low.includes("भूमि रिकॉर्ड")) folder = "land";
  if (low.includes("id card") || low.includes("पहचान पत्र")) folder = "id";
  // possessive without explicit member → probably "mine"
  if (!memberKey && /\b(my|mine|मेरा|मेरी|मेरे)\b/.test(low)) memberBoost = "me";

  // ── Time expressions ───────────────────────────────────────────────
  const day = 24 * 3600 * 1000;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (/\b(today|आज)\b/.test(low)) {
    from = startOfDay(now); to = now; timeLabelKey = "time_today";
  } else if (/\b(yesterday|कल)\b/.test(low)) {
    const y = new Date(now.getTime() - day);
    from = startOfDay(y); to = startOfDay(now); timeLabelKey = "time_yesterday";
  } else if (/(last\s*week|पिछले?\s*हफ़्ते|पिछले?\s*हफ्ते|पिछला\s*हफ़्ता)/.test(low)) {
    from = new Date(now.getTime() - 7 * day); to = now; timeLabelKey = "time_last_week";
  } else if (/(last\s*month|पिछले?\s*महीने|पिछले?\s*महिने|पिछला\s*महीना)/.test(low)) {
    from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()); to = now; timeLabelKey = "time_last_month";
  } else if (/(last\s*year|पिछले?\s*साल)/.test(low)) {
    from = new Date(now.getFullYear() - 1, 0, 1); to = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59); timeLabelKey = "time_this_year";
  } else if (/(this\s*year|इस\s*साल)/.test(low)) {
    from = new Date(now.getFullYear(), 0, 1); to = now; timeLabelKey = "time_this_year";
  } else {
    const m = low.match(/(\d+)\s*days?\s*ago|(\d+)\s*दिन\s*पहले/);
    if (m) {
      const n = parseInt(m[1] || m[2], 10);
      from = new Date(now.getTime() - n * day); to = now;
    } else {
      for (const [name, idx] of Object.entries(MONTHS)) {
        if (low.includes(name)) {
          const year = now.getMonth() >= idx ? now.getFullYear() : now.getFullYear() - 1;
          from = new Date(year, idx, 1);
          to = new Date(year, idx + 1, 0, 23, 59, 59);
          break;
        }
      }
    }
  }
  const yearM = low.match(/\b(19|20)\d{2}\b/);
  if (yearM && !from) {
    const y = parseInt(yearM[0], 10);
    from = new Date(y, 0, 1); to = new Date(y, 11, 31, 23, 59, 59); timeLabelKey = "time_this_year";
  }

  const TIME_WORDS = new Set(["today","yesterday","week","month","year","days","ago","last","this","आज","कल","हफ़्ता","हफ्ते","हफ्ता","महीना","महीने","महिना","महिने","साल","दिन","पहले","पिछला","पिछले","पिछली","इस","मेरा","मेरी","मेरे","my","mine"]);
  const terms: string[] = [];
  for (const tok of tokens) {
    if (tok.length < 2) continue;
    if (usedTokens.has(tok) || STOPWORDS.has(tok) || TIME_WORDS.has(tok)) continue;
    if (MONTHS[tok] !== undefined) continue;
    if (/^\d{4}$/.test(tok) && parseInt(tok) > 1900 && parseInt(tok) < 2100) continue;
    terms.push(tok);
  }
  // Capitalised Latin name runs (e.g. "Ram Kumar"), cleaned word-by-word so
  // sentence-initial verbs ("Show Papa…") never poison the term list.
  const nameRuns = text.match(/[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*/g);
  if (nameRuns)
    for (const run of nameRuns) {
      const kept = run
        .split(/\s+/)
        .filter((w) => {
          const l = w.toLowerCase();
          return !MEMBER_WORDS[l] && !STOPWORDS.has(l) && !FOLDER_WORDS[l] && !TIME_WORDS.has(l);
        })
        .join(" ");
      if (kept.length >= 3 && !terms.includes(kept.toLowerCase())) terms.push(kept);
    }

  return { folder, memberKey, memberBoost, from, to, timeLabelKey, terms: terms.slice(0, 6) };
}
