/**
 * ANALYSE = read + decide.  One call that the upload API and the
 * pre-upload /api/analyze endpoint both use, so the form pre-fill and the
 * final filing always agree.
 *
 *   OCR (tesseract / pdf text)  →  rule sorter (classifier + docTypes)
 *                                →  optional LLM (ai.ts) refines type / person / title
 */
import { createHash } from "crypto";
import type { DocumentTags, Member } from "@/db/schema";
import { classify, detectMember, type FolderKey } from "./classifier";
import { detectDocType, DOC_TYPE_MAP } from "./docTypes";
import { ocrAny } from "./ocr";
import { aiClassify } from "./ai";

export type Analysis = {
  ocrText: string;
  engine: "tesseract" | "pdf-text" | "none";
  ocrConfidence: number;
  folder: FolderKey;
  docType: string;
  confidence: number;
  memberKey: string | null;
  memberConfidence: number;
  suggestedTitle: string | null;
  tags: DocumentTags;
  summary: string | null;
  ai: string | null; // model name when AI weighed in
  ms: number;
};

export async function analyzeDocument(buffer: Buffer, mime: string, fileName: string, roster: Member[]): Promise<Analysis> {
  const t0 = Date.now();
  const ocr = await ocrAny(buffer, mime);
  const source = `${fileName}\n${ocr.text}`;

  // ── Rules ──
  const cls = classify(source);
  let folder: FolderKey = cls.folder;
  const tags: DocumentTags = { ...cls.tags };
  const typeGuess = detectDocType(source);
  let docType: string = typeGuess?.type ?? "other";
  const ruleTypeStrong = !!typeGuess && typeGuess.score >= 6; // several distinct keywords / a number pattern
  if (docType === "other" && tags.cardType) {
    docType = ({ Aadhaar: "aadhaar", PAN: "pan", "Voter ID": "voter" } as Record<string, string>)[tags.cardType] ?? "other";
  }
  const mg = detectMember(source, roster);
  let memberKey = mg?.member.key ?? null;
  let memberConfidence = mg ? Math.min(1, mg.score / 6) : 0;
  let confidence = Math.max(cls.confidence, typeGuess ? Math.min(1, typeGuess.score / 6) : 0);
  let suggestedTitle: string | null = null;
  let summary: string | null = null;
  let ai: string | null = null;

  // ── AI refinement (optional) ──
  if (ocr.text.trim().length > 20) {
    const v = await aiClassify(ocr.text, fileName, roster);
    if (v) {
      ai = v.model;
      // Rules that matched hard evidence (numbers, several keywords) beat the model;
      // the model fills gaps and breaks ties.
      if (v.docType && (docType === "other" || (!ruleTypeStrong && v.confidence >= 0.7))) docType = v.docType;
      if (v.memberKey && (!memberKey || (memberConfidence < 0.6 && v.confidence >= 0.7))) { memberKey = v.memberKey; memberConfidence = Math.max(memberConfidence, v.confidence); }
      // Only accept model tags that belong to the final type's family
      const family = DOC_TYPE_MAP[docType]?.folder;
      const allowed: Record<string, string[]> = { id: ["cardType", "cardNo", "expiry", "person"], land: ["owner", "surveyNo", "area", "areaUnit", "person"], marksheet: ["percentage", "year", "person"], education: ["year", "person"], other: ["person", "year"] };
      for (const [k, val] of Object.entries(v.tags)) if (val && (allowed[family ?? "other"] ?? []).includes(k) && !(tags as Record<string, unknown>)[k]) (tags as Record<string, unknown>)[k] = val;
      suggestedTitle = v.title;
      summary = v.summary;
      confidence = Math.max(confidence, v.confidence);
    }
  }
  if (docType !== "other") folder = DOC_TYPE_MAP[docType].folder;
  tags.confidence = confidence;

  return {
    ocrText: ocr.text.slice(0, 20000), engine: ocr.engine, ocrConfidence: ocr.confidence,
    folder, docType, confidence, memberKey, memberConfidence, suggestedTitle, tags, summary, ai, ms: Date.now() - t0,
  };
}

// ── Short-lived cache so /api/analyze → /api/upload doesn't OCR twice ──
const cache = new Map<string, { a: Analysis; at: number }>();
export function analysisKey(buffer: Buffer): string {
  return createHash("sha1").update(buffer).digest("hex");
}
export function rememberAnalysis(id: string, a: Analysis) {
  cache.set(id, { a, at: Date.now() });
  for (const [k, v] of cache) if (Date.now() - v.at > 15 * 60 * 1000 || cache.size > 200) cache.delete(k);
}
export function takeAnalysis(id: string): Analysis | null {
  const hit = cache.get(id);
  return hit ? hit.a : null;
}
