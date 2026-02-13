"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { nameColumn, namespaceColumn, ageColumn, statusBadge } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.phase,
    cell: ({ getValue }) => statusBadge(getValue() as string),
  },
  {
    id: "volume",
    header: "Volume",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.volumeName || "-",
  },
  {
    id: "capacity",
    header: "Capacity",
    accessorFn: (row) => {
      const cap = (row.status as Record<string, unknown>)?.capacity as Record<string, unknown>;
      return (cap?.storage as string) || "-";
    },
  },
  {
    id: "storageClass",
    header: "StorageClass",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.storageClassName || "-",
  },
  ageColumn(),
];

export default function PVCsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="persistentvolumeclaims"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="persistentvolumeclaims"
      />
    </>
  );
}
