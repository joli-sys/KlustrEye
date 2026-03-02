"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScaleDialog } from "@/components/scale-dialog";
import { EditResourcesDialog } from "@/components/edit-resources-dialog";
import { Scaling, Cpu } from "lucide-react";

export default function DeploymentDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";
  const [scaleOpen, setScaleOpen] = useState(false);
  const [editResourcesOpen, setEditResourcesOpen] = useState(false);

  const { data } = useResource(ctx, "deployments", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const status = (data?.status as Record<string, unknown>) || {};
  const templateSpec = (spec.template as Record<string, unknown>)?.spec as Record<string, unknown> | undefined;
  const containers = (templateSpec?.containers as Record<string, unknown>[]) || [];

  return (
    <ResourceDetail contextName={ctx} kind="deployments" name={name} namespace={namespace}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Deployment Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Replicas</span>
              <div className="flex items-center gap-2">
                <span>{spec.replicas as number || 0}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setScaleOpen(true)} title="Scale">
                  <Scaling className="h-3.5 w-3.5" />
                </Button>
              </div>
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

        {containers.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Container Resources</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setEditResourcesOpen(true)} className="gap-1.5">
                <Cpu className="h-3.5 w-3.5" />
                Edit Resources
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {containers.map((c) => {
                  const cName = c.name as string;
                  const resources = c.resources as Record<string, unknown> | undefined;
                  const requests = (resources?.requests as Record<string, string>) || {};
                  const limits = (resources?.limits as Record<string, string>) || {};
                  const hasResources = Object.keys(requests).length > 0 || Object.keys(limits).length > 0;
                  return (
                    <div key={cName} className="rounded-md border p-3 text-sm space-y-1">
                      <span className="font-medium">{cName}</span>
                      {hasResources ? (
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mt-1">
                          {requests.cpu && <div><span className="text-muted-foreground">CPU req:</span> {requests.cpu}</div>}
                          {limits.cpu && <div><span className="text-muted-foreground">CPU lim:</span> {limits.cpu}</div>}
                          {requests.memory && <div><span className="text-muted-foreground">Mem req:</span> {requests.memory}</div>}
                          {limits.memory && <div><span className="text-muted-foreground">Mem lim:</span> {limits.memory}</div>}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">No resource requests/limits set</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <ScaleDialog
        open={scaleOpen}
        onOpenChange={setScaleOpen}
        contextName={ctx}
        kind="deployments"
        name={name}
        namespace={namespace}
        currentReplicas={(spec.replicas as number) || 0}
      />
      <EditResourcesDialog
        open={editResourcesOpen}
        onOpenChange={setEditResourcesOpen}
        contextName={ctx}
        kind="deployments"
        name={name}
        namespace={namespace}
        containers={containers}
      />
    </ResourceDetail>
  );
}
