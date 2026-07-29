import * as monaco from "monaco-editor";

/**
 * The router (react-router) unmounts and remounts the page on every tab
 * switch, so a buffer held in component state is destroyed. Monaco models
 * are global objects that outlive the editor component, so a module-level
 * registry keyed by absolute path preserves unsaved edits across switches.
 */
interface RegistryEntry {
  model: monaco.editor.ITextModel;
  /** The alternative version id at the moment the buffer was last saved. */
  savedVersionId: number;
}

const registry = new Map<string, RegistryEntry>();

/**
 * Caret and scroll position per registry key, so a tab switch restores the
 * view the way an IDE would. `@monaco-editor/react` only manages view state
 * for models it owns via its `path` prop, which we deliberately do not use.
 *
 * Lives here rather than in the editor component so it shares the model's
 * lifetime — anything that disposes a model must forget its view state too, or
 * the map grows for the life of the process.
 */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>();

/**
 * NUL. Built with `fromCharCode` rather than written as an escape so this
 * source file itself stays free of control bytes.
 */
const KEY_SEPARATOR = String.fromCharCode(0);

/**
 * Registry keys are namespaced by workspace: two workspaces can each hold a
 * `src/main.tsx`, and a bare path would hand one workspace's buffer to the
 * other. NUL cannot appear in a path on any supported platform, so it is a
 * separator no filename can forge.
 *
 * The single source of this key — `file-editor` builds it from the router
 * splat, `tab-bar` from the tab payload, and a mismatch would silently give
 * the two different buffers for the same file.
 */
export function fileModelKey(wsId: string, path: string): string {
  return wsId + KEY_SEPARATOR + path;
}

/**
 * Returns the existing model for `path` if one is already registered,
 * WITHOUT calling `setValue` on it — overwriting an open buffer with
 * freshly fetched content would silently discard unsaved edits. Only
 * creates (and seeds with `content`) when no model exists yet.
 */
export function getOrCreateModel(
  path: string,
  content: string,
  language: string
): monaco.editor.ITextModel {
  const existing = registry.get(path);
  if (existing) {
    return existing.model;
  }

  const model = monaco.editor.createModel(content, language);
  registry.set(path, {
    model,
    savedVersionId: model.getAlternativeVersionId(),
  });
  return model;
}

export function disposeModel(path: string): void {
  const entry = registry.get(path);
  viewStates.delete(path);
  if (!entry) return;
  entry.model.dispose();
  registry.delete(path);
}

/**
 * Drop the buffer for `path` — but ONLY when it holds no unsaved work.
 *
 * Closing a tab must not destroy edits the user has not written to disk, so
 * a dirty buffer is deliberately left resident: leaking it is recoverable by
 * reopening the file, losing it is not. Returns whether the buffer was freed
 * so the caller can tell "released" from "kept alive".
 */
export function releaseIfClean(path: string): boolean {
  if (isDirty(path)) return false;

  // Refuse to free a buffer that an editor is still showing. Monaco's
  // onWillDispose detaches the model rather than throwing, so disposing an
  // attached one does not crash — it leaves the editor mounted and blank with
  // no dep change to rebuild it, and Save silently no-ops.
  //
  // Opening a file now navigates as well as opening a tab, so the routed file
  // IS the active tab in the common case — but that is a convention the
  // callers happen to follow, not an invariant the registry can rely on.
  // MAX_TABS eviction closes some OTHER tab, and closing a tab picks a
  // successor before the router has moved, so both paths can still reach an
  // attached model. The guard therefore stays here rather than at the call
  // sites, where every future caller would have to remember it.
  const entry = registry.get(path);
  if (entry?.model.isAttachedToEditor()) return false;

  disposeModel(path);
  return true;
}

/** Whether ANY registered buffer holds unsaved work. */
export function hasDirtyModels(): boolean {
  for (const path of registry.keys()) {
    if (isDirty(path)) return true;
  }
  return false;
}

export function getViewState(
  path: string
): monaco.editor.ICodeEditorViewState | null | undefined {
  return viewStates.get(path);
}

export function setViewState(
  path: string,
  state: monaco.editor.ICodeEditorViewState | null
): void {
  // A view state for a buffer that is gone would never be read and never
  // evicted; the registry is the authority on which keys are still live.
  if (!registry.has(path)) return;
  viewStates.set(path, state);
}

/**
 * Dirtiness compares the model's current alternative version id against the
 * id captured at creation/last save, rather than diffing content strings —
 * this is what correctly reports "clean" again when the user undoes back to
 * the saved state.
 */
export function isDirty(path: string): boolean {
  const entry = registry.get(path);
  if (!entry) return false;
  return entry.model.getAlternativeVersionId() !== entry.savedVersionId;
}

/** Re-baselines the saved version id to the model's current state. */
export function markSaved(path: string): void {
  const entry = registry.get(path);
  if (!entry) return;
  entry.savedVersionId = entry.model.getAlternativeVersionId();
}

/**
 * Free every buffer that holds no unsaved work, and report how many were
 * kept. The bulk-eviction counterpart to `releaseIfClean`, for leaving a
 * workspace.
 *
 * Deliberately NOT `disposeAll`: leaving a workspace is reversible — the keys
 * are namespaced by workspace id, so coming back to the same one reattaches
 * the same buffers — and blanket disposal would silently destroy edits the
 * user could otherwise still recover. Same rule as closing a tab.
 */
export function releaseAllClean(): number {
  let kept = 0;
  for (const path of [...registry.keys()]) {
    if (!releaseIfClean(path)) kept += 1;
  }
  return kept;
}

/** Unconditional teardown. Only for tests — see `releaseAllClean`. */
export function disposeAll(): void {
  for (const entry of registry.values()) {
    entry.model.dispose();
  }
  registry.clear();
  viewStates.clear();
}
