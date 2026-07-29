import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Square,
  CircleDot,
  Circle,
  FolderOpen,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { cn, formatAge } from "@/lib/utils";
import { workspacePath } from "@/lib/paths";
import { abbreviatePath } from "@/lib/agent-forms";
import { isTauri, pickFolder } from "@/lib/folder-picker";
import { useTabStore } from "@/lib/stores/tab-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AgentDefinitionsDialog } from "@/components/agent-definitions-dialog";
import type { Workspace } from "@/hooks/use-workspaces";
import {
  useAgentDefinitions,
  useAgentSessions,
  useCreateAgentSession,
  useKillAgentSession,
  useRenameAgentSession,
  AgentSessionError,
  type AgentSession,
} from "@/hooks/use-agents";

/**
 * The per-session status dot plus its tooltip.
 *
 * `activity`/`waitingConfidence` are heuristics the backend infers from
 * output timing and prompt-pattern matching, never certainties — copy stays
 * hedged ("needs input"/"idle") except at high confidence, where a known
 * prompt pattern actually matched. `status === "exited"` and a missing
 * `activity` (older/rolling-out backend) both fall back to the dot this
 * used to always show, so the row never renders nothing.
 */
function SessionIndicator({ session }: { session: AgentSession }) {
  if (session.status === "exited") {
    return (
      <span title="Exited" className="shrink-0">
        <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
      </span>
    );
  }

  if (session.activity === "working") {
    return (
      <span
        title="Working — produced output moments ago"
        className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center"
      >
        <span className="absolute inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-green-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
      </span>
    );
  }

  if (session.activity === "waiting" && session.waitingConfidence === "high") {
    return (
      <span title="Needs input — a known prompt pattern matched" className="shrink-0">
        <CircleDot className="h-3.5 w-3.5 text-amber-500" />
      </span>
    );
  }

  if (session.activity === "waiting") {
    return (
      <span
        title="Idle — quiet for a while. May be waiting on you, or just running a long build."
        className="shrink-0"
      >
        <Circle className="h-3.5 w-3.5 text-amber-500/50" />
      </span>
    );
  }

  return (
    <span title="Running" className="shrink-0">
      <CircleDot className="h-3.5 w-3.5 text-green-500" />
    </span>
  );
}

/**
 * The Agents half of the "Terminals & Agents" rail view: start a new agent
 * session from a registered definition in a working directory of your choice,
 * see the workspace's sessions, rename one, and kill one.
 *
 * Unlike `SidebarExplorer`/`SidebarSearch` this view does NOT degrade to
 * nothing when no folder is bound: a session carries its own working
 * directory, so an unbound workspace can still run an agent — the folder field
 * just becomes required rather than prefilled.
 */
export function SidebarAgents({ workspace, wsId }: { workspace: Workspace; wsId: string }) {
  const navigate = useNavigate();
  const { openTab } = useTabStore();
  const confirm = useConfirm();
  const { addToast } = useToast();

  const { data: definitions } = useAgentDefinitions();
  const { data: sessions, isLoading } = useAgentSessions(wsId);
  const createSession = useCreateAgentSession(wsId);
  const killSession = useKillAgentSession(wsId);
  const renameSession = useRenameAgentSession(wsId);

  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [cwd, setCwd] = useState(workspace.folderPath ?? "");
  const [definitionsOpen, setDefinitionsOpen] = useState(false);

  /** `null` = nobody is being renamed; otherwise the session id being edited. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Follow the workspace's binding: rebinding the folder should move where the
  // NEXT session starts, and a stale path left in the field would be a quiet
  // trap. A path typed for one session is deliberately kept until then.
  useEffect(() => {
    setCwd(workspace.folderPath ?? "");
  }, [workspace.folderPath]);

  const hasFolder = !!workspace.folderPath;
  const trimmedCwd = cwd.trim();
  // Either an explicit directory or a bound folder to fall back on. Checked
  // here so the user is never sent into a backend 400 by a click.
  const hasSomewhereToRun = !!trimmedCwd || hasFolder;

  const openSessionTab = (session: AgentSession) => {
    // ONE href for both calls — see file-tree.tsx's handleClick for why a
    // mismatch here would silently rename or strand the tab.
    const href = workspacePath(wsId, "agents/" + session.id);
    openTab(wsId, href, session.title, "agent", { sessionId: session.id });
    navigate(href);
  };

  async function handleBrowse() {
    try {
      const selected = await pickFolder();
      // null means the user cancelled — leave the field alone, say nothing.
      if (selected) setCwd(selected);
    } catch (e) {
      // Without this the rejection was unhandled and the button looked inert.
      // eslint-disable-next-line no-console
      console.error("Folder picker failed:", e);
      addToast({
        title: "Could not open the folder picker",
        description:
          (e as Error).message + " You can still type an absolute path into the field.",
        variant: "destructive",
      });
    }
  }

  const handleCreate = async () => {
    if (!selectedDefinitionId || !hasSomewhereToRun) return;
    try {
      const session = await createSession.mutateAsync({
        definitionId: selectedDefinitionId,
        // Omitted rather than sent empty, so the backend falls back to the
        // workspace folder instead of resolving "".
        cwd: trimmedCwd || undefined,
      });
      openSessionTab(session);
    } catch (err) {
      if (err instanceof AgentSessionError && err.status === 400) {
        addToast({
          title: "Can't start agent",
          // Verbatim: a 400 here says which of "nowhere to run" and "that
          // directory doesn't exist" it was, which fixed copy cannot.
          description: err.message || "Choose a working directory that exists.",
          variant: "destructive",
        });
      } else if (err instanceof AgentSessionError && err.status === 429) {
        addToast({
          title: "Too many agent sessions",
          description: "Kill an existing session before starting another.",
          variant: "destructive",
        });
      } else {
        addToast({
          title: "Failed to start agent",
          description: (err as Error).message,
          variant: "destructive",
        });
      }
    }
  };

  const handleKill = async (session: AgentSession) => {
    const ok = await confirm({
      title: `Kill "${session.title}"?`,
      description: "Any in-flight work in this session will be lost.",
      confirmLabel: "Kill session",
    });
    if (!ok) return;

    try {
      await killSession.mutateAsync(session.id);
    } catch (err) {
      addToast({
        title: "Failed to kill session",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const startRename = (session: AgentSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
  };

  /**
   * Commits the inline rename.
   *
   * A blank name is rejected here rather than by the backend — the round trip
   * would only come back saying the same thing, and the field stays open with
   * the user's text intact either way.
   *
   * Renaming is permanent: the backend stops auto-titling this session from
   * its output for good. Nothing here ever writes a title back, so a chosen
   * name cannot drift.
   */
  const commitRename = async (session: AgentSession) => {
    const title = renameValue.trim();
    if (!title) {
      addToast({
        title: "Name required",
        description: "A session name can't be blank.",
        variant: "destructive",
      });
      return;
    }
    if (title === session.title) {
      setRenamingId(null);
      return;
    }

    try {
      await renameSession.mutateAsync({ id: session.id, title });
      setRenamingId(null);
    } catch (err) {
      addToast({
        title: "Failed to rename session",
        description: (err as Error).message,
        variant: "destructive",
      });
      // A session that no longer exists cannot be renamed by trying harder —
      // close the editor rather than leaving the user typing into nothing.
      if (err instanceof AgentSessionError && err.status === 404) setRenamingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            New session
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            title="Manage agents"
            onClick={() => setDefinitionsOpen(true)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Select
          value={selectedDefinitionId}
          onChange={(e) => setSelectedDefinitionId(e.target.value)}
          options={(definitions ?? []).map((d) => ({ value: d.id, label: d.name }))}
          placeholder="Choose an agent"
          className="h-8 text-xs"
          disabled={!definitions || definitions.length === 0}
        />

        <div className="flex items-center gap-1">
          <Input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder={hasFolder ? workspace.folderPath ?? "" : "/path/to/folder"}
            title={trimmedCwd || "Working directory for the new session"}
            className="h-8 text-xs"
          />
          {isTauri() && (
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              title="Browse for a folder"
              onClick={handleBrowse}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {!hasSomewhereToRun && (
          <p className="text-xs text-muted-foreground">
            This workspace has no folder bound — enter a working directory to run an
            agent.
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          className="h-8 w-full text-xs"
          disabled={!selectedDefinitionId || !hasSomewhereToRun || createSession.isPending}
          onClick={handleCreate}
        >
          <Plus className="h-3.5 w-3.5" />
          {createSession.isPending ? "Starting…" : "New session"}
        </Button>

        {definitions && definitions.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No agents configured yet — add one under “Manage agents”.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {isLoading && <p className="text-xs text-muted-foreground">Loading sessions…</p>}
        {!isLoading && sessions && sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">No agent sessions yet.</p>
        )}
        {sessions?.map((session) => {
          const isRenaming = renamingId === session.id;
          return (
            <div
              key={session.id}
              role="button"
              tabIndex={0}
              // While the inline editor is open the row is a form, not a
              // button — opening the tab under the user's cursor mid-rename
              // would throw the edit away.
              onClick={() => {
                if (!isRenaming) openSessionTab(session);
              }}
              onKeyDown={(e) => {
                if (isRenaming) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSessionTab(session);
                }
              }}
              className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer"
            >
              <SessionIndicator session={session} />
              <div className="flex-1 min-w-0">
                {isRenaming ? (
                  <input
                    // Keystrokes must not reach the row: its Enter/Space
                    // handler would open the tab out from under the editor.
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitRename(session);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setRenamingId(null);
                      }
                    }}
                    // Clicking away discards rather than saves: an accidental
                    // commit is harder to notice than a lost keystroke, and a
                    // rename is permanent.
                    onBlur={() => setRenamingId(null)}
                    title="Enter to save, Escape to cancel"
                    className="w-full rounded border border-input bg-transparent px-1 py-0.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                ) : (
                  <div className="truncate" title={session.title}>
                    {session.title}
                  </div>
                )}
                {/* Two sessions in one workspace are otherwise
                    indistinguishable, and they no longer have to share a
                    directory. Older rows carry no cwd at all — show nothing
                    rather than guess. */}
                {session.cwd && (
                  <div
                    className="truncate font-mono text-[10px] text-muted-foreground/80"
                    title={session.cwd}
                  >
                    {abbreviatePath(session.cwd)}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  {session.status === "exited" && (
                    <Badge
                      variant={session.exitCode === 0 ? "secondary" : "destructive"}
                      className="px-1 py-0 text-[10px]"
                    >
                      exit {session.exitCode ?? "?"}
                    </Badge>
                  )}
                  {session.status !== "exited" &&
                    session.activity === "waiting" &&
                    session.waitingConfidence === "high" && (
                      <Badge variant="warning" className="px-1 py-0 text-[10px]">
                        needs input
                      </Badge>
                    )}
                  {session.status !== "exited" &&
                    session.activity === "waiting" &&
                    session.waitingConfidence !== "high" && (
                      <span className="text-muted-foreground/70">idle</span>
                    )}
                  <span>{formatAge(session.lastActivityAt ?? session.createdAt)} ago</span>
                </div>
              </div>
              {!isRenaming && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  title="Rename session"
                  onClick={(e) => {
                    e.stopPropagation();
                    startRename(session);
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
              )}
              {session.status === "running" && !isRenaming && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    killSession.isPending && "opacity-100"
                  )}
                  title="Kill session"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleKill(session);
                  }}
                >
                  <Square className="h-3 w-3" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <AgentDefinitionsDialog open={definitionsOpen} onOpenChange={setDefinitionsOpen} />
    </div>
  );
}
