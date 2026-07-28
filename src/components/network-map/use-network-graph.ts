import { useMemo } from "react";
import type { Node, Edge } from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";
import { useResources } from "@/hooks/use-resources";
import { useWorkspaceNamespace } from "@/hooks/use-cluster-namespace";
import { useWorkspaceId } from "@/hooks/use-cluster-path";

export interface NetworkNodeData extends Record<string, unknown> {
  label: string;
  kind: "Ingress" | "IngressRoute" | "Service" | "Pod" | "ConfigMap" | "Secret" | "PVC";
  namespace: string;
  status?: string;
  serviceType?: string;
  ports?: string;
  owner?: string;
  resourceName: string;
  hosts?: string[];
  matchRules?: string[];
  entryPoints?: string[];
  storageClass?: string;
}

export type ViewMode = "network" | "dependencies";

function useTraefikIngressRoutes(contextName: string, namespace?: string) {
  // Try traefik.io group (modern)
  const modern = useQuery<K8sResource[]>({
    queryKey: ["traefik-ingressroutes", "traefik.io", contextName, namespace],
    queryFn: async () => {
      const base = `/api/clusters/${encodeURIComponent(contextName)}/custom-resources/traefik.io/v1alpha1/ingressroutes`;
      const url = namespace ? `${base}?namespace=${encodeURIComponent(namespace)}` : base;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items ?? [];
    },
    enabled: !!contextName,
  });

  // Try traefik.containo.us group (legacy)
  const legacy = useQuery<K8sResource[]>({
    queryKey: ["traefik-ingressroutes", "traefik.containo.us", contextName, namespace],
    queryFn: async () => {
      const base = `/api/clusters/${encodeURIComponent(contextName)}/custom-resources/traefik.containo.us/v1alpha1/ingressroutes`;
      const url = namespace ? `${base}?namespace=${encodeURIComponent(namespace)}` : base;
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json();
      return data.items ?? [];
    },
    enabled: !!contextName,
  });

  // Merge and deduplicate by namespace/name
  const data = useMemo(() => {
    const all = [...(modern.data ?? []), ...(legacy.data ?? [])];
    const seen = new Set<string>();
    return all.filter((r) => {
      const key = `${r.metadata?.namespace}/${r.metadata?.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [modern.data, legacy.data]);

  return {
    data,
    isLoading: modern.isLoading || legacy.isLoading,
  };
}

/** Extract Host(`...`) values from a Traefik match string */
function parseTraefikHosts(match: string): string[] {
  const hosts: string[] = [];
  const re = /Host\(`([^`]+)`\)/gi;
  let m;
  while ((m = re.exec(match)) !== null) {
    hosts.push(m[1]);
  }
  return hosts;
}

export function useNetworkGraph(contextName: string, viewMode: ViewMode = "network") {
  const wsId = useWorkspaceId();
  const selectedNamespace = useWorkspaceNamespace(wsId);
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;

  const services = useResources(contextName, "services", ns);
  const ingresses = useResources(contextName, "ingresses", ns);
  const pods = useResources(contextName, "pods", ns);
  const deployments = useResources(contextName, "deployments", ns);
  const statefulsets = useResources(contextName, "statefulsets", ns);
  const daemonsets = useResources(contextName, "daemonsets", ns);
  const ingressRoutes = useTraefikIngressRoutes(contextName, ns);
  const configmaps = useResources(contextName, "configmaps", ns);
  const secrets = useResources(contextName, "secrets", ns);
  const pvcs = useResources(contextName, "persistentvolumeclaims", ns);

  const isLoading =
    services.isLoading ||
    ingresses.isLoading ||
    pods.isLoading ||
    deployments.isLoading ||
    statefulsets.isLoading ||
    daemonsets.isLoading ||
    ingressRoutes.isLoading ||
    (viewMode === "dependencies" && (configmaps.isLoading || secrets.isLoading || pvcs.isLoading));

  const depGraph = useMemo(() => {
    if (viewMode !== "dependencies") return { nodes: [], edges: [] };

    const podItems: K8sResource[] = pods.data ?? [];
    const cmItems: K8sResource[] = configmaps.data ?? [];
    const secItems: K8sResource[] = secrets.data ?? [];
    const pvcItems: K8sResource[] = pvcs.data ?? [];

    const nodes: Node<NetworkNodeData>[] = [];
    const edges: Edge[] = [];

    // Index configmaps, secrets, pvcs by namespace/name
    const cmIndex = new Map<string, K8sResource>();
    for (const cm of cmItems) {
      cmIndex.set(`${cm.metadata?.namespace}/${cm.metadata?.name}`, cm);
    }
    const secIndex = new Map<string, K8sResource>();
    for (const s of secItems) {
      // Skip auto-created service account tokens
      if ((s as K8sResource & { type?: string }).type === "kubernetes.io/service-account-token") continue;
      secIndex.set(`${s.metadata?.namespace}/${s.metadata?.name}`, s);
    }
    const pvcIndex = new Map<string, K8sResource>();
    for (const p of pvcItems) {
      pvcIndex.set(`${p.metadata?.namespace}/${p.metadata?.name}`, p);
    }

    const addedCMs = new Set<string>();
    const addedSecrets = new Set<string>();
    const addedPVCs = new Set<string>();

    for (const pod of podItems) {
      const podName = pod.metadata?.name ?? "";
      const podNs = pod.metadata?.namespace ?? "";
      const podId = `pod-${podNs}-${podName}`;

      nodes.push({
        id: podId,
        type: "pod",
        position: { x: 0, y: 0 },
        data: {
          label: podName,
          kind: "Pod",
          namespace: podNs,
          status: derivePodStatus(pod),
          resourceName: podName,
        },
      });

      const referencedCMs = new Set<string>();
      const referencedSecrets = new Set<string>();
      const referencedPVCs = new Set<string>();

      // Volumes
      for (const vol of pod.spec?.volumes ?? []) {
        if (vol.configMap?.name) referencedCMs.add(vol.configMap.name);
        if (vol.secret?.secretName) referencedSecrets.add(vol.secret.secretName);
        if (vol.persistentVolumeClaim?.claimName) referencedPVCs.add(vol.persistentVolumeClaim.claimName);
      }
      // EnvFrom + Env
      for (const container of [...(pod.spec?.containers ?? []), ...(pod.spec?.initContainers ?? [])]) {
        for (const ef of container.envFrom ?? []) {
          if (ef.configMapRef?.name) referencedCMs.add(ef.configMapRef.name);
          if (ef.secretRef?.name) referencedSecrets.add(ef.secretRef.name);
        }
        for (const env of container.env ?? []) {
          if (env.valueFrom?.configMapKeyRef?.name) referencedCMs.add(env.valueFrom.configMapKeyRef.name);
          if (env.valueFrom?.secretKeyRef?.name) referencedSecrets.add(env.valueFrom.secretKeyRef.name);
        }
      }

      for (const cmName of referencedCMs) {
        const key = `${podNs}/${cmName}`;
        const cmId = `cm-${podNs}-${cmName}`;
        if (!addedCMs.has(cmId)) {
          addedCMs.add(cmId);
          nodes.push({
            id: cmId,
            type: "configmap",
            position: { x: 0, y: 0 },
            data: { label: cmName, kind: "ConfigMap", namespace: podNs, resourceName: cmName },
          });
        }
        edges.push({
          id: `${cmId}-${podId}`,
          source: cmId,
          target: podId,
          animated: true,
          style: { stroke: "oklch(0.7 0.18 180)", strokeDasharray: "5 5" },
        });
        cmIndex.delete(key);
      }

      for (const secName of referencedSecrets) {
        const secId = `sec-${podNs}-${secName}`;
        if (!addedSecrets.has(secId)) {
          addedSecrets.add(secId);
          nodes.push({
            id: secId,
            type: "secret",
            position: { x: 0, y: 0 },
            data: { label: secName, kind: "Secret", namespace: podNs, resourceName: secName },
          });
        }
        edges.push({
          id: `${secId}-${podId}`,
          source: secId,
          target: podId,
          animated: true,
          style: { stroke: "oklch(0.65 0.18 30)", strokeDasharray: "5 5" },
        });
      }

      for (const pvcName of referencedPVCs) {
        const pvcId = `pvc-${podNs}-${pvcName}`;
        const pvcResource = pvcIndex.get(`${podNs}/${pvcName}`);
        if (!addedPVCs.has(pvcId)) {
          addedPVCs.add(pvcId);
          nodes.push({
            id: pvcId,
            type: "pvc",
            position: { x: 0, y: 0 },
            data: {
              label: pvcName,
              kind: "PVC",
              namespace: podNs,
              resourceName: pvcName,
              storageClass: pvcResource?.spec?.storageClassName,
            },
          });
        }
        edges.push({
          id: `${podId}-${pvcId}`,
          source: podId,
          target: pvcId,
          animated: true,
          style: { stroke: "oklch(0.6 0.18 340)", strokeDasharray: "5 5" },
        });
      }
    }

    return { nodes, edges };
  }, [viewMode, pods.data, configmaps.data, secrets.data, pvcs.data]);

  const { nodes, edges } = useMemo(() => {
    const svcItems: K8sResource[] = services.data ?? [];
    const ingItems: K8sResource[] = ingresses.data ?? [];
    const podItems: K8sResource[] = pods.data ?? [];
    const depItems: K8sResource[] = deployments.data ?? [];
    const stsItems: K8sResource[] = statefulsets.data ?? [];
    const dsItems: K8sResource[] = daemonsets.data ?? [];
    const irItems: K8sResource[] = ingressRoutes.data ?? [];

    // Build owner lookup: ReplicaSet owner → Deployment name
    const ownerMap = new Map<string, string>();
    for (const dep of depItems) {
      ownerMap.set(
        `Deployment/${dep.metadata?.namespace}/${dep.metadata?.name}`,
        dep.metadata?.name ?? ""
      );
    }
    for (const sts of stsItems) {
      ownerMap.set(
        `StatefulSet/${sts.metadata?.namespace}/${sts.metadata?.name}`,
        sts.metadata?.name ?? ""
      );
    }
    for (const ds of dsItems) {
      ownerMap.set(
        `DaemonSet/${ds.metadata?.namespace}/${ds.metadata?.name}`,
        ds.metadata?.name ?? ""
      );
    }

    const nodes: Node<NetworkNodeData>[] = [];
    const edges: Edge[] = [];

    // Track service nodes by namespace/name for ingress linking
    const svcNodeIds = new Map<string, string>();

    // Create Service nodes
    for (const svc of svcItems) {
      const name = svc.metadata?.name ?? "";
      const namespace = svc.metadata?.namespace ?? "";
      const id = `svc-${namespace}-${name}`;
      svcNodeIds.set(`${namespace}/${name}`, id);

      const portList = (svc.spec?.ports ?? [])
        .map((p: { port?: number; targetPort?: number | string; protocol?: string }) =>
          `${p.port}${p.targetPort ? "→" + p.targetPort : ""}/${p.protocol ?? "TCP"}`
        )
        .join(", ");

      nodes.push({
        id,
        type: "service",
        position: { x: 0, y: 0 },
        data: {
          label: name,
          kind: "Service",
          namespace,
          serviceType: svc.spec?.type ?? "ClusterIP",
          ports: portList,
          resourceName: name,
        },
      });

      // Match pods by service selector
      const selector: Record<string, string> = svc.spec?.selector ?? {};
      if (Object.keys(selector).length > 0) {
        for (const pod of podItems) {
          const podLabels: Record<string, string> = pod.metadata?.labels ?? {};
          const podNs = pod.metadata?.namespace ?? "";
          if (podNs !== namespace) continue;

          const matches = Object.entries(selector).every(
            ([k, v]) => podLabels[k] === v
          );
          if (matches) {
            const podName = pod.metadata?.name ?? "";
            const podId = `pod-${podNs}-${podName}`;
            edges.push({
              id: `${id}-${podId}`,
              source: id,
              target: podId,
              animated: true,
              style: { stroke: "oklch(0.648 0.2 260)", strokeDasharray: "5 5" },
            });
          }
        }
      }
    }

    // Create Ingress nodes and edges to services
    for (const ing of ingItems) {
      const name = ing.metadata?.name ?? "";
      const namespace = ing.metadata?.namespace ?? "";
      const id = `ing-${namespace}-${name}`;

      // Collect hosts from rules
      const rules: IngressRule[] = ing.spec?.rules ?? [];
      const hosts: string[] = [];
      for (const rule of rules) {
        if (rule.host) hosts.push(rule.host);
      }

      nodes.push({
        id,
        type: "ingress",
        position: { x: 0, y: 0 },
        data: {
          label: name,
          kind: "Ingress",
          namespace,
          resourceName: name,
          hosts: hosts.length > 0 ? hosts : undefined,
        },
      });

      // Link ingress to backend services
      const linkedServices = new Set<string>();
      for (const rule of rules) {
        const paths: IngressPath[] = rule.http?.paths ?? [];
        for (const path of paths) {
          const svcName = path.backend?.service?.name;
          if (svcName) {
            const key = `${namespace}/${svcName}`;
            if (!linkedServices.has(key)) {
              linkedServices.add(key);
              const svcId = svcNodeIds.get(key);
              if (svcId) {
                edges.push({
                  id: `${id}-${svcId}`,
                  source: id,
                  target: svcId,
                  animated: true,
                  style: { stroke: "oklch(0.65 0.18 300)", strokeDasharray: "5 5" },
                });
              }
            }
          }
        }
      }
    }

    // Create Traefik IngressRoute nodes and edges to services
    for (const ir of irItems) {
      const name = ir.metadata?.name ?? "";
      const namespace = ir.metadata?.namespace ?? "";
      const id = `ir-${namespace}-${name}`;

      const routes: TraefikRoute[] = ir.spec?.routes ?? [];
      const entryPoints: string[] = ir.spec?.entryPoints ?? [];

      // Collect hosts and match rules from all routes
      const allHosts: string[] = [];
      const matchRules: string[] = [];
      const linkedServices = new Set<string>();

      for (const route of routes) {
        const match = route.match ?? "";
        if (match) matchRules.push(match);

        // Extract hosts from match expression
        const hosts = parseTraefikHosts(match);
        for (const h of hosts) {
          if (!allHosts.includes(h)) allHosts.push(h);
        }

        // Link to backend services
        const routeServices: TraefikRouteService[] = route.services ?? [];
        for (const rs of routeServices) {
          const svcName = rs.name;
          if (svcName) {
            const key = `${namespace}/${svcName}`;
            if (!linkedServices.has(key)) {
              linkedServices.add(key);
              const svcId = svcNodeIds.get(key);
              if (svcId) {
                edges.push({
                  id: `${id}-${svcId}`,
                  source: id,
                  target: svcId,
                  animated: true,
                  style: { stroke: "oklch(0.7 0.18 55)", strokeDasharray: "5 5" },
                });
              }
            }
          }
        }
      }

      nodes.push({
        id,
        type: "ingressroute",
        position: { x: 0, y: 0 },
        data: {
          label: name,
          kind: "IngressRoute",
          namespace,
          resourceName: name,
          hosts: allHosts.length > 0 ? allHosts : undefined,
          matchRules: matchRules.length > 0 ? matchRules : undefined,
          entryPoints: entryPoints.length > 0 ? entryPoints : undefined,
        },
      });
    }

    // Create Pod nodes
    const addedPodIds = new Set<string>();
    for (const pod of podItems) {
      const podName = pod.metadata?.name ?? "";
      const podNs = pod.metadata?.namespace ?? "";
      const podId = `pod-${podNs}-${podName}`;

      // Only include pods that are targeted by a service (connected to the network graph)
      const isConnected = edges.some((e) => e.target === podId);
      if (!isConnected) continue;
      if (addedPodIds.has(podId)) continue;
      addedPodIds.add(podId);

      // Resolve owner
      let owner: string | undefined;
      const ownerRef = pod.metadata?.ownerReferences?.[0];
      if (ownerRef) {
        const ownerKind = ownerRef.kind;
        const ownerName = ownerRef.name;
        if (ownerKind === "ReplicaSet") {
          for (const dep of depItems) {
            if (dep.metadata?.namespace !== podNs) continue;
            const depName = dep.metadata?.name ?? "";
            if (ownerName?.startsWith(depName + "-")) {
              owner = depName;
              break;
            }
          }
          if (!owner) owner = ownerName;
        } else {
          const key = `${ownerKind}/${podNs}/${ownerName}`;
          owner = ownerMap.get(key) ?? ownerName;
        }
      }

      nodes.push({
        id: podId,
        type: "pod",
        position: { x: 0, y: 0 },
        data: {
          label: podName,
          kind: "Pod",
          namespace: podNs,
          status: derivePodStatus(pod),
          owner,
          resourceName: podName,
        },
      });
    }

    return { nodes, edges };
  }, [
    services.data,
    ingresses.data,
    pods.data,
    deployments.data,
    statefulsets.data,
    daemonsets.data,
    ingressRoutes.data,
  ]);

  const result = viewMode === "dependencies" ? depGraph : { nodes, edges };
  return { nodes: result.nodes, edges: result.edges, isLoading };
}

function derivePodStatus(pod: K8sResource): string {
  const phase = pod.status?.phase ?? "Unknown";

  // Pod with deletionTimestamp is Terminating (not a real phase, but kubectl shows it)
  if (pod.metadata?.deletionTimestamp) return "Terminating";

  // Check init container statuses for waiting states
  const initStatuses: ContainerStatus[] = pod.status?.initContainerStatuses ?? [];
  for (const cs of initStatuses) {
    if (cs.state?.waiting?.reason) return `Init:${cs.state.waiting.reason}`;
    if (cs.state?.terminated && cs.state.terminated.reason !== "Completed")
      return `Init:${cs.state.terminated.reason ?? "Error"}`;
  }

  // Check container statuses for waiting/terminated states
  const containerStatuses: ContainerStatus[] = pod.status?.containerStatuses ?? [];
  for (const cs of containerStatuses) {
    if (cs.state?.waiting?.reason) return cs.state.waiting.reason;
    if (cs.state?.terminated?.reason) return cs.state.terminated.reason;
  }

  // Pod is Running but check if it's actually Ready
  if (phase === "Running") {
    const conditions: PodCondition[] = pod.status?.conditions ?? [];
    const readyCond = conditions.find((c) => c.type === "Ready");
    if (readyCond && readyCond.status !== "True") return "NotReady";
  }

  return phase;
}

// Minimal type helpers for K8s resource shapes
/* eslint-disable @typescript-eslint/no-explicit-any */
interface K8sResource {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    ownerReferences?: { kind: string; name: string }[];
    deletionTimestamp?: string;
  };
  spec?: any;
  status?: any;
}

interface IngressRule {
  host?: string;
  http?: {
    paths?: IngressPath[];
  };
}

interface IngressPath {
  backend?: {
    service?: {
      name?: string;
    };
  };
}

interface TraefikRoute {
  match?: string;
  services?: TraefikRouteService[];
}

interface TraefikRouteService {
  name?: string;
  port?: number | string;
}

interface PodCondition {
  type: string;
  status: string;
}

interface ContainerStatus {
  state?: {
    waiting?: { reason?: string };
    terminated?: { reason?: string };
  };
}
