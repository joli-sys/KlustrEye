"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

function getMetricDisplay(metrics: Record<string, unknown>[] | undefined): string {
  if (!metrics || metrics.length === 0) return "-";
  return metrics
    .map((m) => {
      const type = m.type as string;
      if (type === "Resource") {
        const res = m.resource as Record<string, unknown> | undefined;
        const name = res?.name as string;
        const target = res?.target as Record<string, unknown> | undefined;
        if (target?.averageUtilization != null) return `${name} @ ${target.averageUtilization}%`;
        if (target?.averageValue) return `${name} @ ${target.averageValue}`;
        return name;
      }
      return type;
    })
    .join(", ");
}

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "reference",
    header: "Target",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      const ref = spec?.scaleTargetRef as Record<string, unknown> | undefined;
      if (!ref) return "-";
      return `${ref.kind}/${ref.name}`;
    },
  },
  {
    id: "minReplicas",
    header: "Min",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      return spec?.minReplicas ?? "-";
    },
  },
  {
    id: "maxReplicas",
    header: "Max",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      return spec?.maxReplicas ?? "-";
    },
  },
  {
    id: "currentReplicas",
    header: "Current",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      return status?.currentReplicas ?? 0;
    },
  },
  {
    id: "metrics",
    header: "Metrics",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      return getMetricDisplay(spec?.metrics as Record<string, unknown>[] | undefined);
    },
  },
  ageColumn(),
];

export default function HPAPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);

  return (
    <ResourceListPage
      contextName={ctx}
      kind="horizontalpodautoscalers"
      columns={columns}
      detailLinkFn={(item) => {
        const metadata = item.metadata as Record<string, unknown>;
        return `/clusters/${encodeURIComponent(ctx)}/workloads/hpa/${metadata.name}?ns=${metadata.namespace}`;
      }}
    />
  );
}
