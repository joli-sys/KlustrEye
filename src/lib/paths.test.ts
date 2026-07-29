import { describe, it, expect } from "vitest";
import {
  workspacePath,
  clusterPath,
  clusterSwitchHref,
  rewriteClusterHref,
} from "./paths";

describe("workspacePath", () => {
  it("builds a workspace root", () => {
    expect(workspacePath("ws1")).toBe("/w/ws1");
  });
  it("appends a sub-path", () => {
    expect(workspacePath("ws1", "files/src/main.ts")).toBe("/w/ws1/files/src/main.ts");
  });
  it("encodes the workspace id", () => {
    expect(workspacePath("a b")).toBe("/w/a%20b");
  });
  it("encodes each sub-path segment but not the separators", () => {
    // "#" would otherwise start a URL fragment and the router would see only
    // "files/notes", 404ing on a perfectly ordinary filename.
    expect(workspacePath("ws1", "files/notes#1.md")).toBe(
      "/w/ws1/files/notes%231.md"
    );
    expect(workspacePath("ws1", "files/a b/c?d.txt")).toBe(
      "/w/ws1/files/a%20b/c%3Fd.txt"
    );
  });
  it("round-trips a segment back through decodeURIComponent", () => {
    // react-router's decodePath splits on "/" and decodes each part, so this
    // is exactly what the editor receives from the splat param.
    const href = workspacePath("ws1", "files/notes#1.md");
    const decoded = href.split("/").map(decodeURIComponent).join("/");
    expect(decoded).toBe("/w/ws1/files/notes#1.md");
  });
});

describe("clusterPath", () => {
  it("builds a cluster sub-path", () => {
    expect(clusterPath("ws1", "prod", "workloads/pods")).toBe(
      "/w/ws1/clusters/prod/workloads/pods"
    );
  });
  it("encodes the context name", () => {
    expect(clusterPath("ws1", "my ctx", "overview")).toBe(
      "/w/ws1/clusters/my%20ctx/overview"
    );
  });
  it("tolerates a leading slash on the sub-path", () => {
    expect(clusterPath("ws1", "prod", "/overview")).toBe("/w/ws1/clusters/prod/overview");
  });
  it("returns the cluster root for an empty sub-path", () => {
    expect(clusterPath("ws1", "prod", "")).toBe("/w/ws1/clusters/prod");
  });
  it("throws when the workspace id is the reserved word", () => {
    // Would poison parts.indexOf("clusters") in tab-bar.tsx / resource-table.tsx
    expect(() => clusterPath("clusters", "prod", "overview")).toThrow();
  });
});

describe("rewriteClusterHref", () => {
  it("prefixes a legacy cluster href", () => {
    expect(rewriteClusterHref("ws1", "/clusters/prod/workloads/pods")).toBe(
      "/w/ws1/clusters/prod/workloads/pods"
    );
  });
  it("preserves the query string", () => {
    expect(rewriteClusterHref("ws1", "/clusters/prod/workloads/pods/x?ns=default")).toBe(
      "/w/ws1/clusters/prod/workloads/pods/x?ns=default"
    );
  });
  it("leaves already-migrated hrefs untouched (idempotent)", () => {
    const href = "/w/ws1/clusters/prod/overview";
    expect(rewriteClusterHref("ws1", href)).toBe(href);
  });
  it("leaves unrelated hrefs untouched", () => {
    expect(rewriteClusterHref("ws1", "/settings")).toBe("/settings");
  });
});

describe("clusterSwitchHref", () => {
  it("carries the sub-path onto the other cluster", () => {
    expect(
      clusterSwitchHref("ws1", "prod", "stage", "/w/ws1/clusters/prod/workloads/pods")
    ).toBe("/w/ws1/clusters/stage/workloads/pods");
  });
  it("stays in the SAME workspace — only the context segment moves", () => {
    const href = clusterSwitchHref("ws1", "prod", "stage", "/w/ws1/clusters/prod/nodes");
    expect(href.startsWith("/w/ws1/")).toBe(true);
  });
  it("appends the search string", () => {
    expect(
      clusterSwitchHref(
        "ws1",
        "prod",
        "stage",
        "/w/ws1/clusters/prod/workloads/pods",
        "?filter=api"
      )
    ).toBe("/w/ws1/clusters/stage/workloads/pods?filter=api");
  });
  it("lands on the target cluster root from a path outside the source cluster", () => {
    // Workspace home and `files/*` have no cluster sub-path to carry.
    expect(clusterSwitchHref("ws1", "prod", "stage", "/w/ws1/files/a.yaml")).toBe(
      "/w/ws1/clusters/stage"
    );
  });
  it("lands on the target cluster root when already at the source root", () => {
    expect(clusterSwitchHref("ws1", "prod", "stage", "/w/ws1/clusters/prod")).toBe(
      "/w/ws1/clusters/stage"
    );
  });
  it("matches the prefix in its ENCODED form, as the router reports it", () => {
    // `location.pathname` is percent-encoded, so the prefix built by
    // `clusterPath` compares directly against it — no decode step in between.
    expect(clusterSwitchHref("ws1", "a b", "c d", "/w/ws1/clusters/a%20b/nodes")).toBe(
      "/w/ws1/clusters/c%20d/nodes"
    );
  });
  it("refuses the reserved workspace id", () => {
    expect(() => clusterSwitchHref("clusters", "prod", "stage", "/x")).toThrow();
  });
});
