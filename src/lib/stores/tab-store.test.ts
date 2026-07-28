import { describe, it, expect } from "vitest";
import { migrateTabState } from "./tab-store";

describe("migrateTabState", () => {
  it("returns empty state for null or non-object input", () => {
    expect(migrateTabState(null)).toEqual({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
    });
    expect(migrateTabState("nonsense")).toEqual({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
    });
  });

  it("parks v0 cluster-keyed tabs as legacy for later adoption", () => {
    const v0 = {
      tabsByCluster: { prod: [{ id: "1", title: "Pods", href: "/clusters/prod/workloads/pods" }] },
      activeTabIdByCluster: { prod: "1" },
    };
    const result = migrateTabState(v0);
    expect(result.tabsByWorkspace).toEqual({});
    expect(result.legacyTabsByCluster.prod).toHaveLength(1);
  });

  it("migrates shape-driven, even when the version field is absent", () => {
    // zustand skips version-driven migration for versionless payloads AND
    // never rewrites them, so they would persist forever. Detect by shape.
    const versionless = { tabsByCluster: { prod: [{ id: "1", title: "P", href: "/clusters/prod/x" }] } };
    expect(migrateTabState(versionless).legacyTabsByCluster.prod).toHaveLength(1);
  });

  it("passes through already-migrated state untouched", () => {
    const v1 = {
      tabsByWorkspace: { ws1: [{ id: "1", kind: "k8s", title: "P", href: "/w/ws1/clusters/prod/x" }] },
      activeTabIdByWorkspace: { ws1: "1" },
      legacyTabsByCluster: {},
    };
    expect(migrateTabState(v1).tabsByWorkspace.ws1).toHaveLength(1);
  });
});

describe("tab adoption", () => {
  it("rewrites legacy hrefs, tags them k8s, and clears the legacy entry", async () => {
    const { useTabStore } = await import("./tab-store");
    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {
        prod: [{ id: "1", title: "Pods", href: "/clusters/prod/workloads/pods" }],
      },
    });

    useTabStore.getState().adoptLegacyTabs("ws1", "prod");
    const state = useTabStore.getState();

    expect(state.tabsByWorkspace.ws1[0].href).toBe("/w/ws1/clusters/prod/workloads/pods");
    expect(state.tabsByWorkspace.ws1[0].kind).toBe("k8s");
    expect(state.legacyTabsByCluster.prod).toBeUndefined();
  });

  it("does not adopt when the workspace already has tabs", async () => {
    const { useTabStore } = await import("./tab-store");
    useTabStore.setState({
      tabsByWorkspace: { ws1: [{ id: "9", kind: "k8s", title: "Existing", href: "/w/ws1/a" }] },
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: { prod: [{ id: "1", title: "Pods", href: "/clusters/prod/x" }] },
    });

    useTabStore.getState().adoptLegacyTabs("ws1", "prod");
    expect(useTabStore.getState().tabsByWorkspace.ws1).toHaveLength(1);
    expect(useTabStore.getState().tabsByWorkspace.ws1[0].id).toBe("9");
  });
});

describe("openTab dedup", () => {
  it("does not duplicate a tab whose href already exists", async () => {
    const { useTabStore } = await import("./tab-store");
    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
    });

    useTabStore.getState().openTab("ws1", "/w/ws1/clusters/prod/x", "X");
    useTabStore.getState().openTab("ws1", "/w/ws1/clusters/prod/x", "X");
    expect(useTabStore.getState().tabsByWorkspace.ws1).toHaveLength(1);
  });

  it("records kind and payload for non-k8s tabs", async () => {
    const { useTabStore } = await import("./tab-store");
    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
    });

    useTabStore
      .getState()
      .openTab("ws1", "/w/ws1/files/src/a.ts", "a.ts", "file", { path: "/src/a.ts" });
    const tab = useTabStore.getState().tabsByWorkspace.ws1[0];
    expect(tab.kind).toBe("file");
    expect(tab.payload).toEqual({ path: "/src/a.ts" });
  });
});
