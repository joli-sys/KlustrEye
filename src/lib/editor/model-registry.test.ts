import { describe, it, expect, vi, beforeEach } from "vitest";

// vitest.config.ts runs with environment: "node", so real monaco-editor
// (which needs a DOM) cannot load. Mock it with a minimal fake that mirrors
// the bits of the ITextModel API the registry depends on: getValue/setValue,
// getAlternativeVersionId (incrementing on each setValue, like the real
// undo-stack-based version id), dispose, and onDidChangeContent.
vi.mock("monaco-editor", () => {
  function createModel(content: string, language: string) {
    let value = content;
    let versionId = 1;
    return {
      __language: language,
      getValue: () => value,
      setValue: (next: string) => {
        value = next;
        versionId += 1;
      },
      getAlternativeVersionId: () => versionId,
      dispose: vi.fn(),
      onDidChangeContent: vi.fn(),
    };
  }
  return {
    editor: { createModel },
  };
});

import {
  getOrCreateModel,
  disposeModel,
  isDirty,
  markSaved,
  disposeAll,
  releaseAllClean,
  fileModelKey,
  hasDirtyModels,
  releaseIfClean,
  getViewState,
  setViewState,
} from "./model-registry";

// Stands in for monaco's opaque ICodeEditorViewState; the registry only ever
// stores and returns it.
const VIEW_STATE = { cursorState: [], viewState: {} } as never;

describe("model-registry", () => {
  beforeEach(() => {
    disposeAll();
  });

  it("returns the same model instance for the same path", () => {
    const a = getOrCreateModel("/ws/a.txt", "hello", "plaintext");
    const b = getOrCreateModel("/ws/a.txt", "hello", "plaintext");
    expect(a).toBe(b);
  });

  it("does not clobber edited content on a second getOrCreateModel call", () => {
    const model = getOrCreateModel("/ws/a.txt", "original", "plaintext");
    model.setValue("edited by user");

    const again = getOrCreateModel("/ws/a.txt", "fresh content from server", "plaintext");

    expect(again).toBe(model);
    expect(again.getValue()).toBe("edited by user");
  });

  it("isDirty is false initially, true after an edit, false again after markSaved", () => {
    const model = getOrCreateModel("/ws/a.txt", "original", "plaintext");
    expect(isDirty("/ws/a.txt")).toBe(false);

    model.setValue("changed");
    expect(isDirty("/ws/a.txt")).toBe(true);

    markSaved("/ws/a.txt");
    expect(isDirty("/ws/a.txt")).toBe(false);
  });

  it("isDirty is false for a path that was never registered", () => {
    expect(isDirty("/ws/never.txt")).toBe(false);
  });

  it("disposeModel removes the entry and disposes the model", () => {
    const model = getOrCreateModel("/ws/a.txt", "original", "plaintext");
    disposeModel("/ws/a.txt");
    expect(model.dispose).toHaveBeenCalledTimes(1);

    const fresh = getOrCreateModel("/ws/a.txt", "brand new", "plaintext");
    expect(fresh).not.toBe(model);
    expect(fresh.getValue()).toBe("brand new");
  });

  it("disposeModel on an unregistered path is a no-op", () => {
    expect(() => disposeModel("/ws/missing.txt")).not.toThrow();
  });

  it("disposeAll disposes and clears every registered model", () => {
    const a = getOrCreateModel("/ws/a.txt", "a", "plaintext");
    const b = getOrCreateModel("/ws/b.txt", "b", "plaintext");

    disposeAll();

    expect(a.dispose).toHaveBeenCalledTimes(1);
    expect(b.dispose).toHaveBeenCalledTimes(1);

    const freshA = getOrCreateModel("/ws/a.txt", "again", "plaintext");
    expect(freshA).not.toBe(a);
  });

  it("namespaces keys by workspace so two workspaces never share a buffer", () => {
    const keyA = fileModelKey("ws-a", "src/main.tsx");
    const keyB = fileModelKey("ws-b", "src/main.tsx");
    expect(keyA).not.toBe(keyB);

    const a = getOrCreateModel(keyA, "workspace a", "typescript");
    const b = getOrCreateModel(keyB, "workspace b", "typescript");
    expect(a).not.toBe(b);
    expect(a.getValue()).toBe("workspace a");
    expect(b.getValue()).toBe("workspace b");
  });

  // The separator must be something no filename can contain, or a crafted
  // path could collide with another workspace's key.
  it("separates workspace id from path with a character no path can hold", () => {
    expect(fileModelKey("ws", "a.txt")).toBe(
      "ws" + String.fromCharCode(0) + "a.txt"
    );
  });

  it("releaseIfClean frees a clean buffer", () => {
    const model = getOrCreateModel("/ws/a.txt", "original", "plaintext");

    expect(releaseIfClean("/ws/a.txt")).toBe(true);
    expect(model.dispose).toHaveBeenCalledTimes(1);
    expect(getOrCreateModel("/ws/a.txt", "reread", "plaintext")).not.toBe(model);
  });

  // The whole point: closing a tab must never destroy unsaved work. Leaking
  // the buffer is recoverable by reopening the file; losing it is not.
  it("releaseIfClean keeps a dirty buffer alive", () => {
    const model = getOrCreateModel("/ws/a.txt", "original", "plaintext");
    model.setValue("unsaved edit");

    expect(releaseIfClean("/ws/a.txt")).toBe(false);
    expect(model.dispose).not.toHaveBeenCalled();
    expect(getOrCreateModel("/ws/a.txt", "reread", "plaintext")).toBe(model);
    expect(model.getValue()).toBe("unsaved edit");
  });

  it("releaseIfClean on an unregistered path reports it as released", () => {
    expect(releaseIfClean("/ws/never.txt")).toBe(true);
  });

  // Leaving a workspace is reversible — the same wsId reattaches the same
  // buffers — so a blanket disposeAll there would destroy recoverable edits.
  it("releaseAllClean frees clean buffers and keeps dirty ones", () => {
    const clean = getOrCreateModel("/ws/clean.txt", "a", "plaintext");
    const dirty = getOrCreateModel("/ws/dirty.txt", "b", "plaintext");
    dirty.setValue("unsaved edit");

    expect(releaseAllClean()).toBe(1);

    expect(clean.dispose).toHaveBeenCalledTimes(1);
    expect(dirty.dispose).not.toHaveBeenCalled();
    expect(getOrCreateModel("/ws/dirty.txt", "reread", "plaintext")).toBe(dirty);
    expect(getOrCreateModel("/ws/dirty.txt", "reread", "plaintext").getValue()).toBe(
      "unsaved edit"
    );
  });

  it("hasDirtyModels reports across every registered buffer", () => {
    getOrCreateModel("/ws/a.txt", "a", "plaintext");
    const b = getOrCreateModel("/ws/b.txt", "b", "plaintext");
    expect(hasDirtyModels()).toBe(false);

    b.setValue("edited");
    expect(hasDirtyModels()).toBe(true);

    markSaved("/ws/b.txt");
    expect(hasDirtyModels()).toBe(false);
  });

  it("view states are stored per key and evicted with the model", () => {
    getOrCreateModel("/ws/a.txt", "a", "plaintext");
    setViewState("/ws/a.txt", VIEW_STATE);
    expect(getViewState("/ws/a.txt")).toBe(VIEW_STATE);

    disposeModel("/ws/a.txt");
    expect(getViewState("/ws/a.txt")).toBeUndefined();
  });

  // Without the registry check the map would accumulate an entry for every
  // file ever opened, with nothing to evict it.
  it("refuses to store a view state for a buffer that is gone", () => {
    setViewState("/ws/never.txt", VIEW_STATE);
    expect(getViewState("/ws/never.txt")).toBeUndefined();
  });
});
