
import type { ComponentType } from "react";

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name
  settingsKeys: string[];
  hasPage?: boolean;
  resourceExtensions?: {
    pods?: boolean;
    nodes?: boolean;
  };
}

export interface PluginServerHandlers {
  settings: {
    get: (contextName: string) => Promise<Response>;
    put: (contextName: string, request: Request) => Promise<Response>;
    test?: (contextName: string) => Promise<Response>;
  };
  api?: (contextName: string, path: string[], request: Request) => Promise<Response>;
}

export interface PluginResourceExtensionProps {
  contextName: string;
  name: string;
  namespace?: string;
}

export type PluginSettingsPanel = ComponentType<{ contextName: string }>;

export type PluginResourceExtension = ComponentType<PluginResourceExtensionProps>;

export type PluginPage = ComponentType<{ contextName: string }>;

export interface PluginRegistration {
  manifest: PluginManifest;
  serverHandlers: () => Promise<PluginServerHandlers>;
  SettingsPanel?: PluginSettingsPanel;
  Page?: PluginPage;
  PodExtension?: PluginResourceExtension;
  NodeExtension?: PluginResourceExtension;
}
