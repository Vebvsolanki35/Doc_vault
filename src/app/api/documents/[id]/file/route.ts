import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { isUnlocked, sha256 } from "@/lib/vault";
import { convertImage, isImage, Quality } from "@/lib/convert";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/documents/[id]/file?mode=raw|jpg|png|pdf&quality=low|medium|high&download=1
 * Also authorizes QR shares via  &share=<token>&p=<passcode>
 *
 * SELF-HEALING: every fetch re-verifies the sha256 checksum. If the current
 * bytes are corrupted but a healthy previous version exists, it is restored
 * automatically and served instead.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;

  // ── Authorisation: unlocked session OR valid share token+passcode ──
  const shareToken = sp.get("share");
  const sharePass = sp.get("p");
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const shareOk =
    shareToken &&
    doc.shareToken &&
    shareToken === doc.shareToken &&
    sharePass === doc.sharePasscode &&
    (!doc.shareExpiresAt || doc.shareExpiresAt.getTime() > Date.now());
  if (doc.deletedAt && !shareOk) {
    // Deleted documents are not publicly fetchable
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (shareToken && doc.shareExpiresAt && doc.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (!shareOk && !(await isUnlocked())) {
    return NextResponse.json({ error: "locked" }, { status: 401 });
  }

  // ── Self-healing integrity check ───────────────────────────────────
  let data = doc.fileData as Buffer;
  let healed = false;
  if (sha256(data) !== doc.checksum) {
    if (doc.prevFileData && doc.prevChecksum && sha256(doc.prevFileData as Buffer) === doc.prevChecksum) {
      data = doc.prevFileData as Buffer;
      await db
        .update(documents)
        .set({
          fileData: data,
          checksum: doc.prevChecksum,
          size: doc.prevSize ?? doc.size,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, doc.id));
      healed = true;
    }
  }

  const mode = sp.get("mode") ?? "raw";
  const quality = (sp.get("quality") as Quality) || "medium";
  const asDownload = sp.get("download") === "1";
  const baseName = doc.name.replace(/\.[^.]+$/, "").replace(/[^\w\u0900-\u097F -]+/g, "_");

  let outData: Buffer = data;
  let outMime = doc.mimeType;
  let outName = doc.name;

  if (mode !== "raw") {
    if (!isImage(doc.mimeType)) {
      return NextResponse.json({ error: "conversion only for images" }, { status: 400 });
    }
    try {
      const conv = await convertImage(data, mode as "jpg" | "png" | "pdf", quality);
      outData = conv.data;
      outMime = conv.mime;
      outName = `${baseName}.${conv.ext}`;
    } catch {
      return NextResponse.json({ error: "conversion failed" }, { status: 500 });
    }
  } else if (mode === "raw" && asDownload) {
    outName = doc.name;
  }

  const headers = new Headers({
    "Content-Type": outMime,
    "Content-Length": String(outData.length),
    "X-Restored": healed ? "1" : "0",
    "Cache-Control": shareOk ? "private, max-age=300" : "private, max-age=3600",
  });
  if (asDownload || mode !== "raw") {
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(outName)}`);
    const { audit } = await import("@/lib/vault");
    await audit("download", doc.name, { mode, via: shareOk ? "qr" : "vault" });
  } else {
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(outName)}`);
  }
  return new NextResponse(new Uint8Array(outData), { headers });
}
