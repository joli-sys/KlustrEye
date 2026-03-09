import { readFileSync } from "fs";

const { version } = JSON.parse(readFileSync("./package.json", "utf-8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["@kubernetes/client-node"],
  turbopack: {},
  env: {
    APP_VERSION: version,
  },
  headers: async () => [
    {
      // Prevent WKWebView from caching HTML/RSC responses (stale cache
      // causes chunk-hash mismatches after app updates in Tauri).
      source: "/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, must-revalidate" },
      ],
    },
    {
      // Static chunks are content-addressed — safe to cache forever.
      source: "/_next/static/:path*",
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
};

export default nextConfig;
