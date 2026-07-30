import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type FileWatchKind = "created" | "modified" | "removed";

export interface FileWatchEvent {
  kind: FileWatchKind;
  path: string;
}

const WATCH_KINDS: readonly string[] = ["created", "modified", "removed"];

/** Longest gap between reconnect attempts. */
const MAX_BACKOFF_MS = 30_000;

/**
 * The directory whose listing contains `path`. The workspace root is "", which
 * is exactly the key `useDirectory(wsId, "")` uses for the top level.
 */
export function parentDir(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * A watch frame, or `null` for anything else the socket may send — the backend
 * also emits `{ kind: "error", message }` before closing, and a frame that is
 * not a change must never be mistaken for one.
 */
export function parseWatchEvent(data: unknown): FileWatchEvent | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { kind, path } = parsed as Record<string, unknown>;
  if (typeof kind !== "string" || !WATCH_KINDS.includes(kind)) return null;
  if (typeof path !== "string" || path === "") return null;
  return { kind: kind as FileWatchKind, path };
}

/**
 * Close codes in the 4000 range mean the backend decided this socket can never
 * work for this workspace (no folder bound, folder gone). Retrying would spin
 * forever; every lower code is a transport drop worth retrying.
 */
export function shouldReconnect(code: number): boolean {
  return code < 4000;
}

export function reconnectDelayMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
}

export function watchUrl(wsId: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/watch/${encodeURIComponent(wsId)}`;
}

/**
 * Keep the file tree in step with changes made outside the app (a git
 * checkout, an external editor, a build).
 *
 * Deliberately invalidates ONLY the directory listing that contains the
 * changed path. It must never touch `["file", wsId, path]`: that query is
 * pinned with `staleTime: Infinity` in `use-files.ts` because the open editor
 * buffer is built from it, and refetching would silently overwrite unsaved
 * edits. An external change to an open file is already handled on save — the
 * `baseModifiedMs` check returns 409 and the editor offers reload-vs-overwrite.
 */
export function useFileWatch(wsId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!wsId || !enabled || typeof window === "undefined") return;

    let disposed = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;
      const ws = new WebSocket(watchUrl(wsId));
      socket = ws;

      ws.onopen = () => {
        attempt = 0;
      };

      ws.onmessage = (message) => {
        const event = parseWatchEvent(message.data);
        if (!event) return;
        queryClient.invalidateQueries({
          queryKey: ["files", wsId, parentDir(event.path)],
        });
      };

      ws.onclose = (event) => {
        if (disposed || !shouldReconnect(event.code)) return;
        retryTimer = setTimeout(connect, reconnectDelayMs(attempt));
        attempt += 1;
      };

      // `onclose` always follows `onerror`, so the retry is scheduled there.
      ws.onerror = () => {};
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [wsId, enabled, queryClient]);
}
