"use client";

/**
 * FAMILY DASHBOARD — three giant member tiles (Papa · Mummy · Me),
 * quick actions, storage gauge with per-member split, backup reminder,
 * recent documents strip, and links to Activity + Recycle Bin.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight, ChevronRight, DatabaseBackup, FolderOpen, HelpCircle, History, Mic, Recycle, ScanLine, Settings, Sun,
} from "lucide-react";
import { useLanguage } from "@/components/providers";
import { MemberAvatar, PageIn, StorageGauge, memberDisplayName, type MemberLite } from "@/components/widgets";
import { fileUrl, isImageDoc, type DocMeta } from "@/components/doc-actions";
import { formatBytes, toDevanagariDigits } from "@/lib/numbers";

type MemberWithCount = MemberLite & { docCount: number };
type Stats = {
  used: number; free: number; total: number; count: number;
  perMember: Record<string, { count: number; bytes: number; nameEn: string; nameHi: string; key: string; color: string; icon: string }>;
  lastBackupAt: string | null;
};

const container = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } };
const rise = {
  hidden: { opacity: 0, y: 26, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, damping: 20, stiffness: 220 } },
};

function Tile({ href, icon: Icon, title, sub, variant }: {
  href: string; icon: typeof ScanLine; title: string; sub: string; variant: "accent" | "plain";
}) {
  return (
    <motion.div variants={rise}>
      <Link
        href={href}
        className={`group relative flex h-full min-h-[150px] flex-col justify-between overflow-hidden rounded-[2rem] border p-6 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:shadow-lift ${
          variant === "accent" ? "border-saffron-deep/30 bg-saffron text-white" : "border-warm-border bg-paper text-ink hover:border-saffron"
        }`}
      >
        <span className={`pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-2xl ${variant === "accent" ? "bg-white/25" : "bg-saffron/10"}`} aria-hidden />
        <span className={`flex h-[68px] w-[68px] items-center justify-center rounded-3xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105 ${
          variant === "accent" ? "bg-white/20 text-white" : "bg-leaf-tint text-leaf-deep"
        }`}>
          <Icon className="h-10 w-10" aria-hidden />
        </span>
        <span className="mt-3">
          <span className="block font-display text-2xl font-bold leading-tight">{title}</span>
          <span className={`mt-0.5 block text-lg ${variant === "accent" ? "text-white/85" : "text-ink-soft"}`}>{sub}</span>
        </span>
        <ChevronRight className={`absolute bottom-6 right-6 h-8 w-8 transition-transform duration-300 group-hover:translate-x-1.5 ${variant === "accent" ? "text-white/80" : "text-saffron"}`} aria-hidden />
      </Link>
    </motion.div>
  );
}

export default function Dashboard() {
  const { t, lang } = useLanguage();
  const [members, setMembers] = useState<MemberWithCount[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<DocMeta[]>([]);

  useEffect(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members ?? [])).catch(() => {});
    fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then(setStats).catch(() => {});
    fetch("/api/documents?limit=5").then((r) => (r.ok ? r.json() : { documents: [] })).then((d) => setRecent(d.documents ?? [])).catch(() => {});
  }, []);

  const backupDue = !stats?.lastBackupAt || Date.now() - new Date(stats.lastBackupAt).getTime() > 7 * 24 * 3600 * 1000;
  const num = (n: number) => (lang === "hi" ? toDevanagariDigits(n) : String(n));

  return (
    <PageIn>
      {/* Greeting */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mb-7 flex items-center gap-5">
        <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-straw text-saffron-deep">
          <Sun className="h-9 w-9" aria-hidden />
        </span>
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t("greeting")}</h1>
          <p className="mt-1 text-xl text-ink-soft">{t("greeting_sub")}</p>
        </div>
      </motion.div>

      {/* ── THE FAMILY — three member tiles ── */}
      <motion.div variants={container} initial="hidden" animate="show" className="mb-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {members.map((m) => (
          <motion.div key={m.id} variants={rise}>
            <Link
              href={`/m/${m.key}`}
              className="card group flex items-center gap-5 p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-saffron hover:shadow-lift"
            >
              <MemberAvatar member={m} size="lg" />
              <span className="min-w-0 flex-1">
                <span className="block font-display text-3xl font-bold">{memberDisplayName(m, lang)}</span>
                <span className="block text-lg text-ink-soft">{t("member_docs", { n: num(m.docCount) })}</span>
              </span>
              <ChevronRight className="h-9 w-9 shrink-0 text-saffron transition-transform group-hover:translate-x-1.5" aria-hidden />
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Actions */}
      <motion.div variants={container} initial="hidden" animate="show" className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Tile href="/upload" icon={ScanLine} title={t("tile_scan")} sub={t("tile_scan_sub")} variant="accent" />
        <Tile href="/documents" icon={FolderOpen} title={t("tile_docs")} sub={t("tile_docs_sub")} variant="plain" />
        <Tile href="/search" icon={Mic} title={t("tile_search")} sub={t("tile_search_sub")} variant="plain" />
        <Tile href="/settings" icon={Settings} title={t("tile_settings")} sub={t("tile_settings_sub")} variant="plain" />
      </motion.div>

      <motion.div variants={container} initial="hidden" animate="show" className="mt-5 grid gap-3">
        {[
          { href: "/help", icon: HelpCircle, label: `${t("tile_help")} — ${t("tile_help_sub")}` },
          { href: "/activity", icon: History, label: `${t("tile_activity")} — ${t("tile_activity_sub")}` },
          { href: "/bin", icon: Recycle, label: `${t("tile_bin")} — ${t("tile_bin_sub")}` },
        ].map((x) => (
          <motion.div key={x.href} variants={rise}>
            <Link href={x.href} className="chip min-h-[60px] w-full justify-between !px-6 text-xl hover:!bg-straw">
              <span className="flex items-center gap-3"><x.icon className="h-7 w-7 text-saffron-deep" aria-hidden /> {x.label}</span>
              <ArrowRight className="h-6 w-6" aria-hidden />
            </Link>
          </motion.div>
        ))}
      </motion.div>

      {/* Storage gauge + per-member split */}
      {stats && (
        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="card mt-8 p-6 sm:p-8" aria-label={t("storage_title")}>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            <StorageGauge used={stats.used} total={stats.total} />
            <div className="flex-1">
              <p className="mb-3 text-xl font-bold text-ink-soft">{t("storage_per_member")}</p>
              <div className="grid gap-3 sm:grid-cols-3">
                {members.map((m) => {
                  const pm = stats.perMember[m.id];
                  const totalBytes = Math.max(1, stats.used);
                  const pct = Math.round(((pm?.bytes ?? 0) / totalBytes) * 100);
                  return (
                    <Link key={m.id} href={`/m/${m.key}`} className="rounded-2xl border border-warm-border bg-cream p-4 text-center transition-all hover:border-saffron">
                      <div className="flex justify-center"><MemberAvatar member={m} size="sm" /></div>
                      <p className="mt-2 text-xl font-bold">{memberDisplayName(m, lang)}</p>
                      <p className="font-display text-2xl font-bold text-leaf-deep">{formatBytes(pm?.bytes ?? 0)}</p>
                      <div className="mt-2 h-3 overflow-hidden rounded-full bg-straw" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-saffron" style={{ width: `${Math.max(4, pct)}%` }} />
                      </div>
                      <p className="mt-1 text-sm font-semibold text-ink-soft">{t("member_docs", { n: num(pm?.count ?? 0) })}</p>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="mt-6 border-t border-warm-border pt-4 text-xl font-bold text-leaf-deep">
            {t("documents_count", { n: num(stats.count) })}
          </p>
        </motion.section>
      )}

      {/* Backup reminder */}
      {stats && backupDue && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="card mt-6 !border-saffron bg-saffron-tint p-6">
          <Link href="/settings" className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-4 text-xl font-bold text-saffron-deep">
              <DatabaseBackup className="h-9 w-9 shrink-0" aria-hidden />
              {t("set_backup_due")}
            </span>
            <ArrowRight className="h-7 w-7 shrink-0 text-saffron-deep" aria-hidden />
          </Link>
        </motion.div>
      )}

      {/* Recent strip */}
      {recent.length > 0 && (
        <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }} className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("recent")}</h2>
            <Link href="/documents" className="chip min-h-[52px] hover:!bg-straw">{t("see_all")} <ArrowRight className="h-5 w-5" aria-hidden /></Link>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {recent.map((d) => (
              <Link key={d.id} href="/documents" className="card group w-[150px] shrink-0 overflow-hidden transition-transform hover:-translate-y-1">
                <div className="h-[120px] w-full bg-straw">
                  {isImageDoc(d.mimeType) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={fileUrl(d)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center"><FolderOpen className="h-10 w-10 text-ink-soft" /></div>
                  )}
                </div>
                <p className="truncate px-3 py-3 text-base font-bold group-hover:text-saffron-deep">{d.name}</p>
              </Link>
            ))}
          </div>
        </motion.section>
      )}
    </PageIn>
  );
}
