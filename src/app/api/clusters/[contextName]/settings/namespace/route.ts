import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  try {
    const { contextName } = await params;
    const { namespace } = await request.json();

    if (typeof namespace !== "string") {
      return NextResponse.json(
        { error: "Invalid namespace" },
        { status: 400 }
      );
    }

    await prisma.clusterContext.upsert({
      where: { contextName },
      update: { lastNamespace: namespace },
      create: { contextName, lastNamespace: namespace },
    });

    return NextResponse.json({ namespace });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update namespace";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
