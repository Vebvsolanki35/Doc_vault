"use client";

/**
 * PAPER SCANNER — Adobe-Scan style, 100% on-device:
 *
 *   idle → camera (live edge-detection frame) → capture
 *        → adjust (drag corners, pick a finish) → use page
 *        → pages (multi-page, reorder) → Save to Vault
 *
 *   The finished result is one clean JPEG (1 page) or one multi-page PDF
 *   (2+ pages), handed to the normal upload flow so SmartScan can still
 *   read it, suggest a name, and file it under the right person.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera, Check, ChevronDown, ChevronUp, ImagePlus, Loader2, Plus, RotateCcw, Save, ScanText, Trash2, Wand2, X,
} from "lucide-react";
import { useLanguage, toast } from "@/components/providers";
import { BackBar, PageIn } from "@/components/widgets";
import { detectDocumentGray, grayFromFrame, type Quad, type Pt } from "@/lib/scan/quad";
import { enhanceAlloc, SCAN_MODES, type ScanMode } from "@/lib/scan/enhance";
import {
  canvasToJpegBlob, drawFitted, drawQuadOverlay, fileToCanvas, fullFrameQuad, grabFrame, rectify,
} from "@/lib/scan/canvas";
import { scanFileName, stageScanFiles } from "@/lib/scan/handoff";

type T = ReturnType<typeof useLanguage>["t"];

type ScanPageItem = {
  id: string;
  raw: HTMLCanvasElement; // rectified original (unenhanced), ~1600px wide
  mode: ScanMode;
  thumb: string; // small jpeg dataURL of the finished look
};

const RECTIFY_W = 1600;
const MAX_PAGES = 8;

/** Apply the chosen finish to a page's raw rectified canvas. */
function finishCanvas(p: ScanPageItem): HTMLCanvasElement {
  if (p.mode === "original") return p.raw;
  const ctx = p.raw.getContext("2d")!;
  const img = ctx.getImageData(0, 0, p.raw.width, p.raw.height);
  const out = enhanceAlloc(img.data, p.raw.width, p.raw.height, p.mode);
  const c = document.createElement("canvas");
  c.width = p.raw.width;
  c.height = p.raw.height;
  c.getContext("2d")!.putImageData(new ImageData(out, c.width, c.height), 0, 0);
  return c;
}

export default function ScanPage() {
  const { t, lang } = useLanguage();
  const router = useRouter();

  const [stage, setStage] = useState<"idle" | "camera" | "adjust" | "pages">("idle");
  const [camError, setCamError] = useState(false);
  const [current, setCurrent] = useState<{ source: HTMLCanvasElement; quad: Quad; auto: boolean } | null>(null);
  const [mode, setMode] = useState<ScanMode>("clean");
  const [pages, setPages] = useState<ScanPageItem[]>([]);
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const exitAll = useCallback(() => {
    setStage("idle");
    setCurrent(null);
  }, []);

  const onCaptured = useCallback((frame: HTMLCanvasElement, quad: Quad, auto: boolean) => {
    setCurrent({ source: frame, quad, auto });
    setStage("adjust");
  }, []);

  /** "Scan a photo file" — detect edges in the photo, then the same adjust step. */
  const scanPhoto = useCallback(async (file: File) => {
    try {
      const canvas = await fileToCanvas(file, 2400);
      let quad: Quad = fullFrameQuad(canvas.width, canvas.height, 0.015);
      let auto = false;
      try {
        const { gray, w, h, scale } = grayFromFrame(canvas, 480);
        const res = detectDocumentGray(gray, w, h, { minFill: 0.1 });
        if (res) {
          quad = res.quad.map(([x, y]) => [x / scale, y / scale]) as Quad;
          auto = true;
        }
      } catch { /* fall back to the full frame */ }
      setCurrent({ source: canvas, quad, auto });
      setStage("adjust");
    } catch {
      toast(t("error_generic"), "warn");
    }
  }, [t]);

  const keepPage = useCallback((raw: HTMLCanvasElement, m: ScanMode, thumb: string) => {
    setPages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, raw, mode: m, thumb }]);
    setCurrent(null);
    setStage("pages");
  }, []);

  const movePage = (i: number, dir: -1 | 1) => {
    setPages((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const saveToVault = useCallback(async () => {
    if (!pages.length || busy) return;
    setBusy(true);
    try {
      let file: File;
      if (pages.length === 1) {
        const c = finishCanvas(pages[0]);
        const blob = await canvasToJpegBlob(c, 0.92);
        file = new File([blob], scanFileName("jpg"), { type: "image/jpeg" });
      } else {
        const { PDFDocument } = await import("pdf-lib");
        const pdf = await PDFDocument.create();
        pdf.setTitle("Smart Tijori scan");
        for (const p of pages) {
          const c = finishCanvas(p);
          const blob = await canvasToJpegBlob(c, 0.9);
          const img = await pdf.embedJpg(await blob.arrayBuffer());
          const pw = c.width * 0.48; // 150 dpi → real-world paper size
          const ph = c.height * 0.48;
          const page = pdf.addPage([pw, ph]);
          page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
        }
        const bytes = await pdf.save();
        file = new File([new Uint8Array(bytes)], scanFileName("pdf"), { type: "application/pdf" });
      }
      stageScanFiles([file]);
      toast(t("scan_done"));
      setStage("idle");
      setPages([]);
      router.push("/upload");
    } catch {
      toast(t("error_generic"), "warn");
      setBusy(false);
    }
  }, [pages, busy, router, t]);

  return (
    <PageIn>
      {stage === "idle" && (
        <>
          <BackBar title={t("scan_title")} />
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card mx-auto max-w-2xl p-8 text-center sm:p-12">
            <motion.div
              animate={{ y: [0, -12, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="mx-auto mb-7 flex h-28 w-28 items-center justify-center rounded-[2.5rem] bg-saffron text-white shadow-lift"
            >
              <ScanText className="h-16 w-16" aria-hidden />
            </motion.div>
            <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("scan_title")}</h2>
            <p className="mx-auto mt-3 max-w-md text-xl leading-relaxed text-ink-soft">{t("scan_sub")}</p>
            {camError && <p className="mt-4 rounded-2xl bg-saffron-tint px-5 py-3 text-lg font-bold text-saffron-deep">{t("scan_no_camera")}</p>}
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button onClick={() => { setCamError(false); setStage("camera"); }} className="btn-accent w-full !text-2xl sm:w-auto">
                <Camera className="h-8 w-8" aria-hidden /> {t("scan_open")}
              </button>
              <button onClick={() => photoRef.current?.click()} className="btn-ghost w-full !text-xl sm:w-auto">
                <ImagePlus className="h-7 w-7" aria-hidden /> {t("scan_choose_photo")}
              </button>
            </div>
            <p className="mt-5 text-base font-semibold text-ink-soft">{t("scan_open_sub")}</p>
            <input ref={photoRef} type="file" accept="image/*" className="hidden" aria-hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void scanPhoto(f); e.target.value = ""; }} />
          </motion.div>
        </>
      )}

      {stage === "camera" && (
        <CameraView
          onCapture={onCaptured}
          onExit={exitAll}
          onCamError={() => { setCamError(true); setStage("idle"); }}
          t={t}
        />
      )}

      {stage === "adjust" && current && (
        <AdjustView
          source={current.source}
          initialQuad={current.quad}
          auto={current.auto}
          mode={mode}
          setMode={setMode}
          onUse={(raw, thumb) => keepPage(raw, mode, thumb)}
          onRetake={() => { setCurrent(null); setStage("camera"); }}
          onExit={exitAll}
          t={t}
          lang={lang}
        />
      )}

      {stage === "pages" && (
        <div className="mx-auto max-w-3xl">
          <div className="mb-6 flex items-center gap-4">
            <button onClick={() => setStage("idle")} className="btn-ghost !min-h-[60px]" aria-label={t("back")}>
              <X className="h-7 w-7" aria-hidden />
            </button>
            <div>
              <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("scan_pages_title")}</h1>
              <p className="mt-1 text-lg text-ink-soft">{t("scan_pages_sub", { n: pages.length })}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <AnimatePresence>
              {pages.map((p, i) => (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="card overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt={`${t("scan_page")} ${i + 1}`} className="aspect-[3/4] w-full bg-straw object-contain" />
                  <div className="flex items-center gap-1 p-3">
                    <span className="flex-1 text-lg font-bold">{t("scan_page")} {i + 1}</span>
                    <button onClick={() => movePage(i, -1)} disabled={i === 0} className="btn-icon !h-11 !w-11 disabled:opacity-30" aria-label={t("scan_move_up")}>
                      <ChevronUp className="h-6 w-6" aria-hidden />
                    </button>
                    <button onClick={() => movePage(i, 1)} disabled={i === pages.length - 1} className="btn-icon !h-11 !w-11 disabled:opacity-30" aria-label={t("scan_move_down")}>
                      <ChevronDown className="h-6 w-6" aria-hidden />
                    </button>
                    <button onClick={() => setPages((prev) => prev.filter((x) => x.id !== p.id))} className="btn-icon !h-11 !w-11 text-danger" aria-label={t("scan_remove")}>
                      <Trash2 className="h-6 w-6" aria-hidden />
                    </button>
                  </div>
                </motion.div>
              ))}
              {pages.length < MAX_PAGES && (
                <motion.button
                  key="add"
                  layout
                  onClick={() => setStage("camera")}
                  className="card flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-3 !border-4 !border-dashed !border-warm-border text-ink-soft transition-colors hover:!border-saffron hover:text-saffron-deep"
                >
                  <Plus className="h-12 w-12" aria-hidden />
                  <span className="px-4 text-lg font-bold">{t("scan_add_page")}</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <div className="mt-7 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <button onClick={() => setStage("idle")} className="btn-ghost !text-xl">
              <X className="h-7 w-7" aria-hidden /> {t("no")}
            </button>
            <button onClick={saveToVault} disabled={busy || !pages.length} className="btn-primary w-full !text-2xl sm:w-auto">
              {busy ? <Loader2 className="h-8 w-8 animate-spin" aria-hidden /> : <Save className="h-8 w-8" aria-hidden />}
              {busy ? t("scan_preparing") : t("scan_save_vault")}
            </button>
          </div>
        </div>
      )}
    </PageIn>
  );
}

// ── Camera stage ──────────────────────────────────────────────────────
function CameraView({ onCapture, onExit, onCamError, t }: {
  onCapture: (frame: HTMLCanvasElement, quad: Quad, auto: boolean) => void;
  onExit: () => void;
  onCamError: () => void;
  t: T;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fitRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const quadRef = useRef<Quad | null>(null);
  const [state, setState] = useState<"starting" | "on" | "error">("starting");
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (!alive) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        if (alive) setState("on");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, []);

  // If the camera never comes up, go back to the idle card with a note.
  useEffect(() => {
    if (state === "error") {
      const tm = setTimeout(onCamError, 400);
      return () => clearTimeout(tm);
    }
  }, [state, onCamError]);

  // Keep the overlay canvas matched to the visible box (letterbox math).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const ov = overlayRef.current;
      if (!ov) return;
      ov.width = Math.max(1, wrap.clientWidth);
      ov.height = Math.max(1, wrap.clientHeight);
      const v = videoRef.current;
      if (v?.videoWidth) {
        const s = Math.min(ov.width / v.videoWidth, ov.height / v.videoHeight);
        const w = v.videoWidth * s;
        const h = v.videoHeight * s;
        fitRef.current = { x: (ov.width - w) / 2, y: (ov.height - h) / 2, w, h };
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Live document detection → overlay frame.
  useEffect(() => {
    if (state !== "on") return;
    const iv = setInterval(() => {
      const v = videoRef.current;
      const ov = overlayRef.current;
      if (!v?.videoWidth || !ov || !fitRef.current) return;
      try {
        const { gray, w, h, scale } = grayFromFrame(v, 320);
        const res = detectDocumentGray(gray, w, h, { minFill: 0.16 });
        quadRef.current = res ? (res.quad.map(([x, y]) => [x / scale, y / scale]) as Quad) : null;
        setDetected(!!res);
      } catch { /* skip a bad frame */ }
      drawQuadOverlay(ov, fitRef.current, v.videoWidth, v.videoHeight, quadRef.current, !!quadRef.current);
    }, 320);
    return () => clearInterval(iv);
  }, [state]);

  const capture = () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    const frame = grabFrame(v);
    let quad: Quad = fullFrameQuad(frame.width, frame.height, 0.02);
    let auto = false;
    try {
      const { gray, w, h, scale } = grayFromFrame(v, 480);
      const res = detectDocumentGray(gray, w, h, { minFill: 0.14 });
      if (res) {
        quad = res.quad.map(([x, y]) => [x / scale, y / scale]) as Quad;
        auto = true;
      }
    } catch { /* keep the full frame */ }
    onCapture(frame, quad, auto);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-4">
        <button onClick={onExit} className="btn-ghost !min-h-[60px]" aria-label={t("back")}>
          <X className="h-7 w-7" aria-hidden />
        </button>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("scan_title")}</h1>
      </div>

      <div ref={wrapRef} className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-[2rem] border-4 border-ink bg-ink shadow-lift">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 h-full w-full object-contain" />
        <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
        {state === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center gap-3 text-2xl font-bold text-cream">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden /> {t("loading")}
          </div>
        )}
      </div>

      <div className="mt-5 text-center">
        <p className={`mb-5 text-xl font-bold ${detected ? "text-leaf-deep" : "text-saffron-deep"}`} aria-live="polite">
          {state !== "on" ? t("scan_detecting") : detected ? t("scan_ready") : t("scan_hint_frame")}
        </p>
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={capture}
          disabled={state !== "on"}
          className="mx-auto flex h-28 w-28 items-center justify-center rounded-full border-8 border-white bg-saffron text-white shadow-lift transition-colors hover:bg-saffron-deep disabled:opacity-40"
          aria-label={t("scan_capture")}
        >
          <Camera className="h-14 w-14" aria-hidden />
        </motion.button>
        <p className="mt-3 text-lg font-bold text-ink-soft">{t("scan_capture")}</p>
      </div>
    </div>
  );
}

// ── Adjust stage (drag corners + pick finish) ─────────────────────────
function AdjustView({ source, initialQuad, auto, mode, setMode, onUse, onRetake, onExit, t, lang }: {
  source: HTMLCanvasElement;
  initialQuad: Quad;
  auto: boolean;
  mode: ScanMode;
  setMode: (m: ScanMode) => void;
  onUse: (raw: HTMLCanvasElement, thumb: string) => void;
  onRetake: () => void;
  onExit: () => void;
  t: T;
  lang: "en" | "hi";
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // source + draggable corners
  const previewRef = useRef<HTMLCanvasElement>(null); // straightened + finished
  const [quad, setQuad] = useState<Quad>(initialQuad);
  const quadRef = useRef<Quad>(initialQuad);
  const fittedRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const rawRef = useRef<HTMLCanvasElement | null>(null); // last rectified (unenhanced)
  const dragRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const enhanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  void quad; // state kept for React re-renders; quadRef is the source of truth

  /** Rectify with the current quad; enhance only when asked (drag = fast). */
  const render = useCallback((enhance: boolean) => {
    const rc = rectify(source, quadRef.current, RECTIFY_W);
    rawRef.current = rc;
    const rctx = rc.getContext("2d")!;
    if (enhance && mode !== "original") {
      const img = rctx.getImageData(0, 0, rc.width, rc.height);
      const out = enhanceAlloc(img.data, rc.width, rc.height, mode);
      rctx.putImageData(new ImageData(out, rc.width, rc.height), 0, 0);
    }
    const pv = previewRef.current;
    if (pv) drawFitted(pv, rc);
  }, [source, mode]);

  const scheduleRender = useCallback((enhance: boolean) => {
    if (enhanceTimerRef.current) clearTimeout(enhanceTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (!enhance) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        try { render(false); } catch { /* frame too small */ }
      });
      return;
    }
    enhanceTimerRef.current = setTimeout(() => {
      enhanceTimerRef.current = null;
      try { render(true); } catch { /* noop */ }
    }, 120);
  }, [render]);

  const drawOverlay = useCallback(() => {
    const ov = overlayRef.current;
    if (!ov || !ov.width) return;
    const fit = drawFitted(ov, source);
    fittedRef.current = fit;
    const ctx = ov.getContext("2d")!;
    const s = fit.w / source.width;
    const P = (pt: Pt): [number, number] => [fit.x + pt[0] * s, fit.y + pt[1] * s];
    const [p0, p1, p2, p3] = quadRef.current.map(P);
    // dim outside the paper
    ctx.beginPath();
    ctx.rect(0, 0, ov.width, ov.height);
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
    ctx.fillStyle = "rgba(10, 14, 12, 0.4)";
    ctx.fill("evenodd");
    // the frame
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
    ctx.strokeStyle = "#d96a00";
    ctx.lineWidth = 4;
    ctx.stroke();
    // corner handles
    for (const p of [p0, p1, p2, p3]) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], 17, 0, Math.PI * 2);
      ctx.fillStyle = "#d96a00";
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = "#fffdf7";
      ctx.stroke();
    }
  }, [source]);

  // Initial draw + re-fit on resize.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const size = () => {
      const ov = overlayRef.current;
      const pv = previewRef.current;
      if (!ov || !pv) return;
      const w = Math.max(1, wrap.clientWidth);
      ov.width = w;
      ov.height = Math.round(w * (source.height / source.width));
      pv.width = w;
      pv.height = Math.round(w * (source.height / source.width));
      drawOverlay();
      scheduleRender(true);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (enhanceTimerRef.current) clearTimeout(enhanceTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-apply the finish when the mode changes (no re-rectify needed).
  useEffect(() => {
    if (rawRef.current) scheduleRender(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const cornerAt = (px: number, py: number): number | null => {
    const ov = overlayRef.current;
    const fit = fittedRef.current;
    if (!ov || !fit) return null;
    const s = fit.w / source.width;
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = quadRef.current[i];
      const dx = fit.x + cx * s - px;
      const dy = fit.y + cy * s - py;
      if (Math.hypot(dx, dy) < 34) return i;
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ov = overlayRef.current;
    if (!ov) return;
    const r = ov.getBoundingClientRect();
    const i = cornerAt(e.clientX - r.left, e.clientY - r.top);
    if (i === null) return;
    dragRef.current = i;
    ov.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current === null) return;
    const ov = overlayRef.current;
    const fit = fittedRef.current;
    if (!ov || !fit) return;
    const r = ov.getBoundingClientRect();
    const s = fit.w / source.width;
    const nx = Math.min(source.width, Math.max(0, (e.clientX - r.left - fit.x) / s));
    const ny = Math.min(source.height, Math.max(0, (e.clientY - r.top - fit.y) / s));
    const q = quadRef.current.slice() as Quad;
    q[dragRef.current] = [nx, ny];
    quadRef.current = q;
    setQuad(q);
    drawOverlay();
    scheduleRender(false); // fast while dragging; full finish on release
  };
  const onPointerUp = () => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    scheduleRender(true);
  };

  const keepThisPage = () => {
    const raw = rawRef.current;
    if (!raw) return;
    const c = finishCanvas({ id: "tmp", raw, mode, thumb: "" });
    const tw = 360;
    const th = Math.max(1, Math.round((c.height / c.width) * tw));
    const tc = document.createElement("canvas");
    tc.width = tw;
    tc.height = th;
    tc.getContext("2d")!.drawImage(c, 0, 0, tw, th);
    onUse(raw, tc.toDataURL("image/jpeg", 0.72));
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <button onClick={onExit} className="btn-ghost !min-h-[60px]" aria-label={t("back")}>
          <X className="h-7 w-7" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{t("scan_adjust_title")}</h1>
          <p className="mt-1 text-lg text-ink-soft">{auto ? t("scan_adjust_sub") : t("scan_manual_hint")}</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-lg font-bold text-ink-soft">{t("scan_adjust_sub")}</p>
          <div ref={wrapRef} className="w-full">
            <canvas
              ref={overlayRef}
              className="w-full cursor-grab touch-none rounded-2xl border-4 border-warm-border shadow-soft active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
          </div>
        </div>
        <div>
          <p className="mb-2 flex items-center gap-2 text-lg font-bold text-ink-soft">
            <Wand2 className="h-6 w-6 text-saffron-deep" aria-hidden /> {t("scan_finish")}
          </p>
          <canvas ref={previewRef} className="w-full rounded-2xl border-4 border-leaf/40 bg-straw shadow-soft" />
        </div>
      </div>

      {/* Finish modes */}
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label={t("scan_finish")}>
        {SCAN_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => setMode(m.key)}
            aria-pressed={mode === m.key}
            className={`min-h-[56px] cursor-pointer rounded-2xl border-2 px-5 text-xl font-bold transition-all ${
              mode === m.key ? "border-leaf bg-leaf text-white shadow-soft" : "border-warm-border bg-paper text-ink-soft hover:bg-straw"
            }`}
          >
            {lang === "hi" ? m.hi : m.en}
          </button>
        ))}
      </div>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
        <button onClick={onRetake} className="btn-ghost !text-xl">
          <RotateCcw className="h-7 w-7" aria-hidden /> {t("scan_retake")}
        </button>
        <button onClick={keepThisPage} className="btn-primary !text-2xl">
          <Check className="h-8 w-8" aria-hidden /> {t("scan_use_page")}
        </button>
      </div>
    </div>
  );
}
