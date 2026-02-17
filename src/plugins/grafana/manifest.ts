import type { PluginManifest } from "@/lib/plugins/types";

const manifest: PluginManifest = {
  id: "grafana",
  name: "Grafana / Mimir",
  description: "Historical metrics from Prometheus/Mimir via Grafana",
  icon: "BarChart3",
  settingsKeys: [
    "grafanaUrl",
    "grafanaServiceAccountToken",
    "grafanaDatasourceId",
  ],
  hasPage: true,
  resourceExtensions: { pods: true, nodes: true },
};

export default manifest;
