import { NextRequest } from "next/server";
import { getApiExtensionsApi } from "@/lib/k8s/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;

  try {
    const api = getApiExtensionsApi(contextName);
    const result = await api.listCustomResourceDefinition();
    return Response.json({ items: result.items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list CRDs";
    return Response.json({ error: message }, { status: 500 });
  }
}
