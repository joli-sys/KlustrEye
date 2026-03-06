import { NextRequest, NextResponse } from "next/server";
import { getBatchApi } from "@/lib/k8s/client";
import * as k8s from "@kubernetes/client-node";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const ctx = decodeURIComponent(contextName);
  const { searchParams } = new URL(request.url);
  const namespace = searchParams.get("namespace") || "default";

  try {
    const batchApi = getBatchApi(ctx);

    // Get the CronJob
    const cronJob = await batchApi.readNamespacedCronJob({ name, namespace });

    // Create Job from CronJob template
    const timestamp = Math.floor(Date.now() / 1000);
    const jobName = `${name}-manual-${timestamp}`;

    const job: k8s.V1Job = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace,
        annotations: {
          "cronjob.kubernetes.io/instantiate": "manual",
        },
        ownerReferences: [
          {
            apiVersion: "batch/v1",
            kind: "CronJob",
            name: cronJob.metadata!.name!,
            uid: cronJob.metadata!.uid!,
            controller: true,
          },
        ],
      },
      spec: cronJob.spec!.jobTemplate.spec,
    };

    const created = await batchApi.createNamespacedJob({ namespace, body: job });
    return NextResponse.json({ success: true, jobName: created.metadata?.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger CronJob";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
