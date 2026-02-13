"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Badge } from "@/components/ui/badge";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "type",
    header: "Type",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.type,
    cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
  },
  {
    id: "clusterIP",
    header: "Cluster IP",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.clusterIP,
  },
  {
    id: "ports",
    header: "Ports",
    accessorFn: (row) => {
      const ports = (row.spec as Record<string, unknown>)?.ports as Record<string, unknown>[];
      if (!ports) return "-";
      return ports.map((p) => `${p.port}/${p.protocol}`).join(", ");
    },
  },
  ageColumn(),
];

export default function ServicesPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="services"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="services"
      />
    </>
  );
}
