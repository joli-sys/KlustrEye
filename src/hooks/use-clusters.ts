"use client";

import { useQuery } from "@tanstack/react-query";

import type { CloudProvider } from "@/lib/k8s/provider";

export interface ClusterContext {
  name: string;
  cluster: string;
  user: string;
  namespace: string;
  isCurrent: boolean;
  provider: "kubeconfig";
  cloudProvider: CloudProvider;
  displayName: string | null;
  colorScheme: string | null;
  organizationId: string | null;
  organizationName: string | null;
  lastNamespace: string;
}

export function useClusters() {
  return useQuery<ClusterContext[]>({
    queryKey: ["clusters"],
    queryFn: async () => {
      const res = await fetch("/api/clusters");
      if (!res.ok) throw new Error("Failed to fetch clusters");
      return res.json();
    },
  });
}

export function useClusterInfo(contextName: string) {
  return useQuery({
    queryKey: ["cluster-info", contextName],
    queryFn: async () => {
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}`);
      if (!res.ok) throw new Error("Failed to fetch cluster info");
      return res.json();
    },
    enabled: !!contextName,
  });
}

export function useNamespaces(contextName: string) {
  return useQuery<{ name: string; status: string }[]>({
    queryKey: ["namespaces", contextName],
    queryFn: async () => {
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}/namespaces`);
      if (!res.ok) throw new Error("Failed to fetch namespaces");
      return res.json();
    },
    enabled: !!contextName,
  });
}
