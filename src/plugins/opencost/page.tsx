import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleDollarSign, AlertCircle } from "lucide-react";
import { useOpenCostSettings, useAllocation, useAssets } from "./hooks";
import type { CostWindow } from "./hooks";
import { OpenCostSettingsPanel } from "./settings-panel";

const WINDOWS: { label: string; value: CostWindow }[] = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "1d", value: "1d" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function CostRow({ name, cpu, ram, total }: { name: string; cpu: number; ram: number; total: number }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm gap-4">
      <span className="font-mono text-xs truncate min-w-0 flex-1">{name}</span>
      <div className="flex gap-6 shrink-0 tabular-nums">
        <span className="text-muted-foreground w-20 text-right">{formatCost(cpu)}</span>
        <span className="text-muted-foreground w-20 text-right">{formatCost(ram)}</span>
        <span className="font-medium w-20 text-right">{formatCost(total)}</span>
      </div>
    </div>
  );
}

function AllocationTable({
  contextName,
  window,
  aggregate,
  enabled,
}: {
  contextName: string;
  window: CostWindow;
  aggregate: "namespace" | "pod" | "node";
  enabled: boolean;
}) {
  const { data, isLoading, error } = useAllocation(contextName, window, aggregate, undefined, enabled);

  if (isLoading) return (
    <div className="space-y-2">
      {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
    </div>
  );

  if (error) return (
    <div className="flex items-center gap-2 text-sm text-destructive p-4">
      <AlertCircle className="h-4 w-4 shrink-0" />
      {error.message}
    </div>
  );

  // Parse OpenCost direct API response: { code, data: [{ allocations: {...} }] }
  // or Prometheus response: { cpu: {...}, ram: {...}, total: {...} }
  const rows = parseAllocationRows(data, aggregate);

  if (rows.length === 0) return (
    <p className="text-sm text-muted-foreground p-4 text-center">No cost data found for this window</p>
  );

  const grandTotal = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0 pb-1 border-b mb-1">
        <span className="flex-1">Name</span>
        <div className="flex gap-6 shrink-0">
          <span className="w-20 text-right">CPU</span>
          <span className="w-20 text-right">Memory</span>
          <span className="w-20 text-right">Total</span>
        </div>
      </div>
      {rows.map((r) => (
        <CostRow key={r.name} name={r.name} cpu={r.cpu} ram={r.ram} total={r.total} />
      ))}
      <div className="flex items-center justify-between pt-2 text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatCost(grandTotal)}</span>
      </div>
    </div>
  );
}

function parseAllocationRows(data: unknown, aggregate: string) {
  if (!data) return [];

  // OpenCost direct API: { code: 200, data: [{ "namespace/pod": { cpuCost, ramCost, totalCost } }] }
  const d = data as Record<string, unknown>;
  if (d.data && Array.isArray(d.data)) {
    const allocs = (d.data as Record<string, unknown>[])[0] || {};
    return Object.entries(allocs)
      .filter(([name]) => name !== "__idle__")
      .map(([name, val]) => {
        const v = val as Record<string, number>;
        return { name, cpu: v.cpuCost ?? 0, ram: v.ramCost ?? 0, total: v.totalCost ?? 0 };
      })
      .sort((a, b) => b.total - a.total);
  }

  // Prometheus/Mimir response: { cpu: { data: { result: [...] } }, ram: {...}, total: {...} }
  if (d.total) {
    const labelKey = aggregate === "pod" ? "pod" : aggregate === "node" ? "node" : "namespace";
    const totalResult = (d.total as Record<string, unknown>)?.data as Record<string, unknown>;
    const cpuResult = (d.cpu as Record<string, unknown>)?.data as Record<string, unknown>;
    const ramResult = (d.ram as Record<string, unknown>)?.data as Record<string, unknown>;

    const getValues = (result: Record<string, unknown> | undefined) => {
      const items = (result?.result as Record<string, unknown>[] | undefined) ?? [];
      return Object.fromEntries(
        items.map((item) => {
          const metric = item.metric as Record<string, string>;
          const values = item.values as [number, string][];
          const last = values?.[values.length - 1]?.[1] ?? (item.value as [number, string])?.[1] ?? "0";
          return [metric[labelKey] ?? "unknown", parseFloat(last as string)];
        })
      );
    };

    const totals = getValues(totalResult);
    const cpus = getValues(cpuResult);
    const rams = getValues(ramResult);

    return Object.entries(totals)
      .map(([name, total]) => ({ name, cpu: cpus[name] ?? 0, ram: rams[name] ?? 0, total }))
      .sort((a, b) => b.total - a.total);
  }

  return [];
}

export function OpenCostPage({ contextName }: { contextName: string }) {
  const { data: settings, isLoading } = useOpenCostSettings(contextName);
  const [window, setWindow] = useState<CostWindow>("1d");
  const [tab, setTab] = useState<"namespace" | "pod" | "node">("namespace");

  const isConfigured = useMemo(() => {
    if (!settings) return false;
    if (settings.metricsSource === "opencost") return !!settings.url;
    if (settings.metricsSource === "mimir") return !!settings.grafanaConfigured;
    return !!settings.prometheusUrl;
  }, [settings]);

  if (isLoading) return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CircleDollarSign className="h-5 w-5 text-green-500" />
        <h1 className="text-2xl font-bold">OpenCost</h1>
        {settings && (
          <Badge variant={isConfigured ? "success" : "secondary"}>
            {isConfigured
              ? settings.metricsSource === "opencost"
                ? "OpenCost API"
                : settings.metricsSource === "mimir"
                ? "Grafana"
                : "Prometheus"
              : "Not configured"}
          </Badge>
        )}
      </div>

      {!isConfigured ? (
        <div className="max-w-xl">
          <OpenCostSettingsPanel contextName={contextName} />
        </div>
      ) : (
        <>
          {/* Window selector */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Window:</span>
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  window === w.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>

          {/* Tab selector */}
          <div className="flex border-b">
            {(["namespace", "pod", "node"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors -mb-px ${
                  tab === t
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "namespace" ? "Namespaces" : t === "pod" ? "Pods" : "Nodes"}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground capitalize">
                Cost by {tab} — last {window}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AllocationTable
                contextName={contextName}
                window={window}
                aggregate={tab}
                enabled={isConfigured}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
