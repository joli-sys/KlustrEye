import { NextRequest, NextResponse } from "next/server";
import { getCoreApi, withTimeout } from "@/lib/k8s/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || "default";

  try {
    const api = getCoreApi(contextName);
    const result = await withTimeout(
      api.readNamespacedEndpoints({ name, namespace })
    );
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch endpoints";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
