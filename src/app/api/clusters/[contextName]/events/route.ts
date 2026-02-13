import { NextRequest } from "next/server";
import { getCoreApi } from "@/lib/k8s/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string }> }
) {
  const { contextName } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || undefined;
  const follow = req.nextUrl.searchParams.get("follow") === "true";

  const involvedKind = req.nextUrl.searchParams.get("involvedObject.kind") || undefined;
  const involvedName = req.nextUrl.searchParams.get("involvedObject.name") || undefined;

  const fieldSelector = [
    involvedKind ? `involvedObject.kind=${involvedKind}` : "",
    involvedName ? `involvedObject.name=${involvedName}` : "",
  ]
    .filter(Boolean)
    .join(",") || undefined;

  if (!follow) {
    try {
      const api = getCoreApi(contextName);
      const result = namespace
        ? await api.listNamespacedEvent({ namespace, fieldSelector })
        : await api.listEventForAllNamespaces({ fieldSelector });
      return Response.json({ items: result.items });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to list events";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  // SSE streaming for live events
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const api = getCoreApi(contextName);

        const result = namespace
          ? await api.listNamespacedEvent({ namespace })
          : await api.listEventForAllNamespaces();

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ items: result.items })}\n\n`)
        );

        const poll = setInterval(async () => {
          try {
            const newResult = namespace
              ? await api.listNamespacedEvent({ namespace })
              : await api.listEventForAllNamespaces();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ items: newResult.items })}\n\n`)
            );
          } catch {
            // Ignore poll errors
          }
        }, 5000);

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15000);

        req.signal.addEventListener("abort", () => {
          clearInterval(poll);
          clearInterval(heartbeat);
          controller.close();
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Event stream failed";
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
