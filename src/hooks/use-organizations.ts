"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Organization {
  id: string;
  name: string;
  sortOrder: number;
  _count: { clusters: number };
}

export function useOrganizations() {
  return useQuery<Organization[]>({
    queryKey: ["organizations"],
    queryFn: async () => {
      const res = await fetch("/api/organizations");
      if (!res.ok) throw new Error("Failed to fetch organizations");
      return res.json();
    },
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("Failed to create organization");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
    },
  });
}

export function useDeleteOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orgId: string) => {
      const res = await fetch(`/api/organizations/${orgId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete organization");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
    },
  });
}

export function useAssignClusterOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contextName,
      organizationId,
    }: {
      contextName: string;
      organizationId: string | null;
    }) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/settings/organization`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ organizationId }),
        }
      );
      if (!res.ok) throw new Error("Failed to assign organization");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
      queryClient.invalidateQueries({ queryKey: ["organizations"] });
    },
  });
}
