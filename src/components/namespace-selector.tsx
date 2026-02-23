"use client";

import { useNamespaces } from "@/hooks/use-clusters";
import { useUIStore } from "@/lib/stores/ui-store";
import { Select } from "@/components/ui/select";

export function NamespaceSelector({ contextName }: { contextName: string }) {
  const { data: namespaces } = useNamespaces(contextName);
  const { selectedNamespace, setSelectedNamespace } = useUIStore();

  const options = [
    { value: "__all__", label: "All Namespaces" },
    ...(namespaces || []).map((ns) => ({
      value: ns.name,
      label: ns.name,
    })),
  ];

  return (
    <Select
      value={selectedNamespace}
      onChange={(e) => setSelectedNamespace(e.target.value)}
      options={options}
      className="w-32 md:w-48"
    />
  );
}
