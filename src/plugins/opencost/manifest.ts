import type { PluginManifest } from "@/lib/plugins/types";

const manifest: PluginManifest = {
  id: "opencost",
  name: "OpenCost",
  description: "Kubernetes cost monitoring — via OpenCost API, Prometheus, or Mimir",
  icon: "CircleDollarSign",
  settingsKeys: [
    "opencost.url",
    "opencost.token",
    "opencost.metricsSource",
    "opencost.prometheusUrl",
    "opencost.prometheusToken",
  ],
  hasPage: true,
  resourceExtensions: { pods: true, nodes: true },
};

export default manifest;
