/**
 * Naming a new file or folder in the Explorer.
 *
 * Pure so the rules are testable without a tree: the component owns *when* a
 * draft exists, this owns *what a typed name means*.
 *
 * Validation here is deliberately thin. The backend confines every path
 * (`fs::resolve_in_workspace`) and answers a bad one with a 400 whose message
 * is more specific than anything invented client-side, so this only catches
 * the mistakes worth catching before a round trip — and never tries to be the
 * security boundary.
 */

/** The kind of thing being created. Decides which endpoint the commit hits. */
export type NewEntryKind = "file" | "folder";

/**
 * A pending creation: the directory it goes in (`""` for the workspace root)
 * and what it will be.
 */
export interface NewEntryDraft {
  parent: string;
  kind: NewEntryKind;
}

/**
 * The workspace-relative path a typed name resolves to.
 *
 * A name may contain `/` — `src/lib/util.ts` creates the intermediate
 * directories, because both endpoints behind this already do (`write_file` and
 * `create_directory` each `create_dir_all` the parent). Rejecting it would be
 * inventing a restriction the backend does not have.
 */
export function joinPath(parent: string, name: string): string {
  const trimmed = name.trim().replace(/\/+$/, "");
  return parent ? `${parent}/${trimmed}` : trimmed;
}

/** The last segment of a path — what a tab is labelled with. */
export function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Why this name cannot be used, or `null` when it can.
 *
 * Blank is NOT reported here: an empty draft means the user changed their mind,
 * which the caller treats as a cancel rather than an error to display.
 */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("/")) {
    return "Enter a name relative to this folder, without a leading “/”.";
  }
  // `..` would be rejected by the backend as an escape attempt; saying so here
  // is friendlier than a 400 that reads like the user did something hostile.
  if (trimmed.split("/").some((seg) => seg === "." || seg === "..")) {
    return "“.” and “..” can’t be used as name segments.";
  }
  if (trimmed.split("/").some((seg) => seg.trim() === "")) {
    return "A name can’t contain an empty path segment.";
  }
  return null;
}

/**
 * Whether a name is complete enough to submit — non-blank and valid.
 * Drives the disabled state of the confirm affordance.
 */
export function canSubmitEntryName(name: string): boolean {
  return name.trim().length > 0 && validateEntryName(name) === null;
}
