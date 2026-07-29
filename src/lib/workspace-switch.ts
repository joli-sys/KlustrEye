/**
 * Where switching TO a workspace should land.
 *
 * Tabs are kept per workspace (`tabsByWorkspace` / `activeTabIdByWorkspace` in
 * `stores/tab-store.ts`), so a workspace already remembers what the user was
 * looking at. Dropping them on the workspace home every time would throw that
 * away and make moving between two workspaces a re-navigation each way.
 *
 * Kept free of React and of the store so the fallback rules — the part that
 * decides whether a persisted href is still trustworthy — are testable on
 * their own.
 */
import { workspacePath } from "@/lib/paths";
import { orderedClusters } from "@/lib/workspace-clusters";
import type { Workspace } from "@/hooks/use-workspaces";

/** The only fields of a persisted tab this decision needs. */
export interface TabRef {
  id: string;
  href: string;
}

/**
 * True when `href` is inside `prefix` as a PATH, not merely string-prefixed.
 *
 * `/w/ws1` must not claim `/w/ws10/...`; only a segment boundary, a query, a
 * fragment, or the end of the string counts as being under it.
 */
function isUnder(href: string, prefix: string): boolean {
  if (!href.startsWith(prefix)) return false;
  const next = href.charAt(prefix.length);
  return next === "" || next === "/" || next === "?" || next === "#";
}

/**
 * The href to navigate to when switching to `targetId`.
 *
 * Restores that workspace's active tab when it still resolves, and falls back
 * to the workspace home otherwise. Both guards are for real persisted state,
 * not defensive noise: `activeTabIdByWorkspace` can outlive the tab it names
 * (a close raced with a reload, or storage edited by an older build), and an
 * href written by an older build can point at a route this one no longer has —
 * or, after a botched migration, at another workspace entirely. Navigating to
 * either would strand the user outside the workspace they just picked.
 *
 * Throws for a reserved workspace id, the same way `workspacePath` does; the
 * caller turns that into a toast rather than a silent no-op navigation.
 */
export function workspaceSwitchHref(
  targetId: string,
  tabs: TabRef[] | undefined | null,
  activeTabId: string | null | undefined
): string {
  const home = workspacePath(targetId);
  if (!activeTabId) return home;

  const active = (tabs ?? []).find((t) => t.id === activeTabId);
  if (!active?.href) return home;

  return isUnder(active.href, home) ? active.href : home;
}

/** The folder's own name, which is what tells two workspaces apart at a glance. */
function folderBasename(folderPath: string | null): string | null {
  if (!folderPath) return null;
  // Both separators: a Windows path reaches this from the same API as a POSIX one.
  const parts = folderPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

/** Just the binding-shaped fields, so callers can pass partial fixtures. */
type BindingSummary = Pick<Workspace, "folderPath" | "clusters">;

/**
 * A one-line summary of what a workspace binds, for a switcher row.
 *
 * Names are user-chosen and frequently near-identical ("prod", "prod-2"), so
 * the row needs something derived from the bindings to be tellable apart. A
 * single cluster is named outright; past that the count is the useful fact,
 * since the list would not fit on one line anyway.
 */
export function bindingHint(workspace: BindingSummary): string {
  const bits: string[] = [];
  const folder = folderBasename(workspace.folderPath);
  if (folder) bits.push(folder);
  const clusters = orderedClusters(workspace.clusters);
  if (clusters.length === 1) bits.push(clusters[0].contextName);
  else if (clusters.length > 1) bits.push(`${clusters.length} clusters`);
  return bits.length > 0 ? bits.join(" · ") : "No bindings";
}
