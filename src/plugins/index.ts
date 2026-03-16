import type { PluginRegistration } from "@/lib/plugins/types";
import grafanaManifest from "./grafana/manifest";
import { GrafanaSettingsPanel } from "./grafana/settings-panel";
import { GrafanaPage } from "./grafana/page";
import { GrafanaPodExtension, GrafanaNodeExtension } from "./grafana/resource-extensions";

const grafana: PluginRegistration = {
  manifest: grafanaManifest,
  serverHandlers: () => Promise.resolve({ settings: { get: () => Promise.resolve(new Response()), put: () => Promise.resolve(new Response()) } }),
  SettingsPanel: GrafanaSettingsPanel,
  Page: GrafanaPage,
  PodExtension: GrafanaPodExtension,
  NodeExtension: GrafanaNodeExtension,
};

export const plugins: PluginRegistration[] = [grafana];
