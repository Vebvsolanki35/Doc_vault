"use client";

/**
 * App-wide providers: bilingual language state (persisted), toasts,
 * offline banner state and PWA service-worker registration.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, AlertTriangle, WifiOff } from "lucide-react";
import { translate, type DictKey, type Lang } from "@/lib/i18n";

type LangCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LangCtx | null>(null);

export function useLanguage(): LangCtx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage outside provider");
  return ctx;
}

// ── Tiny evented toast system ─────────────────────────────────────────
type Toast = { id: number; msg: string; kind: "ok" | "warn" };
let pushToast: ((msg: string, kind?: Toast["kind"]) => void) | null = null;
export function toast(msg: string, kind: Toast["kind"] = "ok") {
  pushToast?.(msg, kind);
}

export function Providers({ children }: { children: ReactNode }) {
  // Dad first: Hindi is the DEFAULT language.
  const [lang, setLangState] = useState<Lang>("hi");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const saved = (localStorage.getItem("vault_lang") as Lang | null) ?? "hi";
    setLangState(saved);
    document.documentElement.lang = saved;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    // PWA — register the offline vault worker
    if ("serviceWorker" in navigator && location.protocol !== "http:") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else if ("serviceWorker" in navigator && location.hostname !== "0.0.0.0") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    pushToast = (msg, kind = "ok") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-2), { id, msg, kind }]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4200);
    };
    return () => {
      pushToast = null;
    };
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem("vault_lang", l);
    document.documentElement.lang = l;
  }, []);

  const t = useCallback((key: DictKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  const { t: tt } = value;

  return (
    <LanguageContext.Provider value={value}>
      {children}

      {/* Offline banner — vault keeps working, uploads queue up */}
      <AnimatePresence>
        {!online && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            role="status"
            className="fixed inset-x-4 bottom-4 z-[90] mx-auto flex max-w-xl items-center gap-3 rounded-2xl bg-ink px-6 py-4 text-lg font-semibold text-cream shadow-lift"
          >
            <WifiOff className="h-7 w-7 shrink-0" aria-hidden />
            {tt("offline_banner")}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toasts — massive, high contrast, bilingual */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-4 z-[95] flex flex-col items-center gap-2 px-4">
        <AnimatePresence>
          {toasts.map((x) => (
            <motion.div
              key={x.id}
              initial={{ y: -40, opacity: 0, scale: 0.95 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -30, opacity: 0, scale: 0.95 }}
              className={`flex max-w-xl items-center gap-3 rounded-2xl px-6 py-4 text-lg font-semibold shadow-lift ${
                x.kind === "ok" ? "bg-leaf text-white" : "bg-danger text-white"
              }`}
            >
              {x.kind === "ok" ? <CheckCircle2 className="h-7 w-7 shrink-0" aria-hidden /> : <AlertTriangle className="h-7 w-7 shrink-0" aria-hidden />}
              {x.msg}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </LanguageContext.Provider>
  );
}
