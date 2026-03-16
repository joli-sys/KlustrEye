;
import { useSearchParams, useParams } from "react-router-dom";
import { ResourceDetail } from "@/components/resource-detail";

export default function ServiceAccountDetailPage() {
  const { contextName = "", name = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const [searchParams] = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  return <ResourceDetail contextName={ctx} kind="serviceaccounts" name={name} namespace={namespace} />;
}
