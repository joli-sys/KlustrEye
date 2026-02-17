import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { stopPortForward } from "@/lib/k8s/port-forward";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string; id: string }> }
) {
  const { id } = await params;

  try {
    const session = await prisma.portForwardSession.findUnique({ where: { id } });
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to get session";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string; id: string }> }
) {
  const { id } = await params;

  try {
    await stopPortForward(id);
    return Response.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to stop port forward";
    return Response.json({ error: message }, { status: 500 });
  }
}
