import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  sortOrder: number;
  builtIn: boolean;
}

export type AgentSessionStatus = "running" | "exited";

export interface AgentSession {
  id: string;
  workspaceId: string;
  definitionId: string | null;
  title: string;
  status: AgentSessionStatus;
  exitCode: number | null;
  createdAt: string;
  lastActivityAt: string | null;
  exitedAt: string | null;
}

/** The registry of external CLI coding agents. Changes only when the user
 *  edits it, so unlike sessions it does not need to poll. */
export function useAgentDefinitions() {
  return useQuery<AgentDefinition[]>({
    queryKey: ["agent-definitions"],
    refetchInterval: false,
    queryFn: async () => {
      const res = await fetch("/api/agent-definitions");
      if (!res.ok) throw new Error("Failed to fetch agent definitions");
      return res.json();
    },
  });
}

/**
 * A workspace's agent sessions, newest first (server-ordered).
 *
 * Polls every 5s — the global 15s default (`providers.tsx`) reads a running
 * process as too stale to feel live, and anything faster is wasted while the
 * panel sits unwatched. Set explicitly so the interval is a deliberate choice
 * rather than an inherited default.
 */
export function useAgentSessions(wsId: string | undefined) {
  return useQuery<AgentSession[]>({
    queryKey: ["agent-sessions", wsId],
    enabled: !!wsId,
    refetchInterval: 5_000,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId!)}/agent-sessions`);
      if (!res.ok) throw new Error("Failed to fetch agent sessions");
      return res.json();
    },
  });
}

/**
 * Thrown by `useCreateAgentSession` on any non-OK response. `status` lets
 * callers tell "no folder bound" (400) apart from "too many live sessions"
 * (429) — a plain `Error` cannot distinguish them, and each needs its own copy.
 */
export class AgentSessionError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AgentSessionError";
    this.status = status;
  }
}

export function useCreateAgentSession(wsId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { definitionId: string; title?: string }): Promise<AgentSession> => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId!)}/agent-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AgentSessionError(
          body.error || "Failed to create agent session",
          res.status
        );
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-sessions", wsId] });
    },
  });
}

export function useKillAgentSession(wsId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/agent-sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to kill agent session");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-sessions", wsId] });
    },
  });
}
