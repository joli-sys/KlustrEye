import { describe, it, expect, vi } from "vitest";

// zustand's persist middleware defaults to `window.localStorage` and, when
// unavailable, returns the bare store with no `.persist` api and no writes
// at all — the case under environment: "node". Install a fake
// `window.localStorage` BEFORE ui-store is imported (vi.hoisted runs ahead
// of the import block) so the "never written to storage" test below
// exercises the real persist path instead of a no-op.
const STORAGE_KEY = "klustreye-ui";
const fakeStorage = vi.hoisted(() => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (k: string) => entries.get(k) ?? null,
    setItem: (k: string, v: string) => void entries.set(k, v),
    removeItem: (k: string) => void entries.delete(k),
    clear: () => entries.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return storage;
});

import { migrateUIState, useUIStore } from "./ui-store";
import { basename } from "@/lib/file-link";

describe("migrateUIState", () => {
  it("supplies defaults for null input", () => {
    const r = migrateUIState(null, 0);
    expect(r.namespaceByWorkspace).toEqual({});
    expect(r.resourceFilters).toEqual({});
    expect(r.shellTerminalHeight).toBe(300);
  });

  it("drops v2 cluster-keyed namespaces rather than mis-attributing them", () => {
    // A cluster-keyed namespace cannot be mapped to a workspace id, which does
    // not exist yet at migration time. Dropping resets to "default", which is
    // correct; guessing would bind the wrong namespace to the wrong workspace.
    const v2 = { namespaceByCluster: { prod: "team-a" }, resourceFilters: { "prod::Pod": "web" } };
    const r = migrateUIState(v2, 2);
    expect(r.namespaceByWorkspace).toEqual({});
    expect(r.resourceFilters).toEqual({});
  });

  it("preserves unrelated v2 fields", () => {
    const r = migrateUIState({ shellTerminalHeight: 450 }, 2);
    expect(r.shellTerminalHeight).toBe(450);
  });

  it("passes through v3 state untouched", () => {
    const v3 = {
      namespaceByWorkspace: { ws1: "team-a" },
      resourceFilters: { "ws1::Pod": "web" },
      shellTerminalHeight: 300,
    };
    const r = migrateUIState(v3, 3);
    expect(r.namespaceByWorkspace).toEqual({ ws1: "team-a" });
    expect(r.resourceFilters).toEqual({ "ws1::Pod": "web" });
  });

  it("is shape-driven: migrates a versionless v2 payload", () => {
    const r = migrateUIState({ namespaceByCluster: { prod: "x" } }, 3);
    expect(r.namespaceByWorkspace).toEqual({});
  });

  it("defaults activityView for a payload written before the field existed", () => {
    // No version bump backs this field, so the default has to come from the
    // defaults object — a v3 payload at v3 never triggers `migrate` at all.
    const r = migrateUIState({ namespaceByWorkspace: { ws1: "a" } }, 3);
    expect(r.activityView).toBe("explorer");
  });

  it("keeps a persisted activityView and rejects an unknown one", () => {
    expect(migrateUIState({ activityView: "cluster" }, 3).activityView).toBe("cluster");
    expect(migrateUIState({ activityView: "bogus" }, 3).activityView).toBe("explorer");
  });
});

/** Basename extraction backing the file-not-found "Search workspace" action. */
describe("basename (search-workspace target)", () => {
  it("takes the last segment of a nested path", () => {
    expect(basename("resources/app_caraudit_order.tf")).toBe("app_caraudit_order.tf");
  });

  it("returns the path unchanged when it has no directory", () => {
    expect(basename("app_caraudit_order.tf")).toBe("app_caraudit_order.tf");
  });

  it("takes the last segment of a deeply nested path", () => {
    expect(basename("a/b/c/d.yaml")).toBe("d.yaml");
  });
});

describe("setPendingSearchQuery", () => {
  it("sets the query and switches to the search view in one action", () => {
    useUIStore.setState({ pendingSearchQuery: null, activityView: "explorer" });
    useUIStore.getState().setPendingSearchQuery("app_caraudit_order.tf");

    const state = useUIStore.getState();
    expect(state.pendingSearchQuery).toBe("app_caraudit_order.tf");
    expect(state.activityView).toBe("search");
  });

  it("clears the query without touching the current activity view", () => {
    useUIStore.setState({ pendingSearchQuery: "x", activityView: "search" });
    useUIStore.getState().setPendingSearchQuery(null);

    const state = useUIStore.getState();
    expect(state.pendingSearchQuery).toBeNull();
    expect(state.activityView).toBe("search");
  });

  /**
   * The one-shot model relies entirely on `find-in-files` consuming and
   * clearing the query itself — nothing in the store auto-clears it on an
   * unrelated view switch. Verifying that here is what makes the "clear on
   * consumption, not on a timer or every switch" contract actually hold:
   * if `setActivityView` silently cleared it, a query set while the search
   * view was not visible would vanish before it could ever be consumed.
   */
  it("is not cleared by an unrelated setActivityView call", () => {
    useUIStore.setState({ pendingSearchQuery: null, activityView: "explorer" });
    useUIStore.getState().setPendingSearchQuery("app_caraudit_order.tf");

    useUIStore.getState().setActivityView("explorer");

    expect(useUIStore.getState().pendingSearchQuery).toBe("app_caraudit_order.tf");
  });
});

/**
 * `pendingSearchQuery` is a one-shot UI signal, not state that should survive
 * a reload — a stale query surviving into a new session would silently
 * re-seed search with something the user never asked for this time.
 */
describe("pendingSearchQuery persistence", () => {
  it("is never written to storage, proven via partialize's allow-list", () => {
    fakeStorage.clear();
    useUIStore.setState({ pendingSearchQuery: "leaked-if-broken", activityView: "search" });

    const written = fakeStorage.getItem(STORAGE_KEY);
    expect(written).not.toBeNull();
    const persisted = JSON.parse(written!).state;
    expect(persisted.pendingSearchQuery).toBeUndefined();
    expect(persisted.activityView).toBe("search");
  });
});
