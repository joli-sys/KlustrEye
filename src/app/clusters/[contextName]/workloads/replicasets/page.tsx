"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "desired",
    header: "Desired",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.replicas || 0,
  },
  {
    id: "current",
    header: "Current",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.replicas || 0,
  },
  {
    id: "ready",
    header: "Ready",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.readyReplicas || 0,
  },
  ageColumn(),
];

export default function ReplicaSetsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="replicasets" columns={columns} />;
}
