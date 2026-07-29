import type { AgentSession } from "@/hooks/use-agents";

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
