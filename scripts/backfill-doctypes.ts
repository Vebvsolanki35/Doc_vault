/** One-off: give every existing document a docType (Aadhaar / PAN / Khasra …). Run: npx tsx --env-file=.env scripts/backfill-doctypes.ts */
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { documents } from "../src/db/schema";
import { detectDocType } from "../src/lib/docTypes";

async function main() {
  const rows = await db.select({ id: documents.id, name: documents.name, ocrText: documents.ocrText, docType: documents.docType, tags: documents.tags }).from(documents);
  let n = 0;
  for (const r of rows) {
    if (r.docType && r.docType !== "other") continue;
    const guess = detectDocType(`${r.name}\n${r.ocrText}`);
    let type: string | null = guess?.type ?? null;
    if (!type && r.tags?.cardType) type = ({ Aadhaar: "aadhaar", PAN: "pan", "Voter ID": "voter" } as Record<string, string>)[r.tags.cardType] ?? null;
    if (type) { await db.update(documents).set({ docType: type }).where(eq(documents.id, r.id)); n++; console.log(`  ${r.name} → ${type}`); }
  }
  console.log(`Updated ${n}/${rows.length}`);
  await pool.end();
}
main();
