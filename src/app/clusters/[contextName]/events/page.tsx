"use client";

import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import { useUIStore } from "@/lib/stores/ui-store";
import { ResourceTable, nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Badge } from "@/components/ui/badge";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  {
    id: "type",
    header: "Type",
    accessorFn: (row) => row.type,
    cell: ({ getValue }) => {
      const type = getValue() as string;
      return (
        <Badge variant={type === "Normal" ? "secondary" : "warning"}>
          {type}
        </Badge>
      );
    },
  },
  {
    id: "reason",
    header: "Reason",
    accessorFn: (row) => row.reason,
    cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span>,
  },
  {
    id: "object",
    header: "Object",
    accessorFn: (row) => {
      const obj = row.involvedObject as Record<string, unknown>;
      return obj ? `${obj.kind}/${obj.name}` : "-";
    },
  },
  {
    id: "message",
    header: "Message",
    accessorFn: (row) => row.message,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground truncate max-w-md block">
        {getValue() as string}
      </span>
    ),
  },
  namespaceColumn(),
  {
    id: "count",
    header: "Count",
    accessorFn: (row) => row.count || 1,
  },
  {
    id: "lastSeen",
    header: "Last Seen",
    accessorFn: (row) => row.lastTimestamp || (row.metadata as Record<string, unknown>)?.creationTimestamp,
    cell: ({ getValue }) => {
      const date = getValue() as string;
      if (!date) return "-";
      const d = new Date(date);
      const now = new Date();
      const seconds = Math.floor((now.getTime() - d.getTime()) / 1000);
      if (seconds < 60) return `${seconds}s ago`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return `${minutes}m ago`;
      const hours = Math.floor(minutes / 60);
      return `${hours}h ago`;
    },
  },
];

export default function EventsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { selectedNamespace } = useUIStore();
  const ns = selectedNamespace === "__all__" ? undefined : selectedNamespace;

  const { data, isLoading } = useQuery({
    queryKey: ["events", ctx, ns],
    queryFn: async () => {
      const params = ns ? `?namespace=${encodeURIComponent(ns)}` : "";
      const res = await fetch(`/api/clusters/${encodeURIComponent(ctx)}/events${params}`);
      if (!res.ok) throw new Error("Failed to fetch events");
      const json = await res.json();
      return json.items || [];
    },
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Events</h1>
      <ResourceTable
        data={data || []}
        isLoading={isLoading}
        columns={columns}
        kind="Events"
      />
    </div>
  );
}
