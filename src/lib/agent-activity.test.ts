import { describe, it, expect } from "vitest";
import type { AgentSession } from "@/hooks/use-agents";
import { isHighConfidenceWaiting, newlyWaiting, waitingCount } from "./agent-activity";

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
