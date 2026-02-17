"use client";

import { Badge } from "@/components/ui/badge";
import { BarChart3 } from "lucide-react";
import { useGrafanaConfig } from "./hooks";
import { GrafanaSettingsPanel } from "./settings-panel";

export function GrafanaPage({ contextName }: { contextName: string }) {
  const { data: grafanaConfig } = useGrafanaConfig(contextName);
  const configured = !!grafanaConfig?.hasToken;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-accent">
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Grafana / Mimir</h1>
            <Badge variant={configured ? "success" : "outline"}>
              {configured ? "Connected" : "Not configured"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Historical metrics from Prometheus/Mimir via Grafana
          </p>
        </div>
      </div>

      <GrafanaSettingsPanel contextName={contextName} />
    </div>
  );
}
