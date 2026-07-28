import { useEffect } from "react";
import { Outlet, useParams, Navigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/use-workspaces";
import { useTabStore } from "@/lib/stores/tab-store";
import { Skeleton } from "@/components/ui/skeleton";

export function WorkspaceLayout() {
  const { wsId } = useParams<{ wsId: string }>();
  const { data: workspace, isLoading, isError } = useWorkspace(wsId);
  const adoptLegacyTabs = useTabStore((s) => s.adoptLegacyTabs);

  useEffect(() => {
    if (workspace?.contextName && wsId) {
      adoptLegacyTabs(wsId, workspace.contextName);
    }
  }, [wsId, workspace?.contextName, adoptLegacyTabs]);

  if (isLoading) return <Skeleton className="h-32 w-full m-4" />;
  // Unknown workspace: back to home rather than a half-built layout.
  if (isError || !workspace) return <Navigate to="/" replace />;

  return <Outlet />;
}
