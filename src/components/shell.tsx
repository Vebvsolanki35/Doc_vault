"use client";

/** App shell: lock gate + top bar + 5-minute-idle AUTO-LOCK + DB health banner. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Database } from "lucide-react";
import { TopBar } from "./widgets";
import { VaultGate, type LockStatus } from "./lock";
import { toast, useLanguage } from "./providers";

const IDLE_LIMIT = 5 * 60 * 1000;

/**
 * A quiet watchdog: while the database cannot be reached, every screen
 * shows a big, clear banner explaining that new files can't be saved —
 * instead of files silently failing. It re-checks every 20 seconds and
 * disappears by itself as soon as the connection is back.
 */
function DbHealthBanner() {
  const { t } = useLanguage();
  const [down, setDown] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = () => {
      fetch("/api/health")
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (alive) setDown(!(j && j.ok)); })
        .catch(() => { if (alive) setDown(true); });
    };
    check();
    const iv = setInterval(check, 20000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  return (
    <AnimatePresence>
      {down && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
          role="alert"
        >
          <div className="border-b border-danger/30 bg-danger-tint">
            <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
              <Database className="h-8 w-8 shrink-0 text-danger" aria-hidden />
              <p className="text-lg font-bold leading-snug text-danger">{t("db_banner")}</p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function AutoLock({ enabled }: { enabled: boolean }) {
  const { t } = useLanguage();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!enabled) return;
    const lockNow = async () => {
      await fetch("/api/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      toast(tRef.current("lock_autolock"), "ok");
      location.reload();
    };
    const reset = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(lockNow, IDLE_LIMIT);
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled]);

  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<LockStatus | null>(null);

  useEffect(() => {
    fetch("/api/lock")
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus)
      .catch(() => {});
  }, []);

  const hasLock = !!status?.config.any;
  const isUnlocked = status ? !status.locked : true;

  return (
    <>
      <AutoLock enabled={hasLock && isUnlocked} />
      <TopBar locked={hasLock} />
      <DbHealthBanner />
      <VaultGate>{children}</VaultGate>
    </>
  );
}
