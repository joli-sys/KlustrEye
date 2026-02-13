import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  try {
    const { contextName } = await params;
    const { displayName } = await request.json();

    const result = await prisma.clusterContext.upsert({
      where: { contextName },
      update: { displayName: displayName || null },
      create: { contextName, displayName: displayName || null },
    });

    return NextResponse.json({
      contextName: result.contextName,
      displayName: result.displayName,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Rename failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
