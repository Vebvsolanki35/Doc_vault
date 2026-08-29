import { NextRequest, NextResponse } from "next/server";
import { eq, isNotNull, and } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE → soft-delete into the Recycle Bin (30-day retention). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
  await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, id));
  await audit("delete", rows[0].name);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH { folderId }      → move to another folder (member follows the folder)
 * PATCH { action:"restore" } → bring back from the Recycle Bin
 * PATCH { action:"purge" }   → delete forever
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { folderId?: string; category?: string; action?: string };

  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (body.action === "restore") {
    await db.update(documents).set({ deletedAt: null, updatedAt: new Date() }).where(eq(documents.id, id));
    await audit("restore", doc.name);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "purge") {
    await db.delete(documents).where(eq(documents.id, id));
    await audit("purge", doc.name, { manual: true });
    return NextResponse.json({ ok: true });
  }
  if (body.folderId) {
    const f = await db.select().from(folders).where(eq(folders.id, body.folderId)).limit(1);
    if (!f[0]) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    await db
      .update(documents)
      .set({
        folderId: f[0].id,
        memberId: f[0].memberId,
        category: f[0].key === "custom" ? doc.category && doc.category !== "other" ? doc.category : "other" : f[0].key,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id));
    await audit("move", doc.name, { to: f[0].nameEn ?? f[0].key });
    return NextResponse.json({ ok: true });
  }
  if (body.category) {
    await db.update(documents).set({ category: body.category, updatedAt: new Date() }).where(and(eq(documents.id, id), isNotNull(documents.id)));
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "nothing to do" }, { status: 400 });
}
