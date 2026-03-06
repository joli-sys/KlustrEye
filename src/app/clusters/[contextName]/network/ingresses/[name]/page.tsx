"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";

interface IngressRule {
  host?: string;
  http?: {
    paths: Array<{
      path: string;
      pathType: string;
      backend: {
        service: {
          name: string;
          port: { number?: number; name?: string };
        };
      };
    }>;
  };
}

interface IngressTLS {
  hosts?: string[];
  secretName?: string;
}

export default function IngressDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "ingresses", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const rules = (spec.rules as IngressRule[]) || [];
  const tls = (spec.tls as IngressTLS[]) || [];

  // Build set of TLS-enabled hosts
  const tlsHosts = new Set<string>();
  for (const t of tls) {
    for (const h of t.hosts || []) {
      tlsHosts.add(h);
    }
  }

  // Flatten rules into rows
  const routingRows: Array<{
    host: string;
    path: string;
    pathType: string;
    service: string;
    port: string;
    hasTls: boolean;
  }> = [];

  for (const rule of rules) {
    const host = rule.host || "*";
    const hasTls = tlsHosts.has(host);
    for (const p of rule.http?.paths || []) {
      routingRows.push({
        host,
        path: p.path || "/",
        pathType: p.pathType || "Prefix",
        service: p.backend.service.name,
        port: String(p.backend.service.port.number || p.backend.service.port.name || ""),
        hasTls,
      });
    }
  }

  return (
    <ResourceDetail contextName={ctx} kind="ingresses" name={name} namespace={namespace}>
      {routingRows.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Routing Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Host</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Path</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Path Type</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Service</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Port</th>
                  </tr>
                </thead>
                <tbody>
                  {routingRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          {row.hasTls && <Lock className="h-3.5 w-3.5 text-green-500" />}
                          <span className="font-mono text-xs">{row.host}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.path}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{row.pathType}</Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{row.service}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.port}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </ResourceDetail>
  );
}
