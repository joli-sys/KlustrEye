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
    id: "ready",
    header: "Ready",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown>;
      return `${status?.readyReplicas || 0}/${status?.replicas || 0}`;
    },
  },
  {
    id: "upToDate",
    header: "Up-to-date",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.updatedReplicas || 0,
  },
  {
    id: "available",
    header: "Available",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.availableReplicas || 0,
  },
  ageColumn(),
];

export default function DeploymentsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="deployments"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          return `/clusters/${encodeURIComponent(ctx)}/workloads/deployments/${metadata.name}?ns=${metadata.namespace}`;
        }}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="deployments"
      />
    </>
  );
}
