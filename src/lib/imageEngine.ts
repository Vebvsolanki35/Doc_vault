/**
 * ─────────────────────────────────────────────────────────────────────────
 *  IMAGE ENGINE — lazy, failure-tolerant access to sharp
 *
 *  sharp is a *native* module: `sharp` requires
 *  @img/sharp-<platform>/lib/sharp-<platform>-<v>.node, which dlopen()s
 *  @img/sharp-libvips-<platform>/lib/libvips-cpp.so.<vips> at runtime.
 *  When a deployment does not ship those files (serverless file tracing
 *  misses dlopen'd libraries — see next.config.ts) the load fails with:
 *
 *      Error: Failed to load external module sharp
 *      ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6: cannot open shared object file
 *
 *  A module-scope `import sharp from "sharp"` turns that into a crash while
 *  the route module is being evaluated: the request dies with an HTML 500
 *  before any handler can return a useful message. Here the import is
 *  deferred until an image is really processed, and the failure is cached so
 *  callers can degrade gracefully:
 *
 *    • OCR        → skips image preprocessing, still reads PDF text layers
 *    • conversion → reports "engine unavailable" (503) instead of crashing
 *    • /api/health → reports the exact reason
 *
 *  Nothing here fakes a successful result: every capability that needs the
 *  engine reports that it is unavailable.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type sharpFactory from "sharp";

/** The callable sharp factory (what `import sharp from "sharp"` gives you). */
export type SharpModule = typeof sharpFactory;

/** Thrown (and reported to clients as HTTP 503) when the native engine is unusable. */
export class ImageEngineUnavailableError extends Error {
  constructor(reason: string) {
    super(`image engine unavailable: ${reason}`);
    this.name = "ImageEngineUnavailableError";
  }
}

type State = { promise: Promise<SharpModule> | null; error: Error | null };

const globalForEngine = globalThis as typeof globalThis & { __smartTijoriImageEngine?: State };
const state: State = (globalForEngine.__smartTijoriImageEngine ??= { promise: null, error: null });

/** Last known state without triggering a load (used by /api/health). */
export function imageEngineStatus(): { ok: boolean; error: string | null } {
  return { ok: !state.error, error: state.error?.message ?? null };
}

/** Loads sharp once per process; a failed load is remembered (no retry storm). */
export async function getSharp(): Promise<SharpModule> {
  if (state.error) throw new ImageEngineUnavailableError(state.error.message);
  state.promise ??= import("sharp").then(
    (mod) => (mod.default ?? mod) as unknown as SharpModule,
    (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      state.error = err;
      state.promise = null;
      throw new ImageEngineUnavailableError(err.message);
    },
  );
  return state.promise;
}

export function isImageEngineError(e: unknown): e is ImageEngineUnavailableError {
  return e instanceof ImageEngineUnavailableError;
}

export async function imageEngineAvailable(): Promise<boolean> {
  try {
    await getSharp();
    return true;
  } catch {
    return false;
  }
}

/** One-line description of why the engine failed (used in API responses/logs). */
export function imageEngineErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^image engine unavailable:\s*/i, "").slice(0, 300);
}
