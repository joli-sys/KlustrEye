;
import { ResourceListPage } from "@/components/resource-list-page";
import { useParams } from "react-router-dom";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "rules",
    header: "Rules",
    accessorFn: (row) => ((row.rules as unknown[]) || []).length,
  },
  ageColumn(),
];

export default function RolesPage() {
  const { contextName = "" } = useParams();
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="roles" columns={columns} />;
}
