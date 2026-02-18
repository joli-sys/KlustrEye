import { NextRequest } from "next/server";
import * as k8s from "@kubernetes/client-node";
import { getCoreApi, getKubeConfig } from "@/lib/k8s/client";
import { Writable } from "stream";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const namespace = req.nextUrl.searchParams.get("namespace") || "default";
  const containerParam = req.nextUrl.searchParams.get("container") || "";
  const follow = req.nextUrl.searchParams.get("follow") === "true";
  const tailLines = parseInt(req.nextUrl.searchParams.get("tailLines") || "200");
  const previous = req.nextUrl.searchParams.get("previous") === "true";

  if (!follow) {
    try {
      const api = getCoreApi(contextName);
      const result = await api.readNamespacedPodLog({
        name,
        namespace,
        container: containerParam || undefined,
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

  // True streaming via k8s.Log
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const kc = getKubeConfig(contextName);
      const log = new k8s.Log(kc);

      // Create a writable stream that forwards chunks as SSE
      const output = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          try {
            const text = chunk.toString("utf-8");
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line: text })}\n\n`));
            callback();
          } catch {
            callback();
          }
        },
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      log
        .log(namespace, name, containerParam, output, {
          follow: true,
          tailLines,
          previous,
        })
        .then((ws) => {
          // ws is the request object — abort on client disconnect
          req.signal.addEventListener("abort", () => {
            clearInterval(heartbeat);
            ws.abort();
            output.destroy();
            try { controller.close(); } catch { /* already closed */ }
          });
        })
        .catch((error: unknown) => {
          clearInterval(heartbeat);
          const message = error instanceof Error ? error.message : "Log stream failed";
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
            controller.close();
          } catch { /* already closed */ }
        });

      output.on("close", () => {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });

      output.on("error", () => {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      });
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
