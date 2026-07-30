import { describe, it, expect } from "vitest";
import { errorText } from "./folder-picker";

// Tauri's IPC rejects with a plain string, not an Error. Reading `.message`
// produced the literal toast "undefined You can still type an absolute path…",
// which told the user nothing about what actually failed.
describe("errorText", () => {
  it("returns a thrown string as-is", () => {
    expect(errorText("dialog.open not allowed")).toBe("dialog.open not allowed");
  });

  it("reads Error.message", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  it("reads a message property off a plain object", () => {
    expect(errorText({ message: "nope" })).toBe("nope");
  });

  it("falls back to JSON for an object with no message", () => {
    expect(errorText({ code: 42 })).toBe('{"code":42}');
  });

  it("never returns undefined for values with no detail", () => {
    for (const v of [undefined, null, "", "   ", {}, 0]) {
      const out = errorText(v);
      expect(typeof out).toBe("string");
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain("undefined");
    }
  });

  it("survives a circular object", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(typeof errorText(a)).toBe("string");
  });
});
