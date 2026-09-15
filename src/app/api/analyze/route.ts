import { NextRequest, NextResponse } from "next/server";
import { getRoster, isUnlocked } from "@/lib/vault";
import { analyzeDocument, analysisKey, rememberAnalysis } from "@/lib/analyze";
import { docTypeLabel } from "@/lib/docTypes";
import { suggestName } from "@/lib/naming";
import { apiError } from "@/lib/apiError";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST multipart { file } → reads the document (OCR / AI) WITHOUT saving it,
 * so the upload form can pre-fill name, person, folder and type.
 * Returns an analysisId the upload can reuse (no second OCR pass).
 */
export async function POST(req: NextRequest) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return NextResponse.json({ error: "file required" }, { status: 400 });
    const name = String(form.get("name") || (file instanceof File ? file.name : "document"));
    const mime = String(form.get("mime") || file.type || "application/octet-stream");
    const buffer = Buffer.from(await file.arrayBuffer());

    const roster = await getRoster();
    const a = await analyzeDocument(buffer, mime, name, roster);
    const id = analysisKey(buffer);
    rememberAnalysis(id, a);
    const member = roster.find((m) => m.key === a.memberKey) ?? null;
    return NextResponse.json({
      analysisId: id,
      docType: a.docType,
      folder: a.folder,
      memberId: member?.id ?? null,
      memberKey: a.memberKey,
      memberConfidence: a.memberConfidence,
      confidence: a.confidence,
      suggestedName: a.suggestedTitle
        ? `${a.suggestedTitle}${name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ""}`
        : suggestName(member?.nameEn ?? null, a.docType !== "other" ? docTypeLabel(a.docType, "en") : null, name),
      tags: a.tags,
      summary: a.summary,
      ocr: { engine: a.engine, confidence: a.ocrConfidence, chars: a.ocrText.length, preview: a.ocrText.slice(0, 240), reason: a.ocrReason },
      ai: a.ai,
      ms: a.ms,
    });
  } catch (e) {
    return apiError(e);
  }
}
