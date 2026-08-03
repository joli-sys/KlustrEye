import { describe, it, expect } from "vitest";
import {
  baseName,
  canSubmitEntryName,
  joinPath,
  validateEntryName,
} from "./new-entry";

describe("joinPath", () => {
  it("omits the separator at the workspace root", () => {
    expect(joinPath("", "notes.md")).toBe("notes.md");
  });

  it("joins under a parent directory", () => {
    expect(joinPath("src/lib", "util.ts")).toBe("src/lib/util.ts");
  });

  it("trims surrounding whitespace from the typed name", () => {
    expect(joinPath("src", "  util.ts  ")).toBe("src/util.ts");
  });

  it("keeps a nested name, which creates the intermediate directories", () => {
    expect(joinPath("src", "lib/deep/util.ts")).toBe("src/lib/deep/util.ts");
  });

  it("drops a trailing slash so a folder name does not double it", () => {
    expect(joinPath("src", "lib/")).toBe("src/lib");
    expect(joinPath("", "lib///")).toBe("lib");
  });
});

describe("baseName", () => {
  it("returns the last segment", () => {
    expect(baseName("src/lib/util.ts")).toBe("util.ts");
    expect(baseName("notes.md")).toBe("notes.md");
  });

  it("ignores a trailing slash", () => {
    expect(baseName("src/lib/")).toBe("lib");
  });
});

describe("validateEntryName", () => {
  it("accepts an ordinary name", () => {
    expect(validateEntryName("main.tf")).toBeNull();
    expect(validateEntryName("src/lib/util.ts")).toBeNull();
  });

  /**
   * Blank means the user changed their mind. Reporting it as an error would
   * put a destructive toast on screen for pressing Escape's slower cousin.
   */
  it("treats a blank name as 'nothing to say', not an error", () => {
    expect(validateEntryName("")).toBeNull();
    expect(validateEntryName("   ")).toBeNull();
  });

  it("rejects a leading slash rather than silently reinterpreting it", () => {
    expect(validateEntryName("/etc/passwd")).toMatch(/relative/i);
  });

  it("rejects traversal segments with an explanation, not a 400", () => {
    expect(validateEntryName("../outside.txt")).toMatch(/can’t be used/i);
    expect(validateEntryName("src/../../outside.txt")).toMatch(/can’t be used/i);
    expect(validateEntryName("./here.txt")).toMatch(/can’t be used/i);
  });

  it("rejects an empty path segment", () => {
    expect(validateEntryName("src//util.ts")).toMatch(/empty path segment/i);
  });
});

describe("canSubmitEntryName", () => {
  it("requires a non-blank, valid name", () => {
    expect(canSubmitEntryName("util.ts")).toBe(true);
    expect(canSubmitEntryName("")).toBe(false);
    expect(canSubmitEntryName("   ")).toBe(false);
    expect(canSubmitEntryName("../nope")).toBe(false);
  });
});
