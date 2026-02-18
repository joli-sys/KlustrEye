export type ResourceKind =
  | "pods"
  | "deployments"
  | "statefulsets"
  | "daemonsets"
  | "replicasets"
  | "jobs"
  | "cronjobs"
  | "services"
  | "ingresses"
  | "configmaps"
  | "secrets"
  | "persistentvolumeclaims"
  | "nodes"
  | "namespaces"
  | "serviceaccounts"
  | "poddisruptionbudgets"
  | "horizontalpodautoscalers"
  | "events";

export interface ResourceRegistryEntry {
  kind: string;
  apiVersion: string;
  plural: string;
  namespaced: boolean;
  group: "workloads" | "network" | "config" | "storage" | "cluster";
  label: string;
  labelPlural: string;
  listFn: string;
}

export const RESOURCE_REGISTRY: Record<ResourceKind, ResourceRegistryEntry> = {
  pods: {
    kind: "Pod",
    apiVersion: "v1",
    plural: "pods",
    namespaced: true,
    group: "workloads",
    label: "Pod",
    labelPlural: "Pods",
    listFn: "listNamespacedPod",
  },
  deployments: {
    kind: "Deployment",
    apiVersion: "apps/v1",
    plural: "deployments",
    namespaced: true,
    group: "workloads",
    label: "Deployment",
    labelPlural: "Deployments",
    listFn: "listNamespacedDeployment",
  },
  statefulsets: {
    kind: "StatefulSet",
    apiVersion: "apps/v1",
    plural: "statefulsets",
    namespaced: true,
    group: "workloads",
    label: "StatefulSet",
    labelPlural: "StatefulSets",
    listFn: "listNamespacedStatefulSet",
  },
  daemonsets: {
    kind: "DaemonSet",
    apiVersion: "apps/v1",
    plural: "daemonsets",
    namespaced: true,
    group: "workloads",
    label: "DaemonSet",
    labelPlural: "DaemonSets",
    listFn: "listNamespacedDaemonSet",
  },
  replicasets: {
    kind: "ReplicaSet",
    apiVersion: "apps/v1",
    plural: "replicasets",
    namespaced: true,
    group: "workloads",
    label: "ReplicaSet",
    labelPlural: "ReplicaSets",
    listFn: "listNamespacedReplicaSet",
  },
  jobs: {
    kind: "Job",
    apiVersion: "batch/v1",
    plural: "jobs",
    namespaced: true,
    group: "workloads",
    label: "Job",
    labelPlural: "Jobs",
    listFn: "listNamespacedJob",
  },
  cronjobs: {
    kind: "CronJob",
    apiVersion: "batch/v1",
    plural: "cronjobs",
    namespaced: true,
    group: "workloads",
    label: "CronJob",
    labelPlural: "CronJobs",
    listFn: "listNamespacedCronJob",
  },
  services: {
    kind: "Service",
    apiVersion: "v1",
    plural: "services",
    namespaced: true,
    group: "network",
    label: "Service",
    labelPlural: "Services",
    listFn: "listNamespacedService",
  },
  ingresses: {
    kind: "Ingress",
    apiVersion: "networking.k8s.io/v1",
    plural: "ingresses",
    namespaced: true,
    group: "network",
    label: "Ingress",
    labelPlural: "Ingresses",
    listFn: "listNamespacedIngress",
  },
  configmaps: {
    kind: "ConfigMap",
    apiVersion: "v1",
    plural: "configmaps",
    namespaced: true,
    group: "config",
    label: "ConfigMap",
    labelPlural: "ConfigMaps",
    listFn: "listNamespacedConfigMap",
  },
  secrets: {
    kind: "Secret",
    apiVersion: "v1",
    plural: "secrets",
    namespaced: true,
    group: "config",
    label: "Secret",
    labelPlural: "Secrets",
    listFn: "listNamespacedSecret",
  },
  persistentvolumeclaims: {
    kind: "PersistentVolumeClaim",
    apiVersion: "v1",
    plural: "persistentvolumeclaims",
    namespaced: true,
    group: "storage",
    label: "PersistentVolumeClaim",
    labelPlural: "PersistentVolumeClaims",
    listFn: "listNamespacedPersistentVolumeClaim",
  },
  serviceaccounts: {
    kind: "ServiceAccount",
    apiVersion: "v1",
    plural: "serviceaccounts",
    namespaced: true,
    group: "config",
    label: "ServiceAccount",
    labelPlural: "ServiceAccounts",
    listFn: "listNamespacedServiceAccount",
  },
  nodes: {
    kind: "Node",
    apiVersion: "v1",
    plural: "nodes",
    namespaced: false,
    group: "cluster",
    label: "Node",
    labelPlural: "Nodes",
    listFn: "listNode",
  },
  namespaces: {
    kind: "Namespace",
    apiVersion: "v1",
    plural: "namespaces",
    namespaced: false,
    group: "cluster",
    label: "Namespace",
    labelPlural: "Namespaces",
    listFn: "listNamespace",
  },
  poddisruptionbudgets: {
    kind: "PodDisruptionBudget",
    apiVersion: "policy/v1",
    plural: "poddisruptionbudgets",
    namespaced: true,
    group: "workloads",
    label: "PodDisruptionBudget",
    labelPlural: "PodDisruptionBudgets",
    listFn: "listNamespacedPodDisruptionBudget",
  },
  horizontalpodautoscalers: {
    kind: "HorizontalPodAutoscaler",
    apiVersion: "autoscaling/v2",
    plural: "horizontalpodautoscalers",
    namespaced: true,
    group: "workloads",
    label: "HorizontalPodAutoscaler",
    labelPlural: "HorizontalPodAutoscalers",
    listFn: "listNamespacedHorizontalPodAutoscaler",
  },
  events: {
    kind: "Event",
    apiVersion: "v1",
    plural: "events",
    namespaced: true,
    group: "cluster",
    label: "Event",
    labelPlural: "Events",
    listFn: "listNamespacedEvent",
  },
};

export const RESOURCE_ROUTE_MAP: Record<
  string,
  { path: string; hasDetail: boolean }
> = {
  pods: { path: "workloads/pods", hasDetail: true },
  deployments: { path: "workloads/deployments", hasDetail: true },
  statefulsets: { path: "workloads/statefulsets", hasDetail: true },
  daemonsets: { path: "workloads/daemonsets", hasDetail: true },
  replicasets: { path: "workloads/replicasets", hasDetail: true },
  jobs: { path: "workloads/jobs", hasDetail: true },
  cronjobs: { path: "workloads/cronjobs", hasDetail: true },
  services: { path: "network/services", hasDetail: true },
  ingresses: { path: "network/ingresses", hasDetail: true },
  configmaps: { path: "config/configmaps", hasDetail: true },
  secrets: { path: "config/secrets", hasDetail: true },
  persistentvolumeclaims: { path: "storage/persistentvolumeclaims", hasDetail: true },
  serviceaccounts: { path: "config/serviceaccounts", hasDetail: true },
  poddisruptionbudgets: { path: "workloads/poddisruptionbudgets", hasDetail: true },
  horizontalpodautoscalers: { path: "workloads/hpa", hasDetail: true },
  nodes: { path: "nodes", hasDetail: true },
  namespaces: { path: "namespaces", hasDetail: false },
  events: { path: "events", hasDetail: false },
};

export function getResourceHref(
  contextName: string,
  kind: string,
  name: string,
  namespace?: string
): string {
  const route = RESOURCE_ROUTE_MAP[kind];
  if (!route) return `/clusters/${encodeURIComponent(contextName)}`;
  const base = `/clusters/${encodeURIComponent(contextName)}/${route.path}`;
  if (!route.hasDetail) return base;
  const detail = `${base}/${encodeURIComponent(name)}`;
  if (namespace) return `${detail}?ns=${encodeURIComponent(namespace)}`;
  return detail;
}

export const SIDEBAR_SECTIONS = [
  {
    title: "Cluster",
    items: [
      { label: "Overview", href: "overview", icon: "LayoutDashboard" },
      { label: "Nodes", href: "nodes", icon: "Server" },
    ],
  },
  {
    title: "Workloads",
    items: [
      { label: "Pods", href: "workloads/pods", icon: "Box" },
      { label: "Deployments", href: "workloads/deployments", icon: "Layers" },
      { label: "StatefulSets", href: "workloads/statefulsets", icon: "Database" },
      { label: "DaemonSets", href: "workloads/daemonsets", icon: "Cpu" },
      { label: "ReplicaSets", href: "workloads/replicasets", icon: "Copy" },
      { label: "Jobs", href: "workloads/jobs", icon: "Play" },
      { label: "CronJobs", href: "workloads/cronjobs", icon: "Clock" },
      { label: "PDB", href: "workloads/poddisruptionbudgets", icon: "ShieldCheck" },
      { label: "HPA", href: "workloads/hpa", icon: "ArrowUpDown" },
      { label: "VPA", href: "workloads/vpa", icon: "SlidersHorizontal" },
    ],
  },
  {
    title: "Network",
    items: [
      { label: "Services", href: "network/services", icon: "Network" },
      { label: "Ingresses", href: "network/ingresses", icon: "Globe" },
      { label: "Network Map", href: "network/map", icon: "Share2" },
      { label: "Port Forwards", href: "network/port-forwards", icon: "Cable" },
    ],
  },
  {
    title: "Config",
    items: [
      { label: "ConfigMaps", href: "config/configmaps", icon: "FileText" },
      { label: "Secrets", href: "config/secrets", icon: "KeyRound" },
      { label: "ServiceAccounts", href: "config/serviceaccounts", icon: "UserCog" },
    ],
  },
  {
    title: "Storage",
    items: [
      { label: "PVCs", href: "storage/persistentvolumeclaims", icon: "HardDrive" },
    ],
  },
  {
    title: "Cluster",
    items: [
      { label: "Events", href: "events", icon: "Activity" },
      { label: "CRDs", href: "crds", icon: "Puzzle" },
      { label: "Helm", href: "helm", icon: "Anchor" },
    ],
  },
];
