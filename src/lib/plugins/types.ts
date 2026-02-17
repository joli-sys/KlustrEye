import { NextRequest, NextResponse } from "next/server";
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
    get: (
      contextName: string
    ) => Promise<NextResponse>;
    put: (
      contextName: string,
      request: NextRequest
    ) => Promise<NextResponse>;
    test?: (
      contextName: string
    ) => Promise<NextResponse>;
  };
  api?: (
    contextName: string,
    path: string[],
    request: NextRequest
  ) => Promise<NextResponse>;
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
