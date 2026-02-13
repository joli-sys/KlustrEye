"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { ResourceKind } from "@/lib/constants";

export interface SearchResult {
  kind: ResourceKind;
  kindLabel: string;
  name: string;
  namespace?: string;
  matchDetail?: string;
}

interface SearchResponse {
  results: SearchResult[];
  query: string;
  truncated: boolean;
}

export function useResourceSearch(
  contextName: string,
  query: string,
  namespace?: string
) {
  return useQuery<SearchResponse>({
    queryKey: ["resource-search", contextName, query, namespace],
    queryFn: async () => {
      const params = new URLSearchParams({ q: query });
      if (namespace) params.set("namespace", namespace);
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/search?${params}`
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: !!contextName && query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}
