import { useEffect, useState } from "react";
import { Outlet, useParams, useMatch, Navigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/use-workspaces";
import {
  activeClusterName,
  allClustersMissing,
  missingClusters,
  orderedClusters,
  workspaceHasNoBindings,
} from "@/lib/workspace-clusters";
import { useFileWatch } from "@/hooks/use-file-watch";
import { useTabStore } from "@/lib/stores/tab-store";
import { hasDirtyModels, releaseAllClean } from "@/lib/editor/model-registry";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceBindingBanner } from "@/components/workspace-binding-banner";
import { WorkspaceDialog } from "@/components/workspace-dialog";
import { Sidebar } from "@/components/sidebar";
import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer";
import { TabBar } from "@/components/tab-bar";
import { WorkspaceTabs } from "@/components/workspace-tabs";
import { ClusterColorProvider } from "@/components/cluster-color-provider";

export function WorkspaceLayout() {
  const { wsId } = useParams<{ wsId: string }>();
  const { data: workspace, isLoading, isError } = useWorkspace(wsId);
  const adoptLegacyTabs = useTabStore((s) => s.adoptLegacyTabs);
  const [editing, setEditing] = useState(false);

  /**
   * `:contextName` belongs to the CHILD route, and `useParams` in a parent
   * only sees params matched down to itself — hence the explicit match. This
   * is the one authority on which cluster is on screen; the workspace's
   * binding list only supplies a default for routes outside a cluster.
   */
  const clusterMatch = useMatch("/w/:wsId/clusters/:contextName/*");
  const routeContext = clusterMatch?.params.contextName;

  // Re-running on a refetch is harmless: a second pass finds the legacy
  // bucket already drained and leaves the store untouched. v0 parked tabs per
  // CLUSTER, so every binding is a candidate.
  const bound = orderedClusters(workspace?.clusters);
  useEffect(() => {
    if (!wsId) return;
    for (const cluster of bound) adoptLegacyTabs(wsId, cluster.contextName);
    // `bound` is rebuilt each render; `workspace` is the value that changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsId, workspace, adoptLegacyTabs]);

  // One socket per workspace, and only where there is a folder to watch — a
  // broken binding would just reconnect against a folder that is not there.
  useFileWatch(wsId, !!workspace?.folderPath && workspace.folderExists);

  /**
   * Reloading or quitting throws away every buffer that was never written to
   * disk, and the browser gives no second chance once it has happened. The
   * prompt only fires when something is actually dirty, so the common case is
   * unaffected.
   *
   * Registered here rather than in the editor: buffers outlive the editor
   * component, so a dirty file whose tab is not currently open still counts.
   */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasDirtyModels()) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  /**
   * Leaving a workspace is where its buffers stop being on screen, so it is
   * the bulk counterpart to closing a tab. Without it, every workspace opened
   * in a session stacks its models on top of the last one's for the life of
   * the process.
   *
   * `releaseAllClean` rather than `disposeAll`: leaving is REVERSIBLE — the
   * registry is keyed by workspace id, so returning to the same workspace
   * reattaches the same buffers — and wiping dirty ones would destroy edits
   * the user can still get back. Same rule the tab close path follows.
   *
   * Keyed on `wsId` so switching between workspaces frees the outgoing one.
   */
  useEffect(
    () => () => {
      releaseAllClean();
    },
    [wsId]
  );

  if (isLoading) return <Skeleton className="h-32 w-full m-4" />;
  // Unknown workspace: back to home rather than a half-built layout.
  if (isError || !workspace) return <Navigate to="/" replace />;

  const folderBroken = !!workspace.folderPath && !workspace.folderExists;
  // A workspace with two clusters, one of them gone, still has a working
  // cluster surface — only losing EVERY binding earns the repair screen.
  const someClustersMissing = missingClusters(workspace.clusters).length > 0;
  const bothBroken = folderBroken && allClustersMissing(workspace.clusters);
  const nothingBound = workspaceHasNoBindings(workspace);

  // Repair screen: never a white screen, always a way forward. The workspace
  // strip stays above it — a workspace whose bindings all broke is exactly
  // when the user needs a one-click route to one that still works, and
  // without it the repair screen is a dead end with a single button.
  if (bothBroken || nothingBound) {
    return (
      <div className="flex flex-col h-full min-h-0">
        <WorkspaceTabs currentWorkspaceId={workspace.id} />
        {/* `flex-1 min-h-0` and nothing else: repair mode centres itself with
            `h-full`, which needs a parent of definite height and no scroll
            container in between — same as when it was the top-level element. */}
        <div className="flex-1 min-h-0">
          <WorkspaceBindingBanner
            workspace={workspace}
            mode="repair"
            onRebind={() => setEditing(true)}
          />
        </div>
        <WorkspaceDialog
          workspace={workspace}
          open={editing}
          onOpenChange={setEditing}
        />
      </div>
    );
  }

  /**
   * The cluster the chrome is scoped to: whichever one the URL is on, and the
   * first binding elsewhere so a workspace opened on its home page still has a
   * populated Cluster view. `undefined` only when nothing is bound.
   */
  const activeContext = activeClusterName(workspace.clusters, routeContext);

  /**
   * Sidebar and tab bar are WORKSPACE chrome, so they live here rather than in
   * ClusterLayout. Mounted a level down they were unreachable from the two
   * sibling routes — a folder-only workspace got no file tree at all, and
   * opening a file (`files/*`) dropped both the tree and the tabs.
   *
   * No padding on <main>: the file editor wants the whole area for Monaco.
   * Cluster pages keep their own `p-4` scroll container inside ClusterLayout.
   */
  return (
    <ClusterColorProvider contextName={activeContext ?? ""}>
      <div className="flex flex-col h-full min-h-0">
        {/* Above the binding banner and the per-workspace TabBar, spanning the
            whole width: the strip belongs to the app, not to this workspace,
            and the banner underneath it belongs to the tab it sits below. */}
        <WorkspaceTabs currentWorkspaceId={workspace.id} />
        {(folderBroken || someClustersMissing) && (
          <WorkspaceBindingBanner
            workspace={workspace}
            mode="banner"
            onRebind={() => setEditing(true)}
          />
        )}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="hidden md:flex">
            <Sidebar workspace={workspace} contextName={activeContext} />
          </div>
          <MobileSidebarDrawer workspace={workspace} contextName={activeContext} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TabBar wsId={wsId ?? ""} />
            <main className="flex-1 min-h-0 overflow-hidden">
              <Outlet />
            </main>
          </div>
        </div>
        <WorkspaceDialog workspace={workspace} open={editing} onOpenChange={setEditing} />
      </div>
    </ClusterColorProvider>
  );
}
