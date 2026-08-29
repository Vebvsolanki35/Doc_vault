import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET → folders of a member, each with a live document count. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const rows = await db.select().from(folders).where(eq(folders.memberId, id)).orderBy(asc(folders.sort), asc(folders.createdAt));
  const counts = await db
    .select({ folderId: documents.folderId, n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(isNull(documents.deletedAt)))
    .groupBy(documents.folderId);
  const countMap = new Map(counts.map((c) => [c.folderId, c.n]));
  return NextResponse.json({
    folders: rows.map((f) => ({ ...f, docCount: countMap.get(f.id) ?? 0 })),
  });
}

/** POST → create a custom folder ("Medical Reports"…) inside the member's space. */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; nameHi?: string };
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const existing = await db.select().from(folders).where(eq(folders.memberId, id));
  const [row] = await db
    .insert(folders)
    .values({
      memberId: id,
      key: "custom",
      nameEn: name,
      nameHi: body.nameHi?.trim() || null,
      isDefault: false,
      sort: existing.length + 2,
    })
    .returning();
  return NextResponse.json({ folder: row });
}
