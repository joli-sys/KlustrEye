"use client";

import { use, useState } from "react";
import { useCRDInstance, useUpdateCRDInstance, useDeleteCRDInstance } from "@/hooks/use-crds";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { YamlEditor } from "@/components/yaml-editor";
import { useToast } from "@/components/ui/toast";
import { formatAge } from "@/lib/utils";
import { stringify, parse } from "yaml";
import { Save, Trash2, ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

type PageParams = Promise<{
  contextName: string;
  group: string;
  version: string;
  plural: string;
  name: string;
}>;

export default function CRDInstanceDetailPage({ params }: { params: PageParams }) {
  const { contextName, group, version, plural, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const decodedGroup = decodeURIComponent(group);
  const searchParams = useSearchParams();
  const scope = searchParams.get("scope") || "Namespaced";
  const namespace = searchParams.get("ns") || undefined;
  const router = useRouter();
  const { addToast } = useToast();

  const { data, isLoading, refetch } = useCRDInstance(
    ctx, decodedGroup, version, plural, name, scope, namespace
  );
  const updateMutation = useUpdateCRDInstance(ctx, decodedGroup, version, plural, scope);
  const deleteMutation = useDeleteCRDInstance(ctx, decodedGroup, version, plural, scope);

  const [tab, setTab] = useState("info");
  const [editedYaml, setEditedYaml] = useState<string | null>(null);

  const yamlContent = data ? stringify(data, { lineWidth: 0 }) : "";

  const handleSave = async () => {
    if (!editedYaml) return;
    try {
      const body = parse(editedYaml);
      await updateMutation.mutateAsync({ name, body, namespace });
      setEditedYaml(null);
      refetch();
      addToast({ title: "Resource updated", variant: "success" });
    } catch (err) {
      addToast({ title: "Update failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ name, namespace });
      addToast({ title: "Deleted", description: name, variant: "success" });
      router.back();
    } catch (err) {
      addToast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-muted-foreground">Resource not found</div>;
  }

  const metadata = data.metadata as Record<string, unknown>;
  const labels = (metadata?.labels as Record<string, string>) || {};
  const annotations = (metadata?.annotations as Record<string, string>) || {};
  const spec = data.spec as Record<string, unknown> | undefined;
  const status = data.status as Record<string, unknown> | undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{name}</h1>
            <p className="text-sm text-muted-foreground font-mono">
              {decodedGroup}/{version} {plural} {namespace && `in ${namespace}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {tab === "yaml" && editedYaml !== null && (
            <Button size="sm" onClick={handleSave} className="gap-2" disabled={updateMutation.isPending}>
              <Save className="h-4 w-4" />
              Save
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={handleDelete} className="gap-2">
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="info">Info</TabsTrigger>
          <TabsTrigger value="yaml">YAML</TabsTrigger>
        </TabsList>

        <TabsContent value="info">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InfoRow label="Name" value={metadata?.name as string} />
                {namespace && <InfoRow label="Namespace" value={namespace} />}
                <InfoRow label="UID" value={metadata?.uid as string} />
                <InfoRow label="Created" value={formatAge(metadata?.creationTimestamp as string)} />
                {typeof metadata?.resourceVersion === "string" && (
                  <InfoRow label="Resource Version" value={metadata.resourceVersion} />
                )}
                <InfoRow label="API Version" value={`${decodedGroup}/${version}`} />
              </CardContent>
            </Card>

            {Object.keys(labels).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Labels</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(labels).map(([k, v]) => (
                      <Badge key={k} variant="secondary" className="text-xs font-mono">
                        {k}={v}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {Object.keys(annotations).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Annotations</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {Object.entries(annotations).map(([k, v]) => (
                      <div key={k} className="text-xs font-mono break-all">
                        <span className="text-muted-foreground">{k}:</span> {v}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {spec && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Spec</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded-md overflow-auto max-h-64">
                    {stringify(spec, { lineWidth: 0 })}
                  </pre>
                </CardContent>
              </Card>
            )}

            {status && (
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs font-mono whitespace-pre-wrap bg-muted p-3 rounded-md overflow-auto max-h-64">
                    {stringify(status, { lineWidth: 0 })}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="yaml">
          <div className="border rounded-md overflow-hidden">
            <YamlEditor
              value={editedYaml ?? yamlContent}
              onChange={(val) => setEditedYaml(val)}
              height="600px"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
