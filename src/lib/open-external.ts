/**
 * Opening a URL in the user's real browser.
 *
 * A Tauri webview is not a browser tab: `target="_blank"` and `window.open`
 * are both swallowed, so every external link in the desktop build did nothing
 * at all while working perfectly under `npm run dev`. Handing the URL to the
 * OS requires the opener plugin, which means this cannot be done inline in a
 * component — hence one helper every call site goes through.
 *
 * `isTauri`/`errorText` come from the folder picker because they are about the
 * Tauri bridge rather than about folders specifically, and a second copy of
 * `errorText` would be a second chance to lose the string-vs-Error handling it
 * exists for.
 */
import { errorText, isTauri } from "@/lib/folder-picker";

/**
 * Opens `url` in the default browser.
 *
 * Throws on failure so callers can surface it in a `destructive` toast. A
 * silent failure is the exact bug this module exists to fix, so nothing here
 * swallows an error.
 */
export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    // Plain browser: a real popup, which the user's popup blocker may still
    // refuse — `null` is that refusal and has to be reported, not ignored.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      throw new Error("The browser blocked the popup. Allow popups for this site, or copy the link.");
    }
    return;
  }

  let mod: typeof import("@tauri-apps/plugin-opener");
  try {
    mod = await import("@tauri-apps/plugin-opener");
  } catch (e) {
    throw new Error(`Could not load the opener plugin: ${errorText(e)}`);
  }

  try {
    await mod.openUrl(url);
  } catch (e) {
    // The usual causes are a JS/Rust plugin version skew, or `opener:default`
    // missing from src-tauri/capabilities/default.json — the plugin imports
    // fine either way and only fails at the call. Its default scope covers
    // `http://*` and `https://*`; anything else needs a scope entry there.
    throw new Error(`The opener plugin rejected the request: ${errorText(e)}`);
  }
}

/**
 * An `onClick` for an `<a>` that should reach the real browser.
 *
 * The `href` stays on the element on purpose: it keeps the link copyable,
 * middle-clickable and readable by assistive tech, and it is what still works
 * if this handler ever fails to load. The default is prevented only once we
 * are actually taking over.
 */
export function externalLinkHandler(
  url: string,
  onError?: (message: string) => void
) {
  return (event: React.MouseEvent) => {
    event.preventDefault();
    openExternal(url).catch((e) => onError?.(errorText(e)));
  };
}
