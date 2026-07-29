import { describe, it, expect, beforeEach, vi } from "vitest";

// zustand's persist middleware needs a `window.localStorage` to attach to;
// under environment: "node" it otherwise returns the bare store. Same hoisted
// fake as tab-store.test.ts — these tests drive the real store.
vi.hoisted(() => {
  const entries = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => entries.get(k) ?? null,
      setItem: (k: string, v: string) => void entries.set(k, v),
      removeItem: (k: string) => void entries.delete(k),
      clear: () => entries.clear(),
      key: () => null,
      length: 0,
    },
  };
});

// tab-store reaches the model registry, which imports monaco — unloadable
// without a DOM. Minimal fake, as in tab-store.test.ts.
vi.mock("monaco-editor", () => ({
  editor: {
    createModel: (content: string) => ({
      getValue: () => content,
      getAlternativeVersionId: () => 1,
      isAttachedToEditor: () => false,
      dispose: vi.fn(),
      onDidChangeContent: vi.fn(),
    }),
  },
}));

import { deriveTabTargetFromPath, syncTabToLocation } from "./tab-route";
import { useTabStore, type Tab } from "@/lib/stores/tab-store";

const WS = "ws1";
const FILE_HREF = "/w/ws1/files/infra/main.tf";
const PODS_HREF = "/w/ws1/clusters/eks/workloads/pods";
const AGENT_HREF = "/w/ws1/agents/sess-1";

/** The tab a file-tree click produces, spelled exactly as `file-tree` does. */
const fileTab: Tab = {
  id: "file-1",
  kind: "file",
  title: "main.tf",
  href: FILE_HREF,
  payload: { path: "infra/main.tf" },
};

/** The tab opening an agent session produces, with the definition's name. */
const agentTab: Tab = {
  id: "agent-1",
  kind: "agent",
  title: "Claude Code",
  href: AGENT_HREF,
  payload: { sessionId: "sess-1" },
};

function seed(tabs: Tab[], activeId: string | null) {
  useTabStore.setState({
    tabsByWorkspace: { [WS]: tabs },
    activeTabIdByWorkspace: { [WS]: activeId },
    legacyTabsByCluster: {},
    legacyActiveTabIdByCluster: {},
  });
}

const tabs = () => useTabStore.getState().tabsByWorkspace[WS];
const activeTab = () =>
  tabs().find((t) => t.id === useTabStore.getState().activeTabIdByWorkspace[WS]);

describe("deriveTabTargetFromPath", () => {
  it("reads a file tab out of /w/:wsId/files/*", () => {
    expect(deriveTabTargetFromPath(FILE_HREF)).toEqual({
      kind: "file",
      title: "main.tf",
      payload: { path: "infra/main.tf" },
    });
  });

  it("decodes the splat the way react-router hands it to FileEditor", () => {
    // `paths.ts` percent-encodes each segment, so `notes#1.md` arrives escaped.
    expect(deriveTabTargetFromPath("/w/ws1/files/a%20b/notes%231.md")).toEqual({
      kind: "file",
      title: "notes#1.md",
      payload: { path: "a b/notes#1.md" },
    });
  });

  it("reads a k8s tab out of /w/:wsId/clusters/:contextName/...", () => {
    expect(deriveTabTargetFromPath(PODS_HREF)).toEqual({ kind: "k8s", title: "Pods" });
    expect(deriveTabTargetFromPath("/w/ws1/clusters/eks/workloads/pods/api-0")).toEqual({
      kind: "k8s",
      title: "api-0",
    });
  });

  it("reads an agent tab out of /w/:wsId/agents/:sessionId", () => {
    // The title is a placeholder on purpose: only a tab opened from a bare URL
    // ever wears it, and the id it would otherwise carry is a uuid.
    expect(deriveTabTargetFromPath(AGENT_HREF)).toEqual({
      kind: "agent",
      title: "Agent",
      payload: { sessionId: "sess-1" },
    });
  });

  it("implies no tab for the workspace index or anything unmatched", () => {
    expect(deriveTabTargetFromPath("/w/ws1")).toBeNull();
    expect(deriveTabTargetFromPath("/w/ws1/")).toBeNull();
    expect(deriveTabTargetFromPath("/")).toBeNull();
    expect(deriveTabTargetFromPath("/w")).toBeNull();
    // No splat: the editor renders "No file selected".
    expect(deriveTabTargetFromPath("/w/ws1/files")).toBeNull();
    // No contextName: matches no route.
    expect(deriveTabTargetFromPath("/w/ws1/clusters")).toBeNull();
    // No session id: the session list is sidebar UI, not a route.
    expect(deriveTabTargetFromPath("/w/ws1/agents")).toBeNull();
    // The legacy pre-workspace form, handled by LegacyClusterRedirect.
    expect(deriveTabTargetFromPath("/clusters/eks/workloads/pods")).toBeNull();
    expect(deriveTabTargetFromPath("/w/ws1/somethingelse")).toBeNull();
  });
});

describe("syncTabToLocation", () => {
  beforeEach(() => {
    seed([], null);
  });

  it("leaves a file tab completely alone when the URL becomes a cluster route", () => {
    // The reported bug: the file tab was rewritten to the cluster href while
    // the `kind === "k8s"` title guard kept the filename — a tab labelled
    // main.tf pointing at a cluster page, still claiming kind "file".
    seed([{ ...fileTab }], fileTab.id);

    syncTabToLocation(WS, PODS_HREF, "");

    const survivor = tabs().find((t) => t.id === fileTab.id)!;
    expect(survivor.href).toBe(FILE_HREF);
    expect(survivor.title).toBe("main.tf");
    expect(survivor.kind).toBe("file");
    expect(survivor.payload).toEqual({ path: "infra/main.tf" });

    // ...and the cluster page got a tab of its own.
    expect(tabs()).toHaveLength(2);
    const opened = activeTab()!;
    expect(opened.id).not.toBe(fileTab.id);
    expect(opened.kind).toBe("k8s");
    expect(opened.title).toBe("Pods");
    expect(opened.href).toBe(PODS_HREF);
  });

  it("opens a file tab with its payload when a k8s tab is active", () => {
    // Reachable via browser Back from a cluster page to a file URL. Without
    // the payload, `modelKeyForTab` returns null and the tab's buffer is
    // orphaned — no dirty dot and nothing released on close.
    const k8sTab: Tab = { id: "k8s-1", kind: "k8s", title: "Pods", href: PODS_HREF };
    seed([k8sTab], k8sTab.id);

    syncTabToLocation(WS, FILE_HREF, "");

    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toEqual(k8sTab);
    expect(activeTab()).toMatchObject({
      kind: "file",
      title: "main.tf",
      href: FILE_HREF,
      payload: { path: "infra/main.tf" },
    });
  });

  it("still lets a k8s tab follow cluster-to-cluster navigation", () => {
    const k8sTab: Tab = { id: "k8s-1", kind: "k8s", title: "Pods", href: PODS_HREF };
    seed([k8sTab], k8sTab.id);

    syncTabToLocation(WS, "/w/ws1/clusters/eks/workloads/pods/api-0", "");

    // One tab, retitled and repointed — the preview-tab model, unchanged.
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].id).toBe("k8s-1");
    expect(tabs()[0].href).toBe("/w/ws1/clusters/eks/workloads/pods/api-0");
    expect(tabs()[0].title).toBe("api-0");
  });

  it("keeps a file tab's own title while following file-to-file navigation", () => {
    seed([{ ...fileTab }], fileTab.id);

    syncTabToLocation(WS, "/w/ws1/files/infra/vars.tf", "");

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].href).toBe("/w/ws1/files/infra/vars.tf");
    expect(tabs()[0].title).toBe("main.tf");
  });

  it("leaves an agent tab alone when the URL becomes a cluster route", () => {
    // Before `agents/:sessionId` was a recognised shape this was the reverse
    // bug: an agent URL implied no tab at all, so a cluster page landed on the
    // agent tab and repurposed it. Both directions have to hold.
    seed([{ ...agentTab }], agentTab.id);

    syncTabToLocation(WS, PODS_HREF, "");

    expect(tabs().find((t) => t.id === agentTab.id)).toEqual(agentTab);
    expect(tabs()).toHaveLength(2);
    expect(activeTab()).toMatchObject({ kind: "k8s", title: "Pods", href: PODS_HREF });
  });

  it("leaves an agent tab alone when the URL becomes a file route", () => {
    seed([{ ...agentTab }], agentTab.id);

    syncTabToLocation(WS, FILE_HREF, "");

    expect(tabs().find((t) => t.id === agentTab.id)).toEqual(agentTab);
    expect(activeTab()).toMatchObject({
      kind: "file",
      title: "main.tf",
      href: FILE_HREF,
      payload: { path: "infra/main.tf" },
    });
  });

  it("opens an agent tab when a file tab is active", () => {
    seed([{ ...fileTab }], fileTab.id);

    syncTabToLocation(WS, AGENT_HREF, "");

    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toEqual(fileTab);
    expect(activeTab()).toMatchObject({
      kind: "agent",
      title: "Agent",
      href: AGENT_HREF,
      payload: { sessionId: "sess-1" },
    });
  });

  it("keeps an agent tab's own title while following agent-to-agent navigation", () => {
    // Reached by browser Back, not by the sidebar — opening a session opens
    // its own tab. `AgentTerminal` reads the session id from the route, so the
    // tab's now-stale payload changes nothing about what is on screen.
    seed([{ ...agentTab }], agentTab.id);

    syncTabToLocation(WS, "/w/ws1/agents/sess-2", "");

    expect(tabs()).toHaveLength(1);
    expect(tabs()[0].href).toBe("/w/ws1/agents/sess-2");
    expect(tabs()[0].title).toBe("Claude Code");
    expect(tabs()[0].kind).toBe("agent");
  });

  it("is idempotent for an unchanged agent URL, so it cannot ping-pong", () => {
    seed([{ ...fileTab }], fileTab.id);

    syncTabToLocation(WS, AGENT_HREF, "");
    const afterFirst = useTabStore.getState().tabsByWorkspace;

    syncTabToLocation(WS, AGENT_HREF, "");
    syncTabToLocation(WS, AGENT_HREF, "");

    expect(tabs()).toHaveLength(2);
    // Same object identity: the second and third runs took the matching branch
    // and `updateActiveTab` returned state untouched.
    expect(useTabStore.getState().tabsByWorkspace).toBe(afterFirst);
  });

  it("carries the query string into the href it writes", () => {
    const k8sTab: Tab = { id: "k8s-1", kind: "k8s", title: "Pods", href: PODS_HREF };
    seed([k8sTab], k8sTab.id);

    syncTabToLocation(WS, PODS_HREF, "ns=kube-system");

    expect(tabs()[0].href).toBe(`${PODS_HREF}?ns=kube-system`);
  });

  it("does not duplicate a tab when navigating to a URL a tab already holds", () => {
    const k8sTab: Tab = { id: "k8s-1", kind: "k8s", title: "Pods", href: PODS_HREF };
    seed([{ ...fileTab }, k8sTab], fileTab.id);

    syncTabToLocation(WS, PODS_HREF, "");

    expect(tabs()).toHaveLength(2);
    expect(activeTab()!.id).toBe("k8s-1");
  });

  it("is idempotent for an unchanged URL, so it cannot ping-pong", () => {
    // The effect fires on every location render. After the cross-kind branch
    // activates the new tab, further runs must take the matching branch and
    // write nothing at all — otherwise openTab/updateActiveTab would loop.
    seed([{ ...fileTab }], fileTab.id);

    syncTabToLocation(WS, PODS_HREF, "");
    const afterFirst = useTabStore.getState().tabsByWorkspace;

    syncTabToLocation(WS, PODS_HREF, "");
    syncTabToLocation(WS, PODS_HREF, "");

    expect(tabs()).toHaveLength(2);
    // Same object identity: `updateActiveTab` returned state untouched, so no
    // subscriber was notified and no render was scheduled.
    expect(useTabStore.getState().tabsByWorkspace).toBe(afterFirst);
  });

  it("does nothing at all when the URL implies no tab", () => {
    seed([{ ...fileTab }], fileTab.id);
    const before = useTabStore.getState().tabsByWorkspace;

    syncTabToLocation(WS, "/w/ws1", "");

    expect(useTabStore.getState().tabsByWorkspace).toBe(before);
    expect(activeTab()!.href).toBe(FILE_HREF);
  });

  it("opens nothing when the workspace has no active tab", () => {
    // Plain navigation does not spawn tabs; only an explicit open does.
    seed([], null);
    syncTabToLocation(WS, PODS_HREF, "");
    expect(tabs()).toEqual([]);
  });
});
