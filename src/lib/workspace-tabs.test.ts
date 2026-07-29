import { describe, it, expect } from "vitest";
import {
  addOpenWorkspace,
  bindingHint,
  closeOpenWorkspace,
  migrateOpenWorkspaces,
  pruneOpenWorkspaces,
  reconcileOpenWorkspaces,
  workspaceSwitchHref,
} from "./workspace-tabs";
import type { WorkspaceCluster } from "@/hooks/use-workspaces";

const cluster = (contextName: string, sortOrder: number): WorkspaceCluster => ({
  contextName,
  exists: true,
  sortOrder,
});

describe("workspaceSwitchHref", () => {
  it("restores the target workspace's active tab", () => {
    expect(
      workspaceSwitchHref(
        "ws2",
        [
          { id: "a", href: "/w/ws2/files/src/main.ts" },
          { id: "b", href: "/w/ws2/clusters/prod/workloads/pods" },
        ],
        "b"
      )
    ).toBe("/w/ws2/clusters/prod/workloads/pods");
  });

  it("keeps the query string of the restored tab", () => {
    expect(
      workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws2/clusters/prod/events?ns=kube-system" }], "a")
    ).toBe("/w/ws2/clusters/prod/events?ns=kube-system");
  });

  it("falls back home when the active id names a tab that is gone", () => {
    // A close raced with a reload leaves the id behind without its tab.
    expect(
      workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws2/files/a.ts" }], "missing")
    ).toBe("/w/ws2");
  });

  it("falls back home when the stored href belongs to another workspace", () => {
    expect(
      workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws1/clusters/prod/overview" }], "a")
    ).toBe("/w/ws2");
  });

  it("does not accept a workspace whose id merely starts with the target's", () => {
    // "/w/ws2" must not claim "/w/ws20/...".
    expect(
      workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws20/clusters/prod/overview" }], "a")
    ).toBe("/w/ws2");
  });

  it("falls back home when the workspace has no tabs", () => {
    expect(workspaceSwitchHref("ws2", [], "a")).toBe("/w/ws2");
  });

  it("falls back home for an empty or undefined store entry", () => {
    // A workspace never opened in this browser has no entry at all.
    expect(workspaceSwitchHref("ws2", undefined, undefined)).toBe("/w/ws2");
    expect(workspaceSwitchHref("ws2", undefined, null)).toBe("/w/ws2");
    expect(workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws2/files/a.ts" }], null)).toBe(
      "/w/ws2"
    );
  });

  it("falls back home for a tab with an empty href", () => {
    expect(workspaceSwitchHref("ws2", [{ id: "a", href: "" }], "a")).toBe("/w/ws2");
  });

  it("restores a tab sitting on the workspace root itself", () => {
    expect(workspaceSwitchHref("ws2", [{ id: "a", href: "/w/ws2" }], "a")).toBe("/w/ws2");
  });

  it("matches the encoded form of an id that needs escaping", () => {
    expect(
      workspaceSwitchHref("a b", [{ id: "t", href: "/w/a%20b/files/x.ts" }], "t")
    ).toBe("/w/a%20b/files/x.ts");
  });

  it("throws for the reserved workspace id", () => {
    // Same rule as workspacePath — the caller surfaces it as a toast.
    expect(() => workspaceSwitchHref("clusters", [], null)).toThrow();
  });
});

describe("bindingHint", () => {
  it("names the folder and a lone cluster", () => {
    expect(
      bindingHint({ folderPath: "/Users/me/code/klustreye", clusters: [cluster("prod", 0)] })
    ).toBe("klustreye · prod");
  });

  it("counts clusters past the first", () => {
    expect(
      bindingHint({
        folderPath: null,
        clusters: [cluster("prod", 0), cluster("staging", 1)],
      })
    ).toBe("2 clusters");
  });

  it("shows the folder alone when nothing else is bound", () => {
    expect(bindingHint({ folderPath: "/Users/me/code/klustreye", clusters: [] })).toBe(
      "klustreye"
    );
  });

  it("handles a windows path and a trailing separator", () => {
    expect(bindingHint({ folderPath: "C:\\Users\\me\\code", clusters: [] })).toBe("code");
    expect(bindingHint({ folderPath: "/Users/me/code/", clusters: [] })).toBe("code");
  });

  it("says so when the workspace binds nothing", () => {
    expect(bindingHint({ folderPath: null, clusters: [] })).toBe("No bindings");
  });
});

describe("addOpenWorkspace", () => {
  it("appends a workspace that is not open", () => {
    expect(addOpenWorkspace(["a"], "b")).toEqual(["a", "b"]);
  });

  it("is a no-op for one already open, keeping its position", () => {
    // Moving it to the end would shuffle the strip under the cursor on every
    // switch between two open workspaces.
    const ids = ["a", "b", "c"];
    expect(addOpenWorkspace(ids, "a")).toEqual(["a", "b", "c"]);
    expect(addOpenWorkspace(ids, "a")).toBe(ids);
  });

  it("opens the first workspace into an empty strip", () => {
    expect(addOpenWorkspace([], "a")).toEqual(["a"]);
  });
});

describe("pruneOpenWorkspaces", () => {
  it("drops ids that no longer resolve to a workspace", () => {
    expect(pruneOpenWorkspaces(["a", "gone", "b"], ["a", "b", "c"])).toEqual(["a", "b"]);
  });

  it("keeps strip order rather than the known-list order", () => {
    expect(pruneOpenWorkspaces(["c", "a"], ["a", "b", "c"])).toEqual(["c", "a"]);
  });

  it("drops duplicates, which would collide on the React key", () => {
    expect(pruneOpenWorkspaces(["a", "a", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("empties the strip when nothing is known", () => {
    expect(pruneOpenWorkspaces(["a", "b"], [])).toEqual([]);
  });
});

describe("reconcileOpenWorkspaces", () => {
  it("adds the current workspace and prunes the rest", () => {
    expect(reconcileOpenWorkspaces(["a", "gone"], "b", ["a", "b"])).toEqual(["a", "b"]);
  });

  it("prunes nothing while the workspace list is still loading", () => {
    // Pruning against an empty set on the first render would wipe the strip.
    expect(reconcileOpenWorkspaces(["a", "b"], "a", null)).toEqual(["a", "b"]);
  });

  it("keeps the current workspace even when the list has not caught up", () => {
    // useWorkspaces() and the route's single-workspace query are separate
    // caches; the tab the user is standing on must survive either way.
    expect(reconcileOpenWorkspaces([], "new", ["a"])).toEqual(["new"]);
  });
});

describe("closeOpenWorkspace", () => {
  it("closing a background tab removes it and does not move the user", () => {
    expect(closeOpenWorkspace(["a", "b", "c"], "c", "a")).toEqual({
      openWorkspaceIds: ["a", "b"],
      nextActiveId: "a",
    });
  });

  it("closing the active tab picks the one that slid into its slot", () => {
    expect(closeOpenWorkspace(["a", "b", "c"], "b", "b")).toEqual({
      openWorkspaceIds: ["a", "c"],
      nextActiveId: "c",
    });
  });

  it("closing the active LAST tab falls back to the new last one", () => {
    expect(closeOpenWorkspace(["a", "b"], "b", "b")).toEqual({
      openWorkspaceIds: ["a"],
      nextActiveId: "a",
    });
  });

  it("closing the only tab leaves nowhere to go", () => {
    // The caller sends the user to "/" — the same class of bug as closing the
    // last file tab and stranding the editor on a live route.
    expect(closeOpenWorkspace(["a"], "a", "a")).toEqual({
      openWorkspaceIds: [],
      nextActiveId: null,
    });
  });

  it("ignores an id that is not on the strip", () => {
    expect(closeOpenWorkspace(["a", "b"], "gone", "a")).toEqual({
      openWorkspaceIds: ["a", "b"],
      nextActiveId: "a",
    });
  });
});

describe("migrateOpenWorkspaces", () => {
  it("keeps a well-formed list", () => {
    expect(migrateOpenWorkspaces({ openWorkspaceIds: ["a", "b"] })).toEqual({
      openWorkspaceIds: ["a", "b"],
    });
  });

  it("validates by shape, not by version", () => {
    // A payload written before any `version` existed never reaches zustand's
    // `migrate`, so `merge` runs this on every load and must be idempotent.
    expect(migrateOpenWorkspaces({ openWorkspaceIds: "nope" })).toEqual({
      openWorkspaceIds: [],
    });
    expect(migrateOpenWorkspaces({ version: 1 })).toEqual({ openWorkspaceIds: [] });
    expect(migrateOpenWorkspaces(null)).toEqual({ openWorkspaceIds: [] });
    expect(migrateOpenWorkspaces("garbage")).toEqual({ openWorkspaceIds: [] });
  });

  it("drops non-string and duplicate entries", () => {
    expect(
      migrateOpenWorkspaces({ openWorkspaceIds: ["a", 7, null, "", "a", "b"] })
    ).toEqual({ openWorkspaceIds: ["a", "b"] });
  });
});
