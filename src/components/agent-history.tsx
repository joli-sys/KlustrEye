import { useNavigate } from "react-router-dom";
import { Bot, Circle, CircleDot, FileClock, FolderOpen } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useTabStore } from "@/lib/stores/tab-store";
import { workspacePath } from "@/lib/paths";
import { abbreviatePath } from "@/lib/agent-forms";
import { formatAge } from "@/lib/utils";
import {
  agentHistoryRowState,
  isAgentHistoryRowOpenable,
  sortAgentHistory,
} from "@/lib/agent-activity";
import { useRecentAgentSessions, type RecentAgentSession } from "@/hooks/use-agents";

/**
 * What the row says about the session's state, in the same vocabulary the rail
 * uses (`sidebar-agents.tsx`'s `SessionIndicator`) so the two never disagree
 * about what "idle" or "needs input" means. The presentation differs on
 * purpose: this list is full-width and the rail is a narrow column.
 */
function SessionStatus({ session }: { session: RecentAgentSession }) {
  if (session.status === "exited") {
    return (
      <Badge
        variant={session.exitCode === 0 ? "secondary" : "destructive"}
        className="shrink-0"
      >
        exit {session.exitCode ?? "?"}
      </Badge>
    );
  }

  if (session.activity === "waiting" && session.waitingConfidence === "high") {
    return (
      <Badge variant="warning" className="shrink-0" title="A known prompt pattern matched">
        <CircleDot className="h-3 w-3 mr-1" />
        needs input
      </Badge>
    );
  }

  if (session.activity === "waiting") {
    return (
      <Badge
        variant="outline"
        className="shrink-0 text-muted-foreground"
        title="Quiet for a while. May be waiting on you, or just running a long build."
      >
        <Circle className="h-3 w-3 mr-1" />
        idle
      </Badge>
    );
  }

  // `working`, and also a backend too old to report `activity` at all — both
  // are honestly described as "running".
  return (
    <Badge variant="success" className="shrink-0">
      <CircleDot className="h-3 w-3 mr-1" />
      {session.activity === "working" ? "working" : "running"}
    </Badge>
  );
}

function SessionRow({ session }: { session: RecentAgentSession }) {
  const navigate = useNavigate();
  const { openTab } = useTabStore();

  const state = agentHistoryRowState(session);
  const openable = isAgentHistoryRowOpenable(session);

  const open = () => {
    if (!openable) return;
    // ONE href for both calls, and `openTab` before `navigate` — see
    // `sidebar-agents.tsx`'s `openSessionTab`. Registering the tab without
    // routing to it leaves a tab the user cannot reach.
    const href = workspacePath(session.workspaceId, "agents/" + session.id);
    openTab(session.workspaceId, href, session.title, "agent", { sessionId: session.id });
    navigate(href);
  };

  const body = (
    <>
      <Bot
        className={
          openable
            ? "h-4 w-4 shrink-0 text-muted-foreground"
            : "h-4 w-4 shrink-0 text-muted-foreground/40"
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium" title={session.title}>
            {session.title}
          </span>
          <Badge variant="secondary" className="shrink-0 max-w-40">
            <FolderOpen className="h-3 w-3 mr-1 shrink-0" />
            <span className="truncate">{session.workspaceName}</span>
          </Badge>
        </div>
        {/* Older rows carry no cwd at all — show nothing rather than guess. */}
        {session.cwd && (
          <div
            className="truncate font-mono text-[11px] text-muted-foreground/80"
            title={session.cwd}
          >
            {abbreviatePath(session.cwd)}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {state === "archived" && (
          <Badge
            variant="outline"
            className="text-muted-foreground"
            title="This session has ended. Opening it replays its saved transcript."
          >
            <FileClock className="h-3 w-3 mr-1" />
            transcript
          </Badge>
        )}
        {state === "unavailable" && (
          <Badge
            variant="outline"
            className="text-muted-foreground/70"
            title="This session ended before its output was saved, so there is nothing left to show."
          >
            no transcript
          </Badge>
        )}
        <SessionStatus session={session} />
        <span className="w-14 text-right text-xs text-muted-foreground">
          {formatAge(session.lastActivityAt ?? session.createdAt)} ago
        </span>
      </div>
    </>
  );

  // An unavailable session is deliberately NOT a button: opening it would show
  // an empty terminal, which reads as a bug rather than as an old session.
  if (!openable) {
    return (
      <div
        aria-disabled="true"
        className="flex items-center gap-3 px-4 py-2.5 text-sm opacity-60"
        title="This session's output was not saved, so it can no longer be opened."
      >
        {body}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      }}
      className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
    >
      {body}
    </div>
  );
}

/**
 * Every workspace's agent sessions on one homepage list.
 *
 * Sessions are otherwise listable only per workspace, so an agent that ran
 * overnight somewhere else is invisible from here — and since transcripts now
 * survive a restart, what it did is still readable. This list is what makes
 * that discoverable.
 *
 * Running sessions sort first: "an agent is waiting for me somewhere" is the
 * most actionable thing the homepage can say, and it complements the rail
 * badge, which is only visible once you are already inside a workspace.
 */
export function AgentHistory() {
  const { data: sessions, isLoading, error } = useRecentAgentSessions();
  const ordered = sortAgentHistory(sessions);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent agents</h2>
        {ordered.length > 0 && <Badge variant="secondary">{ordered.length}</Badge>}
      </div>

      {isLoading && <Skeleton className="h-24" />}

      {error && (
        <p className="text-sm text-muted-foreground">
          Couldn’t load recent agents: {(error as Error).message}
        </p>
      )}

      {!isLoading && !error && ordered.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No agents have run yet. Start one from a workspace’s Agents panel and it will
          show up here.
        </p>
      )}

      {ordered.length > 0 && (
        <Card>
          <CardContent className="p-0 divide-y">
            {ordered.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
