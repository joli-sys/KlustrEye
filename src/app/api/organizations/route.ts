import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const orgs = await prisma.organization.findMany({
      orderBy: { sortOrder: "asc" },
      include: { _count: { select: { clusters: true } } },
    });
    return NextResponse.json(orgs);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load organizations";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const org = await prisma.organization.create({
      data: { name: name.trim() },
    });
    return NextResponse.json(org, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create organization";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
