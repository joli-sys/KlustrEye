"use client";

import { use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PortForwardTab } from "@/components/port-forward-tab";

export default function ServiceDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "services", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const servicePorts = useMemo(() => {
    const raw = (spec.ports as { name?: string; port: number; protocol?: string; targetPort?: number | string }[]) || [];
    return raw.map((p) => ({
      name: p.name,
      port: p.port,
      protocol: p.protocol,
    }));
  }, [spec.ports]);

  return (
    <ResourceDetail
      contextName={ctx}
      kind="services"
      name={name}
      namespace={namespace}
      extraTabs={[
        {
          value: "port-forward",
          label: "Port Forward",
          content: (
            <PortForwardTab
              contextName={ctx}
              namespace={namespace}
              resourceType="service"
              resourceName={name}
              ports={servicePorts}
            />
          ),
        },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="secondary">{(spec.type as string) || "ClusterIP"}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cluster IP</span>
              <span className="font-mono text-xs">{(spec.clusterIP as string) || "-"}</span>
            </div>
            {typeof spec.externalIP === "string" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">External IP</span>
                <span className="font-mono text-xs">{spec.externalIP}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Session Affinity</span>
              <span>{(spec.sessionAffinity as string) || "None"}</span>
            </div>
          </CardContent>
        </Card>

        {servicePorts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {(spec.ports as { name?: string; port: number; protocol?: string; targetPort?: number | string }[])?.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-sm p-2 rounded border">
                    <div>
                      {p.name && <span className="font-medium">{p.name}: </span>}
                      <span className="font-mono">{p.port}</span>
                      {p.targetPort && <span className="text-muted-foreground"> → {p.targetPort}</span>}
                    </div>
                    <Badge variant="outline" className="text-xs">{p.protocol || "TCP"}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ResourceDetail>
  );
}
