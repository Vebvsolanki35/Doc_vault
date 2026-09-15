import { NextRequest, NextResponse } from "next/server";
import { eq, isNotNull, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { audit, isUnlocked, publicDoc } from "@/lib/vault";
import { sanitizeName } from "@/lib/naming";
import { DOC_TYPE_MAP } from "@/lib/docTypes";
import { apiError, isUuid } from "@/lib/apiError";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE → soft-delete into the Recycle Bin (30-day retention). */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });
    await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, id));
    await audit("delete", rows[0].name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}

/**
 * PATCH { folderId }      → move to another folder (member follows the folder)
 * PATCH { action:"restore" } → bring back from the Recycle Bin
 * PATCH { action:"purge" }   → delete forever
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
    const { id } = await ctx.params;
    if (!isUuid(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
    const body = (await req.json().catch(() => ({}))) as { folderId?: string; category?: string; action?: string; name?: string; docType?: string };

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
    // ── Rename / re-type (can be combined with a move) ──
    const patch: Partial<typeof documents.$inferInsert> = {};
    if (typeof body.name === "string") {
      const name = sanitizeName(body.name, doc.name, doc.mimeType);
      if (!name || name === ".") return NextResponse.json({ error: "bad name" }, { status: 400 });
      if (name !== doc.name) patch.name = name;
    }
    if (typeof body.docType === "string") {
      if (body.docType !== "other" && !DOC_TYPE_MAP[body.docType]) return NextResponse.json({ error: "bad type" }, { status: 400 });
      patch.docType = body.docType;
    }
    if (Object.keys(patch).length > 0) {
      await db.update(documents).set({ ...patch, updatedAt: new Date() }).where(eq(documents.id, id));
      if (patch.name) await audit("rename", doc.name, { to: patch.name });
      if (patch.docType) await audit("retype", patch.name ?? doc.name, { type: patch.docType });
      if (!body.folderId && !body.category) return NextResponse.json({ ok: true });
    }

    if (body.folderId) {
      if (!isUuid(body.folderId)) return NextResponse.json({ error: "folder not found" }, { status: 404 });
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
  } catch (e) {
    return apiError(e);
  }
}
