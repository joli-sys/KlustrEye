import { describe, it, expect } from "vitest";

import {
  parentDir,
  parseWatchEvent,
  reconnectDelayMs,
  shouldReconnect,
} from "./use-file-watch";

describe("parentDir", () => {
  it("returns the containing directory", () => {
    expect(parentDir("src/hooks/use-files.ts")).toBe("src/hooks");
    expect(parentDir("src/main.tsx")).toBe("src");
  });

  // The root listing is keyed by "" in use-files.ts — anything else would
  // invalidate a query that does not exist and leave the tree stale.
  it("maps a top-level path to the workspace root key", () => {
    expect(parentDir("README.md")).toBe("");
  });
});

describe("parseWatchEvent", () => {
  it("accepts the three change kinds", () => {
    expect(parseWatchEvent('{"kind":"created","path":"a.txt"}')).toEqual({
      kind: "created",
      path: "a.txt",
    });
    expect(parseWatchEvent('{"kind":"modified","path":"src/a.ts"}')).toEqual({
      kind: "modified",
      path: "src/a.ts",
    });
    expect(parseWatchEvent('{"kind":"removed","path":"a.txt"}')).toEqual({
      kind: "removed",
      path: "a.txt",
    });
  });

  // The backend sends this before closing a socket it cannot serve; treating
  // it as a change would invalidate the root listing for no reason.
  it("rejects the error frame", () => {
    expect(
      parseWatchEvent('{"kind":"error","message":"workspace has no folder bound"}')
    ).toBeNull();
  });

  it("rejects malformed frames rather than throwing", () => {
    expect(parseWatchEvent("not json")).toBeNull();
    expect(parseWatchEvent("null")).toBeNull();
    expect(parseWatchEvent('{"kind":"created"}')).toBeNull();
    expect(parseWatchEvent('{"kind":"created","path":""}')).toBeNull();
    expect(parseWatchEvent('{"path":"a.txt"}')).toBeNull();
    expect(parseWatchEvent(new ArrayBuffer(4))).toBeNull();
  });
});

describe("shouldReconnect", () => {
  it("retries transport drops", () => {
    expect(shouldReconnect(1006)).toBe(true);
    expect(shouldReconnect(1001)).toBe(true);
  });

  // 4001 means the workspace can never be watched; retrying spins forever.
  it("gives up on application close codes", () => {
    expect(shouldReconnect(4001)).toBe(false);
  });
});

describe("reconnectDelayMs", () => {
  it("backs off exponentially and then caps", () => {
    expect(reconnectDelayMs(0)).toBe(1000);
    expect(reconnectDelayMs(1)).toBe(2000);
    expect(reconnectDelayMs(4)).toBe(16000);
    expect(reconnectDelayMs(20)).toBe(30000);
  });
});
