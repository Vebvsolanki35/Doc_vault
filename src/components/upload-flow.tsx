"use client";

/**
 * THE MAGICAL UPLOAD FLOW v2
 *   pick / drag / camera  →  chunked resumable upload  →  SmartScan theatre
 *   →  auto-sorted card with detected MEMBER + FOLDER
 *   →  "क्या यह पापा का है?" one-tap confirm / change
 *   →  duplicate files offer Replace / Keep-both / Skip.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera, CheckCircle2, CloudUpload, CopyCheck, FileText, FolderDown, ImagePlus, Loader2, ScanLine, Sparkles, WifiOff, X,
} from "lucide-react";
import { useLanguage, toast } from "./providers";
import {
  BackBar, FolderIcon, FOLDER_LABEL_KEY, PageIn, SmartTags, MemberAvatar, memberDisplayName, type MemberLite,
} from "./widgets";
import { outboxAdd, outboxList, outboxRemove, type OutboxItem } from "@/lib/outbox";
import { type FolderKey } from "@/lib/classifier";
import type { DocMeta } from "./doc-actions";

const CHUNK = 1024 * 1024;

type Detected = { folder: FolderKey; confidence: number; memberCertain: boolean; memberKey: string | null };
type QueueItem = {
  key: string;
  name: string;
  preview: string | null;
  status: "uploading" | "scanning" | "done" | "error" | "offline" | "duplicate";
  progress: number;
  doc?: DocMeta;
  detected?: Detected;
  existing?: DocMeta;
  file?: File;
};

async function uploadFile(file: File, onProgress: (p: number) => void, extra: Record<string, string> = {}): Promise<{ doc?: DocMeta; detected?: Detected; duplicate?: boolean; existing?: DocMeta }> {
  const append = (fd: FormData) => {
    fd.append("name", file.name);
    fd.append("mime", file.type);
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  };
  if (file.size <= CHUNK * 1.5) {
    const fd = new FormData();
    fd.append("file", file);
    append(fd);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = await res.json();
    if (res.status === 409) return { duplicate: true, existing: json.existing };
    if (!res.ok) throw new Error(json.error ?? "upload failed");
    onProgress(1);
    return { doc: json.document, detected: json.detected };
  }

  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const totalChunks = Math.ceil(file.size / CHUNK);
  for (let i = 0; i < totalChunks; i++) {
    const blob = file.slice(i * CHUNK, (i + 1) * CHUNK);
    let attempt = 0;
    for (;;) {
      try {
        const fd = new FormData();
        fd.append("file", blob);
        fd.append("uploadId", uploadId);
        fd.append("chunkIndex", String(i));
        fd.append("totalChunks", String(totalChunks));
        append(fd);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (res.status === 409) return { duplicate: true, existing: json.existing };
        if (!res.ok) throw new Error("chunk failed");
        onProgress((i + 1) / totalChunks);
        if (json.done) return { doc: json.document, detected: json.detected };
        break;
      } catch (e) {
        attempt++;
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
  }
  throw new Error("upload incomplete");
}

export default function UploadFlow() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [memberFolders, setMemberFolders] = useState<Record<string, { id: string; key: string; nameEn: string | null; nameHi: string | null; isDefault: boolean }[]>>({});
  const [drag, setDrag] = useState(false);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then(async (d) => {
      setMembers(d.members ?? []);
      const acc: typeof memberFolders = {};
      for (const m of d.members ?? []) {
        const res = await fetch(`/api/members/${m.id}/folders`).then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] }));
        acc[m.id] = res.folders ?? [];
      }
      setMemberFolders(acc);
    }).catch(() => {});
  }, []);

  const refreshOutbox = useCallback(() => { outboxList().then(setOutbox).catch(() => {}); }, []);

  useEffect(() => {
    refreshOutbox();
    const flush = () => syncOutbox();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFiles = useCallback((files: FileList | File[], extra: Record<string, string> = {}) => {
    const list = Array.from(files).slice(0, 12);
    for (const file of list) {
      const key = `${Date.now()}-${file.name}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setItems((prev) => [...prev, { key, name: file.name, preview, status: "uploading", progress: 0, file }]);

      uploadFile(file, (p) =>
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress: p, status: p < 1 ? "uploading" : "scanning" } : it))),
        extra,
      )
        .then(({ doc, detected, duplicate, existing }) => {
          if (duplicate) {
            setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "duplicate", existing } : it)));
            return;
          }
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "scanning" } : it)));
          setTimeout(
            () => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "done", doc, detected } : it))),
            1400,
          );
        })
        .catch(async () => {
          if (!navigator.onLine) {
            await outboxAdd({ id: key, name: file.name, type: file.type, blob: file, addedAt: Date.now() }).catch(() => {});
            setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "offline" } : it)));
            refreshOutbox();
            toast(t("upload_offline"), "warn");
          } else {
            setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "error" } : it)));
            toast(t("upload_fail"), "warn");
          }
        });
    }
  }, [refreshOutbox, t]);

  const syncOutbox = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    const pendingItems = await outboxList().catch(() => [] as OutboxItem[]);
    if (pendingItems.length === 0) return;
    setSyncing(true);
    for (const item of pendingItems) {
      try {
        const file = new File([item.blob], item.name, { type: item.type });
        const key = `${Date.now()}-${item.name}-sync`;
        setItems((prev) => [...prev, { key, name: item.name, preview: null, status: "uploading", progress: 0 }]);
        const { doc, detected } = await uploadFile(file, (p) =>
          setItems((prev) => prev.map((it) => (it.key === key ? { ...it, progress: p } : it))),
        );
        setItems((prev) => prev.map((it) => (it.key === key ? { ...it, status: "done", doc, detected } : it)));
        await outboxRemove(item.id);
      } catch { /* stays queued */ }
    }
    setSyncing(false);
    refreshOutbox();
  }, [syncing, refreshOutbox]);

  /** One-tap "no, change member/folder" after SmartScan — re-file instantly. */
  const refile = async (key: string, docId: string, targetMemberId: string, targetFolderKey?: string) => {
    const folders = memberFolders[targetMemberId] ?? [];
    const target = folders.find((f) => f.key === (targetFolderKey ?? items.find((i) => i.key === key)?.detected?.folder)) ?? folders.find((f) => f.key === "other");
    if (!target) return;
    await fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: target.id }),
    });
    setItems((prev) =>
      prev.map((it) =>
        it.key === key && it.doc
          ? { ...it, doc: { ...it.doc, memberId: targetMemberId, folderId: target.id, category: target.key === "custom" ? "other" : target.key } }
          : it,
      ),
    );
  };

  const resolveDuplicate = async (item: QueueItem, how: "replace" | "keep" | "skip") => {
    if (how === "skip") {
      setItems((prev) => prev.filter((it) => it.key !== item.key));
      toast(t("ok"));
      return;
    }
    if (!item.file) return;
    const newName = how === "keep" ? item.name.replace(/(\.[^.]+)$/, ` (2)$1`) : item.name;
    const renamed = newName === item.name ? item.file : new File([item.file], newName, { type: item.file.type });
    setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, status: "uploading", progress: 0.01 } : it)));
    try {
      const { doc, detected } = await uploadFile(renamed, () => {}, { merge: "1" });
      setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, status: "done", doc, detected } : it)));
      toast(t("upload_sorted"));
    } catch {
      setItems((prev) => prev.map((it) => (it.key === item.key ? { ...it, status: "error" } : it)));
    }
  };

  return (
    <PageIn>
      <BackBar title={t("upload_title")} />
      <p className="mb-6 text-xl text-ink-soft">{t("upload_hint")}</p>

      <AnimatePresence>
        {outbox.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="card mb-6 flex flex-wrap items-center justify-between gap-4 !border-saffron bg-saffron-tint p-5">
            <div className="flex items-center gap-3 text-xl font-bold text-saffron-deep">
              <WifiOff className="h-7 w-7" aria-hidden />
              {t("upload_outbox_pending", { n: outbox.length })}
            </div>
            <button onClick={syncOutbox} disabled={syncing} className="btn-accent">
              {syncing ? <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> : <CloudUpload className="h-6 w-6" aria-hidden />}
              {t("upload_sync_now")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
        animate={drag ? { scale: 1.02 } : { scale: 1 }}
        className={`card relative overflow-hidden border-4 !border-dashed p-8 text-center transition-colors sm:p-14 ${
          drag ? "!border-saffron bg-saffron-tint" : "!border-warm-border"
        }`}
      >
        <div className="pointer-events-none absolute -left-10 -top-10 h-44 w-44 rounded-full bg-saffron/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-leaf/10 blur-2xl" aria-hidden />
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-[2rem] bg-saffron text-white shadow-lift">
          <ScanLine className="h-16 w-16" aria-hidden />
        </motion.div>
        <p className="mx-auto mb-8 max-w-md text-2xl font-bold leading-snug">{t("upload_drop")}</p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <button onClick={() => camRef.current?.click()} className="btn-accent w-full !text-2xl sm:w-auto">
            <Camera className="h-8 w-8" aria-hidden /> {t("upload_camera")}
          </button>
          <button onClick={() => pickRef.current?.click()} className="btn-primary w-full !text-2xl sm:w-auto">
            <ImagePlus className="h-8 w-8" aria-hidden /> {t("upload_choose")}
          </button>
        </div>
        <p className="mt-5 text-lg text-ink-soft">{t("upload_or")}</p>
        <input ref={pickRef} type="file" multiple accept="image/*,application/pdf" className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} aria-hidden />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ""; }} aria-hidden />
      </motion.div>

      <div className="mt-8 space-y-4">
        <AnimatePresence>
          {items.map((it) => {
            const docMember = members.find((m) => m.id === it.doc?.memberId);
            const guessedMember = members.find((m) => m.key === it.detected?.memberKey) ?? docMember ?? members[0];
            const docFolders = docMember ? memberFolders[docMember.id] ?? [] : [];
            const docFolder = docFolders.find((f) => f.id === it.doc?.folderId);
            return (
              <motion.div key={it.key} layout initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                className={`card p-5 ${it.status === "done" ? "!border-leaf" : it.status === "duplicate" ? "!border-saffron" : it.status === "error" ? "!border-danger" : ""}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="relative h-[76px] w-[76px] shrink-0 overflow-hidden rounded-2xl bg-straw">
                    {it.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.preview} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        {it.status === "done" && it.doc ? <FolderIcon folder={it.doc.category} className="h-9 w-9 text-leaf" /> : <FileText className="h-9 w-9 text-ink-soft" aria-hidden />}
                      </div>
                    )}
                    {(it.status === "uploading" || it.status === "scanning") && (
                      <span className="absolute inset-x-1 h-1 rounded bg-saffron shadow-[0_0_14px_2px_rgba(217,106,0,0.7)]" style={{ animation: "var(--animate-scanline)" }} aria-hidden />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xl font-bold">{it.name}</p>
                    {it.status === "uploading" && (
                      <div className="mt-2 h-4 w-full overflow-hidden rounded-full bg-straw" role="progressbar" aria-valuenow={Math.round(it.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-leaf transition-all duration-300" style={{ width: `${Math.round(it.progress * 100)}%` }} />
                      </div>
                    )}
                    {it.status === "scanning" && (
                      <p className="mt-2 flex items-center gap-2 text-lg font-bold text-saffron-deep">
                        <Sparkles className="h-6 w-6" aria-hidden /> {t("upload_scanning")}
                      </p>
                    )}
                    {it.status === "offline" && (
                      <p className="mt-2 flex items-center gap-2 text-lg font-bold text-saffron-deep"><WifiOff className="h-6 w-6" aria-hidden /> {t("upload_offline")}</p>
                    )}
                    {it.status === "error" && <p className="mt-2 text-lg font-bold text-danger">{t("upload_fail")}</p>}

                    {it.status === "duplicate" && (
                      <div className="mt-2">
                        <p className="flex items-center gap-2 text-lg font-bold text-saffron-deep"><CopyCheck className="h-6 w-6" aria-hidden /> {t("dup_body")}</p>
                        <div className="mt-3 flex flex-wrap gap-2.5">
                          <button onClick={() => resolveDuplicate(it, "replace")} className="btn-primary !min-h-[52px] !px-5 !text-lg">{t("dup_replace")}</button>
                          <button onClick={() => resolveDuplicate(it, "keep")} className="btn-ghost !min-h-[52px] !px-5 !text-lg">{t("dup_keep_both")}</button>
                          <button onClick={() => resolveDuplicate(it, "skip")} className="btn-ghost !min-h-[52px] !px-5 !text-lg"><X className="h-5 w-5" aria-hidden /> {t("dup_skip")}</button>
                        </div>
                      </div>
                    )}

                    {it.status === "done" && it.doc && guessedMember && (
                      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <p className="mt-2 flex flex-wrap items-center gap-2 text-lg font-bold text-leaf-deep">
                          <CheckCircle2 className="h-6 w-6" aria-hidden />
                          {t("upload_saved_in")}
                          <span className="inline-flex items-center gap-2">
                            <MemberAvatar member={docMember ?? guessedMember} size="sm" />
                            {memberDisplayName(docMember ?? guessedMember, lang)}
                          </span>
                          {docFolder && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-tint px-3 py-1">
                              <FolderIcon folder={docFolder.key} className="h-5 w-5" />
                              {docFolder.isDefault
                                ? t((FOLDER_LABEL_KEY[docFolder.key] ?? "cat_other") as never)
                                : (docFolder.nameEn ?? "")}
                            </span>
                          )}
                        </p>
                        <SmartTags tags={it.doc.tags} compact />

                        {/* The "Is this for Papa?" one-tap confirmation */}
                        <div className="mt-3 flex flex-wrap items-center gap-2.5">
                          {!it.detected?.memberCertain && (
                            <span className="text-base font-semibold text-ink-soft">{t("member_is_it", { name: memberDisplayName(docMember ?? guessedMember, lang) })}</span>
                          )}
                          <span className="text-base font-bold text-ink-soft">{t("member_who")}</span>
                          {members.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => refile(it.key, it.doc!.id, m.id)}
                              aria-pressed={(it.doc!.memberId ?? guessedMember.id) === m.id}
                              className={`inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-base font-bold ${
                                (it.doc!.memberId ?? guessedMember.id) === m.id
                                  ? "border-leaf bg-leaf text-white"
                                  : "border-warm-border bg-paper hover:bg-straw"
                              }`}
                            >
                              <MemberAvatar member={m} size="sm" />
                              {memberDisplayName(m, lang)}
                            </button>
                          ))}
                          {/* Quick folder hop within the same member */}
                          {docFolders.length > 0 && (
                            <label className="flex items-center gap-2 text-base font-bold text-ink-soft">
                              <FolderDown className="h-5 w-5" aria-hidden />
                              {t("upload_change")}
                              <select
                                value={it.doc.folderId ?? ""}
                                onChange={(e) => refile(it.key, it.doc!.id, (docMember ?? guessedMember).id, docFolders.find((f) => f.id === e.target.value)?.key)}
                                className="min-h-[48px] cursor-pointer rounded-xl border-2 border-warm-border bg-paper px-3 text-base font-bold"
                                aria-label={t("upload_change")}
                              >
                                {docFolders.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.isDefault ? t((FOLDER_LABEL_KEY[f.key] ?? "cat_other") as never) : (f.nameEn ?? "…")}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </PageIn>
  );
}
