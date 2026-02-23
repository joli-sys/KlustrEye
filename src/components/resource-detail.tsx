"use client";

import { useState } from "react";
import { useResource, useUpdateResource, useDeleteResource } from "@/hooks/use-resources";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { YamlEditor } from "@/components/yaml-editor";
import { useToast } from "@/components/ui/toast";
import { formatAge } from "@/lib/utils";
import type { ResourceKind } from "@/lib/constants";
import { RESOURCE_REGISTRY } from "@/lib/constants";
import { stringify, parse } from "yaml";
import { RelatedEvents } from "@/components/related-events";
import { Save, Trash2, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { RESOURCE_ROUTE_MAP } from "@/lib/constants";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

interface ResourceDetailProps {
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  children?: React.ReactNode;
  extraTabs?: { value: string; label: string; content: React.ReactNode }[];
}

export function ResourceDetail({
  contextName,
  kind,
  name,
  namespace,
  children,
  extraTabs,
}: ResourceDetailProps) {
  const { data, isLoading, refetch } = useResource(contextName, kind, name, namespace);
  const updateMutation = useUpdateResource(contextName, kind);
  const deleteMutation = useDeleteResource(contextName, kind);
  const { addToast } = useToast();
  const router = useRouter();
  const currentPathname = usePathname();
  const currentSearchParams = useSearchParams();

  // Compute parent list URL by stripping the last path segment (resource name)
  const parentUrl = (() => {
    const segments = currentPathname.split("/");
    segments.pop(); // remove the [name] segment
    const parentPath = segments.join("/");
    // Preserve filter param if present
    const filter = currentSearchParams.get("filter");
    return filter ? `${parentPath}?filter=${encodeURIComponent(filter)}` : parentPath;
  })();
  const initialTab = currentSearchParams.get("tab") || "info";
  const [tab, setTab] = useState(initialTab);
  const [editedYaml, setEditedYaml] = useState<string | null>(null);
  const entry = RESOURCE_REGISTRY[kind];

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
    if (!confirm(`Delete ${entry.label} "${name}"?`)) return;
    try {
      await deleteMutation.mutateAsync({ name, namespace });
      addToast({ title: `Deleted ${entry.label}`, description: name, variant: "success" });
      router.push(parentUrl);
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
  const ownerReferences = (metadata?.ownerReferences as { kind: string; name: string; apiVersion: string; controller?: boolean }[]) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push(parentUrl)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{name}</h1>
            <p className="text-sm text-muted-foreground">
              {entry.label} {namespace && `in ${namespace}`}
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
          {extraTabs?.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
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
                {ownerReferences.length > 0 && ownerReferences.map((owner) => (
                  <OwnerRefRow
                    key={owner.name}
                    owner={owner}
                    contextName={contextName}
                    namespace={namespace}
                  />
                ))}
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
          </div>
          {children}
          <RelatedEvents
            contextName={contextName}
            kind={kind}
            name={name}
            namespace={namespace}
          />
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

        {extraTabs?.map((t) => (
          <TabsContent key={t.value} value={t.value}>
            {t.content}
          </TabsContent>
        ))}
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

// Map singular Kind to plural route key (e.g. "ReplicaSet" -> "replicasets")
const KIND_TO_PLURAL: Record<string, string> = {};
for (const [plural, entry] of Object.entries(RESOURCE_REGISTRY)) {
  KIND_TO_PLURAL[entry.kind] = plural;
}

function OwnerRefRow({
  owner,
  contextName,
  namespace,
}: {
  owner: { kind: string; name: string; controller?: boolean };
  contextName: string;
  namespace?: string;
}) {
  const plural = KIND_TO_PLURAL[owner.kind];
  const route = plural ? RESOURCE_ROUTE_MAP[plural] : null;

  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">
        {owner.controller ? "Controlled By" : "Owner"}
      </span>
      <span className="text-xs">
        <Badge variant="outline" className="text-[10px] mr-1.5">{owner.kind}</Badge>
        {route?.hasDetail ? (
          <Link
            href={`/clusters/${encodeURIComponent(contextName)}/${route.path}/${encodeURIComponent(owner.name)}${namespace ? `?ns=${encodeURIComponent(namespace)}` : ""}`}
            className="font-mono text-primary hover:underline"
          >
            {owner.name}
          </Link>
        ) : (
          <span className="font-mono">{owner.name}</span>
        )}
      </span>
    </div>
  );
}
