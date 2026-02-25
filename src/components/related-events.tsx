"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { formatAge } from "@/lib/utils";
import { RESOURCE_REGISTRY, type ResourceKind } from "@/lib/constants";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type SortKey = "type" | "reason" | "count" | "lastSeen";
type SortDir = "asc" | "desc";

function getLastTimestamp(event: Record<string, unknown>): string {
  return (
    (event.lastTimestamp as string) ||
    ((event.metadata as Record<string, unknown>)?.creationTimestamp as string) ||
    ""
  );
}

interface RelatedEventsProps {
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
}

export function RelatedEvents({ contextName, kind, name, namespace }: RelatedEventsProps) {
  const entry = RESOURCE_REGISTRY[kind];
  const k8sKind = entry.kind;
  const [sortKey, setSortKey] = useState<SortKey>("lastSeen");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

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

  const sorted = useMemo(() => {
    if (!data) return [];
    const items = [...data];
    const dir = sortDir === "asc" ? 1 : -1;
    items.sort((a, b) => {
      switch (sortKey) {
        case "type":
          return dir * ((a.type as string) || "").localeCompare((b.type as string) || "");
        case "reason":
          return dir * ((a.reason as string) || "").localeCompare((b.reason as string) || "");
        case "count":
          return dir * (((a.count as number) || 1) - ((b.count as number) || 1));
        case "lastSeen": {
          const ta = new Date(getLastTimestamp(a)).getTime() || 0;
          const tb = new Date(getLastTimestamp(b)).getTime() || 0;
          return dir * (ta - tb);
        }
        default:
          return 0;
      }
    });
    return items;
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "lastSeen" ? "desc" : "asc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="h-3 w-3 ml-1" />
      : <ArrowDown className="h-3 w-3 ml-1" />;
  }

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
            <th className="text-left p-2 font-medium cursor-pointer select-none" onClick={() => toggleSort("type")}>
              <span className="inline-flex items-center">Type<SortIcon column="type" /></span>
            </th>
            <th className="text-left p-2 font-medium cursor-pointer select-none" onClick={() => toggleSort("reason")}>
              <span className="inline-flex items-center">Reason<SortIcon column="reason" /></span>
            </th>
            <th className="text-left p-2 font-medium">Message</th>
            <th className="text-left p-2 font-medium cursor-pointer select-none" onClick={() => toggleSort("count")}>
              <span className="inline-flex items-center">Count<SortIcon column="count" /></span>
            </th>
            <th className="text-left p-2 font-medium cursor-pointer select-none" onClick={() => toggleSort("lastSeen")}>
              <span className="inline-flex items-center">Last Seen<SortIcon column="lastSeen" /></span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((event, i) => {
            const type = event.type as string;
            const lastTimestamp = getLastTimestamp(event);
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
