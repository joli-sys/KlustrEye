# CLAUDE.md

## Project Overview

KubeVision — a web-based Kubernetes IDE built with Next.js 16, React 19, TypeScript, Prisma, and Tailwind CSS 4. It connects to real Kubernetes clusters via kubeconfig and provides a UI for managing workloads, viewing logs, opening pod terminals, managing Helm releases, and more.

## Tech Stack

- **Framework:** Next.js 16 (App Router) with custom server (`server.ts`) for WebSocket support
- **Language:** TypeScript 5.9
- **Database:** SQLite via Prisma 6.19 (zero-config, no Docker needed)
- **Styling:** Tailwind CSS 4 with OKLCH color system, custom UI components (shadcn/ui pattern)
- **State:** TanStack React Query (server state), Zustand (client state)
- **K8s:** `@kubernetes/client-node`, Helm CLI via child_process
- **Editor:** Monaco Editor for YAML editing
- **Terminal:** xterm.js with WebSocket backend

## Commands

```bash
npm run dev          # Start dev server (custom server with WebSocket on :3000)
npm run dev:next     # Start Next.js dev only (no WebSocket/terminal support)
npm run build        # Production build
npm run start        # Run production build
npm run db:push      # Sync Prisma schema to database
npm run db:migrate   # Run Prisma migrations
npm run db:studio    # Open Prisma Studio
npx tsc --noEmit     # Type-check
npm run tauri:dev    # Start Tauri desktop app in dev mode
npm run tauri:build  # Build Tauri desktop binary
```

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/app/api/clusters/` — All cluster REST endpoints
- `src/app/clusters/[contextName]/` — Cluster-scoped pages (overview, workloads, network, config, storage, events, helm, settings)
- `src/components/` — React components
- `src/components/ui/` — Base UI primitives (Button, Card, Input, Select, Toast, etc.)
- `src/hooks/` — React Query hooks (`use-clusters`, `use-resources`, `use-metrics`, `use-pod-logs`)
- `src/lib/` — Utilities, Prisma client, constants, stores
- `src/lib/k8s/` — Kubernetes client, resource operations, Helm integration
- `src/lib/ws/` — WebSocket terminal handler
- `prisma/schema.prisma` — Database schema
- `server.ts` — Custom Node.js server with HTTP upgrade for terminal WebSockets
- `src-tauri/` — Tauri v2 desktop app (Rust binary wrapping the Next.js server)
- `scripts/pack-server.mjs` — Packages Next.js standalone output for Tauri bundling

## Key Patterns

- **API routes** follow REST conventions under `/api/clusters/[contextName]/...`
- **API routes** use plain `export async function GET/POST/PUT/DELETE/PATCH(...)` — no wrappers
- **Prisma upsert pattern:** When storing per-cluster settings, upsert `ClusterContext` first (to ensure it exists), then upsert the `ClusterSetting` with `@@unique([clusterId, key])`
- **CSS variables:** The theme uses `--primary`, `--ring`, etc. defined in `globals.css` under `.dark`. Tailwind resolves `bg-primary` via `@theme inline { --color-primary: var(--primary) }`. Per-cluster color overrides set these variables on an ancestor `<div className="contents">`.
- **Dynamic route params** use `params: Promise<{ contextName: string }>` (Next.js 16 pattern) — await in server components, `use()` in client components
- **Toast variants:** `"default" | "info" | "success" | "destructive"` (not `"error"`)
- **No auth** — the app runs without authentication; no login page, no session management

## Database Models

- `ClusterContext` — Stores per-cluster metadata (displayName, lastNamespace, pinned)
- `ClusterSetting` — Key-value settings per cluster (e.g., `colorScheme`)
- `SavedTemplate` — YAML templates for resource creation
- `TerminalSession` — Terminal session tracking
- `UserPreference` — Global user preferences

## Environment Variables

- `DATABASE_URL` — SQLite connection string (default: `file:./prisma/dev.db`)
- `KUBECONFIG_PATH` — Optional, defaults to `~/.kube/config`
