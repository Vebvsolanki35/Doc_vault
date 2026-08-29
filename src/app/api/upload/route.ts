import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, NewDocument } from "@/db/schema";
import { audit, findFolder, getRoster, isUnlocked, publicDoc, sha256 } from "@/lib/vault";
import { classify, detectMember, extractPdfText } from "@/lib/classifier";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

type PendingUpload = { chunks: Buffer[]; received: number; totalChunks: number; name: string; mime: string; timer: NodeJS.Timeout };
const pending = new Map<string, PendingUpload>();

function scheduleExpiry(id: string) {
  const p = pending.get(id);
  if (p) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => pending.delete(id), 10 * 60 * 1000);
  }
}

/**
 * THE SMART PIPELINE
 * extract text → folder classification → member detection → duplicate check → store
 */
async function storeDocument(
  buffer: Buffer,
  name: string,
  mime: string,
  opts: { merge?: boolean; memberId?: string | null; folderId?: string | null },
) {
  let ocrText = "";
  if (mime === "application/pdf") ocrText = await extractPdfText(buffer);

  const source = `${name}\n${ocrText}`;
  const { folder: folderKey, tags, confidence } = classify(source);
  const checksum = sha256(buffer);
  const roster = await getRoster();

  // ── Duplicate detection (identical bytes) ──
  const dup = await db
    .select()
    .from(documents)
    .where(and(eq(documents.checksum, checksum), isNull(documents.deletedAt)))
    .limit(1);
  if (dup[0] && !opts.merge) {
    return { duplicate: true as const, existing: publicDoc(dup[0]), checksum };
  }

  // ── Member detection (explicit override wins) ──
  let member = null;
  if (opts.memberId) member = roster.find((m) => m.id === opts.memberId) ?? null;
  if (!member) {
    const guess = detectMember(source, roster);
    if (guess) member = guess.member;
    // No guess → default to the member with most documents (usually Papa) but
    // flag low confidence so the UI can ask "क्या यह पापा का है?"
  }
  const memberCertain = !!member;
  if (!member) member = roster[0] ?? null;

  let folder = null;
  if (opts.folderId) {
    const all = member ? await findFolder(member.id, "") : null;
    void all;
  }
  if (member) folder = await findFolder(member.id, folderKey);
  if (opts.folderId) {
    const { folders } = await import("@/db/schema");
    const custom = await db.select().from(folders).where(eq(folders.id, opts.folderId)).limit(1);
    if (custom[0]) folder = custom[0];
  }

  // Replace-by-name: keep old bytes as the recoverable previous version
  const existing = dup[0] ?? (
    await db.select().from(documents).where(
      and(eq(documents.name, name), eq(documents.memberId, member?.id ?? ""), isNull(documents.deletedAt)),
    ).limit(1)
  )[0];
  let prev: Pick<NewDocument, "prevFileData" | "prevChecksum" | "prevSize"> = {
    prevFileData: existing?.fileData ?? null,
    prevChecksum: existing?.checksum ?? null,
    prevSize: existing?.size ?? null,
  };
  if (existing) await db.delete(documents).where(eq(documents.id, existing.id));

  const inserted = await db
    .insert(documents)
    .values({
      name,
      mimeType: mime,
      size: buffer.length,
      category: folder?.key === "custom" ? "other" : folder?.key ?? folderKey,
      memberId: member?.id ?? null,
      folderId: folder?.id ?? null,
      fileData: buffer,
      checksum,
      ocrText: ocrText.slice(0, 20000),
      tags,
      ...prev,
    })
    .returning();

  await audit("upload", name, { folder: folderKey, member: member?.key ?? "unassigned" });
  return {
    duplicate: false as const,
    document: publicDoc(inserted[0]),
    detected: { folder: folderKey, confidence, memberCertain, memberKey: member?.key ?? null },
  };
}

export async function POST(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const name = String(form.get("name") || (file instanceof File ? file.name : "document"));
  const mime = String(form.get("mime") || (file instanceof File ? file.type : "") || "application/octet-stream");
  const uploadId = form.get("uploadId")?.toString();
  const merge = form.get("merge") === "1";
  const memberId = form.get("memberId")?.toString() || null;
  const folderId = form.get("folderId")?.toString() || null;

  if (!(file instanceof Blob)) return NextResponse.json({ error: "file required" }, { status: 400 });

  // ── Single-shot upload ──
  if (!uploadId) {
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "too_big" }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await storeDocument(buffer, name, mime, { merge, memberId, folderId });
    if (result.duplicate) return NextResponse.json({ duplicate: true, existing: result.existing }, { status: 409 });
    return NextResponse.json(result);
  }

  // ── Chunked (resumable) upload ──
  const chunkIndex = parseInt(String(form.get("chunkIndex")), 10);
  const totalChunks = parseInt(String(form.get("totalChunks")), 10);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > 64) {
    return NextResponse.json({ error: "bad chunk info" }, { status: 400 });
  }
  const part = Buffer.from(await file.arrayBuffer());

  let p = pending.get(uploadId);
  if (!p) {
    p = { chunks: new Array(totalChunks), received: 0, totalChunks, name, mime, timer: setTimeout(() => pending.delete(uploadId), 600000) };
    pending.set(uploadId, p);
  }
  if (!p.chunks[chunkIndex]) {
    p.chunks[chunkIndex] = part;
    p.received++;
  }
  scheduleExpiry(uploadId);

  if (p.received < p.totalChunks) return NextResponse.json({ received: chunkIndex, done: false });

  const complete = Buffer.concat(p.chunks);
  clearTimeout(p.timer);
  pending.delete(uploadId);
  if (complete.length > MAX_SIZE) return NextResponse.json({ error: "too_big" }, { status: 413 });
  const result = await storeDocument(complete, p.name, p.mime, { merge, memberId, folderId });
  if (result.duplicate) return NextResponse.json({ duplicate: true, existing: result.existing }, { status: 409 });
  return NextResponse.json({ ...result, done: true });
}
