"use client";

/**
 * Document card + EXACT-SIZE download modal + QR share modal (with expiry).
 * The download modal has two modes:
 *   1. Quality mode  — Small / Medium / Very Clear presets
 *   2. Size mode     — type/slide a target (e.g. 500 KB) for government portals,
 *                      with live byte-accurate estimate before downloading.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import QRCode from "qrcode";
import {
  BadgeCheck, Check, Download, FileText, Gauge, Hourglass, Loader2, Printer, QrCode, Ruler, Trash2, X,
} from "lucide-react";
import { useLanguage, toast } from "./providers";
import { FolderIcon, FOLDER_LABEL_KEY, FOLDER_STYLE, Modal, ReadAloudButton, SmartTags, MemberAvatar, type MemberLite } from "./widgets";
import { formatBytes, toDevanagariDigits } from "@/lib/numbers";

export type DocMeta = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  category: string;
  tags: Record<string, string | number> | null;
  createdAt: string;
  shareToken: string | null;
  sharePasscode: string | null;
  memberId: string | null;
  folderId: string | null;
  deletedAt: string | null;
  shareExpiresAt: string | null;
};

export function isImageDoc(mime: string) {
  return /^image\//.test(mime);
}

export function fileUrl(doc: Pick<DocMeta, "id">, extra = "") {
  return `/api/documents/${doc.id}/file${extra}`;
}

function downloadViaBrowser(url: string, name?: string) {
  const a = document.createElement("a");
  a.href = url;
  if (name) a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// ── Size formatting for the target slider ─────────────────────────────
const KB = 1024, MB = 1024 * 1024;
function sizeSteps(): number[] {
  // Friendly steps: 50,100,150,200 … 950 KB, then 1,1.5,2 … 10 MB
  const steps: number[] = [];
  for (let k = 50; k < 1000; k += 50) steps.push(k * KB);
  for (let m = 1; m <= 10; m += m < 2 ? 0.5 : 1) steps.push(Math.round(m * MB));
  return steps;
}
const STEPS = sizeSteps();

export function DownloadModal({ doc, onClose }: { doc: DocMeta | null; onClose: () => void }) {
  const { t, lang } = useLanguage();
  const [mode, setMode] = useState<"quality" | "size">("size");
  const [quality, setQuality] = useState<"low" | "medium" | "high">("medium");
  const [format, setFormat] = useState<"original" | "jpg" | "png" | "pdf">("original");
  const [stepIdx, setStepIdx] = useState(0);
  const [estimate, setEstimate] = useState<{ actualBytes: number; perfect: boolean; floorReached: boolean; passthrough?: boolean } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetBytes = STEPS[Math.max(0, Math.min(stepIdx, STEPS.length - 1))];
  const recommended = doc ? Math.max(30 * KB, Math.round(doc.size * 0.8)) : 500 * KB;

  // Snap slider to a value
  const snapTo = useCallback((bytes: number) => {
    let best = 0;
    let dist = Infinity;
    STEPS.forEach((s, i) => {
      const d = Math.abs(s - bytes);
      if (d < dist) { dist = d; best = i; }
    });
    setStepIdx(best);
  }, []);

  useEffect(() => {
    if (!doc) return;
    setEstimate(null);
    setMode("size");
    setQuality("medium");
    setFormat("original");
    snapTo(Math.min(recommended, doc.size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id]);

  // Live estimate when in size mode
  useEffect(() => {
    if (!doc || mode !== "size") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setEstimating(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}/sized`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetBytes, format, estimate: true }),
        });
        if (res.ok) setEstimate(await res.json());
      } catch { /* keep last estimate */ }
      setEstimating(false);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [doc, mode, targetBytes, format]);

  if (!doc) return null;
  const img = isImageDoc(doc.mimeType);
  const formats: { key: typeof format; label: string }[] = img
    ? [
        { key: "original", label: t("dl_original") },
        { key: "jpg", label: "JPG" },
        { key: "png", label: "PNG" },
        { key: "pdf", label: "PDF" },
      ]
    : [{ key: "original", label: t("dl_original") }, ...(doc.mimeType === "application/pdf" ? [] : [])];

  const startDownload = async () => {
    setDownloading(true);
    try {
      if (mode === "quality") {
        const qm = format === "original" ? "raw" : format;
        downloadViaBrowser(`${fileUrl(doc)}?mode=${qm}&quality=${quality}&download=1`);
      } else {
        const res = await fetch(`/api/documents/${doc.id}/sized`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetBytes, format, estimate: false }),
        });
        if (!res.ok) throw new Error();
        const blob = await res.blob();
        const cd = res.headers.get("Content-Disposition") ?? "";
        const m = cd.match(/filename\*=UTF-8''([^;]+)/);
        const url = URL.createObjectURL(blob);
        downloadViaBrowser(url, m ? decodeURIComponent(m[1]) : doc.name);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      toast(t("ok"));
      onClose();
    } catch {
      toast(t("error_generic"), "warn");
    }
    setDownloading(false);
  };

  const fmtSize = (n: number) =>
    lang === "hi" ? toDevanagariDigits(formatBytes(n)) : formatBytes(n);

  return (
    <Modal open={!!doc} onClose={onClose} title={t("dl_title")}>
      <p className="mb-2 truncate text-xl font-semibold text-ink-soft">{doc.name}</p>
      <p className="mb-5 text-lg text-ink-soft">
        {t("dl_original_size")}: <b className="text-ink">{fmtSize(doc.size)}</b>
      </p>

      {/* Mode switch: Quality vs Exact size */}
      <div className="mb-6 grid grid-cols-2 gap-2 rounded-2xl border-2 border-warm-border bg-cream p-2" role="tablist">
        <button
          role="tab"
          aria-selected={mode === "quality"}
          onClick={() => setMode("quality")}
          className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-xl text-xl font-bold transition-all ${
            mode === "quality" ? "bg-leaf text-white shadow-soft" : "hover:bg-straw"
          }`}
        >
          <Gauge className="h-6 w-6" aria-hidden /> {t("dl_quality_mode")}
        </button>
        <button
          role="tab"
          aria-selected={mode === "size"}
          onClick={() => setMode("size")}
          className={`flex min-h-[64px] cursor-pointer items-center justify-center gap-2 rounded-xl text-xl font-bold transition-all ${
            mode === "size" ? "bg-saffron text-white shadow-soft" : "hover:bg-straw"
          }`}
        >
          <Ruler className="h-6 w-6" aria-hidden /> {t("dl_size_mode")}
        </button>
      </div>

      {mode === "size" && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-lg font-bold">{t("dl_target")}</p>
            <button onClick={() => snapTo(recommended)} className="chip min-h-[48px] cursor-pointer !bg-saffron-tint !text-saffron-deep hover:!bg-straw text-base">
              <BadgeCheck className="h-5 w-5" aria-hidden /> {t("dl_recommended")} — {fmtSize(recommended)}
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={STEPS.length - 1}
            value={stepIdx}
            onChange={(e) => setStepIdx(parseInt(e.target.value, 10))}
            className="h-12 w-full cursor-pointer accent-[#d96a00]"
            aria-label={t("dl_target")}
          />
          <div className="flex items-center justify-between text-lg font-bold">
            <span className="text-ink-soft">50 KB</span>
            <motion.span key={targetBytes} initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="rounded-2xl bg-saffron px-5 py-2 font-display text-2xl text-white shadow-soft">
              {fmtSize(targetBytes)}
            </motion.span>
            <span className="text-ink-soft">10 MB</span>
          </div>
          <p className="mt-1 text-base text-ink-soft">{t("dl_exact_size_sub")}</p>

          {/* Live estimate */}
          <div aria-live="polite" className={`mt-4 flex min-h-[76px] items-center justify-center gap-3 rounded-2xl border-2 px-4 py-3 text-center ${
            estimate?.floorReached ? "border-saffron bg-saffron-tint" : "border-leaf bg-leaf-tint"
          }`}>
            {estimating && (
              <>
                <Loader2 className="h-6 w-6 animate-spin text-saffron" aria-hidden />
                <span className="text-lg font-bold text-ink-soft">{t("dl_estimating")}</span>
              </>
            )}
            {!estimating && estimate && (
              <>
                {estimate.floorReached ? (
                  <Hourglass className="h-7 w-7 shrink-0 text-saffron-deep" aria-hidden />
                ) : (
                  <BadgeCheck className="h-7 w-7 shrink-0 text-leaf-deep" aria-hidden />
                )}
                <span className={`text-xl font-bold ${estimate.floorReached ? "text-saffron-deep" : "text-leaf-deep"}`}>
                  {estimate.passthrough
                    ? `${t("dl_will_be")} ${fmtSize(doc.size)} — ${t("dl_size_perfect")}`
                    : `${t("dl_will_be")} ${t("dl_approx")} ${fmtSize(estimate.actualBytes)}${estimate.perfect ? ` — ${t("dl_size_perfect")}` : ""}`}
                  {estimate.floorReached && <span className="block text-base">{t("dl_cant_reach", { n: fmtSize(estimate.actualBytes) })}</span>}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {mode === "quality" && (
        <div className="mb-6">
          <div className="mb-2 grid grid-cols-3 gap-2 rounded-2xl border-2 border-warm-border bg-cream p-2" role="radiogroup" aria-label={t("dl_quality")}>
            {(["low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                role="radio"
                aria-checked={quality === q}
                onClick={() => setQuality(q)}
                className={`flex min-h-[72px] cursor-pointer flex-col items-center justify-center rounded-xl px-2 py-2 text-center transition-all ${
                  quality === q ? "bg-leaf text-white shadow-soft" : "bg-paper text-ink hover:bg-straw"
                }`}
              >
                <span className="text-xl font-bold">{t(q === "low" ? "dl_low" : q === "medium" ? "dl_medium" : "dl_high")}</span>
              </button>
            ))}
          </div>
          <p className="flex items-center gap-2 text-base text-ink-soft">
            <Printer className="h-5 w-5" aria-hidden />
            {(q => q === "low" ? "300 × 300" : q === "medium" ? "800 × 800" : "2000 × 2000 · 300 DPI")(quality)} — {t(quality === "low" ? "dl_note_low" : quality === "medium" ? "dl_note_medium" : "dl_note_high")}
          </p>
        </div>
      )}

      <p className="mb-3 text-lg font-bold">{t("dl_format")}</p>
      <div className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label={t("dl_format")}>
        {formats.map((f) => (
          <button
            key={f.key}
            role="radio"
            aria-checked={format === f.key}
            onClick={() => { setFormat(f.key); setEstimate(null); }}
            className={`flex min-h-[60px] cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-xl font-bold transition-all ${
              format === f.key ? "border-saffron bg-saffron-tint text-saffron-deep" : "border-warm-border bg-paper hover:bg-straw"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <button onClick={startDownload} disabled={downloading} className="btn-primary w-full !text-2xl">
        {downloading ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <Download className="h-7 w-7" aria-hidden />}
        {t("dl_button")}
      </button>
    </Modal>
  );
}

// ── QR share modal (now with expiry) ──────────────────────────────────
export function ShareQrModal({ doc, onClose, members = [] }: { doc: DocMeta | null; onClose: () => void; members?: MemberLite[] }) {
  const { t, lang } = useLanguage();
  const [expiry, setExpiry] = useState<"forever" | "24h" | "7d">("forever");
  const [qr, setQr] = useState<string | null>(null);
  const [passcode, setPasscode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setQr(null);
    setPasscode(null);
    if (!doc) return;
    (async () => {
      setBusy(true);
      const hours = expiry === "24h" ? 24 : expiry === "7d" ? 24 * 7 : null;
      const res = await fetch(`/api/documents/${doc.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiresInHours: hours }),
      });
      if (res.ok) {
        const { token, passcode } = (await res.json()) as { token: string; passcode: string };
        const dataUrl = await QRCode.toDataURL(`${location.origin}/share/${token}`, {
          width: 440, margin: 2, color: { dark: "#0f4023", light: "#fffdf7" },
        });
        setQr(dataUrl);
        setPasscode(passcode);
      }
      setBusy(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?.id, expiry]);

  return (
    <Modal open={!!doc} onClose={onClose} title={t("share_title")}>
      <p className="mb-4 text-lg text-ink-soft">{t("share_hint")}</p>
      <div className="mb-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("share_expiry")}>
        {(["forever", "24h", "7d"] as const).map((e) => (
          <button
            key={e}
            role="radio"
            aria-checked={expiry === e}
            onClick={() => setExpiry(e)}
            className={`flex min-h-[56px] cursor-pointer items-center justify-center rounded-xl border-2 text-lg font-bold transition-all ${
              expiry === e ? "border-saffron bg-saffron-tint text-saffron-deep" : "border-warm-border bg-paper hover:bg-straw"
            }`}
          >
            {t(e === "forever" ? "share_exp_forever" : e === "24h" ? "share_exp_24h" : "share_exp_7d")}
          </button>
        ))}
      </div>
      <div className="flex flex-col items-center">
        <div className="flex min-h-[280px] w-full items-center justify-center">
          {busy && <Loader2 className="h-10 w-10 animate-spin text-saffron" aria-hidden />}
          {qr && (
            <motion.img initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} src={qr} alt="QR"
              className="h-auto w-full max-w-[280px] rounded-3xl border-4 border-warm-border bg-paper p-3 shadow-soft" />
          )}
        </div>
        {passcode && (
          <div className="mt-4 text-center">
            <p className="text-lg font-bold text-ink-soft">{t("share_passcode")}</p>
            <p className="font-display text-6xl font-bold tracking-[0.35em] text-leaf-deep" aria-live="polite">
              {lang === "hi" ? toDevanagariDigits(passcode) : passcode}
            </p>
          </div>
        )}
      </div>
      <button onClick={onClose} className="btn-ghost mt-8 w-full">{t("share_close")}</button>
    </Modal>
  );
}

// ── One document row ──────────────────────────────────────────────────
export function DocumentCard({
  doc,
  members = [],
  selectMode,
  selected,
  onToggleSelect,
  onChanged,
  binMode = false,
}: {
  doc: DocMeta;
  members?: MemberLite[];
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onChanged: () => void;
  binMode?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [dlOpen, setDlOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const style = FOLDER_STYLE[doc.category] ?? FOLDER_STYLE.other;
  const member = members.find((m) => m.id === doc.memberId);
  const date = useMemo(
    () => new Date(doc.createdAt).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", year: "numeric" }),
    [doc.createdAt, lang],
  );
  const memberName = member ? (lang === "hi" ? member.nameHi : member.nameEn) : "";
  const speakText = `${doc.name}. ${t(FOLDER_LABEL_KEY[doc.category] ?? "cat_other")}. ${memberName}. ${date}`;

  const doDelete = async () => {
    const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (res.ok) { toast(t("docs_deleted")); onChanged(); }
    else toast(t("error_generic"), "warn");
  };
  const doRestore = async () => {
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "restore" }),
    });
    if (res.ok) { toast(t("bin_restored")); onChanged(); }
  };
  const doPurge = async () => {
    const res = await fetch(`/api/documents/${doc.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "purge" }),
    });
    if (res.ok) { toast(t("bin_purged")); onChanged(); }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={`card flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5 ${selected ? "!border-saffron ring-4 ring-saffron/30" : ""}`}
    >
      <div className="flex items-center gap-4">
        {selectMode && (
          <button
            onClick={() => onToggleSelect(doc.id)}
            aria-pressed={selected}
            aria-label={doc.name}
            className={`flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 transition-all ${
              selected ? "border-saffron bg-saffron text-white" : "border-warm-border bg-paper"
            }`}
          >
            {selected && <Check className="h-7 w-7" aria-hidden />}
          </button>
        )}
        <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl bg-straw">
          {isImageDoc(doc.mimeType) && !binMode ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fileUrl(doc)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className={`flex h-full w-full items-center justify-center ${style.bg}`}>
              <FolderIcon folder={doc.category} className={`h-9 w-9 ${style.fg}`} />
            </div>
          )}
          {member && (
            <span className="absolute -bottom-1 -right-1">
              <MemberAvatar member={member} size="sm" />
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="break-words text-xl font-bold leading-snug">{doc.name}</h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-base text-ink-soft">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold ${style.bg} ${style.fg}`}>
            <FolderIcon folder={doc.category} className="h-4 w-4" />
            {t(FOLDER_LABEL_KEY[doc.category] ?? "cat_other")}
          </span>
          {memberName && <span className="font-semibold text-ink">{memberName}</span>}
          <span>{date}</span>
          <span>·</span>
          <span>{formatBytes(doc.size)}</span>
        </p>
        <SmartTags tags={doc.tags} compact />
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        {binMode ? (
          <>
            <button onClick={doRestore} className="btn-primary !min-h-[60px] !px-5 !text-lg">{t("bin_restore")}</button>
            <button onClick={doPurge} className="btn-icon" aria-label={t("docs_delete")} title={t("docs_delete")}>
              <Trash2 className="h-7 w-7 text-danger" aria-hidden />
            </button>
          </>
        ) : confirmDel ? (
          <>
            <button onClick={doDelete} className="btn-danger !min-h-[60px] !px-5 !text-lg" aria-label={t("yes")}>
              <Trash2 className="h-6 w-6" aria-hidden /> {t("yes")}
            </button>
            <button onClick={() => setConfirmDel(false)} className="btn-icon" aria-label={t("no")}>
              <X className="h-6 w-6" aria-hidden />
            </button>
          </>
        ) : (
          <>
            <ReadAloudButton text={speakText} label={t("read_aloud")} />
            <button onClick={() => setDlOpen(true)} className="btn-icon" aria-label={t("dl_title")} title={t("dl_title")}>
              <Download className="h-7 w-7 text-leaf-deep" aria-hidden />
            </button>
            <button onClick={() => setQrOpen(true)} className="btn-icon" aria-label={t("share_title")} title={t("share_title")}>
              <QrCode className="h-7 w-7 text-saffron-deep" aria-hidden />
            </button>
            <button onClick={() => setConfirmDel(true)} className="btn-icon" aria-label={t("docs_delete_ask")} title={t("docs_delete_ask")}>
              <Trash2 className="h-7 w-7 text-danger" aria-hidden />
            </button>
          </>
        )}
      </div>

      <DownloadModal doc={dlOpen ? doc : null} onClose={() => setDlOpen(false)} />
      <ShareQrModal doc={qrOpen ? doc : null} onClose={() => setQrOpen(false)} members={members} />
    </motion.article>
  );
}

export function PdfBadge() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-danger-tint text-danger">
      <FileText className="h-8 w-8" aria-hidden />
      <span className="text-xs font-bold">PDF</span>
    </div>
  );
}
