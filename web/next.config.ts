import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  // Production image ships .next/standalone — a self-contained server bundle
  // with no node_modules. Has no effect on `next dev`.
  output: "standalone",

  // Pin the workspace root. Turbopack otherwise infers it from the nearest
  // lockfile and will happily pick one in a parent directory (a stray
  // ~/package-lock.json is enough), after which every route 404s in `next dev`.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
};

export default nextConfig;
