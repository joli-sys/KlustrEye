import { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useResolveClusterWorkspace } from "@/hooks/use-workspaces";
import { useTabStore } from "@/lib/stores/tab-store";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Redirects legacy `/clusters/:contextName/*` URLs to `/w/:wsId/clusters/...`,
 * resolving or lazily creating the workspace for that cluster.
 * Preserves the sub-path and query string.
 */
export function LegacyClusterRedirect() {
  const params = useParams<{ contextName: string; "*": string }>();
  const { contextName } = params;
  // The route's splat, not a String.replace on the pathname: a bookmark whose
  // context segment is encoded differently (lowercase hex, %2D for -) would
  // fail to match and leave `rest` equal to the whole pathname.
  const splat = params["*"];
  const location = useLocation();
  const navigate = useNavigate();
  const resolve = useResolveClusterWorkspace();
  const adoptLegacyTabs = useTabStore((s) => s.adoptLegacyTabs);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!contextName) return;
    let cancelled = false;

    resolve
      .mutateAsync({ contextName })
      .then((ws) => {
        if (cancelled) return;
        adoptLegacyTabs(ws.id, contextName);
        const rest = splat ? `/${splat}` : "";
        navigate(
          `/w/${encodeURIComponent(ws.id)}/clusters/${encodeURIComponent(contextName)}${rest}${location.search}`,
          { replace: true }
        );
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
    // Intentionally keyed only on the context + path: re-running on mutation
    // identity change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextName, location.pathname, location.search]);

  if (failed) return <Navigate to="/" replace />;
  return <Skeleton className="h-32 w-full m-4" />;
}
