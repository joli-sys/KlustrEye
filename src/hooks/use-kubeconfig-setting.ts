"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export function useKubeconfigSetting() {
  return useQuery<{ path: string }>({
    queryKey: ["kubeconfig-setting"],
    queryFn: async () => {
      const res = await fetch("/api/settings/kubeconfig");
      if (!res.ok) throw new Error("Failed to fetch kubeconfig setting");
      return res.json();
    },
  });
}

export function useUpdateKubeconfigPath() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch("/api/settings/kubeconfig", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (!res.ok) throw new Error("Failed to update kubeconfig path");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kubeconfig-setting"] });
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
    },
  });
}
