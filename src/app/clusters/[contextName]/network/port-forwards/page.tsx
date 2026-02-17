"use client";

import { use } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePortForwards, useStopPortForward } from "@/hooks/use-port-forward";
import { Cable, ExternalLink, Square } from "lucide-react";

export default function PortForwardsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { data: forwards, isLoading } = usePortForwards(ctx);
  const stopMutation = useStopPortForward(ctx);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Port Forwards</h1>
          <p className="text-sm text-muted-foreground">Active port-forward sessions for this cluster</p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
      ) : !forwards || forwards.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center gap-3 text-center">
              <Cable className="h-10 w-10 text-muted-foreground" />
              <div>
                <p className="font-medium">No active port forwards</p>
                <p className="text-sm text-muted-foreground">
                  Start a port forward from a Pod or Service detail page.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Active Sessions
              <Badge variant="secondary" className="ml-2">{forwards.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-3 font-medium">Resource</th>
                    <th className="text-left p-3 font-medium">Namespace</th>
                    <th className="text-left p-3 font-medium">Local Port</th>
                    <th className="text-left p-3 font-medium">Remote Port</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forwards.map((f) => (
                    <tr key={f.id} className="border-b last:border-0">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Cable className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono text-xs">{f.resourceType}/{f.resourceName}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{f.namespace}</td>
                      <td className="p-3">
                        <a
                          href={`http://localhost:${f.localPort}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                        >
                          {f.localPort}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                      <td className="p-3 font-mono">{f.remotePort}</td>
                      <td className="p-3">
                        <Badge variant={f.status === "active" ? "success" : "secondary"}>
                          {f.status}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => stopMutation.mutate(f.id)}
                          disabled={stopMutation.isPending}
                        >
                          <Square className="h-3 w-3 mr-1" />
                          Stop
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
