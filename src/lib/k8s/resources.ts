import * as k8s from "@kubernetes/client-node";
import { type ResourceKind, RESOURCE_REGISTRY } from "@/lib/constants";
import {
  getCoreApi,
  getAppsApi,
  getBatchApi,
  getNetworkingApi,
  getKubeConfig,
  withTimeout,
} from "./client";

function getApiClient(contextName: string, kind: ResourceKind) {
  const entry = RESOURCE_REGISTRY[kind];
  if (!entry) throw new Error(`Unknown resource kind: ${kind}`);

  if (entry.apiVersion === "v1") return getCoreApi(contextName);
  if (entry.apiVersion === "apps/v1") return getAppsApi(contextName);
  if (entry.apiVersion === "batch/v1") return getBatchApi(contextName);
  if (entry.apiVersion === "networking.k8s.io/v1") return getNetworkingApi(contextName);
  throw new Error(`Unsupported apiVersion: ${entry.apiVersion}`);
}

export async function listResources(
  contextName: string,
  kind: ResourceKind,
  namespace?: string
): Promise<k8s.KubernetesObject[]> {
  const entry = RESOURCE_REGISTRY[kind];
  if (!entry) throw new Error(`Unknown resource kind: ${kind}`);

  const api = getApiClient(contextName, kind);
  const fn = (api as unknown as Record<string, unknown>)[entry.listFn] as Function;
  if (!fn) throw new Error(`Function ${entry.listFn} not found on API client`);

  let result;
  if (entry.namespaced && namespace) {
    result = await withTimeout(fn.call(api, { namespace }));
  } else if (entry.namespaced) {
    // list across all namespaces
    const allNsFn = `${entry.listFn}ForAllNamespaces` in api
      ? (api as unknown as Record<string, unknown>)[`${entry.listFn}ForAllNamespaces`] as Function
      : null;
    // For core API, use the pattern listXForAllNamespaces
    const fnName = entry.listFn.replace("listNamespaced", "listForAllNamespaces") || entry.listFn;
    // Actually, the k8s client uses different method naming. Let's just pass empty namespace.
    // The proper approach is to construct a generic list call
    const listAllFn = (api as unknown as Record<string, unknown>)[
      entry.listFn.replace("listNamespaced", "list") + "ForAllNamespaces"
    ] as Function | undefined;
    if (listAllFn) {
      result = await withTimeout(listAllFn.call(api));
    } else {
      result = await withTimeout(fn.call(api, { namespace: "default" }));
    }
  } else {
    result = await withTimeout(fn.call(api));
  }

  return (result as { items: k8s.KubernetesObject[] }).items || [];
}

export async function getResource(
  contextName: string,
  kind: ResourceKind,
  name: string,
  namespace?: string
): Promise<k8s.KubernetesObject> {
  const entry = RESOURCE_REGISTRY[kind];
  const api = getApiClient(contextName, kind);
  const readFn = entry.listFn.replace("list", "read");
  const fn = (api as unknown as Record<string, unknown>)[readFn] as Function;
  if (!fn) throw new Error(`Function ${readFn} not found`);

  if (entry.namespaced) {
    return fn.call(api, { name, namespace: namespace || "default" });
  }
  return fn.call(api, { name });
}

export async function createResource(
  contextName: string,
  kind: ResourceKind,
  body: k8s.KubernetesObject,
  namespace?: string
): Promise<k8s.KubernetesObject> {
  const entry = RESOURCE_REGISTRY[kind];
  const api = getApiClient(contextName, kind);
  const createFn = entry.listFn.replace("list", "create");
  const fn = (api as unknown as Record<string, unknown>)[createFn] as Function;
  if (!fn) throw new Error(`Function ${createFn} not found`);

  if (entry.namespaced) {
    return fn.call(api, { namespace: namespace || "default", body });
  }
  return fn.call(api, { body });
}

export async function updateResource(
  contextName: string,
  kind: ResourceKind,
  name: string,
  body: k8s.KubernetesObject,
  namespace?: string
): Promise<k8s.KubernetesObject> {
  const entry = RESOURCE_REGISTRY[kind];
  const api = getApiClient(contextName, kind);
  const replaceFn = entry.listFn.replace("list", "replace");
  const fn = (api as unknown as Record<string, unknown>)[replaceFn] as Function;
  if (!fn) throw new Error(`Function ${replaceFn} not found`);

  if (entry.namespaced) {
    return fn.call(api, { name, namespace: namespace || "default", body });
  }
  return fn.call(api, { name, body });
}

export async function deleteResource(
  contextName: string,
  kind: ResourceKind,
  name: string,
  namespace?: string
): Promise<void> {
  const entry = RESOURCE_REGISTRY[kind];
  const api = getApiClient(contextName, kind);
  const deleteFn = entry.listFn.replace("list", "delete");
  const fn = (api as unknown as Record<string, unknown>)[deleteFn] as Function;
  if (!fn) throw new Error(`Function ${deleteFn} not found`);

  if (entry.namespaced) {
    await fn.call(api, { name, namespace: namespace || "default" });
  } else {
    await fn.call(api, { name });
  }
}

export async function patchResource(
  contextName: string,
  kind: ResourceKind,
  name: string,
  patch: object,
  namespace?: string
): Promise<k8s.KubernetesObject> {
  const entry = RESOURCE_REGISTRY[kind];
  const api = getApiClient(contextName, kind);
  const patchFn = entry.listFn.replace("list", "patch");
  const fn = (api as unknown as Record<string, unknown>)[patchFn] as Function;
  if (!fn) throw new Error(`Function ${patchFn} not found`);

  const options = {
    headers: { "Content-Type": "application/strategic-merge-patch+json" },
  };

  if (entry.namespaced) {
    return fn.call(api, { name, namespace: namespace || "default", body: patch }, options);
  }
  return fn.call(api, { name, body: patch }, options);
}
