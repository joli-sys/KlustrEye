import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedMs: number;
}

export interface DirectoryListing {
  path: string;
  entries: DirEntry[];
}

export interface FileContent {
  path: string;
  content: string;
  encoding: "utf-8" | "binary";
  size: number;
  modifiedMs: number;
}

export interface SaveFileInput {
  wsId: string;
  path: string;
  content: string;
  /** The mtime the client last saw; omit when creating a new file. */
  baseModifiedMs?: number;
}

export interface SaveFileResult {
  path: string;
  size: number;
  modifiedMs: number;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchFilesResult {
  matches: SearchMatch[];
  truncated: boolean;
}

/**
 * Thrown by `useSaveFile` on any non-OK response. `status` lets callers tell
 * a 409 (another process changed the file on disk — offer reload-vs-overwrite)
 * apart from any other failure, which a plain `Error` cannot distinguish.
 */
export class FileSaveError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FileSaveError";
    this.status = status;
  }
}

export function useDirectory(wsId: string | undefined, path: string | undefined) {
  return useQuery<DirectoryListing>({
    queryKey: ["files", wsId, path],
    enabled: !!wsId && path !== undefined,
    // The file watcher already invalidates this key on every change under the
    // directory (use-file-watch.ts), so the global 15s poll from providers.tsx
    // would only re-list every expanded tree node for nothing.
    refetchInterval: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ path: path! });
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId!)}/files?${params}`,
        { signal }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to list directory");
      }
      return res.json();
    },
  });
}

export function useFile(wsId: string | undefined, path: string | undefined) {
  return useQuery<FileContent>({
    queryKey: ["file", wsId, path],
    enabled: !!wsId && path !== undefined,
    // The global 15s refetchInterval (see providers.tsx) would otherwise
    // refetch file content out from under an open editor buffer.
    refetchInterval: false,
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ path: path! });
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId!)}/file?${params}`,
        { signal }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to read file");
      }
      return res.json();
    },
  });
}

export function useSaveFile() {
  const qc = useQueryClient();
  return useMutation({
    // Deliberately NOT cancellable, unlike the reads above. React Query v5
    // hands mutations no `signal` (MutationFunctionContext carries only
    // client/meta/mutationKey), and aborting a PUT mid-flight would be wrong
    // anyway: the write may already have landed, and the client would never
    // learn the new mtime it needs as the next save's baseline.
    mutationFn: async ({
      wsId,
      path,
      content,
      baseModifiedMs,
    }: SaveFileInput): Promise<SaveFileResult> => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/file`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, content, baseModifiedMs }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new FileSaveError(
          body.error || "Failed to save file",
          res.status
        );
      }
      return res.json();
    },
    onSuccess: (_result, variables) => {
      qc.invalidateQueries({ queryKey: ["file", variables.wsId, variables.path] });
      qc.invalidateQueries({ queryKey: ["files", variables.wsId] });
    },
  });
}

export function useSearchFiles(
  wsId: string | undefined,
  q: string,
  max?: number
) {
  return useQuery<SearchFilesResult>({
    queryKey: ["file-search", wsId, q],
    enabled: !!wsId && q.length >= 2,
    // A search is a full walk of the workspace that opens and reads every
    // non-ignored file. Under the global 15s poll from providers.tsx that walk
    // would re-run forever, for as long as the search box holds 2+ characters
    // — sustained disk and CPU load with nobody watching the results.
    refetchInterval: false,
    staleTime: 30_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q });
      if (max !== undefined) params.set("max", String(max));
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId!)}/search?${params}`,
        { signal }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Search failed");
      }
      return res.json();
    },
  });
}
