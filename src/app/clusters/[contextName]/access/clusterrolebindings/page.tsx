"use client";

import { use } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { nameColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  {
    id: "roleRef",
    header: "Role Ref",
    accessorFn: (row) => {
      const ref = row.roleRef as { kind?: string; name?: string } | undefined;
      return ref ? `${ref.kind}/${ref.name}` : "-";
    },
  },
  {
    id: "subjects",
    header: "Subjects",
    accessorFn: (row) => ((row.subjects as unknown[]) || []).length,
  },
  ageColumn(),
];

export default function ClusterRoleBindingsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="clusterrolebindings" columns={columns} />;
}
