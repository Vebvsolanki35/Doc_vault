import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { audit, findFolder, getRoster, isUnlocked, publicDoc } from "@/lib/vault";
import { analyzeDocument } from "@/lib/analyze";
import { DOC_TYPE_MAP } from "@/lib/docTypes";
import { apiError, isUuid } from "@/lib/apiError";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST { apply?: boolean }  → re-read an existing document with OCR/AI.
 *  apply=false (default) → just return what the vault would do
 *  apply=true            → update type, tags, OCR text; move to the detected
 *                          person/folder when it's confident.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const roster = await getRoster();
  const a = await analyzeDocument(doc.fileData as Buffer, doc.mimeType, doc.name, roster);
  const member = a.memberKey ? roster.find((m) => m.key === a.memberKey) ?? null : null;
  const moveMember = member && a.memberConfidence >= 0.6 && member.id !== doc.memberId ? member : null;
  const targetMemberId = moveMember?.id ?? doc.memberId;
  const folder = targetMemberId ? await findFolder(targetMemberId, a.folder) : null;

  const plan = {
    docType: a.docType,
    folder: a.folder,
    memberKey: member?.key ?? null,
    memberConfidence: a.memberConfidence,
    willMoveTo: moveMember ? { member: moveMember.key, folder: folder?.key ?? null } : null,
    tags: a.tags,
    summary: a.summary,
    ocr: { engine: a.engine, confidence: a.ocrConfidence, chars: a.ocrText.length },
    ai: a.ai,
  };
  if (!body.apply) return NextResponse.json({ plan });

  const changeFolder = folder && (moveMember || (doc.docType === "other" && a.docType !== "other"));
  const [updated] = await db
    .update(documents)
    .set({
      docType: a.docType,
      tags: { ...doc.tags, ...a.tags, ...(a.summary ? { summary: a.summary } : {}) },
      ocrText: a.ocrText.slice(0, 20000),
      ...(changeFolder ? { folderId: folder.id, memberId: folder.memberId, category: folder.key === "custom" ? DOC_TYPE_MAP[a.docType]?.folder ?? doc.category : folder.key } : {}),
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id))
    .returning();
  await audit("reanalyze", doc.name, { type: a.docType, member: member?.key ?? null, moved: !!changeFolder, ai: a.ai });
  return NextResponse.json({ plan, document: publicDoc(updated) });
  } catch (e) {
    return apiError(e);
  }
}
