"use client";

import { use, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { usePodMetrics } from "@/hooks/use-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { statusBadge } from "@/components/resource-table";
import { LogViewer } from "@/components/log-viewer";
import { TerminalPanel } from "@/components/terminal-panel";
import { PodMetricsChart } from "@/components/pod-metrics-chart";
import { PortForwardTab } from "@/components/port-forward-tab";
import { parseCpuValue, parseMemoryValue, formatBytes, formatCpu } from "@/lib/utils";
import { getPluginsWithResourceExtension } from "@/lib/plugins/registry";
import { Eye, EyeOff } from "lucide-react";
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

interface EnvVar {
  name: string;
  value?: string;
  valueFrom?: {
    configMapKeyRef?: { name: string; key: string };
    secretKeyRef?: { name: string; key: string };
    fieldRef?: { fieldPath: string };
    resourceFieldRef?: { containerName?: string; resource: string };
  };
}

interface EnvFromSource {
  configMapRef?: { name: string };
  secretRef?: { name: string };
  prefix?: string;
}

function SecretValueReveal({
  contextName,
  namespace,
  secretName,
  secretKey,
}: {
  contextName: string;
  namespace: string;
  secretName: string;
  secretKey: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["resource", contextName, "secrets", secretName, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/resources/secrets/${encodeURIComponent(secretName)}?namespace=${encodeURIComponent(namespace)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch secret ${secretName}`);
      return res.json();
    },
    enabled: revealed,
  });

  const secretData = (data?.data as Record<string, string>) || {};
  const rawValue = secretData[secretKey];

  return (
    <span className="inline-flex items-center gap-1 ml-2">
      {revealed && (
        <span className="font-mono text-xs">
          {isLoading ? "..." : rawValue ? atob(rawValue) : "?"}
        </span>
      )}
      {!revealed && <span className="text-xs text-muted-foreground">••••••••</span>}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </Button>
    </span>
  );
}

function EnvFromSecretExpander({
  contextName,
  namespace,
  secretName,
  prefix,
}: {
  contextName: string;
  namespace: string;
  secretName: string;
  prefix?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["resource", contextName, "secrets", secretName, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/resources/secrets/${encodeURIComponent(secretName)}?namespace=${encodeURIComponent(namespace)}`
      );
      if (!res.ok) throw new Error(`Failed to fetch secret ${secretName}`);
      return res.json();
    },
    enabled: open,
  });
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const secretData = (data?.data as Record<string, string>) || {};
  const keys = Object.keys(secretData).sort();

  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 text-xs py-1 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <svg
          className={`h-3 w-3 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <Badge variant="outline" className="text-[10px]">Secret</Badge>
        <Link
          href={`/clusters/${encodeURIComponent(contextName)}/config/secrets/${encodeURIComponent(secretName)}?ns=${encodeURIComponent(namespace)}`}
          className="font-mono text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {secretName}
        </Link>
        {prefix && (
          <span className="text-muted-foreground">prefix: <span className="font-mono">{prefix}</span></span>
        )}
      </button>
      {open && (
        <div className="ml-5 border-l divide-y">
          {isLoading && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">Loading...</div>
          )}
          {!isLoading && keys.length === 0 && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">No data</div>
          )}
          {keys.map((key) => {
            const envName = prefix ? `${prefix}${key}` : key;
            const isRevealed = revealed.has(key);
            return (
              <div key={key} className="flex items-center justify-between gap-4 px-3 py-1">
                <span className="font-mono text-xs font-medium shrink-0">{envName}</span>
                <div className="flex items-center gap-1 min-w-0">
                  <span className="font-mono text-xs">
                    {isRevealed ? atob(secretData[key]) : "••••••••"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() =>
                      setRevealed((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                  >
                    {isRevealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EnvVarSource({ env, contextName, namespace }: { env: EnvVar; contextName: string; namespace: string }) {
  const vf = env.valueFrom;
  if (!vf) {
    return <span className="font-mono text-xs break-all">{env.value ?? ""}</span>;
  }
  if (vf.configMapKeyRef) {
    return (
      <span className="text-xs">
        <Badge variant="outline" className="text-[10px] mr-1">ConfigMap</Badge>
        <span className="font-mono">{vf.configMapKeyRef.name}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="font-mono">{vf.configMapKeyRef.key}</span>
      </span>
    );
  }
  if (vf.secretKeyRef) {
    return (
      <span className="text-xs inline-flex items-center flex-wrap">
        <Badge variant="outline" className="text-[10px] mr-1">Secret</Badge>
        <span className="font-mono">{vf.secretKeyRef.name}</span>
        <span className="text-muted-foreground"> / </span>
        <span className="font-mono">{vf.secretKeyRef.key}</span>
        <SecretValueReveal
          contextName={contextName}
          namespace={namespace}
          secretName={vf.secretKeyRef.name}
          secretKey={vf.secretKeyRef.key}
        />
      </span>
    );
  }
  if (vf.fieldRef) {
    return (
      <span className="text-xs">
        <Badge variant="outline" className="text-[10px] mr-1">Field</Badge>
        <span className="font-mono">{vf.fieldRef.fieldPath}</span>
      </span>
    );
  }
  if (vf.resourceFieldRef) {
    return (
      <span className="text-xs">
        <Badge variant="outline" className="text-[10px] mr-1">Resource</Badge>
        <span className="font-mono">{vf.resourceFieldRef.resource}</span>
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">-</span>;
}

function EnvVarsCard({
  containers,
  initContainers,
  contextName,
  namespace,
}: {
  containers: Record<string, unknown>[];
  initContainers: Record<string, unknown>[];
  contextName: string;
  namespace: string;
}) {
  const allContainers: (Record<string, unknown> & { isInit: boolean })[] = [
    ...initContainers.map((c) => ({ ...c, isInit: true as const })),
    ...containers.map((c) => ({ ...c, isInit: false as const })),
  ];
  const containersWithEnv = allContainers.filter((c) => {
    const env = c.env as EnvVar[] | undefined;
    const envFrom = c.envFrom as EnvFromSource[] | undefined;
    return (env && env.length > 0) || (envFrom && envFrom.length > 0);
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    containersWithEnv.forEach((c) => { initial[c.name as string] = true; });
    return initial;
  });

  if (containersWithEnv.length === 0) return null;

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">Environment Variables</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {containersWithEnv.map((container) => {
          const cName = container.name as string;
          const env = (container.env as EnvVar[]) || [];
          const envFrom = (container.envFrom as EnvFromSource[]) || [];
          const isExpanded = expanded[cName] ?? true;

          return (
            <div key={cName} className="rounded-lg border">
              <button
                type="button"
                className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
                onClick={() => setExpanded((prev) => ({ ...prev, [cName]: !prev[cName] }))}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{cName}</span>
                  {container.isInit && <Badge variant="outline" className="text-[10px]">init</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {env.length} var{env.length !== 1 ? "s" : ""}
                    {envFrom.length > 0 && ` + ${envFrom.length} source${envFrom.length !== 1 ? "s" : ""}`}
                  </span>
                </div>
                <svg
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isExpanded && (
                <div className="border-t">
                  {envFrom.length > 0 && (
                    <div className="px-3 py-2 bg-muted/30 border-b">
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Imported from</span>
                      <div className="mt-1 space-y-1">
                        {envFrom.map((src, i) => (
                          <div key={i}>
                            {src.configMapRef && (
                              <div className="flex items-center gap-2 text-xs py-1">
                                <Badge variant="outline" className="text-[10px]">ConfigMap</Badge>
                                <Link
                                  href={`/clusters/${encodeURIComponent(contextName)}/config/configmaps/${encodeURIComponent(src.configMapRef.name)}?ns=${encodeURIComponent(namespace)}`}
                                  className="font-mono text-primary hover:underline"
                                >
                                  {src.configMapRef.name}
                                </Link>
                                {src.prefix && (
                                  <span className="text-muted-foreground">prefix: <span className="font-mono">{src.prefix}</span></span>
                                )}
                              </div>
                            )}
                            {src.secretRef && (
                              <EnvFromSecretExpander
                                contextName={contextName}
                                namespace={namespace}
                                secretName={src.secretRef.name}
                                prefix={src.prefix}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="divide-y">
                    {env.map((e) => (
                      <div key={e.name} className="flex items-start justify-between gap-4 px-3 py-1.5">
                        <span className="font-mono text-xs font-medium shrink-0">{e.name}</span>
                        <div className="text-right min-w-0">
                          <EnvVarSource env={e} contextName={contextName} namespace={namespace} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
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
  const initContainers = (spec.initContainers as Record<string, unknown>[]) || [];
  const containerStatuses = (status.containerStatuses as Record<string, unknown>[]) || [];
  const initContainerStatuses = (status.initContainerStatuses as Record<string, unknown>[]) || [];
  const volumes = (spec.volumes as Record<string, unknown>[]) || [];

  const volumeInfo = useMemo(() => {
    const allContainers = [...initContainers, ...containers];
    return volumes.map((v) => {
      const vName = v.name as string;
      const mountedBy: { container: string; mountPath: string; readOnly?: boolean; subPath?: string }[] = [];
      for (const c of allContainers) {
        const mounts = (c.volumeMounts as Record<string, unknown>[]) || [];
        for (const m of mounts) {
          if (m.name === vName) {
            mountedBy.push({
              container: c.name as string,
              mountPath: m.mountPath as string,
              readOnly: m.readOnly as boolean | undefined,
              subPath: m.subPath as string | undefined,
            });
          }
        }
      }
      let type = "unknown";
      let detail: Record<string, unknown> | null = null;
      if (v.persistentVolumeClaim) { type = "PVC"; detail = v.persistentVolumeClaim as Record<string, unknown>; }
      else if (v.configMap) { type = "ConfigMap"; detail = v.configMap as Record<string, unknown>; }
      else if (v.secret) { type = "Secret"; detail = v.secret as Record<string, unknown>; }
      else if (v.emptyDir !== undefined) { type = "emptyDir"; detail = v.emptyDir as Record<string, unknown>; }
      else if (v.hostPath) { type = "hostPath"; detail = v.hostPath as Record<string, unknown>; }
      else if (v.projected) { type = "projected"; }
      else if (v.downwardAPI) { type = "downwardAPI"; }
      else if (v.csi) { type = "CSI"; detail = v.csi as Record<string, unknown>; }
      return { name: vName, type, detail, mountedBy };
    });
  }, [volumes, containers, initContainers]);

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
              containers={[
                ...initContainers.map((c) => c.name as string),
                ...containers.map((c) => c.name as string),
              ]}
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
              <span className="text-muted-foreground">Service Account</span>
              {spec.serviceAccountName ? (
                <Link
                  href={`/clusters/${encodeURIComponent(ctx)}/config/serviceaccounts/${encodeURIComponent(spec.serviceAccountName as string)}?ns=${encodeURIComponent(namespace)}`}
                  className="text-primary hover:underline font-mono text-xs"
                >
                  {spec.serviceAccountName as string}
                </Link>
              ) : (
                <span className="font-mono text-xs">-</span>
              )}
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
              {initContainers.length > 0 && (
                <>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Init Containers
                  </div>
                  {initContainers.map((container) => {
                    const cName = container.name as string;
                    const cs = initContainerStatuses.find((s) => s.name === cName);
                    const stateObj = cs?.state as Record<string, unknown> | undefined;
                    const terminated = stateObj?.terminated as Record<string, unknown> | undefined;
                    const running = stateObj?.running as Record<string, unknown> | undefined;
                    const statusLabel = terminated
                      ? terminated.reason as string || "Completed"
                      : running
                      ? "Running"
                      : "Waiting";
                    const waiting = stateObj?.waiting as Record<string, unknown> | undefined;
                    const lastTerminated = (cs?.lastState as Record<string, unknown>)?.terminated as Record<string, unknown> | undefined;
                    const isOk = terminated?.exitCode === 0 || !!running;
                    const restarts = (cs?.restartCount as number) || 0;
                    const initVolumeMounts = (container.volumeMounts as Record<string, unknown>[]) || [];

                    return (
                      <div key={cName} className="p-3 rounded-lg border space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-medium text-sm">{cName}</span>
                            <Badge variant="outline" className="ml-2 text-[10px]">init</Badge>
                            <p className="text-xs text-muted-foreground">{container.image as string}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {restarts > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {restarts} restarts
                              </Badge>
                            )}
                            <Badge variant={isOk ? "success" : "warning"}>
                              {statusLabel}
                            </Badge>
                          </div>
                        </div>
                        {!!waiting?.reason && (
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="warning" className="text-[10px]">{waiting.reason as string}</Badge>
                            {!!waiting.message && <span className="text-muted-foreground truncate">{waiting.message as string}</span>}
                          </div>
                        )}
                        {lastTerminated && (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Last:</span>
                            <Badge variant={lastTerminated.exitCode === 0 ? "outline" : "destructive"} className="text-[10px]">
                              {lastTerminated.reason as string || "Terminated"}
                            </Badge>
                            <span className="text-muted-foreground">exit {lastTerminated.exitCode as number}</span>
                            {!!lastTerminated.finishedAt && (
                              <span className="text-muted-foreground">{new Date(lastTerminated.finishedAt as string).toLocaleString()}</span>
                            )}
                          </div>
                        )}
                        {initVolumeMounts.length > 0 && (
                          <div className="text-xs space-y-0.5 pt-1 border-t">
                            <span className="text-muted-foreground font-medium">Mounts</span>
                            {initVolumeMounts.map((vm) => (
                              <div key={vm.mountPath as string} className="flex items-center gap-2 pl-2">
                                <span className="font-mono text-muted-foreground">{vm.mountPath as string}</span>
                                <span className="text-muted-foreground">&larr;</span>
                                <span className="font-mono">{vm.name as string}</span>
                                {!!vm.readOnly && <Badge variant="outline" className="text-[10px]">RO</Badge>}
                                {!!vm.subPath && <span className="text-muted-foreground">sub: {vm.subPath as string}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">
                    App Containers
                  </div>
                </>
              )}
              {containers.map((container) => {
                const cName = container.name as string;
                const cs = containerStatuses.find((s) => s.name === cName);
                const ready = cs?.ready === true;
                const restarts = (cs?.restartCount as number) || 0;
                const resources = container.resources as Record<string, unknown> | undefined;
                const requests = resources?.requests as Record<string, string> | undefined;
                const limits = resources?.limits as Record<string, string> | undefined;
                const metrics = containerMetrics.get(cName);
                const stateObj = cs?.state as Record<string, unknown> | undefined;
                const waiting = stateObj?.waiting as Record<string, unknown> | undefined;
                const lastTerminated = (cs?.lastState as Record<string, unknown>)?.terminated as Record<string, unknown> | undefined;
                const appVolumeMounts = (container.volumeMounts as Record<string, unknown>[]) || [];

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
                    {!!waiting?.reason && (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="warning" className="text-[10px]">{waiting.reason as string}</Badge>
                        {!!waiting.message && <span className="text-muted-foreground truncate">{waiting.message as string}</span>}
                      </div>
                    )}
                    {lastTerminated && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Last:</span>
                        <Badge variant={lastTerminated.exitCode === 0 ? "outline" : "destructive"} className="text-[10px]">
                          {lastTerminated.reason as string || "Terminated"}
                        </Badge>
                        <span className="text-muted-foreground">exit {lastTerminated.exitCode as number}</span>
                        {!!lastTerminated.finishedAt && (
                          <span className="text-muted-foreground">{new Date(lastTerminated.finishedAt as string).toLocaleString()}</span>
                        )}
                      </div>
                    )}
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
                    {appVolumeMounts.length > 0 && (
                      <div className="text-xs space-y-0.5 pt-1 border-t">
                        <span className="text-muted-foreground font-medium">Mounts</span>
                        {appVolumeMounts.map((vm) => (
                          <div key={vm.mountPath as string} className="flex items-center gap-2 pl-2">
                            <span className="font-mono text-muted-foreground">{vm.mountPath as string}</span>
                            <span className="text-muted-foreground">&larr;</span>
                            <span className="font-mono">{vm.name as string}</span>
                            {!!vm.readOnly && <Badge variant="outline" className="text-[10px]">RO</Badge>}
                            {!!vm.subPath && <span className="text-muted-foreground">sub: {vm.subPath as string}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {volumeInfo.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Volumes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {volumeInfo.map((v) => (
                  <div key={v.name} className="p-2 rounded-md border space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{v.name}</span>
                        <Badge variant="outline" className="text-[10px]">{v.type}</Badge>
                      </div>
                      <div>
                        {v.type === "PVC" && v.detail && (
                          <Link
                            href={`/clusters/${encodeURIComponent(ctx)}/storage/persistentvolumeclaims/${encodeURIComponent(v.detail.claimName as string)}?ns=${encodeURIComponent(namespace)}`}
                            className="text-primary hover:underline text-sm"
                          >
                            {v.detail.claimName as string}
                          </Link>
                        )}
                        {v.type === "ConfigMap" && v.detail && (
                          <Link
                            href={`/clusters/${encodeURIComponent(ctx)}/config/configmaps/${encodeURIComponent((v.detail.name as string) || "")}?ns=${encodeURIComponent(namespace)}`}
                            className="text-primary hover:underline text-sm"
                          >
                            {v.detail.name as string}
                          </Link>
                        )}
                        {v.type === "Secret" && v.detail && (
                          <Link
                            href={`/clusters/${encodeURIComponent(ctx)}/config/secrets/${encodeURIComponent((v.detail.secretName as string) || "")}?ns=${encodeURIComponent(namespace)}`}
                            className="text-primary hover:underline text-sm"
                          >
                            {v.detail.secretName as string}
                          </Link>
                        )}
                        {v.type === "hostPath" && v.detail && (
                          <span className="font-mono text-xs text-muted-foreground">{v.detail.path as string}</span>
                        )}
                        {v.type === "emptyDir" && !!v.detail?.medium && (
                          <span className="text-xs text-muted-foreground">{v.detail.medium as string}</span>
                        )}
                      </div>
                    </div>
                    {v.mountedBy.length > 0 && (
                      <div className="text-xs text-muted-foreground pl-2 space-y-0.5">
                        {v.mountedBy.map((m) => (
                          <div key={`${m.container}-${m.mountPath}`} className="flex items-center gap-1">
                            <span>{m.container}</span>
                            <span>&rarr;</span>
                            <span className="font-mono">{m.mountPath}</span>
                            {m.readOnly && <Badge variant="outline" className="text-[10px]">RO</Badge>}
                            {m.subPath && <span>sub: {m.subPath}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <EnvVarsCard
          containers={containers}
          initContainers={initContainers}
          contextName={ctx}
          namespace={namespace}
        />
      </div>
    </ResourceDetail>
  );
}
