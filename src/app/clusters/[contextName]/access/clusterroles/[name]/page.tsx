;
import { ResourceDetail } from "@/components/resource-detail";
import { useParams } from "react-router-dom";

export default function ClusterRoleDetailPage() {
  const { contextName = "", name = "" } = useParams();
  const ctx = decodeURIComponent(contextName);

  return <ResourceDetail contextName={ctx} kind="clusterroles" name={name} />;
}
