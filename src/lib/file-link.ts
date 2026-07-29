/**
 * Finding file references in agent output, and deciding which of them the
 * editor can actually open.
 *
 * Deliberately free of React and of xterm: everything here is string work, so
 * it is unit-testable without a terminal, and the component is left with only
 * the buffer-to-cell mapping that genuinely needs one.
 *
 * The governing bias is UNDER-matching. Every underlined word that turns out
 * not to be a file makes the transcript look broken and teaches the user to
 * stop clicking, which costs more than the handful of real paths a stricter
 * rule misses. So a candidate has to look like a path, not merely contain a
 * dot or a colon.
 */

/** One file reference located inside a line of terminal text. */
export interface FileReference {
  /** Index of the first matched character within the scanned text. */
  start: number;
  /**
   * Length of the matched text as it appears on screen — including a diff
   * `a/` prefix and any `:line:col` suffix. The underline should cover what
   * the user sees, not the shorter path we derived from it.
   */
  length: number;
  /** The referenced path, with a diff `a/`/`b/` prefix stripped. */
  path: string;
  /** 1-based, when the reference carried one. */
  line?: number;
  /** 1-based, when the reference carried one. */
  column?: number;
}

export type NotLinkableReason =
  /** The workspace has no folder bound, so the file API has no root. */
  | "no-workspace-folder"
  /** A relative path with nothing to resolve it against. */
  | "no-cwd"
  /** Resolved outside the workspace folder — the backend would answer 403. */
  | "outside-workspace";

export type LinkTarget =
  | {
      linkable: true;
      /** Workspace-relative, forward slashes — what `files/*` routes take. */
      path: string;
      /** The full resolved path, for showing the user what a click opens. */
      absolutePath: string;
    }
  | { linkable: false; reason: NotLinkableReason };

/**
 * Candidate tokens: runs of characters that a path could plausibly occupy.
 *
 * The excluded characters double as the "strip surrounding punctuation" rule —
 * quotes, backticks, brackets and `,`/`;` can never be part of a token, so
 * `(src/x.ts:3),` yields exactly `src/x.ts:3` with no trimming pass. `.` and
 * `:` have to stay in, because paths need them, so they are trimmed off the
 * end separately below.
 */
const TOKEN_RE = /[^\s"'`()[\]{}<>,;]+/g;

/** Sentence punctuation that can trail a path but never end one. */
const TRAILING_PUNCTUATION_RE = /[.:!?]+$/;

/**
 * A path, then an optional `:line` and `:column`.
 *
 * The path part cannot contain `:`, which is what rejects `nginx:1.21` and
 * `registry.io/app:v2` for free: the tail after the first colon is not purely
 * digits, so the anchored match fails outright rather than half-succeeding.
 */
const CANDIDATE_RE = /^([^\s:]+)(?::(\d+))?(?::(\d+))?$/;

/**
 * A file extension: a dot, then a LETTER, then more alphanumerics.
 *
 * Requiring a letter first is what makes `v1.2.3` not a file — `.3` is not an
 * extension. The length cap keeps a sentence like `end.Something` from
 * qualifying on a long trailing word.
 */
const EXTENSION_RE = /\.[A-Za-z][A-Za-z0-9]{0,9}$/;

/**
 * Spans owned by the web-links addon. Structurally most URLs already fail
 * `CANDIDATE_RE` (a scheme's `://` is not a line number), but a scheme-less
 * `www.host/page.html` would not, and two providers underlining the same text
 * is worse than either one alone.
 */
const URL_RE = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/\S+|\bwww\.\S+/g;

/**
 * Every file reference in one line of terminal text, in order.
 *
 * Accepts a token when it looks like a path AND carries enough structure to be
 * distinguished from prose:
 *
 * - with a `/`: an extension or a `:line` — so `src/main.tf:42`, `a/src/x.ts`
 *   and `../shared/x.rs:3` match, while `and/or` and `read/write` do not;
 * - without a `/`: an extension AND a `:line` — so `Cargo.toml:12` matches
 *   and a bare `Cargo.toml` in prose does not, which also disposes of `12:30`
 *   (no extension) and of YAML's `key: value` (nothing after the colon).
 */
export function findFileReferences(text: string): FileReference[] {
  const urlSpans = findUrlSpans(text);
  const refs: FileReference[] = [];

  for (const token of text.matchAll(TOKEN_RE)) {
    const raw = token[0].replace(TRAILING_PUNCTUATION_RE, "");
    const start = token.index;
    if (!raw || overlapsUrl(start, raw.length, urlSpans)) continue;

    const parsed = CANDIDATE_RE.exec(raw);
    if (!parsed) continue;

    const [, candidate, lineText, columnText] = parsed;
    if (!isPathLike(candidate, lineText !== undefined)) continue;

    refs.push({
      start,
      length: raw.length,
      // Stripped only after the shape test, so `a/x.ts` still counts as
      // having a path separator — it is a diff header, not a bare filename.
      path: stripDiffPrefix(candidate),
      ...(lineText !== undefined ? { line: Number(lineText) } : {}),
      ...(columnText !== undefined ? { column: Number(columnText) } : {}),
    });
  }

  return refs;
}

/**
 * Where a reference actually points, and whether the editor may open it.
 *
 * `cwd` is the AGENT's working directory, not the workspace folder: a session
 * can be started anywhere, so `src/x.ts` printed by an agent running in
 * `~/proj/backend` is `~/proj/backend/src/x.ts` and resolving it against the
 * workspace root would silently open the wrong file — or none.
 *
 * The workspace folder is still the boundary. The filesystem API is confined
 * to it (`backend/src/fs/mod.rs`) and answers 403 for anything outside, so a
 * path that escapes is reported as not linkable rather than offered as a click
 * that fails. The comparison happens after `.`/`..` are folded away, because
 * `folder/../../etc/passwd` passes a naive prefix check and is exactly the
 * traversal the backend guards against.
 */
export function resolveFileReference(
  path: string,
  cwd: string | null | undefined,
  folderPath: string | null | undefined
): LinkTarget {
  if (!folderPath) return { linkable: false, reason: "no-workspace-folder" };

  let absolutePath: string;
  if (path.startsWith("/")) {
    absolutePath = normalizePath(path);
  } else {
    if (!cwd) return { linkable: false, reason: "no-cwd" };
    absolutePath = normalizePath(`${cwd}/${path}`);
  }

  const root = normalizePath(folderPath);
  // A relative root (or a relative cwd) cannot be reasoned about, and treating
  // it as a prefix would be a guess. Refusing is the safe answer.
  if (!root.startsWith("/") || !absolutePath.startsWith("/")) {
    return { linkable: false, reason: "outside-workspace" };
  }

  const prefix = root === "/" ? "/" : `${root}/`;
  // `startsWith(prefix)` and not `startsWith(root)`: `/w/project/x.ts` is not
  // inside `/w/proj`, and the trailing separator is the whole difference.
  if (!absolutePath.startsWith(prefix)) {
    return { linkable: false, reason: "outside-workspace" };
  }

  const relative = absolutePath.slice(prefix.length);
  // The folder itself is not a file to open.
  if (!relative) return { linkable: false, reason: "outside-workspace" };

  return { linkable: true, path: relative, absolutePath };
}

/**
 * Fold away `.`, `..` and repeated or trailing separators.
 *
 * `..` past the root of an absolute path resolves to the root, as POSIX
 * defines it; in a relative path it is kept, since there is no root yet to
 * stop at and dropping it would quietly change where the path points.
 *
 * This does not decide anything about safety — `/a/../../etc/passwd` folds
 * honestly to `/etc/passwd`. It is the caller's containment check that then
 * rejects it, which only works because the climb happened here first.
 */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const out: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(segment);
  }

  return (absolute ? "/" : "") + out.join("/");
}

/** The last path segment — the part an extension would be on. */
export function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
}

function isPathLike(candidate: string, hasLine: boolean): boolean {
  if (!candidate) return false;
  const hasSeparator = candidate.includes("/");
  const hasExtension = EXTENSION_RE.test(basename(candidate));
  return hasSeparator ? hasExtension || hasLine : hasExtension && hasLine;
}

/**
 * Diff headers name the same file twice, as `a/src/x.ts` and `b/src/x.ts`.
 * Those prefixes are git's, not the repository's, and leaving them on would
 * resolve to a directory that does not exist.
 */
function stripDiffPrefix(path: string): string {
  return /^[ab]\//.test(path) ? path.slice(2) : path;
}

function findUrlSpans(text: string): Array<[number, number]> {
  return Array.from(text.matchAll(URL_RE), (m) => [m.index, m.index + m[0].length]);
}

function overlapsUrl(start: number, length: number, spans: Array<[number, number]>): boolean {
  return spans.some(([from, to]) => start < to && start + length > from);
}
