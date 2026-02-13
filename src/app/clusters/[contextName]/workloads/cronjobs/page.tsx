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
    id: "schedule",
    header: "Schedule",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.schedule,
  },
  {
    id: "suspend",
    header: "Suspend",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.suspend ? "Yes" : "No",
  },
  {
    id: "active",
    header: "Active",
    accessorFn: (row) => ((row.status as Record<string, unknown>)?.active as unknown[] || []).length,
  },
  {
    id: "lastSchedule",
    header: "Last Schedule",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.lastScheduleTime || "-",
  },
  ageColumn(),
];

export default function CronJobsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="cronjobs"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="cronjobs"
      />
    </>
  );
}
