"use client";

/**
 * MEMBER SPACE — Papa / Mummy / Me: their folder tiles (5 defaults +
 * customs + "New Folder") on top, documents scoped below.
 */
import { use, useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FolderOpen, FolderPlus, Loader2, Trash2 } from "lucide-react";
import { useLanguage, toast } from "@/components/providers";
import {
  BackBar, FolderIcon, FOLDER_LABEL_KEY, MemberAvatar, PageIn, memberDisplayName, type MemberLite,
} from "@/components/widgets";
import { DocBrowser, folderDisplayName, type FolderLite } from "@/components/doc-browser";
import { toDevanagariDigits } from "@/lib/numbers";

export default function MemberSpace({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { t, lang } = useLanguage();
  const [member, setMember] = useState<(MemberLite & { docCount: number }) | null>(null);
  const [folders, setFolders] = useState<FolderLite[]>([]);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelFolder, setConfirmDelFolder] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async (mId?: string) => {
    const list = await fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).catch(() => ({ members: [] }));
    const m = (list.members ?? []).find((x: MemberLite) => x.key === key);
    if (!m) { setNotFound(true); return; }
    setMember(m);
    const fres = await fetch(`/api/members/${m.id}/folders`).then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] }));
    setFolders(fres.folders ?? []);
    void mId;
  }, [key]);

  useEffect(() => { refresh(); }, [refresh]);

  const addFolder = async () => {
    if (!member || !newName.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/members/${member.id}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      toast(t("folder_added"));
      setNewName("");
      setAdding(false);
      refresh(member.id);
    }
    setBusy(false);
  };

  const deleteFolder = async (folderId: string) => {
    const res = await fetch(`/api/folders/${folderId}`, { method: "DELETE" });
    if (res.ok) {
      if (activeFolder === folderId) setActiveFolder(null);
      setConfirmDelFolder(null);
      refresh();
    }
  };

  const num = (n: number) => (lang === "hi" ? toDevanagariDigits(n) : String(n));

  if (notFound) {
    return (
      <PageIn>
        <BackBar title="?" />
        <p className="text-xl">{t("search_none")}</p>
      </PageIn>
    );
  }
  if (!member) {
    return (
      <PageIn>
        <p className="flex items-center gap-3 p-10 text-xl"><Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden /> {t("loading")}</p>
      </PageIn>
    );
  }

  return (
    <PageIn>
      <BackBar title={memberDisplayName(member, lang) + t("member_space")} />

      {/* Member hero */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card mb-7 flex items-center gap-5 p-6">
        <MemberAvatar member={member} size="lg" />
        <div>
          <p className="font-display text-3xl font-bold">{memberDisplayName(member, lang)}</p>
          <p className="text-lg text-ink-soft">{t("member_docs", { n: num(member.docCount) })}</p>
        </div>
      </motion.div>

      {/* Folder tiles */}
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {folders.map((f, i) => {
          const active = activeFolder === f.id;
          return (
            <motion.div key={f.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="relative">
              <button
                onClick={() => setActiveFolder(active ? null : f.id)}
                aria-pressed={active}
                className={`flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 p-4 text-center transition-all ${
                  active ? "border-leaf bg-leaf text-white shadow-lift" : "border-warm-border bg-paper shadow-soft hover:border-saffron hover:-translate-y-0.5"
                }`}
              >
                <FolderIcon folder={f.isDefault ? f.key : "custom"} className="h-9 w-9" />
                <span className="text-lg font-bold leading-tight">{folderDisplayName(f, lang, t as never)}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${active ? "bg-white/25" : "bg-straw"}`}>{num(f.docCount ?? 0)}</span>
              </button>
              {!f.isDefault && (
                confirmDelFolder === f.id ? (
                  <button
                    onClick={() => deleteFolder(f.id)}
                    className="absolute -right-2 -top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-danger text-white shadow-lift"
                    aria-label={t("yes")}
                    title={t("yes")}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmDelFolder(f.id)}
                    className="absolute -right-2 -top-2 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-2 border-warm-border bg-paper text-danger shadow-soft"
                    aria-label={t("docs_delete")}
                    title={t("docs_delete")}
                  >
                    <Trash2 className="h-5 w-5" aria-hidden />
                  </button>
                )
              )}
            </motion.div>
          );
        })}

        {/* New folder */}
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: folders.length * 0.05 }}>
          {adding ? (
            <div className="card flex min-h-[120px] flex-col gap-2 rounded-3xl p-3">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addFolder()}
                placeholder={t("folder_add_ph")}
                aria-label={t("folder_add")}
                autoFocus
                className="min-h-[48px] w-full rounded-xl border-2 border-warm-border bg-cream px-3 text-base font-semibold"
              />
              <div className="flex gap-2">
                <button onClick={addFolder} disabled={busy} className="btn-primary flex-1 !min-h-[48px] !px-3 !text-base">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <FolderPlus className="h-5 w-5" aria-hidden />}
                  {t("set_save")}
                </button>
                <button onClick={() => { setAdding(false); setNewName(""); }} className="btn-ghost !min-h-[48px] !px-3 !text-base">{t("docs_cancel")}</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex min-h-[120px] w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border-2 !border-dashed border-warm-border bg-transparent p-4 text-ink-soft transition-all hover:border-saffron hover:bg-saffron-tint hover:text-saffron-deep"
            >
              <FolderPlus className="h-9 w-9" aria-hidden />
              <span className="text-lg font-bold">{t("folder_add")}</span>
            </button>
          )}
        </motion.div>
      </div>

      {/* Documents of this member (optionally narrowed to a folder) */}
      {activeFolder && (
        <p className="mb-4 flex items-center gap-2 text-lg font-bold text-leaf-deep">
          <FolderOpen className="h-6 w-6" aria-hidden />
          {folderDisplayName(folders.find((f) => f.id === activeFolder)!, lang, t as never)}
          <button onClick={() => setActiveFolder(null)} className="chip cursor-pointer !py-1 text-sm hover:!bg-straw">{t("see_all")}</button>
        </p>
      )}
      <DocBrowser memberId={member.id} fixedFolderId={activeFolder ?? undefined} members={[member]} showFolderChips={!activeFolder} />
    </PageIn>
  );
}
