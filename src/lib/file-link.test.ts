import { describe, expect, it } from "vitest";
import {
  findFileReferences,
  normalizePath,
  resolveFileReference,
  type FileReference,
} from "./file-link";

/** The shape assertions care about; `start`/`length` are checked separately. */
function found(text: string): Array<Omit<FileReference, "start" | "length">> {
  return findFileReferences(text).map(({ start: _s, length: _l, ...rest }) => rest);
}

function paths(text: string): string[] {
  return findFileReferences(text).map((r) => r.path);
}

describe("findFileReferences — supported shapes", () => {
  it("matches a relative path with a line", () => {
    expect(found("Updated src/lib/main.tf:42")).toEqual([
      { path: "src/lib/main.tf", line: 42 },
    ]);
  });

  it("matches a relative path with a line and a column", () => {
    expect(found("src/lib/main.tf:42:7")).toEqual([
      { path: "src/lib/main.tf", line: 42, column: 7 },
    ]);
  });

  it("matches an explicitly-relative ./ path", () => {
    expect(found("wrote ./src/foo.ts:10")).toEqual([{ path: "./src/foo.ts", line: 10 }]);
  });

  it("matches a parent-relative ../ path", () => {
    expect(found("../shared/x.rs:3")).toEqual([{ path: "../shared/x.rs", line: 3 }]);
  });

  it("matches an absolute path", () => {
    expect(found("/Users/me/proj/src/a.ts:88")).toEqual([
      { path: "/Users/me/proj/src/a.ts", line: 88 },
    ]);
  });

  it("matches a path with a separator but no line", () => {
    expect(found("see src/app.ts")).toEqual([{ path: "src/app.ts" }]);
  });

  it("matches a bare filename WHEN it carries a line", () => {
    expect(found("Cargo.toml:12 and package.json:3")).toEqual([
      { path: "Cargo.toml", line: 12 },
      { path: "package.json", line: 3 },
    ]);
  });

  it("does NOT match a bare filename without a line", () => {
    expect(paths("check Cargo.toml and package.json")).toEqual([]);
  });

  it("finds several references in one line, in order", () => {
    expect(paths("edited a.ts:1, b.ts:2, and src/c.ts")).toEqual([
      "a.ts",
      "b.ts",
      "src/c.ts",
    ]);
  });
});

describe("findFileReferences — diff prefixes", () => {
  it("strips the a/ prefix", () => {
    expect(found("--- a/src/x.ts")).toEqual([{ path: "src/x.ts" }]);
  });

  it("strips the b/ prefix", () => {
    expect(found("+++ b/src/x.ts")).toEqual([{ path: "src/x.ts" }]);
  });

  it("strips the prefix on a bare filename in a diff header", () => {
    expect(found("--- a/Cargo.toml")).toEqual([{ path: "Cargo.toml" }]);
  });

  it("keeps the prefix inside the matched span so the underline covers it", () => {
    const [ref] = findFileReferences("--- a/src/x.ts");
    expect(ref.start).toBe(4);
    expect(ref.length).toBe("a/src/x.ts".length);
  });
});

describe("findFileReferences — must NOT match", () => {
  it("ignores a URL (the web-links addon owns those)", () => {
    expect(paths("see https://example.com/docs")).toEqual([]);
  });

  it("ignores a URL that ends in a filename", () => {
    expect(paths("see https://example.com/a/index.html")).toEqual([]);
  });

  it("ignores a scheme-less www URL", () => {
    expect(paths("see www.example.com/a/index.html")).toEqual([]);
  });

  it("ignores a version string", () => {
    expect(paths("bumped to v1.2.3")).toEqual([]);
  });

  it("ignores a time", () => {
    expect(paths("finished at 12:30")).toEqual([]);
  });

  it("ignores a YAML key: value pair", () => {
    expect(paths("replicas: 3")).toEqual([]);
  });

  it("ignores a YAML key with a numeric value and no space", () => {
    expect(paths("timeout:30")).toEqual([]);
  });

  it("ignores a docker image tag", () => {
    expect(paths("image: registry.io/app:v2 and nginx:1.21")).toEqual([]);
  });

  it("ignores prose containing a slash", () => {
    expect(paths("read/write access and/or more")).toEqual([]);
  });

  it("ignores a bare word", () => {
    expect(paths("done building everything")).toEqual([]);
  });
});

describe("findFileReferences — surrounding punctuation", () => {
  it("strips backticks", () => {
    expect(found("edited `src/x.ts:4`")).toEqual([{ path: "src/x.ts", line: 4 }]);
  });

  it("strips quotes", () => {
    expect(found('opened "src/x.ts:4"')).toEqual([{ path: "src/x.ts", line: 4 }]);
  });

  it("strips parentheses", () => {
    expect(found("(src/x.ts:4)")).toEqual([{ path: "src/x.ts", line: 4 }]);
  });

  it("strips a trailing comma, period and semicolon", () => {
    expect(paths("a.ts:1, b.ts:2. c.ts:3;")).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("strips a trailing colon", () => {
    expect(found("changes in src/x.ts:")).toEqual([{ path: "src/x.ts" }]);
  });

  it("keeps a leading dot so dotfiles still match", () => {
    expect(found(".env:3")).toEqual([{ path: ".env", line: 3 }]);
  });

  it("reports the span of the trimmed text, not the raw token", () => {
    const [ref] = findFileReferences("edited `src/x.ts:4`");
    expect("edited `src/x.ts:4`".slice(ref.start, ref.start + ref.length)).toBe(
      "src/x.ts:4"
    );
  });
});

describe("resolveFileReference", () => {
  const folder = "/Users/me/proj";

  it("resolves a relative path against the session cwd, NOT the workspace folder", () => {
    expect(resolveFileReference("src/x.ts", "/Users/me/proj/backend", folder)).toEqual({
      linkable: true,
      path: "backend/src/x.ts",
      absolutePath: "/Users/me/proj/backend/src/x.ts",
    });
  });

  it("resolves ./ and normalises it away", () => {
    expect(resolveFileReference("./src/x.ts", folder, folder)).toEqual({
      linkable: true,
      path: "src/x.ts",
      absolutePath: "/Users/me/proj/src/x.ts",
    });
  });

  it("resolves ../ within the workspace", () => {
    expect(resolveFileReference("../src/x.ts", "/Users/me/proj/backend", folder)).toEqual({
      linkable: true,
      path: "src/x.ts",
      absolutePath: "/Users/me/proj/src/x.ts",
    });
  });

  it("accepts an absolute path inside the workspace folder", () => {
    expect(resolveFileReference("/Users/me/proj/src/a.ts", null, folder)).toEqual({
      linkable: true,
      path: "src/a.ts",
      absolutePath: "/Users/me/proj/src/a.ts",
    });
  });

  it("tolerates a trailing separator on the workspace folder", () => {
    expect(resolveFileReference("src/x.ts", folder, `${folder}/`)).toEqual({
      linkable: true,
      path: "src/x.ts",
      absolutePath: "/Users/me/proj/src/x.ts",
    });
  });

  it("rejects a path that escapes the workspace via ..", () => {
    expect(resolveFileReference("folder/../../etc/passwd", folder, folder)).toEqual({
      linkable: false,
      reason: "outside-workspace",
    });
  });

  it("rejects an absolute path outside the workspace folder", () => {
    expect(resolveFileReference("/etc/passwd", folder, folder)).toEqual({
      linkable: false,
      reason: "outside-workspace",
    });
  });

  it("rejects a sibling folder that merely shares a name prefix", () => {
    expect(resolveFileReference("/Users/me/project/x.ts", null, folder)).toEqual({
      linkable: false,
      reason: "outside-workspace",
    });
  });

  it("rejects the workspace folder itself — a directory is not a file", () => {
    expect(resolveFileReference("/Users/me/proj", null, folder)).toEqual({
      linkable: false,
      reason: "outside-workspace",
    });
  });

  it("reports no workspace folder bound", () => {
    expect(resolveFileReference("src/x.ts", folder, null)).toEqual({
      linkable: false,
      reason: "no-workspace-folder",
    });
  });

  it("reports no cwd for a relative path", () => {
    expect(resolveFileReference("src/x.ts", null, folder)).toEqual({
      linkable: false,
      reason: "no-cwd",
    });
  });

  it("still resolves an ABSOLUTE path when there is no cwd", () => {
    expect(resolveFileReference("/Users/me/proj/a.ts", null, folder)).toMatchObject({
      linkable: true,
      path: "a.ts",
    });
  });
});

describe("normalizePath", () => {
  it("folds . and .. and collapses separators", () => {
    expect(normalizePath("/a//b/./c/../d")).toBe("/a/b/d");
  });

  it("stops .. at the root of an absolute path", () => {
    expect(normalizePath("/a/../../etc")).toBe("/etc");
  });

  it("keeps a leading .. in a relative path", () => {
    expect(normalizePath("../a/./b")).toBe("../a/b");
  });

  it("drops a trailing separator", () => {
    expect(normalizePath("/a/b/")).toBe("/a/b");
  });
});

describe("a realistic agent line", () => {
  const LINE =
    "Updated src/lib/main.tf:42 and a/src/app.ts:10:3 — see https://example.com/docs v1.2.3 at 12:30";

  it("links the two file references and nothing else", () => {
    expect(found(LINE)).toEqual([
      { path: "src/lib/main.tf", line: 42 },
      { path: "src/app.ts", line: 10, column: 3 },
    ]);
  });

  it("underlines exactly the referenced text", () => {
    expect(
      findFileReferences(LINE).map((r) => LINE.slice(r.start, r.start + r.length))
    ).toEqual(["src/lib/main.tf:42", "a/src/app.ts:10:3"]);
  });
});
