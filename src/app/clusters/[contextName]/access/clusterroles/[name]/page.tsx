"use client";

import { use } from "react";
import { ResourceDetail } from "@/components/resource-detail";

export default function ClusterRoleDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);

  return <ResourceDetail contextName={ctx} kind="clusterroles" name={name} />;
}
