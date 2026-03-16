;
import { ResourceListPage } from "@/components/resource-list-page";
import { useParams } from "react-router-dom";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import type { ColumnDef } from "@tanstack/react-table";

const columns: ColumnDef<Record<string, unknown>>[] = [
  nameColumn(),
  namespaceColumn(),
  {
    id: "roleRef",
    header: "Role Ref",
    accessorFn: (row) => {
      const ref = row.roleRef as { kind?: string; name?: string } | undefined;
      return ref ? `${ref.kind}/${ref.name}` : "-";
    },
  },
  {
    id: "subjects",
    header: "Subjects",
    accessorFn: (row) => ((row.subjects as unknown[]) || []).length,
  },
  ageColumn(),
];

export default function RoleBindingsPage() {
  const { contextName = "" } = useParams();
  return <ResourceListPage contextName={decodeURIComponent(contextName)} kind="rolebindings" columns={columns} />;
}
