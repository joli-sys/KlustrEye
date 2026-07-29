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
export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) {
    throw new Error("Native folder picker is only available in the desktop app.");
  }

  const mod = await import("@tauri-apps/plugin-dialog");
  const selected = await mod.open({ directory: true, multiple: false });

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
