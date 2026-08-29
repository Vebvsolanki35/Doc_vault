import type { FolderKey } from "./classifier";

/** The five default folders every member gets, in display order. */
export const DEFAULT_FOLDERS: { key: FolderKey }[] = [
  { key: "education" },
  { key: "id" },
  { key: "marksheet" },
  { key: "land" },
  { key: "other" },
];

/** Bilingual fallback labels for default folder keys. */
export const DEFAULT_FOLDER_NAMES: Record<string, { en: string; hi: string }> = {
  education: { en: "Education", hi: "शिक्षा" },
  id: { en: "ID Cards", hi: "पहचान पत्र" },
  marksheet: { en: "Marksheets", hi: "अंकतालिका" },
  land: { en: "Land Records", hi: "भूमि दस्तावेज़" },
  other: { en: "Other", hi: "अन्य" },
};
