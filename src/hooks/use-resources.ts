"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ResourceKind } from "@/lib/constants";

function resourceUrl(contextName: string, kind: string, name?: string, namespace?: string) {
  const base = `/api/clusters/${encodeURIComponent(contextName)}/resources/${kind}`;
  const url = name ? `${base}/${encodeURIComponent(name)}` : base;
  if (namespace) return `${url}?namespace=${encodeURIComponent(namespace)}`;
  return url;
}

export function useResources(contextName: string, kind: ResourceKind, namespace?: string) {
  return useQuery({
    queryKey: ["resources", contextName, kind, namespace],
    queryFn: async () => {
      const res = await fetch(resourceUrl(contextName, kind, undefined, namespace));
      if (!res.ok) throw new Error(`Failed to fetch ${kind}`);
      const data = await res.json();
      return data.items || [];
    },
    enabled: !!contextName,
  });
}

export function useResource(contextName: string, kind: ResourceKind, name: string, namespace?: string) {
  return useQuery({
    queryKey: ["resource", contextName, kind, name, namespace],
    queryFn: async () => {
      const res = await fetch(resourceUrl(contextName, kind, name, namespace));
      if (!res.ok) throw new Error(`Failed to fetch ${kind}/${name}`);
      return res.json();
    },
    enabled: !!contextName && !!name,
  });
}

export function useCreateResource(contextName: string, kind: ResourceKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, namespace }: { body: object; namespace?: string }) => {
      const res = await fetch(resourceUrl(contextName, kind, undefined, namespace), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to create ${kind}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", contextName, kind] });
    },
  });
}

export function useUpdateResource(contextName: string, kind: ResourceKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, body, namespace }: { name: string; body: object; namespace?: string }) => {
      const res = await fetch(resourceUrl(contextName, kind, name, namespace), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to update ${kind}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", contextName, kind] });
    },
  });
}

export function useDeleteResource(contextName: string, kind: ResourceKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, namespace }: { name: string; namespace?: string }) => {
      const res = await fetch(resourceUrl(contextName, kind, name, namespace), {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to delete ${kind}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", contextName, kind] });
    },
  });
}
