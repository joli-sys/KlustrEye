"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "@/lib/stores/ui-store";
import { ResourceTable } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";

function makeColumns(ctx: string): ColumnDef<Record<string, unknown>>[] {
  return [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    cell: ({ row }) => {
      const name = row.getValue("name") as string;
      const ns = row.original.namespace as string;
      return (
        <Link
          href={`/clusters/${encodeURIComponent(ctx)}/helm/${encodeURIComponent(name)}?namespace=${encodeURIComponent(ns)}`}
          className="font-medium text-primary hover:underline"
        >
          {name}
        </Link>
      );
    },
  },
  {
    id: "namespace",
    header: "Namespace",
    accessorKey: "namespace",
  },
  {
    id: "revision",
    header: "Revision",
    accessorKey: "revision",
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ getValue }) => {
      const status = getValue() as string;
      const variant = status === "deployed" ? "success" : status === "failed" ? "destructive" : "secondary";
      return <Badge variant={variant}>{status}</Badge>;
    },
  },
  {
    id: "chart",
    header: "Chart",
    accessorKey: "chart",
  },
  {
    id: "app_version",
    header: "App Version",
    accessorKey: "app_version",
  },
  {
    id: "updated",
    header: "Updated",
    accessorKey: "updated",
    cell: ({ getValue }) => {
      const date = getValue() as string;
      if (!date) return "-";
      return new Date(date).toLocaleString();
    },
  },
  ];
}

export default function HelmPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { selectedNamespace } = useUIStore();
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [installOpen, setInstallOpen] = useState(false);
  const [installForm, setInstallForm] = useState({
    releaseName: "",
    chart: "",
    namespace: "default",
    version: "",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["helm-releases", ctx, ns],
    queryFn: async () => {
      const params = ns ? `?namespace=${encodeURIComponent(ns)}` : "";
      const res = await fetch(`/api/clusters/${encodeURIComponent(ctx)}/helm/releases${params}`);
      if (!res.ok) throw new Error("Failed to fetch releases");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const uninstallMutation = useMutation({
    mutationFn: async ({ name, namespace }: { name: string; namespace: string }) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to uninstall");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helm-releases", ctx] });
      addToast({ title: "Release uninstalled", variant: "success" });
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/clusters/${encodeURIComponent(ctx)}/helm/releases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(installForm),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Install failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helm-releases", ctx] });
      addToast({ title: "Chart installed", variant: "success" });
      setInstallOpen(false);
    },
    onError: (err) => {
      addToast({ title: "Install failed", description: err.message, variant: "destructive" });
    },
  });

  const handleDelete = (item: Record<string, unknown>) => {
    if (!confirm(`Uninstall Helm release "${item.name}"?`)) return;
    uninstallMutation.mutate({ name: item.name as string, namespace: item.namespace as string });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Helm Releases</h1>
        <Button size="sm" onClick={() => setInstallOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Install Chart
        </Button>
      </div>

      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={makeColumns(ctx)}
        kind="Helm Releases"
        onDelete={handleDelete}
      />

      <Dialog open={installOpen} onOpenChange={setInstallOpen}>
        <DialogContent onClose={() => setInstallOpen(false)}>
          <DialogHeader>
            <DialogTitle>Install Helm Chart</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Release Name</label>
              <Input
                value={installForm.releaseName}
                onChange={(e) => setInstallForm({ ...installForm, releaseName: e.target.value })}
                placeholder="my-release"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Chart</label>
              <Input
                value={installForm.chart}
                onChange={(e) => setInstallForm({ ...installForm, chart: e.target.value })}
                placeholder="bitnami/nginx"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Namespace</label>
              <Input
                value={installForm.namespace}
                onChange={(e) => setInstallForm({ ...installForm, namespace: e.target.value })}
                placeholder="default"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Version (optional)</label>
              <Input
                value={installForm.version}
                onChange={(e) => setInstallForm({ ...installForm, version: e.target.value })}
                placeholder="latest"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstallOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => installMutation.mutate()} disabled={installMutation.isPending}>
              {installMutation.isPending ? "Installing..." : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
