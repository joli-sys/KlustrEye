import { useParams, Outlet } from "react-router-dom";
import { Header } from "@/components/header";
import { ClusterShellTerminal } from "@/components/cluster-shell-terminal";
import { AiChatPanel } from "@/components/ai-chat-panel";
import { CommandPalette } from "@/components/command-palette";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { useWorkspaceNamespace } from "@/hooks/use-cluster-namespace";
import { useClusterInfo } from "@/hooks/use-clusters";

/**
 * Only genuinely cluster-scoped chrome lives here. The sidebar, the tab bar and
 * the per-cluster color variables are workspace chrome and are mounted by
 * WorkspaceLayout, which also wraps the `files/*` and index routes.
 */
export default function ClusterLayout() {
  const { contextName = "" } = useParams();
  const decodedContext = decodeURIComponent(contextName);
  const wsId = useWorkspaceId();
  const namespace = useWorkspaceNamespace(wsId);
  const { data: clusterInfo } = useClusterInfo(decodedContext);

  const aiContext = {
    cluster: decodedContext,
    cluster_display_name: (clusterInfo as { displayName?: string | null } | undefined)?.displayName || undefined,
    namespace: namespace || undefined,
  };

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex flex-col flex-1 overflow-hidden">
        <Header contextName={decodedContext} />
        {/* Padding lives here rather than on WorkspaceLayout's <main> so the
            file editor gets the full area. */}
        <div className="flex-1 overflow-auto p-4">
          <Outlet />
        </div>
        <ClusterShellTerminal contextName={decodedContext} />
      </div>
      <AiChatPanel context={aiContext} />
      {/* Must live inside the route tree: command-palette.tsx reads wsId and
          contextName from useParams(), which returns {} outside <Routes>. */}
      <CommandPalette />
    </div>
  );
}
