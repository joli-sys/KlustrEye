import { describe, it, expect } from "vitest";
import { workspacePath, clusterPath, rewriteClusterHref } from "./paths";

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
