import { NextRequest, NextResponse } from "next/server";
import { getMetricsClient, withTimeout } from "@/lib/k8s/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  try {
    const metrics = getMetricsClient(contextName);
    const result = await withTimeout(metrics.getNodeMetrics());
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get node metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
