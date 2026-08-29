"use client";

/** Settings — language, safety locks, backup, self-healing, storage details. */
import { useCallback, useEffect, useState } from "react";
import { HeartHandshake, HardDrive } from "lucide-react";
import { useLanguage } from "@/components/providers";
import { BackBar, PageIn, StorageGauge } from "@/components/widgets";
import { BackupPanel, IntegrityPanel, LanguagePanel, SecurityPanel } from "@/components/settings-panels";
import { formatBytes } from "@/lib/numbers";
import type { LockStatus } from "@/components/lock";

type Stats = { used: number; total: number; count: number; lastBackupAt: string | null };

export default function SettingsPage() {
  const { t } = useLanguage();
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);

  const refresh = useCallback(() => {
    fetch("/api/lock").then((r) => r.json()).then(setLock).catch(() => {});
    fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const backupDue =
    !!stats && (!stats.lastBackupAt || Date.now() - new Date(stats.lastBackupAt).getTime() > 7 * 24 * 3600 * 1000);

  return (
    <PageIn>
      <BackBar title={t("tile_settings")} />
      <div className="space-y-6">
        <LanguagePanel />
        {lock && <SecurityPanel config={lock.config} onChanged={refresh} />}
        {stats && <BackupPanel lastBackupAt={stats.lastBackupAt} due={backupDue} onChanged={refresh} />}
        <IntegrityPanel />

        {stats && (
          <section className="card p-6 sm:p-8">
            <div className="mb-5 flex items-center gap-4">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-leaf-tint text-leaf-deep">
                <HardDrive className="h-8 w-8" aria-hidden />
              </span>
              <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("set_storage_detail")}</h2>
            </div>
            <StorageGauge used={stats.used} total={stats.total} />
            <div className="mt-6 grid grid-cols-2 gap-4 text-xl sm:grid-cols-3">
              <div className="rounded-2xl bg-cream p-4 text-center">
                <p className="font-display text-2xl font-bold">{formatBytes(stats.used)}</p>
                <p className="text-base font-semibold text-ink-soft">{t("storage_used")}</p>
              </div>
              <div className="rounded-2xl bg-cream p-4 text-center">
                <p className="font-display text-2xl font-bold">{formatBytes(stats.total - stats.used)}</p>
                <p className="text-base font-semibold text-ink-soft">{t("storage_left")}</p>
              </div>
              <div className="col-span-2 rounded-2xl bg-cream p-4 text-center sm:col-span-1">
                <p className="font-display text-2xl font-bold">{stats.count}</p>
                <p className="text-base font-semibold text-ink-soft">{t("documents_count", { n: stats.count }).split(String(stats.count)).join("").trim()}</p>
              </div>
            </div>
          </section>
        )}

        <section className="card bg-leaf-tint/60 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-paper text-saffron-deep">
              <HeartHandshake className="h-8 w-8" aria-hidden />
            </span>
            <div>
              <h2 className="font-display text-2xl font-bold">{t("set_about")}</h2>
              <p className="mt-1 text-xl text-ink-soft">{t("set_about_text")}</p>
            </div>
          </div>
        </section>
      </div>
    </PageIn>
  );
}
