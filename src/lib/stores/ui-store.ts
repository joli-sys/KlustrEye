import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarOpen: boolean;
  namespaceByWorkspace: Record<string, string>;
  commandPaletteOpen: boolean;
  mobileSidebarOpen: boolean;
  resourceFilters: Record<string, string>;
  shellTerminalOpen: boolean;
  shellTerminalHeight: number;
  clusterSwitcherOpen: boolean;
  aiPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setWorkspaceNamespace: (wsId: string, ns: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setResourceFilter: (key: string, value: string) => void;
  toggleShellTerminal: () => void;
  setShellTerminalOpen: (open: boolean) => void;
  setShellTerminalHeight: (height: number) => void;
  setClusterSwitcherOpen: (open: boolean) => void;
  toggleClusterSwitcher: () => void;
  toggleAiPanel: () => void;
  setAiPanelOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      namespaceByWorkspace: {},
      commandPaletteOpen: false,
      mobileSidebarOpen: false,
      resourceFilters: {},
      shellTerminalOpen: false,
      shellTerminalHeight: 300,
      clusterSwitcherOpen: false,
      aiPanelOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setWorkspaceNamespace: (wsId, ns) =>
        set((state) => ({
          namespaceByWorkspace: { ...state.namespaceByWorkspace, [wsId]: ns },
        })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleShellTerminal: () => set((state) => ({ shellTerminalOpen: !state.shellTerminalOpen })),
      setShellTerminalOpen: (open) => set({ shellTerminalOpen: open }),
      setShellTerminalHeight: (height) => set({ shellTerminalHeight: height }),
      setClusterSwitcherOpen: (open) => set({ clusterSwitcherOpen: open }),
      toggleClusterSwitcher: () => set((state) => ({ clusterSwitcherOpen: !state.clusterSwitcherOpen })),
      toggleAiPanel: () => set((state) => ({ aiPanelOpen: !state.aiPanelOpen })),
      setAiPanelOpen: (v) => set({ aiPanelOpen: v }),
      setResourceFilter: (key, value) => set((state) => {
        const next = { ...state.resourceFilters };
        if (value) {
          next[key] = value;
        } else {
          delete next[key];
        }
        return { resourceFilters: next };
      }),
    }),
    {
      name: "klustreye-ui",
      version: 3,
      migrate: (persisted, version) => migrateUIState(persisted, version),
      merge: (persisted, current) => ({
        ...current,
        ...migrateUIState(persisted, 3),
      }),
      // aiPanelOpen intentionally excluded — AI panel state resets on app restart
      partialize: (state) => ({
        namespaceByWorkspace: state.namespaceByWorkspace,
        resourceFilters: state.resourceFilters,
        shellTerminalHeight: state.shellTerminalHeight,
      }),
    }
  )
);

export interface MigratedUIState {
  namespaceByWorkspace: Record<string, string>;
  resourceFilters: Record<string, string>;
  shellTerminalHeight: number;
}

/**
 * v2 -> v3: namespaceByCluster -> namespaceByWorkspace, and resourceFilters
 * re-keyed from `${contextName}::${kind}` to `${wsId}::${kind}`.
 *
 * Both are DROPPED rather than remapped: workspace ids do not exist at
 * migration time, so any mapping would be a guess. Dropping resets the
 * namespace to "default" and clears filters — both harmless and correct.
 *
 * Shape-driven for the same reason as the tab store (see tab-store.ts).
 */
export function migrateUIState(persisted: unknown, _version: number): MigratedUIState {
  const defaults: MigratedUIState = {
    namespaceByWorkspace: {},
    resourceFilters: {},
    shellTerminalHeight: 300,
  };
  if (!persisted || typeof persisted !== "object") return defaults;

  const p = persisted as Record<string, unknown>;
  const isLegacy = "namespaceByCluster" in p;

  return {
    namespaceByWorkspace: isLegacy
      ? {}
      : ((p.namespaceByWorkspace as Record<string, string>) ?? {}),
    resourceFilters: isLegacy
      ? {}
      : ((p.resourceFilters as Record<string, string>) ?? {}),
    shellTerminalHeight:
      typeof p.shellTerminalHeight === "number" ? p.shellTerminalHeight : 300,
  };
}
