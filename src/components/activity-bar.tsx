import { Link } from "react-router-dom";
import { FolderTree, Server, Search, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityView } from "@/lib/stores/ui-store";
import { KlustrEyeLogo } from "@/components/klustreye-logo";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

export interface ActivityViewDef {
  id: ActivityView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ALL_VIEWS: Record<ActivityView, ActivityViewDef> = {
  explorer: { id: "explorer", label: "Explorer", icon: FolderTree },
  cluster: { id: "cluster", label: "Cluster", icon: Server },
  search: { id: "search", label: "Search", icon: Search },
  terminals: { id: "terminals", label: "Terminals & Agents", icon: SquareTerminal },
};

/**
 * Which rail icons a workspace gets. A view whose surface is not bound has no
 * icon at all — an Explorer button with no folder behind it can only open an
 * empty panel. Terminals is unconditional, which is also what guarantees the
 * list is never empty and `availableViews(...)[0]` is always a valid fallback.
 */
export function availableViews(opts: {
  hasFolder: boolean;
  hasCluster: boolean;
}): ActivityViewDef[] {
  const views: ActivityViewDef[] = [];
  if (opts.hasFolder) views.push(ALL_VIEWS.explorer);
  if (opts.hasCluster) views.push(ALL_VIEWS.cluster);
  if (opts.hasFolder) views.push(ALL_VIEWS.search);
  views.push(ALL_VIEWS.terminals);
  return views;
}

export function ActivityBar({
  views,
  activeView,
  panelOpen,
  onSelect,
  badgeCounts,
}: {
  views: ActivityViewDef[];
  activeView: ActivityView;
  /** Whether the panel next to the rail is showing. The rail itself is always visible. */
  panelOpen: boolean;
  onSelect: (view: ActivityView) => void;
  /**
   * Per-view attention counts, rendered as a small dot-with-count in the
   * icon's corner — e.g. agent sessions that need the user. Absent or zero
   * means no badge; the rail is narrow, so this is never a wide pill.
   */
  badgeCounts?: Partial<Record<ActivityView, number>>;
}) {
  return (
    <div className="flex flex-col items-center w-12 shrink-0 h-full border-r bg-card">
      <Link
        to="/"
        className="flex items-center justify-center h-11 w-full shrink-0 border-b overflow-hidden"
        title="KlustrEye"
      >
        <KlustrEyeLogo size="sm" className="scale-[0.45] origin-center" />
      </Link>

      <nav className="flex flex-col items-center py-1 gap-0.5 w-full">
        {views.map((view) => {
          const Icon = view.icon;
          // Only the view actually on screen reads as selected; while the panel
          // is collapsed nothing is, so the rail shows no false "you are here".
          const isActive = panelOpen && view.id === activeView;
          const count = badgeCounts?.[view.id] ?? 0;
          return (
            <Tooltip key={view.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={view.label}
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onSelect(view.id)}
                  className={cn(
                    "relative flex items-center justify-center h-11 w-full transition-colors",
                    "before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-0.5 before:rounded-r",
                    isActive
                      ? "text-foreground before:bg-primary"
                      : "text-muted-foreground/60 hover:text-foreground before:bg-transparent"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {count > 0 && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold leading-none text-white"
                    >
                      {count > 9 ? "9+" : count}
                    </span>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {count > 0
                  ? `${view.label} — ${count} agent${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you`
                  : view.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </div>
  );
}
