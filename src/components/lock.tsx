"use client";

/**
 * Dual-layer security: 4-digit PIN pad (Dad Mode) · drawable 3×3 pattern ·
 * strong password · Hindi security-question recovery.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Delete, Grid3X3, Hash, KeyRound, Loader2, ShieldQuestion, Vault } from "lucide-react";
import { useLanguage } from "./providers";

// ── PIN pad ───────────────────────────────────────────────────────────
export function PinPad({ onComplete, error, shakeKey, auto = true }: { onComplete: (pin: string) => void; error?: string | null; shakeKey?: number; auto?: boolean }) {
  const [pin, setPin] = useState("");
  useEffect(() => setPin(""), [shakeKey]);

  const press = (d: string) => {
    const next = (pin + d).slice(0, 4);
    setPin(next);
    if (auto && next.length === 4) setTimeout(() => onComplete(next), 120);
  };

  return (
    <div className="mx-auto w-full max-w-sm" aria-label="PIN">
      <motion.div
        key={shakeKey}
        initial={{ x: 0 }}
        animate={shakeKey ? { x: [0, -14, 14, -10, 10, 0] } : {}}
        className="mb-6 flex justify-center gap-4"
        aria-hidden
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-6 w-6 rounded-full border-[3px] transition-all duration-150 ${
              pin.length > i ? "scale-110 border-leaf bg-leaf" : "border-warm-border bg-paper"
            }`}
          />
        ))}
      </motion.div>
      {error && <p className="mb-4 text-center text-lg font-bold text-danger" role="alert">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : k === "del" ? (
            <button key={i} onClick={() => setPin((p) => p.slice(0, -1))} className="btn-ghost !min-h-[72px] !rounded-2xl" aria-label="⌫">
              <Delete className="h-8 w-8" aria-hidden />
            </button>
          ) : (
            <button
              key={i}
              onClick={() => press(k)}
              className="btn min-h-[72px] !rounded-2xl border-2 border-warm-border bg-paper text-3xl font-bold shadow-soft hover:border-saffron hover:bg-saffron-tint"
            >
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

// ── Pattern pad (3×3, draw-to-unlock) ─────────────────────────────────
const DOT_POS = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
  x: (i % 3) * 50,
  y: Math.floor(i / 3) * 50,
}));

export function PatternPad({ onComplete, error, shakeKey }: { onComplete: (pattern: string) => void; error?: string | null; shakeKey?: number }) {
  const [path, setPath] = useState<number[]>([]);
  const drawing = useRef(false);
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const dotFromEvent = (e: React.PointerEvent): number | null => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return null;
    const px = ((e.clientX - box.left) / box.width) * 100;
    const py = ((e.clientY - box.top) / box.height) * 100;
    let best: number | null = null;
    let bestD = 14;
    DOT_POS.forEach((p, i) => {
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };

  const addDot = (i: number | null) => {
    if (i === null) return;
    setPath((p) => (p.includes(i) ? p : [...p, i]));
  };

  const end = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    setCursor(null);
    if (path.length >= 4) onComplete(path.map((i) => i + 1).join("-"));
    setTimeout(() => setPath([]), 500);
  }, [path, onComplete]);

  useEffect(() => {
    const up = () => end();
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [end]);

  useEffect(() => setPath([]), [shakeKey]);

  const linePoints = path.map((i) => DOT_POS[i]);

  return (
    <div className="mx-auto w-full max-w-[300px]">
      {error && <p className="mb-4 text-center text-lg font-bold text-danger" role="alert">{error}</p>}
      <div
        ref={ref}
        className="relative aspect-square w-full touch-none select-none"
        onPointerDown={(e) => {
          drawing.current = true;
          setPath([]);
          addDot(dotFromEvent(e));
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          addDot(dotFromEvent(e));
          const box = ref.current?.getBoundingClientRect();
          if (box) setCursor({ x: ((e.clientX - box.left) / box.width) * 100, y: ((e.clientY - box.top) / box.height) * 100 });
        }}
      >
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          {linePoints.length > 1 && (
            <polyline
              points={linePoints.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none" className="stroke-leaf" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
            />
          )}
          {cursor && linePoints.length > 0 && (
            <line
              x1={linePoints[linePoints.length - 1].x} y1={linePoints[linePoints.length - 1].y}
              x2={cursor.x} y2={cursor.y}
              className="stroke-leaf/60" strokeWidth="2.2" strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3">
          {DOT_POS.map((_, i) => (
            <div key={i} className="flex items-center justify-center">
              <span
                className={`h-7 w-7 rounded-full border-[3px] transition-all duration-100 ${
                  path.includes(i) ? "scale-125 border-leaf bg-leaf shadow-soft" : "border-warm-border bg-paper"
                }`}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Full-screen gate ──────────────────────────────────────────────────
export type LockStatus = {
  locked: boolean;
  config: { pin: boolean; pattern: boolean; password: boolean; question: string | null; any: boolean; otp?: boolean; otpMobile?: string | null };
};

function OtpPad({ onComplete, error, shakeKey }: { onComplete: (code: string) => void; error?: string | null; shakeKey?: number }) {
  const [code, setCode] = useState("");
  useEffect(() => setCode(""), [shakeKey]);
  const press = (d: string) => {
    const next = (code + d).slice(0, 6);
    setCode(next);
    if (next.length === 6) setTimeout(() => onComplete(next), 120);
  };
  return (
    <div className="mx-auto w-full max-w-sm" aria-label="OTP">
      <motion.div key={shakeKey} animate={shakeKey ? { x: [0, -12, 12, -8, 8, 0] } : {}} className="mb-6 flex justify-center gap-3" aria-hidden>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-5 w-5 rounded-full border-[3px] transition-all ${code.length > i ? "scale-110 border-leaf bg-leaf" : "border-warm-border bg-paper"}`} />
        ))}
      </motion.div>
      {error && <p className="mb-4 text-center text-lg font-bold text-danger" role="alert">{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((k, i) =>
          k === "" ? (
            <span key={i} />
          ) : k === "del" ? (
            <button key={i} onClick={() => setCode((c) => c.slice(0, -1))} className="btn-ghost !min-h-[68px] !rounded-2xl" aria-label="backspace">
              <Delete className="h-8 w-8" aria-hidden />
            </button>
          ) : (
            <button key={i} onClick={() => press(k)} className="btn min-h-[68px] !rounded-2xl border-2 border-warm-border bg-paper text-3xl font-bold shadow-soft hover:border-saffron hover:bg-saffron-tint">
              {k}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function VaultGate({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [mode, setMode] = useState<"pin" | "pattern" | "password" | "recover" | "reset" | "otp">("pin");
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState("");
  const [password, setPassword] = useState("");
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/lock")
      .then((r) => r.json())
      .then((s: LockStatus) => {
        setStatus(s);
        setUnlocked(!s.locked);
        if (s.locked) setMode(s.config.pin ? "pin" : s.config.pattern ? "pattern" : "password");
      })
      .catch(() => setUnlocked(true));
  }, []);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    const res = await fetch("/api/lock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).finally(() => setBusy(false));
    return res.json();
  };

  const fail = (msg: string) => {
    setError(msg);
    setShake((k) => k + 1);
  };

  const verify = async (kind: "pin" | "pattern" | "password", value: string) => {
    const r = await post({ action: "verify", kind, value });
    if (r.ok) {
      setUnlocked(true);
      setError(null);
    } else if (r.otpRequired) {
      setError(null);
      setDevOtp(r.devOtp ?? null);
      setMode("otp");
    } else {
      fail(kind === "pin" ? t("lock_wrong_pin") : kind === "pattern" ? t("lock_wrong_pattern") : t("lock_wrong_password"));
    }
  };

  const verifyOtp = async (code: string) => {
    const r = await post({ action: "verify-otp", value: code });
    if (r.ok) {
      setUnlocked(true);
      setError(null);
    } else {
      fail(t("otp_wrong"));
    }
  };

  const doRecover = async () => {
    const r = await post({ action: "recover", answer });
    if (r.ok) {
      setError(null);
      setMode("reset");
    } else fail(t("lock_answer_wrong"));
  };

  const doReset = async (pin: string) => {
    const r = await post({ action: "reset", kind: "pin", value: pin });
    if (r.ok) setUnlocked(true);
    else fail(t("lock_wrong_pin"));
  };

  if (!status || unlocked) return <>{children}</>;

  const tabs: { key: "pin" | "pattern" | "password"; icon: typeof Hash; label: string }[] = [];
  if (status.config.pin) tabs.push({ key: "pin", icon: Hash, label: t("lock_pin") });
  if (status.config.pattern) tabs.push({ key: "pattern", icon: Grid3X3, label: t("lock_pattern") });
  if (status.config.password) tabs.push({ key: "password", icon: KeyRound, label: t("lock_password") });

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[radial-gradient(1200px_600px_at_50%_-10%,#efe3c4,transparent),var(--color-cream)]">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-4 py-10">
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 18 }}
          className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-leaf text-cream shadow-lift"
        >
          <Vault className="h-14 w-14" aria-hidden />
        </motion.div>
        <h1 className="font-display text-4xl font-bold">{t("lock_title")}</h1>
        <p className="mb-8 mt-2 text-xl text-ink-soft">{t("lock_sub")}</p>

        <div className="card w-full p-6 sm:p-8">
          {mode !== "recover" && mode !== "reset" && tabs.length > 1 && (
            <div className="mb-8 grid grid-cols-2 gap-2 rounded-2xl border-2 border-warm-border bg-cream p-2 sm:grid-cols-3">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => { setMode(tab.key); setError(null); }}
                  aria-pressed={mode === tab.key}
                  className={`flex min-h-[60px] cursor-pointer items-center justify-center gap-2 rounded-xl text-xl font-bold transition-all ${
                    mode === tab.key ? "bg-leaf text-white shadow-soft" : "text-ink-soft hover:bg-straw"
                  }`}
                >
                  <tab.icon className="h-6 w-6" aria-hidden /> {tab.label}
                </button>
              ))}
            </div>
          )}

          <AnimatePresence mode="wait">
            {mode === "pin" && (
              <motion.div key="pin" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <PinPad onComplete={(pin) => verify("pin", pin)} error={error} shakeKey={shake} />
              </motion.div>
            )}
            {mode === "pattern" && (
              <motion.div key="pattern" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="mb-4 text-center text-lg font-semibold text-ink-soft">{t("lock_draw_hint")}</p>
                <PatternPad onComplete={(p) => verify("pattern", p)} error={error} shakeKey={shake} />
              </motion.div>
            )}
            {mode === "password" && (
              <motion.div key="password" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {error && <p className="mb-4 text-center text-lg font-bold text-danger" role="alert">{error}</p>}
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && verify("password", password)}
                  className="mb-4 min-h-[64px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-2xl tracking-widest focus:border-saffron"
                  placeholder={t("lock_password")}
                  aria-label={t("lock_password")}
                />
                <button onClick={() => verify("password", password)} disabled={busy} className="btn-primary w-full !text-2xl">
                  {t("lock_open")}
                </button>
              </motion.div>
            )}
            {mode === "recover" && (
              <motion.div key="recover" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="mb-2 flex items-center gap-2 text-lg font-bold text-ink-soft">
                  <ShieldQuestion className="h-6 w-6 text-saffron-deep" aria-hidden /> {t("lock_question")}
                </p>
                <p className="mb-4 text-2xl font-bold">{status.config.question ?? t("set_question_ph")}</p>
                {error && <p className="mb-3 text-lg font-bold text-danger" role="alert">{error}</p>}
                <input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && doRecover()}
                  className="mb-4 min-h-[64px] w-full rounded-2xl border-2 border-warm-border bg-paper px-5 text-2xl focus:border-saffron"
                  placeholder={t("lock_answer_ph")}
                  aria-label={t("lock_answer_ph")}
                />
                <div className="flex gap-3">
                  <button onClick={doRecover} disabled={busy} className="btn-primary flex-1 !text-2xl">
                    {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : null} {t("lock_check_answer")}
                  </button>
                  <button onClick={() => { setMode(tabs[0]?.key ?? "pin"); setError(null); }} className="btn-ghost">
                    {t("docs_cancel")}
                  </button>
                </div>
              </motion.div>
            )}
            {mode === "reset" && (
              <motion.div key="reset" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="mb-6 text-center text-xl font-bold text-leaf-deep">{t("lock_reset_now")}</p>
                <PinPad onComplete={doReset} error={error} shakeKey={shake} />
              </motion.div>
            )}
            {mode === "otp" && (
              <motion.div key="otp" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="mb-2 text-center font-display text-2xl font-bold">{t("otp_title")}</p>
                <p className="mb-6 text-center text-lg text-ink-soft">{t("otp_sent_to", { n: status.config.otpMobile ?? "" })}</p>
                {devOtp && (
                  <p className="mb-4 rounded-xl bg-straw px-4 py-2 text-center font-mono text-2xl tracking-[0.3em] text-ink" aria-label="dev otp">
                    {devOtp}
                  </p>
                )}
                <OtpPad onComplete={verifyOtp} error={error} shakeKey={shake} />
              </motion.div>
            )}
          </AnimatePresence>

          {mode !== "recover" && mode !== "reset" && status.config.question && (
            <button onClick={() => { setMode("recover"); setError(null); }} className="mx-auto mt-8 block min-h-[56px] cursor-pointer px-6 text-xl font-bold text-saffron-deep underline underline-offset-4">
              {t("lock_forgot")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
