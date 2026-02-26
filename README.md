<p align="center">
  <img src="public/KlustrEye_logo.png" alt="KlustrEye" width="200">
</p>

# KlustrEye
<p align="center">
  <img src="public/Screenshot_homepage.png" alt="KlustrEye">
</p>

<p align="center">
  <img src="public/Screenshot_dashboard.png" alt="KlustrEye">
</p>

<p align="center">
  <img src="public/Screenshot_pod.png" alt="KlustrEye">
</p>

A web-based Kubernetes IDE built with Next.js, React, and TypeScript. Connect to real clusters via kubeconfig and manage workloads, view logs, open pod terminals, manage Helm releases, and more — from your browser or as a standalone desktop app.

## Features

### Cluster Management
- **Multi-cluster support** — connect to any number of clusters from your kubeconfig
- **Cluster organizations** — group clusters by organization (e.g. Production, Staging, company names) with a manage dialog and grouped home page layout
- **Cloud provider detection** — automatically detects EKS, GKE, and AKS clusters from server URLs and version strings, with provider icons on the home page and overview
- **Per-cluster color schemes** — 16 color presets across the OKLCH color wheel for visually distinguishing clusters
- **Cluster renaming** — set custom display names for clusters
- **Sidebar cluster switcher** — quickly switch between clusters, grouped by organization, with search filter and scrollable dropdown for large cluster lists
- **Default namespace** — configurable default namespace per cluster via settings page
- **Cluster shell terminal** — open a local shell scoped to a cluster context (node-pty + WebSocket backend)

### Workload Management
- **Resource browsing** — view Deployments, StatefulSets, DaemonSets, ReplicaSets, Pods, Jobs, CronJobs, Services, Ingresses, ConfigMaps, Secrets, PVCs, ServiceAccounts, and Nodes
- **Batch operations** — select multiple resources and delete in bulk
- **YAML editing** — edit any resource with a full Monaco Editor with syntax highlighting
- **Resource creation** — create resources from YAML templates
- **Resource detail pages** — detailed view with metadata, events, and YAML tabs
- **Init containers** — view init container status and logs on pod detail pages
- **PVC-pod cross-references** — PVC detail shows bound PV and consuming pods; pod detail lists PVC-backed volumes with links
- **Owner references** — resource detail metadata shows "Controlled By" links to parent resources
- **Secret value reveal** — click eye icon on pod env vars to lazy-fetch and decode base64 secret values inline, including envFrom secretRef expansion
- **RBAC Access** — browse and inspect Roles, ClusterRoles, RoleBindings, and ClusterRoleBindings

### Helm
- **Release management** — list, install, and uninstall Helm releases
- **Release detail page** — click any release to see:
  - **Overview** — status, revision, chart version, app version, last deployed time, description, and release notes
  - **Values** — editable YAML editor with **Preview Manifest** (dry-run via `helm template`) and **Save & Upgrade** (uses `--atomic` for automatic rollback on failure)
  - **Manifest** — full rendered manifest in a read-only Monaco YAML editor
  - **History** — revision history table with status badges and one-click rollback

### Monitoring & Debugging
- **Pod logs** — true real-time streaming via `@kubernetes/client-node` Log API (not polling) with search and filtering
- **Pod terminal** — interactive terminal sessions via xterm.js and WebSocket
- **Node and pod metrics** — CPU and memory usage from metrics-server
- **Historical metrics** — Grafana/Mimir integration for historical CPU and memory charts on pod and node detail pages
- **Events** — cluster-wide and resource-scoped event viewing with expandable messages and sortable columns
- **Port forwarding** — create port forwards with automatic browser open

### Plugin System
- **Dynamic plugin architecture** — drop-in plugin directories under `src/plugins/` with auto-discovery
- **Self-contained plugins** — each plugin bundles its own manifest, server handlers, hooks, components, settings panel, and page
- **Resource extensions** — plugins can inject UI into pod and node detail pages (e.g. historical metrics tabs)
- **Catch-all routing** — single API route and page route dispatch to plugin code, no core file edits needed
- **Sidebar integration** — plugins with `hasPage: true` appear automatically under an "Integrations" sidebar section
- **Grafana plugin** — ships with a built-in Grafana/Mimir plugin for historical Prometheus metrics

### Network
- **Network Map** — visual topology diagram showing Ingress → Service → Pod relationships using React Flow with auto-layout (dagre), click-to-navigate, and namespace filtering
- **Traefik IngressRoute support** — automatically discovers Traefik IngressRoute CRDs (`traefik.io` and `traefik.containo.us`) and displays them in the network map with host and match rule details
- **Service endpoints** — service detail page shows Endpoints with ready/not-ready status, IPs, ports, target pod references (linked to pod detail), and node names

### Search & Navigation
- **Browser-style tabs** — Ctrl/Cmd+click or middle-click any link to open in a new tab; tab bar appears automatically with 2+ tabs, hidden otherwise; tabs persist across sessions per cluster via localStorage
- **URL-synced filters** — resource table filter is stored in the `?filter=` URL parameter, so it survives tab switches and back navigation
- **Deterministic back navigation** — back button navigates to the computed parent list URL (preserving filters) instead of unpredictable browser history
- **Command palette** — quick navigation to any page or resource
- **Global resource search** — search across all resource types in a cluster (Cmd+F focuses filter input)
- **Saved searches** — save frequently used filter queries, accessible from the sidebar and command palette
- **Custom Resource Definitions** — browse and manage CRDs and their instances
- **Keyboard shortcuts** — Cmd+T / Ctrl+T to open cluster shell terminal

### Responsive Design
- **Mobile sidebar** — off-canvas drawer with backdrop on small screens (hamburger menu on < md)
- **Adaptive tables** — responsive column hiding (CPU/Memory at lg, Namespace/Node at xl)
- **Responsive layout** — compact header, stacking elements, and full-width filters on mobile
- **Electron window dragging** — draggable header regions for desktop app

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) with custom server for WebSocket |
| Language | TypeScript 5.9 |
| Database | SQLite via Prisma (zero-config, no Docker needed) |
| Styling | Tailwind CSS 4 with OKLCH color system |
| Server State | TanStack React Query |
| Client State | Zustand (persisted stores) |
| K8s Client | `@kubernetes/client-node` with 10s request timeouts |
| Helm | Helm CLI via child_process with `--kube-context` |
| Editor | Monaco Editor (YAML) |
| Terminal | xterm.js with WebSocket backend |
| Tables | TanStack React Table |
| Charts | Recharts |
| Network Graph | React Flow (`@xyflow/react`) with dagre auto-layout |
| Desktop | Electron with Electron Forge |

## Getting Started

### Prerequisites

- Node.js 20+
- A valid kubeconfig file (`~/.kube/config` or set `KUBECONFIG_PATH`)
- Helm CLI installed (for Helm features)

### Setup

```bash
npm install
npm run db:push      # Initialize SQLite database
npm run dev          # Start dev server on http://localhost:3000
```

## Desktop App (Electron)

KlustrEye can run as a standalone desktop application via Electron. The Electron wrapper starts the Next.js server in-process, opens a native window, and stores its SQLite database in the OS user data directory.

```bash
npm run electron:dev     # Build Next.js + bundle server + launch Electron
npm run electron:make    # Build + package distributable (ZIP)
```

The packaged app includes a loading screen while the server starts and automatically finds an available port.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with WebSocket support (terminal) |
| `npm run dev:next` | Start Next.js dev only (no terminal support) |
| `npm run build` | Production build |
| `npm run start` | Run production build |
| `npm run db:push` | Sync Prisma schema to database |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run electron:dev` | Build and launch Electron desktop app |
| `npm run electron:make` | Build and package Electron distributable |
| `npx tsc --noEmit` | Type-check |

## Project Structure

```
src/
  app/
    api/
      clusters/              # Cluster REST API
      organizations/         # Organization CRUD API
    clusters/[contextName]/  # Cluster-scoped pages
      overview/              # Cluster overview with metrics
      workloads/             # Pods, Deployments, StatefulSets, etc.
      network/               # Services, Ingresses, Network Map
      config/                # ConfigMaps, Secrets, ServiceAccounts
      storage/               # PVCs
      access/                # RBAC — Roles, ClusterRoles, Bindings
      helm/                  # Helm releases list + detail
      events/                # Cluster events
      settings/              # Per-cluster settings (color, namespace)
      nodes/                 # Node list + detail
      crds/                  # Custom Resource Definitions
    page.tsx                 # Home page (cluster grid)
  components/
    ui/                      # Base UI primitives (shadcn/ui pattern)
    cluster-switcher.tsx     # Sidebar cluster dropdown with filter
    cluster-shell-terminal.tsx # Cluster-scoped shell terminal
    cloud-provider-icon.tsx  # EKS/GKE/AKS/K8s SVG icons
    mobile-sidebar-drawer.tsx # Off-canvas sidebar for mobile
    manage-organizations-dialog.tsx
    rename-context-dialog.tsx
    network-map/             # Network topology diagram (React Flow)
    resource-detail.tsx
    resource-table.tsx
    command-palette.tsx
    yaml-editor.tsx
  hooks/                     # React Query hooks
  lib/
    k8s/                     # Kubernetes client, resources, Helm, provider detection
    plugins/                 # Plugin system types and registry
    stores/                  # Zustand stores (UI state, saved searches, tabs)
    color-presets.ts         # 16 OKLCH color presets
  plugins/
    index.ts                 # Plugin barrel file (single registration point)
    grafana/                 # Grafana/Mimir plugin
      manifest.ts            # Plugin metadata
      server.ts              # API handlers + Grafana client
      queries.ts             # PromQL query builders
      hooks.ts               # React Query hooks
      components.tsx         # Chart components
      settings-panel.tsx     # Settings UI card
      resource-extensions.tsx # Pod/node metric extensions
      page.tsx               # Dedicated plugin page
prisma/
  schema.prisma              # Database schema
server.ts                    # Custom Node.js server with WebSocket
electron/
  main.js                    # Electron main process
forge.config.ts              # Electron Forge packaging config
```

## Database Models

| Model | Purpose |
|-------|---------|
| `Organization` | Cluster grouping (name, sort order) |
| `ClusterContext` | Per-cluster metadata (display name, namespace, organization) |
| `ClusterSetting` | Key-value settings per cluster (color, cloud provider) |
| `SavedTemplate` | YAML templates for resource creation |
| `TerminalSession` | Terminal session tracking |
| `UserPreference` | Global user preferences |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite connection string |
| `KUBECONFIG_PATH` | `~/.kube/config` | Path to kubeconfig file |

## Architecture Notes

- **No authentication** — runs without login/sessions, designed for local or trusted-network use
- **Kubeconfig only** — cluster discovery uses kubeconfig contexts exclusively
- **API timeouts** — all Kubernetes API calls wrapped with a 10-second timeout to prevent hanging
- **Cloud provider detection** — inferred from server URL hostnames and version strings (EKS, GKE, AKS)
- **Dark theme** — ships with a dark theme using CSS variables and OKLCH colors

## Links

- [GitHub](https://github.com/joli-sys/KlustrEye)
- [Jiri Olah](https://o-li.cz)

## Contributing

Contributions are welcome! Here's how you can help:

1. **Fork** the repository and create a feature branch from `main`
2. **Make your changes** — follow the existing code style and patterns (App Router conventions, shadcn/ui components, React Query for server state)
3. **Test locally** — run `npm run dev` and verify your changes work against a real cluster
4. **Type-check** — run `npx tsc --noEmit` to ensure there are no TypeScript errors
5. **Submit a pull request** — describe what you changed and why

Areas where contributions are especially appreciated:
- Additional Kubernetes resource support
- Improved metrics and monitoring views
- Accessibility improvements
- Bug fixes and performance optimizations

Please open an issue first for large changes or new features so we can discuss the approach.

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Jiří Oláh
