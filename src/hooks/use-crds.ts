"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface CRDDefinition {
  metadata: { name: string; creationTimestamp: string; uid: string };
  spec: {
    group: string;
    names: { kind: string; listKind: string; plural: string; singular: string; shortNames?: string[] };
    scope: "Namespaced" | "Cluster";
    versions: { name: string; served: boolean; storage: boolean }[];
  };
  status?: {
    storedVersions?: string[];
    conditions?: { type: string; status: string }[];
  };
}

export function useCRDs(contextName: string) {
  return useQuery({
    queryKey: ["crds", contextName],
    queryFn: async () => {
      const res = await fetch(`/api/clusters/${encodeURIComponent(contextName)}/crds`);
      if (!res.ok) throw new Error("Failed to fetch CRDs");
      const data = await res.json();
      return (data.items || []) as CRDDefinition[];
    },
    enabled: !!contextName,
  });
}

function customResourceUrl(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  name?: string
) {
  const base = `/api/clusters/${encodeURIComponent(contextName)}/custom-resources/${encodeURIComponent(group)}/${encodeURIComponent(version)}/${encodeURIComponent(plural)}`;
  return name ? `${base}/${encodeURIComponent(name)}` : base;
}

export function useCRDInstances(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  scope: string,
  namespace?: string
) {
  return useQuery({
    queryKey: ["crd-instances", contextName, group, version, plural, scope, namespace],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `${customResourceUrl(contextName, group, version, plural)}?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch custom resources");
      const data = await res.json();
      return (data.items || []) as Record<string, unknown>[];
    },
    enabled: !!contextName && !!group && !!version && !!plural,
  });
}

export function useCRDInstance(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  name: string,
  scope: string,
  namespace?: string
) {
  return useQuery({
    queryKey: ["crd-instance", contextName, group, version, plural, name, scope, namespace],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `${customResourceUrl(contextName, group, version, plural, name)}?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch custom resource");
      return res.json();
    },
    enabled: !!contextName && !!group && !!version && !!plural && !!name,
  });
}

export function useUpdateCRDInstance(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  scope: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, body, namespace }: { name: string; body: object; namespace?: string }) => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `${customResourceUrl(contextName, group, version, plural, name)}?${params.toString()}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update custom resource");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crd-instances", contextName, group, version, plural] });
    },
  });
}

export function useDeleteCRDInstance(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  scope: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, namespace }: { name: string; namespace?: string }) => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `${customResourceUrl(contextName, group, version, plural, name)}?${params.toString()}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete custom resource");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crd-instances", contextName, group, version, plural] });
    },
  });
}

export function useCreateCRDInstance(
  contextName: string,
  group: string,
  version: string,
  plural: string,
  scope: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, namespace }: { body: object; namespace?: string }) => {
      const params = new URLSearchParams();
      params.set("scope", scope);
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `${customResourceUrl(contextName, group, version, plural)}?${params.toString()}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create custom resource");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crd-instances", contextName, group, version, plural] });
    },
  });
}
