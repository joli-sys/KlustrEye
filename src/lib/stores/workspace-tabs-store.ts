import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  closeOpenWorkspace,
  migrateOpenWorkspaces,
  reconcileOpenWorkspaces,
} from "@/lib/workspace-tabs";

/**
 * Which workspaces are OPEN, in strip order.
 *
 * Deliberately its own store rather than a field on `ui-store`: that one is
 * already on its third persisted shape, and this list has a different lifetime
 * (it is reconciled against the server's workspace list on every load) than
 * panel and namespace preferences. A separate `name` also means a corrupt
 * payload here cannot take the rest of the UI state down with it.
 *
 * Every rule lives in `lib/workspace-tabs.ts` as a pure function; this file is
 * only the zustand wiring.
 */
interface WorkspaceTabsState {
  openWorkspaceIds: string[];
  /** Add the workspace on screen, and drop ids the server no longer knows. */
  reconcile: (currentId: string, knownIds: string[] | null) => void;
  /** Remove from the strip ONLY — the workspace itself is untouched. */
  closeWorkspaceTab: (id: string, activeId: string | null) => string | null;
}

/** Element-wise, so a reconcile that changes nothing does not re-render. */
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>()(
  persist(
    (set, get) => ({
      openWorkspaceIds: [],

      reconcile: (currentId, knownIds) =>
        set((state) => {
          const next = reconcileOpenWorkspaces(state.openWorkspaceIds, currentId, knownIds);
          // Reconcile runs from an effect on every workspace-list refetch; a
          // fresh array each time would loop that effect forever.
          return sameIds(next, state.openWorkspaceIds) ? state : { openWorkspaceIds: next };
        }),

      /**
       * Returns the workspace to show next, or `null` when the strip is empty.
       * The caller navigates — the store has no router, and closing a tab that
       * was not on screen must not move the user at all.
       */
      closeWorkspaceTab: (id, activeId) => {
        const { openWorkspaceIds, nextActiveId } = closeOpenWorkspace(
          get().openWorkspaceIds,
          id,
          activeId
        );
        set({ openWorkspaceIds });
        return nextActiveId;
      },
    }),
    {
      name: "klustreye-workspace-tabs",
      version: 1,
      migrate: (persisted) => migrateOpenWorkspaces(persisted),
      merge: (persisted, current) => ({ ...current, ...migrateOpenWorkspaces(persisted) }),
      partialize: (state) => ({ openWorkspaceIds: state.openWorkspaceIds }),
    }
  )
);
