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
} from "./model-registry";

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
});
