import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { isUnlocked, setSetting } from "@/lib/vault";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/backup → whole vault as one ZIP, neatly foldered by category. */
export async function GET(_req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const rows = await db.select().from(documents);
  const zip = new JSZip();
  const manifest: Record<string, unknown> = { createdAt: new Date().toISOString(), count: rows.length, files: [] as unknown[] };

  for (const d of rows) {
    const safe = d.name.replace(/[\\/:*?"<>|]/g, "_");
    zip.folder(d.category)?.file(`${d.id.slice(0, 8)}-${safe}`, d.fileData as Buffer);
    (manifest.files as unknown[]).push({ name: d.name, category: d.category, size: d.size, checksum: d.checksum, tags: d.tags });
  }
  zip.file("vault-manifest.json", JSON.stringify(manifest, null, 2));

  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await setSetting("lastBackupAt", new Date().toISOString());
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`smart-tijori-backup-${stamp}.zip`)}`,
      "Cache-Control": "no-store",
    },
  });
}
