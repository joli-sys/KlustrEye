"use client";


import { useResources, useDeleteResource } from "@/hooks/use-resources";
import { useClusterNamespace } from "@/hooks/use-cluster-namespace";
import { ResourceTable, nameColumn, namespaceColumn, ageColumn, statusBadge } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { RESOURCE_REGISTRY, RESOURCE_ROUTE_MAP, getResourceHref, type ResourceKind } from "@/lib/constants";
import { Plus, RefreshCw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { useToast } from "@/components/ui/toast";

interface ResourceListPageProps {
  contextName: string;
  kind: ResourceKind;
  columns: ColumnDef<Record<string, unknown>>[];
  onEdit?: (item: Record<string, unknown>) => void;
  onCreate?: () => void;
  onTerminal?: (item: Record<string, unknown>) => void;
  onLogs?: (item: Record<string, unknown>) => void;
  detailLinkFn?: (item: Record<string, unknown>) => string;
}

export function ResourceListPage({
  contextName,
  kind,
  columns,
  onEdit,
  onCreate,
  onTerminal,
  onLogs,
  detailLinkFn,
}: ResourceListPageProps) {
  const entry = RESOURCE_REGISTRY[kind];
  const routeEntry = RESOURCE_ROUTE_MAP[kind];
  const defaultDetailLinkFn = routeEntry?.hasDetail
    ? (item: Record<string, unknown>) => {
        const metadata = item.metadata as Record<string, unknown>;
        return getResourceHref(contextName, kind, metadata?.name as string, metadata?.namespace as string | undefined);
      }
    : undefined;
  const resolvedDetailLinkFn = detailLinkFn ?? defaultDetailLinkFn;
  const selectedNamespace = useClusterNamespace(contextName);
  const ns = entry.namespaced ? (selectedNamespace === "__all__" ? undefined : selectedNamespace) : undefined;
  const { data, isLoading, refetch, isFetching } = useResources(contextName, kind, ns);
  const deleteMutation = useDeleteResource(contextName, kind);
  const { addToast } = useToast();

  const handleDelete = async (item: Record<string, unknown>) => {
    const metadata = item.metadata as Record<string, unknown>;
    const name = metadata?.name as string;
    const namespace = metadata?.namespace as string;

    if (!confirm(`Delete ${entry.label} "${name}"?`)) return;

    try {
      await deleteMutation.mutateAsync({ name, namespace });
      addToast({ title: `Deleted ${entry.label}`, description: name, variant: "success" });
    } catch (err) {
      addToast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleBatchDelete = async (items: Record<string, unknown>[]) => {
    const names = items.map((item) => {
      const metadata = item.metadata as Record<string, unknown>;
      return metadata?.name as string;
    });

    if (!confirm(`Delete ${items.length} ${entry.labelPlural}?\n\n${names.join("\n")}`)) return;

    let failed = 0;
    for (const item of items) {
      const metadata = item.metadata as Record<string, unknown>;
      try {
        await deleteMutation.mutateAsync({
          name: metadata?.name as string,
          namespace: (metadata?.namespace as string) || "",
        });
      } catch {
        failed++;
      }
    }

    if (failed === 0) {
      addToast({ title: `Deleted ${items.length} ${entry.labelPlural}`, variant: "success" });
    } else {
      addToast({
        title: `Deleted ${items.length - failed} of ${items.length}`,
        description: `${failed} failed`,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{entry.labelPlural}</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          {onCreate && (
            <Button size="sm" onClick={onCreate} className="gap-2">
              <Plus className="h-4 w-4" />
              Create
            </Button>
          )}
        </div>
      </div>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind={entry.labelPlural}
        resourceKind={kind}
        currentNamespace={ns ?? "__all__"}
        onEdit={onEdit}
        onDelete={handleDelete}
        onBatchDelete={handleBatchDelete}
        onTerminal={onTerminal}
        onLogs={onLogs}
        detailLinkFn={resolvedDetailLinkFn}
      />
    </div>
  );
}
