/**
 * Pure text<->value conversions for the agent definition editor, plus the path
 * abbreviation the session list uses.
 *
 * Split out of the components because the round trip is the easy part to get
 * wrong: a definition's `args` is a string ARRAY that the user edits as lines
 * of text, so `toLines(parse(toLines(x)))` has to hold for every value the
 * backend can hand back, and blank lines / stray whitespace / CRLF are exactly
 * where that breaks. vitest has no DOM harness in this repo, so logic left
 * inside a component is logic that never gets tested.
 */

/** Strip a single trailing CR so a value pasted from a CRLF file round-trips. */
function stripCr(line: string): string {
  return line.replace(/\r$/, "");
}

/**
 * One argument per line — NOT a shell string.
 *
 * `--model opus` on one line is a single argument containing a space, which is
 * almost never what the user meant; the UI says so, but nothing here can tell
 * that apart from a deliberately spaced argument, so it is passed through
 * verbatim.
 *
 * Trimmed and blank-dropped: an argument that is empty or pure whitespace
 * cannot be expressed in this format, and every real one the user types has
 * neither. That makes `parseArgLines` lossy for such values by design — see
 * `argsToLines` for the round-trip direction.
 */
export function parseArgLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => stripCr(line).trim())
    .filter((line) => line.length > 0);
}

/** The inverse of `parseArgLines` for values that survive it. */
export function argsToLines(args: string[] | null | undefined): string {
  return (args ?? []).join("\n");
}

/**
 * One regex per line.
 *
 * Unlike arguments these are NOT trimmed: a prompt pattern very often ends in
 * a significant space (`"Continue\\? $"` matches a prompt the agent left the
 * cursor after), and trimming would silently turn a working pattern into one
 * that never matches. Only entirely-blank lines are dropped.
 */
export function parsePatternLines(text: string): string[] {
  return text
    .split("\n")
    .map(stripCr)
    .filter((line) => line.trim().length > 0);
}

/** The inverse of `parsePatternLines`. */
export function patternsToLines(patterns: string[] | null | undefined): string {
  return (patterns ?? []).join("\n");
}

export type EnvParseResult =
  | { ok: true; value: Record<string, string> }
  | { ok: false; error: string };

/**
 * `KEY=VALUE` per line.
 *
 * Split at the FIRST `=` so a value may contain more (`ARGS=--a=1`). Both
 * sides are trimmed — `FOO = bar` is what people type and meaning the space
 * would be a trap. A duplicate key takes its last value, matching how a shell
 * would read the same lines.
 *
 * Returns an error rather than dropping the offending line: a typo'd env line
 * that vanishes on save is a bug report, and the backend would reject it
 * anyway with a message the user cannot act on until the next round trip.
 */
export function parseEnvLines(text: string): EnvParseResult {
  const value: Record<string, string> = {};
  const lines = text.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = stripCr(lines[i]).trim();
    if (!line) continue;

    const eq = line.indexOf("=");
    if (eq === -1) {
      return { ok: false, error: `Line ${i + 1}: expected KEY=VALUE, got "${line}"` };
    }

    const key = line.slice(0, eq).trim();
    if (!key) {
      return { ok: false, error: `Line ${i + 1}: missing a variable name before "="` };
    }

    value[key] = line.slice(eq + 1).trim();
  }

  return { ok: true, value };
}

/**
 * The inverse of `parseEnvLines`.
 *
 * Sorted by key, because the backend stores env as a Rust `HashMap` whose JSON
 * key order is arbitrary — without this the textarea would reshuffle itself
 * every time the dialog reopened.
 */
export function envToLines(env: Record<string, string> | null | undefined): string {
  return Object.entries(env ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => `${key}=${val}`)
    .join("\n");
}

/**
 * Trailing path segments, for a sidebar column ~200px wide.
 *
 * Display only — the full path always goes in a `title` tooltip, because two
 * sibling checkouts abbreviate to the same thing and the user has to be able
 * to tell them apart somehow.
 */
export function abbreviatePath(
  path: string | null | undefined,
  segments = 2
): string {
  if (!path) return "";

  // Drop trailing separators, but never let "/" collapse to nothing.
  const cleaned = path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length <= segments) return cleaned;

  return `…/${parts.slice(-segments).join("/")}`;
}
