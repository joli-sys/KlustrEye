import { plugins } from "@/plugins";
import type { PluginRegistration } from "./types";

const pluginMap = new Map<string, PluginRegistration>(
  plugins.map((p) => [p.manifest.id, p])
);

export function getPlugin(id: string): PluginRegistration | undefined {
  return pluginMap.get(id);
}

export function getPlugins(): PluginRegistration[] {
  return plugins;
}

export function getPluginsWithPages(): PluginRegistration[] {
  return plugins.filter((p) => p.manifest.hasPage);
}

export function getPluginsWithResourceExtension(
  kind: "pods" | "nodes"
): PluginRegistration[] {
  return plugins.filter((p) => p.manifest.resourceExtensions?.[kind]);
}
