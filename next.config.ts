import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/binary packages must not be bundled by Turbopack/webpack
  serverExternalPackages: ["sharp", "@napi-rs/canvas", "unpdf", "pdf-lib"],
};

export default nextConfig;
