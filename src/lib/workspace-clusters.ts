/**
 * Pure helpers over a workspace's cluster bindings.
 *
 * A workspace binds ZERO OR MORE clusters, so every question the UI used to
 * answer with `workspace.contextName` (is there a cluster? which one? is it
 * broken?) is now a fold over `workspace.clusters`. Kept here, free of React
 * and of `fetch`, so the rules are testable on their own.
 */
import type { Workspace, WorkspaceCluster } from "@/hooks/use-workspaces";

/** Just the binding-shaped fields, so callers can pass partial fixtures. */
type Bindings = WorkspaceCluster[] | undefined | null;

/**
 * Bindings in binding order.
 *
 * The server already returns them sorted, but the sort is what makes "the
 * first cluster" a stable, meaningful choice, so it is re-asserted here rather
 * than trusted — a response assembled from a `Map` elsewhere would otherwise
 * silently change which cluster a workspace opens on.
 */
export function orderedClusters(clusters: Bindings): WorkspaceCluster[] {
  return [...(clusters ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.contextName.localeCompare(b.contextName)
  );
}

/**
 * Which cluster the workspace chrome is scoped to.
 *
 * The ROUTE wins whenever there is one: `/w/:wsId/clusters/:contextName` is
 * where the user actually is, and a bound-cluster default that disagreed with
 * the URL would paint the wrong cluster's nav as active. Outside a cluster
 * route there is no route context, and the first binding stands in so the
 * Cluster view has something to show. `undefined` only when nothing is bound.
 */
export function activeClusterName(
  clusters: Bindings,
  routeContextName?: string
): string | undefined {
  if (routeContextName) return routeContextName;
  return orderedClusters(clusters)[0]?.contextName;
}

/** Bound clusters that are not in the current kubeconfig. */
export function missingClusters(clusters: Bindings): WorkspaceCluster[] {
  return orderedClusters(clusters).filter((c) => !c.exists);
}

/** The first binding that is actually usable, for "open this workspace" links. */
export function firstUsableCluster(clusters: Bindings): WorkspaceCluster | undefined {
  return orderedClusters(clusters).find((c) => c.exists);
}

/**
 * The workspace binds clusters but NOT ONE of them is in the kubeconfig.
 *
 * This — not "any binding is missing" — is the cluster half of the repair
 * screen: with two clusters bound and one still resolvable the workspace is
 * perfectly usable, and a full-screen repair state would be a dead end over a
 * surface that works.
 */
export function allClustersMissing(clusters: Bindings): boolean {
  const bound = orderedClusters(clusters);
  return bound.length > 0 && bound.every((c) => !c.exists);
}

type BindingSummary = Pick<Workspace, "folderPath" | "folderExists"> & {
  clusters: WorkspaceCluster[];
};

/** Any binding — folder or cluster — that no longer resolves. */
export function workspaceNeedsAttention(ws: BindingSummary): boolean {
  const folderBroken = !!ws.folderPath && !ws.folderExists;
  return folderBroken || missingClusters(ws.clusters).length > 0;
}

/** Neither a folder nor a single cluster: there is nothing to show at all. */
export function workspaceHasNoBindings(ws: BindingSummary): boolean {
  return !ws.folderPath && orderedClusters(ws.clusters).length === 0;
}
