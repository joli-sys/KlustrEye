"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DeploymentDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "deployments", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const status = (data?.status as Record<string, unknown>) || {};

  return (
    <ResourceDetail contextName={ctx} kind="deployments" name={name} namespace={namespace}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deployment Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Replicas</span>
              <span>{spec.replicas as number || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ready</span>
              <span>{status.readyReplicas as number || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Updated</span>
              <span>{status.updatedReplicas as number || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Available</span>
              <span>{status.availableReplicas as number || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Strategy</span>
              <span>{(spec.strategy as Record<string, unknown>)?.type as string || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conditions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {((status.conditions as Record<string, unknown>[]) || []).map((cond, i) => (
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
      </div>
    </ResourceDetail>
  );
}
