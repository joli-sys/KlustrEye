import { NextRequest, NextResponse } from "next/server";
import { getPlugin } from "@/lib/plugins/registry";

type Params = Promise<{
  contextName: string;
  pluginId: string;
  path: string[];
}>;

async function resolveHandler(pluginId: string) {
  const plugin = getPlugin(pluginId);
  if (!plugin) return null;
  return plugin.serverHandlers();
}

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const { contextName, pluginId, path } = await params;
  const ctx = decodeURIComponent(contextName);
  const handlers = await resolveHandler(pluginId);

  if (!handlers) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  if (path[0] === "settings") {
    return handlers.settings.get(ctx);
  }

  if (handlers.api) {
    return handlers.api(ctx, path, request);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(request: NextRequest, { params }: { params: Params }) {
  const { contextName, pluginId, path } = await params;
  const ctx = decodeURIComponent(contextName);
  const handlers = await resolveHandler(pluginId);

  if (!handlers) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  if (path[0] === "settings") {
    return handlers.settings.put(ctx, request);
  }

  if (handlers.api) {
    return handlers.api(ctx, path, request);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(request: NextRequest, { params }: { params: Params }) {
  const { contextName, pluginId, path } = await params;
  const ctx = decodeURIComponent(contextName);
  const handlers = await resolveHandler(pluginId);

  if (!handlers) {
    return NextResponse.json({ error: "Plugin not found" }, { status: 404 });
  }

  // POST to settings = test connection
  if (path[0] === "settings" && handlers.settings.test) {
    return handlers.settings.test(ctx);
  }

  if (handlers.api) {
    return handlers.api(ctx, path, request);
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
