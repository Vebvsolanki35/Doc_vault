/**
 * Vault server helpers: scrypt hashing, session cookies, settings KV,
 * family roster, per-member stats, audit trail.
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { and, asc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, documents, folders, members, settings } from "@/db/schema";

export const UNLOCK_COOKIE = "vault_unlocked";
export const RECOVERY_COOKIE = "vault_recovery";
export const TOTAL_QUOTA = 10 * 1024 ** 3; // 10 GB vault
export const BIN_RETENTION_DAYS = 30;

// ── Hashing ───────────────────────────────────────────────────────────
export function hashSecret(value: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(value.normalize("NFKC").trim().toLowerCase(), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifySecret(value: string, stored: string): boolean {
  try {
    const [salt, hash] = stored.split(":");
    const candidate = scryptSync(value.normalize("NFKC").trim().toLowerCase(), salt, 32);
    return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
  } catch {
    return false;
  }
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ── Settings KV ───────────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export type LockConfig = {
  pin: boolean;
  pattern: boolean;
  password: boolean;
  question: string | null;
  otp: boolean;
  otpMobile: string | null;
  any: boolean;
};

export async function getLockConfig(): Promise<LockConfig> {
  const [pin, pattern, password, question, otp, otpMobile] = await Promise.all([
    getSetting("pinHash"),
    getSetting("patternHash"),
    getSetting("passwordHash"),
    getSetting("securityQuestion"),
    getSetting("otpEnabled"),
    getSetting("otpMobile"),
  ]);
  return {
    pin: !!pin,
    pattern: !!pattern,
    password: !!password,
    question: question || null,
    otp: otp === "1" && !!otpMobile,
    otpMobile: otpMobile || null,
    any: !!(pin || pattern || password),
  };
}

// ── Session ───────────────────────────────────────────────────────────
export async function isUnlocked(): Promise<boolean> {
  const cfg = await getLockConfig();
  if (!cfg.any) return true;
  const store = await cookies();
  return store.get(UNLOCK_COOKIE)?.value === "1";
}

// ── Family roster & folders ───────────────────────────────────────────
export async function getRoster() {
  return db.select().from(members).orderBy(asc(members.sort));
}

export async function getFoldersFor(memberId: string) {
  return db.select().from(folders).where(eq(folders.memberId, memberId)).orderBy(asc(folders.sort));
}

/** Find a member's default folder row for a key (fallback: their "other"). */
export async function findFolder(memberId: string, key: string) {
  const rows = await db.select().from(folders).where(eq(folders.memberId, memberId));
  return rows.find((f) => f.key === key) ?? rows.find((f) => f.key === "other") ?? rows[0] ?? null;
}

// ── Public DTO ────────────────────────────────────────────────────────
export function publicDoc(d: {
  id: string; name: string; mimeType: string; size: number; category: string;
  tags: unknown; createdAt: Date; shareToken: string | null; sharePasscode: string | null;
  memberId?: string | null; folderId?: string | null; deletedAt?: Date | null;
  shareExpiresAt?: Date | null;
}) {
  return {
    id: d.id,
    name: d.name,
    mimeType: d.mimeType,
    size: d.size,
    category: d.category,
    tags: d.tags,
    createdAt: d.createdAt.toISOString(),
    shareToken: d.shareToken,
    sharePasscode: d.sharePasscode,
    memberId: d.memberId ?? null,
    folderId: d.folderId ?? null,
    deletedAt: d.deletedAt?.toISOString() ?? null,
    shareExpiresAt: d.shareExpiresAt?.toISOString() ?? null,
  };
}

// ── Audit trail ───────────────────────────────────────────────────────
export async function audit(
  action: string,
  docName: string,
  meta: Record<string, string | number | boolean | null> = {},
) {
  try {
    await db.insert(auditLogs).values({ action, docName, meta });
  } catch {
    /* auditing must never break the main flow */
  }
}

// ── Recycle-bin retention sweep (lazy, on reads) ─────────────────────
export async function purgeExpiredBin() {
  const cutoff = new Date(Date.now() - BIN_RETENTION_DAYS * 24 * 3600 * 1000);
  const doomed = await db
    .select({ id: documents.id, name: documents.name })
    .from(documents)
    .where(and(lt(documents.deletedAt, cutoff)));
  for (const d of doomed) {
    await db.delete(documents).where(eq(documents.id, d.id));
    await audit("purge", d.name, { reason: "30-day retention" });
  }
}

// ── Stats ─────────────────────────────────────────────────────────────
export async function getStats() {
  const rows = await db
    .select({ id: documents.id, size: documents.size, category: documents.category, memberId: documents.memberId })
    .from(documents)
    .where(isNull(documents.deletedAt));
  const roster = await getRoster();

  const used = rows.reduce((a, r) => a + r.size, 0);
  const perCategory: Record<string, number> = {};
  const perMember: Record<string, { count: number; bytes: number; nameEn: string; nameHi: string; key: string; color: string; icon: string }> = {};
  for (const m of roster) perMember[m.id] = { count: 0, bytes: 0, nameEn: m.nameEn, nameHi: m.nameHi, key: m.key, color: m.color, icon: m.icon };
  for (const r of rows) {
    perCategory[r.category] = (perCategory[r.category] ?? 0) + 1;
    if (r.memberId && perMember[r.memberId]) {
      perMember[r.memberId].count++;
      perMember[r.memberId].bytes += r.size;
    }
  }
  const lastBackupAt = await getSetting("lastBackupAt");
  return {
    used,
    free: Math.max(0, TOTAL_QUOTA - used),
    total: TOTAL_QUOTA,
    count: rows.length,
    perCategory,
    perMember,
    lastBackupAt,
  };
}
