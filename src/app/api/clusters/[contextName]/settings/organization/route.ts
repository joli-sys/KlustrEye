import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  try {
    const { contextName } = await params;
    const { organizationId } = await request.json();

    await prisma.clusterContext.upsert({
      where: { contextName },
      update: { organizationId: organizationId || null },
      create: { contextName, organizationId: organizationId || null },
    });

    return NextResponse.json({ organizationId: organizationId || null });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
