import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@/db";
import { documents, folders } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/bulk { action: "zip" | "delete" | "move", ids: [...], folderId? } */
export async function POST(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; ids?: string[]; folderId?: string };
  const ids = body.ids ?? [];
  if (!body.action || ids.length === 0) return NextResponse.json({ error: "action + ids required" }, { status: 400 });

  const rows = await db
    .select()
    .from(documents)
    .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)));

  // ── Move to folder ──
  if (body.action === "move" && body.folderId) {
    const f = await db.select().from(folders).where(eq(folders.id, body.folderId)).limit(1);
    if (!f[0]) return NextResponse.json({ error: "folder not found" }, { status: 404 });
    for (const d of rows) {
      await db
        .update(documents)
        .set({ folderId: f[0].id, memberId: f[0].memberId, category: f[0].key === "custom" ? d.category : f[0].key, updatedAt: new Date() })
        .where(eq(documents.id, d.id));
      await audit("move", d.name, { to: f[0].nameEn ?? f[0].key, bulk: true });
    }
    return NextResponse.json({ ok: true, moved: rows.length });
  }

  // ── Soft delete (recycle bin) ──
  if (body.action === "delete") {
    for (const d of rows) {
      await db.update(documents).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(documents.id, d.id));
      await audit("delete", d.name, { bulk: true });
    }
    return NextResponse.json({ ok: true, deleted: rows.length });
  }

  // ── Download as one ZIP ──
  if (body.action === "zip") {
    const zip = new JSZip();
    for (const d of rows) {
      const safe = d.name.replace(/[\\/:*?"<>|]/g, "_");
      zip.file(`${d.category}/${safe}`, d.fileData as Buffer);
    }
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
    await audit("download", `${rows.length} files (ZIP)`, { mode: "bulk-zip" });
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`documents-${stamp}.zip`)}`,
      },
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
