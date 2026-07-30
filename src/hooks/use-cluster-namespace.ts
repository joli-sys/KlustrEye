import { useUIStore } from "@/lib/stores/ui-store";

export function useWorkspaceNamespace(wsId: string) {
  return useUIStore((s) => s.namespaceByWorkspace[wsId] ?? "default");
}
