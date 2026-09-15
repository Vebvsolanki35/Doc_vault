/** File-name helpers shared by the upload form and the upload API. */

export function extOf(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : "";
}

export function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,5}$/i, "");
}

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic",
  "image/heif": "heif", "image/gif": "gif", "image/avif": "avif", "application/pdf": "pdf",
};

/**
 * Turn whatever the user typed into a safe, complete file name:
 *  • trims + collapses whitespace, removes path separators / control chars
 *  • keeps Devanagari and other Unicode letters
 *  • re-attaches the original extension when the user dropped it
 */
export function sanitizeName(typed: string, originalName: string, mime: string): string {
  let base = typed
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/(^|\s)\.{2,}(?=\s|$)/g, " ") // stray ".." pieces
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  if (!base) base = originalName || "document";
  const wantedExt = extOf(originalName) || MIME_EXT[mime] || "";
  const haveExt = extOf(base);
  if (wantedExt && haveExt !== wantedExt) {
    // "Papa Aadhaar" → "Papa Aadhaar.jpg";  "Papa Aadhaar.JPEG" → "Papa Aadhaar.jpg"
    const knownExts = new Set(Object.values(MIME_EXT).concat(["jpeg", "tif", "tiff", "bmp"]));
    base = `${knownExts.has(haveExt) ? stripExt(base) : base}.${wantedExt}`;
  }
  return base.slice(0, 180);
}

/** Suggest a tidy display name: "Papa – Aadhaar Card" style. */
export function suggestName(memberName: string | null, typeLabel: string | null, originalName: string): string {
  const ext = extOf(originalName);
  const parts = [memberName, typeLabel].filter(Boolean) as string[];
  if (parts.length === 0) return originalName;
  return `${parts.join(" - ")}${ext ? "." + ext : ""}`;
}
