import { NextResponse } from "next/server";
import { asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents, members } from "@/db/schema";
import { getRoster, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/members → family roster with live document counts. */
export async function GET() {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const roster = await getRoster();
  const counts = await db
    .select({ memberId: documents.memberId, n: sql<number>`count(*)::int` })
    .from(documents)
    .where(isNull(documents.deletedAt))
    .groupBy(documents.memberId);
  const countMap = new Map(counts.map((c) => [c.memberId, c.n]));
  return NextResponse.json({
    members: roster.map((m) => ({
      id: m.id,
      key: m.key,
      nameEn: m.nameEn,
      nameHi: m.nameHi,
      icon: m.icon,
      color: m.color,
      aliases: m.aliases,
      sort: m.sort,
      docCount: countMap.get(m.id) ?? 0,
    })),
  });
}

/** POST /api/members → add a custom family member. */
export async function POST(req: Request) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { nameEn?: string; nameHi?: string; aliases?: string[] };
  if (!body.nameEn || !body.nameHi) return NextResponse.json({ error: "names required" }, { status: 400 });
  const maxSort = await db.select({ max: sql<number>`coalesce(max(${members.sort}), 0)` }).from(members);
  const key = `m-${Date.now().toString(36)}`;
  const [row] = await db
    .insert(members)
    .values({
      key,
      nameEn: body.nameEn,
      nameHi: body.nameHi,
      icon: "user",
      color: "indigo",
      aliases: body.aliases ?? [],
      sort: (maxSort[0]?.max ?? 0) + 1,
    })
    .returning();

  // Seed this member's five default folders
  const { DEFAULT_FOLDERS } = await import("@/lib/folderDefs");
  await db.insert(
    (await import("@/db/schema")).folders,
  ).values(
    DEFAULT_FOLDERS.map((f, i) => ({
      memberId: row.id,
      key: f.key,
      nameEn: null,
      nameHi: null,
      isDefault: true,
      sort: i + 1,
    })),
  );

  // Keep stable ordering if someone reorders later
  void asc;
  void eq;
  return NextResponse.json({ member: row });
}
