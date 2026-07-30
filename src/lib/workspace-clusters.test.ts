import { describe, it, expect } from "vitest";
import type { Workspace, WorkspaceCluster } from "@/hooks/use-workspaces";
import {
  activeClusterName,
  allClustersMissing,
  firstUsableCluster,
  missingClusters,
  orderedClusters,
  workspaceHasNoBindings,
  workspaceNeedsAttention,
} from "./workspace-clusters";

const cluster = (
  contextName: string,
  exists: boolean,
  sortOrder: number
): WorkspaceCluster => ({ contextName, exists, sortOrder });

const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  id: "ws1",
  name: "alpha",
  folderPath: null,
  clusters: [],
  sortOrder: 0,
  lastOpenedAt: null,
  folderExists: false,
  ...over,
});

describe("orderedClusters", () => {
  it("sorts by sortOrder", () => {
    const out = orderedClusters([cluster("b", true, 1), cluster("a", true, 0)]);
    expect(out.map((c) => c.contextName)).toEqual(["a", "b"]);
  });
  it("breaks ties on contextName, matching the server's ORDER BY", () => {
    const out = orderedClusters([cluster("z", true, 0), cluster("a", true, 0)]);
    expect(out.map((c) => c.contextName)).toEqual(["a", "z"]);
  });
  it("does not mutate its input", () => {
    const input = [cluster("b", true, 1), cluster("a", true, 0)];
    orderedClusters(input);
    expect(input.map((c) => c.contextName)).toEqual(["b", "a"]);
  });
  it("treats undefined as no bindings", () => {
    expect(orderedClusters(undefined)).toEqual([]);
  });
});

describe("activeClusterName", () => {
  const bound = [cluster("eks-prod", true, 0), cluster("eks-stage", true, 1)];

  it("prefers the route param — the URL is where the user actually is", () => {
    expect(activeClusterName(bound, "eks-stage")).toBe("eks-stage");
  });
  it("falls back to the first binding outside a cluster route", () => {
    expect(activeClusterName(bound)).toBe("eks-prod");
  });
  it("honours the route even for a cluster the workspace does not bind", () => {
    // Legacy adoption and hand-typed URLs both land here; painting a different
    // cluster's nav as active would be a lie about where the user is.
    expect(activeClusterName(bound, "other")).toBe("other");
  });
  it("falls back to a MISSING first binding rather than skipping ahead", () => {
    // The Cluster view has to show something, and silently jumping to the
    // second cluster would hide the very binding the user needs to repair.
    const broken = [cluster("gone", false, 0), cluster("live", true, 1)];
    expect(activeClusterName(broken)).toBe("gone");
  });
  it("is undefined when nothing is bound", () => {
    expect(activeClusterName([])).toBeUndefined();
    expect(activeClusterName(undefined)).toBeUndefined();
  });
  it("ignores an empty route param", () => {
    expect(activeClusterName(bound, "")).toBe("eks-prod");
  });
});

describe("missingClusters", () => {
  it("returns only the bindings absent from the kubeconfig, in order", () => {
    const out = missingClusters([
      cluster("b-gone", false, 1),
      cluster("live", true, 0),
      cluster("a-gone", false, 2),
    ]);
    expect(out.map((c) => c.contextName)).toEqual(["b-gone", "a-gone"]);
  });
  it("is empty when every binding resolves", () => {
    expect(missingClusters([cluster("live", true, 0)])).toEqual([]);
  });
  it("is empty when nothing is bound", () => {
    expect(missingClusters([])).toEqual([]);
  });
});

describe("firstUsableCluster", () => {
  it("skips missing bindings", () => {
    const out = firstUsableCluster([cluster("gone", false, 0), cluster("live", true, 1)]);
    expect(out?.contextName).toBe("live");
  });
  it("is undefined when every binding is missing", () => {
    expect(firstUsableCluster([cluster("gone", false, 0)])).toBeUndefined();
  });
});

describe("allClustersMissing", () => {
  it("is false when one of two clusters still resolves", () => {
    // The repair screen would be a dead end over a surface that works.
    expect(allClustersMissing([cluster("gone", false, 0), cluster("live", true, 1)])).toBe(
      false
    );
  });
  it("is true only when every binding is gone", () => {
    expect(allClustersMissing([cluster("gone", false, 0), cluster("also", false, 1)])).toBe(
      true
    );
  });
  it("is false with no bindings at all — that is 'unbound', not 'broken'", () => {
    expect(allClustersMissing([])).toBe(false);
  });
});

describe("workspaceNeedsAttention", () => {
  it("flags a broken folder", () => {
    expect(
      workspaceNeedsAttention(workspace({ folderPath: "/gone", folderExists: false }))
    ).toBe(true);
  });
  it("flags a single missing cluster among healthy ones", () => {
    expect(
      workspaceNeedsAttention(
        workspace({ clusters: [cluster("live", true, 0), cluster("gone", false, 1)] })
      )
    ).toBe(true);
  });
  it("is quiet when every binding resolves", () => {
    expect(
      workspaceNeedsAttention(
        workspace({
          folderPath: "/here",
          folderExists: true,
          clusters: [cluster("live", true, 0)],
        })
      )
    ).toBe(false);
  });
  it("is quiet for a workspace that binds nothing", () => {
    expect(workspaceNeedsAttention(workspace())).toBe(false);
  });
});

describe("workspaceHasNoBindings", () => {
  it("is true with neither a folder nor a cluster", () => {
    expect(workspaceHasNoBindings(workspace())).toBe(true);
  });
  it("is false with a folder alone", () => {
    expect(workspaceHasNoBindings(workspace({ folderPath: "/x", folderExists: true }))).toBe(
      false
    );
  });
  it("is false with a cluster alone, even a missing one", () => {
    expect(workspaceHasNoBindings(workspace({ clusters: [cluster("gone", false, 0)] }))).toBe(
      false
    );
  });
});
