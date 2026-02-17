"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePortForwards, useStopPortForward } from "@/hooks/use-port-forward";
import { PortForwardDialog } from "@/components/port-forward-dialog";
import { Cable, ExternalLink, Square } from "lucide-react";

interface AvailablePort {
  name?: string;
  port: number;
  protocol?: string;
}

interface PortForwardTabProps {
  contextName: string;
  namespace: string;
  resourceType: string;
  resourceName: string;
  ports: AvailablePort[];
}

export function PortForwardTab({
  contextName,
  namespace,
  resourceType,
  resourceName,
  ports,
}: PortForwardTabProps) {
  const { data: forwards } = usePortForwards(contextName);
  const stopMutation = useStopPortForward(contextName);
  const [dialogPort, setDialogPort] = useState<number | null>(null);

  const resourceForwards = (forwards || []).filter(
    (f) => f.resourceName === resourceName && f.namespace === namespace && f.resourceType === resourceType
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Ports</CardTitle>
        </CardHeader>
        <CardContent>
          {ports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No ports defined on this resource.</p>
          ) : (
            <div className="space-y-2">
              {ports.map((p) => {
                const activeForward = resourceForwards.find((f) => f.remotePort === p.port);
                return (
                  <div key={`${p.port}-${p.protocol}`} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Cable className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <span className="font-mono text-sm font-medium">{p.port}</span>
                        {p.name && <span className="text-sm text-muted-foreground ml-2">({p.name})</span>}
                        {p.protocol && p.protocol !== "TCP" && (
                          <Badge variant="outline" className="ml-2 text-xs">{p.protocol}</Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {activeForward ? (
                        <>
                          <a
                            href={`http://localhost:${activeForward.localPort}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline font-mono"
                          >
                            localhost:{activeForward.localPort}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => stopMutation.mutate(activeForward.id)}
                            disabled={stopMutation.isPending}
                          >
                            <Square className="h-3 w-3 mr-1" />
                            Stop
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDialogPort(p.port)}
                        >
                          <Cable className="h-3 w-3 mr-1" />
                          Forward
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {resourceForwards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active Forwards</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {resourceForwards.map((f) => (
                <div key={f.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Badge variant={f.status === "active" ? "success" : "secondary"}>
                      {f.status}
                    </Badge>
                    <span className="font-mono text-sm">
                      localhost:{f.localPort} → {f.remotePort}
                    </span>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => stopMutation.mutate(f.id)}
                    disabled={stopMutation.isPending}
                  >
                    <Square className="h-3 w-3 mr-1" />
                    Stop
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {dialogPort !== null && (
        <PortForwardDialog
          open={true}
          onOpenChange={(open) => { if (!open) setDialogPort(null); }}
          contextName={contextName}
          namespace={namespace}
          resourceType={resourceType}
          resourceName={resourceName}
          remotePort={dialogPort}
        />
      )}
    </div>
  );
}
