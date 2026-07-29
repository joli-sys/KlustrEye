import { useState, useRef, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useClusters } from "@/hooks/use-clusters";
import type { Workspace } from "@/hooks/use-workspaces";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { clusterSwitchHref } from "@/lib/paths";
import { orderedClusters } from "@/lib/workspace-clusters";
import { RenameContextDialog } from "@/components/rename-context-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";
import { Server, ChevronDown, Check, Pencil, Search, AlertCircle } from "lucide-react";
import type { ClusterContext } from "@/hooks/use-clusters";

interface ClusterSwitcherProps {
  workspace: Workspace;
  /** The cluster currently on screen, not the workspace's default. */
  contextName: string;
  sidebarOpen: boolean;
}

/**
 * A binding, joined with whatever the kubeconfig knows about it.
 *
 * `meta` is null exactly when the context is gone, which is also why the row
 * cannot offer rename or a colour: there is no `cluster_contexts` row to edit.
 */
interface BoundCluster {
  contextName: string;
  exists: boolean;
  meta: ClusterContext | null;
}

/**
 * Switches between the clusters THIS workspace binds.
 *
 * It used to list every context in the kubeconfig and resolve-or-create a
 * separate workspace per cluster, back when the relationship was one-to-one.
 * A workspace now owns its cluster set, so switching is a move inside the same
 * workspace — the workspace id in the URL stays put and only the context
 * segment changes. Clusters the user has not bound are deliberately absent:
 * binding them is `WorkspaceDialog`'s job, not a side effect of navigating.
 */
export function ClusterSwitcher({
  workspace,
  contextName,
  sidebarOpen,
}: ClusterSwitcherProps) {
  const open = useUIStore((s) => s.clusterSwitcherOpen);
  const setOpen = useUIStore((s) => s.setClusterSwitcherOpen);
  const [filter, setFilter] = useState("");
  const [renameCtx, setRenameCtx] = useState<{
    name: string;
    displayName: string | null;
    organizationId: string | null;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { data: clusters } = useClusters();
  const wsId = useWorkspaceId();
  const { addToast } = useToast();

  const boundClusters = useMemo<BoundCluster[]>(() => {
    const byName = new Map((clusters ?? []).map((c) => [c.name, c]));
    return orderedClusters(workspace.clusters).map((b) => ({
      contextName: b.contextName,
      exists: b.exists,
      meta: byName.get(b.contextName) ?? null,
    }));
  }, [clusters, workspace.clusters]);

  const current = boundClusters.find((c) => c.contextName === contextName);
  const displayLabel = current?.meta?.displayName || contextName;

  const filterLower = filter.toLowerCase();

  // Bound sets are small, so a flat filtered list is the whole model — no
  // organization grouping here, unlike the old kubeconfig-wide switcher.
  const visible = useMemo(() => {
    if (!filter) return boundClusters;
    return boundClusters.filter(
      (c) =>
        (c.meta?.displayName || c.contextName).toLowerCase().includes(filterLower) ||
        c.contextName.toLowerCase().includes(filterLower)
    );
  }, [boundClusters, filter, filterLower]);

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => filterInputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Reset highlight: current cluster on open/clear, first item on filter change
  useEffect(() => {
    if (!open) return;
    if (!filter) {
      const idx = visible.findIndex((c) => c.contextName === contextName);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [open, filterLower, visible, contextName]);

  // Keyboard navigation
  useEffect(() => {
    if (!open || visible.length === 0) return;
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % visible.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => (i - 1 + visible.length) % visible.length);
          break;
        case "Enter":
          e.preventDefault();
          if (visible[highlightedIndex]) switchCluster(visible[highlightedIndex].contextName);
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, visible, highlightedIndex]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const el = ref.current?.querySelector(`[data-cluster-index="${highlightedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);

  /**
   * Re-anchor the current sub-path onto another of this workspace's clusters.
   *
   * The failure paths are real, not defensive noise: a context can be bound but
   * absent from the kubeconfig, and `clusterPath` refuses a reserved workspace
   * id. The menu closes only once an href actually exists — a menu that shuts
   * on a click that then goes nowhere is indistinguishable from a click that
   * never registered.
   */
  function switchCluster(targetName: string) {
    try {
      const target = boundClusters.find((c) => c.contextName === targetName);
      if (!target) {
        throw new Error(`"${targetName}" is not bound to this workspace.`);
      }
      if (!target.exists) {
        throw new Error(`"${targetName}" is not in the current kubeconfig.`);
      }
      const href = clusterSwitchHref(wsId, contextName, targetName, pathname, search);
      setOpen(false);
      navigate(href);
    } catch (err) {
      addToast({
        title: "Could not switch cluster",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  function renderClusterItem(cluster: BoundCluster) {
    const flatIndex = visible.indexOf(cluster);
    const isHighlighted = flatIndex === highlightedIndex;
    return (
      <div
        key={cluster.contextName}
        data-cluster-index={flatIndex}
        className={cn(
          "flex items-center group",
          isHighlighted ? "bg-accent" : "hover:bg-accent/50"
        )}
        onMouseEnter={() => setHighlightedIndex(flatIndex)}
      >
        <button
          onClick={() => switchCluster(cluster.contextName)}
          title={
            cluster.exists
              ? undefined
              : `"${cluster.contextName}" is not in the current kubeconfig.`
          }
          className="flex items-center gap-2 flex-1 px-3 py-1.5 text-sm min-w-0"
        >
          {cluster.exists ? (
            <Server
              className="h-4 w-4 shrink-0"
              style={{
                color:
                  (COLOR_PRESETS[cluster.meta?.colorScheme ?? ""] ??
                    COLOR_PRESETS[DEFAULT_COLOR_SCHEME]).dot,
              }}
            />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600" />
          )}
          <span className={cn("truncate", !cluster.exists && "line-through text-muted-foreground")}>
            {cluster.meta?.displayName || cluster.contextName}
          </span>
          {!cluster.exists && (
            <span className="ml-auto shrink-0 text-[10px] uppercase text-muted-foreground">
              missing
            </span>
          )}
          {cluster.exists && cluster.contextName === contextName && (
            <Check className="h-3.5 w-3.5 shrink-0 ml-auto" />
          )}
        </button>
        {/* Rename edits the `cluster_contexts` row, which only exists for a
            context the kubeconfig still has. */}
        {cluster.meta && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRenameCtx({
                name: cluster.contextName,
                displayName: cluster.meta!.displayName,
                organizationId: cluster.meta!.organizationId,
              });
            }}
            className="p-1.5 mr-2 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-opacity"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center w-full px-3 py-2 text-sm hover:bg-accent/50 transition-colors",
          sidebarOpen ? "gap-3 justify-between" : "justify-center"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Server className="h-4 w-4 shrink-0" />
          {sidebarOpen && (
            <span className="truncate font-medium">{displayLabel}</span>
          )}
        </div>
        {sidebarOpen && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform text-muted-foreground",
              open && "rotate-180"
            )}
          />
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-[220px]",
            sidebarOpen
              ? "left-0 right-0 top-full mt-1"
              : "left-full top-0 ml-1"
          )}
        >
          {boundClusters.length > 5 && (
            <div className="px-2 pb-1 pt-1">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={filterInputRef}
                  type="text"
                  autoComplete="off"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter clusters..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
              Workspace clusters
            </div>
            {visible.map(renderClusterItem)}
            {visible.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {boundClusters.length === 0
                  ? "No clusters bound to this workspace"
                  : "No clusters found"}
              </div>
            )}
          </div>
        </div>
      )}

      {renameCtx && (
        <RenameContextDialog
          contextName={renameCtx.name}
          currentDisplayName={renameCtx.displayName}
          currentOrganizationId={renameCtx.organizationId}
          open
          onOpenChange={(open) => !open && setRenameCtx(null)}
        />
      )}
    </div>
  );
}
