"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatAge } from "@/lib/utils";

function useVPA(contextName: string, name: string, namespace: string) {
  return useQuery<Record<string, unknown>>({
    queryKey: ["vpa", contextName, name, namespace],
    queryFn: async () => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/custom-resources/autoscaling.k8s.io/v1/verticalpodautoscalers/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`
      );
      if (!res.ok) throw new Error("Failed to fetch VPA");
      return res.json();
    },
    enabled: !!contextName && !!name,
  });
}

export default function VPADetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";
  const router = useRouter();

  const { data, isLoading } = useVPA(ctx, name, namespace);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (!data) {
    return <div className="text-muted-foreground">VPA not found</div>;
  }

  const metadata = (data.metadata as Record<string, unknown>) || {};
  const spec = (data.spec as Record<string, unknown>) || {};
  const status = (data.status as Record<string, unknown>) || {};
  const targetRef = (spec.targetRef as Record<string, unknown>) || {};
  const updatePolicy = (spec.updatePolicy as Record<string, unknown>) || {};
  const resourcePolicy = (spec.resourcePolicy as Record<string, unknown>) || {};
  const containerPolicies = (resourcePolicy.containerPolicies as Record<string, unknown>[]) || [];
  const recommendation = (status.recommendation as Record<string, unknown>) || {};
  const containerRecs = (recommendation.containerRecommendations as Record<string, unknown>[]) || [];
  const conditions = (status.conditions as Record<string, unknown>[]) || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">{name}</h1>
          <p className="text-sm text-muted-foreground">
            VerticalPodAutoscaler in {namespace}
            {typeof metadata.creationTimestamp === "string" && (
              <span> &middot; Created {formatAge(metadata.creationTimestamp)}</span>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Target</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Kind</span>
              <span>{targetRef.kind as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-mono text-xs">{targetRef.name as string || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Update Mode</span>
              <Badge variant="secondary">{(updatePolicy.updateMode as string) ?? "Auto"}</Badge>
            </div>
          </CardContent>
        </Card>

        {containerPolicies.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resource Policy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {containerPolicies.map((cp, i) => {
                  const containerName = (cp.containerName as string) || "*";
                  const minAllowed = cp.minAllowed as Record<string, string> | undefined;
                  const maxAllowed = cp.maxAllowed as Record<string, string> | undefined;
                  const controlledResources = cp.controlledResources as string[] | undefined;
                  const mode = cp.mode as string | undefined;

                  return (
                    <div key={i} className="p-2 rounded border space-y-1 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{containerName}</span>
                        {mode && <Badge variant="outline" className="text-xs">{mode}</Badge>}
                      </div>
                      {controlledResources && (
                        <div className="text-xs text-muted-foreground">
                          Controls: {controlledResources.join(", ")}
                        </div>
                      )}
                      {minAllowed && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">Min: </span>
                          <span className="font-mono">
                            {Object.entries(minAllowed).map(([k, v]) => `${k}=${v}`).join(", ")}
                          </span>
                        </div>
                      )}
                      {maxAllowed && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">Max: </span>
                          <span className="font-mono">
                            {Object.entries(maxAllowed).map(([k, v]) => `${k}=${v}`).join(", ")}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {containerRecs.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Recommendations</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-left">
                      <th className="pb-2 font-medium">Container</th>
                      <th className="pb-2 font-medium">Lower Bound</th>
                      <th className="pb-2 font-medium">Target</th>
                      <th className="pb-2 font-medium">Upper Bound</th>
                      <th className="pb-2 font-medium">Uncapped Target</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containerRecs.map((cr, i) => {
                      const cName = cr.containerName as string;
                      const lower = cr.lowerBound as Record<string, string> | undefined;
                      const target = cr.target as Record<string, string> | undefined;
                      const upper = cr.upperBound as Record<string, string> | undefined;
                      const uncapped = cr.uncappedTarget as Record<string, string> | undefined;

                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 font-medium">{cName}</td>
                          <td className="py-2 font-mono text-xs">
                            {lower ? Object.entries(lower).map(([k, v]) => `${k}: ${v}`).join(", ") : "-"}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {target ? Object.entries(target).map(([k, v]) => `${k}: ${v}`).join(", ") : "-"}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {upper ? Object.entries(upper).map(([k, v]) => `${k}: ${v}`).join(", ") : "-"}
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {uncapped ? Object.entries(uncapped).map(([k, v]) => `${k}: ${v}`).join(", ") : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {conditions.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {conditions.map((cond, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span>{cond.type as string}</span>
                      {typeof cond.message === "string" && (
                        <span className="text-xs text-muted-foreground truncate max-w-[400px]">
                          {cond.message}
                        </span>
                      )}
                    </div>
                    <Badge variant={cond.status === "True" ? "success" : "secondary"}>
                      {cond.status as string}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
