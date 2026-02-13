import { NextRequest } from "next/server";
import { getCoreApi } from "@/lib/k8s/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || "default";
  const container = req.nextUrl.searchParams.get("container") || undefined;
  const follow = req.nextUrl.searchParams.get("follow") === "true";
  const tailLines = parseInt(req.nextUrl.searchParams.get("tailLines") || "200");
  const previous = req.nextUrl.searchParams.get("previous") === "true";

  if (!follow) {
    // Return logs as plain text
    try {
      const api = getCoreApi(contextName);
      const result = await api.readNamespacedPodLog({
        name,
        namespace,
        container,
        tailLines,
        previous,
      });
      return new Response(result, {
        headers: { "Content-Type": "text/plain" },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to read logs";
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // SSE streaming
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const api = getCoreApi(contextName);
        const result = await api.readNamespacedPodLog({
          name,
          namespace,
          container,
          follow: true,
          tailLines,
          previous,
        });

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ logs: result })}\n\n`));

        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            clearInterval(heartbeat);
          }
        }, 15000);

        let lastLog = result;
        const poll = setInterval(async () => {
          try {
            const newResult = await api.readNamespacedPodLog({
              name,
              namespace,
              container,
              tailLines: 50,
              previous,
            });
            if (newResult !== lastLog) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ logs: newResult })}\n\n`));
              lastLog = newResult;
            }
          } catch {
            clearInterval(poll);
            clearInterval(heartbeat);
            controller.close();
          }
        }, 2000);

        req.signal.addEventListener("abort", () => {
          clearInterval(heartbeat);
          clearInterval(poll);
          controller.close();
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Log stream failed";
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
