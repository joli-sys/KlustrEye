import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore, type ActivityView } from "@/lib/stores/ui-store";
import { clusterPath } from "@/lib/paths";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import type { Workspace } from "@/hooks/use-workspaces";
import { ActivityBar, availableViews } from "@/components/activity-bar";
import { SidebarExplorer } from "@/components/sidebar-explorer";
import { SidebarSearch } from "@/components/sidebar-search";
import { SidebarCluster } from "@/components/sidebar-cluster";
import { SidebarTerminals } from "@/components/sidebar-terminals";
import { Button } from "@/components/ui/button";

/**
 * VS Code-style side panel: an always-visible icon rail plus exactly one view.
 *
 * `contextName` is optional: a folder-only workspace is a supported binding,
 * and the sidebar is mounted by WorkspaceLayout on routes that have no
 * `:contextName` param at all. Everything cluster-scoped lives behind the
 * Cluster rail icon, which simply is not there without a cluster.
 *
 * Collapsing hides the PANEL, never the rail — the rail is how it reopens.
 */
export function Sidebar({ workspace, contextName, onNavigate, forceExpanded }: { workspace: Workspace; contextName?: string; onNavigate?: () => void; forceExpanded?: boolean }) {
  const { sidebarOpen: _sidebarOpen, setSidebarOpen, activityView, setActivityView } = useUIStore();
  const panelOpen = forceExpanded ?? _sidebarOpen;
  const wsId = useWorkspaceId();
  const effectiveContext = contextName ?? workspace.contextName ?? undefined;
  const basePath = effectiveContext ? clusterPath(wsId, effectiveContext, "") : null;

  const views = availableViews({
    hasFolder: !!workspace.folderPath,
    // Cluster nav needs a bound context, same gate the old sidebar used.
    hasCluster: !!workspace.contextName && !!basePath,
  });

  /**
   * Derived, not written back to the store: if the folder binding goes away
   * the persisted "explorer" preference is simply ignored for now, and comes
   * back on its own once the folder is rebound. Writing a fallback into the
   * store would silently destroy the user's choice.
   */
  const activeView: ActivityView =
    views.some((v) => v.id === activityView) ? activityView : views[0].id;

  const activeLabel = views.find((v) => v.id === activeView)?.label ?? "";

  const handleSelect = (view: ActivityView) => {
    if (view === activeView && panelOpen) {
      // Clicking the view you are already looking at collapses the panel —
      // except in the mobile drawer, where a collapsed panel leaves nothing
      // but a rail floating over the backdrop.
      if (!forceExpanded) setSidebarOpen(false);
      return;
    }
    setActivityView(view);
    setSidebarOpen(true);
  };

  return (
    <div className="flex h-full shrink-0">
      <ActivityBar
        views={views}
        activeView={activeView}
        panelOpen={panelOpen}
        onSelect={handleSelect}
      />

      {panelOpen && (
        <aside className="flex flex-col h-full w-56 shrink-0 border-r bg-card">
          <div className="flex items-center justify-between gap-2 h-11 shrink-0 border-b pl-3 pr-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider truncate">
              {activeLabel}
            </span>
            {!forceExpanded && (
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-7 w-7"
                onClick={() => setSidebarOpen(false)}
                title="Collapse panel"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
          </div>

          <div
            className={cn(
              "flex-1 min-h-0",
              // The cluster view manages its own scrolling so its settings
              // footer can stay pinned; the rest just scroll as one column.
              activeView === "cluster" ? "overflow-hidden" : "overflow-y-auto py-2"
            )}
          >
            {activeView === "explorer" && <SidebarExplorer workspace={workspace} />}
            {activeView === "search" && (
              <SidebarSearch workspace={workspace} wsId={wsId} />
            )}
            {activeView === "cluster" && basePath && effectiveContext && (
              <SidebarCluster
                contextName={effectiveContext}
                basePath={basePath}
                onNavigate={onNavigate}
              />
            )}
            {activeView === "terminals" && <SidebarTerminals />}
          </div>
        </aside>
      )}
    </div>
  );
}
