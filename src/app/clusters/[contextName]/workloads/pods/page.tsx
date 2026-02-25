"use client";

import { use, useMemo, useState } from "react";
import { useResources, useDeleteResource } from "@/hooks/use-resources";
import { usePodMetrics } from "@/hooks/use-metrics";
import { useClusterNamespace } from "@/hooks/use-cluster-namespace";
import { ResourceTable, nameColumn, namespaceColumn, ageColumn, statusBadge } from "@/components/resource-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu } from "@/lib/utils";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { useToast } from "@/components/ui/toast";
import { Plus, RefreshCw } from "lucide-react";
import Link from "next/link";

function UsageBar({ pct, used, total, req }: { pct: number; used: string; total: string; req?: string }) {
  return (
    <div className="min-w-[140px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct > 100 ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <span className="text-xs tabular-nums w-12 text-right">{pct.toFixed(0)}%</span>
      </div>
      <div className="text-xs text-muted-foreground">
        <span>{used} / {total}</span>
        {req && <span className="ml-1.5">req: {req}</span>}
      </div>
    </div>
  );
}

export default function PodsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const router = useRouter();
  const selectedNamespace = useClusterNamespace(ctx);
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;
  const { data, isLoading, refetch, isFetching } = useResources(ctx, "pods", ns);
  const { data: metricsData } = usePodMetrics(ctx, ns);
  const deleteMutation = useDeleteResource(ctx, "pods");
  const { addToast } = useToast();

  const metricsMap = useMemo(() => {
    const map = new Map<string, { cpu: number; memory: number }>();
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (items) {
      for (const item of items) {
        const meta = item.metadata as Record<string, unknown>;
        const containers = item.containers as Record<string, unknown>[] | undefined;
        if (!meta?.name || !containers) continue;
        const key = `${meta.namespace}/${meta.name}`;
        let totalCpu = 0;
        let totalMem = 0;
        for (const c of containers) {
          const usage = c.usage as Record<string, string>;
          if (usage?.cpu) totalCpu += parseCpuValue(usage.cpu);
          if (usage?.memory) totalMem += parseMemoryValue(usage.memory);
        }
        map.set(key, { cpu: totalCpu, memory: totalMem });
      }
    }
    return map;
  }, [metricsData]);

  function getPodResources(row: Record<string, unknown>) {
    const spec = row.spec as Record<string, unknown>;
    const containers = (spec?.containers as Record<string, unknown>[]) || [];
    let cpuReq = 0, cpuLim = 0, memReq = 0, memLim = 0;
    let hasCpuReq = false, hasCpuLim = false, hasMemReq = false, hasMemLim = false;
    for (const c of containers) {
      const resources = c.resources as Record<string, unknown> | undefined;
      const requests = resources?.requests as Record<string, string> | undefined;
      const limits = resources?.limits as Record<string, string> | undefined;
      if (requests?.cpu) { cpuReq += parseCpuValue(requests.cpu); hasCpuReq = true; }
      if (limits?.cpu) { cpuLim += parseCpuValue(limits.cpu); hasCpuLim = true; }
      if (requests?.memory) { memReq += parseMemoryValue(requests.memory); hasMemReq = true; }
      if (limits?.memory) { memLim += parseMemoryValue(limits.memory); hasMemLim = true; }
    }
    return {
      cpuReq: hasCpuReq ? cpuReq : null,
      cpuLim: hasCpuLim ? cpuLim : null,
      memReq: hasMemReq ? memReq : null,
      memLim: hasMemLim ? memLim : null,
    };
  }

  const columns: ColumnDef<Record<string, unknown>>[] = useMemo(() => [
    nameColumn(),
    { ...namespaceColumn(), meta: { className: "hidden xl:table-cell" } },
    {
      id: "ready",
      header: "Ready",
      accessorFn: (row) => {
        const status = row.status as Record<string, unknown>;
        const containers = (status?.containerStatuses as Record<string, unknown>[]) || [];
        const ready = containers.filter((c) => c.ready).length;
        return `${ready}/${containers.length}`;
      },
    },
    {
      id: "status",
      header: "Status",
      accessorFn: (row) => (row.status as Record<string, unknown>)?.phase,
      cell: ({ getValue }) => statusBadge(getValue() as string),
    },
    {
      id: "cpu",
      header: "CPU",
      meta: { className: "hidden lg:table-cell" },
      accessorFn: (row) => {
        const meta = row.metadata as Record<string, unknown>;
        const key = `${meta?.namespace}/${meta?.name}`;
        return metricsMap.get(key)?.cpu ?? -1;
      },
      cell: ({ getValue, row }) => {
        const cpu = getValue() as number;
        const res = getPodResources(row.original);
        if (cpu < 0) return <span className="text-muted-foreground text-xs">-</span>;
        const ref = res.cpuLim ?? res.cpuReq;
        if (ref && ref > 0) {
          const pct = (cpu / ref) * 100;
          return (
            <UsageBar
              pct={pct}
              used={formatCpu(cpu)}
              total={formatCpu(ref)}
              req={res.cpuLim !== null && res.cpuReq !== null ? formatCpu(res.cpuReq) : undefined}
            />
          );
        }
        return <span className="text-xs tabular-nums">{formatCpu(cpu)}</span>;
      },
    },
    {
      id: "memory",
      header: "Memory",
      meta: { className: "hidden lg:table-cell" },
      accessorFn: (row) => {
        const meta = row.metadata as Record<string, unknown>;
        const key = `${meta?.namespace}/${meta?.name}`;
        return metricsMap.get(key)?.memory ?? -1;
      },
      cell: ({ getValue, row }) => {
        const mem = getValue() as number;
        const res = getPodResources(row.original);
        if (mem < 0) return <span className="text-muted-foreground text-xs">-</span>;
        const ref = res.memLim ?? res.memReq;
        if (ref && ref > 0) {
          const pct = (mem / ref) * 100;
          return (
            <UsageBar
              pct={pct}
              used={formatBytes(mem)}
              total={formatBytes(ref)}
              req={res.memLim !== null && res.memReq !== null ? formatBytes(res.memReq) : undefined}
            />
          );
        }
        return <span className="text-xs tabular-nums">{formatBytes(mem)}</span>;
      },
    },
    {
      id: "restarts",
      header: "Restarts",
      meta: { className: "hidden xl:table-cell" },
      accessorFn: (row) => {
        const status = row.status as Record<string, unknown>;
        const containers = (status?.containerStatuses as Record<string, unknown>[]) || [];
        return containers.reduce((sum, c) => sum + ((c.restartCount as number) || 0), 0);
      },
    },
    {
      id: "node",
      header: "Node",
      meta: { className: "hidden xl:table-cell" },
      accessorFn: (row) => (row.spec as Record<string, unknown>)?.nodeName,
      cell: ({ getValue }) => {
        const nodeName = getValue() as string;
        if (!nodeName) return <span className="text-muted-foreground">-</span>;
        return (
          <Link
            href={`/clusters/${encodeURIComponent(ctx)}/nodes/${encodeURIComponent(nodeName)}`}
            className="text-primary hover:underline"
          >
            {nodeName}
          </Link>
        );
      },
    },
    ageColumn(),
  ], [metricsMap]);

  const handleDelete = async (item: Record<string, unknown>) => {
    const metadata = item.metadata as Record<string, unknown>;
    const name = metadata?.name as string;
    const namespace = metadata?.namespace as string;
    if (!confirm(`Delete Pod "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ name, namespace });
      addToast({ title: "Deleted Pod", description: name, variant: "success" });
    } catch (err) {
      addToast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleBatchDelete = async (items: Record<string, unknown>[]) => {
    const names = items.map((item) => {
      const metadata = item.metadata as Record<string, unknown>;
      return metadata?.name as string;
    });

    if (!confirm(`Delete ${items.length} Pods?\n\n${names.join("\n")}`)) return;

    let failed = 0;
    for (const item of items) {
      const metadata = item.metadata as Record<string, unknown>;
      try {
        await deleteMutation.mutateAsync({
          name: metadata?.name as string,
          namespace: (metadata?.namespace as string) || "",
        });
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      addToast({ title: `Deleted ${items.length} Pods`, variant: "success" });
    } else {
      addToast({
        title: `Deleted ${items.length - failed} of ${items.length}`,
        description: `${failed} failed`,
        variant: "destructive",
      });
    }
  };

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pods</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>
      </div>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind="Pods"
        resourceKind="pods"
        currentNamespace={ns ?? "__all__"}
        onDelete={handleDelete}
        onBatchDelete={handleBatchDelete}
        onLogs={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          router.push(`/clusters/${encodeURIComponent(ctx)}/workloads/pods/${metadata.name}?tab=logs&ns=${metadata.namespace}`);
        }}
        onTerminal={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          router.push(`/clusters/${encodeURIComponent(ctx)}/workloads/pods/${metadata.name}?tab=terminal&ns=${metadata.namespace}`);
        }}
        onEdit={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          router.push(`/clusters/${encodeURIComponent(ctx)}/workloads/pods/${metadata.name}?tab=yaml&ns=${metadata.namespace}`);
        }}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          return `/clusters/${encodeURIComponent(ctx)}/workloads/pods/${metadata.name}?ns=${metadata.namespace}`;
        }}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="pods"
      />
    </div>
  );
}
