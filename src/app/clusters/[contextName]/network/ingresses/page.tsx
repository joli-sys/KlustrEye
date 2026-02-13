"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "class",
    header: "Class",
    accessorFn: (row) => (row.spec as Record<string, unknown>)?.ingressClassName || "-",
  },
  {
    id: "hosts",
    header: "Hosts",
    accessorFn: (row) => {
      const rules = (row.spec as Record<string, unknown>)?.rules as Record<string, unknown>[];
      if (!rules) return "-";
      return rules.map((r) => r.host || "*").join(", ");
    },
  },
  {
    id: "address",
    header: "Address",
    accessorFn: (row) => {
      const lbIngress = ((row.status as Record<string, unknown>)?.loadBalancer as Record<string, unknown>)?.ingress as Record<string, unknown>[];
      if (!lbIngress?.length) return "-";
      return lbIngress.map((i) => i.ip || i.hostname).join(", ");
    },
  },
  ageColumn(),
];

export default function IngressesPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="ingresses"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="ingresses"
      />
    </>
  );
}
