/**
 * The rules behind the workspace tab strip: which workspaces are OPEN, which
 * one succeeds a closed tab, and where switching to one should land.
 *
 * "Open" is deliberately a different set from "all workspaces": the strip
 * shows what you are working in, the picker at `/` shows what exists. Closing
 * a tab therefore only narrows the strip — it never touches the database.
 *
 * Kept free of React and of both stores so the fallback rules — the part that
 * decides whether persisted state is still trustworthy — are testable on their
 * own.
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

/**
 * Put `id` on the strip, leaving it where it is if already open.
 *
 * Re-adding must be a no-op rather than a move-to-end: navigating between two
 * open workspaces would otherwise shuffle the strip under the cursor on every
 * switch, and a tab that moves when you click it is unusable.
 */
export function addOpenWorkspace(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/**
 * Keep only ids that still resolve to a workspace, in order and deduped.
 *
 * A workspace deleted from the picker (or from another window) leaves its id
 * behind in storage. Rendering that as a tab would give a name-less tab that
 * navigates to a workspace route which immediately bounces to `/` — so it is
 * dropped silently instead.
 */
export function pruneOpenWorkspaces(ids: string[], known: Iterable<string>): string[] {
  const knownSet = known instanceof Set ? known : new Set(known);
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (!knownSet.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The strip as it should be for the workspace currently on screen.
 *
 * Add-then-prune in one step, because the two rules interact: the workspace
 * being viewed must survive pruning even when the workspace LIST has not
 * caught up with it — `useWorkspaces()` and the single-workspace query behind
 * the route are separate caches, and a strip that pruned away the tab you are
 * standing on would leave the current workspace unrepresented.
 *
 * `known === null` means the list has not loaded yet: add, but prune nothing.
 * Pruning against an empty set on the first render would wipe the strip.
 */
export function reconcileOpenWorkspaces(
  ids: string[],
  currentId: string,
  known: Iterable<string> | null
): string[] {
  const withCurrent = addOpenWorkspace(ids, currentId);
  if (!known) return withCurrent;
  const keep = new Set(known);
  keep.add(currentId);
  return pruneOpenWorkspaces(withCurrent, keep);
}

export interface CloseResult {
  openWorkspaceIds: string[];
  /**
   * The workspace to show once the close has happened, or `null` when the
   * strip is now empty and there is nowhere left to go but `/`.
   */
  nextActiveId: string | null;
}

/**
 * Close one tab of the strip and name its successor.
 *
 * Closing a tab that is NOT the one on screen must not navigate — the user is
 * tidying the strip, not leaving the page. Closing the active one picks the
 * adjacent tab by the same rule `tab-store`'s `closeTab` uses for file tabs
 * (the one that slid into the closed tab's slot, else the new last one), so
 * the two strips behave identically.
 *
 * Closing the LAST tab returns `null`: staying on a workspace route with an
 * empty strip is the same dead end that closing the last file tab used to
 * produce, and the caller sends the user to `/` instead.
 */
export function closeOpenWorkspace(
  ids: string[],
  closedId: string,
  activeId: string | null
): CloseResult {
  const idx = ids.indexOf(closedId);
  if (idx === -1) return { openWorkspaceIds: ids, nextActiveId: activeId };

  const openWorkspaceIds = ids.filter((id) => id !== closedId);
  if (closedId !== activeId) return { openWorkspaceIds, nextActiveId: activeId };

  const successor =
    openWorkspaceIds[Math.min(idx, openWorkspaceIds.length - 1)] ?? null;
  return { openWorkspaceIds, nextActiveId: successor };
}

/**
 * The persisted `openWorkspaceIds`, validated by SHAPE.
 *
 * zustand only runs `migrate` for a payload that already carries a numeric
 * `version` differing from the current one, and only rewrites storage when
 * migration actually ran — so anything written before a `version` existed
 * would be merged verbatim, forever. Both other stores here detect their old
 * shape directly for that reason, and this one validates rather than trusts:
 * a non-array, or an array with a non-string in it, becomes an empty strip
 * instead of rendering `undefined` as a tab.
 */
export function migrateOpenWorkspaces(persisted: unknown): { openWorkspaceIds: string[] } {
  if (!persisted || typeof persisted !== "object") return { openWorkspaceIds: [] };
  const raw = (persisted as Record<string, unknown>).openWorkspaceIds;
  if (!Array.isArray(raw)) return { openWorkspaceIds: [] };
  const ids = raw.filter((id): id is string => typeof id === "string" && id.length > 0);
  // Dedupe here too: duplicate ids would collide on the React key.
  return { openWorkspaceIds: [...new Set(ids)] };
}
