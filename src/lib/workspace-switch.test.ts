import { describe, it, expect } from "vitest";
import { bindingHint, workspaceSwitchHref } from "./workspace-switch";
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
