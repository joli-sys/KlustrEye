import type { PluginResourceExtensionProps } from "@/lib/plugins/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CircleDollarSign, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useOpenCostSettings, useAllocation } from "./hooks";

function formatCost(v: number) {
  if (v === 0) return "$0.00";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function OpenCostPodExtension({ contextName, name, namespace }: PluginResourceExtensionProps) {
  const { data: settings } = useOpenCostSettings(contextName);
  const isConfigured =
    settings &&
    ((settings.metricsSource === "opencost" && !!settings.url) ||
      (settings.metricsSource === "prometheus" && !!settings.prometheusUrl) ||
      (settings.metricsSource === "mimir" && !!settings.grafanaConfigured));

  const { data, isLoading, error } = useAllocation(
    contextName,
    "1d",
    "pod",
    namespace,
    !!isConfigured
  );

  if (!isConfigured) return null;

  const podCost = extractPodCost(data, name, namespace);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <CircleDollarSign className="h-4 w-4 text-green-500" />
          Cost (last 24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex gap-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-5 w-24" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error.message}
          </div>
        ) : podCost ? (
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">CPU</span>
              <p className="font-mono font-medium">{formatCost(podCost.cpu)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Memory</span>
              <p className="font-mono font-medium">{formatCost(podCost.ram)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Total</span>
              <p className="font-mono font-semibold">{formatCost(podCost.total)}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No cost data available for this pod</p>
        )}
      </CardContent>
    </Card>
  );
}

export function OpenCostNodeExtension({ contextName, name }: PluginResourceExtensionProps) {
  const { data: settings } = useOpenCostSettings(contextName);
  const isConfigured =
    settings &&
    ((settings.metricsSource === "opencost" && !!settings.url) ||
      (settings.metricsSource === "prometheus" && !!settings.prometheusUrl) ||
      (settings.metricsSource === "mimir" && !!settings.grafanaConfigured));

  const { data, isLoading, error } = useAllocation(
    contextName,
    "1d",
    "node",
    undefined,
    !!isConfigured
  );

  if (!isConfigured) return null;

  const nodeCost = extractNodeCost(data, name);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-1.5">
          <CircleDollarSign className="h-4 w-4 text-green-500" />
          Cost (last 24h)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-5 w-32" />
        ) : error ? (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            {error.message}
          </div>
        ) : nodeCost ? (
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">CPU</span>
              <p className="font-mono font-medium">{formatCost(nodeCost.cpu)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Memory</span>
              <p className="font-mono font-medium">{formatCost(nodeCost.ram)}</p>
            </div>
            <div>
              <span className="text-muted-foreground text-xs">Total</span>
              <p className="font-mono font-semibold">{formatCost(nodeCost.total)}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No cost data available for this node</p>
        )}
      </CardContent>
    </Card>
  );
}

function extractPodCost(data: unknown, podName: string, namespace?: string) {
  if (!data) return null;
  const d = data as Record<string, unknown>;

  // OpenCost direct API
  if (d.data && Array.isArray(d.data)) {
    const allocs = (d.data as Record<string, unknown>[])[0] || {};
    // OpenCost key format: "namespace/pod"
    const key = namespace ? `${namespace}/${podName}` : podName;
    const val = (allocs[key] as Record<string, number>) || (allocs[podName] as Record<string, number>);
    if (!val) return null;
    return { cpu: val.cpuCost ?? 0, ram: val.ramCost ?? 0, total: val.totalCost ?? 0 };
  }

  // Prometheus/Mimir
  if (d.total) {
    return extractPrometheusMetric(d, podName, "pod");
  }

  return null;
}

function extractNodeCost(data: unknown, nodeName: string) {
  if (!data) return null;
  const d = data as Record<string, unknown>;

  // OpenCost direct API (assets endpoint)
  if (d.data && Array.isArray(d.data)) {
    const assets = (d.data as Record<string, unknown>[])[0] || {};
    const val = (assets[nodeName] as Record<string, number>);
    if (!val) return null;
    return { cpu: val.cpuCost ?? 0, ram: val.ramCost ?? 0, total: val.totalCost ?? 0 };
  }

  // Prometheus/Mimir
  if (d.total) {
    return extractPrometheusMetric(d, nodeName, "node");
  }

  return null;
}

function extractPrometheusMetric(d: Record<string, unknown>, name: string, labelKey: string) {
  const getVal = (result: unknown) => {
    const data = (result as Record<string, unknown>)?.data as Record<string, unknown>;
    const items = (data?.result as Record<string, unknown>[]) ?? [];
    const item = items.find((i) => (i.metric as Record<string, string>)[labelKey] === name);
    if (!item) return 0;
    const values = item.values as [number, string][];
    const last = values?.[values.length - 1]?.[1] ?? (item.value as [number, string])?.[1] ?? "0";
    return parseFloat(last as string);
  };

  return {
    cpu: getVal(d.cpu),
    ram: getVal(d.ram),
    total: getVal(d.total),
  };
}
