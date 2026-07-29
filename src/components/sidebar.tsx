import { useEffect, useRef } from "react";
import { PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore, type ActivityView } from "@/lib/stores/ui-store";
import { useTabStore } from "@/lib/stores/tab-store";
import { clusterPath } from "@/lib/paths";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import type { Workspace } from "@/hooks/use-workspaces";
import { useAgentSessions, type AgentSession } from "@/hooks/use-agents";
import { newlyWaiting, waitingCount } from "@/lib/agent-activity";
import { activeClusterName } from "@/lib/workspace-clusters";
import { ActivityBar, availableViews } from "@/components/activity-bar";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { SidebarExplorer } from "@/components/sidebar-explorer";
import { SidebarSearch } from "@/components/sidebar-search";
import { SidebarCluster } from "@/components/sidebar-cluster";
import { SidebarAgents } from "@/components/sidebar-agents";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Whether `sessionId`'s tab is both the active tab for this workspace AND
 * the window actually has focus — the "open and focused" condition for
 * suppressing a needs-input notification. A backgrounded/minimized window
 * still has an "active" tab in the store, but the user isn't looking at it.
 */
function isSessionTabFocused(wsId: string, sessionId: string): boolean {
  if (typeof document !== "undefined" && !document.hasFocus()) return false;
  const state = useTabStore.getState();
  const activeId = state.activeTabIdByWorkspace[wsId];
  const activeTab = (state.tabsByWorkspace[wsId] || []).find((t) => t.id === activeId);
  return !!activeTab && activeTab.kind === "agent" && activeTab.payload?.sessionId === sessionId;
}

/**
 * VS Code-style side panel: an always-visible icon rail plus exactly one view.
 *
 * `contextName` is optional and is the ROUTE's cluster: a folder-only
 * workspace is a supported binding, and the sidebar is mounted by
 * WorkspaceLayout on routes that have no `:contextName` param at all, where
 * the workspace's first bound cluster stands in. Everything cluster-scoped
 * lives behind the Cluster rail icon, which simply is not there until the
 * workspace binds at least one cluster.
 *
 * Collapsing hides the PANEL, never the rail — the rail is how it reopens.
 */
export function Sidebar({ workspace, contextName, onNavigate, forceExpanded }: { workspace: Workspace; contextName?: string; onNavigate?: () => void; forceExpanded?: boolean }) {
  const { sidebarOpen: _sidebarOpen, setSidebarOpen, activityView, setActivityView } = useUIStore();
  const panelOpen = forceExpanded ?? _sidebarOpen;
  const wsId = useWorkspaceId();
  // Route first, first binding second — see activeClusterName.
  const effectiveContext = activeClusterName(workspace.clusters, contextName);
  const basePath = effectiveContext ? clusterPath(wsId, effectiveContext, "") : null;

  // Sidebar is mounted for the whole workspace (see file comment), so this is
  // the one place that can badge the rail and notify regardless of which
  // view is currently open — SidebarAgents only exists while its own panel
  // is showing. React Query dedupes this against SidebarAgents' own
  // useAgentSessions(wsId) call, so it isn't a second network subscription.
  const { data: agentSessions } = useAgentSessions(wsId);
  const { addToast } = useToast();
  const prevAgentSessionsRef = useRef<AgentSession[] | undefined>(undefined);
  const agentSessionsSeededRef = useRef(false);

  useEffect(() => {
    if (!agentSessions) return;
    if (!agentSessionsSeededRef.current) {
      // First poll after mount: seed only. A session that was already
      // waiting/high before this page opened isn't a NEW event — nothing to
      // notify about yet, and firing here would toast on every page load.
      agentSessionsSeededRef.current = true;
      prevAgentSessionsRef.current = agentSessions;
      return;
    }
    const transitioned = newlyWaiting(prevAgentSessionsRef.current, agentSessions);
    for (const session of transitioned) {
      if (isSessionTabFocused(wsId, session.id)) continue;
      addToast({
        title: `${session.title} needs input`,
        description: "This agent looks like it's waiting on you.",
        variant: "info",
      });
    }
    prevAgentSessionsRef.current = agentSessions;
  }, [agentSessions, wsId, addToast]);

  const views = availableViews({
    hasFolder: !!workspace.folderPath,
    // One binding is enough for the Cluster rail icon; which one is active is
    // the view's own business, and a broken one still deserves to be listed.
    hasCluster: workspace.clusters.length > 0 && !!basePath,
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
    /* A column, not a row: the workspace switcher spans the full width above
       BOTH the rail and the panel — VS Code's position for the folder name,
       and the only spot that stays visible when the panel is collapsed. The
       rail and panel keep their own h-11 headers below it, so the two columns
       stay aligned with each other in either state. */
    <div className="flex flex-col h-full shrink-0">
      <WorkspaceSwitcher
        workspace={workspace}
        panelOpen={panelOpen}
        onNavigate={onNavigate}
      />

      <div className="flex flex-1 min-h-0">
        <ActivityBar
          views={views}
          activeView={activeView}
          panelOpen={panelOpen}
          onSelect={handleSelect}
          badgeCounts={{ terminals: waitingCount(agentSessions) }}
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
                  workspace={workspace}
                  contextName={effectiveContext}
                  basePath={basePath}
                  onNavigate={onNavigate}
                />
              )}
              {activeView === "terminals" && (
                <SidebarAgents workspace={workspace} wsId={wsId} />
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
