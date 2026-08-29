import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { audit, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** POST { expiresInHours?: number | null } → create/reveal QR token + passcode + optional expiry. */
export async function POST(req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { expiresInHours?: number | null };
  const rows = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const doc = rows[0];
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const token = doc.shareToken ?? randomBytes(16).toString("hex");
  const passcode = doc.sharePasscode ?? String(Math.floor(1000 + Math.random() * 9000));
  const expiresAt =
    body.expiresInHours == null ? null : new Date(Date.now() + Math.max(1, body.expiresInHours) * 3600 * 1000);
  await db
    .update(documents)
    .set({ shareToken: token, sharePasscode: passcode, shareExpiresAt: expiresAt })
    .where(eq(documents.id, id));
  await audit("share", doc.name, { expiry: body.expiresInHours ?? "forever" });
  return NextResponse.json({ token, passcode, expiresAt: expiresAt?.toISOString() ?? null });
}

/** DELETE — revoke sharing. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  const { id } = await ctx.params;
  await db.update(documents).set({ shareToken: null, sharePasscode: null, shareExpiresAt: null }).where(eq(documents.id, id));
  return NextResponse.json({ ok: true });
}
