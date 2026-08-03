/**
 * Turning what the user typed in the agent composer into terminal input.
 *
 * Pure so the encoding rules are testable without a PTY: the component owns
 * *when* to send, this owns *what the bytes mean*.
 */

/**
 * How one composer submission reaches the terminal.
 *
 * `paste` is non-null only for a multi-line message, and MUST go through
 * xterm's `Terminal.paste()` rather than being written directly. That method
 * checks whether the running agent actually enabled bracketed-paste mode
 * (DECSET 2004) and wraps the text in `ESC[200~`/`ESC[201~` only if it did.
 * Writing those markers unconditionally would dump raw escape bytes into the
 * input of any agent that never asked for them; writing the newlines raw
 * instead would submit each line as its own message, which is the bug this
 * whole path exists to avoid.
 *
 * `send` is written directly and is the Return that submits.
 */
export interface ComposerSubmission {
  paste: string | null;
  send: string;
}

/**
 * Encodes a draft, or `null` when there is nothing to send.
 *
 * `\r` — not `\n` — is what a terminal sends for Return; `\n` would leave
 * line-based prompts waiting for the rest of the line.
 */
export function encodeComposerSubmission(draft: string): ComposerSubmission | null {
  // A textarea yields "\n", but text pasted in from elsewhere can carry CRLF
  // or a lone CR. Normalize first so the multi-line test below is accurate.
  const text = draft.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!text.trim()) return null;

  // Single line: unchanged from the original composer — one write, no paste
  // machinery, no dependency on the agent's bracketed-paste state.
  if (!text.includes("\n")) return { paste: null, send: `${text}\r` };

  return { paste: text, send: "\r" };
}

/**
 * Whether a keydown in the composer should submit rather than insert a newline.
 *
 * Enter submits; Shift+Enter inserts. The other modifiers are excluded so an
 * IME confirmation or a Ctrl/Cmd/Alt chord never submits by accident — on
 * macOS ⌥Enter and ⌘Enter are both live in other apps, and silently sending a
 * half-written message is not recoverable.
 */
export function isComposerSubmit(event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): boolean {
  if (event.key !== "Enter") return false;
  if (event.isComposing) return false;
  return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}
