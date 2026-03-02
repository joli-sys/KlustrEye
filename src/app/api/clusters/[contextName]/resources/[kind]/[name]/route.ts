import { NextRequest, NextResponse } from "next/server";
import { type ResourceKind, RESOURCE_REGISTRY } from "@/lib/constants";
import { getResource, updateResource, deleteResource, patchResource } from "@/lib/k8s/resources";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string; name: string }> }
) {
  const { contextName, kind, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    const result = await getResource(contextName, kind as ResourceKind, name, namespace);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get resource";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string; name: string }> }
) {
  const { contextName, kind, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    const body = await req.json();
    const result = await updateResource(contextName, kind as ResourceKind, name, body, namespace);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update resource";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string; name: string }> }
) {
  const { contextName, kind, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    const { patch } = await req.json();
    const result = await patchResource(contextName, kind as ResourceKind, name, patch, namespace);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to patch resource";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; kind: string; name: string }> }
) {
  const { contextName, kind, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;

  if (!RESOURCE_REGISTRY[kind as ResourceKind]) {
    return NextResponse.json({ error: `Unknown resource kind: ${kind}` }, { status: 400 });
  }

  try {
    await deleteResource(contextName, kind as ResourceKind, name, namespace);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete resource";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
