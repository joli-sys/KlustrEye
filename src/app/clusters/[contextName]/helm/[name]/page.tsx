"use client";

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { YamlEditor } from "@/components/yaml-editor";
import { useToast } from "@/components/ui/toast";
import { ArrowLeft, Eye, RotateCcw, Save, Undo2 } from "lucide-react";
import { stringify } from "yaml";
import type { ColumnDef } from "@tanstack/react-table";

interface HelmHistory {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

export default function HelmReleasePage({
  params,
}: {
  params: Promise<{ contextName: string; name: string }>;
}) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const releaseName = decodeURIComponent(name);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("namespace") || "default";
  const router = useRouter();
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [tab, setTab] = useState("overview");
  const [editedValues, setEditedValues] = useState<string | null>(null);
  const [previewManifest, setPreviewManifest] = useState<string | null>(null);

  const { data: release, isLoading } = useQuery({
    queryKey: ["helm-release", ctx, releaseName, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(releaseName)}?namespace=${encodeURIComponent(namespace)}`
      );
      if (!res.ok) throw new Error("Failed to fetch release");
      return res.json();
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery<HelmHistory[]>({
    queryKey: ["helm-history", ctx, releaseName, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(releaseName)}?namespace=${encodeURIComponent(namespace)}&view=history`
      );
      if (!res.ok) throw new Error("Failed to fetch history");
      return res.json();
    },
  });

  const rollback = useMutation({
    mutationFn: async (revision: number) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(releaseName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace, revision }),
        }
      );
      if (!res.ok) throw new Error("Rollback failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helm-release", ctx, releaseName] });
      queryClient.invalidateQueries({ queryKey: ["helm-history", ctx, releaseName] });
      addToast({ title: "Rollback successful", variant: "success" });
    },
    onError: (err) => {
      addToast({ title: "Rollback failed", description: err.message, variant: "destructive" });
    },
  });

  const upgrade = useMutation({
    mutationFn: async (valuesYaml: string) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(releaseName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            namespace,
            action: "upgrade",
            valuesYaml,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upgrade failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["helm-release", ctx, releaseName] });
      queryClient.invalidateQueries({ queryKey: ["helm-history", ctx, releaseName] });
      setEditedValues(null);
      setPreviewManifest(null);
      addToast({ title: "Upgrade successful", variant: "success" });
    },
    onError: (err) => {
      addToast({ title: "Upgrade failed", description: err.message, variant: "destructive" });
    },
  });

  const dryRun = useMutation({
    mutationFn: async (valuesYaml: string) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/helm/releases/${encodeURIComponent(releaseName)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            namespace,
            action: "dry-run",
            valuesYaml,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Dry-run failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setPreviewManifest(data.manifest);
      setTab("manifest");
    },
    onError: (err) => {
      addToast({ title: "Preview failed", description: err.message, variant: "destructive" });
    },
  });

  const info = release?.release?.info;
  const valuesYaml = release?.values
    ? stringify(release.values, { lineWidth: 0 })
    : "# No user-supplied values";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/clusters/${encodeURIComponent(ctx)}/helm`)}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{releaseName}</h1>
          <p className="text-sm text-muted-foreground">
            {namespace} namespace
          </p>
        </div>
      </div>

      {isLoading && <Skeleton className="h-64" />}

      {release && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="values">Values</TabsTrigger>
            <TabsTrigger value="manifest">Manifest</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <Badge variant={info?.status === "deployed" ? "success" : info?.status === "failed" ? "destructive" : "secondary"}>
                    {info?.status || "unknown"}
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Revision</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-lg font-semibold">{release.release?.version ?? "-"}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Chart</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="font-mono text-sm">{release.release?.chart?.metadata?.name ?? "-"}</span>
                  <span className="text-muted-foreground text-sm ml-1">
                    {release.release?.chart?.metadata?.version ?? ""}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">App Version</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="font-mono text-sm">{release.release?.chart?.metadata?.appVersion ?? "-"}</span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Last Deployed</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-sm">
                    {info?.last_deployed
                      ? new Date(info.last_deployed).toLocaleString()
                      : "-"}
                  </span>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  <span className="text-sm">{info?.description || "-"}</span>
                </CardContent>
              </Card>
            </div>
            {info?.notes && (
              <Card className="mt-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap font-mono bg-muted rounded-md p-4 max-h-80 overflow-auto">
                    {info.notes}
                  </pre>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="values">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {editedValues !== null ? "Editing values — save to upgrade the release" : "User-supplied values"}
                </p>
                <div className="flex items-center gap-2">
                  {editedValues !== null && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setEditedValues(null); setPreviewManifest(null); }}
                      className="gap-1.5"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={dryRun.isPending}
                    onClick={() => {
                      dryRun.mutate(editedValues ?? valuesYaml);
                    }}
                    className="gap-1.5"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    {dryRun.isPending ? "Rendering..." : "Preview Manifest"}
                  </Button>
                  <Button
                    size="sm"
                    disabled={upgrade.isPending}
                    onClick={() => {
                      const vals = editedValues ?? valuesYaml;
                      if (confirm(`Upgrade "${releaseName}" with the ${editedValues !== null ? "edited" : "current"} values?`)) {
                        upgrade.mutate(vals);
                      }
                    }}
                    className="gap-1.5"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {upgrade.isPending ? "Upgrading..." : "Save & Upgrade"}
                  </Button>
                </div>
              </div>
              <YamlEditor
                value={editedValues ?? valuesYaml}
                onChange={(val) => setEditedValues(val ?? "")}
                height="600px"
              />
            </div>
          </TabsContent>

          <TabsContent value="manifest">
            {previewManifest !== null && (
              <div className="flex items-center justify-between rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 mb-2 text-sm">
                <span className="text-yellow-600 dark:text-yellow-400">
                  Showing dry-run preview — this has not been applied
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewManifest(null)}
                >
                  Show deployed
                </Button>
              </div>
            )}
            <YamlEditor value={previewManifest ?? release.manifest ?? "# No manifest"} readOnly height="600px" />
          </TabsContent>

          <TabsContent value="history">
            {historyLoading && <Skeleton className="h-48" />}
            {history && (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium">Revision</th>
                      <th className="px-4 py-2 text-left font-medium">Updated</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Chart</th>
                      <th className="px-4 py-2 text-left font-medium">App Version</th>
                      <th className="px-4 py-2 text-left font-medium">Description</th>
                      <th className="px-4 py-2 text-left font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((h) => {
                      const isCurrent = h.revision === (release.release?.version ?? history.length);
                      return (
                        <tr key={h.revision} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2 font-mono">{h.revision}</td>
                          <td className="px-4 py-2">{new Date(h.updated).toLocaleString()}</td>
                          <td className="px-4 py-2">
                            <Badge variant={h.status === "deployed" ? "success" : h.status === "superseded" ? "secondary" : "destructive"}>
                              {h.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-2 font-mono">{h.chart}</td>
                          <td className="px-4 py-2">{h.app_version}</td>
                          <td className="px-4 py-2 text-muted-foreground">{h.description}</td>
                          <td className="px-4 py-2">
                            {!isCurrent && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  if (confirm(`Rollback "${releaseName}" to revision ${h.revision}?`)) {
                                    rollback.mutate(h.revision);
                                  }
                                }}
                                disabled={rollback.isPending}
                                className="gap-1.5"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Rollback
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
