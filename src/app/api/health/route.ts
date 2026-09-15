import { db } from "@/db";
import { sql } from "drizzle-orm";
import { aiConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const smart = {
    ocr: process.env.OCR_DISABLED !== "1",
    ocrLangs: process.env.OCR_LANGS || "eng+hin",
    ai: aiConfigured(),
    aiModel: aiConfigured() ? process.env.AI_MODEL ?? null : null,
  };
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, smart });
  } catch {
    return Response.json({ ok: false, smart }, { status: 500 });
  }
}
