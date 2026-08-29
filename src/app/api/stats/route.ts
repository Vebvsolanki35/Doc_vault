import { NextResponse } from "next/server";
import { getStats, isUnlocked } from "@/lib/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isUnlocked())) return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.json(await getStats());
}
