"use client";

/**
 * Find Anything — hybrid voice + text search across ALL members & folders.
 * Understands "पापा की मार्कशीट", "Show Mummy's Aadhaar", "खसरा 245"…
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, FolderOpen, Loader2, Mic, MicOff, Search, User, X } from "lucide-react";
import { useLanguage, toast } from "@/components/providers";
import { BackBar, PageIn, FOLDER_LABEL_KEY, MemberAvatar, type MemberLite } from "@/components/widgets";
import { DocumentCard, type DocMeta } from "@/components/doc-actions";
import type { FolderKey } from "@/lib/classifier";
import type { DictKey } from "@/lib/i18n";

type Intent = {
  folder: FolderKey | null;
  memberKey: string | null;
  memberStrict: boolean;
  timeLabelKey: DictKey | null;
  terms: string[];
} | null;

type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
declare global {
  interface Window {
    SpeechRecognition?: new () => SR;
    webkitSpeechRecognition?: new () => SR;
  }
}

export default function SearchPage() {
  const { t, lang } = useLanguage();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DocMeta[] | null>(null);
  const [intent, setIntent] = useState<Intent>(null);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<SR | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members ?? [])).catch(() => {});
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setIntent(null); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      setResults(json.results ?? []);
      setIntent(json.intent ?? null);
    } catch { toast(t("error_generic"), "warn"); }
    setBusy(false);
  }, [t]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 420);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, runSearch]);

  const toggleMic = useCallback(() => {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) { toast(t("search_novoice"), "warn"); return; }
    const rec = new Ctor();
    rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const alt = e.results[i]?.[0];
        if (alt) text += alt.transcript;
      }
      setQuery(text.trim());
      if (text.trim()) runSearch(text.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, lang, runSearch, t]);

  useEffect(() => () => recRef.current?.abort(), []);

  const intentMember = members.find((m) => m.key === intent?.memberKey);

  return (
    <PageIn>
      <BackBar title={t("search_title")} />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card flex items-center gap-3 p-3 sm:p-4">
        <Search className="ml-2 h-8 w-8 shrink-0 text-saffron-deep" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search_placeholder")}
          aria-label={t("search_placeholder")}
          className="min-h-[64px] min-w-0 flex-1 rounded-xl bg-transparent px-2 text-2xl font-semibold placeholder:text-ink-soft/60 focus:outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(""); setResults(null); setIntent(null); }} className="btn-icon !h-[56px] !w-[56px]" aria-label={t("docs_cancel")}>
            <X className="h-6 w-6" aria-hidden />
          </button>
        )}
        <button
          onClick={toggleMic}
          aria-pressed={listening}
          aria-label={listening ? t("search_listening") : t("search_tap_mic")}
          className={`relative flex h-[72px] w-[72px] shrink-0 cursor-pointer items-center justify-center rounded-3xl text-white shadow-lift transition-all active:scale-95 ${
            listening ? "bg-danger" : "bg-leaf hover:bg-leaf-deep"
          }`}
        >
          {listening && <span className="absolute inset-0 rounded-3xl bg-danger" style={{ animation: "var(--animate-pulse-ring)" }} aria-hidden />}
          {listening ? <MicOff className="relative h-9 w-9" aria-hidden /> : <Mic className="relative h-9 w-9" aria-hidden />}
        </button>
      </motion.div>

      <p className="mt-3 min-h-[2rem] pl-2 text-lg font-semibold text-saffron-deep" aria-live="polite">
        {listening ? t("search_listening") : ""}
      </p>

      {!query && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mt-4">
          <p className="mb-3 text-lg font-bold text-ink-soft">{t("search_hint")}</p>
          <div className="flex flex-wrap gap-3">
            {(["search_example_1", "search_example_2", "search_example_3"] as const).map((k) => (
              <button key={k} onClick={() => setQuery(t(k))} className="chip min-h-[56px] cursor-pointer text-lg hover:!bg-straw">
                <Mic className="h-5 w-5 text-saffron-deep" aria-hidden /> {t(k)}
              </button>
            ))}
          </div>
        </motion.div>
      )}

      <AnimatePresence>
        {intent && (intent.folder || intent.timeLabelKey || intent.memberKey) && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mb-5 mt-5 flex flex-wrap gap-3">
            {intentMember && (
              <span className="chip !bg-leaf-tint !text-leaf-deep text-lg">
                <User className="h-5 w-5" aria-hidden />
                {t("search_intent_member")}: <b>{lang === "hi" ? intentMember.nameHi : intentMember.nameEn}</b>
                <MemberAvatar member={intentMember} size="sm" />
              </span>
            )}
            {intent.folder && (
              <span className="chip !bg-leaf-tint !text-leaf-deep text-lg">
                <FolderOpen className="h-5 w-5" aria-hidden />
                {t("search_intent_cat")}: <b>{t((FOLDER_LABEL_KEY[intent.folder] ?? "cat_other") as never)}</b>
              </span>
            )}
            {intent.timeLabelKey && (
              <span className="chip !bg-leaf-tint !text-leaf-deep text-lg">
                <CalendarDays className="h-5 w-5" aria-hidden />
                {t("search_intent_time")}: <b>{t(intent.timeLabelKey)}</b>
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-6">
        {busy && (
          <p className="flex items-center justify-center gap-3 p-8 text-xl font-bold text-ink-soft">
            <Loader2 className="h-7 w-7 animate-spin text-saffron" aria-hidden /> {t("loading")}
          </p>
        )}
        {!busy && results && results.length > 0 && (
          <>
            <p className="mb-4 font-display text-2xl font-bold text-leaf-deep">{t("search_results", { n: results.length })}</p>
            <div className="space-y-4">
              {results.map((d) => (
                <DocumentCard key={d.id} doc={d} members={members} selectMode={false} selected={false} onToggleSelect={() => {}} onChanged={() => runSearch(query)} />
              ))}
            </div>
          </>
        )}
        {!busy && results && results.length === 0 && (
          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="card p-10 text-center">
            <h2 className="font-display text-3xl font-bold">{t("search_none")}</h2>
            <p className="mt-2 text-xl text-ink-soft">{t("search_none_sub")}</p>
          </motion.div>
        )}
      </div>
    </PageIn>
  );
}
