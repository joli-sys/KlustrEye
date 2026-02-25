import { NextRequest, NextResponse } from "next/server";
import { getRelease, getReleaseHistory, uninstallRelease, rollbackRelease, upgradeRelease, templateRelease } from "@/lib/k8s/helm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || "default";
  const view = req.nextUrl.searchParams.get("view");

  try {
    if (view === "history") {
      const history = await getReleaseHistory(contextName, name, namespace);
      return NextResponse.json(history);
    }

    const release = await getRelease(contextName, name, namespace);
    return NextResponse.json(release);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get release";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const body = await req.json();
  const { namespace, revision, action, chart, valuesYaml, version } = body;

  try {
    if (action === "dry-run") {
      const manifest = await templateRelease(contextName, name, namespace, valuesYaml);
      return NextResponse.json({ ok: true, manifest });
    }

    if (action === "upgrade") {
      const result = await upgradeRelease(contextName, name, chart, namespace, valuesYaml, version);
      return NextResponse.json({ ok: true, output: result });
    }

    if (revision) {
      const result = await rollbackRelease(contextName, name, namespace, revision);
      return NextResponse.json({ ok: true, output: result });
    }

    return NextResponse.json({ error: "Specify action or revision" }, { status: 400 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update release";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || "default";

  try {
    const result = await uninstallRelease(contextName, name, namespace);
    return NextResponse.json({ ok: true, output: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to uninstall release";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
