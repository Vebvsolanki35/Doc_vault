"use client";

/** Shared UI atoms for the vault — every piece obeys the 60px senior rule. */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft, BadgeIndianRupee, FileText, FolderOpen, Globe, GraduationCap, Heart, IdCard, Landmark, Lock,
  ShieldCheck, Tractor, User, Vault, Volume2, Square, X,
} from "lucide-react";
import { useLanguage } from "./providers";
import { FOLDER_KEYS, type FolderKey } from "@/lib/classifier";
import { dualNumber, formatBytes, toDevanagariDigits } from "@/lib/numbers";
import type { DictKey } from "@/lib/i18n";

// ── Folder meta ───────────────────────────────────────────────────────
export const FOLDER_LABEL_KEY: Record<string, DictKey> = {
  education: "cat_education",
  id: "cat_id",
  marksheet: "cat_marksheet",
  land: "cat_land",
  other: "cat_other",
  custom: "cat_other",
};

export const FOLDER_STYLE: Record<string, { icon: typeof Landmark; bg: string; fg: string }> = {
  education: { icon: GraduationCap, bg: "bg-[#e8e4f5]", fg: "text-[#3d3673]" },
  id: { icon: IdCard, bg: "bg-saffron-tint", fg: "text-saffron-deep" },
  marksheet: { icon: BadgeIndianRupee, bg: "bg-[#e0ecfa]", fg: "text-[#1d4e77]" },
  land: { icon: Landmark, bg: "bg-leaf-tint", fg: "text-leaf-deep" },
  other: { icon: FileText, bg: "bg-straw", fg: "text-ink-soft" },
  custom: { icon: FolderOpen, bg: "bg-straw", fg: "text-ink-soft" },
};

export function FolderIcon({ folder, className = "h-7 w-7" }: { folder: string; className?: string }) {
  const key = FOLDER_KEYS.includes(folder as FolderKey) ? folder : "other";
  const Icon = FOLDER_STYLE[key].icon;
  return <Icon className={className} aria-hidden />;
}

// ── Member avatars ────────────────────────────────────────────────────
export const MEMBER_THEMES: Record<string, { icon: typeof User; bg: string; fg: string; ring: string }> = {
  papa: { icon: Tractor, bg: "bg-leaf", fg: "text-white", ring: "ring-leaf" },
  mummy: { icon: Heart, bg: "bg-saffron", fg: "text-white", ring: "ring-saffron" },
  me: { icon: User, bg: "bg-[#3d3673]", fg: "text-white", ring: "ring-[#3d3673]" },
};

export type MemberLite = { id: string; key: string; nameEn: string; nameHi: string; icon: string; color: string };

export function MemberAvatar({ member, size = "md" }: { member: MemberLite | { key: string }; size?: "sm" | "md" | "lg" }) {
  const theme = MEMBER_THEMES[member.key] ?? MEMBER_THEMES.me;
  const Icon = theme.icon;
  const dims = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-10 w-10" : "h-14 w-14";
  const iconDims = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-5 w-5" : "h-7 w-7";
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full ${dims} ${theme.bg} ${theme.fg} shadow-soft`} aria-hidden>
      <Icon className={iconDims} />
    </span>
  );
}

export function memberDisplayName(m: { nameEn: string; nameHi: string }, lang: "en" | "hi") {
  return lang === "hi" ? m.nameHi : m.nameEn;
}

// ── Language toggle (ENORMOUS, always top-right) ──────────────────────
export function LanguageToggle() {
  const { lang, setLang, t } = useLanguage();
  return (
    <div role="group" aria-label={t("choose_language")} className="flex items-center rounded-2xl border-2 border-warm-border bg-paper p-1.5 shadow-soft">
      <Globe className="mx-2 h-7 w-7 text-saffron-deep" aria-hidden />
      {(["en", "hi"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          className={`min-h-[56px] min-w-[92px] cursor-pointer rounded-xl px-4 text-2xl font-bold transition-all duration-200 ${
            lang === l ? "bg-leaf text-white shadow-soft" : "text-ink-soft hover:bg-straw"
          }`}
        >
          {l === "en" ? "English" : "हिंदी"}
        </button>
      ))}
    </div>
  );
}

// ── Top bar ───────────────────────────────────────────────────────────
export function TopBar({ locked }: { locked: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const lockNow = async () => {
    await fetch("/api/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    router.refresh();
    location.reload();
  };
  return (
    <header className="sticky top-0 z-40 border-b border-warm-border bg-cream/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-[84px] max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="group flex items-center gap-3" aria-label={t("app_name")}>
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf text-cream shadow-soft transition-transform group-hover:-rotate-6">
            <Vault className="h-8 w-8" aria-hidden />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-2xl font-bold tracking-tight">{t("app_name")}</span>
            <span className="block text-base text-ink-soft">{t("app_tagline")}</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          {locked && (
            <button onClick={lockNow} className="btn-icon" aria-label={t("logout")} title={t("logout")}>
              <Lock className="h-7 w-7" aria-hidden />
            </button>
          )}
          <LanguageToggle />
        </div>
      </div>
    </header>
  );
}

// ── Back bar ──────────────────────────────────────────────────────────
export function BackBar({ title, href = "/" }: { title: string; href?: string }) {
  const { t } = useLanguage();
  return (
    <div className="mb-6 flex items-center gap-4">
      <Link href={href} className="btn-ghost !min-h-[60px]" aria-label={t("back")}>
        <ArrowLeft className="h-7 w-7" aria-hidden />
        {t("back")}
      </Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
    </div>
  );
}

// ── Storage gauge ─────────────────────────────────────────────────────
export function StorageGauge({ used, total }: { used: number; total: number }) {
  const { t, lang } = useLanguage();
  const free = Math.max(0, total - used);
  const pct = Math.min(1, used / total);
  const R = 66;
  const C = 2 * Math.PI * R;
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-[160px] w-[160px] shrink-0">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label={`${formatBytes(free)} ${t("storage_left")}`}>
          <circle cx="80" cy="80" r={R} fill="none" strokeWidth="18" className="stroke-straw" />
          <motion.circle
            cx="80" cy="80" r={R} fill="none" strokeWidth="18" strokeLinecap="round"
            className="stroke-saffron"
            initial={{ strokeDashoffset: C }}
            animate={{ strokeDashoffset: C * (1 - pct) }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
            strokeDasharray={C}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-2xl font-bold leading-none">{toDevanagariDigits(Math.round(pct * 100))}%</span>
          <span className="mt-1 text-sm font-semibold text-ink-soft">{t("storage_used")}</span>
        </div>
      </div>
      <div>
        <p className="font-display text-3xl font-bold leading-tight sm:text-4xl">
          {lang === "hi" ? toDevanagariDigits(formatBytes(free)) : formatBytes(free)}
        </p>
        <p className="text-xl font-semibold text-leaf-deep">{t("storage_left")}</p>
        <p className="mt-1 text-lg text-ink-soft">{t("storage_you_have", { n: formatBytes(free) })}</p>
      </div>
    </div>
  );
}

// ── Read Aloud ────────────────────────────────────────────────────────
export function ReadAloudButton({ text, label }: { text: string; label: string }) {
  const { lang } = useLanguage();
  const [speaking, setSpeaking] = useState(false);
  const speak = useCallback(() => {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const target = lang === "hi" ? "hi" : "en";
    u.lang = lang === "hi" ? "hi-IN" : "en-IN";
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(target));
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }, [text, lang, speaking]);
  return (
    <button onClick={speak} className="btn-icon" aria-label={label} title={label}>
      {speaking ? <Square className="h-6 w-6 text-danger" aria-hidden /> : <Volume2 className="h-7 w-7 text-leaf-deep" aria-hidden />}
    </button>
  );
}

// ── Smart tags row ────────────────────────────────────────────────────
export function SmartTags({ tags, compact = false }: { tags?: Record<string, string | number> | null; compact?: boolean }) {
  const { t, lang } = useLanguage();
  if (!tags) return null;
  const items: { key: DictKey; value: string }[] = [];
  if (tags.cardNo) items.push({ key: "tag_card", value: `${tags.cardType ? tags.cardType + " " : ""}${tags.cardNo}` });
  if (tags.percentage) items.push({ key: "tag_percent", value: String(tags.percentage) });
  if (tags.owner) items.push({ key: "tag_owner", value: String(tags.owner) });
  if (tags.person && !tags.owner) items.push({ key: "tag_person", value: String(tags.person) });
  if (tags.surveyNo) items.push({ key: "tag_survey", value: String(tags.surveyNo) });
  if (tags.area) {
    const n = parseFloat(String(tags.area).replace(",", "."));
    items.push({
      key: "tag_area",
      value: Number.isFinite(n) ? `${dualNumber(n, lang)} ${tags.areaUnit ?? ""}` : `${tags.area} ${tags.areaUnit ?? ""}`,
    });
  }
  if (tags.expiry) items.push({ key: "tag_expiry", value: String(tags.expiry) });
  if (tags.year && !tags.percentage) items.push({ key: "tag_year", value: String(tags.year) });
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "mt-2" : "mt-3"}`}>
      {items.map((it, i) => (
        <span key={i} className={`chip !bg-leaf-tint !text-leaf-deep ${compact ? "!px-3 !py-1 !text-sm" : ""}`}>
          <ShieldCheck className="h-4 w-4" aria-hidden />
          <b>{t(it.key)}:</b> {it.value}
        </span>
      ))}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/55 p-0 sm:items-center sm:p-6"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ y: 80, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 80, scale: 0.98, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="card max-h-[92vh] w-full max-w-2xl overflow-y-auto !rounded-b-none p-6 sm:!rounded-[1.75rem] sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
              <button onClick={onClose} className="btn-icon" aria-label={title}>
                <X className="h-7 w-7" aria-hidden />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Page entrance ─────────────────────────────────────────────────────
export function PageIn({ children }: { children: ReactNode }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10"
    >
      {children}
    </motion.main>
  );
}
