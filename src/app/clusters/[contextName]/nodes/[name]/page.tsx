"use client";

import { use, useMemo } from "react";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource, useResources } from "@/hooks/use-resources";
import { useNodeMetrics } from "@/hooks/use-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusBadge } from "@/components/resource-table";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu, formatAge } from "@/lib/utils";
import Link from "next/link";

function ResourceBar({ label, used, total, formatFn }: {
  label: string;
  used: number;
  total: number;
  formatFn: (v: number) => string;
}) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span>{formatFn(used)} / {formatFn(total)}</span>
      </div>
      <div className="h-3 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${pct > 80 ? "bg-red-500" : pct > 60 ? "bg-yellow-500" : "bg-green-500"}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <div className="text-xs text-muted-foreground text-right">{pct.toFixed(1)}% used</div>
    </div>
  );
}

export default function NodeDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { data } = useResource(ctx, "nodes", name);
  const { data: metricsData } = useNodeMetrics(ctx);
  const { data: allPods } = useResources(ctx, "pods");

  const spec = (data?.spec as Record<string, unknown>) || {};
  const taints = (spec.taints as Record<string, string>[]) || [];
  const status = (data?.status as Record<string, unknown>) || {};
  const nodeInfo = (status.nodeInfo as Record<string, unknown>) || {};
  const conditions = (status.conditions as Record<string, unknown>[]) || [];
  const capacity = (status.capacity as Record<string, string>) || {};
  const allocatable = (status.allocatable as Record<string, string>) || {};

  const nodeMetrics = useMemo(() => {
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (!items) return null;
    const match = items.find((item) => {
      const meta = item.metadata as Record<string, unknown>;
      return meta?.name === name;
    });
    if (!match) return null;
    return match.usage as Record<string, string>;
  }, [metricsData, name]);

  const nodePods = useMemo(() => {
    if (!allPods) return [];
    return (allPods as Record<string, unknown>[]).filter((pod) => {
      const podSpec = pod.spec as Record<string, unknown> | undefined;
      return podSpec?.nodeName === name;
    });
  }, [allPods, name]);

  return (
    <ResourceDetail contextName={ctx} kind="nodes" name={name}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">OS</span>
              <span>{nodeInfo.osImage as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kernel</span>
              <span>{nodeInfo.kernelVersion as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Container Runtime</span>
              <span>{nodeInfo.containerRuntimeVersion as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kubelet</span>
              <span>{nodeInfo.kubeletVersion as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kube Proxy</span>
              <span>{nodeInfo.kubeProxyVersion as string || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resource Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {nodeMetrics ? (
              <>
                <ResourceBar
                  label="CPU"
                  used={parseCpuValue(nodeMetrics.cpu)}
                  total={parseCpuValue(allocatable.cpu || "0")}
                  formatFn={formatCpu}
                />
                <ResourceBar
                  label="Memory"
                  used={parseMemoryValue(nodeMetrics.memory)}
                  total={parseMemoryValue(allocatable.memory || "0")}
                  formatFn={formatBytes}
                />
              </>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CPU</span>
                  <span>{capacity.cpu || "-"} ({allocatable.cpu || "-"} allocatable)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Memory</span>
                  <span>{capacity.memory || "-"}</span>
                </div>
              </div>
            )}
            {capacity["ephemeral-storage"] && (
              <ResourceBar
                label="Ephemeral Storage"
                used={parseMemoryValue(capacity["ephemeral-storage"]) - parseMemoryValue(allocatable["ephemeral-storage"] || "0")}
                total={parseMemoryValue(capacity["ephemeral-storage"])}
                formatFn={formatBytes}
              />
            )}
            <div className="flex justify-between text-sm pt-2 border-t">
              <span className="text-muted-foreground">Max Pods</span>
              <span>{capacity.pods || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Conditions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {conditions.map((cond, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded border text-sm">
                  <span>{cond.type as string}</span>
                  <Badge
                    variant={
                      (cond.type === "Ready" && cond.status === "True") ||
                      (cond.type !== "Ready" && cond.status === "False")
                        ? "success"
                        : "destructive"
                    }
                  >
                    {cond.status as string}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Taints</CardTitle>
          </CardHeader>
          <CardContent>
            {taints.length === 0 ? (
              <p className="text-sm text-muted-foreground">No taints</p>
            ) : (
              <div className="space-y-2">
                {taints.map((taint, i) => (
                  <div key={i} className="flex items-center gap-2 p-2 rounded border text-sm">
                    <span className="font-mono">{taint.key}{taint.value ? `=${taint.value}` : ""}</span>
                    <Badge variant="outline">{taint.effect}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Pods ({nodePods.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {nodePods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pods running on this node</p>
            ) : (
              <div className="rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Namespace</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-muted-foreground">Age</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nodePods.map((pod) => {
                      const meta = pod.metadata as Record<string, unknown>;
                      const podStatus = pod.status as Record<string, unknown>;
                      const podName = meta?.name as string;
                      const podNs = meta?.namespace as string;
                      const phase = (podStatus?.phase as string) || "Unknown";
                      return (
                        <tr key={`${podNs}/${podName}`} className="border-b hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2">
                            <Link
                              href={`/clusters/${encodeURIComponent(ctx)}/workloads/pods/${encodeURIComponent(podName)}?ns=${encodeURIComponent(podNs)}`}
                              className="text-primary hover:underline font-medium"
                            >
                              {podName}
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-muted-foreground">{podNs}</td>
                          <td className="px-4 py-2">{statusBadge(phase)}</td>
                          <td className="px-4 py-2 text-muted-foreground">{formatAge(meta?.creationTimestamp as string)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ResourceDetail>
  );
}
