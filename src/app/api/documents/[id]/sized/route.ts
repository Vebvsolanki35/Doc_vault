import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";
import { compressToTarget } from "@/lib/sizeEngine";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };
const MIN_TARGET = 20 * 1024; // 20 KB floor — below this nothing stays legible

/**
 * POST { targetBytes, format, estimate?: boolean }
 *  estimate=true  → JSON { actualBytes, perfect, floorReached } (cached result)
 *  estimate=false → the actual file, byte-exact with the estimate.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    targetBytes?: number;
    format?: "original" | "jpg" | "png" | "pdf";
    estimate?: boolean;
  };
  const targetBytes = Math.max(MIN_TARGET, Math.min(Math.floor(body.targetBytes ?? 0), 24 * 1024 * 1024));
  const format = body.format ?? "original";
  if (!targetBytes) return NextResponse.json({ error: "targetBytes required" }, { status: 400 });

  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  // If the original already fits the target → passthrough (100% fidelity)
  if (doc.size <= targetBytes && format === "original") {
    if (body.estimate) {
      return NextResponse.json({ actualBytes: doc.size, perfect: true, floorReached: false, passthrough: true, mime: doc.mimeType, ext: doc.name.split(".").pop() });
    }
    const headers = new Headers({
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.name)}`,
      "X-Actual-Size": String(doc.size),
      "X-Perfect": "1",
    });
    await audit("download", doc.name, { mode: "sized-passthrough" });
    return new NextResponse(new Uint8Array(doc.fileData as Buffer), { headers });
  }

  const result = await compressToTarget(doc.id, doc.checksum, doc.fileData as Buffer, doc.mimeType, targetBytes, format);

  if (body.estimate) {
    return NextResponse.json({
      actualBytes: result.actualBytes,
      perfect: result.perfect,
      floorReached: result.floorReached,
      passthrough: false,
      mime: result.mime,
      ext: result.ext,
    });
  }

  const baseName = doc.name.replace(/\.[^.]+$/, "").replace(/[^\w\u0900-\u097F -]+/g, "_");
  const outName = `${baseName}.${result.ext}`;
  await audit("download", doc.name, { mode: "sized", target: targetBytes, actual: result.actualBytes });
  const headers = new Headers({
    "Content-Type": result.mime,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(outName)}`,
    "X-Actual-Size": String(result.actualBytes),
    "X-Perfect": result.perfect ? "1" : "0",
    "X-Floor": result.floorReached ? "1" : "0",
    "Cache-Control": "no-store",
  });
  return new NextResponse(new Uint8Array(result.buffer), { headers });
}
