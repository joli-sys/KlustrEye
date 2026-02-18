"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "minAvailable",
    header: "Min Available",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      return spec?.minAvailable ?? "-";
    },
  },
  {
    id: "maxUnavailable",
    header: "Max Unavailable",
    accessorFn: (row) => {
      const spec = row.spec as Record<string, unknown> | undefined;
      return spec?.maxUnavailable ?? "-";
    },
  },
  {
    id: "currentHealthy",
    header: "Healthy",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      return status?.currentHealthy ?? 0;
    },
  },
  {
    id: "desiredHealthy",
    header: "Desired",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      return status?.desiredHealthy ?? 0;
    },
  },
  {
    id: "disruptionsAllowed",
    header: "Allowed Disruptions",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown> | undefined;
      return status?.disruptionsAllowed ?? 0;
    },
  },
  ageColumn(),
];

export default function PodDisruptionBudgetsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);

  return (
    <ResourceListPage
      contextName={ctx}
      kind="poddisruptionbudgets"
      columns={columns}
      detailLinkFn={(item) => {
        const metadata = item.metadata as Record<string, unknown>;
        return `/clusters/${encodeURIComponent(ctx)}/workloads/poddisruptionbudgets/${metadata.name}?ns=${metadata.namespace}`;
      }}
    />
  );
}
