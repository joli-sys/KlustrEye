import { describe, it, expect } from "vitest";
import { migrateUIState } from "./ui-store";

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
});
