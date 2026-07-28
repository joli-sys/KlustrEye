import { create } from "zustand";
import { persist } from "zustand/middleware";
import { rewriteClusterHref } from "@/lib/paths";

export type TabKind = "k8s" | "file" | "terminal" | "agent" | "diff";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  href: string;
  payload?: Record<string, string>;
  dirty?: boolean;
}

/** v0 shape: no `kind`, keyed by cluster. */
interface LegacyTab {
  id: string;
  title: string;
  href: string;
}

interface TabState {
  tabsByWorkspace: Record<string, Tab[]>;
  activeTabIdByWorkspace: Record<string, string | null>;
  /** v0 tabs parked during migration, adopted on first workspace open. */
  legacyTabsByCluster: Record<string, LegacyTab[]>;
  openTab: (
    wsId: string,
    href: string,
    title: string,
    kind?: TabKind,
    payload?: Record<string, string>
  ) => void;
  closeTab: (wsId: string, id: string) => void;
  setActiveTab: (wsId: string, id: string) => void;
  updateActiveTab: (wsId: string, href: string, title: string) => void;
  adoptLegacyTabs: (wsId: string, contextName: string) => void;
}

const MAX_TABS = 20;

export interface MigratedTabState {
  tabsByWorkspace: Record<string, Tab[]>;
  activeTabIdByWorkspace: Record<string, string | null>;
  legacyTabsByCluster: Record<string, LegacyTab[]>;
}

/**
 * Shape-driven, NOT version-driven.
 *
 * zustand 5.0.11 only runs `migrate` when the stored payload has a numeric
 * `version` that differs (middleware.js:392), and only rewrites storage when
 * migration actually ran (:422-424). A payload lacking `version` would
 * therefore be merged verbatim forever. Detecting `tabsByCluster` by shape
 * makes migration idempotent and version-independent.
 */
export function migrateTabState(persisted: unknown): MigratedTabState {
  const empty: MigratedTabState = {
    tabsByWorkspace: {},
    activeTabIdByWorkspace: {},
    legacyTabsByCluster: {},
  };
  if (!persisted || typeof persisted !== "object") return empty;

  const p = persisted as Record<string, unknown>;

  if (p.tabsByCluster && typeof p.tabsByCluster === "object") {
    return {
      ...empty,
      legacyTabsByCluster: p.tabsByCluster as Record<string, LegacyTab[]>,
    };
  }

  return {
    tabsByWorkspace: (p.tabsByWorkspace as Record<string, Tab[]>) ?? {},
    activeTabIdByWorkspace:
      (p.activeTabIdByWorkspace as Record<string, string | null>) ?? {},
    legacyTabsByCluster:
      (p.legacyTabsByCluster as Record<string, LegacyTab[]>) ?? {},
  };
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},

      openTab: (wsId, href, title, kind = "k8s", payload) =>
        set((state) => {
          const tabs = [...(state.tabsByWorkspace[wsId] || [])];
          const existing = tabs.find((t) => t.href === href);
          if (existing) {
            return {
              activeTabIdByWorkspace: {
                ...state.activeTabIdByWorkspace,
                [wsId]: existing.id,
              },
            };
          }
          const id = crypto.randomUUID();
          tabs.push({ id, kind, title, href, payload });
          while (tabs.length > MAX_TABS) tabs.shift();
          return {
            tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: tabs },
            activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [wsId]: id },
          };
        }),

      closeTab: (wsId, id) =>
        set((state) => {
          const oldTabs = state.tabsByWorkspace[wsId] || [];
          const tabs = oldTabs.filter((t) => t.id !== id);
          let activeId = state.activeTabIdByWorkspace[wsId];
          if (activeId === id) {
            const idx = oldTabs.findIndex((t) => t.id === id);
            activeId = tabs[Math.min(idx, tabs.length - 1)]?.id || null;
          }
          return {
            tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: tabs },
            activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [wsId]: activeId },
          };
        }),

      setActiveTab: (wsId, id) =>
        set((state) => ({
          activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [wsId]: id },
        })),

      updateActiveTab: (wsId, href, title) =>
        set((state) => {
          const activeId = state.activeTabIdByWorkspace[wsId];
          if (!activeId) return state;
          const currentTabs = state.tabsByWorkspace[wsId] || [];
          const active = currentTabs.find((t) => t.id === activeId);
          if (active && active.href === href && active.title === title) return state;
          const tabs = currentTabs.map((t) =>
            t.id === activeId ? { ...t, href, title } : t
          );
          return { tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: tabs } };
        }),

      adoptLegacyTabs: (wsId, contextName) =>
        set((state) => {
          const legacy = state.legacyTabsByCluster[contextName];
          if (!legacy || legacy.length === 0) return state;
          if ((state.tabsByWorkspace[wsId] || []).length > 0) return state;

          const adopted: Tab[] = legacy.map((t) => ({
            id: t.id,
            kind: "k8s" as const,
            title: t.title,
            href: rewriteClusterHref(wsId, t.href),
          }));

          const nextLegacy = { ...state.legacyTabsByCluster };
          delete nextLegacy[contextName];

          return {
            tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: adopted },
            legacyTabsByCluster: nextLegacy,
          };
        }),
    }),
    {
      name: "klustreye-tabs",
      version: 1,
      migrate: (persisted) => migrateTabState(persisted),
      merge: (persisted, current) => ({ ...current, ...migrateTabState(persisted) }),
      partialize: (state) => ({
        tabsByWorkspace: state.tabsByWorkspace,
        activeTabIdByWorkspace: state.activeTabIdByWorkspace,
        legacyTabsByCluster: state.legacyTabsByCluster,
      }),
    }
  )
);
