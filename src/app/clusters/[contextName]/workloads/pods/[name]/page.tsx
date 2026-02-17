"use client";

import { use, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { usePodMetrics } from "@/hooks/use-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { statusBadge } from "@/components/resource-table";
import { LogViewer } from "@/components/log-viewer";
import { TerminalPanel } from "@/components/terminal-panel";
import { PodMetricsChart } from "@/components/pod-metrics-chart";
import { PortForwardTab } from "@/components/port-forward-tab";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu } from "@/lib/utils";
import { getPluginsWithResourceExtension } from "@/lib/plugins/registry";
import Link from "next/link";

const podPlugins = getPluginsWithResourceExtension("pods");

function ResourceRow({ label, used, request, limit, formatFn }: {
  label: string;
  used: number | null;
  request: number | null;
  limit: number | null;
  formatFn: (v: number) => string;
}) {
  const ref = limit ?? request;
  const pct = used !== null && ref && ref > 0 ? (used / ref) * 100 : null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          {used !== null && <span className="font-medium">{formatFn(used)}</span>}
          {request !== null && <span className="text-muted-foreground">req: {formatFn(request)}</span>}
          {limit !== null && <span className="text-muted-foreground">lim: {formatFn(limit)}</span>}
        </div>
      </div>
      {pct !== null && (
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct > 100 ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-green-500"}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default function PodDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "pods", name, namespace);
  const { data: metricsData } = usePodMetrics(ctx, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const status = (data?.status as Record<string, unknown>) || {};
  const containers = (spec.containers as Record<string, unknown>[]) || [];
  const containerStatuses = (status.containerStatuses as Record<string, unknown>[]) || [];

  const containerPorts = useMemo(() => {
    const ports: { name?: string; port: number; protocol?: string }[] = [];
    for (const c of containers) {
      const cPorts = c.ports as { name?: string; containerPort: number; protocol?: string }[] | undefined;
      if (cPorts) {
        for (const p of cPorts) {
          ports.push({ name: p.name, port: p.containerPort, protocol: p.protocol });
        }
      }
    }
    return ports;
  }, [containers]);

  const containerMetrics = useMemo(() => {
    const map = new Map<string, { cpu: number; memory: number }>();
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (!items) return map;
    const pod = items.find((item) => {
      const meta = item.metadata as Record<string, unknown>;
      return meta?.name === name && meta?.namespace === namespace;
    });
    if (!pod) return map;
    const cMetrics = pod.containers as Record<string, unknown>[] | undefined;
    if (cMetrics) {
      for (const c of cMetrics) {
        const usage = c.usage as Record<string, string>;
        if (c.name && usage) {
          map.set(c.name as string, {
            cpu: usage.cpu ? parseCpuValue(usage.cpu) : 0,
            memory: usage.memory ? parseMemoryValue(usage.memory) : 0,
          });
        }
      }
    }
    return map;
  }, [metricsData, name, namespace]);

  return (
    <ResourceDetail
      contextName={ctx}
      kind="pods"
      name={name}
      namespace={namespace}
      extraTabs={[
        {
          value: "metrics",
          label: "Metrics",
          content: (
            <div className="space-y-6">
              <PodMetricsChart
                contextName={ctx}
                podName={name}
                namespace={namespace}
              />
              {podPlugins.map((p) => {
                const Extension = p.PodExtension;
                if (!Extension) return null;
                return (
                  <Extension
                    key={p.manifest.id}
                    contextName={ctx}
                    name={name}
                    namespace={namespace}
                  />
                );
              })}
            </div>
          ),
        },
        {
          value: "logs",
          label: "Logs",
          content: (
            <LogViewer
              contextName={ctx}
              namespace={namespace}
              podName={name}
              containers={containers.map((c) => c.name as string)}
            />
          ),
        },
        {
          value: "terminal",
          label: "Terminal",
          content: (
            <TerminalPanel
              contextName={ctx}
              namespace={namespace}
              podName={name}
              containers={containers.map((c) => c.name as string)}
            />
          ),
        },
        {
          value: "port-forward",
          label: "Port Forward",
          content: (
            <PortForwardTab
              contextName={ctx}
              namespace={namespace}
              resourceType="pod"
              resourceName={name}
              ports={containerPorts}
            />
          ),
        },
      ]}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pod Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Phase</span>
              {statusBadge(status.phase as string || "Unknown")}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Node</span>
              {spec.nodeName ? (
                <Link
                  href={`/clusters/${encodeURIComponent(ctx)}/nodes/${encodeURIComponent(spec.nodeName as string)}`}
                  className="text-primary hover:underline"
                >
                  {spec.nodeName as string}
                </Link>
              ) : (
                <span>-</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pod IP</span>
              <span className="font-mono text-xs">{status.podIP as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">QoS Class</span>
              <span>{status.qosClass as string || "-"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Containers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {containers.map((container) => {
                const cName = container.name as string;
                const cs = containerStatuses.find((s) => s.name === cName);
                const ready = cs?.ready === true;
                const restarts = (cs?.restartCount as number) || 0;
                const resources = container.resources as Record<string, unknown> | undefined;
                const requests = resources?.requests as Record<string, string> | undefined;
                const limits = resources?.limits as Record<string, string> | undefined;
                const metrics = containerMetrics.get(cName);

                return (
                  <div key={cName} className="p-3 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-sm">{cName}</span>
                        <p className="text-xs text-muted-foreground">{container.image as string}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {restarts > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {restarts} restarts
                          </Badge>
                        )}
                        <Badge variant={ready ? "success" : "warning"}>
                          {ready ? "Ready" : "Not Ready"}
                        </Badge>
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-1 border-t">
                      <ResourceRow
                        label="CPU"
                        used={metrics?.cpu ?? null}
                        request={requests?.cpu ? parseCpuValue(requests.cpu) : null}
                        limit={limits?.cpu ? parseCpuValue(limits.cpu) : null}
                        formatFn={formatCpu}
                      />
                      <ResourceRow
                        label="Memory"
                        used={metrics?.memory ?? null}
                        request={requests?.memory ? parseMemoryValue(requests.memory) : null}
                        limit={limits?.memory ? parseMemoryValue(limits.memory) : null}
                        formatFn={formatBytes}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </ResourceDetail>
  );
}
