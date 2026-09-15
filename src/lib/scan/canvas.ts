/**
 * Browser canvas plumbing for the paper scanner:
 *  • grabFrame        — current camera frame → canvas
 *  • rectify          — 4-corner perspective-correct a canvas (two-triangle
 *                       affine warp: canvas 2D can't do perspective directly)
 *  • drawQuadOverlay  — the live "found the paper" frame on top of the camera
 *  • canvasToJpeg     — encode a canvas to a JPEG blob
 */
import type { Quad } from "./quad";

export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  return c;
}

export function affineFrom(
  p0: [number, number], p1: [number, number], p2: [number, number],
  q0: [number, number], q1: [number, number], q2: [number, number],
): [number, number, number, number, number, number] {
  // Solve [a b; c d; e f] s.t. p→q
  const [x0, y0] = p0, [x1, y1] = p1, [x2, y2] = p2;
  const [u0, v0] = q0, [u1, v1] = q1, [u2, v2] = q2;
  const det = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(det) < 1e-6) return [1, 0, 0, 1, 0, 0];
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / det;
  const b = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / det;
  const c = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / det;
  const d = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / det;
  const e = u0 - a * x0 - b * y0;
  const f = v0 - c * x0 - d * y0;
  return [a, b, c, d, e, f];
}

/** Output size in pixels for a given quad (keeps the paper's aspect ratio). */
export function rectifySize(sourceW: number, sourceH: number, quad: Quad, targetW: number): { w: number; h: number } {
  const d = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const top = (d(quad[0], quad[1]) + d(quad[3], quad[2])) / 2;
  const side = (d(quad[0], quad[3]) + d(quad[1], quad[2])) / 2;
  const w = Math.round(targetW);
  const h = Math.max(80, Math.round((w * side) / Math.max(1, top)));
  return { w: Math.min(w, sourceW * 4), h: Math.min(h, sourceH * 4) };
}

/**
 * Perspective-correct `source` using `quad` (TL,TR,BR,BL in source pixels)
 * into a fresh canvas of `targetW` × computed height.
 * Trick: split the destination rectangle along the TL→BR diagonal and map
 * the two source triangles with two affine transforms (they agree on the
 * shared edge, so the seam is invisible).
 */
export function rectify(source: HTMLCanvasElement, quad: Quad, targetW: number): HTMLCanvasElement {
  const { w, h } = rectifySize(source.width, source.height, quad, targetW);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const tl = quad[0], tr = quad[1], br = quad[2], bl = quad[3];
  // Triangle 1: source (tl,tr,br) → dest (0,0, w,0, w,h)
  let m = affineFrom(tl, tr, br, [0, 0], [w, 0], [w, h]);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, 0);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  // Triangle 2: source (tl,br,bl) → dest (0,0, w,h, 0,h)
  m = affineFrom(tl, br, bl, [0, 0], [w, h], [0, h]);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.clip();
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  ctx.drawImage(source, 0, 0);
  ctx.restore();
  return out;
}

/** Default full-frame quad with a small inset (fallback when nothing detected). */
export function fullFrameQuad(w: number, h: number, inset = 0.015): Quad {
  const ix = w * inset, iy = h * inset;
  return [
    [ix, iy],
    [w - ix, iy],
    [w - ix, h - iy],
    [ix, h - iy],
  ];
}

/**
 * Draw the detection frame over the live camera view.
 * `quad` is in the video's own pixel coordinates; `contentRect` is the
 * letterboxed video area expressed in OVERLAY-CANVAS pixels (the page
 * computes it — it must use the same contain math as <video object-fit>).
 */
export function drawQuadOverlay(
  canvas: HTMLCanvasElement,
  contentRect: { x: number; y: number; w: number; h: number },
  videoW: number,
  videoH: number,
  quad: Quad | null,
  active: boolean,
): void {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!quad) {
    // gentle pulsing corner ticks so seniors see the frame is alive
    const s = Math.min(canvas.width, canvas.height) * 0.06;
    const p = 0.6 + 0.4 * Math.sin(Date.now() / 400);
    ctx.strokeStyle = `rgba(217, 106, 0, ${0.35 + 0.4 * p})`;
    ctx.lineWidth = 3;
    const m = 18;
    const corners: [number, number, number, number][] = [
      [m, m, 1, 1], [canvas.width - m, m, -1, 1], [canvas.width - m, canvas.height - m, -1, -1], [m, canvas.height - m, 1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x, y + sy * s);
      ctx.lineTo(x, y);
      ctx.lineTo(x + sx * s, y);
      ctx.stroke();
    }
    return;
  }
  // video pixels → overlay canvas pixels
  const s = contentRect.w / Math.max(1, videoW);
  const P = (pt: [number, number]): [number, number] => [contentRect.x + pt[0] * s, contentRect.y + pt[1] * s];

  // darken outside the paper
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  const p0 = P(quad[0]), p1 = P(quad[1]), p2 = P(quad[2]), p3 = P(quad[3]);
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.closePath();
  ctx.fillStyle = "rgba(10, 14, 12, 0.45)";
  ctx.fill("evenodd");

  // the paper frame
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.lineTo(p3[0], p3[1]);
  ctx.closePath();
  ctx.strokeStyle = active ? "rgba(47, 107, 63, 0.95)" : "rgba(217, 106, 0, 0.9)";
  ctx.lineWidth = active ? 5 : 3.5;
  ctx.setLineDash([]);
  ctx.stroke();

  // corner dots
  ctx.fillStyle = active ? "#2f6b3f" : "#d96a00";
  for (const p of [p0, p1, p2, p3]) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], active ? 9 : 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("jpeg encode failed"))), "image/jpeg", quality);
  });
}

/** Draw `src` into `dst` fitted inside (letterboxed, aspect preserved). */
export function drawFitted(dst: HTMLCanvasElement, src: HTMLCanvasElement): { x: number; y: number; w: number; h: number } {
  const ctx = dst.getContext("2d")!;
  ctx.clearRect(0, 0, dst.width, dst.height);
  const s = Math.min(dst.width / src.width, dst.height / src.height);
  const w = src.width * s;
  const h = src.height * s;
  ctx.drawImage(src, (dst.width - w) / 2, (dst.height - h) / 2, w, h);
  return { x: (dst.width - w) / 2, y: (dst.height - h) / 2, w, h };
}

/** Load a File (image) into a canvas. */
export function fileToCanvas(file: File, maxSide = 2400): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}
