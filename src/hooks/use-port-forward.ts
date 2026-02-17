"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface PortForwardSession {
  id: string;
  contextName: string;
  namespace: string;
  resourceType: string;
  resourceName: string;
  localPort: number;
  remotePort: number;
  status: string;
  errorMessage: string | null;
  pid: number | null;
  createdAt: string;
  stoppedAt: string | null;
}

function portForwardUrl(contextName: string, id?: string) {
  const base = `/api/clusters/${encodeURIComponent(contextName)}/port-forward`;
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

export function usePortForwards(contextName: string) {
  return useQuery<PortForwardSession[]>({
    queryKey: ["port-forwards", contextName],
    queryFn: async () => {
      const res = await fetch(portForwardUrl(contextName));
      if (!res.ok) throw new Error("Failed to fetch port forwards");
      const data = await res.json();
      return data.sessions || [];
    },
    refetchInterval: 5000,
    enabled: !!contextName,
  });
}

export function useStartPortForward(contextName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opts: {
      namespace: string;
      resourceType: string;
      resourceName: string;
      localPort: number;
      remotePort: number;
    }) => {
      const res = await fetch(portForwardUrl(contextName), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to start port forward");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["port-forwards", contextName] });
    },
  });
}

export function useStopPortForward(contextName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(portForwardUrl(contextName, id), {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to stop port forward");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["port-forwards", contextName] });
    },
  });
}
