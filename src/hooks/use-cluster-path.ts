import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { clusterPath, workspacePath } from "@/lib/paths";

export function useWorkspaceId(): string {
  const { wsId } = useParams<{ wsId: string }>();
  return wsId ?? "";
}

/** Build a cluster sub-path for the current workspace + context. */
export function useClusterPath(): (subPath: string) => string {
  const { wsId, contextName } = useParams<{ wsId: string; contextName: string }>();
  return useCallback(
    (subPath: string) => clusterPath(wsId ?? "", contextName ?? "", subPath),
    [wsId, contextName]
  );
}

/** Build a workspace-relative path (files, terminals) for the current workspace. */
export function useWorkspacePath(): (subPath: string) => string {
  const { wsId } = useParams<{ wsId: string }>();
  return useCallback((subPath: string) => workspacePath(wsId ?? "", subPath), [wsId]);
}
