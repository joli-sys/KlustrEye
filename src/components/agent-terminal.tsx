import { lazy, Suspense, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { cn } from "@/lib/utils";

const TerminalComponent = lazy(() =>
  import("./terminal-inner").then((m) => ({ default: m.TerminalInner }))
);

/**
 * The fields of an agent session this view actually reads.
 *
 * Deliberately a local shape rather than a shared one: everything here comes
 * from `GET /api/workspaces/:wsId/agent-sessions`, and the query key matches
 * the sidebar's, so the two share one cache entry without sharing a module.
 */
interface AgentSession {
  id: string;
  title: string;
  status: string;
  exitCode: number | null;
}

/**
 * Built from `window.location.host`, never from the current pathname.
 *
 * The page is served from the same origin as the backend, so the host is the
 * one thing that is always right; deriving a socket URL from the route would
 * make it depend on which workspace tab happens to be open.
 */
function agentWsUrl(sessionId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/agent/${encodeURIComponent(sessionId)}`;
}

/**
 * One agent session's PTY, attached over `/ws/agent/:session_id`.
 *
 * Attaching replays the session's scrollback and then streams live output, and
 * detaching leaves the process running — so unmounting this route, or closing
 * the tab that holds it, is not a way to stop an agent. Killing one is the
 * sidebar's job.
 */
export function AgentTerminal() {
  const wsId = useWorkspaceId();
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const frameRef = useRef<HTMLDivElement>(null);

  const { data: sessions, isLoading, isError, error } = useQuery<AgentSession[]>({
    queryKey: ["agent-sessions", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/agent-sessions`
      );
      if (!res.ok) throw new Error("Failed to fetch agent sessions");
      return res.json();
    },
    // An exit arrives down the socket as a notice, not as a status change this
    // query would notice, so poll while the session is alive and stop the
    // moment it is not — an exited session's row never changes again.
    refetchInterval: (query) =>
      query.state.data?.some((s) => s.id === sessionId && s.status === "running")
        ? 5000
        : false,
  });

  const session = sessions?.find((s) => s.id === sessionId);
  const exited = session !== undefined && session.status !== "running";

  /**
   * An exited session's PTY is gone: what is on screen is a transcript, not a
   * prompt. xterm has no way to know that, so keystrokes would still travel
   * down the socket and disappear.
   *
   * Blocked in the CAPTURE phase on the wrapper, with a native listener: xterm
   * reads input from a helper textarea it owns, and stopping the event before
   * it reaches that element is the only way to disarm it from outside the
   * component. Modifier combos are let through so copy and select-all still
   * work on the scrollback, which is the entire reason to open a dead session.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !exited) return;
    const block = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
    };
    frame.addEventListener("keydown", block, true);
    return () => frame.removeEventListener("keydown", block, true);
  }, [exited]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Centered
        title="Could not load this agent session"
        detail={error instanceof Error ? error.message : sessionId}
      />
    );
  }

  if (!session) {
    return (
      <Centered
        title="This agent session no longer exists"
        detail={sessionId}
        note="Its record was removed. Start a new session from the Agents panel."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate text-xs font-medium">{session.title}</span>
        {exited ? (
          <Badge variant="secondary">{exitLabel(session.exitCode)}</Badge>
        ) : (
          <Badge variant="success" className="gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running
          </Badge>
        )}
        <div className="flex-1" />
        {exited && (
          <span className="text-xs text-muted-foreground">
            Read-only — this session has ended
          </span>
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {session.id}
        </span>
      </div>

      <div
        ref={frameRef}
        aria-readonly={exited || undefined}
        className={cn(
          "min-h-0 flex-1 bg-black",
          // Not decoration: the dashed rule is the only thing on screen once
          // the header scrolls out of a small pane that says this terminal
          // takes no input.
          exited && "border-t-2 border-dashed border-muted-foreground/40"
        )}
      >
        <Suspense fallback={<Skeleton className="h-full w-full" />}>
          <TerminalComponent
            wsUrl={agentWsUrl(sessionId)}
            className="h-full"
            // The backend opens with the scrollback replay; a "Connected"
            // banner would be written on top of the agent's own first line.
            connectMessage=""
          />
        </Suspense>
      </div>
    </div>
  );
}

/** `exitCode` is null for a session killed by a signal — say so, don't guess. */
function exitLabel(exitCode: number | null): string {
  return exitCode === null || exitCode === undefined
    ? "Exited"
    : `Exited (code ${exitCode})`;
}

function Centered({
  title,
  detail,
  note,
}: {
  title: string;
  detail?: string;
  note?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <AlertTriangle className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {detail && (
        <p className="max-w-lg break-all font-mono text-xs text-muted-foreground">
          {detail}
        </p>
      )}
      {note && <p className="max-w-lg text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
