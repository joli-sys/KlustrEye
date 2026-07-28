/**
 * Route path builders. All cluster hrefs go through here so that a future
 * prefix change is a one-file edit.
 *
 * Invariant: a workspace id may never be the literal string "clusters".
 * tab-bar.tsx:22 and resource-table.tsx:104 locate the cluster segment with
 * parts.indexOf("clusters"); a workspace id of "clusters" would match first
 * and silently resolve the wrong contextName.
 */
const RESERVED_WORKSPACE_ID = "clusters";

function assertWorkspaceId(wsId: string): void {
  if (wsId.toLowerCase() === RESERVED_WORKSPACE_ID) {
    throw new Error(`Invalid workspace id: "${wsId}" is reserved`);
  }
}

export function workspacePath(wsId: string, subPath = ""): string {
  assertWorkspaceId(wsId);
  const base = `/w/${encodeURIComponent(wsId)}`;
  const sub = subPath.replace(/^\//, "");
  return sub ? `${base}/${sub}` : base;
}

export function clusterPath(wsId: string, contextName: string, subPath = ""): string {
  assertWorkspaceId(wsId);
  const base = `/w/${encodeURIComponent(wsId)}/clusters/${encodeURIComponent(contextName)}`;
  const sub = subPath.replace(/^\//, "");
  return sub ? `${base}/${sub}` : base;
}

/** Prefix a legacy `/clusters/...` href with a workspace. Idempotent. */
export function rewriteClusterHref(wsId: string, href: string): string {
  assertWorkspaceId(wsId);
  if (!href.startsWith("/clusters/")) return href;
  return `/w/${encodeURIComponent(wsId)}${href}`;
}
