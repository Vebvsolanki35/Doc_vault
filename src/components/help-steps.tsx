"use client";

/**
 * Help theatre — four looping, self-playing animated micro-stories.
 * Comprehension needs zero reading: icons act out each step.
 */
import { motion } from "framer-motion";
import { Camera, FolderOpen, Landmark, Mic, MousePointerClick, ScanLine, Sparkles } from "lucide-react";
import { useLanguage } from "./providers";
import { BackBar, PageIn } from "./widgets";
import type { DictKey } from "@/lib/i18n";

type Step = { key: DictKey; art: React.ReactNode };

function StepFrame({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  const { t } = useLanguage();
  return (
    <div className="card flex flex-col items-center gap-5 p-6 text-center sm:p-8">
      <span className="chip !bg-leaf-tint !text-leaf-deep">{t("help_step")} {n}</span>
      <div className="relative flex h-48 w-full items-center justify-center overflow-hidden rounded-3xl bg-cream">{children}</div>
      <p className="text-2xl font-bold leading-snug">{title}</p>
    </div>
  );
}

export default function HelpSteps() {
  const { t } = useLanguage();

  const steps: Step[] = [
    {
      key: "help_1",
      art: (
        <>
          <motion.div
            animate={{ scale: [1, 1.06, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-24 w-24 items-center justify-center rounded-3xl bg-saffron text-white shadow-lift"
          >
            <Camera className="h-14 w-14" aria-hidden />
          </motion.div>
          <motion.div
            initial={{ x: -70, y: 60, opacity: 0 }}
            animate={{ x: [-70, 18, 18, -70], y: [60, 8, 8, 60], opacity: [0, 1, 1, 0], scale: [1, 1, 0.7, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            className="absolute text-leaf-deep"
          >
            <MousePointerClick className="h-12 w-12" aria-hidden />
          </motion.div>
        </>
      ),
    },
    {
      key: "help_2",
      art: (
        <div className="relative">
          <motion.div
            animate={{ y: [0, -8, 0], rotate: [-3, 3, -3] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-28 w-24 items-center justify-center rounded-2xl border-4 border-warm-border bg-paper shadow-soft"
          >
            <ScanLine className="h-12 w-12 text-saffron" aria-hidden />
          </motion.div>
          <motion.div
            animate={{ y: [36, -36, 36] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute inset-x-0 top-1/2 h-1 rounded bg-saffron shadow-[0_0_16px_3px_rgba(217,106,0,0.75)]"
            aria-hidden
          />
        </div>
      ),
    },
    {
      key: "help_3",
      art: (
        <div className="flex items-center gap-6">
          <motion.div
            animate={{ x: [0, 34, 34, 0], opacity: [1, 1, 0, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <Sparkles className="h-12 w-12 text-saffron" aria-hidden />
          </motion.div>
          <div className="relative">
            <FolderOpen className="h-24 w-24 text-leaf" aria-hidden />
            <motion.div
              initial={{ opacity: 0, y: -14 }}
              animate={{ opacity: [0, 1, 1, 0], y: [-14, 10, 10, -14] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -right-3 -top-3 rounded-2xl bg-leaf-tint p-2"
            >
              <Landmark className="h-8 w-8 text-leaf-deep" aria-hidden />
            </motion.div>
          </div>
        </div>
      ),
    },
    {
      key: "help_4",
      art: (
        <div className="relative flex items-center justify-center">
          <motion.span
            animate={{ scale: [1, 1.9], opacity: [0.55, 0] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: [0.4, 0, 0.2, 1] }}
            className="absolute h-24 w-24 rounded-full bg-saffron"
            aria-hidden
          />
          <div className="relative flex h-24 w-24 items-center justify-center rounded-full bg-leaf text-white shadow-lift">
            <Mic className="h-12 w-12" aria-hidden />
          </div>
          <div className="ml-5 flex items-end gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <motion.span
                key={i}
                animate={{ height: [10, 26 - i * 3, 12, 30 - i * 4, 10] }}
                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.13, ease: "easeInOut" }}
                className="w-2 rounded-full bg-leaf-deep"
              />
            ))}
          </div>
        </div>
      ),
    },
  ];

  return (
    <PageIn>
      <BackBar title={t("tile_help")} />
      <p className="mb-8 text-xl text-ink-soft">{t("help_title")}</p>
      <div className="grid gap-6 sm:grid-cols-2">
        {steps.map((s, i) => (
          <motion.div key={s.key} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.12 }}>
            <StepFrame n={i + 1} title={t(s.key)}>{s.art}</StepFrame>
          </motion.div>
        ))}
      </div>
    </PageIn>
  );
}
