import { describe, it, expect } from "vitest";
import { encodeComposerSubmission, isComposerSubmit } from "./agent-input";

const key = (over: Partial<Parameters<typeof isComposerSubmit>[0]> = {}) => ({
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...over,
});

describe("encodeComposerSubmission", () => {
  it("sends a single line as one write ending in CR", () => {
    expect(encodeComposerSubmission("run the tests")).toEqual({
      paste: null,
      send: "run the tests\r",
    });
  });

  it("has nothing to send for blank or whitespace-only input", () => {
    expect(encodeComposerSubmission("")).toBeNull();
    expect(encodeComposerSubmission("   ")).toBeNull();
    expect(encodeComposerSubmission("\n\n")).toBeNull();
  });

  /**
   * The point of the feature: two lines must arrive as ONE message. Routing
   * them through `paste` is what lets xterm decide, from the agent's own
   * bracketed-paste mode, whether the newline is literal or a submission.
   */
  it("routes a multi-line message through paste, then a bare CR to submit", () => {
    expect(encodeComposerSubmission("first\nsecond")).toEqual({
      paste: "first\nsecond",
      send: "\r",
    });
  });

  it("normalizes CRLF and lone CR so pasted text is still seen as multi-line", () => {
    expect(encodeComposerSubmission("first\r\nsecond")).toEqual({
      paste: "first\nsecond",
      send: "\r",
    });
    expect(encodeComposerSubmission("first\rsecond")).toEqual({
      paste: "first\nsecond",
      send: "\r",
    });
  });

  /**
   * Shift+Enter at the end of a message is a slip, not a request for a
   * trailing blank line — and it would otherwise turn a single-line message
   * into a multi-line one that needs the paste path for no reason.
   */
  it("drops trailing newlines", () => {
    expect(encodeComposerSubmission("just one line\n")).toEqual({
      paste: null,
      send: "just one line\r",
    });
    expect(encodeComposerSubmission("first\nsecond\n\n")).toEqual({
      paste: "first\nsecond",
      send: "\r",
    });
  });

  it("keeps interior blank lines", () => {
    expect(encodeComposerSubmission("first\n\nthird")).toEqual({
      paste: "first\n\nthird",
      send: "\r",
    });
  });
});

describe("isComposerSubmit", () => {
  it("submits on a plain Enter", () => {
    expect(isComposerSubmit(key())).toBe(true);
  });

  it("does not submit on Shift+Enter — that is the new line", () => {
    expect(isComposerSubmit(key({ shiftKey: true }))).toBe(false);
  });

  /** Sending a half-written message on a stray chord is not recoverable. */
  it("does not submit on other modifier chords", () => {
    expect(isComposerSubmit(key({ metaKey: true }))).toBe(false);
    expect(isComposerSubmit(key({ ctrlKey: true }))).toBe(false);
    expect(isComposerSubmit(key({ altKey: true }))).toBe(false);
  });

  /** Enter confirming an IME candidate must not send the message. */
  it("does not submit while an IME composition is in progress", () => {
    expect(isComposerSubmit(key({ isComposing: true }))).toBe(false);
  });

  it("ignores every other key", () => {
    expect(isComposerSubmit(key({ key: "a" }))).toBe(false);
    expect(isComposerSubmit(key({ key: "Escape" }))).toBe(false);
  });
});
