import { NextRequest, NextResponse } from "next/server";
import { and, asc, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";
import { isImage, mergeImagesToPdf, Quality } from "@/lib/convert";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/batch-pdf { ids: [...], quality } → one merged PDF of all selected images. */
export async function POST(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; quality?: Quality };
  const ids = body.ids ?? [];
  if (ids.length === 0) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const rows = await db
    .select({ name: documents.name, mimeType: documents.mimeType, fileData: documents.fileData, createdAt: documents.createdAt })
    .from(documents)
    .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)))
    .orderBy(asc(documents.createdAt));

  const images = rows.filter((r) => isImage(r.mimeType)).map((r) => ({ name: r.name, buffer: r.fileData as Buffer }));
  if (images.length === 0) return NextResponse.json({ error: "no images selected" }, { status: 400 });

  const pdfBuf = await mergeImagesToPdf(images, body.quality ?? "medium");
  await audit("merge", `${images.length} images merged to PDF`, { quality: body.quality ?? "medium" });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(pdfBuf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`merged-${stamp}.pdf`)}`,
    },
  });
}
