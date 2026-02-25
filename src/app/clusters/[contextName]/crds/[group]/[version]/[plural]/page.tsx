"use client";

import { use, useMemo, useState } from "react";
import { useCRDInstances, useDeleteCRDInstance, useCreateCRDInstance } from "@/hooks/use-crds";
import { useClusterNamespace } from "@/hooks/use-cluster-namespace";
import { ResourceTable, nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useSearchParams } from "next/navigation";
import { YamlEditor } from "@/components/yaml-editor";
import { parse } from "yaml";
import { RefreshCw, Plus, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";

type PageParams = Promise<{
  contextName: string;
  group: string;
  version: string;
  plural: string;
}>;

export default function CRDInstancesPage({ params }: { params: PageParams }) {
  const { contextName, group, version, plural } = use(params);
  const ctx = decodeURIComponent(contextName);
  const decodedGroup = decodeURIComponent(group);
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope") || "Namespaced";
  const router = useRouter();
  const { addToast } = useToast();
  const selectedNamespace = useClusterNamespace(ctx);

  const ns = scope === "Namespaced"
    ? (selectedNamespace === "__all__" ? undefined : selectedNamespace)
    : undefined;

  const { data, isLoading, refetch, isFetching } = useCRDInstances(ctx, decodedGroup, version, plural, scope, ns);
  const deleteMutation = useDeleteCRDInstance(ctx, decodedGroup, version, plural, scope);
  const [createOpen, setCreateOpen] = useState(false);

  const columns: ColumnDef<Record<string, unknown>>[] = useMemo(() => {
    const cols: ColumnDef<Record<string, unknown>>[] = [nameColumn()];
    if (scope === "Namespaced") cols.push(namespaceColumn());
    cols.push(ageColumn());
    return cols;
  }, [scope]);

  const handleDelete = async (item: Record<string, unknown>) => {
    const metadata = item.metadata as Record<string, unknown>;
    const name = metadata?.name as string;
    const namespace = metadata?.namespace as string;
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ name, namespace });
      addToast({ title: "Deleted", description: name, variant: "success" });
    } catch (err) {
      addToast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(`/clusters/${encodeURIComponent(ctx)}/crds`)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold capitalize">{plural}</h1>
            <p className="text-sm text-muted-foreground font-mono">
              {decodedGroup}/{version}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()} title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </div>
      </div>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind={plural}
        onDelete={handleDelete}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          const qp = new URLSearchParams();
          qp.set("scope", scope);
          if (metadata?.namespace) qp.set("ns", metadata.namespace as string);
          return `/clusters/${encodeURIComponent(ctx)}/crds/${encodeURIComponent(decodedGroup)}/${version}/${plural}/${metadata?.name}?${qp.toString()}`;
        }}
      />
      {createOpen && (
        <CRDCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          contextName={ctx}
          group={decodedGroup}
          version={version}
          plural={plural}
          scope={scope}
        />
      )}
    </div>
  );
}

function CRDCreateDialog({
  open,
  onOpenChange,
  contextName,
  group,
  version,
  plural,
  scope,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  group: string;
  version: string;
  plural: string;
  scope: string;
}) {
  const createMutation = useCreateCRDInstance(contextName, group, version, plural, scope);
  const { addToast } = useToast();
  const [yaml, setYaml] = useState("");

  const handleCreate = async () => {
    try {
      const body = parse(yaml);
      await createMutation.mutateAsync({ body, namespace: body.metadata?.namespace });
      addToast({ title: "Created", variant: "success" });
      onOpenChange(false);
    } catch (err) {
      addToast({ title: "Create failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-card border rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Create {plural}</h2>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          <YamlEditor
            value={yaml}
            onChange={(val: string) => setYaml(val)}
            height="400px"
          />
        </div>
        <div className="p-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending || !yaml.trim()}>
            Create
          </Button>
        </div>
      </div>
    </div>
  );
}
