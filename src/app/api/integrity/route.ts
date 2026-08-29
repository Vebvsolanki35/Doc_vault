import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { isUnlocked, sha256 } from "@/lib/vault";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/integrity — self-healing scan.
 * Re-hashes every file; corrupted entries with a healthy previous version
 * are restored automatically (and reported).
 */
export async function POST(_req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const rows = await db.select().from(documents);
  const restored: string[] = [];
  const broken: string[] = [];

  for (const d of rows) {
    if (sha256(d.fileData as Buffer) === d.checksum) continue;
    if (d.prevFileData && d.prevChecksum && sha256(d.prevFileData as Buffer) === d.prevChecksum) {
      await db
        .update(documents)
        .set({ fileData: d.prevFileData, checksum: d.prevChecksum, size: d.prevSize ?? d.size, updatedAt: new Date() })
        .where(eq(documents.id, d.id));
      restored.push(d.name);
    } else {
      broken.push(d.name);
    }
  }

  return NextResponse.json({ checked: rows.length, restored, broken, healthy: broken.length === 0 });
}
