/**
 * The native directory picker, shared by every folder field.
 *
 * Extracted rather than copied: the cancel-vs-failure distinction below was a
 * user-reported bug (an earlier version swallowed both into `null`, so a
 * failing picker was indistinguishable from a cancelled one and the Browse
 * button simply looked inert). A second copy is a second chance to lose it.
 */

// Tauri injects __TAURI_INTERNALS__; in browser dev mode there is no native
// picker, so the user types a path instead.
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Opens the native directory picker.
 *
 * Returns the chosen path, or `null` when the user cancelled — cancelling is
 * the normal case, not a failure, and must stay distinguishable from an error.
 * Anything that goes wrong THROWS so the caller can surface it in a
 * `destructive` toast.
 */
/**
 * Best-effort human text for a thrown value.
 *
 * Tauri's IPC rejects with a plain STRING, not an `Error`, so reading `.message`
 * yielded `undefined` and the toast read "undefined You can still type…". Any
 * error surfaced to a user has to survive being thrown as a string, an object
 * with `message`, or something with no useful shape at all.
 */
export function errorText(e: unknown): string {
  if (typeof e === "string" && e.trim()) return e;
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === "object") {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
    try {
      const json = JSON.stringify(e);
      if (json && json !== "{}") return json;
    } catch {
      // Circular or otherwise unserialisable — fall through.
    }
  }
  return "no error detail was provided";
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("Native folder picker is only available in the desktop app.");
  }

  let mod: typeof import("@tauri-apps/plugin-dialog");
  try {
    mod = await import("@tauri-apps/plugin-dialog");
  } catch (e) {
    throw new Error(`Could not load the dialog plugin: ${errorText(e)}`);
  }

  let selected: string | string[] | null;
  try {
    selected = await mod.open({ directory: true, multiple: false });
  } catch (e) {
    // The common cause is a JS/Rust tauri version skew, or the `dialog:default`
    // capability missing from src-tauri/capabilities/default.json — the plugin
    // loads fine either way and only fails at the call.
    throw new Error(`The dialog plugin rejected the request: ${errorText(e)}`);
  }

  // Cancelled.
  if (selected === null || selected === undefined) return null;
  if (typeof selected === "string") return selected;
  // `multiple: false` should never yield an array, but a plugin-version skew
  // between the JS and Rust sides could. Take the first rather than silently
  // returning nothing.
  if (Array.isArray(selected) && typeof selected[0] === "string") return selected[0];

  throw new Error(
    `Folder picker returned an unexpected value (${typeof selected}). ` +
      "This usually means the JS and Rust tauri-plugin-dialog versions disagree."
  );
}
