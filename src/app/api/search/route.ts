import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { documents, members } from "@/db/schema";
import { isUnlocked, publicDoc, purgeExpiredBin } from "@/lib/vault";
import { parseIntent } from "@/lib/nlp";
import { termVariants } from "@/lib/transliterate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/search?q=पापा की मार्कशीट  →  intent (member + folder + time) + ranked results */
export async function GET(req: NextRequest) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  await purgeExpiredBin();

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ intent: null, results: [] });

  const intent = parseIntent(q);

  // Resolve "papa"/"मम्मी"… to a concrete member row (and the soft "mine" hint)
  const memberRows = await db.select().from(members);
  const memberByKey = new Map(memberRows.map((m) => [m.key, m]));
  const wantedMember = intent.memberKey ? memberByKey.get(intent.memberKey) : undefined;
  const boostMember = intent.memberBoost ? memberByKey.get(intent.memberBoost) : undefined;

  const conds = [isNull(documents.deletedAt)];
  if (intent.folder) conds.push(eq(documents.category, intent.folder));
  if (wantedMember) conds.push(eq(documents.memberId, wantedMember.id));
  if (intent.from) conds.push(gte(documents.createdAt, intent.from));
  if (intent.to) conds.push(lte(documents.createdAt, intent.to));

  const rows = await db
    .select({
      id: documents.id, name: documents.name, mimeType: documents.mimeType, size: documents.size,
      category: documents.category, tags: documents.tags, createdAt: documents.createdAt,
      shareToken: documents.shareToken, sharePasscode: documents.sharePasscode,
      memberId: documents.memberId, folderId: documents.folderId, deletedAt: documents.deletedAt,
      shareExpiresAt: documents.shareExpiresAt, ocrText: documents.ocrText,
    })
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.createdAt))
    .limit(400);

  const ranked = rows
    .map((r) => {
      const hay = `${r.name}\n${r.ocrText}\n${JSON.stringify(r.tags)}`.toLowerCase();
      const nameLow = r.name.toLowerCase();
      let score = 0;
      let hits = 0;
      for (const term of intent.terms) {
        let matched = false;
        for (const t of termVariants(term)) {
          if (t.length < 2) continue;
          if (nameLow.includes(t)) { score += 3; matched = true; break; }
          if (hay.includes(t)) { score += 1; matched = true; break; }
          if (/^\d/.test(t) && hay.includes(t.replace(/[^\d\/-]/g, ""))) { score += 1; matched = true; break; }
        }
        if (matched) hits++;
      }
      if (intent.terms.length > 0 && hits === 0) score = -1;
      if (boostMember && r.memberId === boostMember.id) score += 2;
      return { r, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || b.r.createdAt.getTime() - a.r.createdAt.getTime())
    .slice(0, 30);

  return NextResponse.json({
    intent: {
      folder: intent.folder,
      memberKey: wantedMember?.key ?? boostMember?.key ?? null,
      memberStrict: !!wantedMember,
      from: intent.from?.toISOString() ?? null,
      to: intent.to?.toISOString() ?? null,
      timeLabelKey: intent.timeLabelKey,
      terms: intent.terms,
    },
    results: ranked.map((x) => publicDoc(x.r)),
  });
}
