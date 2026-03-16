import { useState } from "react";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
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

export default function ConfigMapsPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="configmaps"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="configmaps"
      />
    </>
  );
}
