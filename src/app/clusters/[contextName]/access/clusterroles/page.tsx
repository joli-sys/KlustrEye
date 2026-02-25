"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  {
    id: "rules",
    header: "Rules",
    accessorFn: (row) => ((row.rules as unknown[]) || []).length,
  },
  ageColumn(),
];

export default function ClusterRolesPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="clusterroles" columns={columns} />;
}
