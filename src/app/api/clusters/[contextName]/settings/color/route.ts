import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COLOR_PRESETS } from "@/lib/color-presets";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  try {
    const { contextName } = await params;
    const { colorScheme } = await request.json();

    if (!colorScheme || !COLOR_PRESETS[colorScheme]) {
      return NextResponse.json(
        { error: "Invalid color scheme" },
        { status: 400 }
      );
    }

    const cluster = await prisma.clusterContext.upsert({
      where: { contextName },
      update: {},
      create: { contextName },
    });

    await prisma.clusterSetting.upsert({
      where: { clusterId_key: { clusterId: cluster.id, key: "colorScheme" } },
      update: { value: colorScheme },
      create: { clusterId: cluster.id, key: "colorScheme", value: colorScheme },
    });

    return NextResponse.json({ colorScheme });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update color scheme";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
