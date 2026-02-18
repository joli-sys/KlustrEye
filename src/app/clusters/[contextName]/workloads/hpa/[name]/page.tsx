"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function HPADetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "horizontalpodautoscalers", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const status = (data?.status as Record<string, unknown>) || {};
  const scaleRef = (spec.scaleTargetRef as Record<string, unknown>) || {};
  const metrics = (spec.metrics as Record<string, unknown>[]) || [];
  const currentMetrics = (status.currentMetrics as Record<string, unknown>[]) || [];
  const conditions = (status.conditions as Record<string, unknown>[]) || [];

  return (
    <ResourceDetail contextName={ctx} kind="horizontalpodautoscalers" name={name} namespace={namespace}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scale Target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kind</span>
              <span>{scaleRef.kind as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-mono text-xs">{scaleRef.name as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Min Replicas</span>
              <span className="font-mono">{String(spec.minReplicas ?? "-")}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max Replicas</span>
              <span className="font-mono">{String(spec.maxReplicas ?? "-")}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Replicas</span>
              <span className="font-mono">{String(status.currentReplicas ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desired Replicas</span>
              <span className="font-mono">{String(status.desiredReplicas ?? 0)}</span>
            </div>
          </CardContent>
        </Card>

        {metrics.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {metrics.map((metric, i) => {
                  const type = metric.type as string;
                  const current = currentMetrics[i];
                  return (
                    <div key={i} className="p-3 rounded-lg border space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{type}</Badge>
                        <MetricTarget metric={metric} />
                      </div>
                      {current && (
                        <div className="text-xs text-muted-foreground">
                          Current: <MetricCurrent metric={current} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {conditions.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{cond.type as string}</span>
                      {typeof cond.reason === "string" && (
                        <span className="text-xs text-muted-foreground">({cond.reason})</span>
                      )}
                    </div>
                    <Badge variant={cond.status === "True" ? "success" : "secondary"}>
                      {cond.status as string}
                    </Badge>
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

function MetricTarget({ metric }: { metric: Record<string, unknown> }) {
  const type = metric.type as string;
  if (type === "Resource") {
    const res = metric.resource as Record<string, unknown> | undefined;
    const name = res?.name as string;
    const target = res?.target as Record<string, unknown> | undefined;
    if (target?.averageUtilization != null)
      return <span className="text-sm font-mono">{name}: {String(target.averageUtilization)}% avg utilization</span>;
    if (target?.averageValue)
      return <span className="text-sm font-mono">{name}: {String(target.averageValue)} avg</span>;
    return <span className="text-sm font-mono">{name}</span>;
  }
  if (type === "Pods") {
    const pods = metric.pods as Record<string, unknown> | undefined;
    const metricDef = pods?.metric as Record<string, unknown> | undefined;
    const target = pods?.target as Record<string, unknown> | undefined;
    return <span className="text-sm font-mono">{metricDef?.name as string}: {String(target?.averageValue ?? "-")} avg</span>;
  }
  if (type === "Object") {
    const obj = metric.object as Record<string, unknown> | undefined;
    const metricDef = obj?.metric as Record<string, unknown> | undefined;
    const target = obj?.target as Record<string, unknown> | undefined;
    return <span className="text-sm font-mono">{metricDef?.name as string}: {String(target?.value ?? target?.averageValue ?? "-")}</span>;
  }
  if (type === "External") {
    const ext = metric.external as Record<string, unknown> | undefined;
    const metricDef = ext?.metric as Record<string, unknown> | undefined;
    const target = ext?.target as Record<string, unknown> | undefined;
    return <span className="text-sm font-mono">{metricDef?.name as string}: {String(target?.value ?? target?.averageValue ?? "-")}</span>;
  }
  return <span className="text-sm">{type}</span>;
}

function MetricCurrent({ metric }: { metric: Record<string, unknown> }) {
  const type = metric.type as string;
  if (type === "Resource") {
    const res = metric.resource as Record<string, unknown> | undefined;
    const current = res?.current as Record<string, unknown> | undefined;
    if (current?.averageUtilization != null)
      return <span className="font-mono">{String(current.averageUtilization)}% avg</span>;
    if (current?.averageValue)
      return <span className="font-mono">{String(current.averageValue)}</span>;
  }
  if (type === "Pods") {
    const pods = metric.pods as Record<string, unknown> | undefined;
    const current = pods?.current as Record<string, unknown> | undefined;
    return <span className="font-mono">{String(current?.averageValue ?? "-")}</span>;
  }
  if (type === "Object") {
    const obj = metric.object as Record<string, unknown> | undefined;
    const current = obj?.current as Record<string, unknown> | undefined;
    return <span className="font-mono">{String(current?.value ?? "-")}</span>;
  }
  if (type === "External") {
    const ext = metric.external as Record<string, unknown> | undefined;
    const current = ext?.current as Record<string, unknown> | undefined;
    return <span className="font-mono">{String(current?.value ?? current?.averageValue ?? "-")}</span>;
  }
  return <span>-</span>;
}
