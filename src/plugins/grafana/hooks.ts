"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PrometheusSeries } from "./server";
import {
  podCpuQuery,
  podMemoryQuery,
  nodeCpuQuery,
  nodeMemoryQuery,
  type TimeRange,
} from "./queries";

// --- Settings hooks ---

interface GrafanaSettingsResponse {
  url: string;
  datasourceId: string;
  hasToken: boolean;
}

export function useGrafanaConfig(contextName: string) {
  return useQuery<GrafanaSettingsResponse>({
    queryKey: ["grafana-config", contextName],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/grafana/settings`
      );
      if (!res.ok) throw new Error("Failed to fetch Grafana config");
      return res.json();
    },
    enabled: !!contextName,
  });
}

export function useSaveGrafanaConfig(contextName: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: {
      url: string;
      serviceAccountToken: string;
      datasourceId: string;
    }) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/grafana/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        }
      );
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["grafana-config", contextName],
      });
    },
  });
}

interface ConnectionTestResponse {
  ok: boolean;
  error?: string;
  metrics?: {
    containerCpu: boolean;
    containerMemory: boolean;
    nodeCpu: boolean;
    nodeMemory: boolean;
  };
}

export function useTestGrafanaConnection(contextName: string) {
  return useMutation<ConnectionTestResponse>({
    mutationFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/grafana/settings`,
        { method: "POST" }
      );
      const body = await res.json();
      if (!body.ok) {
        throw new Error(body.error || "Connection test failed");
      }
      return body as ConnectionTestResponse;
    },
  });
}

// --- Metrics hooks ---

export interface HistoricalMetrics {
  cpu: PrometheusSeries[];
  memory: PrometheusSeries[];
  queries: string[];
}

async function fetchGrafanaMetrics(
  contextName: string,
  queries: string[],
  timeRange: TimeRange
): Promise<{ series: PrometheusSeries[][]; queries: string[] }> {
  const res = await fetch(
    `/api/clusters/${encodeURIComponent(contextName)}/plugins/grafana/query`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries, timeRange }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to fetch metrics");
  }
  return res.json();
}

export function usePodHistoricalMetrics(
  contextName: string,
  podName: string,
  namespace: string,
  timeRange: TimeRange,
  enabled: boolean
) {
  return useQuery<HistoricalMetrics>({
    queryKey: [
      "grafana-pod-metrics",
      contextName,
      podName,
      namespace,
      timeRange,
    ],
    queryFn: async () => {
      const queries = [
        podCpuQuery(podName, namespace),
        podMemoryQuery(podName, namespace),
      ];
      const data = await fetchGrafanaMetrics(contextName, queries, timeRange);
      return {
        cpu: data.series[0] ?? [],
        memory: data.series[1] ?? [],
        queries: data.queries,
      };
    },
    enabled: !!contextName && !!podName && enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useNodeHistoricalMetrics(
  contextName: string,
  nodeName: string,
  timeRange: TimeRange,
  enabled: boolean
) {
  return useQuery<HistoricalMetrics>({
    queryKey: ["grafana-node-metrics", contextName, nodeName, timeRange],
    queryFn: async () => {
      const queries = [nodeCpuQuery(nodeName), nodeMemoryQuery(nodeName)];
      const data = await fetchGrafanaMetrics(contextName, queries, timeRange);
      return {
        cpu: data.series[0] ?? [],
        memory: data.series[1] ?? [],
        queries: data.queries,
      };
    },
    enabled: !!contextName && !!nodeName && enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export { type TimeRange } from "./queries";
