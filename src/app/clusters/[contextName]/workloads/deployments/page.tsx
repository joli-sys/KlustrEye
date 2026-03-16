import { useState } from "react";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { ScaleDialog } from "@/components/scale-dialog";
import { RestartDialog } from "@/components/restart-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { Scaling, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

export default function DeploymentsPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleTarget, setScaleTarget] = useState<{
    name: string;
    namespace: string;
    replicas: number;
  } | null>(null);
  const [restartTarget, setRestartTarget] = useState<{
    name: string;
    namespace: string;
  } | null>(null);

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
    {
      id: "actions_custom",
      header: "",
      cell: ({ row }) => {
        const metadata = row.original.metadata as Record<string, unknown>;
        const spec = row.original.spec as Record<string, unknown>;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setScaleTarget({
                  name: metadata.name as string,
                  namespace: metadata.namespace as string,
                  replicas: (spec?.replicas as number) || 0,
                });
              }}
            >
              <Scaling className="h-3.5 w-3.5" />
              Scale
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setRestartTarget({
                  name: metadata.name as string,
                  namespace: metadata.namespace as string,
                });
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart
            </Button>
          </div>
        );
      },
      size: 180,
    },
  ];

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
      {scaleTarget && (
        <ScaleDialog
          open={!!scaleTarget}
          onOpenChange={(open) => { if (!open) setScaleTarget(null); }}
          contextName={ctx}
          kind="deployments"
          name={scaleTarget.name}
          namespace={scaleTarget.namespace}
          currentReplicas={scaleTarget.replicas}
        />
      )}
      {restartTarget && (
        <RestartDialog
          open={!!restartTarget}
          onOpenChange={(open) => { if (!open) setRestartTarget(null); }}
          contextName={ctx}
          kind="deployments"
          name={restartTarget.name}
          namespace={restartTarget.namespace}
        />
      )}
    </>
  );
}
