"use client";

import { useEffect, useRef } from "react";
import { useNamespaces, useClusters } from "@/hooks/use-clusters";
import { useUIStore } from "@/lib/stores/ui-store";
import { Select } from "@/components/ui/select";

export function NamespaceSelector({ contextName }: { contextName: string }) {
  const { data: namespaces } = useNamespaces(contextName);
  const { data: clusters } = useClusters();
  const ns = useUIStore((s) => s.namespaceByCluster[contextName]);
  const setClusterNamespace = useUIStore((s) => s.setClusterNamespace);
  const hydrated = useRef(false);

  // Hydrate from DB if the store has no entry for this cluster
  useEffect(() => {
    if (ns || hydrated.current) return;
    hydrated.current = true;
    const cluster = clusters?.find((c) => c.name === contextName);
    const dbNs = cluster?.lastNamespace ?? "default";
    setClusterNamespace(contextName, dbNs);
  }, [ns, clusters, contextName, setClusterNamespace]);

  const selectedNamespace = ns ?? "default";

  const options = [
    { value: "__all__", label: "All Namespaces" },
    ...(namespaces || []).map((n) => ({
      value: n.name,
      label: n.name,
    })),
  ];

  const handleChange = (value: string) => {
    setClusterNamespace(contextName, value);
    // Fire-and-forget save to DB
    fetch(`/api/clusters/${encodeURIComponent(contextName)}/settings/namespace`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ namespace: value }),
    }).catch(() => {});
  };

  return (
    <Select
      value={selectedNamespace}
      onChange={(e) => handleChange(e.target.value)}
      options={options}
      className="w-32 md:w-48"
    />
  );
}
