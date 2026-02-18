import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Tab {
  id: string;
  title: string;
  href: string;
}

interface TabState {
  tabsByCluster: Record<string, Tab[]>;
  activeTabIdByCluster: Record<string, string | null>;
  getTabs: (cluster: string) => Tab[];
  getActiveTabId: (cluster: string) => string | null;
  openTab: (cluster: string, href: string, title: string) => void;
  closeTab: (cluster: string, id: string) => void;
  setActiveTab: (cluster: string, id: string) => void;
  updateActiveTab: (cluster: string, href: string, title: string) => void;
}

const MAX_TABS = 20;

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabsByCluster: {},
      activeTabIdByCluster: {},

      getTabs: (cluster) => get().tabsByCluster[cluster] || [],

      getActiveTabId: (cluster) => get().activeTabIdByCluster[cluster] || null,

      openTab: (cluster, href, title) =>
        set((state) => {
          const tabs = [...(state.tabsByCluster[cluster] || [])];
          const existing = tabs.find((t) => t.href === href);
          if (existing) {
            return {
              activeTabIdByCluster: {
                ...state.activeTabIdByCluster,
                [cluster]: existing.id,
              },
            };
          }
          const id = crypto.randomUUID();
          const newTab: Tab = { id, title, href };
          tabs.push(newTab);
          // Evict oldest if exceeded
          while (tabs.length > MAX_TABS) {
            tabs.shift();
          }
          return {
            tabsByCluster: { ...state.tabsByCluster, [cluster]: tabs },
            activeTabIdByCluster: {
              ...state.activeTabIdByCluster,
              [cluster]: id,
            },
          };
        }),

      closeTab: (cluster, id) =>
        set((state) => {
          const tabs = (state.tabsByCluster[cluster] || []).filter(
            (t) => t.id !== id
          );
          let activeId = state.activeTabIdByCluster[cluster];
          if (activeId === id) {
            // Activate adjacent tab
            const oldTabs = state.tabsByCluster[cluster] || [];
            const idx = oldTabs.findIndex((t) => t.id === id);
            const adjacent = tabs[Math.min(idx, tabs.length - 1)];
            activeId = adjacent?.id || null;
          }
          return {
            tabsByCluster: { ...state.tabsByCluster, [cluster]: tabs },
            activeTabIdByCluster: {
              ...state.activeTabIdByCluster,
              [cluster]: activeId,
            },
          };
        }),

      setActiveTab: (cluster, id) =>
        set((state) => ({
          activeTabIdByCluster: {
            ...state.activeTabIdByCluster,
            [cluster]: id,
          },
        })),

      updateActiveTab: (cluster, href, title) =>
        set((state) => {
          const activeId = state.activeTabIdByCluster[cluster];
          if (!activeId) return state;
          const currentTabs = state.tabsByCluster[cluster] || [];
          const active = currentTabs.find((t) => t.id === activeId);
          // Bail out if nothing changed — prevents re-render loops
          if (active && active.href === href && active.title === title) return state;
          const tabs = currentTabs.map((t) =>
            t.id === activeId ? { ...t, href, title } : t
          );
          return {
            tabsByCluster: { ...state.tabsByCluster, [cluster]: tabs },
          };
        }),
    }),
    {
      name: "klustreye-tabs",
      partialize: (state) => ({
        tabsByCluster: state.tabsByCluster,
        activeTabIdByCluster: state.activeTabIdByCluster,
      }),
    }
  )
);
