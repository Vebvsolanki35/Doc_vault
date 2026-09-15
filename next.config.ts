import type { NextConfig } from "next";

/**
 * ─────────────────────────────────────────────────────────────────────────
 *  Native modules & deployment tracing
 *
 *  `sharp` (and @napi-rs/canvas) load native code at *runtime*:
 *    • sharp → @img/sharp-<platform>/lib/sharp-<platform>-<v>.node, which in
 *      turn dlopen()s
 *      @img/sharp-libvips-<platform>/lib/libvips-cpp.so.<vips>
 *    • tesseract.js spawns a worker and reads its WASM core + language data
 *      packs out of node_modules at runtime.
 *
 *  None of that is visible to Next's static file tracing (@vercel/nft), so a
 *  Vercel deployment ships WITHOUT the libvips shared library and every
 *  request that touches an image dies with
 *
 *    Error: Failed to load external module sharp
 *    ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.6: cannot open shared object file
 *
 *  `serverExternalPackages` (below) is still required — it keeps the native
 *  addons out of the bundler — but it does not influence what the tracer
 *  copies. `outputFileTracingIncludes` does, and that is what actually fixes
 *  the 500s on /api/analyze, /api/upload and the convert/download routes.
 *  (Verified: the .nft.json trace of those routes now contains
 *  @img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.6.)
 *
 *  sharp stays at ^0.35.4 (current release, newest libvips): the failure is a
 *  tracing gap in this packaging layout, not a version bug, so downgrading
 *  would only hide it.
 * ─────────────────────────────────────────────────────────────────────────
 */
const IMAGE_ENGINE_ASSETS = [
  // sharp's native addon + the libvips shared library it dlopen()s
  "./node_modules/sharp/**/*",
  "./node_modules/@img/**/*",
];

const OCR_ENGINE_ASSETS = [
  // pdf.js rasteriser (native canvas) + tesseract worker, WASM core & languages
  "./node_modules/@napi-rs/canvas*/**/*",
  "./node_modules/tesseract.js*/**/*",
  "./node_modules/@tesseract.js-data/**/*",
];

/**
 * Routes that import the image/OCR engine (src/lib/{convert,ocr,sizeEngine,
 * analyze}). Keeping the list short means the small endpoints
 * (/api/members, /api/stats, /api/lock …) stay lean instead of carrying
 * native binaries they never touch. If a route outside /api/ ever imports the
 * engine, extend this list (e.g. add "/**").
 */
const ENGINE_ROUTES = [
  "/api/analyze/**",
  "/api/upload/**",
  "/api/documents/**",
  "/api/batch-pdf/**",
  "/api/bulk/**",
];

const nextConfig: NextConfig = {
  // Native/binary packages must not be bundled by Turbopack/webpack.
  serverExternalPackages: ["sharp", "@napi-rs/canvas", "unpdf", "pdf-lib", "tesseract.js"],
  // Force-copy the runtime-only native assets into the serverless bundles.
  outputFileTracingIncludes: Object.fromEntries(
    ENGINE_ROUTES.map((route) => [route, [...IMAGE_ENGINE_ASSETS, ...OCR_ENGINE_ASSETS]]),
  ),
};

export default nextConfig;
