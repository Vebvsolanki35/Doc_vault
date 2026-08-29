"use client";

/** Settings panels: language, security (PIN/pattern/password + question),
 *  OTP 2FA with Hindi voice-guided setup, backup, self-healing. */
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  DatabaseBackup, Grid3X3, Hash, HeartPulse, KeyRound, Languages, Loader2, PhoneCall, ShieldCheck, ShieldQuestion, Square, Volume2,
} from "lucide-react";
import { useLanguage, toast } from "./providers";
import { LanguageToggle } from "./widgets";
import { PatternPad, PinPad } from "./lock";

function Panel({ icon: Icon, title, sub, children, tone = "paper" }: { icon: typeof Hash; title: string; sub?: string; children: React.ReactNode; tone?: "paper" | "tint" }) {
  return (
    <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className={`card p-6 sm:p-8 ${tone === "tint" ? "bg-saffron-tint" : ""}`}>
      <div className="mb-5 flex items-start gap-4">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-leaf-tint text-leaf-deep">
          <Icon className="h-8 w-8" aria-hidden />
        </span>
        <div>
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{title}</h2>
          {sub && <p className="mt-1 text-lg text-ink-soft">{sub}</p>}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

async function lockPost(payload: Record<string, unknown>) {
  const res = await fetch("/api/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return res.ok;
}

export function LanguagePanel() {
  const { t } = useLanguage();
  return (
    <Panel icon={Languages} title={t("set_language")}>
      <LanguageToggle />
    </Panel>
  );
}

// ── Hindi voice guide (TTS walkthrough of the lock setup) ─────────────
const GUIDE_HI = [
  "नमस्ते! मैं आपकी तिजोरी में ताला लगाने में मदद करूँगा।",
  "पहला कदम — नीचे बड़े बटन में से 'PIN बनाएँ' दबाइए।",
  "अब अपनी मनपसंद चार संख्याएँ दबाइए — जैसे अपनी जन्मतिथि।",
  "फिर अपना सुरक्षा सवाल और जवाब लिख दीजिए, ताकि PIN भूलने पर भी तिजोरी खुल सके।",
  "बस! आपकी तिजोरी अब सुरक्षित है। धन्यवाद।",
];
const GUIDE_EN = [
  "Hello! I will help you lock your vault.",
  "Step one — press the big 'Set PIN' button below.",
  "Now tap your favourite four numbers — like your birth date.",
  "Then write your security question and answer, so the vault can open even if you forget the PIN.",
  "Done! Your vault is now safe. Thank you.",
];

export function VoiceGuideButton() {
  const { t, lang } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const idxRef = useRef(0);

  const stop = () => {
    window.speechSynthesis?.cancel();
    setPlaying(false);
  };

  const play = () => {
    if (!("speechSynthesis" in window)) return;
    if (playing) { stop(); return; }
    const lines = lang === "hi" ? GUIDE_HI : GUIDE_EN;
    idxRef.current = 0;
    setPlaying(true);
    const speakNext = () => {
      if (idxRef.current >= lines.length) { setPlaying(false); return; }
      const u = new SpeechSynthesisUtterance(lines[idxRef.current]);
      u.lang = lang === "hi" ? "hi-IN" : "en-IN";
      const voice = window.speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang === "hi" ? "hi" : "en"));
      if (voice) u.voice = voice;
      u.rate = 0.92;
      u.onend = () => { idxRef.current++; speakNext(); };
      u.onerror = () => setPlaying(false);
      window.speechSynthesis.speak(u);
    };
    window.speechSynthesis.cancel();
    speakNext();
  };

  return (
    <button onClick={play} className="btn-ghost w-full !text-xl sm:w-auto" aria-pressed={playing}>
      {playing ? <Square className="h-6 w-6 text-danger" aria-hidden /> : <Volume2 className="h-6 w-6 text-leaf-deep" aria-hidden />}
      {t("set_voiceguide")}
    </button>
  );
}

// ── Security panel ────────────────────────────────────────────────────
export type LockConfigPanel = { pin: boolean; pattern: boolean; password: boolean; question: string | null; any: boolean; otp?: boolean; otpMobile?: string | null };

export function SecurityPanel({ config, onChanged }: { config: LockConfigPanel; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = useState<"none" | "pin" | "pattern" | "password">("none");
  const [password, setPassword] = useState("");
  const [question, setQuestion] = useState("आपकी पहली कार कौन सी थी?");
  const [answer, setAnswer] = useState("");
  const [shake, setShake] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [otpMobile, setOtpMobile] = useState(config.otpMobile?.replace(/•/g, "") ?? "");
  const [otpEnabled, setOtpEnabled] = useState(!!config.otp);

  const save = async (kind: "pin" | "pattern" | "password", value: string) => {
    setBusy(true);
    const ok = await lockPost({
      action: "setup", kind, value,
      question: question.trim() || undefined,
      answer: answer.trim() || undefined,
    }).finally(() => setBusy(false));
    if (ok) {
      toast(kind === "pin" ? t("set_pin_saved") : kind === "pattern" ? t("set_pattern_saved") : t("set_password_saved"));
      setOpen("none");
      setPassword("");
      setError(null);
      onChanged();
    } else {
      setError(t("error_generic"));
      setShake((k) => k + 1);
    }
  };

  const saveOtp = async (enable: boolean) => {
    const mobile = otpMobile.replace(/\D/g, "");
    const res = await fetch("/api/lock", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "otp-config", enable, mobile }),
    });
    const json = await res.json();
    setOtpEnabled(!!json.enabled);
    toast(t("set_otp_saved"));
    onChanged();
  };

  return (
    <Panel icon={ShieldCheck} title={t("set_security")} sub={config.any ? t("set_pin_set") : t("set_pin_none")}>
      {!config.any && <p className="mb-5 text-xl font-bold text-saffron-deep">{t("lock_setup_hint")}</p>}

      <div className="mb-5"><VoiceGuideButton key={lang} /></div>

      {open === "none" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <button onClick={() => setOpen("pin")} className="btn-primary"><Hash className="h-6 w-6" aria-hidden /> {t("set_pin_new")}</button>
          <button onClick={() => setOpen("pattern")} className="btn-ghost"><Grid3X3 className="h-6 w-6" aria-hidden /> {t("set_pattern_new")}</button>
          <button onClick={() => setOpen("password")} className="btn-ghost"><KeyRound className="h-6 w-6" aria-hidden /> {t("set_password_new")}</button>
        </div>
      )}

      {open !== "none" && (
        <div className="rounded-2xl border-2 border-warm-border bg-cream p-5">
          {error && <p className="mb-3 text-lg font-bold text-danger" role="alert">{error}</p>}
          {open === "pin" && (
            <>
              <p className="mb-4 text-center text-xl font-bold">{t("set_pin_enter_new")}</p>
              <PinPad onComplete={(pin) => save("pin", pin)} shakeKey={shake} />
            </>
          )}
          {open === "pattern" && (
            <>
              <p className="mb-4 text-center text-xl font-bold">{t("lock_draw_hint")}</p>
              <PatternPad onComplete={(p) => save("pattern", p)} shakeKey={shake} />
            </>
          )}
          {open === "password" && (
            <div className="mx-auto max-w-md">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("set_password_ph")} aria-label={t("set_password_ph")}
                className="mb-4 min-h-[64px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-2xl" />
              <button onClick={() => save("password", password)} disabled={busy} className="btn-primary w-full !text-2xl">
                {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : null} {t("set_save")}
              </button>
            </div>
          )}

          <div className="mx-auto mt-8 max-w-xl border-t-2 border-dashed border-warm-border pt-6">
            <p className="mb-3 flex items-center gap-2 text-lg font-bold"><ShieldQuestion className="h-6 w-6 text-saffron-deep" aria-hidden /> {t("set_question")}</p>
            <input value={question} onChange={(e) => setQuestion(e.target.value)} className="mb-3 min-h-[60px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-xl" aria-label={t("set_question")} />
            <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t("set_answer")} aria-label={t("set_answer")} className="min-h-[60px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-xl" />
          </div>

          <button onClick={() => setOpen("none")} className="btn-ghost mt-6 w-full">{t("docs_cancel")}</button>
        </div>
      )}

      {/* OTP 2FA */}
      <div className="mt-6 border-t-2 border-dashed border-warm-border pt-6">
        <div className="flex items-start gap-3">
          <PhoneCall className="mt-1 h-7 w-7 shrink-0 text-saffron-deep" aria-hidden />
          <div className="flex-1">
            <p className="text-xl font-bold">{t("set_otp")}</p>
            <p className="mt-1 text-base text-ink-soft">{t("set_otp_sub")}</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={otpMobile}
                onChange={(e) => setOtpMobile(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                placeholder={t("set_otp_mobile")}
                inputMode="numeric"
                aria-label={t("set_otp_mobile")}
                className="min-h-[60px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-2xl tracking-widest sm:max-w-xs"
              />
              <button
                onClick={() => saveOtp(!otpEnabled)}
                disabled={!otpEnabled && otpMobile.replace(/\D/g, "").length !== 10}
                className={otpEnabled ? "btn-danger" : "btn-primary"}
              >
                {otpEnabled ? t("set_otp_disable") : t("set_otp_enable")}
              </button>
            </div>
            {otpEnabled && <p className="mt-2 text-base font-bold text-leaf-deep">OTP: {t("yes")}</p>}
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function BackupPanel({ lastBackupAt, due, onChanged }: { lastBackupAt: string | null; due: boolean; onChanged: () => void }) {
  const { t, lang } = useLanguage();
  const [busy, setBusy] = useState(false);

  const runBackup = async () => {
    setBusy(true);
    const a = document.createElement("a");
    a.href = "/api/backup";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      setBusy(false);
      toast(t("set_backup_ready"));
      onChanged();
    }, 1800);
  };

  return (
    <Panel icon={DatabaseBackup} title={t("set_backup")} sub={t("set_backup_sub")} tone={due ? "tint" : "paper"}>
      {due && <p className="mb-4 text-xl font-bold text-saffron-deep" role="alert">{t("set_backup_due")}</p>}
      <button onClick={runBackup} disabled={busy} className="btn-accent w-full !text-2xl sm:w-auto">
        {busy ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <DatabaseBackup className="h-7 w-7" aria-hidden />}
        {t("set_backup_now")}
      </button>
      <p className="mt-4 text-lg text-ink-soft">
        {lastBackupAt
          ? t("set_backup_last", { d: new Date(lastBackupAt).toLocaleDateString(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric" }) })
          : t("set_backup_never")}
      </p>
    </Panel>
  );
}

export function IntegrityPanel() {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ checked: number; restored: string[]; broken: string[] } | null>(null);

  const run = async () => {
    setBusy(true);
    const res = await fetch("/api/integrity", { method: "POST" });
    if (res.ok) {
      const json = await res.json();
      setResult(json);
      if (json.restored.length > 0) toast(t("set_integrity_fixed", { n: json.restored.length }));
      else if (json.broken.length === 0) toast(t("set_integrity_ok", { n: json.checked }));
      else toast(t("error_generic"), "warn");
    }
    setBusy(false);
  };

  return (
    <Panel icon={HeartPulse} title={t("set_integrity")} sub={t("set_integrity_sub")}>
      <button onClick={run} disabled={busy} className="btn-primary !text-2xl">
        {busy ? <Loader2 className="h-7 w-7 animate-spin" aria-hidden /> : <HeartPulse className="h-7 w-7" aria-hidden />}
        {t("set_integrity_run")}
      </button>
      {result && (
        <p className="mt-4 text-xl font-bold text-leaf-deep">
          {result.restored.length > 0 ? t("set_integrity_fixed", { n: result.restored.length }) : t("set_integrity_ok", { n: result.checked })}
        </p>
      )}
    </Panel>
  );
}
