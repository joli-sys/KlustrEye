"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { ScaleDialog } from "@/components/scale-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
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
  const [scaleTarget, setScaleTarget] = useState<{
    name: string;
    namespace: string;
    replicas: number;
  } | null>(null);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="deployments"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
        onScale={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          const spec = item.spec as Record<string, unknown>;
          setScaleTarget({
            name: metadata?.name as string,
            namespace: metadata?.namespace as string,
            replicas: (spec?.replicas as number) || 0,
          });
        }}
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
    </>
  );
}
