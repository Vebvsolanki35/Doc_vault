/**
 * Re-read every document in the vault with OCR (+AI if configured) and fill
 * in doc types / tags / searchable text. Safe to re-run; never moves files
 * unless --move is given (then it moves when the person is detected confidently).
 * Run:  npx tsx --env-file=.env scripts/reanalyze-all.ts [--move]
 */
import { eq, isNull } from "drizzle-orm";
import { db, pool } from "../src/db";
import { documents } from "../src/db/schema";
import { analyzeDocument } from "../src/lib/analyze";
import { findFolder, getRoster } from "../src/lib/vault";

async function main() {
  const move = process.argv.includes("--move");
  const roster = await getRoster();
  const rows = await db.select().from(documents).where(isNull(documents.deletedAt));
  console.log(`Reading ${rows.length} documents…`);
  for (const d of rows) {
    const a = await analyzeDocument(d.fileData as Buffer, d.mimeType, d.name, roster);
    const member = a.memberKey ? roster.find((m) => m.key === a.memberKey) : null;
    const patch: Partial<typeof documents.$inferInsert> = {
      docType: a.docType, tags: { ...d.tags, ...a.tags, ...(a.summary ? { summary: a.summary } : {}) }, ocrText: a.ocrText.slice(0, 20000), updatedAt: new Date(),
    };
    let moved = "";
    if (move && member && a.memberConfidence >= 0.6) {
      const f = await findFolder(member.id, a.folder);
      if (f && f.id !== d.folderId) { patch.folderId = f.id; patch.memberId = member.id; patch.category = f.key === "custom" ? d.category : f.key; moved = ` → moved to ${member.key}/${f.key}`; }
    }
    await db.update(documents).set(patch).where(eq(documents.id, d.id));
    console.log(`  ${d.name}: ${a.docType} (${a.engine}, ${Math.round(a.ocrConfidence)}%)${member ? ` person=${member.key}` : ""}${a.ai ? ` ai=${a.ai}` : ""}${moved}`);
  }
  await pool.end();
  process.exit(0);
}
main();
