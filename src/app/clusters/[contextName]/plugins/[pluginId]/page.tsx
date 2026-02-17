"use client";

import { use } from "react";
import { getPlugin } from "@/lib/plugins/registry";

export default function PluginPage({
  params,
}: {
  params: Promise<{ contextName: string; pluginId: string }>;
}) {
  const { contextName, pluginId } = use(params);
  const ctx = decodeURIComponent(contextName);
  const plugin = getPlugin(pluginId);

  if (!plugin || !plugin.Page) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Plugin not found: {pluginId}
      </div>
    );
  }

  const PageComponent = plugin.Page;
  return <PageComponent contextName={ctx} />;
}
