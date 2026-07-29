import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Square, CircleDot, Circle } from "lucide-react";
import { cn, formatAge } from "@/lib/utils";
import { workspacePath } from "@/lib/paths";
import { useTabStore } from "@/lib/stores/tab-store";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { Workspace } from "@/hooks/use-workspaces";
import {
  useAgentDefinitions,
  useAgentSessions,
  useCreateAgentSession,
  useKillAgentSession,
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
 * session from a registered definition, see the workspace's sessions, and
 * kill a running one.
 *
 * Mirrors `SidebarExplorer`/`SidebarSearch`'s degrade pattern — no folder
 * bound means the backend would 400 on every create, so the control is never
 * offered rather than left to fail after a click.
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

  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");

  const hasFolder = !!workspace.folderPath;

  const openSessionTab = (session: AgentSession) => {
    // ONE href for both calls — see file-tree.tsx's handleClick for why a
    // mismatch here would silently rename or strand the tab.
    const href = workspacePath(wsId, "agents/" + session.id);
    openTab(wsId, href, session.title, "agent", { sessionId: session.id });
    navigate(href);
  };

  const handleCreate = async () => {
    if (!selectedDefinitionId) return;
    try {
      const session = await createSession.mutateAsync({ definitionId: selectedDefinitionId });
      openSessionTab(session);
    } catch (err) {
      if (err instanceof AgentSessionError && err.status === 400) {
        addToast({
          title: "Can't start agent",
          description: "Bind a folder to this workspace to run an agent.",
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

  if (!hasFolder) {
    return (
      <div className="px-3 py-2">
        <p className="text-xs text-muted-foreground">
          Bind a folder to this workspace to run an agent.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <Select
          value={selectedDefinitionId}
          onChange={(e) => setSelectedDefinitionId(e.target.value)}
          options={(definitions ?? []).map((d) => ({ value: d.id, label: d.name }))}
          placeholder="Choose an agent"
          className="h-8 text-xs"
          disabled={!definitions || definitions.length === 0}
        />
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title="New session"
          disabled={!selectedDefinitionId || createSession.isPending}
          onClick={handleCreate}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {definitions && definitions.length === 0 && (
        <p className="text-xs text-muted-foreground">No agent definitions configured.</p>
      )}

      <div className="flex flex-col gap-1">
        {isLoading && <p className="text-xs text-muted-foreground">Loading sessions…</p>}
        {!isLoading && sessions && sessions.length === 0 && (
          <p className="text-xs text-muted-foreground">No agent sessions yet.</p>
        )}
        {sessions?.map((session) => (
          <div
            key={session.id}
            role="button"
            tabIndex={0}
            onClick={() => openSessionTab(session)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openSessionTab(session);
              }
            }}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50 cursor-pointer"
          >
            <SessionIndicator session={session} />
            <div className="flex-1 min-w-0">
              <div className="truncate">{session.title}</div>
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
            {session.status === "running" && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100",
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
        ))}
      </div>
    </div>
  );
}
