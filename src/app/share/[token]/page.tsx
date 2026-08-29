"use client";

/**
 * QR landing page — the flow when Dad (or the Patwari) scans a printed QR:
 * enter the big 4-digit viewer password → see / save the document.
 * Lives outside the vault lock; the passcode is the only key.
 */
import { use, useState } from "react";
import { motion } from "framer-motion";
import { Download, Eye, FileText, QrCode, Share2, Vault } from "lucide-react";
import { useLanguage } from "@/components/providers";
import { PageIn, SmartTags } from "@/components/widgets";
import { PinPad } from "@/components/lock";
import { fileUrl, isImageDoc, type DocMeta } from "@/components/doc-actions";
import { formatBytes } from "@/lib/numbers";

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { t } = useLanguage();
  const [doc, setDoc] = useState<DocMeta | null>(null);
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const tryOpen = async (pin: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/share/${token}?p=${encodeURIComponent(pin)}`);
      if (res.status === 410) {
        setExpired(true);
        return;
      }
      if (!res.ok) throw new Error();
      const json = await res.json();
      setDoc(json.document);
      setPass(pin);
      setError(null);
    } catch {
      setError(t("share_wrong"));
      setShake((k) => k + 1);
    }
    setBusy(false);
  };

  const auth = `share=${encodeURIComponent(token)}&p=${encodeURIComponent(pass)}`;

  return (
    <PageIn>
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="mb-4 flex h-20 w-20 items-center justify-center rounded-[1.6rem] bg-leaf text-cream shadow-lift">
            <Share2 className="h-10 w-10" aria-hidden />
          </motion.span>
          <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("share_open_title")}</h1>
        </div>

        {expired ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-6 text-center sm:p-10">
            <span className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-danger-tint text-danger">
              <QrCode className="h-10 w-10" aria-hidden />
            </span>
            <p className="text-2xl font-bold text-danger">{t("share_expired")}</p>
          </motion.div>
        ) : !doc ? (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="card p-6 sm:p-10">
            <p className="mb-8 flex items-center justify-center gap-3 text-center text-2xl font-bold">
              <QrCode className="h-8 w-8 text-saffron-deep" aria-hidden />
              {t("share_enter")}
            </p>
            <PinPad onComplete={tryOpen} error={error} shakeKey={shake} />
            {busy && <p className="mt-4 text-center text-lg text-ink-soft">{t("loading")}</p>}
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden p-0">
            <div className="max-h-[420px] overflow-hidden bg-straw">
              {isImageDoc(doc.mimeType) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${fileUrl(doc)}?${auth}`} alt={doc.name} className="max-h-[420px] w-full object-contain" />
              ) : (
                <div className="flex h-56 flex-col items-center justify-center gap-2 text-danger">
                  <FileText className="h-16 w-16" aria-hidden />
                  <span className="text-xl font-bold">PDF</span>
                </div>
              )}
            </div>
            <div className="p-6 sm:p-8">
              <h2 className="break-words font-display text-2xl font-bold sm:text-3xl">{doc.name}</h2>
              <p className="mt-1 text-lg text-ink-soft">{formatBytes(doc.size)}</p>
              <SmartTags tags={doc.tags} />
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {isImageDoc(doc.mimeType) && (
                  <a href={`${fileUrl(doc)}?${auth}`} target="_blank" rel="noreferrer" className="btn-primary !text-2xl">
                    <Eye className="h-7 w-7" aria-hidden /> {t("share_open")}
                  </a>
                )}
                <a href={`${fileUrl(doc)}?${auth}&download=1`} className="btn-accent !text-2xl">
                  <Download className="h-7 w-7" aria-hidden /> {t("share_download")}
                </a>
              </div>
            </div>
          </motion.div>
        )}

        <p className="mt-10 flex items-center justify-center gap-2 text-center text-lg text-ink-soft">
          <Vault className="h-5 w-5" aria-hidden /> Smart Tijori — स्मार्ट तिजोरी
        </p>
      </div>
    </PageIn>
  );
}
