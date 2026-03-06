#!/usr/bin/env node
/**
 * Packages the Next.js standalone output + server bundle into a tarball
 * for Tauri to bundle as a single resource file.
 *
 * The standalone directory becomes the root — Next.js expects .next/ in CWD.
 * We then overlay full copies of packages needed by server.bundle.mjs that
 * the standalone tracer may have only partially included.
 */
import { execSync } from "child_process";
import { mkdirSync, cpSync, existsSync, statSync } from "fs";
import { join } from "path";

const root = process.cwd();
const dist = join(root, "dist-server");
const staging = join(dist, "staging");

// Clean and create staging directory
execSync(`rm -rf ${dist}`);
mkdirSync(staging, { recursive: true });

// Use the standalone output as the root (it contains .next/ and node_modules/)
const standalone = join(root, ".next", "standalone");
if (!existsSync(standalone)) {
  console.error("ERROR: .next/standalone not found. Run 'npm run build' first.");
  process.exit(1);
}
cpSync(standalone, staging, { recursive: true });

// Copy static assets into .next/static/ (not included in standalone output)
const staticDir = join(root, ".next", "static");
if (existsSync(staticDir)) {
  cpSync(staticDir, join(staging, ".next", "static"), { recursive: true });
}

// Copy public directory into the root
const publicDir = join(root, "public");
if (existsSync(publicDir)) {
  cpSync(publicDir, join(staging, "public"), { recursive: true });
}

// Copy our custom server bundle (replaces the default standalone server.js)
cpSync(join(root, "server.bundle.mjs"), join(staging, "server.bundle.mjs"));

// Copy prisma schema
const prismaSchema = join(root, "prisma", "schema.prisma");
if (existsSync(prismaSchema)) {
  mkdirSync(join(staging, "prisma"), { recursive: true });
  cpSync(prismaSchema, join(staging, "prisma", "schema.prisma"));
}

// Overlay full versions of packages that server.bundle.mjs imports directly.
// The standalone tracer may have only partially included these (e.g., CJS only).
// next must be overlaid because standalone strips it to a minimal server.js runner,
// but our custom server.ts calls next() programmatically which needs the full package.
const serverDeps = ["next", "ws", "node-pty"];
const srcModules = join(root, "node_modules");
const dstModules = join(staging, "node_modules");

for (const pkg of serverDeps) {
  const src = join(srcModules, pkg);
  if (existsSync(src)) {
    const dst = join(dstModules, pkg);
    cpSync(src, dst, { recursive: true });
    console.log(`  Overlaid node_modules/${pkg}`);
  }
}

// Also copy node-pty prebuilds (native addon)
const ptySrc = join(srcModules, "node-pty", "prebuilds");
if (existsSync(ptySrc)) {
  cpSync(ptySrc, join(dstModules, "node-pty", "prebuilds"), { recursive: true });
  console.log("  Copied node-pty prebuilds");
}

// Create tarball
execSync(`tar -czf server-pack.tar.gz -C staging .`, { cwd: dist });

const size = statSync(join(dist, "server-pack.tar.gz")).size;
console.log(`✓ Created dist-server/server-pack.tar.gz (${(size / 1024 / 1024).toFixed(1)} MB)`);
