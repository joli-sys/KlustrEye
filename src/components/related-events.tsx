"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { formatAge } from "@/lib/utils";
import { RESOURCE_REGISTRY, type ResourceKind } from "@/lib/constants";

interface RelatedEventsProps {
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
}

export function RelatedEvents({ contextName, kind, name, namespace }: RelatedEventsProps) {
  const entry = RESOURCE_REGISTRY[kind];
  const k8sKind = entry.kind;

  const { data, isLoading } = useQuery({
    queryKey: ["related-events", contextName, kind, name, namespace],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (namespace) params.set("namespace", namespace);
      params.set("involvedObject.kind", k8sKind);
      params.set("involvedObject.name", name);
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/events?${params.toString()}`
      );
      if (!res.ok) throw new Error("Failed to fetch events");
      const json = await res.json();
      return (json.items || []) as Record<string, unknown>[];
    },
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div className="text-sm text-muted-foreground py-8 text-center">Loading events...</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        No events found for this resource.
      </div>
    );
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="text-left p-2 font-medium">Type</th>
            <th className="text-left p-2 font-medium">Reason</th>
            <th className="text-left p-2 font-medium">Message</th>
            <th className="text-left p-2 font-medium">Count</th>
            <th className="text-left p-2 font-medium">Last Seen</th>
          </tr>
        </thead>
        <tbody>
          {data.map((event, i) => {
            const type = event.type as string;
            const lastTimestamp =
              (event.lastTimestamp as string) ||
              (event.metadata as Record<string, unknown>)?.creationTimestamp as string;
            return (
              <tr key={i} className="border-b last:border-0">
                <td className="p-2">
                  <Badge variant={type === "Normal" ? "secondary" : "warning"}>
                    {type}
                  </Badge>
                </td>
                <td className="p-2 font-medium">{event.reason as string}</td>
                <td className="p-2 text-muted-foreground max-w-md">
                  <ExpandableMessage message={event.message as string} />
                </td>
                <td className="p-2">{(event.count as number) || 1}</td>
                <td className="p-2 text-muted-foreground">
                  {lastTimestamp ? formatAge(lastTimestamp) + " ago" : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExpandableMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!message) return <span>-</span>;

  return (
    <button
      type="button"
      onClick={() => setExpanded((prev) => !prev)}
      className={`text-left ${expanded ? "whitespace-pre-wrap break-all" : "truncate block max-w-md"}`}
    >
      {message}
    </button>
  );
}
