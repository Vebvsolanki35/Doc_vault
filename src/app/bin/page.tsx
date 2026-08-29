"use client";

/** Recycle Bin — soft-deleted files restorable for 30 days. */
import { useCallback, useEffect, useState } from "react";
import { Recycle } from "lucide-react";
import { useLanguage, toast } from "@/components/providers";
import { BackBar, PageIn, type MemberLite } from "@/components/widgets";
import { DocumentCard, type DocMeta } from "@/components/doc-actions";

export default function BinPage() {
  const { t } = useLanguage();
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/documents?bin=1")
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((d) => { setDocs(d.documents ?? []); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members ?? [])).catch(() => {});
  }, [refresh]);

  const emptyBin = async () => {
    for (const d of docs) {
      await fetch(`/api/documents/${d.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "purge" }) });
    }
    toast(t("bin_purged"));
    refresh();
  };

  return (
    <PageIn>
      <BackBar title={t("bin_title")} />
      <p className="mb-6 text-xl text-ink-soft">{t("bin_sub")}</p>

      {docs.length > 0 && (
        <div className="mb-6">
          <button onClick={emptyBin} className="btn-danger"><Recycle className="h-6 w-6" aria-hidden /> {t("bin_purge_now")}</button>
        </div>
      )}

      {docs.length > 0 ? (
        <div className="space-y-4">
          {docs.map((d) => (
            <DocumentCard key={d.id} doc={d} members={members} selectMode={false} selected={false} onToggleSelect={() => {}} onChanged={refresh} binMode />
          ))}
        </div>
      ) : loaded ? (
        <div className="card flex flex-col items-center p-10 text-center">
          <span className="mb-5 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-leaf-tint text-leaf-deep">
            <Recycle className="h-14 w-14" aria-hidden />
          </span>
          <h2 className="font-display text-3xl font-bold">{t("bin_empty")}</h2>
        </div>
      ) : (
        <p className="p-10 text-center text-xl text-ink-soft">{t("loading")}</p>
      )}
    </PageIn>
  );
}
