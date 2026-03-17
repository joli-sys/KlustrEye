import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type MetricsSource = "opencost" | "prometheus" | "mimir";
export type CostWindow = "1h" | "6h" | "12h" | "1d" | "2d" | "7d" | "30d";

export interface OpenCostSettings {
  url: string;
  hasToken: boolean;
  metricsSource: MetricsSource;
  prometheusUrl: string;
  hasPrometheusToken: boolean;
  grafanaConfigured: boolean;
}

export function useOpenCostSettings(contextName: string) {
  return useQuery<OpenCostSettings>({
    queryKey: ["opencost-settings", contextName],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/opencost/settings`
      );
      if (!res.ok) throw new Error("Failed to fetch OpenCost settings");
      return res.json();
    },
    enabled: !!contextName,
  });
}

export function useSaveOpenCostSettings(contextName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      url?: string;
      token?: string;
      metricsSource?: MetricsSource;
      prometheusUrl?: string;
      prometheusToken?: string;
    }) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/opencost/settings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opencost-settings", contextName] });
    },
  });
}

export function useTestOpenCostConnection(contextName: string) {
  return useMutation<{ ok: boolean; error?: string; hasOpenCostMetrics?: boolean }>({
    mutationFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/opencost/settings`,
        { method: "POST" }
      );
      return res.json();
    },
  });
}

// --- Cost data ---

export interface AllocationSet {
  [name: string]: {
    cpuCost: number;
    ramCost: number;
    pvCost: number;
    networkCost: number;
    totalCost: number;
    cpuCoreHours?: number;
    ramByteHours?: number;
  };
}

export function useAllocation(
  contextName: string,
  window: CostWindow,
  aggregate: "namespace" | "pod" | "node",
  namespace?: string,
  enabled = true
) {
  return useQuery({
    queryKey: ["opencost-allocation", contextName, window, aggregate, namespace],
    queryFn: async () => {
      const params = new URLSearchParams({ window, aggregate });
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/opencost/allocation?${params}`
      );
      if (!res.ok) throw new Error("Failed to fetch allocation");
      return res.json();
    },
    enabled: !!contextName && enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useAssets(contextName: string, window: CostWindow, enabled = true) {
  return useQuery({
    queryKey: ["opencost-assets", contextName, window],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/plugins/opencost/assets?window=${window}`
      );
      if (!res.ok) throw new Error("Failed to fetch assets");
      return res.json();
    },
    enabled: !!contextName && enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
