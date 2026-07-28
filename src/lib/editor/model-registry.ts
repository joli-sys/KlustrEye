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
  if (!entry) return;
  entry.model.dispose();
  registry.delete(path);
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

export function disposeAll(): void {
  for (const entry of registry.values()) {
    entry.model.dispose();
  }
  registry.clear();
}
