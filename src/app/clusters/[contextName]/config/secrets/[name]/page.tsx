"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";

export default function SecretDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";
  const { data } = useResource(ctx, "secrets", name, namespace);
  const secretData = (data?.data as Record<string, string>) || {};
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const toggleReveal = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <ResourceDetail contextName={ctx} kind="secrets" name={name} namespace={namespace}>
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Data</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Object.entries(secretData).map(([key, value]) => (
              <div key={key} className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <div className="text-sm font-medium mb-1">{key}</div>
                  <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto">
                    {revealed.has(key) ? atob(value) : "••••••••"}
                  </pre>
                </div>
                <Button variant="ghost" size="icon" onClick={() => toggleReveal(key)}>
                  {revealed.has(key) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            ))}
            {Object.keys(secretData).length === 0 && (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </CardContent>
      </Card>
    </ResourceDetail>
  );
}
