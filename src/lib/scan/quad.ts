/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DOCUMENT QUAD DETECTION (pure math — runs on the user's device,
 *  nothing leaves it, works in node for tests).
 *
 *  Pipeline: grayscale → blur → Sobel edges → Otsu threshold →
 *  morphological close → largest connected component → PCA box →
 *  corner ordering.  The result is a 4-corner quad (TL, TR, BR, BL)
 *  in the source image's pixel coordinates.
 *
 *  Deliberately simple + fast: a phone frame at 320px must be analysed
 *  every ~300 ms, so every pass is a single O(n) typed-array loop.
 * ─────────────────────────────────────────────────────────────────────────
 */

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL

// ── Colour → grayscale ────────────────────────────────────────────────
/** RGBA (or RGB) pixels → Float32 gray in [0,255]. */
export function toGray(data: Uint8ClampedArray, w: number, h: number, stride = 4): Float32Array {
  const out = new Float32Array(w * h);
  let i = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const o = i * stride;
      out[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }
  }
  return out;
}

/** Downscale a canvas or live <video> frame into gray at target width. */
export function grayFromFrame(frame: HTMLCanvasElement | HTMLVideoElement, targetW: number): { gray: Float32Array; w: number; h: number; scale: number } {
  const isVideo = frame instanceof HTMLVideoElement;
  const vw = isVideo ? frame.videoWidth : frame.width;
  const vh = isVideo ? frame.videoHeight : frame.height;
  if (!vw || !vh) throw new Error("empty frame");
  const scale = targetW / vw;
  const w = Math.max(48, Math.round(targetW));
  const h = Math.max(36, Math.round(vh * scale));
  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const ctx = tmp.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(frame, 0, 0, vw, vh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  return { gray: toGray(d, w, h), w, h, scale };
}

// ── Box blur (separable, running sum) ─────────────────────────────────
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const win = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  // horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  // vertical pass
  const out = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// ── Sobel gradient magnitude ──────────────────────────────────────────
export function sobelMag(gray: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const g = (x: number, y: number) => gray[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1) - g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1);
      const gy = g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1) - g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1);
      out[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

// ── Otsu threshold ────────────────────────────────────────────────────
export function otsu(hist: Int32Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT;
}

// ── Binary morphology (3×3 structuring element) ───────────────────────
function erode(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) { v = 0; break; }
          if (!mask[yy * w + xx]) { v = 0; break; }
          v = 1;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
function dilate(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        for (let dx = -1; dx <= 1 && !v; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) v = 1;
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}
/** Close = dilate then erode: joins edge fragments into one solid blob. */
export function morphClose(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  let m = mask;
  for (let i = 0; i < r; i++) m = dilate(m, w, h);
  for (let i = 0; i < r; i++) m = erode(m, w, h);
  return m;
}

// ── Flood the background from the frame borders ───────────────────────
/**
 * Mark every cell reachable from the frame border WITHOUT crossing an
 * edge. What's left unmarked (plus the edges) is the paper interior —
 * this turns a thin edge outline into a solid filled document region.
 */
export function floodBackground(mask: Uint8Array, w: number, h: number): Uint8Array {
  const bg = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i: number) => {
    if (!mask[i] && !bg[i]) { bg[i] = 1; stack[top++] = i; }
  };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (top > 0) {
    const i = stack[--top];
    const x = i % w, y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (!mask[j] && !bg[j]) { bg[j] = 1; stack[top++] = j; }
      }
    }
  }
  return bg;
}

// ── Largest connected component (iterative flood fill) ────────────────
/**
 * Returns the indices of the biggest connected component of `mask`.
 */
function largestComponent(mask: Uint8Array, w: number, h: number): { indices: Int32Array; count: number } | null {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best: { indices: number[]; count: number } | null = null;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    let top = 0;
    stack[top++] = start;
    label[start] = 1;
    const comp: number[] = [];
    while (top > 0) {
      const i = stack[--top];
      comp.push(i);
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = yy * w + xx;
          if (mask[j] && label[j] === -1) { label[j] = 1; stack[top++] = j; }
        }
      }
    }
    if (!best || comp.length > best.count) best = { indices: comp, count: comp.length };
  }
  if (!best) return null;
  const indices = new Int32Array(best.count);
  for (let i = 0; i < best.count; i++) indices[i] = best.indices[i];
  return { indices, count: best.count };
}

// ── PCA box around a set of pixels ────────────────────────────────────
/**
 * Minimum-area box via principal axes: for a rectangular paper blob the
 * second principal axis gives the tilt, the extents give the size.
 * Returns the 4 corners (in source pixels) ordered TL, TR, BR, BL.
 */
export function pcaBox(indices: Int32Array, count: number, w: number, h: number): Quad | null {
  if (count < 40) return null;
  const stride = Math.max(1, Math.floor(count / 6000)); // cap work
  let n = 0, mx = 0, my = 0;
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < count; i += stride) {
    const idx = indices[i];
    const x = idx % w, y = (idx / w) | 0;
    xs.push(x); ys.push(y);
    mx += x; my += y;
    n++;
  }
  mx /= n; my /= n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
  }
  cxx /= n; cyy /= n; cxy /= n;
  // principal axis (largest eigenvalue)
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const cos = Math.cos(-theta), sin = Math.sin(-theta);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    const u = dx * cos - dy * sin;
    const v = dx * sin + dy * cos;
    if (u < uMin) uMin = u;
    if (u > uMax) uMax = u;
    if (v < vMin) vMin = v;
    if (v > vMax) vMax = v;
  }
  const cu = Math.cos(theta), su = Math.sin(theta);
  const corners: Pt[] = [
    [mx + uMin * cu - vMin * su, my + uMin * su + vMin * cu],
    [mx + uMax * cu - vMin * su, my + uMax * su + vMin * cu],
    [mx + uMax * cu - vMax * su, my + uMax * su + vMax * cu],
    [mx + uMin * cu - vMax * su, my + uMin * su + vMax * cu],
  ];
  return orderCorners(corners);
}

/** Order 4 (unsorted) corners as TL, TR, BR, BL. */
export function orderCorners(pts: Pt[]): Quad {
  const sum = (p: Pt) => p[0] + p[1];
  const diff = (p: Pt) => p[0] - p[1];
  const a = [...pts];
  const tl = a.reduce((m, p) => (sum(p) < sum(m) ? p : m));
  const br = a.reduce((m, p) => (sum(p) > sum(m) ? p : m));
  // TR has the largest x−y, BL the smallest (top corners sit right/low-y,
  // bottom corners left/high-y)
  const tr = a.reduce((m, p) => (diff(p) > diff(m) ? p : m));
  const bl = a.reduce((m, p) => (diff(p) < diff(m) ? p : m));
  return [tl, tr, br, bl];
}

export function quadArea(q: Quad): number {
  // shoelace
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = q[i];
    const [x2, y2] = q[(i + 1) % 4];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function quadCentroid(q: Quad): Pt {
  let x = 0, y = 0;
  for (const [px, py] of q) { x += px; y += py; }
  return [x / 4, y / 4];
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ── Full detection ────────────────────────────────────────────────────
export type DetectResult = { quad: Quad; /** quad area / frame area */ fill: number; aspect: number; convexity: number };

/**
 * Detect a paper document inside a gray frame.
 * `minFill`/`maxFill`: how much of the frame the document must cover.
 */
export function detectDocumentGray(gray: Float32Array, w: number, h: number, opts?: { minFill?: number; maxFill?: number }): DetectResult | null {
  const minFill = opts?.minFill ?? 0.12;
  const maxFill = opts?.maxFill ?? 0.97;
  const total = w * h;

  const blurred = boxBlur(gray, w, h, 2);
  const mag = sobelMag(blurred, w, h);

  const hist = new Int32Array(256);
  for (let i = 0; i < total; i++) hist[Math.min(255, mag[i] | 0)]++;
  const t = otsu(hist, total);

  let edges: Uint8Array = new Uint8Array(total);
  for (let i = 0; i < total; i++) edges[i] = mag[i] > t ? 1 : 0;
  edges = morphClose(edges, w, h, 2);

  // Solid paper region = filled interior ∪ edge band.
  const bg = floodBackground(edges, w, h);
  const paper = new Uint8Array(total);
  for (let i = 0; i < total; i++) paper[i] = edges[i] || !bg[i] ? 1 : 0;

  const comp = largestComponent(paper, w, h);
  if (!comp) return null;

  let quad = pcaBox(comp.indices, comp.count, w, h);
  if (!quad) return null;

  // Refinement: shadows / desk texture add a soft gradient AROUND the paper,
  // which widens the box. The real paper border is the STRONG edge (top ~3%
  // of the gradient energy) — tighten the box onto it.
  let acc = 0;
  let p97 = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.03) { p97 = v; break; }
  }
  const strongT = Math.max(t + 40, p97);
  let strong: Uint8Array = new Uint8Array(total);
  let strongCount = 0;
  for (let i = 0; i < total; i++) if (mag[i] > strongT) { strong[i] = 1; strongCount++; }
  if (strongCount > 30) {
    strong = morphClose(strong, w, h, 1);
    const strongComp = largestComponent(strong, w, h);
    if (strongComp && strongComp.count >= 24) {
      const q2 = pcaBox(strongComp.indices, strongComp.count, w, h);
      if (q2) {
        const f2 = quadArea(q2) / total;
        if (f2 >= minFill && f2 <= maxFill) quad = q2;
      }
    }
  }

  const qArea = quadArea(quad);
  const fill = qArea / total;
  const edgeTop = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2;
  const edgeSide = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2;
  const aspect = Math.min(1, Math.max(edgeTop, edgeSide) / Math.max(1, Math.min(edgeTop, edgeSide)));
  const convexity = comp.count / Math.max(1, qArea);

  if (fill < minFill || fill > maxFill) {
    // The paper may touch the frame border (interior leaked out) — fall
    // back to the raw edge band, whose box still tracks the visible paper.
    const edgeComp = largestComponent(edges, w, h);
    const q2 = edgeComp ? pcaBox(edgeComp.indices, edgeComp.count, w, h) : null;
    if (q2) {
      const f2 = quadArea(q2) / total;
      const a2 = Math.min(1, Math.max(dist(q2[0], q2[1]), dist(q2[3], q2[2])) / Math.max(1, Math.min(dist(q2[0], q2[1]), dist(q2[3], q2[2]))));
      if (f2 >= minFill && f2 <= maxFill && a2 <= 3.4) {
        return { quad: q2, fill: f2, aspect: a2, convexity: 0.3 };
      }
    }
    return null;
  }
  if (aspect > 3.4) return null;
  if (convexity < 0.6) return null; // a paper region should mostly fill its box

  return { quad, fill, aspect, convexity };
}

/** Convenience: detect directly from an RGBA pixel buffer. */
export function detectDocumentRGBA(data: Uint8ClampedArray, w: number, h: number, opts?: { minFill?: number; maxFill?: number }): DetectResult | null {
  const gray = toGray(data, w, h);
  return detectDocumentGray(gray, w, h, opts);
}
