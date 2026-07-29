import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, ChevronDown, Check, Search, AlertCircle, Grid2x2, Plus } from "lucide-react";
import type { Workspace } from "@/hooks/use-workspaces";
import { useWorkspaces } from "@/hooks/use-workspaces";
import { useTabStore } from "@/lib/stores/tab-store";
import { bindingHint, workspaceSwitchHref } from "@/lib/workspace-switch";
import { workspaceNeedsAttention } from "@/lib/workspace-clusters";
import { WorkspaceDialog } from "@/components/workspace-dialog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface WorkspaceSwitcherProps {
  /** The workspace currently on screen. */
  workspace: Workspace;
  /** Whether the side PANEL is showing; the rail is always visible. */
  panelOpen: boolean;
  /** Mobile drawer hook — closes the drawer once navigation has happened. */
  onNavigate?: () => void;
}

/**
 * A keyboard-navigable row. Workspaces and the two trailing actions share one
 * list so Arrow/Enter reach everything the mouse can — a visible row that the
 * keyboard skips is the same dead end this component exists to remove.
 */
type Entry =
  | { kind: "workspace"; workspace: Workspace }
  | { kind: "all" }
  | { kind: "new" };

/**
 * Switches between WORKSPACES, from the top of the sidebar.
 *
 * Until this existed the only way out of a workspace was the "All workspaces"
 * link on the workspace index route: from a file editor or a cluster page
 * there was no visible route to another workspace at all.
 *
 * Switching restores position rather than dumping the user on the target's
 * home screen — see `workspaceSwitchHref` for which persisted hrefs are
 * trusted and why. Interaction shape (open/close, filter, highlight,
 * scroll-into-view, close only once an href exists) follows `ClusterSwitcher`
 * deliberately; two switchers in the same sidebar behaving differently would
 * be its own bug.
 */
export function WorkspaceSwitcher({
  workspace,
  panelOpen,
  onNavigate,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();
  // Cache-hot on every workspace route; WorkspaceLayout already holds the
  // single-workspace query, and this is the list behind it.
  const { data: workspaces } = useWorkspaces();

  // Memoised so the empty fallback is not a fresh array on every render, which
  // would re-run the highlight effect below for the whole loading window.
  const all = useMemo(() => workspaces ?? [], [workspaces]);
  const filterLower = filter.toLowerCase();

  const matching = useMemo(() => {
    if (!filter) return all;
    return all.filter(
      (w) =>
        w.name.toLowerCase().includes(filterLower) ||
        bindingHint(w).toLowerCase().includes(filterLower)
    );
  }, [all, filter, filterLower]);

  // Actions stay put while filtering: they are not search results, and losing
  // "New workspace" exactly when a search comes up empty is backwards.
  const entries = useMemo<Entry[]>(
    () => [
      ...matching.map((w): Entry => ({ kind: "workspace", workspace: w })),
      { kind: "all" },
      { kind: "new" },
    ],
    [matching]
  );

  useEffect(() => {
    if (!open) setFilter("");
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => filterInputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  // Highlight: the current workspace on open/clear, the first match while filtering.
  useEffect(() => {
    if (!open) return;
    if (!filter) {
      const idx = entries.findIndex(
        (e) => e.kind === "workspace" && e.workspace.id === workspace.id
      );
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [open, filterLower, entries, workspace.id]);

  useEffect(() => {
    if (!open || entries.length === 0) return;
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % entries.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((i) => (i - 1 + entries.length) % entries.length);
          break;
        case "Enter":
          e.preventDefault();
          activate(entries[highlightedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, entries, highlightedIndex]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const el = ref.current?.querySelector(`[data-ws-index="${highlightedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);

  /**
   * Move to another workspace, landing on whatever it was last showing.
   *
   * The tab state is read imperatively: the destination depends on the TARGET
   * workspace's tabs, so subscribing would re-render this component on every
   * tab change in every workspace to compute an href only a click needs.
   *
   * Like `ClusterSwitcher`, the menu closes only once an href actually exists.
   * `workspaceSwitchHref` throws on a reserved id, and a menu that shuts on a
   * click that then goes nowhere is indistinguishable from one that never
   * registered the click.
   */
  function switchWorkspace(targetId: string) {
    if (targetId === workspace.id) {
      setOpen(false);
      return;
    }
    try {
      const state = useTabStore.getState();
      const href = workspaceSwitchHref(
        targetId,
        state.tabsByWorkspace[targetId],
        state.activeTabIdByWorkspace[targetId]
      );
      setOpen(false);
      navigate(href);
      onNavigate?.();
    } catch (err) {
      addToast({
        title: "Could not switch workspace",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  function activate(entry: Entry | undefined) {
    if (!entry) return;
    switch (entry.kind) {
      case "workspace":
        switchWorkspace(entry.workspace.id);
        break;
      case "all":
        setOpen(false);
        navigate("/");
        onNavigate?.();
        break;
      case "new":
        setOpen(false);
        setCreating(true);
        break;
    }
  }

  function renderEntry(entry: Entry, index: number) {
    const isHighlighted = index === highlightedIndex;
    const rowClass = cn(
      "flex items-center gap-2 w-full px-3 py-1.5 text-sm min-w-0 text-left",
      isHighlighted ? "bg-accent" : "hover:bg-accent/50"
    );

    if (entry.kind !== "workspace") {
      const isAll = entry.kind === "all";
      return (
        <button
          key={entry.kind}
          data-ws-index={index}
          onMouseEnter={() => setHighlightedIndex(index)}
          onClick={() => activate(entry)}
          className={cn(rowClass, isAll && "border-t mt-1 pt-2")}
        >
          {isAll ? (
            <Grid2x2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{isAll ? "All workspaces" : "New workspace…"}</span>
        </button>
      );
    }

    const ws = entry.workspace;
    const isCurrent = ws.id === workspace.id;
    const needsAttention = workspaceNeedsAttention(ws);
    return (
      <button
        key={ws.id}
        data-ws-index={index}
        onMouseEnter={() => setHighlightedIndex(index)}
        onClick={() => activate(entry)}
        className={rowClass}
      >
        {needsAttention ? (
          <AlertCircle
            className="h-4 w-4 shrink-0 text-yellow-600"
            aria-label="Some bindings are broken"
          />
        ) : (
          <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="flex flex-col min-w-0 flex-1">
          <span className="truncate">{ws.name}</span>
          <span className="truncate text-xs text-muted-foreground">{bindingHint(ws)}</span>
        </span>
        {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
      </button>
    );
  }

  return (
    /* `border-r` as well as `border-b`: this row spans the rail AND the panel,
       so it carries the sidebar's right edge for its own height. Stacked above
       the rail's own `border-r` (never beside it) the line stays a single
       pixel whether the panel is open or collapsed. */
    <div ref={ref} className="relative shrink-0 border-b border-r bg-card">
      <button
        onClick={() => setOpen(!open)}
        title={panelOpen ? undefined : workspace.name}
        aria-label={`Workspace: ${workspace.name}`}
        aria-expanded={open}
        className={cn(
          "flex items-center w-full h-11 px-3 text-sm hover:bg-accent/50 transition-colors",
          panelOpen ? "gap-3 justify-between" : "justify-center px-0"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Boxes className="h-4 w-4 shrink-0" />
          {panelOpen && <span className="truncate font-medium">{workspace.name}</span>}
        </div>
        {panelOpen && (
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
            "absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-[240px]",
            // Collapsed, the trigger is only as wide as the rail, so the menu
            // opens beside it rather than trying to fit underneath.
            panelOpen ? "left-0 right-0 top-full mt-1" : "left-full top-0 ml-1"
          )}
        >
          {all.length > 5 && (
            <div className="px-2 pb-1 pt-1">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={filterInputRef}
                  type="text"
                  autoComplete="off"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter workspaces..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
              Workspaces
            </div>
            {matching.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                {all.length === 0 ? "No workspaces yet" : "No workspaces found"}
              </div>
            )}
            {entries.map(renderEntry)}
          </div>
        </div>
      )}

      <WorkspaceDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
