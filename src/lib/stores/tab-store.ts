import { create } from "zustand";
import { persist } from "zustand/middleware";
import { rewriteClusterHref } from "@/lib/paths";
import { fileModelKey, isDirty, releaseIfClean } from "@/lib/editor/model-registry";

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
  /** v0 selection parked alongside the tabs; restored by adoptLegacyTabs. */
  legacyActiveTabIdByCluster: Record<string, string | null>;
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

/**
 * The Monaco registry key for a file tab, or `null` for every other kind.
 *
 * Only `file` tabs own a buffer, and only those carry `payload.path`. Built
 * through the same `fileModelKey` the editor uses — a second spelling of the
 * key would silently fail to find the model and leak it. Lives here rather
 * than in `tab-bar` because eviction needs it too, and two copies would drift.
 */
export function modelKeyForTab(wsId: string, tab: Tab): string | null {
  if (tab.kind !== "file") return null;
  const path = tab.payload?.path;
  return path === undefined ? null : fileModelKey(wsId, path);
}

/**
 * Drop `dirty` from every tab.
 *
 * The flag mirrors a Monaco buffer, and buffers do not survive a reload. A
 * persisted `dirty: true` would paint "Unsaved changes" on a tab whose buffer
 * no longer exists, and it would never clear: the dot is only recomputed for
 * the one tab whose editor actually mounts and runs `syncDirty`, so every
 * other tab keeps a false dot indefinitely.
 *
 * Applied on both sides — `partialize` keeps it out of storage from now on,
 * `migrateTabState` scrubs payloads written before this fix.
 */
function stripDirty(byWorkspace: Record<string, Tab[]>): Record<string, Tab[]> {
  const out: Record<string, Tab[]> = {};
  for (const [wsId, tabs] of Object.entries(byWorkspace)) {
    out[wsId] = (tabs ?? []).map(({ dirty: _dirty, ...rest }) => rest);
  }
  return out;
}

export interface MigratedTabState {
  tabsByWorkspace: Record<string, Tab[]>;
  activeTabIdByWorkspace: Record<string, string | null>;
  legacyTabsByCluster: Record<string, LegacyTab[]>;
  legacyActiveTabIdByCluster: Record<string, string | null>;
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
    legacyActiveTabIdByCluster: {},
  };
  if (!persisted || typeof persisted !== "object") return empty;

  const p = persisted as Record<string, unknown>;

  if (p.tabsByCluster && typeof p.tabsByCluster === "object") {
    // Park the selection too: without it adoptLegacyTabs leaves activeTabId
    // null, which both un-highlights every tab and short-circuits
    // updateActiveTab — disarming the href self-heal on first mount.
    return {
      ...empty,
      legacyTabsByCluster: p.tabsByCluster as Record<string, LegacyTab[]>,
      legacyActiveTabIdByCluster:
        (p.activeTabIdByCluster as Record<string, string | null>) ?? {},
    };
  }

  return {
    tabsByWorkspace: stripDirty((p.tabsByWorkspace as Record<string, Tab[]>) ?? {}),
    activeTabIdByWorkspace:
      (p.activeTabIdByWorkspace as Record<string, string | null>) ?? {},
    legacyTabsByCluster:
      (p.legacyTabsByCluster as Record<string, LegacyTab[]>) ?? {},
    legacyActiveTabIdByCluster:
      (p.legacyActiveTabIdByCluster as Record<string, string | null>) ?? {},
  };
}

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
      legacyActiveTabIdByCluster: {},

      openTab: (wsId, href, title, kind = "k8s", payload) => {
        // Freed after the update rather than inside it, so the state updater
        // stays a pure function of `state`.
        const evictedKeys: string[] = [];

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

          // Eviction obeys the same rule as closing a tab: never destroy
          // unsaved work silently. Take the oldest CLEAN tab, not simply the
          // oldest, and if every tab is dirty let the count exceed MAX_TABS —
          // an over-long tab strip is a nuisance, lost edits are not. A tab
          // with no buffer (any non-file kind) is always evictable.
          while (tabs.length > MAX_TABS) {
            const victim = tabs.findIndex((t) => {
              if (t.id === id) return false; // never the tab just opened
              const key = modelKeyForTab(wsId, t);
              return key === null || !isDirty(key);
            });
            if (victim === -1) break;
            const [evicted] = tabs.splice(victim, 1);
            const key = modelKeyForTab(wsId, evicted);
            if (key) evictedKeys.push(key);
          }

          return {
            tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: tabs },
            activeTabIdByWorkspace: { ...state.activeTabIdByWorkspace, [wsId]: id },
          };
        });

        // Without this an evicted tab's model would stay registered with
        // nothing left pointing at it — a leak for the life of the process.
        for (const key of evictedKeys) releaseIfClean(key);
      },

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
          const nextLegacyActive = { ...state.legacyActiveTabIdByCluster };
          delete nextLegacyActive[contextName];

          // Tab ids survive adoption, so the v0 selection maps straight across.
          const activeId =
            state.legacyActiveTabIdByCluster?.[contextName] ??
            adopted[adopted.length - 1]?.id ??
            null;

          return {
            tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: adopted },
            activeTabIdByWorkspace: {
              ...state.activeTabIdByWorkspace,
              [wsId]: activeId,
            },
            legacyTabsByCluster: nextLegacy,
            legacyActiveTabIdByCluster: nextLegacyActive,
          };
        }),
    }),
    {
      name: "klustreye-tabs",
      version: 1,
      migrate: (persisted) => migrateTabState(persisted),
      merge: (persisted, current) => ({ ...current, ...migrateTabState(persisted) }),
      partialize: (state) => ({
        tabsByWorkspace: stripDirty(state.tabsByWorkspace),
        activeTabIdByWorkspace: state.activeTabIdByWorkspace,
        legacyTabsByCluster: state.legacyTabsByCluster,
        legacyActiveTabIdByCluster: state.legacyActiveTabIdByCluster,
      }),
    }
  )
);
