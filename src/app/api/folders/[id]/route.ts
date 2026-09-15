import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { audit, findFolder, isUnlocked } from "@/lib/vault";
import { apiError, isUuid } from "@/lib/apiError";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { name, nameHi? } → rename any folder (default folders get a custom label too). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { name?: string; nameHi?: string };
  const name = (body.name ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  const folder = rows[0];
  if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [updated] = await db
    .update(folders)
    .set({ nameEn: name, nameHi: body.nameHi?.trim().slice(0, 60) || null })
    .where(eq(folders.id, id))
    .returning();
  await audit("folder_rename", folder.nameEn ?? folder.key, { to: name });
  return NextResponse.json({ folder: updated });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * DELETE a folder. Custom folders are removed; default folders can't be
 * deleted (they're the safety net) — but they can be renamed.
 * Documents inside safely fall back to the member's "Other" folder.
 */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
    const folder = rows[0];
    if (!folder) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (folder.isDefault && folder.key === "other") return NextResponse.json({ error: "cannot_delete_default" }, { status: 400 });

  const fallback = await findFolder(folder.memberId, "other");
  const others = await db.select().from(folders).where(and(eq(folders.memberId, folder.memberId), ne(folders.id, id))).limit(1);
  const target = fallback && fallback.id !== id ? fallback : others[0];
  if (target) {
    await db
      .update(documents)
      .set({ folderId: target.id, category: target.key === "custom" ? "other" : target.key, updatedAt: new Date() })
      .where(eq(documents.folderId, id));
  }
  await db.delete(folders).where(eq(folders.id, id));
  await audit("folder_delete", folder.nameEn ?? folder.key);
  return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
