import { NextRequest, NextResponse } from "next/server";
import { getCoreApi, withTimeout } from "@/lib/k8s/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  try {
    const api = getCoreApi(contextName);
    const result = await withTimeout(api.listNamespace());
    const namespaces = result.items.map((ns) => ({
      name: ns.metadata?.name || "",
      status: ns.status?.phase || "Unknown",
    }));
    return NextResponse.json(namespaces);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list namespaces";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
