"use client";

/** Activity — the family timeline: who added / downloaded / shared / deleted what. */
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  CloudDownload, Download, FilePlus2, HeartPulse, History, MoveRight, QrCode, Recycle, RotateCcw, Upload,
} from "lucide-react";
import { useLanguage } from "@/components/providers";
import { BackBar, PageIn } from "@/components/widgets";
import type { DictKey } from "@/lib/i18n";

type Log = { id: string; action: string; docName: string; meta: Record<string, string | number | boolean | null>; createdAt: string };

const ACTION_META: Record<string, { icon: typeof Upload; label: DictKey; color: string }> = {
  upload: { icon: Upload, label: "act_upload", color: "bg-leaf-tint text-leaf-deep" },
  download: { icon: Download, label: "act_download", color: "bg-saffron-tint text-saffron-deep" },
  delete: { icon: Recycle, label: "act_delete", color: "bg-danger-tint text-danger" },
  restore: { icon: RotateCcw, label: "act_restore", color: "bg-leaf-tint text-leaf-deep" },
  share: { icon: QrCode, label: "act_share", color: "bg-saffron-tint text-saffron-deep" },
  move: { icon: MoveRight, label: "act_move", color: "bg-straw text-ink-soft" },
  merge: { icon: FilePlus2, label: "act_merge", color: "bg-leaf-tint text-leaf-deep" },
  backup: { icon: CloudDownload, label: "act_backup", color: "bg-leaf-tint text-leaf-deep" },
  heal: { icon: HeartPulse, label: "act_heal", color: "bg-saffron-tint text-saffron-deep" },
  purge: { icon: Recycle, label: "act_delete", color: "bg-danger-tint text-danger" },
  folder_delete: { icon: Recycle, label: "act_delete", color: "bg-danger-tint text-danger" },
};

export default function ActivityPage() {
  const { t, lang } = useLanguage();
  const [logs, setLogs] = useState<Log[] | null>(null);

  useEffect(() => {
    fetch("/api/audit").then((r) => (r.ok ? r.json() : { logs: [] })).then((d) => setLogs(d.logs ?? [])).catch(() => setLogs([]));
  }, []);

  const dayFmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "long", year: "numeric" });
  const timeFmt = new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" });

  // group by day
  const groups: { day: string; items: Log[] }[] = [];
  for (const log of logs ?? []) {
    const day = dayFmt.format(new Date(log.createdAt));
    const g = groups.find((x) => x.day === day);
    if (g) g.items.push(log);
    else groups.push({ day, items: [log] });
  }

  return (
    <PageIn>
      <BackBar title={t("act_title")} />
      {!logs ? (
        <p className="p-10 text-center text-xl text-ink-soft">{t("loading")}</p>
      ) : logs.length === 0 ? (
        <div className="card flex flex-col items-center p-10 text-center">
          <span className="mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-straw text-ink-soft">
            <History className="h-14 w-14" aria-hidden />
          </span>
          <h2 className="font-display text-3xl font-bold">{t("act_empty")}</h2>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.day}>
              <h2 className="mb-4 font-display text-2xl font-bold text-ink-soft">{g.day}</h2>
              <div className="relative ml-6 space-y-4 border-l-4 border-warm-border pl-6">
                {g.items.map((log, i) => {
                  const meta = ACTION_META[log.action] ?? ACTION_META.upload;
                  const Icon = meta.icon;
                  return (
                    <motion.div key={log.id} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }} className="relative">
                      <span className={`absolute -left-[3.35rem] flex h-12 w-12 items-center justify-center rounded-full ${meta.color} shadow-soft`}>
                        <Icon className="h-6 w-6" aria-hidden />
                      </span>
                      <div className="card !rounded-2xl p-4">
                        <p className="text-xl leading-snug">
                          <b className={meta.color.split(" ")[1]}>{t(meta.label, { n: (log.meta?.n as number) ?? 0 })}</b>{" "}
                          <span className="font-semibold">{log.docName}</span>
                        </p>
                        <p className="mt-0.5 text-base text-ink-soft">{timeFmt.format(new Date(log.createdAt))}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </PageIn>
  );
}
