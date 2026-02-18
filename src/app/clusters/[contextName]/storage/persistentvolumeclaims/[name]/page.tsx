"use client";

import { use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource, useResources } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";

export default function PVCDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data: pvc } = useResource(ctx, "persistentvolumeclaims", name, namespace);
  const { data: pods } = useResources(ctx, "pods", namespace);

  const pvcSpec = (pvc?.spec as Record<string, unknown>) || {};
  const pvcStatus = (pvc?.status as Record<string, unknown>) || {};
  const volumeName = pvcSpec.volumeName as string | undefined;
  const storageClassName = pvcSpec.storageClassName as string | undefined;
  const accessModes = (pvcSpec.accessModes as string[]) || [];
  const capacity = (pvcStatus.capacity as Record<string, string>)?.storage;
  const requestedStorage = ((pvcSpec.resources as Record<string, unknown>)?.requests as Record<string, string>)?.storage;

  // Find pods that reference this PVC
  const usingPods = useMemo(() => {
    if (!pods) return [];
    return (pods as Record<string, unknown>[]).filter((pod) => {
      const spec = pod.spec as Record<string, unknown>;
      const volumes = (spec?.volumes as Record<string, unknown>[]) || [];
      return volumes.some((v) => {
        const pvcRef = v.persistentVolumeClaim as Record<string, unknown> | undefined;
        return pvcRef?.claimName === name;
      });
    });
  }, [pods, name]);

  return (
    <ResourceDetail contextName={ctx} kind="persistentvolumeclaims" name={name} namespace={namespace}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Volume Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {volumeName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Persistent Volume</span>
                <span className="font-mono text-xs">{volumeName}</span>
              </div>
            )}
            {storageClassName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Storage Class</span>
                <span className="font-mono text-xs">{storageClassName}</span>
              </div>
            )}
            {capacity && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Capacity</span>
                <span className="font-mono text-xs">{capacity}</span>
              </div>
            )}
            {requestedStorage && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Requested</span>
                <span className="font-mono text-xs">{requestedStorage}</span>
              </div>
            )}
            {accessModes.length > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Access Modes</span>
                <div className="flex gap-1">
                  {accessModes.map((m) => (
                    <Badge key={m} variant="secondary" className="text-xs">{m}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Used By Pods</CardTitle>
          </CardHeader>
          <CardContent>
            {usingPods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods are using this PVC.</p>
            ) : (
              <div className="space-y-2">
                {usingPods.map((pod) => {
                  const meta = pod.metadata as Record<string, unknown>;
                  const podName = meta.name as string;
                  const podNs = meta.namespace as string;
                  return (
                    <div key={podName} className="flex items-center justify-between p-2 rounded-md border">
                      <Link
                        href={`/clusters/${encodeURIComponent(ctx)}/workloads/pods/${encodeURIComponent(podName)}?ns=${encodeURIComponent(podNs)}`}
                        className="text-primary hover:underline text-sm font-medium"
                      >
                        {podName}
                      </Link>
                      <Badge variant="secondary" className="text-xs">{podNs}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ResourceDetail>
  );
}
