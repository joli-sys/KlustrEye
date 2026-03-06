"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { TriggerCronJobDialog } from "@/components/trigger-cronjob-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

export default function CronJobsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);
  const [triggerTarget, setTriggerTarget] = useState<{ name: string; namespace: string } | null>(null);

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
    {
      id: "trigger",
      header: "",
      cell: ({ row }) => {
        const metadata = row.original.metadata as Record<string, unknown>;
        return (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              setTriggerTarget({
                name: metadata.name as string,
                namespace: metadata.namespace as string,
              });
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Trigger
          </Button>
        );
      },
      size: 100,
    },
  ];

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
      {triggerTarget && (
        <TriggerCronJobDialog
          open={!!triggerTarget}
          onOpenChange={(open) => { if (!open) setTriggerTarget(null); }}
          contextName={ctx}
          name={triggerTarget.name}
          namespace={triggerTarget.namespace}
        />
      )}
    </>
  );
}
