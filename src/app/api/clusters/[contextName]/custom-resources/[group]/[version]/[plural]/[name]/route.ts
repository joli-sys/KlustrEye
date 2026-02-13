import { NextRequest } from "next/server";
import { getCustomObjectsApi } from "@/lib/k8s/client";

type Params = Promise<{
  contextName: string;
  group: string;
  version: string;
  plural: string;
  name: string;
}>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { contextName, group, version, plural, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const scope = req.nextUrl.searchParams.get("scope") || "Namespaced";

  try {
    const api = getCustomObjectsApi(contextName);
    let result: object;

    if (scope === "Cluster") {
      result = await api.getClusterCustomObject({ group, version, plural, name });
    } else {
      result = await api.getNamespacedCustomObject({
        group,
        version,
        namespace: namespace || "default",
        plural,
        name,
      });
    }

    return Response.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get custom resource";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Params }) {
  const { contextName, group, version, plural, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const scope = req.nextUrl.searchParams.get("scope") || "Namespaced";

  try {
    const api = getCustomObjectsApi(contextName);
    const body = await req.json();

    let result: object;
    if (scope === "Cluster") {
      result = await api.replaceClusterCustomObject({ group, version, plural, name, body });
    } else {
      result = await api.replaceNamespacedCustomObject({
        group,
        version,
        namespace: namespace || "default",
        plural,
        name,
        body,
      });
    }

    return Response.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update custom resource";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Params }) {
  const { contextName, group, version, plural, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const scope = req.nextUrl.searchParams.get("scope") || "Namespaced";

  try {
    const api = getCustomObjectsApi(contextName);

    if (scope === "Cluster") {
      await api.deleteClusterCustomObject({ group, version, plural, name });
    } else {
      await api.deleteNamespacedCustomObject({
        group,
        version,
        namespace: namespace || "default",
        plural,
        name,
      });
    }

    return Response.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete custom resource";
    return Response.json({ error: message }, { status: 500 });
  }
}
