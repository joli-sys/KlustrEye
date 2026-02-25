import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarOpen: boolean;
  namespaceByCluster: Record<string, string>;
  commandPaletteOpen: boolean;
  mobileSidebarOpen: boolean;
  resourceFilters: Record<string, string>;
  shellTerminalOpen: boolean;
  shellTerminalHeight: number;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setClusterNamespace: (contextName: string, ns: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setResourceFilter: (key: string, value: string) => void;
  toggleShellTerminal: () => void;
  setShellTerminalOpen: (open: boolean) => void;
  setShellTerminalHeight: (height: number) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      namespaceByCluster: {},
      commandPaletteOpen: false,
      mobileSidebarOpen: false,
      resourceFilters: {},
      shellTerminalOpen: false,
      shellTerminalHeight: 300,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setClusterNamespace: (contextName, ns) =>
        set((state) => ({
          namespaceByCluster: { ...state.namespaceByCluster, [contextName]: ns },
        })),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      toggleShellTerminal: () => set((state) => ({ shellTerminalOpen: !state.shellTerminalOpen })),
      setShellTerminalOpen: (open) => set({ shellTerminalOpen: open }),
      setShellTerminalHeight: (height) => set({ shellTerminalHeight: height }),
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
      version: 2,
      migrate: (persisted) => ({
        namespaceByCluster: {},
        resourceFilters: {},
        shellTerminalHeight: 300,
        ...(persisted && typeof persisted === "object" ? persisted : {}),
      }),
      partialize: (state) => ({
        namespaceByCluster: state.namespaceByCluster,
        resourceFilters: state.resourceFilters,
        shellTerminalHeight: state.shellTerminalHeight,
      }),
    }
  )
);
