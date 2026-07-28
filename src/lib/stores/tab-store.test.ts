import { describe, it, expect, vi } from "vitest";

// zustand's persist middleware defaults to `window.localStorage`
// (middleware.mjs:330) and, when that is unavailable, returns the bare store
// with no `.persist` api and no writes at all (:344-352) — which is the case
// under environment: "node". Install a fake `window.localStorage` BEFORE
// tab-store is imported (vi.hoisted runs ahead of the import block) so the
// persistence tests below exercise the real storage + merge path.
const STORAGE_KEY = "klustreye-tabs";
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

// tab-store reaches the model registry to keep eviction from destroying
// unsaved work, and the registry imports monaco. vitest.config.ts runs with
// environment: "node", where real monaco (which needs a DOM) cannot load —
// same minimal fake as model-registry.test.ts.
vi.mock("monaco-editor", () => {
  function createModel(content: string, language: string) {
    let value = content;
    let versionId = 1;
    return {
      __language: language,
      getValue: () => value,
      setValue: (next: string) => {
        value = next;
        versionId += 1;
      },
      getAlternativeVersionId: () => versionId,
      dispose: vi.fn(),
      onDidChangeContent: vi.fn(),
    };
  }
  return { editor: { createModel } };
});

import { migrateTabState } from "./tab-store";
import {
  disposeAll,
  fileModelKey,
  getOrCreateModel,
  isDirty,
} from "@/lib/editor/model-registry";

describe("migrateTabState", () => {
  it("returns empty state for null or non-object input", () => {
    expect(migrateTabState(null)).toEqual({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
      legacyActiveTabIdByCluster: {},
    });
    expect(migrateTabState("nonsense")).toEqual({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
      legacyActiveTabIdByCluster: {},
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

  it("carries the active tab id through migration and adoption", async () => {
    const { migrateTabState, useTabStore } = await import("./tab-store");

    const v0 = {
      tabsByCluster: {
        prod: [
          { id: "1", title: "Pods", href: "/clusters/prod/workloads/pods" },
          { id: "2", title: "Services", href: "/clusters/prod/network/services" },
        ],
      },
      activeTabIdByCluster: { prod: "1" },
    };

    const migrated = migrateTabState(v0);
    expect(migrated.legacyActiveTabIdByCluster.prod).toBe("1");

    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: migrated.legacyTabsByCluster,
      legacyActiveTabIdByCluster: migrated.legacyActiveTabIdByCluster,
    });

    useTabStore.getState().adoptLegacyTabs("ws1", "prod");
    const state = useTabStore.getState();

    // Without this, tab-bar highlights nothing AND updateActiveTab returns
    // early on `if (!activeId)`, disarming the href self-heal.
    expect(state.activeTabIdByWorkspace.ws1).toBe("1");
    expect(state.legacyActiveTabIdByCluster.prod).toBeUndefined();
  });

  it("falls back to the last adopted tab when the v0 selection is absent", async () => {
    const { useTabStore } = await import("./tab-store");
    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {
        prod: [
          { id: "1", title: "Pods", href: "/clusters/prod/workloads/pods" },
          { id: "2", title: "Services", href: "/clusters/prod/network/services" },
        ],
      },
      legacyActiveTabIdByCluster: {},
    });

    useTabStore.getState().adoptLegacyTabs("ws1", "prod");
    expect(useTabStore.getState().activeTabIdByWorkspace.ws1).toBe("2");
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

/**
 * `dirty` is a mirror of a Monaco buffer, and buffers die with the page.
 * Persisting the flag makes the tab bar paint "Unsaved changes" on tabs whose
 * buffer no longer exists — and it never clears, because only the tab whose
 * editor mounts recomputes it.
 */
describe("persisted dirty flag", () => {
  const dirtyTab = {
    id: "1",
    kind: "file",
    title: "a.ts",
    href: "/w/ws1/files/a.ts",
    payload: { path: "a.ts" },
    dirty: true,
  };

  it("does not survive rehydration, even from a versionless payload", async () => {
    const { useTabStore } = await import("./tab-store");

    // No `version` field on purpose: zustand only runs `migrate` for a
    // payload whose numeric version differs, so a versionless one would never
    // be touched by it. The scrub therefore has to live on the merge path.
    fakeStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          tabsByWorkspace: { ws1: [dirtyTab] },
          activeTabIdByWorkspace: { ws1: "1" },
          legacyTabsByCluster: {},
          legacyActiveTabIdByCluster: {},
        },
      })
    );

    await useTabStore.persist.rehydrate();

    const tab = useTabStore.getState().tabsByWorkspace.ws1[0];
    expect(tab.title).toBe("a.ts");
    expect(tab.dirty).toBeUndefined();
  });

  it("is never written to storage in the first place", async () => {
    const { useTabStore } = await import("./tab-store");
    fakeStorage.clear();

    useTabStore.setState({
      tabsByWorkspace: { ws1: [{ ...dirtyTab, kind: "file" as const }] },
      activeTabIdByWorkspace: { ws1: "1" },
    });

    const written = fakeStorage.getItem(STORAGE_KEY);
    expect(written).not.toBeNull();
    expect(JSON.parse(written!).state.tabsByWorkspace.ws1[0].dirty).toBeUndefined();
  });
});

/**
 * Eviction is a silent close, so it has to honour the same rule the close
 * button does: never destroy unsaved work without asking.
 */
describe("MAX_TABS eviction", () => {
  const MAX_TABS = 20;

  /** Open `count` file tabs and register a buffer for each. */
  async function fillTabs(count: number) {
    const { useTabStore } = await import("./tab-store");
    disposeAll();
    useTabStore.setState({
      tabsByWorkspace: {},
      activeTabIdByWorkspace: {},
      legacyTabsByCluster: {},
      legacyActiveTabIdByCluster: {},
    });

    const models: ReturnType<typeof getOrCreateModel>[] = [];
    for (let i = 0; i < count; i += 1) {
      const path = `f${i}.ts`;
      useTabStore
        .getState()
        .openTab("ws1", `/w/ws1/files/${path}`, path, "file", { path });
      models.push(getOrCreateModel(fileModelKey("ws1", path), "x", "typescript"));
    }
    return { useTabStore, models };
  }

  it("skips the oldest tab when it is dirty and evicts the oldest clean one", async () => {
    const { useTabStore, models } = await fillTabs(MAX_TABS);
    models[0].setValue("unsaved edit");
    expect(isDirty(fileModelKey("ws1", "f0.ts"))).toBe(true);

    useTabStore
      .getState()
      .openTab("ws1", "/w/ws1/files/new.ts", "new.ts", "file", { path: "new.ts" });

    const titles = useTabStore.getState().tabsByWorkspace.ws1.map((t) => t.title);
    expect(titles).toHaveLength(MAX_TABS);
    expect(titles).toContain("f0.ts"); // dirty, kept
    expect(titles).not.toContain("f1.ts"); // oldest clean, evicted
    expect(titles).toContain("new.ts");

    // The evicted tab's buffer is freed, not leaked.
    expect(models[1].dispose).toHaveBeenCalledTimes(1);
    expect(models[0].dispose).not.toHaveBeenCalled();
  });

  it("lets the count exceed MAX_TABS rather than evict a dirty tab", async () => {
    const { useTabStore, models } = await fillTabs(MAX_TABS);
    for (const m of models) m.setValue("unsaved edit");

    useTabStore
      .getState()
      .openTab("ws1", "/w/ws1/files/new.ts", "new.ts", "file", { path: "new.ts" });

    expect(useTabStore.getState().tabsByWorkspace.ws1).toHaveLength(MAX_TABS + 1);
    for (const m of models) expect(m.dispose).not.toHaveBeenCalled();
  });
});
