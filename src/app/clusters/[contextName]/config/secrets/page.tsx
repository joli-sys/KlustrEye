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
    accessorFn: (row) => row.type,
    cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>,
  },
  {
    id: "keys",
    header: "Data Keys",
    accessorFn: (row) => {
      const data = row.data as Record<string, unknown>;
      return data ? Object.keys(data).length : 0;
    },
  },
  ageColumn(),
];

export default function SecretsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="secrets"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="secrets"
      />
    </>
  );
}
