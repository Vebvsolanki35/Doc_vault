/**
 * ─────────────────────────────────────────────────────────────────────────
 *  SCAN ENHANCEMENT — turns a straightened photo of paper into a crisp,
 *  clean document, in the spirit of Adobe Scan's "Auto Clean / B&W /
 *  Sepia / Original" finishes. Pure pixel math (Uint8ClampedArray in →
 *  out), so it runs fully on the user's device and in node for tests.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type ScanMode = "clean" | "bw" | "sepia" | "original";

export const SCAN_MODES: { key: ScanMode; en: string; hi: string }[] = [
  { key: "clean", en: "Auto Clean", hi: "ऑटो क्लीन" },
  { key: "bw", en: "Black & White", hi: "काला-सफ़ेद" },
  { key: "sepia", en: "Sepia", hi: "सियरा" },
  { key: "original", en: "Original", hi: "असली" },
];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function percentile(values: ArrayLike<number>, p: number): number {
  if (values.length === 0) return 128;
  const arr = Array.from(values).sort((a, b) => a - b);
  const idx = Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))));
  return arr[idx];
}

/**
 * Per-channel 1%–99% auto levels, measured on the WHITE-BALANCED values
 * (gains applied), so the paper lands exactly on white after the stretch.
 */
function autoLevels(src: Uint8ClampedArray, gains: number[]): { lo: number[]; hi: number[] } {
  const n = src.length / 4;
  const hist = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    hist[0][Math.min(255, src[o] * gains[0] | 0)]++;
    hist[1][Math.min(255, src[o + 1] * gains[1] | 0)]++;
    hist[2][Math.min(255, src[o + 2] * gains[2] | 0)]++;
  }
  const lo: number[] = [], hi: number[] = [];
  for (let c = 0; c < 3; c++) {
    let acc = 0, loV = 0, hiV = 255;
    for (let v = 0; v < 256; v++) {
      acc += hist[c][v];
      if (loV === 0 && acc >= n * 0.01) loV = v;
      if (acc <= n * 0.99) hiV = v;
    }
    lo.push(loV);
    hi.push(Math.max(loV + 8, hiV));
  }
  return { lo, hi };
}

/**
 * Gray-world white balance: paper under warm/cool light comes back neutral.
 * Gains are clamped so we never blow out a coloured document.
 */
function whiteBalance(src: Uint8ClampedArray, w: number, h: number): number[] {
  const n = w * h;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    mean[0] += src[o];
    mean[1] += src[o + 1];
    mean[2] += src[o + 2];
  }
  mean[0] /= n || 1; mean[1] /= n || 1; mean[2] /= n || 1;
  const overall = (mean[0] + mean[1] + mean[2]) / 3 || 1;
  return mean.map((m) => Math.min(1.35, Math.max(0.72, overall / Math.max(1, m))));
}

/** 3×3 box blur of luminance (separable, running sum) for the unsharp mask. */
function lumBoxBlur(src: Uint8ClampedArray, w: number, h: number): Float32Array {
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = 0.299 * src[o] + 0.587 * src[o + 1] + 0.114 * src[o + 2];
  }
  const tmp = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -1; x <= 1; x++) sum += lum[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / 3;
      sum += lum[row + Math.min(w - 1, x + 2)] - lum[row + Math.max(0, x - 1)];
    }
  }
  const out = new Float32Array(n);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -1; y <= 1; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / 3;
      sum += tmp[Math.min(h - 1, y + 2) * w + x] - tmp[Math.max(0, y - 1) * w + x];
    }
  }
  return out;
}

function otsuLum(lum: Uint8ClampedArray): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < lum.length; i++) hist[lum[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = lum.length - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  // Snap to the midpoint of the two histogram modes. This matters when the
  // image is already bimodal (0/255): plain Otsu can land ON a mode, which
  // would turn the ink into mid-grey. Midpoint of the modes is always safe.
  let m1 = 0, best1 = 0, m2 = 255, best2 = 0;
  for (let v = 0; v <= bestT; v++) if (hist[v] > best1) { best1 = hist[v]; m1 = v; }
  for (let v = bestT; v < 256; v++) if (hist[v] > best2) { best2 = hist[v]; m2 = v; }
  if (m2 > m1) return (m1 + m2) / 2;
  return bestT;
}

/**
 * Apply a scan finish. `src`/`dst` are RGBA buffers (same length).
 * `dst` may be a fresh buffer; it is fully overwritten.
 */
export function enhance(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, mode: ScanMode): void {
  const n = w * h;
  if (mode === "original") {
    dst.set(src);
    return;
  }

  // Shared base: white balance → auto levels → paper anchor → unsharp.
  const gains = whiteBalance(src, w, h);
  const { lo, hi } = autoLevels(src, gains);
  const base = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const v = (src[o + c] * gains[c] - lo[c]) / (hi[c] - lo[c]) * 255;
      base[o + c] = clamp255(v);
    }
    base[o + 3] = 255;
  }

  // Paper anchor: pin the brightest ~8% (the paper) and stretch ink away from it,
  // the same trick that makes Adobe's "Auto Clean" look like a fresh scan.
  const paper: number[] = [];
  for (let c = 0; c < 3; c++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) vals.push(base[i * 4 + c]);
    paper.push(percentile(vals, 0.92));
  }
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      base[o + c] = clamp255(paper[c] + (base[o + c] - paper[c]) * 1.32);
    }
  }

  // Unsharp mask (crisp text edges)
  const blur = lumBoxBlur(base, w, h);
  const amount = 0.55;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const l = 0.299 * base[o] + 0.587 * base[o + 1] + 0.114 * base[o + 2];
    const d = (l - blur[i]) * amount;
    base[o] = clamp255(base[o] + d);
    base[o + 1] = clamp255(base[o + 1] + d);
    base[o + 2] = clamp255(base[o + 2] + d);
  }

  if (mode === "clean" || mode === "sepia") {
    dst.set(base);
    if (mode === "sepia") {
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const r = base[o], g = base[o + 1], b = base[o + 2];
        dst[o] = clamp255(0.393 * r + 0.769 * g + 0.189 * b);
        dst[o + 1] = clamp255(0.349 * r + 0.686 * g + 0.168 * b);
        dst[o + 2] = clamp255(0.272 * r + 0.534 * g + 0.131 * b);
      }
    }
    return;
  }

  // ── B&W: grayscale → soft Otsu threshold (pure black ink on white) ──
  const lum = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    lum[i] = clamp255(0.299 * base[o] + 0.587 * base[o + 1] + 0.114 * base[o + 2]);
  }
  const t = otsuLum(lum);
  const band = 14;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = lum[i] - t;
    const v = d >= band ? 255 : d <= -band ? 0 : ((d + band) / (2 * band)) * 255;
    dst[o] = dst[o + 1] = dst[o + 2] = clamp255(v);
    dst[o + 3] = 255;
  }
}

/** Convenience wrapper that allocates the output buffer. */
export function enhanceAlloc(src: Uint8ClampedArray, w: number, h: number, mode: ScanMode): Uint8ClampedArray<ArrayBuffer> {
  const dst = new Uint8ClampedArray(src.length);
  enhance(src, dst, w, h, mode);
  return dst;
}
