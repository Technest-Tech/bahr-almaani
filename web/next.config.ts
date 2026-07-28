import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production image ships .next/standalone — a self-contained server bundle
  // with no node_modules. Has no effect on `next dev`.
  output: "standalone",
};

export default nextConfig;
