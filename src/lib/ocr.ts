/**
 * ─────────────────────────────────────────────────────────────────────────
 *  OCR  (on-device, private)
 *  Reads the actual words on a photo or scanned PDF with Tesseract
 *  (English + Hindi) so the sorter can work from CONTENT, not file names.
 *  • Language data ships inside node_modules — no internet needed, nothing
 *    leaves the machine.
 *  • Images are auto-rotated, greyscaled, normalised and capped at 2200px
 *    before recognition — that's the sweet spot for phone photos of cards.
 *  • Scanned PDFs: first 3 pages are rendered and read.
 *  • A single long-lived worker is reused; calls are serialised.
 * ─────────────────────────────────────────────────────────────────────────
 */
import path from "path";
import fs from "fs";
import os from "os";
import sharp from "sharp";

export type OcrResult = { text: string; confidence: number; engine: "tesseract" | "pdf-text" | "none"; ms: number };

const OCR_ENABLED = process.env.OCR_DISABLED !== "1";
const OCR_LANGS = (process.env.OCR_LANGS || "eng+hin").split("+").filter(Boolean);
const MAX_SIDE = 2200;
const PDF_PAGES = 3;

type Worker = Awaited<ReturnType<typeof import("tesseract.js").createWorker>>;
let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** Tesseract wants one folder holding `<lang>.traineddata.gz`; we assemble it once from the npm data packages. */
function ensureLangDir(): string {
  const dir = path.join(os.tmpdir(), "smart-tijori-tessdata");
  fs.mkdirSync(dir, { recursive: true });
  for (const lang of OCR_LANGS) {
    const dst = path.join(dir, `${lang}.traineddata.gz`);
    if (fs.existsSync(dst)) continue;
    // Resolve from the project root explicitly (bundlers rewrite require.resolve)
    const candidates = [
      path.join(process.cwd(), "node_modules", "@tesseract.js-data", lang, "4.0.0_best_int", `${lang}.traineddata.gz`),
      path.join(process.cwd(), "node_modules", "@tesseract.js-data", lang, "4.0.0", `${lang}.traineddata.gz`),
    ];
    const src = candidates.find((c) => fs.existsSync(c));
    if (src) fs.copyFileSync(src, dst);
  }
  return dir;
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const langPath = ensureLangDir();
      const w = await createWorker(OCR_LANGS, 1, {
        langPath,
        gzip: true,
        cachePath: path.join(os.tmpdir(), "smart-tijori-tesscache"),
        logger: process.env.OCR_DEBUG ? (m) => console.log("[ocr]", m.status, m.progress) : () => {},
        errorHandler: (e) => console.error("[ocr] worker error", e),
      });
      await w.setParameters({ preserve_interword_spaces: "1" });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Clean a photo so the recogniser sees crisp dark text on light paper. */
async function prepare(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalise()
    .sharpen()
    .png()
    .toBuffer();
}

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

async function recognise(png: Buffer): Promise<{ text: string; confidence: number }> {
  const w = await getWorker();
  const { data } = await w.recognize(png);
  return { text: (data.text || "").replace(/[ \t]+\n/g, "\n").trim(), confidence: data.confidence ?? 0 };
}

/** OCR an image buffer (JPG/PNG/WebP/HEIC…). Never throws — returns empty text on failure. */
export async function ocrImage(input: Buffer): Promise<OcrResult> {
  const t = Date.now();
  if (!OCR_ENABLED) return { text: "", confidence: 0, engine: "none", ms: 0 };
  try {
    const png = await prepare(input);
    const r = await serial(() => recognise(png));
    return { ...r, engine: "tesseract", ms: Date.now() - t };
  } catch {
    return { text: "", confidence: 0, engine: "none", ms: Date.now() - t };
  }
}

/**
 * Read a PDF: use its text layer when it has one; otherwise it's a scan →
 * render the first pages and OCR them.
 */
export async function ocrPdf(input: Buffer): Promise<OcrResult> {
  const t = Date.now();
  const { extractPdfText } = await import("./classifier");
  const layer = await extractPdfText(input);
  if (layer.replace(/\s+/g, "").length > 40) return { text: layer, confidence: 100, engine: "pdf-text", ms: Date.now() - t };
  if (!OCR_ENABLED) return { text: layer, confidence: 0, engine: "none", ms: Date.now() - t };
  try {
    const { pdfPageCount, renderPdfPage } = await import("./convert");
    const pages = Math.min(await pdfPageCount(input), PDF_PAGES);
    const texts: string[] = [];
    let conf = 0;
    for (let i = 1; i <= pages; i++) {
      const png = await renderPdfPage(input, i, "medium");
      const r = await serial(async () => recognise(await prepare(png)));
      texts.push(r.text);
      conf += r.confidence;
    }
    return { text: texts.join("\n\n"), confidence: pages ? conf / pages : 0, engine: "tesseract", ms: Date.now() - t };
  } catch {
    return { text: layer, confidence: 0, engine: "none", ms: Date.now() - t };
  }
}

export async function ocrAny(input: Buffer, mime: string): Promise<OcrResult> {
  if (mime === "application/pdf") return ocrPdf(input);
  if (/^image\//.test(mime)) return ocrImage(input);
  return { text: "", confidence: 0, engine: "none", ms: 0 };
}
