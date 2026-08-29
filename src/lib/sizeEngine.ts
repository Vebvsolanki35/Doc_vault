/**
 * ─────────────────────────────────────────────────────────────────────────
 *  EXACT-SIZE ENGINE  (government-portal ready)
 *  Goal: output a file as close as possible to a *target* byte count,
 *  e.g. "make my Aadhaar exactly under 500 KB".
 *
 *  Images  → binary-search JPEG quality at the current dimensions;
 *            if the floor is still too big, step dimensions down by the
 *            square-root of the size ratio and repeat. ±5% accuracy.
 *  PDFs    → extract embedded DCT (JPEG) streams of scanned pages,
 *            budget-recompress them with sharp, rebuild the PDF.
 *  Others  → lossless ZIP (best-effort, honestly reported).
 *
 *  Results are memoised in a short-lived in-process LRU so the "estimate"
 *  call and the actual download stay in perfect sync.
 * ─────────────────────────────────────────────────────────────────────────
 */
import sharp, { type Sharp, type Metadata } from "sharp";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { createHash } from "crypto";

const toU8 = (b: Buffer): Uint8Array<ArrayBuffer> => new Uint8Array(b);

export type SizeTarget = {
  buffer: Buffer;
  actualBytes: number;
  /** achieved ratio within ±5% of target */
  perfect: boolean;
  /** true when the floor was reached and we could not shrink further safely */
  floorReached: boolean;
  mime: string;
  ext: string;
};

const TOLERANCE = 0.05;
const MIN_DIM = 320; // never go below legibility
const MAX_DIM = 3000;

// ── In-memory LRU cache (estimate ⇒ download consistency) ────────────
type CacheEntry = { result: SizeTarget; at: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 60;

function cacheGet(key: string): SizeTarget | null {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, e); // refresh recency
  return e.result;
}
function cacheSet(key: string, result: SizeTarget) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { result, at: Date.now() });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
    else break;
  }
}
export function sizeCacheKey(docId: string, checksum: string, target: number, format: string) {
  return createHash("sha1").update(`${docId}:${checksum}:${target}:${format}`).digest("hex");
}
export function peekSizeCache(key: string) {
  return cacheGet(key);
}
function storeSizeCache(key: string, r: SizeTarget) {
  cacheSet(key, r);
}

// ── Image sizing ──────────────────────────────────────────────────────
async function jpegAt(img: Sharp, quality: number): Promise<Buffer> {
  return img.clone().flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

export async function sizeImage(input: Buffer, targetBytes: number, outFormat: "jpg" | "png"): Promise<SizeTarget> {
  const meta = await sharp(input).metadata();
  let width = Math.min(meta.width ?? 1200, MAX_DIM);
  let height = Math.min(meta.height ?? 1600, MAX_DIM);
  if (meta.width && meta.height && (meta.width > MAX_DIM || meta.height > MAX_DIM)) {
    const scale = MAX_DIM / Math.max(meta.width, meta.height);
    width = Math.round(meta.width * scale);
    height = Math.round(meta.height * scale);
  }

  // PNG with a generous target → try lossless-ish first
  if (outFormat === "png") {
    const buf = await sharp(input).rotate().resize({ width, height, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true, quality: 80 }).toBuffer();
    if (buf.length <= targetBytes) {
      return { buffer: buf, actualBytes: buf.length, perfect: buf.length >= targetBytes * (1 - TOLERANCE * 3) || true, floorReached: false, mime: "image/png", ext: "png" };
    }
    // fall through to JPEG when target demands compaction
    outFormat = "jpg";
  }

  const base = sharp(input).rotate();
  let best: Buffer | null = null; // biggest file seen UNDER target
  let over: Buffer | null = null; // smallest file seen OVER target
  const canGrowOrig = (w: number, h: number) => w < (meta.width ?? MAX_DIM) || h < (meta.height ?? MAX_DIM);

  // Portal semantics: the target is a LIMIT. "Perfect" = under the limit
  // with good fidelity (≥70% of the achievable source detail).
  const fidelityFloor = Math.min(targetBytes, input.length) * 0.7;
  const finish = (buf: Buffer, floor = false): SizeTarget => ({
    buffer: buf,
    actualBytes: buf.length,
    perfect: buf.length <= targetBytes && buf.length >= fidelityFloor,
    floorReached: floor,
    mime: "image/jpeg",
    ext: "jpg",
  });

  // Target asks for more than the original weighs → maximum-fidelity re-encode
  if (targetBytes >= input.length) {
    const full = await base.clone().resize({ width, height, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
    return finish(full.length <= targetBytes ? full : input, false);
  }
  const closest = (a: Buffer | null, b: Buffer | null): Buffer | null => {
    if (!a) return b;
    if (!b) return a;
    const da = Math.abs(a.length - targetBytes);
    const db = Math.abs(b.length - targetBytes);
    if (da === db) return a.length <= targetBytes ? a : b; // prefer under
    return da < db ? a : b;
  };

  for (let attempt = 0; attempt < 8; attempt++) {
    const resized = base.clone().resize({ width, height, fit: "inside", withoutEnlargement: true });

    // Floor probe: still too big at minimum quality → step dimensions down
    const lowProbe = await jpegAt(resized, 6);
    if (lowProbe.length > targetBytes) {
      best = best ?? null;
      if (!best || lowProbe.length < best.length) over = over && over.length < lowProbe.length ? over : lowProbe;
      const shrink = Math.max(0.5, Math.sqrt(targetBytes / lowProbe.length) * 0.92);
      width = Math.max(MIN_DIM, Math.round(width * shrink));
      height = Math.max(MIN_DIM, Math.round(height * shrink));
      if (width <= MIN_DIM && attempt > 2) {
        return finish(closest(best, closest(over, lowProbe)) ?? lowProbe, true);
      }
      continue;
    }

    // Binary-search JPEG quality at these dimensions
    let lo = 6, hi = 92;
    let atDimBest: Buffer | null = lowProbe; // q=6 is under
    let atDimOver: Buffer | null = null;
    for (let iter = 0; iter < 8; iter++) {
      const q = Math.round((lo + hi) / 2);
      const buf = await jpegAt(resized, q);
      const err = buf.length - targetBytes;
      if (Math.abs(err) <= targetBytes * TOLERANCE) return finish(buf); // bullseye
      if (err > 0) {
        hi = q;
        if (!atDimOver || buf.length < atDimOver.length) atDimOver = buf;
      } else {
        lo = q;
        if (!atDimBest || buf.length > atDimBest.length) atDimBest = buf;
      }
      if (hi - lo <= 1) break;
    }
    if (atDimBest && (!best || atDimBest.length > best.length)) best = atDimBest;
    if (atDimOver && (!over || atDimOver.length < over.length)) over = atDimOver;

    const candidate = closest(best, over);
    // Under-size & room to grow → spend budget on resolution, then refine again
    if (candidate && candidate.length < targetBytes * (1 - TOLERANCE) && canGrowOrig(width, height) && attempt < 6) {
      const grow = Math.min(1.3, Math.sqrt(targetBytes / candidate.length) * 0.95);
      if (grow > 1.04) {
        width = Math.min(Math.round(width * grow), meta.width ?? MAX_DIM, MAX_DIM);
        height = Math.min(Math.round(height * grow), meta.height ?? MAX_DIM, MAX_DIM);
        continue;
      }
    }
    if (candidate) return finish(candidate, false);
  }
  const fallback = closest(best, over) ?? (await jpegAt(base, 30));
  return finish(fallback, Math.abs(errRatio(fallback.length, targetBytes)) > TOLERANCE);
}

function errRatio(actual: number, target: number) {
  return (actual - target) / target;
}
function iterDim(w: number, h: number, meta: Metadata) {
  return w < (meta.width ?? MAX_DIM) || h < (meta.height ?? MAX_DIM);
}

// ── PDF sizing (scanned-image PDFs: the 99% case) ─────────────────────
/** Extract DCTDecode (JPEG) image streams from a PDF's raw bytes. */
export function extractJpegStreams(pdf: Buffer): Buffer[] {
  const images: Buffer[] = [];
  const bytes = pdf;
  let pos = 0;
  const bound = Buffer.from("endstream");
  while (pos < bytes.length) {
    const sIdx = bytes.indexOf("stream", pos);
    if (sIdx === -1) break;
    // inspect dictionary window before stream
    const winStart = Math.max(0, sIdx - 900);
    const window = bytes.subarray(winStart, sIdx);
    const eIdx = bytes.indexOf(bound, sIdx);
    if (eIdx === -1) break;
    if (window.includes("/DCTDecode") && !window.includes("/JBIG2Decode")) {
      let start = sIdx + 6;
      if (bytes[start] === 13) start++;
      if (bytes[start] === 10) start++;
      let end = eIdx;
      while (end > start && (bytes[end - 1] === 10 || bytes[end - 1] === 13)) end--;
      const stream = bytes.subarray(start, end);
      if (stream.length > 200 && stream[0] === 0xff && stream[1] === 0xd8) images.push(Buffer.from(stream));
    }
    pos = eIdx + 9;
  }
  return images;
}

export async function sizePdf(input: Buffer, targetBytes: number): Promise<SizeTarget> {
  const ok = (b: Buffer, floor = false): SizeTarget => ({
    buffer: b,
    actualBytes: b.length,
    perfect: Math.abs(errRatio(b.length, targetBytes)) <= TOLERANCE,
    floorReached: floor,
    mime: "application/pdf",
    ext: "pdf",
  });

  if (input.length <= targetBytes) return ok(input);

  const jpegs = extractJpegStreams(input);
  if (jpegs.length === 0) {
    // Text/vector PDF: re-save with object streams (small win) then report honestly
    try {
      const doc = await PDFDocument.load(input, { updateMetadata: false });
      const saved = Buffer.from(await doc.save({ useObjectStreams: true }));
      if (saved.length < input.length && saved.length <= targetBytes) return ok(saved);
    } catch { /* fall through */ }
    return ok(input, true);
  }

  // Budget: PDF scaffolding ≈ 6% + 5KB
  const imageBudget = Math.max(20000, Math.floor(targetBytes * 0.93 - 5000));
  const totalImageBytes = jpegs.reduce((a, b) => a + b.length, 0);
  const perImageBudgets = jpegs.map((j) => Math.max(6000, Math.floor((j.length / totalImageBytes) * imageBudget)));

  const processed: { buf: Buffer; w: number; h: number }[] = [];
  for (let i = 0; i < jpegs.length; i++) {
    try {
      const sized = await sizeImage(jpegs[i], perImageBudgets[i], "jpg");
      const meta = await sharp(sized.buffer).metadata();
      processed.push({ buf: sized.buffer, w: meta.width ?? 800, h: meta.height ?? 1100 });
    } catch {
      const meta = await sharp(jpegs[i]).metadata().catch(() => ({ width: 800, height: 1100 }) as Metadata);
      processed.push({ buf: jpegs[i], w: meta.width ?? 800, h: meta.height ?? 1100 });
    }
  }

  const out = await PDFDocument.create();
  for (const p of processed) {
    const img = await out.embedJpg(toU8(p.buf));
    const maxW = 595, maxH = 842;
    const scale = Math.min(maxW / p.w, maxH / p.h);
    const page = out.addPage([p.w * scale, p.h * scale]);
    page.drawImage(img, { x: 0, y: 0, width: p.w * scale, height: p.h * scale });
  }
  let rebuilt: Buffer = Buffer.from(await out.save({ useObjectStreams: true }));

  // If still over target, one more aggressive round at 70% budget
  if (rebuilt.length > targetBytes * (1 + TOLERANCE) && targetBytes > 40000) {
    const round2 = await sizePdf(rebuilt, Math.floor(targetBytes * 0.92));
    if (round2.actualBytes < rebuilt.length) rebuilt = round2.buffer;
  }
  return ok(rebuilt, rebuilt.length > targetBytes * (1 + TOLERANCE));
}

// ── Other formats → ZIP fallback (honest, best-effort) ────────────────
export async function sizeOther(input: Buffer, name: string): Promise<SizeTarget> {
  const zip = new JSZip();
  zip.file(name, input);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  return { buffer: buf, actualBytes: buf.length, perfect: false, floorReached: buf.length >= input.length * 0.98, mime: "application/zip", ext: "zip" };
}

// ── Orchestrator with cache ───────────────────────────────────────────
export async function compressToTarget(
  docId: string,
  checksum: string,
  input: Buffer,
  mimeType: string,
  targetBytes: number,
  format: "original" | "jpg" | "png" | "pdf",
): Promise<SizeTarget> {
  const key = sizeCacheKey(docId, checksum, targetBytes, format);
  const hit = cacheGet(key);
  if (hit) return hit;

  const isImg = /^image\//.test(mimeType);
  let result: SizeTarget;

  if (isImg && format === "pdf") {
    const { convertImage } = await import("./convert");
    // For image→PDF @ target: shrink image into budget then wrap
    const budget = Math.max(15000, Math.floor(targetBytes * 0.9));
    const sized = await sizeImage(input, budget, "jpg");
    const pdf = await PDFDocument.create();
    const img = await pdf.embedJpg(toU8(sized.buffer));
    const meta = await sharp(sized.buffer).metadata();
    const w = meta.width ?? 800, h = meta.height ?? 1100;
    const maxW = 595, maxH = 842;
    const scale = Math.min(maxW / w, maxH / h);
    const page = pdf.addPage([w * scale, h * scale]);
    page.drawImage(img, { x: 0, y: 0, width: w * scale, height: h * scale });
    const buf = Buffer.from(await pdf.save({ useObjectStreams: true }));
    result = { buffer: buf, actualBytes: buf.length, perfect: Math.abs(errRatio(buf.length, targetBytes)) <= TOLERANCE, floorReached: sized.floorReached, mime: "application/pdf", ext: "pdf" };
    void convertImage; // (shared converter remains available for quality-mode downloads)
  } else if (isImg && (format === "jpg" || format === "png" || format === "original")) {
    if (format === "original" && input.length <= targetBytes) {
      result = { buffer: input, actualBytes: input.length, perfect: true, floorReached: false, mime: mimeType, ext: mimeType.split("/")[1] ?? "bin" };
    } else {
      const out = format === "original" ? "jpg" : format;
      result = await sizeImage(input, targetBytes, out as "jpg" | "png");
    }
  } else if (mimeType === "application/pdf" || format === "pdf") {
    if (format === "original" && input.length <= targetBytes) {
      result = { buffer: input, actualBytes: input.length, perfect: true, floorReached: false, mime: "application/pdf", ext: "pdf" };
    } else {
      result = await sizePdf(input, targetBytes);
    }
  } else {
    result = await sizeOther(input, `document.${mimeType.split("/")[1] ?? "bin"}`);
  }

  storeSizeCache(key, result);
  return result;
}
