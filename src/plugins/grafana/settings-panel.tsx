"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useGrafanaConfig, useSaveGrafanaConfig, useTestGrafanaConnection } from "./hooks";
import { Loader2, CircleCheck, CircleX } from "lucide-react";

export function GrafanaSettingsPanel({ contextName }: { contextName: string }) {
  const { addToast } = useToast();
  const { data: grafanaConfig } = useGrafanaConfig(contextName);
  const saveGrafana = useSaveGrafanaConfig(contextName);
  const testGrafana = useTestGrafanaConnection(contextName);
  const [grafanaUrl, setGrafanaUrl] = useState("");
  const [grafanaToken, setGrafanaToken] = useState("");
  const [grafanaDatasourceId, setGrafanaDatasourceId] = useState("");

  useEffect(() => {
    if (grafanaConfig) {
      setGrafanaUrl(grafanaConfig.url || "");
      setGrafanaDatasourceId(grafanaConfig.datasourceId || "");
    }
  }, [grafanaConfig]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Grafana / Mimir</CardTitle>
        <CardDescription>Connect to Grafana for historical metrics from Mimir or Prometheus</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label className="text-sm font-medium mb-1 block">Grafana URL</label>
          <Input
            type="url"
            placeholder="https://grafana.example.com"
            value={grafanaUrl}
            onChange={(e) => setGrafanaUrl(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Service Account Token</label>
          <Input
            type="password"
            placeholder="glsa_..."
            value={grafanaToken}
            onChange={(e) => setGrafanaToken(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            {grafanaConfig?.hasToken && !grafanaToken
              ? "Token is saved. Enter a new value to update it."
              : "Create a Service Account in Grafana (Administration \u2192 Service Accounts) and generate a token"}
          </p>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">Datasource ID or UID</label>
          <Input
            placeholder="aexxdf1o2wrk0f"
            value={grafanaDatasourceId}
            onChange={(e) => setGrafanaDatasourceId(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            The UID (or numeric ID) of the Mimir/Prometheus datasource — find it in Connections → Data sources → your datasource URL
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={testGrafana.isPending || !grafanaConfig?.hasToken}
            onClick={() => {
              testGrafana.mutate(undefined, {
                onSuccess: (data) => {
                  const m = data.metrics;
                  if (m && !m.containerCpu && !m.containerMemory && !m.nodeCpu && !m.nodeMemory) {
                    addToast({ title: "Connected, but no expected metrics found", description: "See metric probe results below", variant: "info" });
                  } else {
                    addToast({ title: "Connection successful", variant: "success" });
                  }
                },
                onError: (err) => addToast({ title: "Connection failed", description: err.message, variant: "destructive" }),
              });
            }}
          >
            {testGrafana.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </Button>
          <Button
            size="sm"
            disabled={saveGrafana.isPending || !grafanaUrl || !grafanaDatasourceId || (!grafanaToken && !grafanaConfig?.hasToken)}
            onClick={() => {
              const token = grafanaToken || undefined;
              if (!grafanaUrl || !grafanaDatasourceId) return;
              saveGrafana.mutate(
                { url: grafanaUrl, serviceAccountToken: token || "__keep__", datasourceId: grafanaDatasourceId },
                {
                  onSuccess: () => {
                    setGrafanaToken("");
                    addToast({ title: "Grafana settings saved", variant: "success" });
                  },
                  onError: (err) => addToast({ title: "Failed to save", description: err.message, variant: "destructive" }),
                }
              );
            }}
          >
            {saveGrafana.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>
        {testGrafana.data?.metrics && (
          <div className="rounded-md border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Metric probe results</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {([
                ["container_cpu_usage_seconds_total", testGrafana.data.metrics.containerCpu],
                ["container_memory_working_set_bytes", testGrafana.data.metrics.containerMemory],
                ["node_cpu_seconds_total", testGrafana.data.metrics.nodeCpu],
                ["node_memory_MemTotal_bytes", testGrafana.data.metrics.nodeMemory],
              ] as const).map(([name, found]) => (
                <div key={name} className="flex items-center gap-1.5">
                  {found ? (
                    <CircleCheck className="h-3.5 w-3.5 text-green-500 shrink-0" />
                  ) : (
                    <CircleX className="h-3.5 w-3.5 text-red-500 shrink-0" />
                  )}
                  <span className="font-mono truncate">{name}</span>
                </div>
              ))}
            </div>
            {!testGrafana.data.metrics.containerCpu && !testGrafana.data.metrics.containerMemory && (
              <p className="text-xs text-muted-foreground">
                Pod historical metrics require container_cpu_usage_seconds_total and container_memory_working_set_bytes (cAdvisor metrics).
                Verify these metrics exist in Grafana Explore for this datasource.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
