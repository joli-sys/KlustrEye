import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useDirectory, type DirEntry } from "@/hooks/use-files";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { workspacePath } from "@/lib/paths";
import { useTabStore } from "@/lib/stores/tab-store";

/** Directories first, then case-insensitive by name. Mirrors the backend's sort. */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function FileTreeNode({
  wsId,
  entry,
  depth,
  expanded,
  toggleExpanded,
}: {
  wsId: string;
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
}) {
  const { openTab } = useTabStore();
  const navigate = useNavigate();
  const isExpanded = entry.isDir && expanded.has(entry.path);

  // Lazy: only fetches once this node is actually expanded.
  const { data, isLoading, isError } = useDirectory(
    wsId,
    isExpanded ? entry.path : undefined
  );

  const handleClick = () => {
    if (entry.isDir) {
      toggleExpanded(entry.path);
      return;
    }
    // ONE href for both calls. Registering the tab does not mount anything —
    // `FileEditor` only renders for the routed path — so without the navigate
    // a click added a tab and left the user staring at the previous file until
    // they clicked the tab as well. And the two must be the same string: the
    // tab is deduped by exact href, and `updateActiveTab` rewrites the active
    // tab to whatever the router lands on, so a mismatch would silently
    // rename the tab that was just opened.
    const href = workspacePath(wsId, "files/" + entry.path);
    openTab(wsId, href, entry.name, "file", { path: entry.path });
    navigate(href);
  };

  const Icon = entry.isDir ? (isExpanded ? FolderOpen : Folder) : File;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 mx-1 rounded-md text-sm cursor-pointer transition-colors",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
        )}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        title={entry.name}
      >
        {entry.isDir ? (
          isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </div>

      {isExpanded && (
        <div>
          {isLoading && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 mx-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${12 + (depth + 1) * 14 + 20}px` }}
            >
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              Loading...
            </div>
          )}
          {isError && (
            <div
              className="flex items-center gap-1.5 px-3 py-1 mx-1 text-xs text-destructive"
              style={{ paddingLeft: `${12 + (depth + 1) * 14 + 20}px` }}
            >
              <AlertCircle className="h-3 w-3 shrink-0" />
              Failed to load
            </div>
          )}
          {!isLoading && !isError && data && data.entries.length === 0 && (
            <div
              className="px-3 py-1 mx-1 text-xs text-muted-foreground"
              style={{ paddingLeft: `${12 + (depth + 1) * 14 + 20}px` }}
            >
              Empty
            </div>
          )}
          {!isLoading &&
            !isError &&
            data &&
            sortEntries(data.entries).map((child) => (
              <FileTreeNode
                key={child.path}
                wsId={wsId}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
              />
            ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const wsId = useWorkspaceId();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const { data, isLoading, isError } = useDirectory(wsId, "");

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        Loading...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3 shrink-0" />
        Failed to load
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return <p className="px-3 py-1 text-xs text-muted-foreground">Empty</p>;
  }

  return (
    <div>
      {sortEntries(data.entries).map((entry) => (
        <FileTreeNode
          key={entry.path}
          wsId={wsId}
          entry={entry}
          depth={0}
          expanded={expanded}
          toggleExpanded={toggleExpanded}
        />
      ))}
    </div>
  );
}
