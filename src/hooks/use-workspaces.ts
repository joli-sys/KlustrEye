import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Workspace {
  id: string;
  name: string;
  folderPath: string | null;
  contextName: string | null;
  sortOrder: number;
  lastOpenedAt: string | null;
  /** Derived per-request from the kubeconfig; never persisted. */
  contextExists: boolean;
  /** Derived per-request by stat-ing folderPath; never persisted. */
  folderExists: boolean;
}

export interface WorkspaceInput {
  name: string;
  folderPath: string | null;
  contextName: string | null;
}

export function useWorkspaces() {
  return useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const res = await fetch("/api/workspaces");
      if (!res.ok) throw new Error("Failed to fetch workspaces");
      return res.json();
    },
  });
}

export function useWorkspace(id: string | undefined) {
  return useQuery<Workspace>({
    queryKey: ["workspaces", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id!)}`);
      if (!res.ok) throw new Error("Failed to fetch workspace");
      return res.json();
    },
  });
}

export function useCreateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: WorkspaceInput): Promise<Workspace> => {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create workspace");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: WorkspaceInput & { id: string }): Promise<Workspace> => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to update workspace");
      }
      return res.json();
    },
    onSuccess: (ws) => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["workspaces", ws.id] });
    },
  });
}

export function useDeleteWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete workspace");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}

/** Resolve-or-create the workspace bound to a cluster context. */
export function useResolveClusterWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      contextName: string;
      displayName?: string | null;
    }): Promise<Workspace> => {
      const res = await fetch("/api/workspaces/resolve-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error("Failed to resolve workspace");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
  });
}
