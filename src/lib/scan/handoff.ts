/**
 * In-memory handoff: the Paper Scanner produces finished page(s)
 * (one clean JPEG or one multi-page PDF) and drops them here; the
 * upload flow picks them up on mount and runs them through the
 * normal SmartScan review cards. Client-side navigation keeps the
 * module alive, so the files travel without touching disk.
 */
let staged: File[] = [];

export function stageScanFiles(files: File[]): void {
  staged = files;
}

export function takeScanFiles(): File[] {
  const out = staged;
  staged = [];
  return out;
}

/** Suggested scan file name: Scanned_Paper_2026-09-15_12-30 */
export function scanFileName(ext: "jpg" | "pdf", d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Scanned_Paper_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.${ext}`;
}
