import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { documents, folders, NewDocument } from "@/db/schema";
import { audit, findFolder, getRoster, isUnlocked, publicDoc, sha256 } from "@/lib/vault";
import { classify, detectMember, extractPdfText } from "@/lib/classifier";
import { detectDocType, DOC_TYPE_MAP } from "@/lib/docTypes";
import { sanitizeName } from "@/lib/naming";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_SIZE = 100 * 1024 * 1024; // 100 MB per document

type PendingUpload = { chunks: Buffer[]; received: number; totalChunks: number; name: string; mime: string; timer: NodeJS.Timeout };
const MAX_CHUNKS = 128;
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
 * extract text → folder classification → document-type detection →
 * member detection → duplicate check → store
 *
 * Anything the user chose in the upload form (name, member, folder, type)
 * always wins over what the scanner guessed.
 */
async function storeDocument(
  buffer: Buffer,
  name: string,
  mime: string,
  opts: { merge?: boolean; memberId?: string | null; folderId?: string | null; docType?: string | null; originalName?: string | null },
) {
  let ocrText = "";
  if (mime === "application/pdf") ocrText = await extractPdfText(buffer);

  // Classify on the user's name + the original file name + the text layer
  const source = `${name}\n${opts.originalName ?? ""}\n${ocrText}`;
  const classified = classify(source);
  let folderKey = classified.folder;
  const { tags, confidence } = classified;

  // ── Document type (Aadhaar / PAN / Khasra …) ──
  const typeGuess = detectDocType(source);
  let docType = opts.docType && DOC_TYPE_MAP[opts.docType] ? opts.docType : typeGuess?.type ?? "other";
  if (docType === "other" && tags.cardType) {
    const byCard: Record<string, string> = { Aadhaar: "aadhaar", PAN: "pan", "Voter ID": "voter" };
    docType = byCard[tags.cardType] ?? "other";
  }
  // The type is a stronger signal than loose folder keywords
  if (docType !== "other" && folderKey === "other") folderKey = DOC_TYPE_MAP[docType].folder;
  if (opts.docType && DOC_TYPE_MAP[opts.docType]) folderKey = DOC_TYPE_MAP[opts.docType].folder;

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

  // ── Member: explicit choice → detection → fallback to first member ──
  let member = null;
  if (opts.memberId) member = roster.find((m) => m.id === opts.memberId) ?? null;
  let memberCertain = !!member;
  if (!member) {
    const guess = detectMember(source, roster);
    if (guess) { member = guess.member; memberCertain = true; }
  }
  if (!member) member = roster[0] ?? null;

  // ── Folder: explicit choice (must belong to the member) → by key ──
  let folder = null;
  if (opts.folderId) {
    const rows = await db.select().from(folders).where(eq(folders.id, opts.folderId)).limit(1);
    if (rows[0]) {
      folder = rows[0];
      if (!opts.memberId) member = roster.find((m) => m.id === folder!.memberId) ?? member;
      memberCertain = true;
    }
  }
  if (!folder && member) folder = await findFolder(member.id, folderKey);

  // Replace-by-name: keep old bytes as the recoverable previous version
  const existing = dup[0] ?? (
    await db.select().from(documents).where(
      and(eq(documents.name, name), eq(documents.memberId, member?.id ?? ""), isNull(documents.deletedAt)),
    ).limit(1)
  )[0];
  const prev: Pick<NewDocument, "prevFileData" | "prevChecksum" | "prevSize"> = {
    prevFileData: existing?.fileData ?? null,
    prevChecksum: existing?.checksum ?? null,
    prevSize: existing?.size ?? null,
  };
  if (existing) await db.delete(documents).where(eq(documents.id, existing.id));

  const category = folder ? (folder.key === "custom" ? (folderKey === "other" ? "other" : folderKey) : folder.key) : folderKey;
  const inserted = await db
    .insert(documents)
    .values({
      name,
      mimeType: mime,
      size: buffer.length,
      category,
      docType,
      memberId: member?.id ?? null,
      folderId: folder?.id ?? null,
      fileData: buffer,
      checksum,
      ocrText: ocrText.slice(0, 20000),
      tags,
      ...prev,
    })
    .returning();

  await audit("upload", name, { folder: folder?.key ?? folderKey, member: member?.key ?? "unassigned", type: docType });
  return {
    duplicate: false as const,
    document: publicDoc(inserted[0]),
    detected: { folder: folderKey, docType, confidence, memberCertain, memberKey: member?.key ?? null },
  };
}

export async function POST(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const originalName = String(form.get("originalName") || (file instanceof File ? file.name : "") || "");
  const rawName = String(form.get("name") || originalName || "document");
  const mime = String(form.get("mime") || (file instanceof File ? file.type : "") || "application/octet-stream");
  const name = sanitizeName(rawName, originalName, mime);
  const uploadId = form.get("uploadId")?.toString();
  const merge = form.get("merge") === "1";
  const memberId = form.get("memberId")?.toString() || null;
  const folderId = form.get("folderId")?.toString() || null;
  const docType = form.get("docType")?.toString() || null;
  const storeOpts = { merge, memberId, folderId, docType, originalName };

  if (!(file instanceof Blob)) return NextResponse.json({ error: "file required" }, { status: 400 });

  // ── Single-shot upload ──
  if (!uploadId) {
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "too_big" }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await storeDocument(buffer, name, mime, storeOpts);
    if (result.duplicate) return NextResponse.json({ duplicate: true, existing: result.existing }, { status: 409 });
    return NextResponse.json(result);
  }

  // ── Chunked (resumable) upload ──
  const chunkIndex = parseInt(String(form.get("chunkIndex")), 10);
  const totalChunks = parseInt(String(form.get("totalChunks")), 10);
  if (!Number.isInteger(chunkIndex) || !Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_CHUNKS) {
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
  const result = await storeDocument(complete, p.name, p.mime, storeOpts);
  if (result.duplicate) return NextResponse.json({ duplicate: true, existing: result.existing }, { status: 409 });
  return NextResponse.json({ ...result, done: true });
}
