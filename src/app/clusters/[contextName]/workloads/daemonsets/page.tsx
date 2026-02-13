"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "desired",
    header: "Desired",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.desiredNumberScheduled || 0,
  },
  {
    id: "current",
    header: "Current",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.currentNumberScheduled || 0,
  },
  {
    id: "ready",
    header: "Ready",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.numberReady || 0,
  },
  ageColumn(),
];

export default function DaemonSetsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="daemonsets"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="daemonsets"
      />
    </>
  );
}
