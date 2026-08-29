import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { audit, findFolder, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE a custom folder — its documents safely fall back to "Other". */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  const folder = rows[0];
  if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (folder.isDefault) return NextResponse.json({ error: "cannot_delete_default" }, { status: 400 });

  const fallback = await findFolder(folder.memberId, "other");
  if (fallback) {
    await db
      .update(documents)
      .set({ folderId: fallback.id, category: fallback.key === "custom" ? "other" : fallback.key, updatedAt: new Date() })
      .where(eq(documents.folderId, id));
  }
  await db.delete(folders).where(eq(folders.id, id));
  await audit("folder_delete", folder.nameEn ?? folder.key);
  return NextResponse.json({ ok: true });
}
