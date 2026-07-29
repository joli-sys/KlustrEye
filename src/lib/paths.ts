/**
 * Route path builders. All cluster hrefs go through here so that a future
 * prefix change is a one-file edit.
 *
 * Invariant: a workspace id may never be the literal string "clusters".
 * `deriveTitleFromPath` in tab-route.ts locates the cluster segment with
 * parts.indexOf("clusters"); a workspace id of "clusters" would match first
 * and silently resolve the wrong contextName.
 */
const RESERVED_WORKSPACE_ID = "clusters";

function assertWorkspaceId(wsId: string): void {
  if (wsId.toLowerCase() === RESERVED_WORKSPACE_ID) {
    throw new Error(`Invalid workspace id: "${wsId}" is reserved`);
  }
}

/**
 * Percent-encode each segment, leaving the `/` separators alone.
 *
 * A raw file name goes into this path, and `#` or `?` in one would otherwise
 * start a fragment or query: `notes#1.md` became `/w/x/files/notes#1.md`, the
 * router saw only `files/notes`, and the editor 404'd on a perfectly ordinary
 * filename. react-router decodes per segment on the way back in (`decodePath`
 * splits on `/` and `decodeURIComponent`s each part), so this round-trips.
 */
function encodeSegments(subPath: string): string {
  return subPath.split("/").map(encodeURIComponent).join("/");
}

export function workspacePath(wsId: string, subPath = ""): string {
  assertWorkspaceId(wsId);
  const base = `/w/${encodeURIComponent(wsId)}`;
  const sub = subPath.replace(/^\//, "");
  return sub ? `${base}/${encodeSegments(sub)}` : base;
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
