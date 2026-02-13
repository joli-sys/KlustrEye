"use client";

import { use, useMemo } from "react";
import { useResources, useDeleteResource } from "@/hooks/use-resources";
import { useNodeMetrics } from "@/hooks/use-metrics";
import { ResourceTable, nameColumn, ageColumn, statusBadge } from "@/components/resource-table";
import { Badge } from "@/components/ui/badge";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { useToast } from "@/components/ui/toast";

function UsageBar({ pct, used, total }: { pct: number; used: string; total: string }) {
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-xs tabular-nums w-12 text-right">{pct.toFixed(0)}%</span>
      </div>
      <span className="text-xs text-muted-foreground">{used} / {total}</span>
    </div>
  );
}

export default function NodesPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { data, isLoading } = useResources(ctx, "nodes");
  const { data: metricsData } = useNodeMetrics(ctx);
  const deleteMutation = useDeleteResource(ctx, "nodes");
  const { addToast } = useToast();

  const metricsMap = useMemo(() => {
    const map = new Map<string, { cpu: string; memory: string }>();
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (items) {
      for (const item of items) {
        const meta = item.metadata as Record<string, unknown>;
        const usage = item.usage as Record<string, string>;
        if (meta?.name && usage) {
          map.set(meta.name as string, { cpu: usage.cpu, memory: usage.memory });
        }
      }
    }
    return map;
  }, [metricsData]);

  const columns: ColumnDef<Record<string, unknown>>[] = useMemo(() => [
    nameColumn(),
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => {
        const conditions = ((row.status as Record<string, unknown>)?.conditions as Record<string, unknown>[]) || [];
        const ready = conditions.find((c) => c.type === "Ready");
        return ready?.status === "True" ? "Ready" : "NotReady";
      },
      cell: ({ getValue }) => statusBadge(getValue() as string),
    },
    {
      id: "roles",
      header: "Roles",
      accessorFn: (row) => {
        const labels = (row.metadata as Record<string, unknown>)?.labels as Record<string, unknown>;
        if (!labels) return "-";
        const roles: string[] = [];
        for (const key of Object.keys(labels)) {
          if (key.startsWith("node-role.kubernetes.io/")) {
            roles.push(key.replace("node-role.kubernetes.io/", ""));
          }
        }
        return roles.length > 0 ? roles.join(", ") : "-";
      },
    },
    {
      id: "instance_type",
      header: "Instance Type",
      accessorFn: (row) => {
        const labels = (row.metadata as Record<string, unknown>)?.labels as Record<string, string> | undefined;
        if (!labels) return "-";
        return labels["node.kubernetes.io/instance-type"] || labels["beta.kubernetes.io/instance-type"] || "-";
      },
      cell: ({ getValue }) => {
        const val = getValue() as string;
        if (val === "-") return <span className="text-muted-foreground text-xs">-</span>;
        return <span className="font-mono text-xs">{val}</span>;
      },
    },
    {
      id: "capacity_type",
      header: "Capacity Type",
      accessorFn: (row) => {
        const labels = (row.metadata as Record<string, unknown>)?.labels as Record<string, string> | undefined;
        if (!labels) return "-";
        return labels["karpenter.sh/capacity-type"] || labels["eks.amazonaws.com/capacityType"] || "-";
      },
      cell: ({ getValue }) => {
        const val = (getValue() as string).toLowerCase();
        if (val === "-") return <span className="text-muted-foreground text-xs">-</span>;
        if (val === "spot") return <Badge variant="warning">spot</Badge>;
        return <Badge variant="secondary">{val}</Badge>;
      },
    },
    {
      id: "cpu",
      header: "CPU",
      accessorFn: (row) => {
        const name = (row.metadata as Record<string, unknown>)?.name as string;
        const metrics = metricsMap.get(name);
        if (!metrics) return -1;
        const allocatable = (row.status as Record<string, unknown>)?.allocatable as Record<string, string>;
        const usedCores = parseCpuValue(metrics.cpu);
        const totalCores = parseCpuValue(allocatable?.cpu || "0");
        return totalCores > 0 ? (usedCores / totalCores) * 100 : 0;
      },
      cell: ({ getValue, row }) => {
        const pct = getValue() as number;
        if (pct < 0) return <span className="text-muted-foreground text-xs">-</span>;
        const name = (row.original.metadata as Record<string, unknown>)?.name as string;
        const metrics = metricsMap.get(name);
        const allocatable = (row.original.status as Record<string, unknown>)?.allocatable as Record<string, string>;
        return (
          <UsageBar
            pct={pct}
            used={metrics ? formatCpu(parseCpuValue(metrics.cpu)) : "?"}
            total={allocatable ? formatCpu(parseCpuValue(allocatable.cpu)) : "?"}
          />
        );
      },
    },
    {
      id: "memory",
      header: "Memory",
      accessorFn: (row) => {
        const name = (row.metadata as Record<string, unknown>)?.name as string;
        const metrics = metricsMap.get(name);
        if (!metrics) return -1;
        const allocatable = (row.status as Record<string, unknown>)?.allocatable as Record<string, string>;
        const usedBytes = parseMemoryValue(metrics.memory);
        const totalBytes = parseMemoryValue(allocatable?.memory || "0");
        return totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
      },
      cell: ({ getValue, row }) => {
        const pct = getValue() as number;
        if (pct < 0) return <span className="text-muted-foreground text-xs">-</span>;
        const name = (row.original.metadata as Record<string, unknown>)?.name as string;
        const metrics = metricsMap.get(name);
        const allocatable = (row.original.status as Record<string, unknown>)?.allocatable as Record<string, string>;
        return (
          <UsageBar
            pct={pct}
            used={metrics ? formatBytes(parseMemoryValue(metrics.memory)) : "?"}
            total={allocatable ? formatBytes(parseMemoryValue(allocatable.memory)) : "?"}
          />
        );
      },
    },
    {
      id: "ephemeral_storage",
      header: "Ephemeral Storage",
      accessorFn: (row) => {
        const allocatable = (row.status as Record<string, unknown>)?.allocatable as Record<string, string> | undefined;
        if (!allocatable?.["ephemeral-storage"]) return -1;
        return parseMemoryValue(allocatable["ephemeral-storage"]);
      },
      cell: ({ row }) => {
        const status = row.original.status as Record<string, unknown>;
        const capacity = (status?.capacity as Record<string, string>) || {};
        const allocatable = (status?.allocatable as Record<string, string>) || {};
        const capVal = capacity["ephemeral-storage"];
        const allocVal = allocatable["ephemeral-storage"];
        if (!capVal && !allocVal) return <span className="text-muted-foreground text-xs">-</span>;
        const allocBytes = allocVal ? parseMemoryValue(allocVal) : 0;
        const capBytes = capVal ? parseMemoryValue(capVal) : 0;
        const pct = capBytes > 0 ? ((capBytes - allocBytes) / capBytes) * 100 : 0;
        return (
          <UsageBar
            pct={pct}
            used={formatBytes(capBytes - allocBytes)}
            total={formatBytes(capBytes)}
          />
        );
      },
    },
    {
      id: "k8s_version",
      header: "K8s Version",
      accessorFn: (row) => {
        const info = (row.status as Record<string, unknown>)?.nodeInfo as Record<string, unknown> | undefined;
        return info?.kubeletVersion || "-";
      },
    },
    {
      id: "taints",
      header: "Taints",
      accessorFn: (row) => {
        const spec = row.spec as Record<string, unknown> | undefined;
        const taints = spec?.taints as Record<string, string>[] | undefined;
        if (!taints || taints.length === 0) return "-";
        return taints.map((t) => `${t.key}=${t.value || ""}:${t.effect}`).join(", ");
      },
      cell: ({ getValue }) => {
        const val = getValue() as string;
        if (val === "-") return <span className="text-muted-foreground text-xs">-</span>;
        const taints = val.split(", ");
        return (
          <div className="flex flex-wrap gap-1">
            {taints.map((t, i) => (
              <span key={i} className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs">
                {t}
              </span>
            ))}
          </div>
        );
      },
    },
    ageColumn(),
  ], [metricsMap]);

  const handleDelete = async (item: Record<string, unknown>) => {
    const metadata = item.metadata as Record<string, unknown>;
    const name = metadata?.name as string;
    if (!confirm(`Delete Node "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ name, namespace: "" });
      addToast({ title: "Deleted Node", description: name, variant: "success" });
    } catch (err) {
      addToast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleBatchDelete = async (items: Record<string, unknown>[]) => {
    const names = items.map((item) => {
      const metadata = item.metadata as Record<string, unknown>;
      return metadata?.name as string;
    });

    if (!confirm(`Delete ${items.length} Nodes?\n\n${names.join("\n")}`)) return;

    let failed = 0;
    for (const item of items) {
      const metadata = item.metadata as Record<string, unknown>;
      try {
        await deleteMutation.mutateAsync({
          name: metadata?.name as string,
          namespace: "",
        });
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      addToast({ title: `Deleted ${items.length} Nodes`, variant: "success" });
    } else {
      addToast({
        title: `Deleted ${items.length - failed} of ${items.length}`,
        description: `${failed} failed`,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Nodes</h1>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind="Nodes"
        resourceKind="nodes"
        onDelete={handleDelete}
        onBatchDelete={handleBatchDelete}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          return `/clusters/${encodeURIComponent(ctx)}/nodes/${metadata.name}`;
        }}
      />
    </div>
  );
}
