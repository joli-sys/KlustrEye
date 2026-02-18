"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function PDBDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "poddisruptionbudgets", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const status = (data?.status as Record<string, unknown>) || {};
  const selector = (spec.selector as Record<string, unknown>) || {};
  const matchLabels = (selector.matchLabels as Record<string, string>) || {};
  const conditions = (status.conditions as Record<string, unknown>[]) || [];

  return (
    <ResourceDetail contextName={ctx} kind="poddisruptionbudgets" name={name} namespace={namespace}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {spec.minAvailable != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Min Available</span>
                <span className="font-mono">{String(spec.minAvailable)}</span>
              </div>
            )}
            {spec.maxUnavailable != null && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Unavailable</span>
                <span className="font-mono">{String(spec.maxUnavailable)}</span>
              </div>
            )}
            {typeof spec.unhealthyPodEvictionPolicy === "string" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Unhealthy Pod Eviction</span>
                <span>{spec.unhealthyPodEvictionPolicy}</span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current Healthy</span>
              <span className="font-mono">{String(status.currentHealthy ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desired Healthy</span>
              <span className="font-mono">{String(status.desiredHealthy ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expected Pods</span>
              <span className="font-mono">{String(status.expectedPods ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Disruptions Allowed</span>
              <span className="font-mono">{String(status.disruptionsAllowed ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Observed Generation</span>
              <span className="font-mono">{String(status.observedGeneration ?? "-")}</span>
            </div>
          </CardContent>
        </Card>

        {Object.keys(matchLabels).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Selector</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {Object.entries(matchLabels).map(([k, v]) => (
                  <Badge key={k} variant="secondary" className="text-xs font-mono">
                    {k}={v}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {conditions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{cond.type as string}</span>
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
