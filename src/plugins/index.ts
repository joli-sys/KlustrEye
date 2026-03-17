import type { PluginRegistration } from "@/lib/plugins/types";
import grafanaManifest from "./grafana/manifest";
import { GrafanaSettingsPanel } from "./grafana/settings-panel";
import { GrafanaPage } from "./grafana/page";
import { GrafanaPodExtension, GrafanaNodeExtension } from "./grafana/resource-extensions";
import opencostManifest from "./opencost/manifest";
import { OpenCostSettingsPanel } from "./opencost/settings-panel";
import { OpenCostPage } from "./opencost/page";
import { OpenCostPodExtension, OpenCostNodeExtension } from "./opencost/resource-extensions";

const grafana: PluginRegistration = {
  manifest: grafanaManifest,
  serverHandlers: () => Promise.resolve({ settings: { get: () => Promise.resolve(new Response()), put: () => Promise.resolve(new Response()) } }),
  SettingsPanel: GrafanaSettingsPanel,
  Page: GrafanaPage,
  PodExtension: GrafanaPodExtension,
  NodeExtension: GrafanaNodeExtension,
};

const opencost: PluginRegistration = {
  manifest: opencostManifest,
  serverHandlers: () => Promise.resolve({ settings: { get: () => Promise.resolve(new Response()), put: () => Promise.resolve(new Response()) } }),
  SettingsPanel: OpenCostSettingsPanel,
  Page: OpenCostPage,
  PodExtension: OpenCostPodExtension,
  NodeExtension: OpenCostNodeExtension,
};

export const plugins: PluginRegistration[] = [grafana, opencost];
