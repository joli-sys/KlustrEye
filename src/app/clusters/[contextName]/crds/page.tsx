"use client";

import { use } from "react";
import { useCRDs, type CRDDefinition } from "@/hooks/use-crds";
import { ResourceTable, ageColumn } from "@/components/resource-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  {
    id: "name",
    header: "Name",
    accessorFn: (row) => {
      const spec = row.spec as CRDDefinition["spec"];
      return spec?.names?.kind || "-";
    },
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue() as string}</span>
    ),
  },
  {
    id: "group",
    header: "Group",
    accessorFn: (row) => (row.spec as CRDDefinition["spec"])?.group,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-muted-foreground">{getValue() as string}</span>
    ),
  },
  {
    id: "version",
    header: "Version",
    accessorFn: (row) => {
      const spec = row.spec as CRDDefinition["spec"];
      return spec?.versions?.filter((v) => v.served).map((v) => v.name).join(", ") || "-";
    },
  },
  {
    id: "scope",
    header: "Scope",
    accessorFn: (row) => (row.spec as CRDDefinition["spec"])?.scope,
    cell: ({ getValue }) => (
      <Badge variant="secondary">{getValue() as string}</Badge>
    ),
  },
  {
    id: "plural",
    header: "Resource",
    accessorFn: (row) => (row.spec as CRDDefinition["spec"])?.names?.plural,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs">{getValue() as string}</span>
    ),
  },
  ageColumn(),
];

export default function CRDsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { data, isLoading, refetch, isFetching } = useCRDs(ctx);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Custom Resource Definitions</h1>
        <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </div>
      <ResourceTable
        data={(data as unknown as Record<string, unknown>[]) || []}
        isLoading={isLoading}
        columns={columns}
        kind="CRDs"
        detailLinkFn={(item) => {
          const crd = item as unknown as CRDDefinition;
          const version = crd.spec.versions.find((v) => v.storage)?.name || crd.spec.versions[0]?.name;
          return `/clusters/${encodeURIComponent(ctx)}/crds/${encodeURIComponent(crd.spec.group)}/${version}/${crd.spec.names.plural}?scope=${crd.spec.scope}`;
        }}
      />
    </div>
  );
}
