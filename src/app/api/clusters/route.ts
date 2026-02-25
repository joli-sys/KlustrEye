import { NextRequest, NextResponse } from "next/server";
import { getContexts } from "@/lib/k8s/client";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  try {
    const contexts = await getContexts();

    const stored = await prisma.clusterContext.findMany({
      select: {
        contextName: true,
        displayName: true,
        lastNamespace: true,
        organizationId: true,
        organization: { select: { id: true, name: true } },
        settings: {
          where: { key: { in: ["colorScheme", "cloudProvider"] } },
          select: { key: true, value: true },
        },
      },
    });
    const storedMap = new Map(stored.map((s) => [s.contextName, s]));

    const result = contexts.map((ctx) => {
      const s = storedMap.get(ctx.name);
      return {
        name: ctx.name,
        cluster: ctx.cluster,
        user: ctx.user,
        namespace: ctx.namespace || "default",
        isCurrent: ctx.isCurrent,
        provider: ctx.provider,
        cloudProvider: s?.settings.find((st) => st.key === "cloudProvider")?.value ?? ctx.cloudProvider,
        displayName: s?.displayName ?? null,
        colorScheme: s?.settings.find((st) => st.key === "colorScheme")?.value ?? null,
        organizationId: s?.organizationId ?? null,
        organizationName: s?.organization?.name ?? null,
        lastNamespace: s?.lastNamespace ?? "default",
      };
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load clusters";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
