import { useQuery } from "@tanstack/react-query";

export interface ClusterHealthIssue {
  severity: "critical" | "warning";
  kind: string;
  name: string;
  namespace?: string;
  reason: string;
  message: string;
}

export interface ClusterHealthSummary {
  criticalCount: number;
  warningCount: number;
  issues: ClusterHealthIssue[];
}

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

export function useClusterHealth(contextName: string, namespace?: string) {
  return useQuery<ClusterHealthSummary>({
    queryKey: ["cluster-health", contextName, namespace],
    queryFn: async () => {
      const params = namespace ? `?namespace=${encodeURIComponent(namespace)}` : "";
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}/health${params}`);
      if (!res.ok) return { criticalCount: 0, warningCount: 0, issues: [] };
      return res.json();
    },
    enabled: !!contextName,
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}
