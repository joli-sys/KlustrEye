"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConfigMapDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";
  const { data } = useResource(ctx, "configmaps", name, namespace);
  const cmData = (data?.data as Record<string, string>) || {};

  return (
    <ResourceDetail contextName={ctx} kind="configmaps" name={name} namespace={namespace}>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(cmData).map(([key, value]) => (
              <div key={key}>
                <div className="text-sm font-medium mb-1">{key}</div>
                <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto max-h-48">
                  {value}
                </pre>
              </div>
            ))}
            {Object.keys(cmData).length === 0 && (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </CardContent>
      </Card>
    </ResourceDetail>
  );
}
