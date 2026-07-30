# CLAUDE.md

## Project Overview

KlustrEye — a Kubernetes IDE with a Vite/React frontend and a Rust/axum backend. It connects to real Kubernetes clusters via kubeconfig and provides a UI for managing workloads, viewing logs, opening pod terminals, managing Helm releases, and more. Ships as a desktop app via Tauri v2.

## Tech Stack

- **Frontend:** Vite 6 + React 19 + TypeScript 5.9, `react-router-dom` 7 for routing. Entry: `src/main.tsx` → `src/App.tsx`.
- **Backend:** Rust + axum 0.7, binary `klustreye-server`. Entry: `backend/src/main.rs` → `backend/src/lib.rs`. Routes registered in `backend/src/routes/mod.rs`.
- **Database:** SQLite via `sqlx` 0.8. Schema is plain `CREATE TABLE IF NOT EXISTS` statements in `backend/src/db.rs` — there is no Prisma and no migration framework.
- **Styling:** Tailwind CSS 4 with OKLCH color system, custom UI components (shadcn/ui pattern)
- **State:** TanStack React Query (server state), Zustand (client state)
- **K8s:** `kube`/`k8s-openapi` (Rust) on the backend, Helm CLI via subprocess
- **Editor:** Monaco Editor for YAML editing
- **Terminal:** xterm.js over WebSocket, handled by axum (`backend/src/ws/`)
- **Desktop:** Tauri v2 in `src-tauri/`, wrapping the compiled backend binary

## Commands

Read verbatim from `package.json`:

```bash
npm run dev            # concurrently runs `cargo run --bin klustreye-server` + `vite --port 3001`
npm run dev:frontend   # Vite dev server only
npm run build           # vite build (frontend only)
npm run build:frontend  # same as build — builds the frontend into dist/
npm run preview         # vite preview
npm run typecheck       # tsc --noEmit
npm test                # vitest run
npm run test:watch      # vitest (watch mode)
npm run tauri:dev       # start Tauri desktop app in dev mode
npm run tauri:build     # build Tauri desktop binary

cargo test -p backend --lib   # Rust backend tests
```

There is no `db:push`, `db:migrate`, or `db:studio` — those were Prisma-era scripts and no longer exist.

`npm test` runs 345 vitest tests; `cargo test -p backend --lib` runs 197 Rust tests.

## Project Structure

- `src/app/` — legacy directory name kept from an earlier Next.js version of this app; contains route-level React components (not Next.js pages/API routes). `src/app/layout.tsx` is a stub kept only for reference — the real root layout is `src/App.tsx`.
- `src/components/` — React components
- `src/components/ui/` — Base UI primitives (Button, Card, Input, Select, Toast, etc.)
- `src/hooks/` — React Query hooks (`use-clusters`, `use-resources`, `use-metrics`, `use-pod-logs`)
- `src/lib/` — Utilities, constants, stores
- `backend/src/routes/` — axum route handlers (clusters, resources, logs, metrics, helm, settings, organizations, port_forward, ai, opencost, grafana, workspaces)
- `backend/src/db.rs` — SQLite schema and connection setup (sqlx, no ORM)
- `backend/src/ws/` — WebSocket handlers for terminal (`terminal.rs`) and shell (`shell.rs`)
- `backend/src/lib.rs` — axum app assembly; also embeds and serves the built frontend (see gotcha below)
- `src-tauri/` — Tauri v2 desktop app wrapping the `klustreye-server` binary
- `prisma/schema.prisma` — vestigial leftover from the pre-Rust backend; not used by anything that builds or runs today. The real schema lives in `backend/src/db.rs`. A handful of orphaned TypeScript files (`src/lib/prisma.ts`, `src/plugins/grafana/server.ts`, `src/instrumentation.ts`, `src/lib/k8s/client.ts`, `src/lib/k8s/port-forward.ts`) still reference it but `@prisma/client` is not a dependency, so this code is dead weight, not a live code path.

## Key Patterns

- **API routes** follow REST conventions under `/api/clusters/:ctx/...`, registered in `backend/src/routes/mod.rs`
- **CSS variables:** The theme uses `--primary`, `--ring`, etc. defined in `globals.css` under `.dark`. Tailwind resolves `bg-primary` via `@theme inline { --color-primary: var(--primary) }`. Per-cluster color overrides set these variables on an ancestor `<div className="contents">`.
- **Toast variants:** `"default" | "info" | "success" | "destructive"` (not `"error"`)
- **No auth** — the app runs without authentication; no login page, no session management

## Workspaces

Routes are `/w/:wsId/clusters/:contextName/...` (see `src/App.tsx`). A legacy `/clusters/:contextName/*` route still exists and is handled by `src/components/legacy-cluster-redirect.tsx`, which resolves-or-lazily-creates a workspace for that context and redirects into the `/w/:wsId/...` form, preserving the sub-path and query string. There is also a catch-all `path="*"` → `/`, so an unknown `wsId` (workspace not found) redirects home via `WorkspaceLayout`'s `isError` check, not the catch-all.

- **Never hand-build cluster hrefs.** Use `src/lib/paths.ts` (`clusterPath`, `workspacePath`, `rewriteClusterHref`) or the `src/hooks/use-cluster-path.ts` hooks (`useWorkspaceId`, `useClusterPath`, `useWorkspacePath`). The one intentional exception is `src/app/page.tsx`, which links to the legacy `/clusters/...` form on purpose as the bare-cluster entry path.
- **A workspace id may never be the literal string `"clusters"`.** `src/lib/tab-route.ts` locates the cluster segment with `parts.indexOf("clusters")`, so a workspace id of `"clusters"` would match first and resolve the wrong context. `paths.ts` throws on this id and the backend rejects it too.
- **A tab is never repurposed across kinds.** `syncTabToLocation` (`src/lib/tab-route.ts`) makes the active tab follow the URL only while `deriveTabTargetFromPath` reports the same `kind`; crossing kinds opens a separate tab. A tab's `kind` and `payload` decide its Monaco registry key (`modelKeyForTab`), so rewriting a file tab's href to a cluster page would leave it releasing and dirty-tracking an unrelated buffer.
- **A workspace binds one folder and ANY NUMBER of clusters.** `Workspace.clusters` (see `src/hooks/use-workspaces.ts`) is an ordered `{ contextName, exists, sortOrder }[]`, always present and possibly empty; `exists` and `folderExists` are computed fresh per request and never persisted. There is no `workspace.contextName` — every question about bindings is a fold over `clusters`, and `src/lib/workspace-clusters.ts` holds those folds as pure functions (`activeClusterName`, `missingClusters`, `allClustersMissing`, …).
- **The ACTIVE cluster is the route's `:contextName`, not the workspace's.** `WorkspaceLayout` reads it with `useMatch("/w/:wsId/clusters/:contextName/*")` — `useParams` in a parent route cannot see a child's params — and falls back to the first binding elsewhere. `ClusterColorProvider` follows the active cluster so per-cluster theming survives a switch. Switching clusters stays inside the workspace: `clusterSwitchHref` (`src/lib/paths.ts`) moves only the context segment and carries the sub-path along.
- **Degrade, never dead-end.** `WorkspaceLayout` (`src/components/workspace-layout.tsx`) shows an inline banner (`WorkspaceBindingBanner`, `mode="banner"`) when ANY binding is broken, and the full-screen repair state (`mode="repair"`) only when the folder is broken AND *every* bound cluster is missing, or nothing is bound at all — one working cluster out of two keeps the workspace usable. Both offer a "Rebind" action that opens `WorkspaceDialog`. A missing cluster is still LISTED in the Cluster view, marked, never hidden. Never a white screen.
- **`contextName` is globally unique** — there is one kubeconfig, so cluster-scoped React Query keys are NOT namespaced by workspace.
- **Namespace state lives only in `namespaceByWorkspace`** in `ui-store` (`src/lib/stores/ui-store.ts`). There is deliberately no `last_namespace` column on `workspaces` — one source of truth.
- **Zustand persist migrations are shape-driven, not version-driven.** zustand's `migrate` only runs when the persisted payload already has a numeric `version` that differs from the current one, and only rewrites storage if migration actually ran — a payload lacking `version` would never trigger `migrate` and would persist in its old shape forever. Both `tab-store` (`src/lib/stores/tab-store.ts`, v1) and `ui-store` (v3) detect the old shape directly instead of relying on the `version` field.

## Agents

External CLI coding agents (Claude Code, Codex, Aider, or a user-added command) run as PTY-backed sessions supervised by the backend, not by the client.

- **A session outlives its WebSocket.** `backend/src/agents/mod.rs` owns a registry of live sessions keyed by id, independent of any attached socket — closing the browser tab does not stop the agent, and `GET /ws/agent/:session_id` (registered in `backend/src/routes/mod.rs`) replays a bounded scrollback on attach so reconnecting shows what was missed.
- **One xterm instance per session.** `AgentTerminal` keys its `TerminalComponent` on `sessionId`; `TerminalInner` otherwise reuses one xterm across `wsUrl` changes (right for the cluster shell, wrong here, since attaching replays scrollback). Its socket cleanup also detaches `onopen`/`onmessage`/`onerror`/`onclose` before calling `close()` — `close()` is async, so a superseded socket's late events used to write into whichever session the user had just switched to.
- **A tab is never repurposed into an agent tab or out of one** — same `syncTabToLocation` rule as file/cluster tabs; `src/lib/tab-route.ts` knows the `agents/:sessionId` shape.
- **Sessions can be seeded.** `POST /api/workspaces/:ws_id/agent-sessions` accepts optional `title`, `cwd` (defaults to the workspace folder; a session is not confined to it), `initialPrompt`, and `attachments`. Attachments are written to files under the app-data dir, never pasted into the PTY or into the user's repo. The prompt is sent once the session's `activity` reaches `"waiting"` (see below) with a timeout, and `seed_status` (`none`/`pending`/`sent`/`timed_out`/`failed`) records what actually happened.
- **`activity` is a heuristic, not a fact.** `"working"` vs `"waiting"` is inferred from output recency (quiet after producing output ⇒ probably waiting on you); `waitingConfidence: "high"` means a configured prompt-pattern regex actually matched the scrollback tail, `"low"` means it's just quiet — copy in the UI stays hedged except at high confidence.
- **File paths in agent output are clickable** (`src/lib/file-link.ts`), resolved against the session's `cwd` — not the workspace folder, since they can differ — and only linked when the resolved path is inside the workspace folder, since that is what the confined filesystem API can actually open.
- **MCP servers** are edited via the workspace's `.mcp.json` through the existing confined file API (`src/lib/mcp-config.ts`) — no separate backend endpoint. Round-tripping preserves every field this build does not model; user-level (`~/.claude.json`) servers are out of the confined folder and are not shown.

## Database Tables (`backend/src/db.rs`)

- `organizations` — grouping for cluster contexts
- `cluster_contexts` — per-cluster metadata (display name, last namespace, pinned, organization)
- `cluster_settings` — key-value settings per cluster, unique on `(cluster_id, key)`
- `user_preferences` — global key-value preferences
- `saved_templates` — YAML templates for resource creation
- `terminal_sessions` — terminal session tracking
- `port_forward_sessions` — port-forward process tracking, stale sessions marked stopped on startup
- `workspaces` — id, name, optional `folder_path`, `sort_order`, `last_opened_at`. Its `context_name` column is LEGACY: `workspace_clusters` is authoritative, and the column is only rewritten to the first bound cluster so an older build sharing the database still finds one sane cluster. `folderExists` is derived at read time, not stored here.
- `workspace_clusters` — `(workspace_id, context_name)` primary key plus `sort_order`; the many-clusters-per-workspace bindings. `exists` is derived per request from one kubeconfig read, never stored.
- `agent_definitions` — reusable agent commands (name, command, args, env, `prompt_patterns` for high-confidence waiting detection). Seeded once with built-ins (Claude Code, Codex, Aider, Hermes) via a versioned marker in `user_preferences`, so a user-deleted built-in does not come back, and a later-added built-in still reaches existing installs.
- `agent_sessions` — one row per PTY session: workspace, definition, `cwd`, `status`/`exit_code`, `seed_status`, transcript/attachment bookkeeping. The live process and its scrollback ring buffer live only in `backend/src/agents/mod.rs`'s in-memory registry; a restart marks any still-`running` row `exited` and any still-`pending` `seed_status` `failed`, mirroring how `port_forward_sessions` handles stale rows. Transcripts are additionally persisted to disk so a session started before the app restarted can still be read back.

There is no migration versioning — adding a table is a new `CREATE TABLE IF NOT EXISTS` in `run_migrations()`, but adding a *column* to an existing table later needs a hand-written `ALTER TABLE` guarded by a `PRAGMA table_info` check (the blind `CREATE TABLE IF NOT EXISTS` won't add columns to an already-existing table).

## Environment Variables

- `DATABASE_URL` — SQLite connection string (backend default: platform-specific app-data dir, e.g. `~/Library/Application Support/KlustrEye/klustreye.db` on macOS)
- `PORT` — backend server port, defaults to `3000`
- `KUBECONFIG_PATH` — Optional, defaults to `~/.kube/config`

## Gotchas

- **Backend won't compile without a built frontend.** `backend/src/lib.rs` embeds the frontend via `rust-embed` with `#[folder = "../dist"]`, and `dist/` is gitignored. On a fresh clone or a new git worktree, `cargo build`/`cargo test` on the backend fails before `npm run build:frontend` (or `npm run build`) has been run at least once — the error is a confusing `no method named 'get' found for struct 'Assets'` mentioning `Embed`/`RustEmbed`, which gives no hint that the real cause is a missing `dist/` directory.
- **No column migrations.** See "Database Tables" above — only new tables are handled automatically; new columns on existing tables need manual `ALTER TABLE` + `PRAGMA table_info` guards.
