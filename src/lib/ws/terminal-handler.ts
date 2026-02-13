import type { WebSocket } from "ws";
import { getKubeConfig } from "@/lib/k8s/client";
import * as k8s from "@kubernetes/client-node";
import { Writable, Readable } from "stream";

interface TerminalParams {
  contextName: string;
  namespace: string;
  pod: string;
  container: string;
}

export function handleTerminalConnection(ws: WebSocket, params: TerminalParams) {
  const { contextName, namespace, pod, container } = params;

  let closed = false;

  const cleanup = () => {
    closed = true;
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);

  (async () => {
    try {
      const kc = getKubeConfig(contextName);
      const exec = new k8s.Exec(kc);

      // Create writable stream that sends data to WebSocket
      const writableStdout = new Writable({
        write(chunk, _encoding, callback) {
          if (!closed && ws.readyState === ws.OPEN) {
            ws.send(chunk.toString());
          }
          callback();
        },
      });

      const writableStderr = new Writable({
        write(chunk, _encoding, callback) {
          if (!closed && ws.readyState === ws.OPEN) {
            ws.send(chunk.toString());
          }
          callback();
        },
      });

      // Create a readable stream for stdin
      const readableStdin = new Readable({
        read() {},
      });

      // Try bash first, fall back to sh
      const command = ["/bin/sh", "-c", "exec bash || exec sh"];

      const conn = await exec.exec(
        namespace,
        pod,
        container,
        command,
        writableStdout,
        writableStderr,
        readableStdin,
        true, // tty
      );

      // Forward WebSocket messages to stdin
      ws.on("message", (data) => {
        const msg = data.toString();

        // Check for resize messages: JSON format { "type": "resize", "cols": N, "rows": N }
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type === "resize" && conn) {
            // k8s exec doesn't easily support resize in this mode
            // but we handle the message to prevent it from being sent to stdin
            return;
          }
        } catch {
          // Not JSON, treat as stdin input
        }

        readableStdin.push(msg);
      });

      ws.on("close", () => {
        readableStdin.push(null);
        if (conn && typeof (conn as { close?: () => void }).close === "function") {
          (conn as { close: () => void }).close();
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Terminal connection failed";
      if (ws.readyState === ws.OPEN) {
        ws.send(`\r\nError: ${message}\r\n`);
        ws.close(1011, message);
      }
    }
  })();
}
