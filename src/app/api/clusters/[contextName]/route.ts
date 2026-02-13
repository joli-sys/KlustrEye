import { NextRequest, NextResponse } from "next/server";
import { testConnection, getKubeConfig } from "@/lib/k8s/client";
import { detectCloudProvider } from "@/lib/k8s/provider";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  try {
    const result = await testConnection(contextName);
    const kc = getKubeConfig(contextName);
    const cluster = kc.getCurrentCluster();
    const cloudProvider = detectCloudProvider(cluster?.server || "", result.version);

    // Persist detected provider so the home page can use it without connecting
    if (result.ok && cloudProvider !== "kubernetes") {
      const ctx = await prisma.clusterContext.upsert({
        where: { contextName },
        create: { contextName },
        update: {},
      });
      await prisma.clusterSetting.upsert({
        where: { clusterId_key: { clusterId: ctx.id, key: "cloudProvider" } },
        create: { clusterId: ctx.id, key: "cloudProvider", value: cloudProvider },
        update: { value: cloudProvider },
      });
    }

    return NextResponse.json({
      contextName,
      cloudProvider,
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Connection failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
