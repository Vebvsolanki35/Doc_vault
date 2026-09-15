import { getPool } from "@/db";
import { aiConfigured } from "@/lib/ai";
import { getSharp, imageEngineErrorText } from "@/lib/imageEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tables the application needs (src/db/schema.ts). */
const REQUIRED_TABLES = ["members", "folders", "documents", "audit_logs", "settings"];

/**
 * GET /api/health → deployment diagnostics.
 *
 * Kept cheap enough for the 20-second watchdog in the UI, but explicit about
 * *why* something is broken, so a production problem never has to be guessed:
 *   db.code = db:config  → DATABASE_URL missing/empty
 *             db:connect → database unreachable (wrong host/SSL/credentials)
 *             db:schema  → reachable, but tables are missing → run
 *                          `npx drizzle-kit push`
 *   imageEngine.ok = false → the native sharp/libvips files are missing from
 *             the deployment bundle (see next.config.ts)
 */
export async function GET() {
  // ── Database: can we connect, and is the schema there? ──
  let db: {
    ok: boolean;
    code: string | null;
    error: string | null;
    missingTables: string[];
  } = { ok: false, code: null, error: null, missingTables: [] };

  try {
    const { rows } = await getPool().query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missingTables = REQUIRED_TABLES.filter((t) => !present.has(t));
    db = {
      ok: missingTables.length === 0,
      code: missingTables.length === 0 ? null : "db:schema",
      error: missingTables.length === 0 ? null : `missing tables: ${missingTables.join(", ")} (run: npx drizzle-kit push)`,
      missingTables,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = e instanceof Error && e.name === "DatabaseConfigError" ? "db:config" : "db:connect";
    db = { ok: false, code, error: msg.slice(0, 300), missingTables: [] };
  }

  // ── Image engine (sharp + libvips): the native part of OCR/conversion ──
  let imageEngine: { ok: boolean; error: string | null } = { ok: true, error: null };
  try {
    await getSharp();
  } catch (e) {
    imageEngine = { ok: false, error: imageEngineErrorText(e) };
  }

  const smart = {
    ocr: process.env.OCR_DISABLED !== "1",
    ocrLangs: process.env.OCR_LANGS || "eng+hin",
    ai: aiConfigured(),
    aiModel: aiConfigured() ? process.env.AI_MODEL ?? null : null,
    imageEngine,
  };

  const ok = db.ok && imageEngine.ok;
  return Response.json({ ok, smart, db, imageEngine }, { status: ok ? 200 : 503 });
}
