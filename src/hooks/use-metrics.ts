"use client";

import { useQuery } from "@tanstack/react-query";

export function useNodeMetrics(contextName: string) {
  return useQuery({
    queryKey: ["node-metrics", contextName],
    queryFn: async () => {
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}/metrics/nodes`);
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: !!contextName,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}

export function usePodMetrics(contextName: string, namespace?: string) {
  return useQuery({
    queryKey: ["pod-metrics", contextName, namespace],
    queryFn: async () => {
      const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}/metrics/pods${params}`);
      if (!res.ok) return { items: [] };
      return res.json();
    },
    enabled: !!contextName,
    staleTime: 5_000,
    refetchInterval: 10_000,
  });
}
