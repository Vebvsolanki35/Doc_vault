import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, or, and, isNull, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { isUnlocked, publicDoc, purgeExpiredBin } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/documents?memberId=&folderId=&category=&bin=1&q=&limit= — list without binary payloads. */
export async function GET(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  await purgeExpiredBin(); // lazy 30-day retention sweep

  const sp = req.nextUrl.searchParams;
  const memberId = sp.get("memberId");
  const folderId = sp.get("folderId");
  const category = sp.get("category");
  const bin = sp.get("bin") === "1";
  const q = sp.get("q")?.trim();
  const limit = Math.min(parseInt(sp.get("limit") ?? "200", 10) || 200, 600);

  const conds = [bin ? isNotNull(documents.deletedAt) : isNull(documents.deletedAt)];
  if (memberId) conds.push(eq(documents.memberId, memberId));
  if (folderId) conds.push(eq(documents.folderId, folderId));
  if (category && category !== "all") conds.push(eq(documents.category, category));
  if (q) conds.push(or(ilike(documents.name, `%${q}%`), ilike(documents.ocrText, `%${q}%`))!);

  const rows = await db
    .select({
      id: documents.id, name: documents.name, mimeType: documents.mimeType, size: documents.size,
      category: documents.category, tags: documents.tags, createdAt: documents.createdAt,
      shareToken: documents.shareToken, sharePasscode: documents.sharePasscode,
      memberId: documents.memberId, folderId: documents.folderId, deletedAt: documents.deletedAt,
      shareExpiresAt: documents.shareExpiresAt,
    })
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.createdAt))
    .limit(limit);

  return NextResponse.json({ documents: rows.map(publicDoc) });
}
