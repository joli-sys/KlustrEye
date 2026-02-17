import { NextRequest } from "next/server";
import { listActivePortForwards, startPortForward } from "@/lib/k8s/port-forward";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;

  try {
    const sessions = await listActivePortForwards(contextName);
    return Response.json({ sessions });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to list port forwards";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  const body = await req.json();
  const { namespace, resourceType, resourceName, localPort, remotePort } = body;

  if (!namespace || !resourceType || !resourceName || !localPort || !remotePort) {
    return Response.json(
      { error: "Missing required fields: namespace, resourceType, resourceName, localPort, remotePort" },
      { status: 400 }
    );
  }

  if (resourceType !== "pod" && resourceType !== "service") {
    return Response.json({ error: "resourceType must be 'pod' or 'service'" }, { status: 400 });
  }

  try {
    const session = await startPortForward({
      contextName,
      namespace,
      resourceType,
      resourceName,
      localPort: Number(localPort),
      remotePort: Number(remotePort),
    });
    return Response.json({ session }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to start port forward";
    return Response.json({ error: message }, { status: 500 });
  }
}
