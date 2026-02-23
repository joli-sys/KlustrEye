import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarOpen: boolean;
  selectedNamespace: string;
  commandPaletteOpen: boolean;
  mobileSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSelectedNamespace: (ns: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      selectedNamespace: "default",
      commandPaletteOpen: false,
      mobileSidebarOpen: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSelectedNamespace: (ns) => set({ selectedNamespace: ns }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
    }),
    {
      name: "klustreye-ui",
      partialize: (state) => ({ selectedNamespace: state.selectedNamespace }),
    }
  )
);
