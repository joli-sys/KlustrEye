import { NextRequest, NextResponse } from "next/server";
import { type ResourceKind, RESOURCE_REGISTRY } from "@/lib/constants";
import { listResources, createResource } from "@/lib/k8s/resources";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string }> }
) {
  const { contextName, kind } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    const items = await listResources(contextName, kind as ResourceKind, namespace);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list resources";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string }> }
) {
  const { contextName, kind } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    const body = await req.json();
    const result = await createResource(contextName, kind as ResourceKind, body, namespace);
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create resource";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
