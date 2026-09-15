/**
 * ─────────────────────────────────────────────────────────────────────────
 *  AI SORTER  (optional cloud/local LLM on top of OCR)
 *  Given the OCR text, a language model decides: document type, which
 *  family member it belongs to, a clean human title, and key facts.
 *  Works with ANY OpenAI-compatible chat endpoint:
 *    AI_BASE_URL=https://api.openai.com/v1      AI_API_KEY=sk-…   AI_MODEL=gpt-4o-mini
 *    AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai  (Gemini)
 *    AI_BASE_URL=http://localhost:11434/v1      AI_MODEL=llama3.2  (Ollama, fully offline)
 *  If nothing is configured, or the call fails, the rule-based sorter
 *  (classifier + docTypes) handles everything — nothing ever blocks an upload.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { DOC_TYPES, DOC_TYPE_MAP, type DocTypeKey } from "./docTypes";
import type { DocumentTags, Member } from "@/db/schema";

export type AiVerdict = {
  docType: DocTypeKey | null;
  memberKey: string | null;
  title: string | null;
  tags: DocumentTags;
  summary: string | null;
  confidence: number; // 0..1
  model: string;
};

export function aiConfigured(): boolean {
  return !!(process.env.AI_BASE_URL && process.env.AI_MODEL);
}

const SYSTEM = `You are the filing clerk of an Indian family's document vault (Hindi + English).
You receive OCR text of one document (may be noisy) plus the family roster.
Reply with ONLY compact JSON, no prose, matching exactly:
{"docType":<one of TYPES or null>,"memberKey":<roster key or null>,"title":<short human title in English, e.g. "Papa - Aadhaar Card" or null>,
 "tags":{"cardType"?,"cardNo"?(mask all but last 4),"expiry"?,"owner"?,"surveyNo"?,"area"?,"areaUnit"?,"percentage"?,"year"?,"person"?},
 "summary":<one sentence, max 20 words, or null>,"confidence":<0..1>}
Rules: choose memberKey only when a roster name/alias clearly appears; never invent numbers; prefer null over guessing.`;

export async function aiClassify(ocrText: string, fileName: string, roster: Member[]): Promise<AiVerdict | null> {
  if (!aiConfigured()) return null;
  const base = process.env.AI_BASE_URL!.replace(/\/$/, "");
  const model = process.env.AI_MODEL!;
  const key = process.env.AI_API_KEY ?? "";
  const types = DOC_TYPES.map((d) => `${d.key} (${d.en} / ${d.hi})`).join(", ");
  const people = roster.map((m) => `${m.key}: ${m.nameEn} / ${m.nameHi}${m.aliases.length ? " aka " + m.aliases.join(", ") : ""}`).join("\n");
  const user = `TYPES: ${types}\n\nROSTER:\n${people}\n\nFILE NAME: ${fileName}\n\nOCR TEXT:\n${ocrText.slice(0, 6000)}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.AI_TIMEOUT_MS || 20000));
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(raw.replace(/^```(?:json)?/m, "").replace(/```$/m, "").trim()) as Partial<AiVerdict>;
    const docType = parsed.docType && DOC_TYPE_MAP[parsed.docType] ? (parsed.docType as DocTypeKey) : null;
    const memberKey = parsed.memberKey && roster.some((m) => m.key === parsed.memberKey) ? parsed.memberKey : null;
    const tags: DocumentTags = {};
    const t = (parsed.tags ?? {}) as Record<string, unknown>;
    for (const k of ["cardType", "cardNo", "expiry", "owner", "surveyNo", "area", "areaUnit", "percentage", "year", "person"] as const) {
      const v = t[k];
      if (typeof v === "string" && v.trim()) tags[k] = v.trim().slice(0, 80);
    }
    return {
      docType,
      memberKey,
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim().slice(0, 120) : null,
      tags,
      summary: typeof parsed.summary === "string" ? parsed.summary.trim().slice(0, 200) : null,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0.6))),
      model,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
