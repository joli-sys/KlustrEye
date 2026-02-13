import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setKubeconfigPath, clearCache } from "@/lib/k8s/client";

export async function GET() {
  const pref = await prisma.userPreference.findUnique({
    where: { key: "kubeconfigPath" },
  });
  return NextResponse.json({ path: pref?.value ?? "" });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const kubeconfigPath: string = body.path ?? "";

  if (kubeconfigPath) {
    await prisma.userPreference.upsert({
      where: { key: "kubeconfigPath" },
      update: { value: kubeconfigPath },
      create: { key: "kubeconfigPath", value: kubeconfigPath },
    });
  } else {
    await prisma.userPreference.deleteMany({
      where: { key: "kubeconfigPath" },
    });
  }

  setKubeconfigPath(kubeconfigPath || null);
  clearCache();

  // Set env so Helm CLI picks it up
  if (kubeconfigPath) {
    process.env.KUBECONFIG = kubeconfigPath;
  } else {
    delete process.env.KUBECONFIG;
  }

  return NextResponse.json({ ok: true });
}
