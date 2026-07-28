import { useEffect, useState } from "react";
import { Outlet, useParams, Navigate } from "react-router-dom";
import { useWorkspace } from "@/hooks/use-workspaces";
import { useFileWatch } from "@/hooks/use-file-watch";
import { useTabStore } from "@/lib/stores/tab-store";
import { hasDirtyModels, releaseAllClean } from "@/lib/editor/model-registry";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkspaceBindingBanner } from "@/components/workspace-binding-banner";
import { WorkspaceDialog } from "@/components/workspace-dialog";

export function WorkspaceLayout() {
  const { wsId } = useParams<{ wsId: string }>();
  const { data: workspace, isLoading, isError } = useWorkspace(wsId);
  const adoptLegacyTabs = useTabStore((s) => s.adoptLegacyTabs);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (workspace?.contextName && wsId) {
      adoptLegacyTabs(wsId, workspace.contextName);
    }
  }, [wsId, workspace?.contextName, adoptLegacyTabs]);

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
  const contextBroken = !!workspace.contextName && !workspace.contextExists;
  const bothBroken = folderBroken && contextBroken;
  const nothingBound = !workspace.folderPath && !workspace.contextName;

  // Repair screen: never a white screen, always a way forward.
  if (bothBroken || nothingBound) {
    return (
      <>
        <WorkspaceBindingBanner
          workspace={workspace}
          mode="repair"
          onRebind={() => setEditing(true)}
        />
        <WorkspaceDialog
          workspace={workspace}
          open={editing}
          onOpenChange={setEditing}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {(folderBroken || contextBroken) && (
        <WorkspaceBindingBanner
          workspace={workspace}
          mode="banner"
          onRebind={() => setEditing(true)}
        />
      )}
      <div className="flex-1 min-h-0">
        <Outlet />
      </div>
      <WorkspaceDialog workspace={workspace} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
