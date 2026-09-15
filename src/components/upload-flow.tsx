"use client";

/**
 * UPLOAD FLOW v3 — "check, name, save"
 *
 *   pick / drag / camera
 *     → each file becomes a REVIEW CARD (pre-filled by a local quick-scan of the
 *       file name: type, folder, person) where you can RENAME it, pick the
 *       person, folder and type
 *     → Save (one or all) → chunked resumable upload → server SmartScan
 *       (PDF text, tags, member detection) → done card with final placement
 *     → duplicates offer Replace / Keep-both / Skip; offline files wait in the outbox.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Camera, CheckCircle2, CloudUpload, CopyCheck, FileText, ImagePlus, Loader2, Pencil, Save, ScanLine, ScanText, Sparkles, Trash2, Wand2, WifiOff, X,
} from "lucide-react";
import { useLanguage, toast } from "./providers";
import {
  BackBar, FolderIcon, PageIn, SmartTags, MemberAvatar, memberDisplayName, type MemberLite,
} from "./widgets";
import { folderDisplayName, type FolderLite } from "./doc-browser";
import { outboxAdd, outboxList, outboxRemove, type OutboxItem } from "@/lib/outbox";
import { takeScanFiles } from "@/lib/scan/handoff";
import { classify, type FolderKey } from "@/lib/classifier";
import { detectDocType, docTypeLabel, DOC_TYPES, DOC_TYPE_MAP } from "@/lib/docTypes";
import { extOf, stripExt, suggestName } from "@/lib/naming";
import { formatBytes } from "@/lib/numbers";
import type { DocMeta } from "./doc-actions";

const CHUNK = 2 * 1024 * 1024;
const MAX_SIZE = 100 * 1024 * 1024;

type Detected = { folder: FolderKey; docType?: string; confidence: number; memberCertain: boolean; memberKey: string | null };
type Status = "review" | "uploading" | "scanning" | "done" | "error" | "offline" | "duplicate";
type QueueItem = {
  key: string;
  file: File;
  originalName: string;
  preview: string | null;
  status: Status;
  progress: number;
  // editable fields
  name: string; // without extension
  memberId: string | null;
  folderId: string | null; // null → auto
  docType: string; // "auto" | key
  guessedType: string | null;
  // AI / OCR analysis (runs as soon as the file is added)
  analysis?: "pending" | "done" | "failed";
  analysisId?: string | null;
  read?: { engine: string; confidence: number; preview: string; summary: string | null; ai: string | null; memberConfidence: number; tags: Record<string, string | number> | null };
  // results
  doc?: DocMeta;
  detected?: Detected;
  existing?: DocMeta;
  /** server-side error text (e.g. "db:connect: …") when the save failed */
  error?: string | null;
};

type UploadResult = { doc?: DocMeta; detected?: Detected; duplicate?: boolean; existing?: DocMeta };

async function uploadFile(file: File, meta: Record<string, string>, onProgress: (p: number) => void): Promise<UploadResult> {
  const append = (fd: FormData) => {
    fd.append("originalName", file.name);
    fd.append("mime", file.type || "application/octet-stream");
    for (const [k, v] of Object.entries(meta)) if (v) fd.append(k, v);
  };
  const fail = async (res: Response) => {
    const json = await res.json().catch(() => ({}));
    if (res.status === 409) return { duplicate: true, existing: json.existing } as UploadResult;
    throw new Error(String(json.error ?? `upload failed (${res.status})`));
  };
  if (file.size <= CHUNK * 1.5) {
    const fd = new FormData();
    fd.append("file", file);
    append(fd);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) return fail(res);
    const json = await res.json();
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
        if (!res.ok) return await fail(res);
        const json = await res.json();
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

const ACCEPT = "image/*,application/pdf,.heic,.heif";

export default function UploadFlow() {
  const { t, lang } = useLanguage();
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [memberFolders, setMemberFolders] = useState<Record<string, FolderLite[]>>({});
  const [drag, setDrag] = useState(false);
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const membersRef = useRef<MemberLite[]>([]);

  useEffect(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then(async (d) => {
      const list: MemberLite[] = d.members ?? [];
      setMembers(list);
      membersRef.current = list;
      const entries = await Promise.all(
        list.map(async (m) => {
          const res = await fetch(`/api/members/${m.id}/folders`).then((r) => (r.ok ? r.json() : { folders: [] })).catch(() => ({ folders: [] }));
          return [m.id, (res.folders ?? []) as FolderLite[]] as const;
        }),
      );
      setMemberFolders(Object.fromEntries(entries));
    }).catch(() => {});
  }, []);

  const refreshOutbox = useCallback(() => { outboxList().then(setOutbox).catch(() => {}); }, []);

  const update = useCallback((key: string, patch: Partial<QueueItem> | ((it: QueueItem) => Partial<QueueItem>)) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...(typeof patch === "function" ? patch(it) : patch) } : it)));
  }, []);

  /** Local, instant pre-fill from the file name so the review card is already sensible. */
  const quickGuess = useCallback((file: File) => {
    const source = file.name;
    const type = detectDocType(source);
    const folderKey = type?.folder ?? classify(source).folder;
    // person: alias match on file name
    const low = source.toLowerCase();
    const roster = membersRef.current;
    let memberId: string | null = null;
    for (const m of roster) {
      const names = [m.nameEn, m.nameHi].filter((n) => n && n.length > 1).map((n) => n.toLowerCase());
      if (names.some((n) => low.includes(n))) { memberId = m.id; break; }
    }
    return { guessedType: type?.type ?? null, folderKey, memberId };
  }, []);

  /** Let the vault READ the file (OCR + optional AI) and pre-fill the review card. */
  const analyze = useCallback(async (it: QueueItem) => {
    if (it.file.size > 40 * 1024 * 1024) return; // huge files: skip pre-read, server still scans on save
    update(it.key, { analysis: "pending" });
    try {
      const fd = new FormData();
      fd.append("file", it.file);
      fd.append("name", it.file.name);
      fd.append("mime", it.file.type || "application/octet-stream");
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      if (!res.ok) throw new Error();
      const a = await res.json();
      update(it.key, (cur) => {
        // Only overwrite what the user hasn't touched yet
        const untouchedName = cur.name === stripExt(cur.originalName).replace(/[_]+/g, " ").trim();
        return {
          analysis: "done",
          analysisId: a.analysisId,
          guessedType: a.docType && a.docType !== "other" ? a.docType : cur.guessedType,
          docType: cur.docType === "auto" || cur.docType === cur.guessedType ? (a.docType && a.docType !== "other" ? a.docType : "auto") : cur.docType,
          memberId: cur.memberId ?? (a.memberConfidence >= 0.5 ? a.memberId : null),
          name: untouchedName && a.suggestedName && a.confidence >= 0.5 ? stripExt(a.suggestedName) : cur.name,
          read: { engine: a.ocr.engine, confidence: a.ocr.confidence, preview: a.ocr.preview, summary: a.summary, ai: a.ai, memberConfidence: a.memberConfidence, tags: a.tags },
        };
      });
    } catch {
      update(it.key, { analysis: "failed" });
    }
  }, [update]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 20);
    const fresh: QueueItem[] = [];
    for (const file of list) {
      if (file.size > MAX_SIZE) { toast(t("upload_toobig"), "warn"); continue; }
      const key = `${Date.now()}-${file.name}-${Math.random()}`;
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      const g = quickGuess(file);
      fresh.push({
        key, file, originalName: file.name, preview, status: "review", progress: 0,
        name: stripExt(file.name).replace(/[_]+/g, " ").trim(),
        memberId: g.memberId, folderId: null, docType: g.guessedType ?? "auto", guessedType: g.guessedType,
      });
    }
    setItems((prev) => [...fresh, ...prev]);
    for (const it of fresh) analyze(it);
  }, [quickGuess, t, analyze]);


  const buildMeta = (it: QueueItem): Record<string, string> => {
    const ext = extOf(it.originalName);
    return {
      name: `${it.name.trim() || stripExt(it.originalName)}${ext ? "." + ext : ""}`,
      memberId: it.memberId ?? "",
      folderId: it.folderId ?? "",
      docType: it.docType === "auto" ? "" : it.docType,
      analysisId: it.analysisId ?? "",
    };
  };

  const save = useCallback(async (key: string, extra: Record<string, string> = {}) => {
    const it = items.find((x) => x.key === key);
    if (!it) return;
    update(key, { status: "uploading", progress: 0 });
    const meta = { ...buildMeta(it), ...extra };
    try {
      const { doc, detected, duplicate, existing } = await uploadFile(it.file, meta, (p) => update(key, { progress: p, status: p < 1 ? "uploading" : "scanning" }));
      if (duplicate) { update(key, { status: "duplicate", existing }); return; }
      update(key, { status: "scanning" });
      setTimeout(() => update(key, { status: "done", doc, detected }), 900);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!navigator.onLine) {
        await outboxAdd({ id: key, name: meta.name, type: it.file.type, blob: it.file, addedAt: Date.now(), meta }).catch(() => {});
        update(key, { status: "offline" });
        refreshOutbox();
        toast(t("upload_offline"), "warn");
      } else {
        update(key, { status: "error", error: msg });
        toast(msg.startsWith("db:") ? t("upload_db_err") : t("upload_fail"), "warn");
      }
    }
  }, [items, update, refreshOutbox, t]);

  // ── Paper Scanner handoff: finished scans land in the review queue ──
  const handoffDone = useRef(false);
  useEffect(() => {
    if (handoffDone.current) return;
    handoffDone.current = true;
    const handed = takeScanFiles();
    if (!handed.length) return;
    // the scanner already toasted; the review cards announce themselves
    const tm = setTimeout(() => addFiles(handed), 0);
    return () => clearTimeout(tm);
  }, [addFiles]);

  const saveAll = async () => {
    const pending = items.filter((i) => i.status === "review");
    // Save sequentially in small batches so big files don't starve each other
    for (const it of pending) await save(it.key);
  };

  const syncOutbox = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    const pendingItems = await outboxList().catch(() => [] as OutboxItem[]);
    if (pendingItems.length === 0) return;
    setSyncing(true);
    for (const item of pendingItems) {
      try {
        const file = new File([item.blob], item.name, { type: item.type });
        const key = `${Date.now()}-${item.name}-sync`;
        setItems((prev) => [{ key, file, originalName: item.name, preview: null, status: "uploading", progress: 0, name: stripExt(item.name), memberId: item.meta?.memberId || null, folderId: item.meta?.folderId || null, docType: item.meta?.docType || "auto", guessedType: null }, ...prev]);
        const { doc, detected } = await uploadFile(file, item.meta ?? { name: item.name }, (p) => update(key, { progress: p }));
        update(key, { status: "done", doc, detected });
        await outboxRemove(item.id);
      } catch { /* stays queued */ }
    }
    setSyncing(false);
    refreshOutbox();
  }, [syncing, refreshOutbox, update]);

  useEffect(() => {
    refreshOutbox();
    const flush = () => syncOutbox();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [refreshOutbox, syncOutbox]);

  /** After save: one-tap move to another member / folder. */
  const refile = async (key: string, docId: string, targetMemberId: string, targetFolderId?: string) => {
    const folders = memberFolders[targetMemberId] ?? [];
    const it = items.find((i) => i.key === key);
    const wantKey = it?.doc?.category ?? "other";
    const target = (targetFolderId ? folders.find((f) => f.id === targetFolderId) : undefined) ?? folders.find((f) => f.key === wantKey) ?? folders.find((f) => f.key === "other");
    if (!target) return;
    await fetch(`/api/documents/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folderId: target.id }) });
    update(key, (cur) => ({ doc: cur.doc ? { ...cur.doc, memberId: targetMemberId, folderId: target.id, category: target.key === "custom" ? cur.doc.category : target.key } : cur.doc }));
  };

  const renameSaved = async (key: string, docId: string, name: string) => {
    const res = await fetch(`/api/documents/${docId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (res.ok) { update(key, (cur) => ({ doc: cur.doc ? { ...cur.doc, name } : cur.doc })); toast(t("doc_renamed")); }
  };

  const resolveDuplicate = async (item: QueueItem, how: "replace" | "keep" | "skip") => {
    if (how === "skip") { setItems((prev) => prev.filter((it) => it.key !== item.key)); toast(t("ok")); return; }
    const ext = extOf(item.originalName);
    const extra: Record<string, string> = { merge: "1" };
    if (how === "keep") {
      const name = `${item.name} (2)`;
      update(item.key, { name });
      extra.name = `${name}${ext ? "." + ext : ""}`;
    }
    save(item.key, extra);
  };

  const applyToAll = (from: QueueItem) => {
    setItems((prev) => prev.map((it) => (it.status === "review" ? { ...it, memberId: from.memberId, folderId: from.folderId } : it)));
    toast(t("ok"));
  };

  const reviewCount = items.filter((i) => i.status === "review").length;
  const typeOptions = useMemo(() => DOC_TYPES, []);

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

      {/* Drop zone */}
      <motion.div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        animate={drag ? { scale: 1.02 } : { scale: 1 }}
        className={`card relative overflow-hidden border-4 !border-dashed p-8 text-center transition-colors sm:p-12 ${drag ? "!border-saffron bg-saffron-tint" : "!border-warm-border"}`}
      >
        <div className="pointer-events-none absolute -left-10 -top-10 h-44 w-44 rounded-full bg-saffron/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-12 -right-8 h-52 w-52 rounded-full bg-leaf/10 blur-2xl" aria-hidden />
        <motion.div animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-saffron text-white shadow-lift">
          <ScanLine className="h-14 w-14" aria-hidden />
        </motion.div>
        <p className="mx-auto mb-7 max-w-md text-2xl font-bold leading-snug">{t("upload_drop")}</p>
        <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
          <button onClick={() => camRef.current?.click()} className="btn-accent w-full !text-2xl sm:w-auto">
            <Camera className="h-8 w-8" aria-hidden /> {t("upload_camera")}
          </button>
          <button onClick={() => router.push("/scan")} className="btn-primary w-full !text-2xl sm:w-auto">
            <ScanText className="h-8 w-8" aria-hidden /> {t("tile_scanpaper")}
          </button>
          <button onClick={() => pickRef.current?.click()} className="btn-ghost w-full !text-2xl sm:w-auto">
            <ImagePlus className="h-8 w-8" aria-hidden /> {t("upload_choose")}
          </button>
        </div>
        <p className="mt-5 text-lg text-ink-soft">{t("upload_or")}</p>
        <p className="mt-1 text-base font-semibold text-ink-soft">{t("upload_size_note", { max: "100 MB" })}</p>
        <input ref={pickRef} type="file" multiple accept={ACCEPT} className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} aria-hidden />
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} aria-hidden />
      </motion.div>

      {/* Review header + Save all */}
      <AnimatePresence>
        {reviewCount > 0 && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="sticky top-[92px] z-30 mt-8 flex flex-wrap items-center justify-between gap-3 rounded-3xl border-2 border-leaf bg-leaf-tint/95 p-4 shadow-soft backdrop-blur">
            <div>
              <p className="text-xl font-bold text-leaf-deep">{t("upload_ready_title")}</p>
              <p className="text-base text-ink-soft">{t("upload_ready_sub")}</p>
            </div>
            <button onClick={saveAll} className="btn-primary !text-xl">
              <Save className="h-7 w-7" aria-hidden /> {t("upload_save_all", { n: reviewCount })}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6 space-y-4">
        <AnimatePresence>
          {items.map((it) => {
            const borderTone = it.status === "done" ? "!border-leaf" : it.status === "duplicate" ? "!border-saffron" : it.status === "error" ? "!border-danger" : it.status === "review" ? "!border-warm-border" : "";
            return (
              <motion.div key={it.key} layout initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className={`card p-5 ${borderTone}`}>
                {it.status === "review" ? (
                  <ReviewCard
                    item={it} members={members} memberFolders={memberFolders} typeOptions={typeOptions}
                    onChange={(patch) => update(it.key, patch)}
                    onSave={() => save(it.key)}
                    onRemove={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                    onApplyAll={() => applyToAll(it)}
                    t={t} lang={lang}
                  />
                ) : (
                  <ProgressCard
                    item={it} members={members} memberFolders={memberFolders}
                    onRefile={(mId, fId) => it.doc && refile(it.key, it.doc.id, mId, fId)}
                    onRename={(name) => it.doc && renameSaved(it.key, it.doc.id, name)}
                    onDuplicate={(how) => resolveDuplicate(it, how)}
                    onRetry={() => save(it.key)}
                    onDismiss={() => setItems((prev) => prev.filter((x) => x.key !== it.key))}
                    t={t} lang={lang}
                  />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </PageIn>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────
type T = ReturnType<typeof useLanguage>["t"];

function Thumb({ item }: { item: QueueItem }) {
  return (
    <div className="relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-2xl bg-straw">
      {item.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-soft">
          {item.status === "done" && item.doc ? <FolderIcon folder={item.doc.category} className="h-9 w-9 text-leaf" /> : <FileText className="h-9 w-9" aria-hidden />}
          <span className="text-xs font-bold uppercase">{extOf(item.originalName)}</span>
        </div>
      )}
      {(item.status === "uploading" || item.status === "scanning") && (
        <span className="absolute inset-x-1 h-1 rounded bg-saffron shadow-[0_0_14px_2px_rgba(217,106,0,0.7)]" style={{ animation: "var(--animate-scanline)" }} aria-hidden />
      )}
    </div>
  );
}

function ReviewCard({ item, members, memberFolders, typeOptions, onChange, onSave, onRemove, onApplyAll, t, lang }: {
  item: QueueItem; members: MemberLite[]; memberFolders: Record<string, FolderLite[]>; typeOptions: typeof DOC_TYPES;
  onChange: (p: Partial<QueueItem>) => void; onSave: () => void; onRemove: () => void; onApplyAll: () => void; t: T; lang: "en" | "hi";
}) {
  const ext = extOf(item.originalName);
  const folders = item.memberId ? memberFolders[item.memberId] ?? [] : [];
  const member = members.find((m) => m.id === item.memberId);
  const effectiveType = item.docType === "auto" ? item.guessedType : item.docType;
  const suggested = suggestName(member ? memberDisplayName(member, lang) : null, effectiveType ? docTypeLabel(effectiveType, lang) : null, item.originalName);
  // Auto folder hint when none picked
  const autoFolderKey = effectiveType ? DOC_TYPE_MAP[effectiveType]?.folder : classify(item.originalName).folder;
  const autoFolder = folders.find((f) => f.key === autoFolderKey) ?? folders.find((f) => f.key === "other");

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <Thumb item={item} />
      <div className="min-w-0 flex-1 space-y-4">
        {/* What the vault read */}
        {item.analysis === "pending" && (
          <p className="flex items-center gap-2 rounded-2xl bg-saffron-tint px-4 py-3 text-lg font-bold text-saffron-deep">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden /> {t("ai_reading")}
          </p>
        )}
        {item.analysis === "done" && item.read && (
          <div className="rounded-2xl bg-leaf-tint/70 px-4 py-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-lg font-bold text-leaf-deep">
              <Sparkles className="h-6 w-6" aria-hidden />
              {item.read.engine === "none" || !item.read.preview ? t("ai_read_nothing") : t("ai_read_done", { pct: Math.round(item.read.confidence) })}
              {item.read.ai && <span className="rounded-full bg-paper px-2 py-0.5 text-sm">AI · {item.read.ai}</span>}
            </p>
            {item.read.summary && <p className="mt-1 text-base text-ink">{item.read.summary}</p>}
            {item.read.tags && <SmartTags tags={item.read.tags} compact />}
            {item.read.preview && (
              <details className="mt-1 text-sm text-ink-soft">
                <summary className="cursor-pointer font-semibold">{t("ai_show_text")}</summary>
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-sans">{item.read.preview}</pre>
              </details>
            )}
          </div>
        )}
        {/* Name */}
        <div>
          <label className="mb-1 flex items-center gap-2 text-base font-bold text-ink-soft" htmlFor={`name-${item.key}`}>
            <Pencil className="h-5 w-5" aria-hidden /> {t("doc_name")}
            <span className="ml-auto text-sm font-semibold">{formatBytes(item.file.size)}</span>
          </label>
          <div className="flex items-stretch gap-2">
            <input
              id={`name-${item.key}`}
              value={item.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder={t("upload_name_ph")}
              className="min-h-[56px] w-full rounded-2xl border-2 border-warm-border bg-cream px-4 text-xl font-bold focus:border-saffron focus:outline-none"
              maxLength={150}
            />
            {ext && <span className="flex items-center rounded-2xl bg-straw px-3 text-lg font-bold text-ink-soft">.{ext}</span>}
          </div>
          {suggested !== item.originalName && stripExt(suggested) !== item.name && (
            <button onClick={() => onChange({ name: stripExt(suggested) })} className="mt-2 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl bg-saffron-tint px-3 text-base font-bold text-saffron-deep hover:bg-saffron/20">
              <Wand2 className="h-5 w-5" aria-hidden /> {t("upload_suggest_name")}: “{stripExt(suggested)}”
            </button>
          )}
        </div>

        {/* Person */}
        <div>
          <p className="mb-2 text-base font-bold text-ink-soft">{t("upload_person")}</p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = item.memberId === m.id;
              return (
                <button key={m.id} onClick={() => onChange({ memberId: m.id, folderId: null })} aria-pressed={on}
                  className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold transition-all ${on ? "border-leaf bg-leaf text-white shadow-soft" : "border-warm-border bg-paper hover:bg-straw"}`}>
                  <MemberAvatar member={m} size="sm" /> {memberDisplayName(m, lang)}
                </button>
              );
            })}
            <button onClick={() => onChange({ memberId: null, folderId: null })} aria-pressed={!item.memberId}
              className={`inline-flex min-h-[52px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-lg font-bold transition-all ${!item.memberId ? "border-saffron bg-saffron-tint text-saffron-deep" : "border-warm-border bg-paper hover:bg-straw"}`}>
              <Sparkles className="h-5 w-5" aria-hidden /> {t("upload_auto")}
            </button>
          </div>
        </div>

        {/* Type + Folder */}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-base font-bold text-ink-soft">{t("upload_type")}</span>
            <select value={item.docType} onChange={(e) => onChange({ docType: e.target.value, folderId: null })}
              className="min-h-[56px] w-full cursor-pointer rounded-2xl border-2 border-warm-border bg-paper px-3 text-lg font-bold">
              <option value="auto">{t("upload_auto")}{item.guessedType ? ` (${docTypeLabel(item.guessedType, lang)})` : ""}</option>
              {typeOptions.map((d) => <option key={d.key} value={d.key}>{lang === "hi" ? d.hi : d.en}</option>)}
              <option value="other">{t("doc_type_other")}</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-base font-bold text-ink-soft">{t("upload_folder")}</span>
            <select value={item.folderId ?? ""} onChange={(e) => onChange({ folderId: e.target.value || null })} disabled={!item.memberId}
              className="min-h-[56px] w-full cursor-pointer rounded-2xl border-2 border-warm-border bg-paper px-3 text-lg font-bold disabled:opacity-60">
              <option value="">{t("upload_auto")}{autoFolder ? ` (${folderDisplayName(autoFolder, lang, t as never)})` : ""}</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{folderDisplayName(f, lang, t as never)}</option>)}
            </select>
          </label>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={onSave} className="btn-primary !text-xl"><Save className="h-6 w-6" aria-hidden /> {t("upload_save")}</button>
          <button onClick={onApplyAll} className="btn-ghost !text-base"><CopyCheck className="h-5 w-5" aria-hidden /> {t("upload_apply_all")}</button>
          <button onClick={onRemove} className="btn-ghost ml-auto !text-base text-danger"><Trash2 className="h-5 w-5" aria-hidden /> {t("upload_remove")}</button>
        </div>
      </div>
    </div>
  );
}

function ProgressCard({ item, members, memberFolders, onRefile, onRename, onDuplicate, onRetry, onDismiss, t, lang }: {
  item: QueueItem; members: MemberLite[]; memberFolders: Record<string, FolderLite[]>;
  onRefile: (memberId: string, folderId?: string) => void; onRename: (name: string) => void;
  onDuplicate: (how: "replace" | "keep" | "skip") => void; onRetry: () => void; onDismiss: () => void; t: T; lang: "en" | "hi";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const docMember = members.find((m) => m.id === item.doc?.memberId);
  const docFolders = docMember ? memberFolders[docMember.id] ?? [] : [];
  const docFolder = docFolders.find((f) => f.id === item.doc?.folderId);
  const shownName = item.doc?.name ?? `${item.name}${extOf(item.originalName) ? "." + extOf(item.originalName) : ""}`;

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Thumb item={item} />
      <div className="min-w-0 flex-1">
        {editing && item.doc ? (
          <div className="flex items-stretch gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { onRename(`${draft}.${extOf(shownName)}`); setEditing(false); } if (e.key === "Escape") setEditing(false); }}
              className="min-h-[52px] w-full rounded-2xl border-2 border-saffron bg-cream px-4 text-xl font-bold focus:outline-none" />
            <button onClick={() => { onRename(`${draft}.${extOf(shownName)}`); setEditing(false); }} className="btn-primary !min-h-[52px] !px-4 !text-base">{t("set_save")}</button>
            <button onClick={() => setEditing(false)} className="btn-icon" aria-label={t("docs_cancel")}><X className="h-6 w-6" aria-hidden /></button>
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-xl font-bold">
            <span className="break-all">{shownName}</span>
            {item.status === "done" && item.doc && (
              <button onClick={() => { setDraft(stripExt(shownName)); setEditing(true); }} className="inline-flex min-h-[40px] cursor-pointer items-center gap-1 rounded-xl px-2 text-base font-bold text-saffron-deep hover:bg-saffron-tint" aria-label={t("doc_rename")}>
                <Pencil className="h-5 w-5" aria-hidden /> {t("doc_rename")}
              </button>
            )}
          </p>
        )}

        {item.status === "uploading" && (
          <div className="mt-2">
            <div className="h-4 w-full overflow-hidden rounded-full bg-straw" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-leaf transition-all duration-300" style={{ width: `${Math.max(2, Math.round(item.progress * 100))}%` }} />
            </div>
            <p className="mt-1 text-base font-semibold text-ink-soft">{t("upload_saving")} {Math.round(item.progress * 100)}% · {formatBytes(item.file.size)}</p>
          </div>
        )}
        {item.status === "scanning" && (
          <p className="mt-2 flex items-center gap-2 text-lg font-bold text-saffron-deep"><Sparkles className="h-6 w-6" aria-hidden /> {t("upload_scanning")}</p>
        )}
        {item.status === "offline" && <p className="mt-2 flex items-center gap-2 text-lg font-bold text-saffron-deep"><WifiOff className="h-6 w-6" aria-hidden /> {t("upload_offline")}</p>}
        {item.status === "error" && (
          <div className="mt-2">
            <p className="text-lg font-bold text-danger">{item.error?.startsWith("db:") ? t("upload_db_err") : t("upload_fail")}</p>
            {item.error && <p className="mt-1 break-words rounded-xl bg-danger-tint px-3 py-2 font-mono text-sm text-danger">{item.error}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button onClick={onRetry} className="btn-ghost !min-h-[48px] !text-base">{t("upload_save")}</button>
              <button onClick={onDismiss} className="btn-ghost !min-h-[48px] !text-base">{t("upload_remove")}</button>
            </div>
          </div>
        )}

        {item.status === "duplicate" && (
          <div className="mt-3 rounded-2xl bg-saffron-tint p-4">
            <p className="flex items-center gap-2 text-lg font-bold text-saffron-deep"><CopyCheck className="h-6 w-6" aria-hidden /> {t("dup_title")}</p>
            <p className="mt-1 text-base text-ink-soft">{t("dup_body", { name: item.existing?.name ?? "" })}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={() => onDuplicate("replace")} className="btn-primary !min-h-[52px] !text-base">{t("dup_replace")}</button>
              <button onClick={() => onDuplicate("keep")} className="btn-ghost !min-h-[52px] !text-base">{t("dup_keep_both")}</button>
              <button onClick={() => onDuplicate("skip")} className="btn-ghost !min-h-[52px] !text-base">{t("dup_skip")}</button>
            </div>
          </div>
        )}

        {item.status === "done" && item.doc && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
            <p className="flex flex-wrap items-center gap-2 text-lg font-bold text-leaf-deep">
              <CheckCircle2 className="h-6 w-6" aria-hidden /> {t("upload_saved_in")}
              {docMember && <span className="inline-flex items-center gap-1.5 rounded-full bg-straw px-3 py-1"><MemberAvatar member={docMember} size="sm" />{memberDisplayName(docMember, lang)}</span>}
              {docFolder && <span className="inline-flex items-center gap-1.5 rounded-full bg-leaf-tint px-3 py-1"><FolderIcon folder={docFolder.isDefault ? docFolder.key : "custom"} className="h-5 w-5" />{folderDisplayName(docFolder, lang, t as never)}</span>}
              {item.doc.docType && item.doc.docType !== "other" && <span className="rounded-full bg-[#e0ecfa] px-3 py-1 text-[#1d4e77]">{docTypeLabel(item.doc.docType, lang)}</span>}
            </p>
            <SmartTags tags={item.doc.tags} compact />
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              {!item.detected?.memberCertain && docMember && (
                <span className="text-base font-semibold text-ink-soft">{t("member_is_it", { name: memberDisplayName(docMember, lang) })}</span>
              )}
              <span className="text-base font-bold text-ink-soft">{t("member_who")}</span>
              {members.map((m) => (
                <button key={m.id} onClick={() => onRefile(m.id)} aria-pressed={item.doc!.memberId === m.id}
                  className={`inline-flex min-h-[48px] cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 text-base font-bold ${item.doc!.memberId === m.id ? "border-leaf bg-leaf text-white" : "border-warm-border bg-paper hover:bg-straw"}`}>
                  <MemberAvatar member={m} size="sm" /> {memberDisplayName(m, lang)}
                </button>
              ))}
              {docFolders.length > 0 && docMember && (
                <select value={item.doc.folderId ?? ""} onChange={(e) => onRefile(docMember.id, e.target.value)} aria-label={t("upload_change")}
                  className="min-h-[48px] cursor-pointer rounded-xl border-2 border-warm-border bg-paper px-3 text-base font-bold">
                  {docFolders.map((f) => <option key={f.id} value={f.id}>{folderDisplayName(f, lang, t as never)}</option>)}
                </select>
              )}
            </div>
            <p className="mt-2 text-sm text-ink-soft">{t("upload_edit_after")}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
