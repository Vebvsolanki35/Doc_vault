import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audit?limit=100 → family activity timeline (latest first). */
export async function GET(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "100", 10) || 100, 500);
  const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  return NextResponse.json({
    logs: rows.map((r) => ({
      id: r.id,
      action: r.action,
      docName: r.docName,
      meta: r.meta,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
