/**
 * ─────────────────────────────────────────────────────────────────────────
 *  DATABASE (PostgreSQL / Neon) — serverless-safe connection handling
 *
 *  Design notes, each one learned from a real deployment failure:
 *
 *  1. The pool is created LAZILY, on the first query. Throwing at module
 *     scope ("DATABASE_URL is required") had two bad effects: `next build`
 *     failed while collecting route data when the variable was absent, and in
 *     production a missing/renamed variable became an HTML 500 with an empty
 *     body (the client could only say "upload failed (500)"). Now it surfaces
 *     as JSON with the `db:config` code, which the UI explains to the user.
 *
 *  2. The pool listens for `error`. Serverless Postgres (Neon, Supabase,
 *     Vercel Postgres) closes idle connections when a compute suspends;
 *     node-postgres then emits `error` on an idle client. An EventEmitter
 *     `error` event with no listener is an *uncaught exception* that kills the
 *     whole function invocation — which is exactly how endpoints as unrelated
 *     as /api/members or /api/lock end up returning 500 with no JSON body.
 *
 *  3. `connectionTimeoutMillis` is bounded so an unreachable database fails
 *     fast with a readable message instead of hanging until the platform kills
 *     the function.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from "pg";

type PoolEvent = Parameters<Pool["on"]>[0];

/** Configuration problem (missing/empty DATABASE_URL) — never a query failure. */
export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigError";
  }
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new DatabaseConfigError(
      "DATABASE_URL is not set. Add it in Vercel → Project → Settings → Environment Variables (PostgreSQL/Neon connection string), then redeploy.",
    );
  }
  return url;
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

function poolConfig(): PoolConfig {
  return {
    connectionString: databaseUrl(),
    // Serverless-friendly: small pool, short idle life, fail fast instead of
    // hanging when the database cannot be reached.
    max: Number(process.env.PG_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
}

/**
 * The one real pool per process. Created on first use — importing this module
 * never touches the environment, so `next build` works without DATABASE_URL.
 */
export function getPool(): Pool {
  let pool = globalForDb.__arenaNextJsPostgresqlPool;
  if (!pool) {
    pool = new Pool(poolConfig());
    // Without this listener an idle-client error (Neon suspending its compute,
    // a network reset, a failover …) becomes an uncaught exception → 500 crash.
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
    globalForDb.__arenaNextJsPostgresqlPool = pool;
  }
  return pool;
}

/**
 * Lazily delegating pool facade.
 *
 * drizzle-orm inspects the client it is given (it reads `constructor` and, for
 * transactions, calls `connect()`), so handing it a plain `{}` is not an
 * option; creating the real pool at import time is not one either. This facade
 * forwards to `getPool()` on first real use, which keeps both behaviours:
 * importing `@/db` is free, and every query path behaves like real `pg`.
 */
class LazyPool {
  query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>>;
  query<R extends QueryResultRow = QueryResultRow>(config: { text: string; values?: unknown[] }): Promise<QueryResult<R>>;
  query(...args: unknown[]): Promise<unknown> {
    const pool = getPool() as unknown as { query: (...a: unknown[]) => Promise<unknown> };
    return pool.query(...args);
  }

  connect(): Promise<PoolClient> {
    return getPool().connect();
  }

  end(): Promise<void> {
    return getPool().end();
  }

  on(event: PoolEvent, listener: (...args: unknown[]) => void): this {
    getPool().on(event, listener);
    return this;
  }

  once(event: PoolEvent, listener: (...args: unknown[]) => void): this {
    getPool().once(event, listener);
    return this;
  }

  removeListener(event: PoolEvent, listener: (...args: unknown[]) => void): this {
    getPool().removeListener(event, listener);
    return this;
  }

  get totalCount(): number { return getPool().totalCount; }
  get idleCount(): number { return getPool().idleCount; }
  get waitingCount(): number { return getPool().waitingCount; }
  get options(): PoolConfig { return getPool().options; }
}

/** Raw pool (scripts call `pool.end()`); connects lazily on first real use. */
export const pool: Pool = new LazyPool() as unknown as Pool;

export const db = drizzle(pool);
