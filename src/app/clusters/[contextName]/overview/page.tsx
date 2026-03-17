import { useMemo, useState } from "react";
import { useClusterInfo } from "@/hooks/use-clusters";
import { useResources } from "@/hooks/use-resources";
import { useNodeMetrics } from "@/hooks/use-metrics";
import { useClusterNamespace } from "@/hooks/use-cluster-namespace";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Server, Box, Layers, Network, Cpu, MemoryStick, AlertTriangle, Info, AlertCircle, ChevronDown, ChevronRight, CircleDollarSign } from "lucide-react";
import { CloudProviderIcon } from "@/components/cloud-provider-icon";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu, formatAge } from "@/lib/utils";
import { useOpenCostSettings, useClusterCostSummary } from "@/plugins/opencost/hooks";
import { getResourceHref } from "@/lib/constants";
import { Link, useParams } from "react-router-dom";

const SINGULAR_TO_PLURAL: Record<string, string> = {
  Pod: "pods", Deployment: "deployments", StatefulSet: "statefulsets", DaemonSet: "daemonsets",
  ReplicaSet: "replicasets", Job: "jobs", CronJob: "cronjobs", Service: "services",
  Ingress: "ingresses", ConfigMap: "configmaps", Secret: "secrets",
  PersistentVolumeClaim: "persistentvolumeclaims", ServiceAccount: "serviceaccounts",
  Node: "nodes", Namespace: "namespaces",
};

function GaugeChart({ pct }: { pct: number }) {
  const r = 54;
  const cx = 64;
  const cy = 64;
  const startAngle = -210;
  const endAngle = 30;
  const totalAngle = endAngle - startAngle; // 240°

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const arcX = (deg: number) => cx + r * Math.cos(toRad(deg));
  const arcY = (deg: number) => cy + r * Math.sin(toRad(deg));

  const fillAngle = startAngle + (totalAngle * Math.min(pct, 100)) / 100;
  const color = pct > 80 ? "#ef4444" : pct > 60 ? "#eab308" : "#22c55e";

  const bgPath = `M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 1 1 ${arcX(endAngle)} ${arcY(endAngle)}`;
  const fgPath = pct <= 0
    ? ""
    : `M ${arcX(startAngle)} ${arcY(startAngle)} A ${r} ${r} 0 ${fillAngle - startAngle > 180 ? 1 : 0} 1 ${arcX(fillAngle)} ${arcY(fillAngle)}`;

  return (
    <svg viewBox="0 0 128 80" className="w-full max-w-[180px]">
      <path d={bgPath} fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" className="text-muted" />
      {fgPath && (
        <path d={fgPath} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
      )}
      <text x="64" y="62" textAnchor="middle" dominantBaseline="middle" className="fill-foreground" fontSize="18" fontWeight="bold">
        {pct.toFixed(1)}%
      </text>
    </svg>
  );
}

function GaugeCard({ label, icon: Icon, used, total, formatFn, color }: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  used: number;
  total: number;
  formatFn: (v: number) => string;
  color: string;
}) {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-1">
        <GaugeChart pct={pct} />
        <p className="text-xs text-muted-foreground">
          {formatFn(used)} / {formatFn(total)}
        </p>
      </CardContent>
    </Card>
  );
}

function formatCost(v: number) {
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

function ClusterCostCard({ contextName }: { contextName: string }) {
  const { data: settings } = useOpenCostSettings(contextName);
  const isConfigured =
    settings &&
    ((settings.metricsSource === "opencost" && !!settings.url) ||
      (settings.metricsSource === "prometheus" && !!settings.prometheusUrl) ||
      (settings.metricsSource === "mimir" && !!settings.grafanaConfigured));

  const { data } = useClusterCostSummary(contextName, !!isConfigured);

  if (!isConfigured || !data?.hourly) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">Cluster Cost</CardTitle>
        <CircleDollarSign className="h-4 w-4 text-green-500" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-1">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Hourly rate</p>
          <p className="text-2xl font-bold tabular-nums">{formatCost(data.hourly)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">Monthly est.</p>
          <p className="text-lg font-semibold tabular-nums text-muted-foreground">
            {formatCost(data.monthly ?? data.hourly * 730)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const { data: clusterInfo, isLoading: infoLoading } = useClusterInfo(ctx);
  const selectedNamespace = useClusterNamespace(ctx);
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;

  const [eventsExpanded, setEventsExpanded] = useState(true);

  const { data: pods } = useResources(ctx, "pods", ns);
  const { data: deployments } = useResources(ctx, "deployments", ns);
  const { data: services } = useResources(ctx, "services", ns);
  const { data: nodes } = useResources(ctx, "nodes");
  const { data: events } = useResources(ctx, "events", ns);
  const { data: metricsData } = useNodeMetrics(ctx);

  const runningPods = (pods || []).filter(
    (p: Record<string, unknown>) => (p.status as Record<string, unknown>)?.phase === "Running"
  ).length;
  const totalPods = (pods || []).length;

  const readyDeploys = (deployments || []).filter((d: Record<string, unknown>) => {
    const status = d.status as Record<string, unknown>;
    return status?.readyReplicas === (status?.replicas || 0);
  }).length;

  const clusterResources = useMemo(() => {
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (!items || !nodes?.length) return null;

    let totalCpuUsed = 0;
    let totalCpuAllocatable = 0;
    let totalMemUsed = 0;
    let totalMemAllocatable = 0;

    const nodeMap = new Map<string, Record<string, unknown>>();
    for (const node of nodes) {
      const meta = (node as Record<string, unknown>).metadata as Record<string, unknown>;
      if (meta?.name) nodeMap.set(meta.name as string, node as Record<string, unknown>);
    }

    for (const item of items) {
      const meta = item.metadata as Record<string, unknown>;
      const usage = item.usage as Record<string, string>;
      const nodeName = meta?.name as string;
      const node = nodeMap.get(nodeName);
      if (!node || !usage) continue;

      const allocatable = ((node.status as Record<string, unknown>)?.allocatable as Record<string, string>) || {};
      totalCpuUsed += parseCpuValue(usage.cpu);
      totalMemUsed += parseMemoryValue(usage.memory);
      totalCpuAllocatable += parseCpuValue(allocatable.cpu || "0");
      totalMemAllocatable += parseMemoryValue(allocatable.memory || "0");
    }

    return {
      cpuUsed: totalCpuUsed,
      cpuTotal: totalCpuAllocatable,
      memUsed: totalMemUsed,
      memTotal: totalMemAllocatable,
      perNode: items.map((item) => {
        const meta = item.metadata as Record<string, unknown>;
        const usage = item.usage as Record<string, string>;
        const nodeName = meta?.name as string;
        const node = nodeMap.get(nodeName);
        const allocatable = node
          ? ((node.status as Record<string, unknown>)?.allocatable as Record<string, string>) || {}
          : {};
        const cpuUsed = parseCpuValue(usage.cpu);
        const cpuTotal = parseCpuValue(allocatable.cpu || "0");
        const memUsed = parseMemoryValue(usage.memory);
        const memTotal = parseMemoryValue(allocatable.memory || "0");
        const cpuPct = cpuTotal > 0 ? (cpuUsed / cpuTotal) * 100 : 0;
        const memPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;
        return { name: nodeName, cpuPct, memPct, cpuUsed, cpuTotal, memUsed, memTotal };
      }),
    };
  }, [metricsData, nodes]);

  const stats = [
    { label: "Nodes", value: (nodes || []).length, icon: Server, color: "text-blue-400" },
    { label: "Pods", value: `${runningPods}/${totalPods}`, icon: Box, color: "text-green-400" },
    { label: "Deployments", value: `${readyDeploys}/${(deployments || []).length}`, icon: Layers, color: "text-purple-400" },
    { label: "Services", value: (services || []).length, icon: Network, color: "text-orange-400" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Cluster Overview</h1>
        <div className="flex items-center gap-2 mt-1">
          {infoLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : clusterInfo?.ok ? (
            <>
              <Badge variant="success">Connected</Badge>
              <span className="text-sm text-muted-foreground">
                Kubernetes {clusterInfo.version}
              </span>
              {clusterInfo.cloudProvider && (
                <CloudProviderIcon provider={clusterInfo.cloudProvider} size={18} />
              )}
            </>
          ) : (
            <Badge variant="destructive">Disconnected</Badge>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {clusterResources && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <GaugeCard
            label="Cluster CPU"
            icon={Cpu}
            used={clusterResources.cpuUsed}
            total={clusterResources.cpuTotal}
            formatFn={formatCpu}
            color="text-blue-400"
          />
          <GaugeCard
            label="Cluster Memory"
            icon={MemoryStick}
            used={clusterResources.memUsed}
            total={clusterResources.memTotal}
            formatFn={formatBytes}
            color="text-purple-400"
          />
          <ClusterCostCard contextName={ctx} />
        </div>
      )}

      {events && events.length > 0 && (() => {
        const sorted = [...(events as Record<string, unknown>[])].sort((a, b) => {
          const tA = (a.lastTimestamp as string) || (a.metadata as Record<string, unknown>)?.creationTimestamp as string || "";
          const tB = (b.lastTimestamp as string) || (b.metadata as Record<string, unknown>)?.creationTimestamp as string || "";
          return new Date(tB).getTime() - new Date(tA).getTime();
        }).slice(0, 10);
        return (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <button
                onClick={() => setEventsExpanded((v) => !v)}
                className="flex items-center gap-1.5 text-base font-semibold hover:text-primary transition-colors"
              >
                {eventsExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Recent Events
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1 font-normal">
                  {sorted.length}
                </Badge>
              </button>
              <Link
                to={`/clusters/${encodeURIComponent(ctx)}/events`}
                className="text-xs text-primary hover:underline"
              >
                View all
              </Link>
            </CardHeader>
            {eventsExpanded && (
              <CardContent>
                <div className="space-y-2">
                  {sorted.map((event, i) => {
                    const meta = event.metadata as Record<string, unknown>;
                    const eventType = event.type as string;
                    const reason = event.reason as string || "";
                    const message = event.message as string || "";
                    const involvedObj = event.involvedObject as Record<string, unknown> | undefined;
                    const objKind = involvedObj?.kind as string || "";
                    const objName = involvedObj?.name as string || "";
                    const objNs = involvedObj?.namespace as string | undefined;
                    const pluralKind = SINGULAR_TO_PLURAL[objKind];
                    const objHref = pluralKind ? getResourceHref(ctx, pluralKind, objName, objNs) : null;
                    const timestamp = (event.lastTimestamp as string) || (meta?.creationTimestamp as string) || "";
                    const isWarning = eventType === "Warning";
                    return (
                      <div key={`${meta?.uid || i}`} className="flex items-start gap-3 p-2 rounded border text-sm">
                        {isWarning ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0 mt-0.5" />
                        ) : (
                          <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant={isWarning ? "warning" : "secondary"} className="text-[10px] px-1.5 py-0">
                              {reason}
                            </Badge>
                            {objHref ? (
                              <Link to={objHref} className="text-xs text-primary hover:underline">
                                {objKind}/{objName}
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">{objKind}/{objName}</span>
                            )}
                            <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatAge(timestamp)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 truncate">{message}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        );
      })()}

      {nodes && nodes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nodes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {nodes.map((node: Record<string, unknown>) => {
                const metadata = node.metadata as Record<string, unknown>;
                const nodeStatus = node.status as Record<string, unknown>;
                const conditions = (nodeStatus?.conditions as Record<string, unknown>[] || []);
                const ready = conditions.find((c) => c.type === "Ready");
                const isReady = ready?.status === "True";
                const nodeName = metadata?.name as string;
                const labels = (metadata?.labels as Record<string, string>) || {};
                const instanceType = labels["node.kubernetes.io/instance-type"] || labels["beta.kubernetes.io/instance-type"] || null;
                const capacityType = (labels["karpenter.sh/capacity-type"] || labels["eks.amazonaws.com/capacityType"] || "").toLowerCase() || null;
                const perNode = clusterResources?.perNode.find((n) => n.name === nodeName);

                return (
                  <div key={nodeName} className="flex items-center justify-between p-3 rounded-lg border gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <Server className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <Link
                          to={`/clusters/${encodeURIComponent(ctx)}/nodes/${encodeURIComponent(nodeName)}`}
                          className="font-medium text-sm truncate text-primary hover:underline block"
                        >
                          {nodeName}
                        </Link>
                        {(instanceType || capacityType) && (
                          <div className="flex items-center gap-2 mt-0.5">
                            {instanceType && (
                              <span className="text-[11px] font-mono text-muted-foreground">{instanceType}</span>
                            )}
                            {capacityType && (
                              <Badge variant={capacityType === "spot" ? "warning" : "secondary"} className="text-[10px] px-1.5 py-0">
                                {capacityType}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    {perNode && (
                      <div className="flex items-center gap-4 shrink-0">
                        <div
                          className="flex items-center gap-1.5 text-xs"
                          title={`CPU: ${formatCpu(perNode.cpuUsed)} / ${formatCpu(perNode.cpuTotal)}`}
                        >
                          <span className="text-muted-foreground">CPU</span>
                          <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${perNode.cpuPct > 80 ? "bg-red-500" : perNode.cpuPct > 60 ? "bg-yellow-500" : "bg-green-500"}`}
                              style={{ width: `${Math.min(perNode.cpuPct, 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums w-8 text-right">{perNode.cpuPct.toFixed(0)}%</span>
                        </div>
                        <div
                          className="flex items-center gap-1.5 text-xs"
                          title={`Memory: ${formatBytes(perNode.memUsed)} / ${formatBytes(perNode.memTotal)}`}
                        >
                          <span className="text-muted-foreground">Mem</span>
                          <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                              className={`h-full rounded-full ${perNode.memPct > 80 ? "bg-red-500" : perNode.memPct > 60 ? "bg-yellow-500" : "bg-green-500"}`}
                              style={{ width: `${Math.min(perNode.memPct, 100)}%` }}
                            />
                          </div>
                          <span className="tabular-nums w-8 text-right">{perNode.memPct.toFixed(0)}%</span>
                        </div>
                      </div>
                    )}
                    <Badge variant={isReady ? "success" : "destructive"}>
                      {isReady ? "Ready" : "NotReady"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
