import { createServer, type Server as HttpServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { handleTerminalConnection } from "./src/lib/ws/terminal-handler";
import { handleShellConnection } from "./src/lib/ws/shell-handler";
import { cleanupAllPortForwards, markStaleSessionsStopped } from "./src/lib/k8s/port-forward";
import { ensureDatabase } from "./src/lib/prisma";

export async function startServer(opts: {
  dev: boolean;
  port: number;
  dir?: string;
}): Promise<HttpServer> {
  const { dev, port, dir } = opts;
  const hostname = "localhost";

  const app = next({ dev, hostname, port, dir });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Ensure all tables exist (needed for packaged Electron app without Prisma migrations)
  await ensureDatabase();

  // Mark any stale port-forward sessions from previous server instances as stopped
  await markStaleSessionsStopped();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = parse(req.url!, true);

    // Route: /ws/shell/:contextName — local shell with kubectl context
    if (pathname?.startsWith("/ws/shell/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const parts = pathname.split("/").filter(Boolean);
        // parts: ["ws", "shell", contextName]
        if (parts.length >= 3) {
          const contextName = decodeURIComponent(parts[2]);
          handleShellConnection(ws, { contextName });
        } else {
          ws.close(1008, "Invalid shell path");
        }
      });
      return;
    }

    // Route: /ws/terminal/:contextName/:namespace/:pod/:container
    if (pathname?.startsWith("/ws/terminal/")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        const parts = pathname.split("/").filter(Boolean);
        // parts: ["ws", "terminal", contextName, namespace, pod, container]
        if (parts.length >= 6) {
          const contextName = decodeURIComponent(parts[2]);
          const namespace = decodeURIComponent(parts[3]);
          const pod = decodeURIComponent(parts[4]);
          const container = decodeURIComponent(parts[5]);
          handleTerminalConnection(ws, {
            contextName,
            namespace,
            pod,
            container,
          });
        } else {
          ws.close(1008, "Invalid terminal path");
        }
      });
    } else {
      // Not a recognized WebSocket route - destroy the socket
      socket.destroy();
    }
  });

  const shutdown = async () => {
    await cleanupAllPortForwards();
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`> Ready on http://${hostname}:${port}`);
      resolve(server);
    });
  });
}

// Direct-run guard: auto-start only when executed directly (not imported by Electron)
const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("server.ts");

if (isDirectRun) {
  const dev = process.env.NODE_ENV !== "production";
  const port = parseInt(process.env.PORT || "3000", 10);
  startServer({ dev, port });
}
