"use client";

import { use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PortForwardTab } from "@/components/port-forward-tab";
import { getResourceHref } from "@/lib/constants";

interface EndpointAddress {
  ip: string;
  hostname?: string;
  nodeName?: string;
  targetRef?: { kind: string; name: string; namespace: string };
}

interface EndpointPort {
  name?: string;
  port: number;
  protocol?: string;
}

interface EndpointSubset {
  addresses?: EndpointAddress[];
  notReadyAddresses?: EndpointAddress[];
  ports?: EndpointPort[];
}

function useServiceEndpoints(contextName: string, name: string, namespace: string) {
  return useQuery<{ subsets?: EndpointSubset[] }>({
    queryKey: ["service-endpoints", contextName, name, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/services/${encodeURIComponent(name)}/endpoints?namespace=${encodeURIComponent(namespace)}`
      );
      if (!res.ok) throw new Error("Failed to fetch endpoints");
      return res.json();
    },
    enabled: !!contextName && !!name,
  });
}

export default function ServiceDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "services", name, namespace);
  const { data: endpoints, isLoading: endpointsLoading } = useServiceEndpoints(ctx, name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const servicePorts = useMemo(() => {
    const raw = (spec.ports as { name?: string; port: number; protocol?: string; targetPort?: number | string }[]) || [];
    return raw.map((p) => ({
      name: p.name,
      port: p.port,
      protocol: p.protocol,
    }));
  }, [spec.ports]);

  const subsets = endpoints?.subsets ?? [];
  const totalReady = subsets.reduce((n, s) => n + (s.addresses?.length ?? 0), 0);
  const totalNotReady = subsets.reduce((n, s) => n + (s.notReadyAddresses?.length ?? 0), 0);

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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Endpoints
              {!endpointsLoading && (
                <span className="text-xs font-normal text-muted-foreground">
                  {totalReady} ready{totalNotReady > 0 && `, ${totalNotReady} not ready`}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {endpointsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : subsets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No endpoints found for this service.</p>
            ) : (
              <div className="space-y-4">
                {subsets.map((subset, si) => (
                  <div key={si} className="space-y-2">
                    {subset.ports && subset.ports.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-muted-foreground">Ports:</span>
                        {subset.ports.map((p, pi) => (
                          <Badge key={pi} variant="outline" className="text-xs font-mono">
                            {p.name ? `${p.name}:` : ""}{p.port}/{p.protocol ?? "TCP"}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {subset.addresses && subset.addresses.length > 0 && (
                      <div className="space-y-1">
                        {subset.addresses.map((addr, ai) => (
                          <div key={ai} className="flex items-center gap-2 text-sm p-2 rounded border">
                            <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />
                            <span className="font-mono text-xs">{addr.ip}</span>
                            {addr.targetRef && (
                              <EndpointTargetRef contextName={ctx} targetRef={addr.targetRef} />
                            )}
                            {addr.nodeName && (
                              <span className="text-xs text-muted-foreground ml-auto">
                                {addr.nodeName}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {subset.notReadyAddresses && subset.notReadyAddresses.length > 0 && (
                      <div className="space-y-1">
                        {subset.notReadyAddresses.map((addr, ai) => (
                          <div key={ai} className="flex items-center gap-2 text-sm p-2 rounded border border-yellow-500/30">
                            <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" />
                            <span className="font-mono text-xs">{addr.ip}</span>
                            {addr.targetRef && (
                              <EndpointTargetRef contextName={ctx} targetRef={addr.targetRef} />
                            )}
                            {addr.nodeName && (
                              <span className="text-xs text-muted-foreground ml-auto">
                                {addr.nodeName}
                              </span>
                            )}
                            <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/50">
                              Not Ready
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ResourceDetail>
  );
}

const TARGET_REF_KIND_MAP: Record<string, string> = {
  Pod: "pods",
  Node: "nodes",
};

function EndpointTargetRef({
  contextName,
  targetRef,
}: {
  contextName: string;
  targetRef: EndpointAddress["targetRef"] & {};
}) {
  const kind = TARGET_REF_KIND_MAP[targetRef.kind];
  if (kind) {
    const href = getResourceHref(contextName, kind, targetRef.name, targetRef.namespace);
    return (
      <Link href={href}>
        <Badge variant="secondary" className="text-xs hover:bg-accent cursor-pointer">
          {targetRef.kind}/{targetRef.name}
        </Badge>
      </Link>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs">
      {targetRef.kind}/{targetRef.name}
    </Badge>
  );
}
