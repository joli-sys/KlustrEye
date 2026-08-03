import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  File,
  FilePlus,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useCreateDirectory,
  useDirectory,
  useSaveFile,
  FileSaveError,
  type DirEntry,
} from "@/hooks/use-files";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { workspacePath } from "@/lib/paths";
import { useTabStore } from "@/lib/stores/tab-store";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import {
  baseName,
  joinPath,
  validateEntryName,
  type NewEntryDraft,
  type NewEntryKind,
} from "@/lib/new-entry";

/** Directories first, then case-insensitive by name. Mirrors the backend's sort. */
function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Everything the tree needs to render and drive an in-progress creation. */
interface DraftControls {
  draft: NewEntryDraft | null;
  pending: boolean;
  commit: (name: string) => void;
  cancel: () => void;
}

/**
 * The inline name field for a pending new file/folder.
 *
 * Committing on blur is deliberately NOT done: unlike a rename, an accidental
 * commit here creates a file on disk with a half-typed name, so clicking away
 * discards. Enter commits, Escape cancels — the same contract the session
 * rename in `sidebar-agents.tsx` uses.
 */
function NewEntryRow({
  kind,
  depth,
  pending,
  onCommit,
  onCancel,
}: {
  kind: NewEntryKind;
  depth: number;
  pending: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const problem = validateEntryName(value);
  const Icon = kind === "folder" ? Folder : File;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-3 py-1 mx-1 text-sm"
        style={{ paddingLeft: `${12 + depth * 14}px` }}
      >
        <span className="w-3.5 shrink-0" />
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          value={value}
          // Deliberately NOT `disabled` while the create is in flight:
          // disabling an input blurs it, `onBlur` here cancels, and the draft
          // would be torn down mid-request — so a failed create lost the name
          // the user typed instead of leaving it there to fix. Enter is
          // ignored while pending instead, which keeps focus where it is.
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // The tree rows below are keyboard-activatable; without this an
            // Enter or Space would also reach them.
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              if (!problem && !pending) onCommit(value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={onCancel}
          placeholder={kind === "folder" ? "folder name" : "file name"}
          aria-label={kind === "folder" ? "New folder name" : "New file name"}
          title="Enter to create, Escape to cancel"
          className={cn(
            "w-full min-w-0 rounded border bg-transparent px-1 py-0.5 text-sm",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            problem ? "border-destructive" : "border-input"
          )}
        />
      </div>
      {problem && (
        <p
          className="px-3 pb-1 text-[10px] text-destructive"
          style={{ paddingLeft: `${12 + depth * 14 + 20}px` }}
        >
          {problem}
        </p>
      )}
    </div>
  );
}

/** The right-click menu. Two actions, both scoped to `parent`. */
function TreeContextMenu({
  x,
  y,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  onPick: (kind: NewEntryKind) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      // Fixed rather than absolute: the sidebar scrolls, and an absolutely
      // positioned menu would be clipped by its overflow container.
      style={{ top: y, left: x }}
      className="fixed z-50 min-w-36 overflow-hidden rounded-md border bg-popover p-1 shadow-md"
    >
      <button
        role="menuitem"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
        onClick={() => onPick("file")}
      >
        <FilePlus className="h-3.5 w-3.5" />
        New file
      </button>
      <button
        role="menuitem"
        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
        onClick={() => onPick("folder")}
      >
        <FolderPlus className="h-3.5 w-3.5" />
        New folder
      </button>
    </div>
  );
}

function FileTreeNode({
  wsId,
  entry,
  depth,
  expanded,
  toggleExpanded,
  drafts,
  onContextMenu,
}: {
  wsId: string;
  entry: DirEntry;
  depth: number;
  expanded: Set<string>;
  toggleExpanded: (path: string) => void;
  drafts: DraftControls;
  onContextMenu: (e: React.MouseEvent, parent: string) => void;
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
  // A right-click on a file creates alongside it, not inside it.
  const contextParent = entry.isDir
    ? entry.path
    : entry.path.split("/").slice(0, -1).join("/");
  const showDraftHere = drafts.draft?.parent === entry.path && isExpanded;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, contextParent)}
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
          {/* Above the children so it is visible without scrolling a long
              directory, and so it does not move as the listing refetches. */}
          {showDraftHere && drafts.draft && (
            <NewEntryRow
              kind={drafts.draft.kind}
              depth={depth + 1}
              pending={drafts.pending}
              onCommit={drafts.commit}
              onCancel={drafts.cancel}
            />
          )}
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
          {!isLoading && !isError && data && data.entries.length === 0 && !showDraftHere && (
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
                drafts={drafts}
                onContextMenu={onContextMenu}
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
  const [draft, setDraft] = useState<NewEntryDraft | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; parent: string } | null>(
    null
  );

  const navigate = useNavigate();
  const { openTab } = useTabStore();
  const { addToast } = useToast();
  const createDirectory = useCreateDirectory();
  const saveFile = useSaveFile();

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

  /** Opens a draft in `parent`, expanding it so the input is actually visible. */
  const startCreate = (parent: string, kind: NewEntryKind) => {
    setMenu(null);
    if (parent) setExpanded((prev) => new Set(prev).add(parent));
    setDraft({ parent, kind });
  };

  const pending = createDirectory.isPending || saveFile.isPending;

  const commitDraft = async (name: string) => {
    if (!draft || !wsId) return;
    const path = joinPath(draft.parent, name);
    if (!path) return;

    try {
      if (draft.kind === "folder") {
        await createDirectory.mutateAsync({ wsId, path });
        // Expand it, so an immediate second "New file" lands inside.
        setExpanded((prev) => new Set(prev).add(path));
      } else {
        // No `baseModifiedMs` — that is precisely what makes this a create
        // rather than an overwrite-if-unchanged (see backend `write_file`).
        await saveFile.mutateAsync({ wsId, path, content: "" });
        const href = workspacePath(wsId, "files/" + path);
        openTab(wsId, href, baseName(path), "file", { path });
        navigate(href);
      }
      setDraft(null);
    } catch (err) {
      const taken = err instanceof FileSaveError && err.status === 409;
      addToast({
        title: taken
          ? "That name is already taken"
          : `Could not create the ${draft.kind}`,
        // Verbatim: the backend distinguishes "already exists" from "not a
        // usable relative path", which fixed copy here could not.
        description: (err as Error).message,
        variant: "destructive",
      });
      // The draft stays open with the typed name so the user can adjust it
      // rather than starting over.
    }
  };

  const drafts: DraftControls = {
    draft,
    pending,
    commit: commitDraft,
    cancel: () => setDraft(null),
  };

  const handleContextMenu = (e: React.MouseEvent, parent: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, parent });
  };

  const toolbar = (
    <div className="flex items-center justify-end gap-0.5 px-2 pb-1">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="New file in the workspace root"
        aria-label="New file"
        onClick={() => startCreate("", "file")}
      >
        <FilePlus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        title="New folder in the workspace root"
        aria-label="New folder"
        onClick={() => startCreate("", "folder")}
      >
        <FolderPlus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  const rootDraft = draft?.parent === "" && (
    <NewEntryRow
      kind={draft.kind}
      depth={0}
      pending={pending}
      onCommit={commitDraft}
      onCancel={() => setDraft(null)}
    />
  );

  /**
   * The toolbar renders in every state on purpose — an empty or failed listing
   * is exactly when "New file" is most wanted, and hiding it there is what
   * made the workspace look read-only.
   */
  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
        Loading...
      </div>
    );
  } else if (isError) {
    body = (
      <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-destructive">
        <AlertCircle className="h-3 w-3 shrink-0" />
        Failed to load
      </div>
    );
  } else if (!data || data.entries.length === 0) {
    body = rootDraft || (
      <p className="px-3 py-1 text-xs text-muted-foreground">Empty</p>
    );
  } else {
    body = (
      <>
        {rootDraft}
        {sortEntries(data.entries).map((entry) => (
          <FileTreeNode
            key={entry.path}
            wsId={wsId}
            entry={entry}
            depth={0}
            expanded={expanded}
            toggleExpanded={toggleExpanded}
            drafts={drafts}
            onContextMenu={handleContextMenu}
          />
        ))}
      </>
    );
  }

  return (
    <div
      // A right-click on the blank area below the tree targets the root, so
      // there is always somewhere to invoke the menu from.
      onContextMenu={(e) => handleContextMenu(e, "")}
      className="min-h-full"
    >
      {toolbar}
      {body}
      {menu && (
        <TreeContextMenu
          x={menu.x}
          y={menu.y}
          onPick={(kind) => startCreate(menu.parent, kind)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
