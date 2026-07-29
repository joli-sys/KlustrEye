import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /**
   * Regexes that mark a session "needs input" with high confidence when one
   * matches its recent output. Optional for the same reason as
   * `AgentSession.activity`: a client may be talking to a backend that
   * predates the field, and TypeScript would not catch its absence.
   */
  promptPatterns?: string[];
  sortOrder: number;
  builtIn: boolean;
}

/** The editable half of a definition — everything the API accepts on write. */
export interface AgentDefinitionInput {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  promptPatterns: string[];
}

export type AgentSessionStatus = "running" | "exited";

/**
 * A heuristic liveness signal, distinct from `status`: `working` means the
 * process produced output within the last ~1.5s, `waiting` means it is alive
 * but quiet — which a long silent build also looks like. Never certainty,
 * so UI copy must stay hedged (see `waitingConfidence`).
 */
export type AgentActivity = "working" | "waiting" | "exited";

/** "high" = a known prompt pattern matched the session's recent output. */
export type WaitingConfidence = "high" | "low" | null;

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
  /**
   * Where the agent process was started. `null` for rows written before
   * per-session working directories existed — those ran in their workspace's
   * folder, which cannot be reconstructed after the fact, so the UI shows
   * nothing rather than guessing.
   */
  cwd?: string | null;
  /**
   * True once the user has renamed the session, after which the backend stops
   * auto-titling it from output. Read-only here — the client never re-titles.
   */
  titleIsCustom?: boolean;
  /**
   * Optional: a client talking to an older/rolling-out backend may not see
   * these fields at all, so every reader must treat their absence as
   * "unknown" rather than assume a shape that isn't there.
   */
  activity?: AgentActivity;
  waitingConfidence?: WaitingConfidence;
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
 * The definition endpoints answer a 400 with `{ error }` naming the offending
 * field ("args must be an array of strings", "invalid prompt pattern '…'").
 * That message is more useful than anything the client could invent, so it is
 * thrown verbatim for the caller to show as-is.
 */
async function definitionRequest(
  url: string,
  init: RequestInit,
  fallback: string
): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || fallback);
  }
  return res.json();
}

const definitionWrite = (body: AgentDefinitionInput): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function useCreateAgentDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentDefinitionInput) =>
      definitionRequest(
        "/api/agent-definitions",
        { method: "POST", ...definitionWrite(input) },
        "Failed to create agent"
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-definitions"] });
    },
  });
}

export function useUpdateAgentDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AgentDefinitionInput & { id: string }) =>
      definitionRequest(
        `/api/agent-definitions/${encodeURIComponent(id)}`,
        { method: "PUT", ...definitionWrite(input) },
        "Failed to update agent"
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-definitions"] });
    },
  });
}

/**
 * Deletes a definition — including a built-in one, permanently. The startup
 * seed runs at most once (guarded by a marker row), so a deleted built-in does
 * NOT reappear on the next restart. The confirm copy has to say so.
 *
 * Running sessions are unaffected: a session keeps its own copy of the spawn
 * plan, and only new sessions need the definition.
 */
export function useDeleteAgentDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      definitionRequest(
        `/api/agent-definitions/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        "Failed to delete agent"
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-definitions"] });
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
    mutationFn: async (input: {
      definitionId: string;
      title?: string;
      /** Omit to run in the workspace's bound folder. */
      cwd?: string;
    }): Promise<AgentSession> => {
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


/**
 * Renames a session — permanently.
 *
 * The backend sets `title_is_custom` as part of this write, which is the whole
 * point: auto-titling from the agent's output gives the session up for good.
 * There is deliberately no client-side re-titling anywhere, so a name the user
 * chose can never drift back to whatever the agent last printed.
 *
 * Reuses `AgentSessionError` so callers can tell a rejected title (400) from a
 * session that has since vanished (404).
 */
export function useRenameAgentSession(wsId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; title: string }): Promise<AgentSession> => {
      const res = await fetch(`/api/agent-sessions/${encodeURIComponent(input.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: input.title }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new AgentSessionError(body.error || "Failed to rename session", res.status);
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
