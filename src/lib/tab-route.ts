/**
 * The bridge between a URL and the tab model: what tab a route implies, and
 * how the tab list reacts when the router lands somewhere new.
 *
 * Lives outside `tab-bar` so it can be exercised without a DOM, and outside
 * `tab-store` so the store keeps no dependency on the sidebar's labels.
 */
import { SIDEBAR_SECTIONS } from "@/lib/constants";
import { useTabStore, type TabKind } from "@/lib/stores/tab-store";

/** Build a lookup from href suffix → label from sidebar sections */
const hrefToLabel: Record<string, string> = {};
for (const section of SIDEBAR_SECTIONS) {
  for (const item of section.items) {
    hrefToLabel[item.href] = item.label;
  }
}

export function deriveTitleFromPath(pathname: string): string {
  // pathname like /clusters/<ctx>/workloads/pods/my-pod
  const parts = pathname.split("/");
  // Find index of "clusters" and skip context
  const clustersIdx = parts.indexOf("clusters");
  if (clustersIdx === -1) return parts[parts.length - 1] || "Page";
  const subParts = parts.slice(clustersIdx + 2); // after contextName
  const subPath = subParts.join("/");

  // Check exact sidebar match
  if (hrefToLabel[subPath]) return hrefToLabel[subPath];

  // Check if the parent path matches a sidebar entry (detail page)
  const parentPath = subParts.slice(0, -1).join("/");
  if (hrefToLabel[parentPath]) {
    // It's a detail page — use the resource name (last segment)
    return decodeURIComponent(subParts[subParts.length - 1]);
  }

  // Fallback: prettify last segment
  const last = subParts[subParts.length - 1] || "Page";
  return decodeURIComponent(last)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `decodeURIComponent` throws on a lone `%`; a raw segment beats a crash. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The tab a URL implies. */
export interface TabTarget {
  kind: TabKind;
  title: string;
  payload?: Record<string, string>;
}

/**
 * What tab, if any, this URL is asking for.
 *
 * `null` means "no tab": the workspace index `/w/:wsId` renders WorkspaceHome
 * and anything else is either unrouted or outside a workspace. The routes are
 * declared in `src/App.tsx`; this is the one place that reads a kind back out
 * of a path, so a new tab-bearing route section is a single edit here.
 */
export function deriveTabTargetFromPath(pathname: string): TabTarget | null {
  const parts = pathname.split("/").filter(Boolean);
  // Below three segments is `/`, `/w`, or the workspace index `/w/:wsId`.
  if (parts[0] !== "w" || parts.length < 3) return null;
  const section = parts[2];

  if (section === "files") {
    // `files/*` with an empty splat renders the "No file selected"
    // placeholder — there is no file for a tab to stand for.
    const segments = parts.slice(3).map(safeDecode);
    if (segments.length === 0) return null;
    return {
      kind: "file",
      title: segments[segments.length - 1],
      // The workspace-relative path, decoded exactly the way react-router
      // hands the splat to `FileEditor`. `modelKeyForTab` builds the Monaco
      // registry key from this, and the editor builds it from the splat —
      // two spellings would give the same file two buffers.
      payload: { path: segments.join("/") },
    };
  }

  if (section === "clusters") {
    // `/w/:wsId/clusters` with no contextName matches no route.
    if (parts.length < 4) return null;
    return { kind: "k8s", title: deriveTitleFromPath(pathname) };
  }

  if (section === "agents") {
    // `/w/:wsId/agents` with no session id matches no route — the list of
    // sessions lives in the sidebar, not at a URL of its own.
    if (parts.length < 4) return null;
    return {
      kind: "agent",
      // A session id is a uuid, not a label. The real title is chosen when the
      // session is opened and preserved by `syncTabToLocation` below; this
      // only names a tab opened straight from a URL, where the path offers
      // nothing better.
      title: "Agent",
      payload: { sessionId: safeDecode(parts[3]) },
    };
  }

  return null;
}

/**
 * Reconcile the tab list with the URL the router just landed on.
 *
 * Two cases, and the split between them is the whole point:
 *
 * - The active tab is ALREADY the kind this URL implies, so it follows the
 *   URL. That is the preview-tab model: one cluster tab walks from the pod
 *   list to a pod detail without spawning a tab per page. It is also the href
 *   self-heal the v0→v1 tab migration depends on.
 *
 * - The kinds DIFFER, so the URL gets its own tab and the active one is left
 *   untouched. Rewriting it in place would leave it carrying the `kind` and
 *   `payload` of the tab it used to be: `modelKeyForTab` would keep handing
 *   out a Monaco key for a tab that is no longer a file, so closing it would
 *   release an unrelated buffer and its dirty dot would report an unrelated
 *   file's edits. The stale title users see is only the visible half; a
 *   `kind` that lies about its tab is the bug.
 *
 * Idempotent for an unchanged URL — see the comment on the openTab call.
 */
export function syncTabToLocation(
  wsId: string,
  pathname: string,
  search: string
): void {
  const target = deriveTabTargetFromPath(pathname);
  if (!target) return;

  const fullHref = search ? `${pathname}?${search}` : pathname;
  const store = useTabStore.getState();
  const activeId = store.activeTabIdByWorkspace[wsId];
  const active = (store.tabsByWorkspace[wsId] || []).find((t) => t.id === activeId);

  // Nothing active means nothing to follow the URL and nothing to protect.
  // Opening a tab here would make plain navigation spawn one, which is
  // deliberately not the model — sidebar links navigate, cmd-click opens.
  if (!active) return;

  if (active.kind === target.kind) {
    // Only a k8s tab takes its name from the path. A file tab keeps its
    // filename and an agent tab its session title — neither survives a round
    // trip through the URL, which carries a splat and a uuid respectively.
    const title = target.kind === "k8s" ? target.title : active.title;
    store.updateActiveTab(wsId, fullHref, title);
    return;
  }

  // This cannot ping-pong with the branch above. `openTab` dedups by href and
  // ACTIVATES the tab it opens or finds, so on any later run for this same URL
  // the active tab's kind equals the URL's kind and the matching branch runs
  // instead — where `updateActiveTab` returns the state object untouched once
  // href and title already agree, writing nothing and rendering nothing.
  store.openTab(wsId, fullHref, target.title, target.kind, target.payload);
}
