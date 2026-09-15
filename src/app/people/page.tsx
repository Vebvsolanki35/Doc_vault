"use client";

/**
 * PEOPLE — manage the family roster.
 * Add a person (English + Hindi name, other names found on their papers,
 * a colour), rename, restyle, or remove them (moving their documents to
 * someone else or into the Recycle Bin).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronRight, Loader2, Pencil, Trash2, UserPlus, X } from "lucide-react";
import { useLanguage, toast } from "@/components/providers";
import { BackBar, MEMBER_COLORS, MEMBER_ICONS, MemberAvatar, PageIn, memberDisplayName, type MemberLite } from "@/components/widgets";
import { toDevanagariDigits } from "@/lib/numbers";

type Member = MemberLite & { docCount: number; aliases: string[] };

type Draft = { nameEn: string; nameHi: string; aliases: string; color: string; icon: string };
const emptyDraft = (): Draft => ({ nameEn: "", nameHi: "", aliases: "", color: "rose", icon: "user" });

export default function PeoplePage() {
  const { t, lang } = useLanguage();
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  const [moveTo, setMoveTo] = useState<string>("bin");

  const refresh = useCallback(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => { setMembers(d.members ?? []); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(refresh, [refresh]);

  const num = (n: number) => (lang === "hi" ? toDevanagariDigits(n) : String(n));
  const aliasList = (s: string) => s.split(/[,،]/).map((a) => a.trim()).filter(Boolean);

  const startEdit = (m: Member) => {
    setAdding(false);
    setEditingId(m.id);
    setDraft({ nameEn: m.nameEn, nameHi: m.nameHi, aliases: (m.aliases ?? []).join(", "), color: m.color, icon: m.icon });
  };

  const submit = async () => {
    const nameEn = draft.nameEn.trim();
    const nameHi = draft.nameHi.trim() || nameEn;
    if (!nameEn && !nameHi) return;
    setBusy(true);
    const body = { nameEn: nameEn || nameHi, nameHi, aliases: aliasList(draft.aliases), color: draft.color, icon: draft.icon };
    const res = editingId
      ? await fetch(`/api/members/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) {
      toast(t(editingId ? "people_saved" : "people_added"));
      setAdding(false); setEditingId(null); setDraft(emptyDraft());
      refresh();
    } else toast(t("error_generic"), "warn");
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const qs = moveTo !== "bin" ? `?moveTo=${moveTo}` : "";
    const res = await fetch(`/api/members/${removing.id}${qs}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { toast(t("people_deleted")); setRemoving(null); refresh(); }
    else {
      const j = await res.json().catch(() => ({}));
      toast(j.error === "last_member" ? t("people_last") : t("error_generic"), "warn");
    }
  };

  const Form = (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="card !border-saffron p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-base font-bold text-ink-soft">{t("people_name_en")}</span>
          <input value={draft.nameEn} onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })} autoFocus
            className="min-h-[56px] w-full rounded-2xl border-2 border-warm-border bg-cream px-4 text-xl font-bold focus:border-saffron focus:outline-none" placeholder="e.g. Dadi" />
        </label>
        <label className="block">
          <span className="mb-1 block text-base font-bold text-ink-soft">{t("people_name_hi")}</span>
          <input value={draft.nameHi} onChange={(e) => setDraft({ ...draft, nameHi: e.target.value })}
            className="min-h-[56px] w-full rounded-2xl border-2 border-warm-border bg-cream px-4 text-xl font-bold focus:border-saffron focus:outline-none" placeholder="जैसे: दादी" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-base font-bold text-ink-soft">{t("people_aliases")}</span>
          <input value={draft.aliases} onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            className="min-h-[56px] w-full rounded-2xl border-2 border-warm-border bg-cream px-4 text-lg font-semibold focus:border-saffron focus:outline-none" placeholder={t("people_aliases_ph")} />
        </label>
        <div className="sm:col-span-2">
          <span className="mb-2 block text-base font-bold text-ink-soft">{t("people_color")}</span>
          <div className="flex flex-wrap items-center gap-3">
            {Object.entries(MEMBER_COLORS).map(([key, c]) => (
              <button key={key} onClick={() => setDraft({ ...draft, color: key })} aria-pressed={draft.color === key} aria-label={key}
                className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-full ring-offset-2 transition-all ${draft.color === key ? "ring-4 ring-ink" : "hover:scale-110"}`} style={{ background: c.swatch }}>
                {draft.color === key && <Check className="h-6 w-6 text-white" aria-hidden />}
              </button>
            ))}
            <span className="mx-2 h-10 w-px bg-warm-border" aria-hidden />
            {Object.entries(MEMBER_ICONS).map(([key, Icon]) => (
              <button key={key} onClick={() => setDraft({ ...draft, icon: key })} aria-pressed={draft.icon === key} aria-label={key}
                className={`flex h-12 w-12 cursor-pointer items-center justify-center rounded-2xl border-2 ${draft.icon === key ? "border-ink bg-ink text-cream" : "border-warm-border bg-paper hover:bg-straw"}`}>
                <Icon className="h-6 w-6" aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <MemberAvatar member={{ key: "x", color: draft.color, icon: draft.icon, nameEn: draft.nameEn || "?", nameHi: draft.nameHi || draft.nameEn || "?" }} size="md" />
        <span className="font-display text-2xl font-bold">{(lang === "hi" ? draft.nameHi || draft.nameEn : draft.nameEn || draft.nameHi) || "…"}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={submit} disabled={busy || !(draft.nameEn.trim() || draft.nameHi.trim())} className="btn-primary">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Check className="h-6 w-6" aria-hidden />} {t("set_save")}
          </button>
          <button onClick={() => { setAdding(false); setEditingId(null); setDraft(emptyDraft()); }} className="btn-ghost">{t("docs_cancel")}</button>
        </div>
      </div>
    </motion.div>
  );

  return (
    <PageIn>
      <BackBar title={t("people_title")} />
      <p className="mb-6 text-xl text-ink-soft">{t("people_sub")}</p>

      <div className="mb-6">
        {!adding && !editingId && (
          <button onClick={() => { setAdding(true); setDraft(emptyDraft()); }} className="btn-accent !text-xl">
            <UserPlus className="h-7 w-7" aria-hidden /> {t("people_add")}
          </button>
        )}
        <AnimatePresence>{adding && Form}</AnimatePresence>
      </div>

      <div className="space-y-4">
        {members.map((m) => (
          <motion.div key={m.id} layout initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            {editingId === m.id ? Form : (
              <div className="card flex flex-wrap items-center gap-4 p-5">
                <Link href={`/m/${m.key}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <MemberAvatar member={m} size="lg" />
                  <span className="min-w-0">
                    <span className="block font-display text-3xl font-bold">{memberDisplayName(m, lang)}</span>
                    <span className="block text-lg text-ink-soft">
                      {lang === "hi" ? m.nameEn : m.nameHi} · {t("member_docs", { n: num(m.docCount) })}
                    </span>
                    {m.aliases?.length > 0 && <span className="mt-1 block truncate text-base text-ink-soft">{m.aliases.join(", ")}</span>}
                  </span>
                  <ChevronRight className="ml-2 h-7 w-7 shrink-0 text-saffron" aria-hidden />
                </Link>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(m)} className="btn-ghost !text-base"><Pencil className="h-5 w-5" aria-hidden /> {t("people_rename")}</button>
                  <button onClick={() => { setRemoving(m); setMoveTo(members.find((x) => x.id !== m.id)?.id ?? "bin"); }} disabled={members.length <= 1} className="btn-icon" aria-label={t("people_delete")} title={members.length <= 1 ? t("people_last") : t("people_delete")}>
                    <Trash2 className="h-7 w-7 text-danger" aria-hidden />
                  </button>
                </div>

                <AnimatePresence>
                  {removing?.id === m.id && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="w-full overflow-hidden">
                      <div className="mt-2 rounded-2xl border-2 border-danger/40 bg-danger-tint p-4">
                        <p className="text-lg font-bold text-danger">{t("people_delete_ask", { name: memberDisplayName(m, lang) })}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {members.filter((x) => x.id !== m.id).map((x) => (
                            <button key={x.id} onClick={() => setMoveTo(x.id)} aria-pressed={moveTo === x.id}
                              className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold ${moveTo === x.id ? "border-leaf bg-leaf text-white" : "border-warm-border bg-paper hover:bg-straw"}`}>
                              <MemberAvatar member={x} size="sm" /> {t("people_delete_move")} {memberDisplayName(x, lang)}
                            </button>
                          ))}
                          <button onClick={() => setMoveTo("bin")} aria-pressed={moveTo === "bin"}
                            className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold ${moveTo === "bin" ? "border-danger bg-danger text-white" : "border-warm-border bg-paper hover:bg-straw"}`}>
                            <Trash2 className="h-5 w-5" aria-hidden /> {t("people_delete_bin")}
                          </button>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button onClick={remove} disabled={busy} className="btn-danger">{busy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Trash2 className="h-6 w-6" aria-hidden />} {t("yes")}</button>
                          <button onClick={() => setRemoving(null)} className="btn-ghost"><X className="h-6 w-6" aria-hidden /> {t("no")}</button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        ))}
        {loaded && members.length === 0 && <p className="text-xl text-ink-soft">{t("people_sub")}</p>}
      </div>
    </PageIn>
  );
}
