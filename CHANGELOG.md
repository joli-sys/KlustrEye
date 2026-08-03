# Changelog

All notable changes to KlustrEye are documented here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0-rc.1] — Unreleased

The largest release to date: KlustrEye grows from a Kubernetes-only IDE into a unified tool for clusters, code, and AI coding agents, built around a new **Workspace** concept.

### Added — Workspaces

- A workspace binds an optional local folder and any number of clusters — folder-only, cluster-only (today's flow, unchanged), or both. Binding is a fold over an ordered list, so one workspace can target several clusters (e.g. `staging` and `prod`) without duplicating the folder binding.
- Workspace tabs: open several workspaces at once in a tab strip; switching restores exactly where you left off. Closing a workspace tab only removes it from the strip — it never deletes the workspace.
- Degrade-never-dead-end error handling: a moved folder or a cluster removed from your kubeconfig shows an inline banner (or a full repair screen if everything is broken) with one-click rebind; a missing cluster stays listed, marked, never hidden.
- Activity-bar layout (Explorer / Cluster / Search / Terminals & Agents), each a rail icon rather than a stacked sidebar section; icons only appear for bindings the workspace actually has.
- Routing moved to `/w/:wsId/clusters/:contextName/...` with a redirect shim for legacy `/clusters/...` links and a catch-all, so no persisted tab or bookmark breaks.

### Added — Code Editor

- File tree and multi-file Monaco editor scoped to the workspace folder, with syntax highlighting including Terraform/HCL and a custom Helm-template grammar (Go-template blocks highlighted distinctly; `Chart.yaml`/`values.yaml` stay plain YAML).
- Dirty buffers survive tab switches via a model registry independent of the router unmounting the page.
- Save conflict detection: if a file changed on disk since it was opened, save offers *Reload from disk* or *Overwrite* explicitly rather than picking one silently.
- Find in files, respecting `.gitignore`, with truncation clearly flagged.
- Live filesystem watching updates the tree and search without ever touching the content of a file you have open.
- A path-confined filesystem API: every operation is canonicalized and verified inside the workspace folder — traversal, absolute paths, and symlink escapes are rejected. Verified against parent-traversal, absolute-path, and symlink-escape attempts over HTTP.
- MCP server overview and editor for the workspace's `.mcp.json`, preserving every field not modeled by the UI.

### Added — Agents

- Run any CLI coding agent (Claude Code, Codex, Aider, Hermes seeded as built-ins; add your own) as a supervised, persistent PTY session — independent of the browser tab or WebSocket.
- Sessions survive closing the tab and, via a saved transcript, survive restarting the app.
- A session's working directory defaults to the workspace folder but can be any directory.
- Working/waiting activity indicators, inferred from output recency and optional prompt-pattern matching, drive a rail badge that only counts sessions genuinely waiting on you, plus a one-time notification on that transition.
- A searchable, chat-style session view over a real terminal: scrollback search, sticky input, jump-to-latest, copy-transcript.
- Clickable file paths in agent output, opening the referenced file and line in the editor.
- "Ask an agent" on pod logs and resource YAML: starts a session pre-seeded with the content (attached as a file, never pasted into the terminal), delivered once the agent reaches its own prompt.
- Recent-agent history on the homepage across all workspaces, running sessions first.
- Name a session on creation; the currently open session is always pinned to the top of its list.
- A "Search workspace" fallback when a linked file cannot be found — a CLI agent can change its own working directory after the session starts, which the backend has no way to observe, so a printed path can resolve to the wrong location.

### Fixed

- Multiple tab-lifecycle and Monaco-model-lifetime bugs found through manual use: files not opening on click, tabs being silently repurposed across kinds, the editor stranding on a released buffer after closing the last tab, and `MAX_TABS` eviction disposing a buffer still on screen.
- Save being permanently blocked after reopening an already-open file (an effect-ordering bug).
- Two agent-session terminal bugs: output from two sessions mixing into one pane, and a stale WebSocket writing a spurious error into whichever session was open.
- The native folder picker failing silently, then reporting `undefined` — traced to the Tauri capability not covering the app's actual `http://localhost` origin (affecting every Tauri plugin, not only the dialog) and to `.message` being read off a plain string, which Tauri's IPC throws instead of an `Error`.
- Terminal search (`Cmd/Ctrl+F`) crashing the entire agent session pane — `@xterm/addon-search` needs `allowProposedApi`.
- The RC build failing with an out-of-memory error once Monaco was bundled instead of CDN-loaded.
- Every external link doing nothing in the desktop build: a Tauri webview cannot hand a URL to the OS without an opener plugin, so `target="_blank"` and `window.open` were both swallowed. Affected the footer links and all three port-forward "open in browser" links, and only reproduced in the packaged app — never under `npm run dev`.
- The Explorer having no way to create anything. The backend could already create files (`write_file` with no `baseModifiedMs`); the tree simply had no toolbar and no context menu, so a workspace looked read-only.

### Added — Explorer

- **New file / New folder** in the Explorer, from a toolbar or a right-click on any node (right-clicking a file creates alongside it, not inside it), with inline naming. Nested names such as `src/lib/util.ts` create the intermediate directories. Backed by a new confined `POST /api/workspaces/:ws_id/directory`, which reports an existing path as a conflict rather than silently adopting it.
- **Shift+Enter for a new line** in the agent composer, which is now a multi-line box that grows with its content. A multi-line message is delivered through xterm's bracketed-paste-aware `paste()`, so it arrives as one message instead of one submission per line.

### Documentation

- `CLAUDE.md` corrected from a stale Next.js/Prisma description to the actual Vite/Rust stack, and extended with the Workspaces and Agents systems.
- `README.md` extended with Workspaces, Code Editor, and Agents feature sections, an updated architecture diagram, and the current database schema.
