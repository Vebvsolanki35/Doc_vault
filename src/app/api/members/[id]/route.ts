import { NextRequest, NextResponse } from "next/server";
import { eq, isNull, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, members } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH { nameEn?, nameHi?, aliases?, color?, icon? } → rename / restyle a family member. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { nameEn?: string; nameHi?: string; aliases?: string[]; color?: string; icon?: string };
  const rows = await db.select().from(members).where(eq(members.id, id)).limit(1);
  if (!rows[0]) return NextResponse.json({ error: "not found" }, { status: 404 });

  const patch: Partial<typeof members.$inferInsert> = {};
  if (typeof body.nameEn === "string" && body.nameEn.trim()) patch.nameEn = body.nameEn.trim().slice(0, 60);
  if (typeof body.nameHi === "string" && body.nameHi.trim()) patch.nameHi = body.nameHi.trim().slice(0, 60);
  if (Array.isArray(body.aliases)) patch.aliases = body.aliases.map((a) => String(a).trim()).filter(Boolean).slice(0, 20);
  if (typeof body.color === "string") patch.color = body.color.slice(0, 20);
  if (typeof body.icon === "string") patch.icon = body.icon.slice(0, 30);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "nothing to do" }, { status: 400 });

  const [updated] = await db.update(members).set(patch).where(eq(members.id, id)).returning();
  await audit("member_rename", rows[0].nameEn, { to: updated.nameEn });
  return NextResponse.json({ member: updated });
}

/**
 * DELETE a member.
 *  ?moveTo=<memberId>  → their documents move to that member's "Other" folder
 *  otherwise           → their documents go to the Recycle Bin (30-day restore)
 * The last remaining member can never be deleted.
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.select().from(members).where(eq(members.id, id)).limit(1);
  const m = rows[0];
  if (!m) return NextResponse.json({ error: "not found" }, { status: 404 });
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members);
  if (n <= 1) return NextResponse.json({ error: "last_member" }, { status: 400 });

  const moveTo = req.nextUrl.searchParams.get("moveTo");
  const { findFolder } = await import("@/lib/vault");
  if (moveTo && moveTo !== id) {
    const target = await findFolder(moveTo, "other");
    if (!target) return NextResponse.json({ error: "target not found" }, { status: 404 });
    await db
      .update(documents)
      .set({ memberId: moveTo, folderId: target.id, updatedAt: new Date() })
      .where(eq(documents.memberId, id));
  } else {
    // Soft-delete their live documents; detach so cascading folder delete doesn't orphan FK
    await db
      .update(documents)
      .set({ deletedAt: new Date(), memberId: null, folderId: null, updatedAt: new Date() })
      .where(and(eq(documents.memberId, id), isNull(documents.deletedAt)));
    await db.update(documents).set({ memberId: null, folderId: null }).where(eq(documents.memberId, id));
  }
  await db.delete(members).where(eq(members.id, id)); // folders cascade
  await audit("member_delete", m.nameEn, { movedTo: moveTo ?? null });
  return NextResponse.json({ ok: true });
}
