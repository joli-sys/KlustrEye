import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, X, AlertCircle } from "lucide-react";
import { useWorkspaces, type Workspace } from "@/hooks/use-workspaces";
import { useWorkspaceTabsStore } from "@/lib/stores/workspace-tabs-store";
import { useTabStore } from "@/lib/stores/tab-store";
import { bindingHint, workspaceSwitchHref } from "@/lib/workspace-tabs";
import { workspaceNeedsAttention } from "@/lib/workspace-clusters";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/**
 * The top strip: one tab per OPEN workspace, above the per-workspace TabBar.
 *
 * Until this existed the only way out of a workspace was the "All workspaces"
 * link on the workspace index route — from a file editor or a cluster page
 * there was no visible route to another workspace at all.
 *
 * Two things it is NOT:
 *
 * - It is not the workspace LIST. Open is a smaller set than exists; `+` goes
 *   to `/`, where the picker owns creating, editing and deleting.
 * - Its `×` is not a delete. It removes the tab from the strip and nothing
 *   else; deleting a workspace lives in the picker behind a confirm dialog.
 *   The tooltip says so, because an `×` next to a name reads as destructive.
 */
export function WorkspaceTabs({ currentWorkspaceId }: { currentWorkspaceId: string }) {
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { addToast } = useToast();
  const { data: workspaces } = useWorkspaces();

  const openIds = useWorkspaceTabsStore((s) => s.openWorkspaceIds);
  const reconcile = useWorkspaceTabsStore((s) => s.reconcile);
  const closeWorkspaceTab = useWorkspaceTabsStore((s) => s.closeWorkspaceTab);

  /**
   * Opening a workspace puts it on the strip; a workspace the server no longer
   * has comes off it. `undefined` while the list loads means "add, prune
   * nothing" — see `reconcileOpenWorkspaces`.
   */
  useEffect(() => {
    reconcile(currentWorkspaceId, workspaces ? workspaces.map((w) => w.id) : null);
  }, [currentWorkspaceId, workspaces, reconcile]);

  /**
   * Strip order, joined with what the server knows about each one.
   *
   * An id with no workspace behind it renders nothing rather than a nameless
   * tab: during the first load `workspaces` is undefined, and after a delete
   * elsewhere the reconcile above has not run yet.
   */
  const tabs = useMemo<Workspace[]>(() => {
    const byId = new Map((workspaces ?? []).map((w) => [w.id, w]));
    return openIds
      .map((id) => byId.get(id))
      .filter((w): w is Workspace => w !== undefined);
  }, [openIds, workspaces]);

  useEffect(() => {
    const el = scrollRef.current?.querySelector(`[data-workspace-id="${currentWorkspaceId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [currentWorkspaceId, tabs.length]);

  /**
   * Go to a workspace, landing where it was left rather than on its home.
   *
   * The tab store is read imperatively: the destination depends on the TARGET
   * workspace's tabs, so subscribing would re-render this strip on every tab
   * change in every workspace to compute an href only a click needs.
   *
   * `workspaceSwitchHref` throws on a reserved workspace id, which becomes a
   * toast rather than a navigation to a path that cannot be built.
   */
  function goToWorkspace(id: string) {
    try {
      const state = useTabStore.getState();
      navigate(
        workspaceSwitchHref(id, state.tabsByWorkspace[id], state.activeTabIdByWorkspace[id])
      );
    } catch (err) {
      addToast({
        title: "Could not open workspace",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  /**
   * Closing narrows the strip. It only navigates when the tab being closed is
   * the one on screen — otherwise the user is tidying, not leaving — and an
   * emptied strip goes to `/` rather than leaving a workspace route mounted
   * with nothing backing it.
   */
  function handleClose(id: string) {
    const nextId = closeWorkspaceTab(id, currentWorkspaceId);
    if (id !== currentWorkspaceId) return;
    if (nextId) goToWorkspace(nextId);
    else navigate("/");
  }

  // Nothing resolved yet (first load, or every id gone): the strip would be a
  // bare "+" over a border, which reads as a rendering fault.
  if (tabs.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="flex items-center shrink-0 border-b bg-muted/40 overflow-x-auto scrollbar-none"
      style={{ minHeight: 34 }}
      aria-label="Open workspaces"
    >
      {tabs.map((ws) => {
        const isActive = ws.id === currentWorkspaceId;
        return (
          <div
            key={ws.id}
            data-workspace-id={ws.id}
            // `aria-current`, not `role="tab"`: these are route links dressed
            // as tabs, and a tab role would promise arrow-key semantics the
            // strip does not implement. Matches how TabBar stays role-free.
            aria-current={isActive ? "page" : undefined}
            title={`${ws.name} — ${bindingHint(ws)}`}
            className={cn(
              "group flex items-center gap-1 px-3 py-1.5 text-xs cursor-pointer border-r shrink-0 max-w-[200px] transition-colors",
              isActive
                ? "bg-card text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-card/60"
            )}
            onClick={() => {
              // Clicking the tab you are already on must not navigate: it
              // would throw away the sub-page for the workspace home.
              if (!isActive) goToWorkspace(ws.id);
            }}
          >
            {workspaceNeedsAttention(ws) && (
              <AlertCircle
                className="h-3 w-3 shrink-0 text-yellow-600"
                aria-label="Some bindings are broken"
              />
            )}
            <span className="truncate">{ws.name}</span>
            <button
              type="button"
              className="ml-1 rounded p-0.5 hover:bg-muted opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              // Spelled out because an "×" beside a name reads as delete.
              // Deleting a workspace lives in the picker, behind a confirm.
              title={`Close this tab — "${ws.name}" is not deleted`}
              aria-label={`Close the ${ws.name} tab (does not delete the workspace)`}
              onClick={(e) => {
                e.stopPropagation();
                handleClose(ws.id);
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => navigate("/")}
        title="Open another workspace"
        aria-label="Open another workspace"
        className="flex items-center shrink-0 px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-card/60 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
