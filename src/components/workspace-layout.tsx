import { useEffect } from "react";
import { Outlet, useParams, Navigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/use-workspaces";
import { useTabStore } from "@/lib/stores/tab-store";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceBindingBanner } from "@/components/workspace-binding-banner";

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

  const folderBroken = !!workspace.folderPath && !workspace.folderExists;
  const contextBroken = !!workspace.contextName && !workspace.contextExists;
  const bothBroken = folderBroken && contextBroken;
  const nothingBound = !workspace.folderPath && !workspace.contextName;

  // Repair screen: never a white screen, always a way forward.
  if (bothBroken || nothingBound) {
    return <WorkspaceBindingBanner workspace={workspace} mode="repair" />;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {(folderBroken || contextBroken) && (
        <WorkspaceBindingBanner workspace={workspace} mode="banner" />
      )}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  );
}
