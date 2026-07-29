import { describe, it, expect } from "vitest";
import {
  abbreviatePath,
  argsToLines,
  envToLines,
  parseArgLines,
  parseEnvLines,
  parsePatternLines,
  patternsToLines,
} from "./agent-forms";

describe("parseArgLines", () => {
  it("returns one argument per line", () => {
    expect(parseArgLines("--model\nopus")).toEqual(["--model", "opus"]);
  });

  it("keeps a line with an interior space as ONE argument", () => {
    // The malformed case the UI warns about — it must be passed through as
    // typed, not silently split, or the warning would be a lie.
    expect(parseArgLines("--model opus")).toEqual(["--model opus"]);
  });

  it("drops blank and whitespace-only lines", () => {
    expect(parseArgLines("--a\n\n   \n--b\n")).toEqual(["--a", "--b"]);
  });

  it("trims surrounding whitespace on each line", () => {
    expect(parseArgLines("  --a  \n\t--b")).toEqual(["--a", "--b"]);
  });

  it("tolerates CRLF", () => {
    expect(parseArgLines("--a\r\n--b\r\n")).toEqual(["--a", "--b"]);
  });

  it("returns an empty array for empty text", () => {
    expect(parseArgLines("")).toEqual([]);
    expect(parseArgLines("\n\n")).toEqual([]);
  });
});

describe("argsToLines", () => {
  it("treats null/undefined as no args", () => {
    expect(argsToLines(undefined)).toBe("");
    expect(argsToLines(null)).toBe("");
    expect(argsToLines([])).toBe("");
  });

  it("round-trips a realistic argument list", () => {
    const args = ["--model", "opus", "--dangerously-skip-permissions"];
    expect(parseArgLines(argsToLines(args))).toEqual(args);
  });

  it("round-trips an argument containing spaces", () => {
    const args = ["--system-prompt", "you are a helpful agent"];
    expect(parseArgLines(argsToLines(args))).toEqual(args);
  });
});

describe("parsePatternLines", () => {
  it("preserves a significant trailing space", () => {
    // Prompt regexes routinely end in "\\s" or a literal space; trimming would
    // turn a working pattern into one that never matches.
    expect(parsePatternLines("Continue\\? $")).toEqual(["Continue\\? $"]);
  });

  it("drops blank lines but keeps whitespace inside kept lines", () => {
    expect(parsePatternLines("> $\n\n   \n\\? $")).toEqual(["> $", "\\? $"]);
  });

  it("tolerates CRLF", () => {
    expect(parsePatternLines("> $\r\n\\? $\r\n")).toEqual(["> $", "\\? $"]);
  });

  it("round-trips through patternsToLines", () => {
    const patterns = ["Continue\\? $", "\\(y/n\\)\\s*$", "> "];
    expect(parsePatternLines(patternsToLines(patterns))).toEqual(patterns);
  });

  it("treats null/undefined as no patterns", () => {
    expect(patternsToLines(undefined)).toBe("");
    expect(patternsToLines(null)).toBe("");
  });
});

describe("parseEnvLines", () => {
  it("parses KEY=VALUE per line", () => {
    expect(parseEnvLines("FOO=bar\nBAZ=qux")).toEqual({
      ok: true,
      value: { FOO: "bar", BAZ: "qux" },
    });
  });

  it("splits at the first = so values may contain more", () => {
    expect(parseEnvLines("ARGS=--flag=1")).toEqual({
      ok: true,
      value: { ARGS: "--flag=1" },
    });
  });

  it("trims around the key and the value", () => {
    expect(parseEnvLines("  FOO = bar  ")).toEqual({ ok: true, value: { FOO: "bar" } });
  });

  it("accepts an empty value", () => {
    expect(parseEnvLines("FOO=")).toEqual({ ok: true, value: { FOO: "" } });
  });

  it("skips blank lines and tolerates CRLF", () => {
    expect(parseEnvLines("FOO=bar\r\n\n   \nBAZ=qux\r\n")).toEqual({
      ok: true,
      value: { FOO: "bar", BAZ: "qux" },
    });
  });

  it("lets a later duplicate key win", () => {
    expect(parseEnvLines("FOO=one\nFOO=two")).toEqual({ ok: true, value: { FOO: "two" } });
  });

  it("rejects a line with no =, naming the line number", () => {
    const result = parseEnvLines("FOO=bar\nNOPE");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Line 2");
      expect(result.error).toContain("KEY=VALUE");
    }
  });

  it("rejects a missing key", () => {
    const result = parseEnvLines("=bar");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Line 1");
  });

  it("returns an empty map for empty text", () => {
    expect(parseEnvLines("")).toEqual({ ok: true, value: {} });
  });
});

describe("envToLines", () => {
  it("treats null/undefined as no env", () => {
    expect(envToLines(undefined)).toBe("");
    expect(envToLines(null)).toBe("");
    expect(envToLines({})).toBe("");
  });

  it("sorts by key so the field does not reshuffle between opens", () => {
    expect(envToLines({ ZED: "1", ALPHA: "2" })).toBe("ALPHA=2\nZED=1");
  });

  it("round-trips", () => {
    const env = { ANTHROPIC_MODEL: "opus", NO_COLOR: "1" };
    const lines = envToLines(env);
    expect(parseEnvLines(lines)).toEqual({ ok: true, value: env });
  });
});

describe("abbreviatePath", () => {
  it("returns an empty string for a missing path", () => {
    expect(abbreviatePath(undefined)).toBe("");
    expect(abbreviatePath(null)).toBe("");
    expect(abbreviatePath("")).toBe("");
  });

  it("leaves a short path alone", () => {
    expect(abbreviatePath("/tmp")).toBe("/tmp");
    expect(abbreviatePath("/var/log")).toBe("/var/log");
  });

  it("keeps the trailing segments of a long path", () => {
    expect(abbreviatePath("/Users/me/code/klustreye")).toBe("…/code/klustreye");
  });

  it("honours a custom segment count", () => {
    expect(abbreviatePath("/Users/me/code/klustreye", 3)).toBe("…/me/code/klustreye");
  });

  it("strips a trailing slash without eating the root", () => {
    expect(abbreviatePath("/Users/me/code/klustreye/")).toBe("…/code/klustreye");
    expect(abbreviatePath("/")).toBe("/");
  });

  it("handles a relative path", () => {
    expect(abbreviatePath("code/klustreye")).toBe("code/klustreye");
    expect(abbreviatePath("a/b/c/d")).toBe("…/c/d");
  });
});
