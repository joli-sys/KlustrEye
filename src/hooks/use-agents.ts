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
   * Whether a stored transcript exists for this session. It is what separates
   * an exited session that still opens and replays what it did from one that
   * would open an empty terminal — sessions predating transcript persistence,
   * or whose file has been pruned. Optional for the same reason as `activity`,
   * and absence must be read as "no transcript", never as "probably fine".
   */
  hasTranscript?: boolean;
  /**
   * How far a seeded prompt got — see {@link SeedStatus}. `"none"` for an
   * ordinary session started from the sidebar.
   *
   * Optional for the same reason as `activity`, and its absence means "this
   * backend cannot tell me", which is NOT the same as "delivered": a reader
   * that treats a missing field as success would claim a prompt landed when it
   * has no idea.
   */
  seedStatus?: SeedStatus;
  /**
   * Optional: a client talking to an older/rolling-out backend may not see
   * these fields at all, so every reader must treat their absence as
   * "unknown" rather than assume a shape that isn't there.
   */
  activity?: AgentActivity;
  waitingConfidence?: WaitingConfidence;
}

/**
 * How far a session's primed prompt got.
 *
 * The backend does not write the prompt into the PTY until the agent has
 * finished booting and gone quiet, so delivery is genuinely uncertain for the
 * first seconds of a session and can fail outright:
 *
 * - `none` — nothing was seeded; an ordinary session.
 * - `pending` — composed, waiting for the agent to be ready. Not yet delivered.
 * - `sent` — written to the terminal.
 * - `timed_out` — the agent never became ready within 30s. The session works;
 *   only the prompt is missing, and the user has to paste it themselves.
 * - `failed` — the process exited before it was ready, or the write failed.
 */
export type SeedStatus = "none" | "pending" | "sent" | "timed_out" | "failed";

/**
 * A session listed outside its own workspace, so it carries the workspace's
 * name — an id alone tells the user nothing about where the agent ran.
 */
export interface RecentAgentSession extends AgentSession {
  workspaceName: string;
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
 * Sessions from EVERY workspace, for the homepage history list — the only
 * place a session that ran overnight in some other workspace is discoverable
 * at all, since `useAgentSessions` can only answer per workspace.
 *
 * Polls every 10s, set explicitly rather than inheriting the global 15s
 * (`providers.tsx`): the homepage is where a "running" badge for a session
 * that has since exited is most misleading, because there is no terminal on
 * screen to contradict it.
 *
 * The server decides how many rows come back (20, capped at 100), so the key
 * carries no page size and cannot go stale against one.
 */
export function useRecentAgentSessions() {
  return useQuery<RecentAgentSession[]>({
    queryKey: ["agent-sessions", "recent"],
    refetchInterval: 10_000,
    queryFn: async () => {
      const res = await fetch("/api/agent-sessions/recent");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to fetch recent agent sessions");
      }
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

/** One file placed beside a seeded session for the agent to read. */
export interface AgentSessionAttachment {
  /**
   * A SUGGESTION, not a filename: the backend sanitizes it and prefixes an
   * ordinal. `agent-dispatch.ts` sanitizes it client-side too, so the name the
   * user was shown is the name they get.
   */
  name: string;
  content: string;
}

export interface CreateAgentSessionInput {
  definitionId: string;
  title?: string;
  /** Omit to run in the workspace's bound folder. */
  cwd?: string;
  /**
   * The task to prime the agent with. The backend writes it to the PTY only
   * once the agent is at a prompt, and reports the outcome as
   * {@link SeedStatus} — sending this does not mean it arrives.
   */
  initialPrompt?: string;
  /**
   * Context the prompt is about. Written to FILES under the app-data directory
   * (never into the user's repo) whose absolute paths the backend appends to
   * `initialPrompt`; a terminal cannot take a megabyte paste reliably. Over the
   * per-session byte budget the request fails with 413.
   */
  attachments?: AgentSessionAttachment[];
}

export function useCreateAgentSession(wsId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateAgentSessionInput): Promise<AgentSession> => {
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
 * Watches a just-created session until its primed prompt has either been
 * delivered or definitively has not.
 *
 * A plain function rather than a hook on purpose. Dispatching from a Kubernetes
 * view navigates straight to the session's tab, so the component that started
 * the session unmounts within a frame — a `useQuery` watching for the outcome
 * would be torn down before the backend's 30s readiness window even closes.
 * The caller keeps its `addToast` closure, whose provider is still mounted.
 *
 * Resolves with the settled status, or `null` when there is nothing honest to
 * say: the backend does not report the field, or the session is gone. `null`
 * must NOT be reported as success.
 */
export async function waitForSeedStatus(
  wsId: string,
  sessionId: string,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<SeedStatus | null> {
  // Comfortably past the backend's 30s readiness timeout, so a `timed_out`
  // that IS coming is seen rather than reported as "still pending".
  const timeoutMs = options.timeoutMs ?? 45_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  // The list endpoint is the only reader of `seedStatus` — there is no
  // GET /api/agent-sessions/:id — so this costs one workspace list per poll,
  // the same request the sidebar already makes every 5s.
  for (;;) {
    let sessions: AgentSession[];
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/agent-sessions`);
      if (!res.ok) return null;
      sessions = await res.json();
    } catch {
      // Offline, or the server went away. Nothing truthful to report.
      return null;
    }

    const session = sessions.find((s) => s.id === sessionId);
    // Vanished (killed, or pruned) — no outcome to report.
    if (!session) return null;
    if (session.seedStatus === undefined) return null;
    if (session.seedStatus !== "pending") return session.seedStatus;

    if (Date.now() + intervalMs > deadline) return session.seedStatus;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
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
