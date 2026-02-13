import { NextRequest, NextResponse } from "next/server";
import { listResources } from "@/lib/k8s/resources";
import { type ResourceKind, RESOURCE_REGISTRY } from "@/lib/constants";

const SEARCHABLE_KINDS: ResourceKind[] = [
  "pods",
  "deployments",
  "statefulsets",
  "daemonsets",
  "services",
  "ingresses",
  "configmaps",
  "secrets",
];

const MAX_PER_KIND = 5;
const MAX_TOTAL = 30;

interface SearchResult {
  kind: ResourceKind;
  kindLabel: string;
  name: string;
  namespace?: string;
  matchDetail?: string;
}

function matchesQuery(
  resource: Record<string, unknown>,
  query: string
): { matches: boolean; detail?: string } {
  const metadata = resource.metadata as Record<string, unknown> | undefined;
  if (!metadata) return { matches: false };

  const name = (metadata.name as string) || "";
  if (name.toLowerCase().includes(query)) {
    return { matches: true };
  }

  const labels = metadata.labels as Record<string, string> | undefined;
  if (labels) {
    for (const [k, v] of Object.entries(labels)) {
      if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) {
        return { matches: true, detail: `label: ${k}=${v}` };
      }
    }
  }

  const annotations = metadata.annotations as Record<string, string> | undefined;
  if (annotations) {
    for (const [k, v] of Object.entries(annotations)) {
      if (k.toLowerCase().includes(query) || String(v).toLowerCase().includes(query)) {
        return { matches: true, detail: `annotation: ${k}` };
      }
    }
  }

  return { matches: false };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  const ctx = decodeURIComponent(contextName);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().toLowerCase();
  const namespace = url.searchParams.get("namespace") || undefined;

  if (query.length < 2) {
    return NextResponse.json({ results: [], query, truncated: false });
  }

  const promises = SEARCHABLE_KINDS.map(async (kind) => {
    try {
      const items = await listResources(ctx, kind, namespace);
      const matched: SearchResult[] = [];
      for (const item of items) {
        const resource = item as unknown as Record<string, unknown>;
        const { matches, detail } = matchesQuery(resource, query);
        if (matches) {
          const meta = resource.metadata as Record<string, unknown>;
          matched.push({
            kind,
            kindLabel: RESOURCE_REGISTRY[kind].label,
            name: meta.name as string,
            namespace: meta.namespace as string | undefined,
            matchDetail: detail,
          });
          if (matched.length >= MAX_PER_KIND) break;
        }
      }
      return matched;
    } catch {
      return [];
    }
  });

  const settled = await Promise.allSettled(promises);
  let results: SearchResult[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  const truncated = results.length > MAX_TOTAL;
  results = results.slice(0, MAX_TOTAL);

  return NextResponse.json({ results, query, truncated });
}
