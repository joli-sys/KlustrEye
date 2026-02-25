"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "rules",
    header: "Rules",
    accessorFn: (row) => ((row.rules as unknown[]) || []).length,
  },
  ageColumn(),
];

export default function RolesPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="roles" columns={columns} />;
}
