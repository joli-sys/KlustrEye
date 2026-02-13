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
    id: "completions",
    header: "Completions",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown>;
      const spec = row.spec as Record<string, unknown>;
      return `${status?.succeeded || 0}/${spec?.completions || 1}`;
    },
  },
  {
    id: "status",
    header: "Status",
    accessorFn: (row) => {
      const status = row.status as Record<string, unknown>;
      const conditions = (status?.conditions as Record<string, unknown>[]) || [];
      const complete = conditions.find((c) => c.type === "Complete" && c.status === "True");
      const failed = conditions.find((c) => c.type === "Failed" && c.status === "True");
      if (complete) return "Complete";
      if (failed) return "Failed";
      return "Running";
    },
    cell: ({ getValue }) => statusBadge(getValue() as string),
  },
  ageColumn(),
];

export default function JobsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="jobs"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="jobs"
      />
    </>
  );
}
