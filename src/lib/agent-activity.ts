import type { AgentSession, RecentAgentSession } from "@/hooks/use-agents";

/**
 * Pure derivations over `AgentSession.activity`/`waitingConfidence` — the
 * heuristic liveness fields the backend attaches to each session. Split out
 * of the sidebar so they can be unit-tested without mounting a component
 * (vitest has no DOM harness in this repo).
 */

/**
 * A session only counts as "needs you" when the backend matched a known
 * prompt pattern. Falling back to plain `waiting` would light the rail badge
 * for a session that's merely quiet (e.g. mid-build) and make it permanently
 * lit, and therefore useless.
 */
export function isHighConfidenceWaiting(
  session: Pick<AgentSession, "activity" | "waitingConfidence">
): boolean {
  return session.activity === "waiting" && session.waitingConfidence === "high";
}

/** Count of sessions actually needing the user's attention. */
export function waitingCount(sessions: AgentSession[] | undefined): number {
  return (sessions ?? []).filter(isHighConfidenceWaiting).length;
}

/**
 * Sessions that just transitioned INTO high-confidence waiting between two
 * polls — the set to notify about, not the set currently waiting.
 *
 * - A session already high-confidence-waiting in `prev` is excluded, so it
 *   doesn't re-fire on every poll (the sessions query refetches every 5s).
 * - A session missing from `next` (killed, or otherwise dropped off the
 *   list) is excluded too, since only `next` is iterated.
 * - A session with no entry in `prev` (just appeared) is treated as a
 *   transition: from the caller's point of view it is new information
 *   either way. Callers that only want transitions observed live (not ones
 *   already true when polling started) should seed `prev` on their first
 *   poll and skip diffing until the next one.
 */
export function newlyWaiting(
  prev: AgentSession[] | undefined,
  next: AgentSession[] | undefined
): AgentSession[] {
  const prevById = new Map((prev ?? []).map((s) => [s.id, s]));
  return (next ?? []).filter((session) => {
    if (!isHighConfidenceWaiting(session)) return false;
    const before = prevById.get(session.id);
    return !before || !isHighConfidenceWaiting(before);
  });
}

/**
 * What a history row can offer the user:
 *
 * - `live` — still running, opens onto the real PTY.
 * - `archived` — exited, but its transcript was kept, so opening it replays
 *   what the agent did.
 * - `unavailable` — exited with no transcript (it predates transcript
 *   persistence, or the file was pruned). Opening one shows an empty
 *   terminal, which reads as a bug, so the row must not be clickable.
 *
 * A missing `hasTranscript` (older backend) resolves to `unavailable`: the
 * honest answer for a field we cannot see is "cannot promise a transcript".
 */
export type AgentHistoryRowState = "live" | "archived" | "unavailable";

export function agentHistoryRowState(
  session: Pick<AgentSession, "status" | "hasTranscript">
): AgentHistoryRowState {
  if (session.status !== "exited") return "live";
  return session.hasTranscript ? "archived" : "unavailable";
}

// "unavailable" labels a row, it does not disable one. Every history row opens:
// the session view explains an absent transcript itself (ws/agent.rs sends a
// GONE_NOTICE), and a row that refuses to respond is worse than one that opens
// and says why it is empty.

/** The timestamp a history row is ordered and dated by. */
function recencyKey(session: Pick<AgentSession, "createdAt" | "lastActivityAt">): string {
  return session.lastActivityAt ?? session.createdAt;
}

/**
 * Running sessions first, then most recently active first.
 *
 * "An agent is waiting for me somewhere" is the most actionable thing this
 * list can say, and a live session is the only row where clicking leads to
 * something the user can still act on — so it outranks a transcript that
 * happens to be newer.
 *
 * Timestamps are compared as STRINGS, not `Date`s. Every one of them is a
 * SQLite `datetime('now')` value (`YYYY-MM-DD HH:MM:SS`, UTC), a format that
 * sorts identically lexicographically and numerically — whereas
 * `new Date("2026-07-29 15:20:23")` is parsed as LOCAL time by browsers, which
 * would shift every row by the UTC offset. Since the shift is uniform it would
 * not visibly reorder anything, which is exactly why it is worth avoiding
 * here rather than discovering later.
 *
 * Returns a new array; the input is not mutated. Ties keep the server's order,
 * `Array.prototype.sort` being stable.
 */
export function sortAgentHistory(
  sessions: RecentAgentSession[] | undefined
): RecentAgentSession[] {
  return [...(sessions ?? [])].sort((a, b) => {
    const aLive = a.status !== "exited";
    const bLive = b.status !== "exited";
    if (aLive !== bLive) return aLive ? -1 : 1;
    return recencyKey(b).localeCompare(recencyKey(a));
  });
}
