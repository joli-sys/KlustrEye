"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUIStore } from "@/lib/stores/ui-store";
import { ResourceTable, nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

function useVPAs(contextName: string, namespace?: string) {
  return useQuery<Record<string, unknown>[]>({
    queryKey: ["vpas", contextName, namespace],
    queryFn: async () => {
      const base = `/api/clusters/${encodeURIComponent(contextName)}/custom-resources/autoscaling.k8s.io/v1/verticalpodautoscalers`;
      const url = namespace ? `${base}?namespace=${encodeURIComponent(namespace)}` : base;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items ?? [];
    },
    enabled: !!contextName,
  });
}

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "target",
    header: "Target",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      const ref = spec?.targetRef as Record<string, unknown> | undefined;
      if (!ref) return "-";
      return `${ref.kind}/${ref.name}`;
    },
  },
  {
    id: "updateMode",
    header: "Update Mode",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      const policy = spec?.updatePolicy as Record<string, unknown> | undefined;
      return (policy?.updateMode as string) ?? "Auto";
    },
  },
  {
    id: "cpu",
    header: "CPU Target",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      const rec = status?.recommendation as Record<string, unknown> | undefined;
      const containers = rec?.containerRecommendations as Record<string, unknown>[] | undefined;
      if (!containers || containers.length === 0) return "-";
      const target = containers[0].target as Record<string, string> | undefined;
      return target?.cpu ?? "-";
    },
  },
  {
    id: "memory",
    header: "Memory Target",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      const rec = status?.recommendation as Record<string, unknown> | undefined;
      const containers = rec?.containerRecommendations as Record<string, unknown>[] | undefined;
      if (!containers || containers.length === 0) return "-";
      const target = containers[0].target as Record<string, string> | undefined;
      return target?.memory ?? "-";
    },
  },
  ageColumn(),
];

export default function VPAPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { selectedNamespace } = useUIStore();
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;
  const { data, isLoading, refetch, isFetching } = useVPAs(ctx, ns);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">VerticalPodAutoscalers</h1>
        <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind="VerticalPodAutoscalers"
        resourceKind="pods"
        currentNamespace={ns ?? "__all__"}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          return `/clusters/${encodeURIComponent(ctx)}/workloads/vpa/${metadata.name}?ns=${metadata.namespace}`;
        }}
      />
    </div>
  );
}
