import { NextRequest, NextResponse } from "next/server";
import { listReleases, installChart } from "@/lib/k8s/helm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  try {
    const releases = await listReleases(contextName, namespace);
    return NextResponse.json(releases);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list Helm releases";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;

  try {
    const body = await req.json();
    const { releaseName, chart, namespace, values, version } = body;

    if (!releaseName || !chart || !namespace) {
      return NextResponse.json(
        { error: "releaseName, chart, and namespace are required" },
        { status: 400 }
      );
    }

    const result = await installChart(contextName, releaseName, chart, namespace, values, version);
    return NextResponse.json({ ok: true, output: result }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to install chart";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
