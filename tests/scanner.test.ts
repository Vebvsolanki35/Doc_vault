import { describe, expect, it } from "vitest";
import { detectDocumentGray, type Pt } from "../src/lib/scan/quad";
import { enhanceAlloc, type ScanMode } from "../src/lib/scan/enhance";
import { affineFrom, rectifySize } from "../src/lib/scan/canvas";

/**
 * Build a synthetic photo: gray desk, a rotated white sheet of paper with
 * dark "text" lines — exactly the shape the phone camera delivers.
 */
function makeScene(w: number, h: number, angleDeg: number, rect: { x: number; y: number; w: number; h: number }, noise = 0) {
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = w / 2, cy = h / 2;
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // to paper-local coords
      const dx = x - cx, dy = y - cy;
      const lx = dx * cos + dy * sin + cx;
      const ly = -dx * sin + dy * cos + cy;
      const inRect = lx >= rect.x && lx <= rect.x + rect.w && ly >= rect.y && ly <= rect.y + rect.h;
      const inText = inRect && Math.floor(ly - rect.y) % 42 < 7 && lx > rect.x + 30 && lx < rect.x + rect.w - 30;
      const v = inText ? 55 : inRect ? 242 : 128;
      const n = noise ? Math.floor((Math.random() - 0.5) * 2 * noise) : 0;
      const val = Math.max(0, Math.min(255, v + n));
      const o = (y * w + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = val;
      data[o + 3] = 255;
    }
  }
  return { data, corners: trueCorners(w, h, angleDeg, rect) };
}

/**
 * Ground-truth corners, INDEPENDENT of the detector: each paper corner is
 * rotated by hand and keeps its semantic label (TL→TL, TR→TR, …).
 * NOTE: the rotation here mirrors makeScene's convention (x' = dx·cos + dy·sin).
 */
function trueCorners(w: number, h: number, angleDeg: number, rect: { x: number; y: number; w: number; h: number }): Pt[] {
  const cx = w / 2, cy = h / 2;
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  // makeScene maps scene→local as (dx·cos + dy·sin, −dx·sin + dy·cos),
  // so local→scene (what we need) is its transpose:
  const rot = ([lx, ly]: Pt): Pt => {
    const dx = lx - cx, dy = ly - cy;
    return [dx * cos - dy * sin + cx, dx * sin + dy * cos + cy];
  };
  return [
    rot([rect.x, rect.y]),               // TL
    rot([rect.x + rect.w, rect.y]),      // TR
    rot([rect.x + rect.w, rect.y + rect.h]), // BR
    rot([rect.x, rect.y + rect.h]),      // BL
  ];
}

const grayOf = (data: Uint8ClampedArray, w: number, h: number) => {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  return g;
};

describe("document quad detection", () => {
  it("finds a portrait paper tilted +8°", () => {
    const { data, corners } = makeScene(640, 480, 8, { x: 90, y: 60, w: 460, h: 360 });
    const res = detectDocumentGray(grayOf(data, 640, 480), 640, 480);
    expect(res).not.toBeNull();
    expect(res!.fill).toBeGreaterThan(0.3);
    expect(res!.fill).toBeLessThan(0.85);
    expect(res!.aspect).toBeGreaterThan(0.9);
    expect(res!.aspect).toBeLessThan(1.7);
    for (let i = 0; i < 4; i++) {
      const [gx, gy] = res!.quad[i];
      const [tx, ty] = corners[i];
      expect(Math.hypot(gx - tx, gy - ty), `corner ${i}`).toBeLessThan(20);
    }
  });

  it("finds a landscape paper tilted -12°", () => {
    const { data, corners } = makeScene(640, 480, -12, { x: 70, y: 120, w: 500, h: 240 });
    const res = detectDocumentGray(grayOf(data, 640, 480), 640, 480);
    expect(res).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const [gx, gy] = res!.quad[i];
      const [tx, ty] = corners[i];
      expect(Math.hypot(gx - tx, gy - ty), `corner ${i}`).toBeLessThan(22);
    }
  });

  it("handles a small tilted ID card on a busy background", () => {
    const { data, corners } = makeScene(320, 240, 5, { x: 60, y: 50, w: 200, h: 130 }, 6);
    const res = detectDocumentGray(grayOf(data, 320, 240), 320, 240, { minFill: 0.1 });
    expect(res).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      const [gx, gy] = res!.quad[i];
      const [tx, ty] = corners[i];
      expect(Math.hypot(gx - tx, gy - ty), `corner ${i}`).toBeLessThan(14);
    }
  });

  it("rejects an empty desk (no document)", () => {
    const w = 320, h = 240;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = 128 + Math.floor((Math.random() - 0.5) * 10);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const res = detectDocumentGray(grayOf(data, w, h), w, h);
    expect(res).toBeNull();
  });

  it("rejects a tiny scrap of paper (below min fill)", () => {
    const { data } = makeScene(640, 480, 0, { x: 290, y: 210, w: 60, h: 60 });
    const res = detectDocumentGray(grayOf(data, 640, 480), 640, 480);
    expect(res).toBeNull();
  });
});

// ── Enhancement ───────────────────────────────────────────────────────
function makeDocImage(w: number, h: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inText = y > 40 && y < 60 && x > 20 && x < w - 20;
      // slightly warm paper, dark ink
      const o = (y * w + x) * 4;
      data[o] = inText ? 70 : 214;
      data[o + 1] = inText ? 66 : 205;
      data[o + 2] = inText ? 60 : 190;
      data[o + 3] = 255;
    }
  }
  return data;
}

const meanOf = (data: Uint8ClampedArray, pred: (i: number) => boolean) => {
  let s = 0, n = 0;
  for (let i = 0; i < data.length / 4; i++) if (pred(i)) { s += data[i * 4]; n++; }
  return n ? s / n : -1;
};

describe("scan enhancement", () => {
  it("Auto Clean brightens the paper and keeps ink dark", () => {
    const w = 200, h = 150;
    const src = makeDocImage(w, h);
    const out = enhanceAlloc(src, w, h, "clean");
    const inInk = (i: number) => { const y = (i / w) | 0, x = i % w; return y > 40 && y < 60 && x > 20 && x < w - 20; };
    const paper = meanOf(out, (i) => ((i / w) | 0) < 35); // top strip = pure paper (no ink)
    const ink = meanOf(src, inInk);
    const inkOut = meanOf(out, inInk);
    expect(paper).toBeGreaterThan(235); // paper should read white
    expect(inkOut).toBeLessThan(ink); // ink pushed darker (contrast)
    expect(inkOut).toBeLessThan(120);
  });

  it("B&W produces near-pure black/white", () => {
    const w = 200, h = 150;
    const src = makeDocImage(w, h);
    const out = enhanceAlloc(src, w, h, "bw");
    let extremes = 0, total = 0;
    for (let i = 0; i < out.length; i += 4) {
      const v = out[i];
      total++;
      if (v < 40 || v > 215) extremes++;
    }
    expect(extremes / total).toBeGreaterThan(0.95);
  });

  it("Original is a byte-for-byte copy", () => {
    const w = 60, h = 40;
    const src = makeDocImage(w, h);
    const out = enhanceAlloc(src, w, h, "original");
    expect(Buffer.from(out).equals(Buffer.from(src))).toBe(true);
  });

  it("Sepia warms the image", () => {
    const w = 200, h = 150;
    const src = makeDocImage(w, h);
    const out = enhanceAlloc(src, w, h, "sepia");
    let r = 0, b = 0;
    for (let i = 0; i < w * h; i++) { r += out[i * 4]; b += out[i * 4 + 2]; }
    expect(r / (w * h)).toBeGreaterThan(b / (w * h));
  });
});

describe("rectification math", () => {
  it("affineFrom maps three points exactly", () => {
    // a 30×20 rect scaled to 60×40 with a 10px offset
    const m = affineFrom([0, 0], [30, 0], [30, 20], [10, 5], [70, 5], [70, 45]);
    const apply = (x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    expect(apply(0, 0)).toEqual([10, 5]);
    expect(apply(30, 0)).toEqual([70, 5]);
    expect(apply(30, 20)).toEqual([70, 45]);
    // interior point: the map is affine, so midpoints land mid
    expect(apply(15, 10)[0]).toBeCloseTo(40, 5);
    expect(apply(15, 10)[1]).toBeCloseTo(25, 5);
  });

  it("affineFrom gives identity for the same triangle", () => {
    const m = affineFrom([0, 0], [100, 0], [100, 100], [0, 0], [100, 0], [100, 100]);
    expect(m).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("rectifySize preserves the paper aspect ratio", () => {
    const quad: [Pt, Pt, Pt, Pt] = [
      [0, 0], [1000, 0], [1000, 700], [0, 700],
    ];
    const { w, h } = rectifySize(1000, 700, quad, 1600);
    expect(w).toBe(1600);
    expect(h).toBe(1120);
  });
});
