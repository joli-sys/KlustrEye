import { NextRequest } from "next/server";
import { getCustomObjectsApi } from "@/lib/k8s/client";

type Params = Promise<{
  contextName: string;
  group: string;
  version: string;
  plural: string;
}>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { contextName, group, version, plural } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const scope = req.nextUrl.searchParams.get("scope") || "Namespaced";

  try {
    const api = getCustomObjectsApi(contextName);
    let result: object;

    if (scope === "Cluster") {
      result = await api.listClusterCustomObject({ group, version, plural });
    } else if (namespace) {
      result = await api.listNamespacedCustomObject({ group, version, namespace, plural });
    } else {
      result = await api.listCustomObjectForAllNamespaces({ group, version, plural });
    }

    const items = (result as Record<string, unknown>).items || [];
    return Response.json({ items });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list custom resources";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Params }) {
  const { contextName, group, version, plural } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const scope = req.nextUrl.searchParams.get("scope") || "Namespaced";

  try {
    const api = getCustomObjectsApi(contextName);
    const body = await req.json();

    let result: object;
    if (scope === "Cluster") {
      result = await api.createClusterCustomObject({ group, version, plural, body });
    } else {
      const ns = namespace || (body.metadata?.namespace as string) || "default";
      result = await api.createNamespacedCustomObject({
        group,
        version,
        namespace: ns,
        plural,
        body,
      });
    }

    return Response.json(result, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create custom resource";
    return Response.json({ error: message }, { status: 500 });
  }
}
