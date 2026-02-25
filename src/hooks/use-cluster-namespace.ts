import { useUIStore } from "@/lib/stores/ui-store";

export function useClusterNamespace(contextName: string): string {
  return useUIStore((s) => s.namespaceByCluster[contextName] ?? "default");
}
