"use client";

/** App shell: lock gate + top bar + 5-minute-idle AUTO-LOCK. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { TopBar } from "./widgets";
import { VaultGate, type LockStatus } from "./lock";
import { toast, useLanguage } from "./providers";

const IDLE_LIMIT = 5 * 60 * 1000;

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
      <VaultGate>{children}</VaultGate>
    </>
  );
}
