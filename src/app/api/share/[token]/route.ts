import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { publicDoc } from "@/lib/vault";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ token: string }> };

/** GET ?p=1234 → verifies passcode (+expiry) and returns the document meta. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const pass = req.nextUrl.searchParams.get("p");
  const rows = await db.select().from(documents).where(eq(documents.shareToken, token)).limit(1);
  const doc = rows[0];
  if (!doc || !doc.sharePasscode || doc.deletedAt) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (doc.shareExpiresAt && doc.shareExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }
  if (pass !== doc.sharePasscode) return NextResponse.json({ error: "wrong_passcode" }, { status: 403 });
  return NextResponse.json({ document: publicDoc(doc), token });
}
