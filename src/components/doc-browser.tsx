"use client";

/**
 * DocBrowser — the reusable document explorer.
 * Folder/member filter chips, multi-select bulk bar (ZIP · one PDF · move · delete),
 * used by /documents, member spaces and search results.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownUp, CheckSquare, FilePlus2, FolderInput, Loader2, ScanLine, Search, Tags, Trash2, Archive } from "lucide-react";
import Link from "next/link";
import { useLanguage, toast } from "./providers";
import { FolderIcon, FOLDER_LABEL_KEY, type MemberLite, MemberAvatar } from "./widgets";
import { DocumentCard, type DocMeta } from "./doc-actions";
import { FOLDER_KEYS } from "@/lib/classifier";
import { toDevanagariDigits } from "@/lib/numbers";
import { docTypeLabel, docTypesForFolder } from "@/lib/docTypes";

export type FolderLite = {
  id: string;
  memberId: string;
  key: string;
  nameEn: string | null;
  nameHi: string | null;
  isDefault: boolean;
  docCount?: number;
};

export function folderDisplayName(f: FolderLite, lang: "en" | "hi", t: (k: never) => string): string {
  if (f.isDefault || !f.nameEn) {
    const labelKey = (FOLDER_LABEL_KEY[f.key] ?? "cat_other") as never;
    return t(labelKey);
  }
  return lang === "hi" && f.nameHi ? f.nameHi : f.nameEn!;
}

type Quality = "low" | "medium" | "high";

export function DocBrowser({
  memberId,
  fixedFolderId,
  members = [],
  folders = [],
  showFolderChips = true,
  showMemberChips = false,
}: {
  memberId?: string;
  fixedFolderId?: string;
  members?: MemberLite[];
  folders?: FolderLite[];
  showFolderChips?: boolean;
  showMemberChips?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [memberFilter, setMemberFilter] = useState<string>("all");
  const [nameQuery, setNameQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "size">("newest");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quality, setQuality] = useState<Quality>("medium");
  const [mergeBusy, setMergeBusy] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [allFolders, setAllFolders] = useState<FolderLite[]>(folders);

  const refresh = useCallback(() => {
    const params = new URLSearchParams();
    if (memberId) params.set("memberId", memberId);
    if (fixedFolderId) params.set("folderId", fixedFolderId);
    fetch(`/api/documents?${params}`)
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d) => { setDocs(d.documents ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, [memberId, fixedFolderId]);

  // Pull full folder list for the "Move" dialog (all members' folders)
  useEffect(() => {
    if (folders.length > 0) { setAllFolders(folders); return; }
    (async () => {
      const acc: FolderLite[] = [];
      for (const m of members) {
        const res = await fetch(`/api/members/${m.id}/folders`).then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] }));
        acc.push(...(res.folders ?? []));
      }
      setAllFolders(acc);
    })();
  }, [folders, members]);

  useEffect(refresh, [refresh]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: docs.length };
    for (const k of FOLDER_KEYS) c[k] = docs.filter((d) => d.category === k).length;
    return c;
  }, [docs]);

  // Types that actually exist in the current folder view (so chips never point at empty sets)
  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of docs) {
      if (filter !== "all" && d.category !== filter) continue;
      const k = d.docType ?? "other";
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [docs, filter]);
  const typeChips = useMemo(() => {
    const defs = docTypesForFolder(filter === "all" ? "all" : (filter as never)).filter((d) => (typeCounts[d.key] ?? 0) > 0);
    return defs;
  }, [filter, typeCounts]);
  useEffect(() => { if (typeFilter !== "all" && !(typeCounts[typeFilter] > 0)) setTypeFilter("all"); }, [typeCounts, typeFilter]);

  const q = nameQuery.trim().toLowerCase();
  const visible = docs
    .filter((d) => {
      if (filter !== "all" && d.category !== filter) return false;
      if (typeFilter !== "all" && (d.docType ?? "other") !== typeFilter) return false;
      if (memberFilter !== "all" && d.memberId !== memberFilter) return false;
      if (q && !d.name.toLowerCase().includes(q) && !docTypeLabel(d.docType, lang).toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
      if (sort === "name") return a.name.localeCompare(b.name, lang === "hi" ? "hi" : "en");
      if (sort === "size") return b.size - a.size;
      return b.createdAt.localeCompare(a.createdAt);
    });

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkPost = async (payload: Record<string, unknown>) => {
    const res = await fetch("/api/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.ok;
  };

  const bulkZip = async () => {
    setZipBusy(true);
    const res = await fetch("/api/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "zip", ids: [...selected] }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.zip";
      a.click();
      URL.revokeObjectURL(url);
      toast(t("ok"));
    } else toast(t("error_generic"), "warn");
    setZipBusy(false);
  };

  const bulkDelete = async () => {
    const ok = await bulkPost({ action: "delete", ids: [...selected] });
    if (ok) { toast(t("docs_deleted")); setSelected(new Set()); setSelectMode(false); refresh(); }
  };

  const bulkMove = async (folderId: string) => {
    const ok = await bulkPost({ action: "move", ids: [...selected], folderId });
    if (ok) { toast(t("docs_moved")); setSelected(new Set()); setSelectMode(false); setMoveOpen(false); refresh(); }
  };

  const mergePdf = async () => {
    setMergeBusy(true);
    try {
      const res = await fetch("/api/batch-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], quality }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "documents.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setSelected(new Set());
      setSelectMode(false);
    } catch { toast(t("error_generic"), "warn"); }
    setMergeBusy(false);
  };

  const num = (n: number) => (lang === "hi" ? toDevanagariDigits(n) : String(n));

  return (
    <div>
      {/* Folder chips */}
      {showFolderChips && !fixedFolderId && (
        <div className="mb-6 flex flex-wrap gap-3" role="tablist" aria-label={t("cat_all")}>
          {(["all", ...FOLDER_KEYS] as const).map((c) => {
            const active = filter === c;
            return (
              <button
                key={c}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(c)}
                className={`inline-flex min-h-[62px] cursor-pointer items-center gap-2.5 rounded-2xl border-2 px-5 text-xl font-bold transition-all ${
                  active ? "border-leaf bg-leaf text-white shadow-soft" : "border-warm-border bg-paper text-ink hover:bg-straw"
                }`}
              >
                {c !== "all" && <FolderIcon folder={c} className="h-6 w-6" />}
                {t(c === "all" ? "cat_all" : ((FOLDER_LABEL_KEY[c] ?? "cat_other") as never))}
                <span className={`rounded-full px-2.5 py-0.5 text-base ${active ? "bg-white/25" : "bg-straw"}`}>{num(counts[c] ?? 0)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Member chips (global view) */}
      {showMemberChips && members.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3" role="tablist" aria-label={t("family")}>
          <button
            role="tab"
            aria-selected={memberFilter === "all"}
            onClick={() => setMemberFilter("all")}
            className={`inline-flex min-h-[58px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-5 text-lg font-bold ${
              memberFilter === "all" ? "border-ink bg-ink text-cream" : "border-warm-border bg-paper hover:bg-straw"
            }`}
          >
            {t("family")}
          </button>
          {members.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={memberFilter === m.id}
              onClick={() => setMemberFilter(memberFilter === m.id ? "all" : m.id)}
              className={`inline-flex min-h-[58px] cursor-pointer items-center gap-2.5 rounded-2xl border-2 px-4 text-lg font-bold ${
                memberFilter === m.id ? "border-saffron bg-saffron-tint text-saffron-deep" : "border-warm-border bg-paper hover:bg-straw"
              }`}
            >
              <MemberAvatar member={m} size="sm" />
              {lang === "hi" ? m.nameHi : m.nameEn}
            </button>
          ))}
        </div>
      )}

      {/* Document-type chips (Aadhaar / PAN / Khasra …) */}
      {typeChips.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 flex items-center gap-2 text-base font-bold text-ink-soft"><Tags className="h-5 w-5" aria-hidden /> {t("browse_by_type")}</p>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label={t("browse_by_type")}>
            <button role="tab" aria-selected={typeFilter === "all"} onClick={() => setTypeFilter("all")}
              className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold ${typeFilter === "all" ? "border-ink bg-ink text-cream" : "border-warm-border bg-paper hover:bg-straw"}`}>
              {t("doc_type_all")}
            </button>
            {typeChips.map((d) => {
              const active = typeFilter === d.key;
              return (
                <button key={d.key} role="tab" aria-selected={active} onClick={() => setTypeFilter(active ? "all" : d.key)}
                  className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold ${active ? "border-[#1d4e77] bg-[#e0ecfa] text-[#1d4e77]" : "border-warm-border bg-paper hover:bg-straw"}`}>
                  {lang === "hi" ? d.hi : d.en}
                  <span className={`rounded-full px-2 py-0.5 text-sm ${active ? "bg-white/70" : "bg-straw"}`}>{num(typeCounts[d.key] ?? 0)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Name filter + sort */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-ink-soft" aria-hidden />
          <input value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} placeholder={t("docs_filter_search")} aria-label={t("docs_filter_search")}
            className="min-h-[56px] w-full rounded-2xl border-2 border-warm-border bg-paper pl-12 pr-4 text-lg font-semibold focus:border-saffron focus:outline-none" />
        </label>
        <label className="flex items-center gap-2 text-base font-bold text-ink-soft">
          <ArrowDownUp className="h-5 w-5" aria-hidden />
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label={t("docs_sort")}
            className="min-h-[56px] cursor-pointer rounded-2xl border-2 border-warm-border bg-paper px-3 text-lg font-bold text-ink">
            <option value="newest">{t("sort_newest")}</option>
            <option value="oldest">{t("sort_oldest")}</option>
            <option value="name">{t("sort_name")}</option>
            <option value="size">{t("sort_size")}</option>
          </select>
        </label>
        {loaded && <span className="text-base font-semibold text-ink-soft">{t("docs_showing", { n: num(visible.length), total: num(docs.length) })}</span>}
      </div>

      {/* Toolbar */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => { setSelectMode((s) => !s); setSelected(new Set()); }}
          className={selectMode ? "btn-accent" : "btn-ghost"}
          aria-pressed={selectMode}
        >
          <CheckSquare className="h-6 w-6" aria-hidden />
          {selectMode ? t("docs_cancel") : t("docs_select")}
        </button>

        <AnimatePresence>
          {selectMode && (
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="flex flex-wrap items-center gap-2.5">
              <span className="text-xl font-bold">{t("docs_selected", { n: num(selected.size) })}</span>
              <div className="flex rounded-2xl border-2 border-warm-border bg-cream p-1" role="radiogroup" aria-label={t("dl_quality")}>
                {(["low", "medium", "high"] as const).map((q) => (
                  <button key={q} role="radio" aria-checked={quality === q} onClick={() => setQuality(q)}
                    className={`min-h-[48px] cursor-pointer rounded-xl px-3.5 text-base font-bold ${quality === q ? "bg-leaf text-white" : "hover:bg-straw"}`}>
                    {t(q === "low" ? "dl_low" : q === "medium" ? "dl_medium" : "dl_high")}
                  </button>
                ))}
              </div>
              <button onClick={mergePdf} disabled={selected.size === 0 || mergeBusy} className="btn-primary !px-5 !text-lg">
                {mergeBusy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <FilePlus2 className="h-6 w-6" aria-hidden />}
                {t("docs_merge_pdf")}
              </button>
              <button onClick={bulkZip} disabled={selected.size === 0 || zipBusy} className="btn-ghost !px-5 !text-lg">
                {zipBusy ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <Archive className="h-6 w-6" aria-hidden />}
                {t("docs_zip")}
              </button>
              <div className="relative">
                <button onClick={() => setMoveOpen((o) => !o)} disabled={selected.size === 0} className="btn-ghost !px-5 !text-lg" aria-expanded={moveOpen}>
                  <FolderInput className="h-6 w-6" aria-hidden /> {t("docs_move")}
                </button>
                {moveOpen && (
                  <div className="card absolute right-0 top-full z-30 mt-2 max-h-72 w-80 overflow-y-auto p-2 shadow-lift">
                    {allFolders.map((f) => {
                      const fMember = members.find((m) => m.id === f.memberId);
                      return (
                        <button key={f.id} onClick={() => bulkMove(f.id)}
                          className="flex min-h-[56px] w-full cursor-pointer items-center gap-3 rounded-xl px-4 text-left text-lg font-semibold hover:bg-straw">
                          <FolderIcon folder={f.key} className="h-5 w-5" />
                          {fMember ? `${lang === "hi" ? fMember.nameHi : fMember.nameEn} · ` : ""}
                          {folderDisplayName(f, lang, t as never)}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button onClick={bulkDelete} disabled={selected.size === 0} className="btn-danger !px-5 !text-lg">
                <Trash2 className="h-6 w-6" aria-hidden /> {t("docs_delete")}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* List */}
      {visible.length > 0 ? (
        <div className="space-y-4">
          {visible.map((d) => (
            <DocumentCard
              key={d.id}
              doc={d}
              members={members}
              selectMode={selectMode}
              selected={selected.has(d.id)}
              onToggleSelect={toggleSelect}
              onChanged={refresh}
            />
          ))}
        </div>
      ) : loaded ? (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card flex flex-col items-center p-10 text-center">
          <span className="mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-saffron-tint text-saffron-deep">
            <ScanLine className="h-14 w-14" aria-hidden />
          </span>
          <h2 className="font-display text-3xl font-bold">{t("docs_empty")}</h2>
          <p className="mx-auto mt-2 max-w-md text-xl text-ink-soft">{t("docs_empty_sub")}</p>
          <Link href="/upload" className="btn-accent mt-8 !text-2xl">
            <ScanLine className="h-8 w-8" aria-hidden /> {t("add_first")}
          </Link>
        </motion.div>
      ) : (
        <p className="p-10 text-center text-xl text-ink-soft">{t("loading")}</p>
      )}
    </div>
  );
}
