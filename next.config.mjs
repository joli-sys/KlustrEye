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
};

export default nextConfig;
