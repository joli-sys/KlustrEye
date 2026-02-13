import * as k8s from "@kubernetes/client-node";
import { type CloudProvider, detectCloudProvider } from "./provider";

const kubeconfigs = new Map<string, k8s.KubeConfig>();

let customKubeconfigPath: string | null = null;
let kubeconfigInitialized = false;

export function setKubeconfigPath(p: string | null): void {
  customKubeconfigPath = p;
  kubeconfigInitialized = true;
}

async function ensureKubeconfigInitialized(): Promise<void> {
  if (kubeconfigInitialized) return;
  kubeconfigInitialized = true;
  try {
    // Dynamic import to avoid circular deps at module load time
    const { prisma } = await import("@/lib/prisma");
    const pref = await prisma.userPreference.findUnique({
      where: { key: "kubeconfigPath" },
    });
    if (pref?.value) {
      customKubeconfigPath = pref.value;
      process.env.KUBECONFIG = pref.value;
    }
  } catch {
    // DB not ready yet — use defaults
  }
}

function loadKubeConfig(): k8s.KubeConfig {
  const kc = new k8s.KubeConfig();
  const configPath = customKubeconfigPath || process.env.KUBECONFIG_PATH;
  if (configPath) {
    kc.loadFromFile(configPath);
  } else {
    kc.loadFromDefault();
  }
  return kc;
}

export interface ClusterContextInfo {
  name: string;
  cluster: string;
  user: string;
  namespace: string;
  isCurrent: boolean;
  provider: "kubeconfig";
  cloudProvider: CloudProvider;
}

export function getKubeconfigContexts(): k8s.Context[] {
  try {
    const kc = loadKubeConfig();
    return kc.getContexts();
  } catch {
    return [];
  }
}

export async function getContexts(): Promise<ClusterContextInfo[]> {
  try {
    await ensureKubeconfigInitialized();
    const kc = loadKubeConfig();
    const contexts = kc.getContexts();
    const currentContext = kc.getCurrentContext();

    return contexts.map((ctx) => {
      const cluster = kc.getCluster(ctx.cluster);
      const serverUrl = cluster?.server || "";
      return {
        name: ctx.name,
        cluster: ctx.cluster,
        user: ctx.user,
        namespace: ctx.namespace || "default",
        isCurrent: ctx.name === currentContext,
        provider: "kubeconfig" as const,
        cloudProvider: detectCloudProvider(serverUrl),
      };
    });
  } catch {
    return [];
  }
}

export function getCurrentContext(): string {
  try {
    const kc = loadKubeConfig();
    return kc.getCurrentContext();
  } catch {
    return "";
  }
}

export function getKubeConfig(contextName: string): k8s.KubeConfig {
  let kc = kubeconfigs.get(contextName);
  if (!kc) {
    kc = loadKubeConfig();
    kc.setCurrentContext(contextName);
    kubeconfigs.set(contextName, kc);
  }
  return kc;
}

export function getCoreApi(contextName: string): k8s.CoreV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.CoreV1Api);
}

export function getAppsApi(contextName: string): k8s.AppsV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.AppsV1Api);
}

export function getBatchApi(contextName: string): k8s.BatchV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.BatchV1Api);
}

export function getNetworkingApi(contextName: string): k8s.NetworkingV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.NetworkingV1Api);
}

export function getRbacApi(contextName: string): k8s.RbacAuthorizationV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.RbacAuthorizationV1Api);
}

export function getStorageApi(contextName: string): k8s.StorageV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.StorageV1Api);
}

export function getApiExtensionsApi(contextName: string): k8s.ApiextensionsV1Api {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.ApiextensionsV1Api);
}

export function getCustomObjectsApi(contextName: string): k8s.CustomObjectsApi {
  const kc = getKubeConfig(contextName);
  return kc.makeApiClient(k8s.CustomObjectsApi);
}

export function getMetricsClient(contextName: string): k8s.Metrics {
  const kc = getKubeConfig(contextName);
  return new k8s.Metrics(kc);
}

export function getLogApi(contextName: string): k8s.Log {
  const kc = getKubeConfig(contextName);
  return new k8s.Log(kc);
}

export function getExecApi(contextName: string): k8s.Exec {
  const kc = getKubeConfig(contextName);
  return new k8s.Exec(kc);
}

export function getWatchApi(contextName: string): k8s.Watch {
  const kc = getKubeConfig(contextName);
  return new k8s.Watch(kc);
}

const K8S_TIMEOUT_MS = 10_000;

export function withTimeout<T>(promise: Promise<T>, ms = K8S_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Connection timed out")), ms)
    ),
  ]);
}

export async function testConnection(contextName: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const kc = getKubeConfig(contextName);
    const versionApi = kc.makeApiClient(k8s.VersionApi);
    const result = await withTimeout(versionApi.getCode());
    return { ok: true, version: result.gitVersion };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: message };
  }
}

export function clearCache(contextName?: string): void {
  if (contextName) {
    kubeconfigs.delete(contextName);
  } else {
    kubeconfigs.clear();
  }
}
