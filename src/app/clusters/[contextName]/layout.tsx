import { useParams, Outlet } from "react-router-dom";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TabBar } from "@/components/tab-bar";
import { ClusterColorProvider } from "@/components/cluster-color-provider";
import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer";
import { ClusterShellTerminal } from "@/components/cluster-shell-terminal";
import { AiChatPanel } from "@/components/ai-chat-panel";
import { CommandPalette } from "@/components/command-palette";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { useWorkspaceNamespace } from "@/hooks/use-cluster-namespace";
import { useClusterInfo } from "@/hooks/use-clusters";
import { useWorkspace } from "@/hooks/use-workspaces";

export default function ClusterLayout() {
  const { contextName = "" } = useParams();
  const decodedContext = decodeURIComponent(contextName);
  const wsId = useWorkspaceId();
  const namespace = useWorkspaceNamespace(wsId);
  const { data: clusterInfo } = useClusterInfo(decodedContext);
  // WorkspaceLayout (parent route) already fetched and gated on this; the
  // query is cache-hot here, so this never re-triggers a loading state.
  const { data: workspace } = useWorkspace(wsId);

  const aiContext = {
    cluster: decodedContext,
    cluster_display_name: (clusterInfo as { displayName?: string | null } | undefined)?.displayName || undefined,
    namespace: namespace || undefined,
  };

  // Should always be cache-hot from WorkspaceLayout; bail rather than pass
  // Sidebar an undefined workspace.
  if (!workspace) return null;

  return (
    <ClusterColorProvider contextName={decodedContext}>
      <div className="flex h-full overflow-hidden">
        <div className="hidden md:flex">
          <Sidebar workspace={workspace} contextName={decodedContext} />
        </div>
        <MobileSidebarDrawer workspace={workspace} contextName={decodedContext} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header contextName={decodedContext} />
          <TabBar wsId={wsId} />
          <main className="flex-1 overflow-auto p-4">
            <Outlet />
          </main>
          <ClusterShellTerminal contextName={decodedContext} />
        </div>
        <AiChatPanel context={aiContext} />
        {/* Must live inside the route tree: command-palette.tsx reads wsId and
            contextName from useParams(), which returns {} outside <Routes>. */}
        <CommandPalette />
      </div>
    </ClusterColorProvider>
  );
}
