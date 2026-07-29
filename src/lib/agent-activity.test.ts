import { describe, it, expect } from "vitest";
import type { AgentSession, RecentAgentSession } from "@/hooks/use-agents";
import {
  agentHistoryRowState,
  isAgentHistoryRowOpenable,
  isHighConfidenceWaiting,
  newlyWaiting,
  sortAgentHistory,
  waitingCount,
} from "./agent-activity";

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: "s1",
  workspaceId: "ws1",
  definitionId: "def1",
  title: "claude",
  status: "running",
  exitCode: null,
  createdAt: "2026-01-01T00:00:00Z",
  lastActivityAt: "2026-01-01T00:00:00Z",
  exitedAt: null,
  ...over,
});

describe("isHighConfidenceWaiting", () => {
  it("is true only for waiting + high", () => {
    expect(isHighConfidenceWaiting(session({ activity: "waiting", waitingConfidence: "high" }))).toBe(true);
  });
  it("is false for waiting + low", () => {
    expect(isHighConfidenceWaiting(session({ activity: "waiting", waitingConfidence: "low" }))).toBe(false);
  });
  it("is false for waiting + null confidence", () => {
    expect(isHighConfidenceWaiting(session({ activity: "waiting", waitingConfidence: null }))).toBe(false);
  });
  it("is false for working", () => {
    expect(isHighConfidenceWaiting(session({ activity: "working", waitingConfidence: "high" }))).toBe(false);
  });
  it("is false when activity is missing (older backend)", () => {
    expect(isHighConfidenceWaiting(session({ activity: undefined, waitingConfidence: undefined }))).toBe(false);
  });
});

describe("waitingCount", () => {
  it("counts only high-confidence waiters", () => {
    const sessions = [
      session({ id: "a", activity: "waiting", waitingConfidence: "high" }),
      session({ id: "b", activity: "waiting", waitingConfidence: "low" }),
      session({ id: "c", activity: "working" }),
      session({ id: "d", activity: "waiting", waitingConfidence: "high" }),
    ];
    expect(waitingCount(sessions)).toBe(2);
  });
  it("is 0 for an empty or undefined list", () => {
    expect(waitingCount([])).toBe(0);
    expect(waitingCount(undefined)).toBe(0);
  });
  it("does not fall back to plain 'waiting' — that would light the badge permanently", () => {
    const sessions = [session({ activity: "waiting", waitingConfidence: null })];
    expect(waitingCount(sessions)).toBe(0);
  });
});

describe("newlyWaiting", () => {
  it("includes a session transitioning from working to waiting/high", () => {
    const prev = [session({ id: "a", activity: "working" })];
    const next = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    expect(newlyWaiting(prev, next).map((s) => s.id)).toEqual(["a"]);
  });

  it("does not re-fire for a session already waiting/high in prev", () => {
    const prev = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    const next = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    expect(newlyWaiting(prev, next)).toEqual([]);
  });

  it("treats a brand-new session as a transition", () => {
    const prev: AgentSession[] = [];
    const next = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    expect(newlyWaiting(prev, next).map((s) => s.id)).toEqual(["a"]);
  });

  it("drops a session that disappeared between polls", () => {
    const prev = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    const next: AgentSession[] = [];
    expect(newlyWaiting(prev, next)).toEqual([]);
  });

  it("excludes low-confidence waiting even on a fresh transition", () => {
    const prev = [session({ id: "a", activity: "working" })];
    const next = [session({ id: "a", activity: "waiting", waitingConfidence: "low" })];
    expect(newlyWaiting(prev, next)).toEqual([]);
  });

  it("excludes a session that goes from high-confidence waiting back to working then waiting/high again only once per transition", () => {
    const prev = [session({ id: "a", activity: "working" })];
    const next = [session({ id: "a", activity: "waiting", waitingConfidence: "high" })];
    // First transition fires…
    expect(newlyWaiting(prev, next).map((s) => s.id)).toEqual(["a"]);
    // …but diffing the same state against itself does not.
    expect(newlyWaiting(next, next)).toEqual([]);
  });

  it("handles undefined prev and next", () => {
    expect(newlyWaiting(undefined, undefined)).toEqual([]);
    expect(newlyWaiting(undefined, [session({ activity: "waiting", waitingConfidence: "high" })]).length).toBe(1);
  });
});

const recent = (over: Partial<RecentAgentSession> = {}): RecentAgentSession => ({
  ...session(),
  workspaceName: "Alpha",
  ...over,
});

describe("agentHistoryRowState", () => {
  it("calls a running session live regardless of its transcript", () => {
    expect(agentHistoryRowState(recent({ status: "running" }))).toBe("live");
    expect(agentHistoryRowState(recent({ status: "running", hasTranscript: true }))).toBe("live");
  });

  it("calls an exited session with a transcript archived", () => {
    expect(agentHistoryRowState(recent({ status: "exited", hasTranscript: true }))).toBe(
      "archived"
    );
  });

  it("calls an exited session without a transcript unavailable", () => {
    expect(agentHistoryRowState(recent({ status: "exited", hasTranscript: false }))).toBe(
      "unavailable"
    );
  });

  it("treats a missing hasTranscript as unavailable, never as archived", () => {
    // An older backend omits the field entirely; promising a transcript we
    // cannot see would open an empty terminal, which reads as a bug.
    expect(agentHistoryRowState(recent({ status: "exited" }))).toBe("unavailable");
  });

  it("only refuses to open the unavailable case", () => {
    expect(isAgentHistoryRowOpenable(recent({ status: "running" }))).toBe(true);
    expect(isAgentHistoryRowOpenable(recent({ status: "exited", hasTranscript: true }))).toBe(true);
    expect(isAgentHistoryRowOpenable(recent({ status: "exited" }))).toBe(false);
  });
});

describe("sortAgentHistory", () => {
  it("puts running sessions ahead of exited ones even when far less recent", () => {
    const sorted = sortAgentHistory([
      recent({ id: "old-exit", status: "exited", lastActivityAt: "2026-07-29 12:00:00" }),
      recent({ id: "stale-live", status: "running", lastActivityAt: "2026-06-01 09:00:00" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["stale-live", "old-exit"]);
  });

  it("orders within each group by recency, newest first", () => {
    const sorted = sortAgentHistory([
      recent({ id: "e-old", status: "exited", lastActivityAt: "2026-07-01 10:00:00" }),
      recent({ id: "r-old", status: "running", lastActivityAt: "2026-07-02 10:00:00" }),
      recent({ id: "e-new", status: "exited", lastActivityAt: "2026-07-28 10:00:00" }),
      recent({ id: "r-new", status: "running", lastActivityAt: "2026-07-03 10:00:00" }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["r-new", "r-old", "e-new", "e-old"]);
  });

  it("falls back to createdAt when a session has never reported activity", () => {
    const sorted = sortAgentHistory([
      recent({
        id: "no-activity",
        status: "exited",
        createdAt: "2026-07-29 10:00:00",
        lastActivityAt: null,
      }),
      recent({
        id: "older",
        status: "exited",
        createdAt: "2026-07-01 10:00:00",
        lastActivityAt: "2026-07-02 10:00:00",
      }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["no-activity", "older"]);
  });

  it("keeps the server's order for rows that tie", () => {
    const at = "2026-07-29 10:00:00";
    const sorted = sortAgentHistory([
      recent({ id: "first", status: "exited", lastActivityAt: at }),
      recent({ id: "second", status: "exited", lastActivityAt: at }),
    ]);
    expect(sorted.map((s) => s.id)).toEqual(["first", "second"]);
  });

  it("does not mutate its input", () => {
    const input = [
      recent({ id: "a", status: "exited", lastActivityAt: "2026-07-01 10:00:00" }),
      recent({ id: "b", status: "running", lastActivityAt: "2026-06-01 10:00:00" }),
    ];
    sortAgentHistory(input);
    expect(input.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("handles undefined", () => {
    expect(sortAgentHistory(undefined)).toEqual([]);
  });
});
