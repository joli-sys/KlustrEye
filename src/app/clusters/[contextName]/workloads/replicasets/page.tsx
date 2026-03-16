import { useState } from "react";
import { useParams } from "react-router-dom";
import { ResourceListPage } from "@/components/resource-list-page";
import { ScaleDialog } from "@/components/scale-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "desired",
    header: "Desired",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.replicas || 0,
  },
  {
    id: "current",
    header: "Current",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.replicas || 0,
  },
  {
    id: "ready",
    header: "Ready",
    accessorFn: (row) => (row.status as Record<string, unknown>)?.readyReplicas || 0,
  },
  ageColumn(),
];

export default function ReplicaSetsPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const [scaleTarget, setScaleTarget] = useState<{
    name: string;
    namespace: string;
    replicas: number;
  } | null>(null);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="replicasets"
        columns={columns}
        onScale={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          const spec = item.spec as Record<string, unknown>;
          setScaleTarget({
            name: metadata?.name as string,
            namespace: metadata?.namespace as string,
            replicas: (spec?.replicas as number) || 0,
          });
        }}
      />
      {scaleTarget && (
        <ScaleDialog
          open={!!scaleTarget}
          onOpenChange={(open) => { if (!open) setScaleTarget(null); }}
          contextName={ctx}
          kind="replicasets"
          name={scaleTarget.name}
          namespace={scaleTarget.namespace}
          currentReplicas={scaleTarget.replicas}
        />
      )}
    </>
  );
}
