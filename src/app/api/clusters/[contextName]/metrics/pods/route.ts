import { NextRequest, NextResponse } from "next/server";
import { getMetricsClient, withTimeout } from "@/lib/k8s/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  try {
    const metrics = getMetricsClient(contextName);
    const result = namespace
      ? await withTimeout(metrics.getPodMetrics(namespace))
      : await withTimeout(metrics.getPodMetrics());
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get pod metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
