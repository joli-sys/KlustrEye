;
import { ResourceDetail } from "@/components/resource-detail";
import { useParams } from "react-router-dom";

export default function ClusterRoleBindingDetailPage() {
  const { contextName = "", name = "" } = useParams();
  const ctx = decodeURIComponent(contextName);

  return <ResourceDetail contextName={ctx} kind="clusterrolebindings" name={name} />;
}
