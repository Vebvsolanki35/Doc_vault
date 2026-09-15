import { NextResponse } from "next/server";

/** UUID shape — used to reject garbage ids BEFORE they reach Postgres,
 *  where a non-uuid against a uuid column throws `invalid input syntax
 *  for type uuid` (SQLSTATE 22P02) and would surface as a bare 500. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

function rootMessage(e: unknown): string {
  // Walk to the DEEPEST cause — the root cause (e.g. "connect ECONNREFUSED
  // …") is what the user needs, not the ORM's "Failed query: <sql>" wrapper.
  let msg = e instanceof Error ? e.message : String(e);
  let cur: unknown = e;
  for (let hops = 0; hops < 4; hops++) {
    if (!(cur instanceof Error)) break;
    const cause = (cur as { cause?: unknown }).cause;
    if (!(cause instanceof Error) || !cause.message) break;
    msg = cause.message;
    cur = cause;
  }
  return msg;
}

function sqlState(e: unknown): string | null {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) {
      const code = (cur as { code?: unknown }).code;
      if (typeof code === "string") return code;
    }
    cur = (cur as { cause?: unknown }).cause ?? null;
  }
  return null;
}

/**
 * Turn an API failure into a readable JSON error the UI can show.
 * Database problems get a `db:*` prefix so the client can explain the
 * real reason ("the vault's database is not connected") instead of a
 * vague "upload failed".
 */
export function apiError(e: unknown, fallback = "server_error"): NextResponse {
  const msg = rootMessage(e);
  const state = sqlState(e);
  const netRe = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|getaddrinfo|TLS|SSL|timeout|Terminated|socket hang up|ECONNRESET/i;
  const dbRe = /relation|column|permission denied|password authentication|deadlock|lock timeout|too many connections|no pg_hba/i;

  let code: string;
  if (state && /^[02458]/.test(state)) {
    // a real PostgreSQL SQLSTATE — it is definitely the database
    if (state === "42P01" || state === "42703" || state === "28P01" || state === "28000") code = "db:schema";
    else if (state.startsWith("53") || state.startsWith("57") || state.startsWith("58")) code = "db:busy";
    else code = "db:other";
  } else if (netRe.test(msg) || /pg:|pool|Postgres|postgres/i.test(msg)) {
    code = "db:connect";
  } else if (dbRe.test(msg)) {
    code = "db:schema";
  } else {
    code = "error";
  }
  return NextResponse.json({ error: `${code}: ${msg.slice(0, 300)}`, fallback }, { status: 500 });
}
