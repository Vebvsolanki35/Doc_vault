"use client";

/** All Documents — global explorer across every member and folder. */
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/providers";
import { BackBar, PageIn, type MemberLite } from "@/components/widgets";
import { DocBrowser } from "@/components/doc-browser";

export default function DocumentsPage() {
  const { t } = useLanguage();
  const [members, setMembers] = useState<MemberLite[]>([]);

  useEffect(() => {
    fetch("/api/members").then((r) => (r.ok ? r.json() : { members: [] })).then((d) => setMembers(d.members ?? [])).catch(() => {});
  }, []);

  return (
    <PageIn>
      <BackBar title={t("tile_docs")} />
      <DocBrowser members={members} showMemberChips />
    </PageIn>
  );
}
