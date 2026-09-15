/**
 * Download & conversion engine.
 *  Quality presets (senior-friendly slider, per the spec):
 *    low    → max 300px   (WhatsApp-friendly)
 *    medium → max 800px
 *    high   → max 2000px  (≈300 DPI print quality)
 */
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

export type Quality = "low" | "medium" | "high";
export const QUALITY_DIM: Record<Quality, number> = { low: 300, medium: 800, high: 2000 };
const JPEG_Q: Record<Quality, number> = { low: 58, medium: 78, high: 92 };

export function isImage(mime: string): boolean {
  return /^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(mime);
}

async function toJpegBuffer(input: Buffer, quality: Quality, dimCap?: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const img = sharp(input).rotate(); // respect EXIF orientation
  const meta = await img.metadata();
  const maxDim = dimCap ?? QUALITY_DIM[quality];
  const resized = img.resize({
    width: maxDim,
    height: maxDim,
    fit: "inside",
    withoutEnlargement: true,
  });
  const buf = await resized.flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_Q[quality] }).toBuffer();
  const out = await sharp(buf).metadata();
  return { buf, w: out.width ?? meta.width ?? 800, h: out.height ?? meta.height ?? 600 };
}

export async function convertImage(
  input: Buffer,
  format: "jpg" | "png" | "pdf",
  quality: Quality,
): Promise<{ data: Buffer; mime: string; ext: string }> {
  const maxDim = QUALITY_DIM[quality];
  if (format === "png") {
    const data = await sharp(input).rotate().resize({ width: maxDim, height: maxDim, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { data, mime: "image/png", ext: "png" };
  }
  const { buf, w, h } = await toJpegBuffer(input, quality);
  if (format === "jpg") return { data: buf, mime: "image/jpeg", ext: "jpg" };

  // PDF: embed on an A-ish page; for "high" use 300-DPI physical sizing
  const pdf = await PDFDocument.create();
  const jpg = await pdf.embedJpg(buf);
  let pw: number, ph: number;
  if (quality === "high") {
    // 300 DPI → pixels / 300 inches × 72pt
    pw = (w / 300) * 72;
    ph = (h / 300) * 72;
  } else {
    const maxW = 595, maxH = 842; // A4 points
    const scale = Math.min(maxW / w, maxH / h);
    pw = w * scale;
    ph = h * scale;
  }
  const page = pdf.addPage([pw, ph]);
  page.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
  const data = Buffer.from(await pdf.save());
  return { data, mime: "application/pdf", ext: "pdf" };
}

/** Merge many image documents into one PDF. Non-images are skipped. */
export async function mergeImagesToPdf(
  items: { name: string; buffer: Buffer }[],
  quality: Quality,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const item of items) {
    try {
      const { buf, w, h } = await toJpegBuffer(item.buffer, quality);
      const jpg = await pdf.embedJpg(buf);
      const maxW = 595, maxH = 842;
      const scale = Math.min(maxW / w, maxH / h);
      const pw = w * scale, ph = h * scale;
      const page = pdf.addPage([pw, ph]);
      page.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
    } catch {
      /* skip unreadable image */
    }
  }
  return Buffer.from(await pdf.save());
}

// ── PDF → image (renders pages with pdf.js + a native canvas) ─────────
const RENDER_SCALE: Record<Quality, number> = { low: 0.6, medium: 1.5, high: 3 };

export async function pdfPageCount(pdf: Buffer): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return doc.numPages;
}

/** Render one page of a PDF to PNG bytes at a quality preset. */
export async function renderPdfPage(pdf: Buffer, page: number, quality: Quality): Promise<Buffer> {
  const { renderPageAsImage } = await import("unpdf");
  const png = await renderPageAsImage(new Uint8Array(pdf), page, {
    canvasImport: () => import("@napi-rs/canvas"),
    scale: RENDER_SCALE[quality],
  });
  return Buffer.from(png);
}

/**
 * Convert a PDF to JPG/PNG. One page → a single image; many pages → a ZIP
 * with one image per page (page-01.jpg …). Pages are capped to keep the
 * server responsive.
 */
export async function convertPdf(
  pdf: Buffer,
  format: "jpg" | "png",
  quality: Quality,
  baseName: string,
  maxPages = 30,
): Promise<{ data: Buffer; mime: string; ext: string; pages: number }> {
  const total = Math.min(await pdfPageCount(pdf), maxPages);
  const pages: Buffer[] = [];
  for (let i = 1; i <= total; i++) {
    const png = await renderPdfPage(pdf, i, quality);
    const out = format === "jpg"
      ? await sharp(png).flatten({ background: "#ffffff" }).jpeg({ quality: JPEG_Q[quality] }).toBuffer()
      : await sharp(png).png().toBuffer();
    pages.push(out);
  }
  if (pages.length === 1) return { data: pages[0], mime: format === "jpg" ? "image/jpeg" : "image/png", ext: format, pages: 1 };
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  pages.forEach((p, i) => zip.file(`${baseName}-page-${String(i + 1).padStart(2, "0")}.${format}`, p));
  const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { data, mime: "application/zip", ext: "zip", pages: pages.length };
}
