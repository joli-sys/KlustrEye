import { spawn, type ChildProcess } from "child_process";
import { createServer } from "net";
import { prisma } from "@/lib/prisma";

const activeProcesses = new Map<string, ChildProcess>();

interface StartPortForwardOptions {
  contextName: string;
  namespace: string;
  resourceType: string;
  resourceName: string;
  localPort: number;
  remotePort: number;
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function startPortForward(opts: StartPortForwardOptions) {
  const { contextName, namespace, resourceType, resourceName, localPort, remotePort } = opts;

  const available = await isPortAvailable(localPort);
  if (!available) {
    throw new Error(`Port ${localPort} is already in use`);
  }

  const session = await prisma.portForwardSession.create({
    data: {
      contextName,
      namespace,
      resourceType,
      resourceName,
      localPort,
      remotePort,
      status: "starting",
    },
  });

  const target = `${resourceType}/${resourceName}`;
  const portMapping = `${localPort}:${remotePort}`;

  const child = spawn(
    "kubectl",
    ["port-forward", target, portMapping, "-n", namespace, "--context", contextName],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  activeProcesses.set(session.id, child);

  return new Promise<typeof session>((resolve, reject) => {
    let settled = false;
    let stderrOutput = "";

    const timeout = setTimeout(async () => {
      if (!settled) {
        settled = true;
        // If process is still running after 5s without error, assume success
        if (child.exitCode === null) {
          await prisma.portForwardSession.update({
            where: { id: session.id },
            data: { status: "active", pid: child.pid },
          });
          resolve({ ...session, status: "active", pid: child.pid ?? null });
        }
      }
    }, 5000);

    child.stdout?.on("data", async (data: Buffer) => {
      const output = data.toString();
      // kubectl outputs "Forwarding from 127.0.0.1:PORT -> PORT" on success
      if (!settled && output.includes("Forwarding from")) {
        settled = true;
        clearTimeout(timeout);
        await prisma.portForwardSession.update({
          where: { id: session.id },
          data: { status: "active", pid: child.pid },
        });
        resolve({ ...session, status: "active", pid: child.pid ?? null });
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrOutput += data.toString();
    });

    child.on("error", async (err) => {
      clearTimeout(timeout);
      activeProcesses.delete(session.id);
      await prisma.portForwardSession.update({
        where: { id: session.id },
        data: { status: "error", errorMessage: err.message, stoppedAt: new Date() },
      });
      if (!settled) {
        settled = true;
        reject(new Error(err.message));
      }
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      activeProcesses.delete(session.id);
      const errorMsg = stderrOutput.trim() || (code !== 0 ? `Process exited with code ${code}` : undefined);
      await prisma.portForwardSession.update({
        where: { id: session.id },
        data: {
          status: "stopped",
          errorMessage: errorMsg || undefined,
          stoppedAt: new Date(),
        },
      });
      if (!settled) {
        settled = true;
        if (code !== 0) {
          reject(new Error(errorMsg || `kubectl port-forward exited with code ${code}`));
        } else {
          resolve({ ...session, status: "stopped" });
        }
      }
    });
  });
}

export async function stopPortForward(sessionId: string) {
  const child = activeProcesses.get(sessionId);
  if (child) {
    child.kill("SIGTERM");
    activeProcesses.delete(sessionId);
  }

  await prisma.portForwardSession.update({
    where: { id: sessionId },
    data: { status: "stopped", stoppedAt: new Date() },
  });
}

export async function listActivePortForwards(contextName?: string) {
  const where: Record<string, unknown> = {
    status: { in: ["active", "starting"] },
  };
  if (contextName) {
    where.contextName = contextName;
  }

  const sessions = await prisma.portForwardSession.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });

  // Cross-check with in-memory processes
  for (const session of sessions) {
    if (!activeProcesses.has(session.id)) {
      await prisma.portForwardSession.update({
        where: { id: session.id },
        data: { status: "stopped", stoppedAt: new Date() },
      });
      session.status = "stopped";
    }
  }

  return sessions.filter((s) => s.status === "active" || s.status === "starting");
}

export async function cleanupAllPortForwards() {
  for (const [id, child] of activeProcesses) {
    child.kill("SIGTERM");
    activeProcesses.delete(id);
  }

  await prisma.portForwardSession.updateMany({
    where: { status: { in: ["active", "starting"] } },
    data: { status: "stopped", stoppedAt: new Date() },
  });
}

export async function markStaleSessionsStopped() {
  await prisma.portForwardSession.updateMany({
    where: { status: { in: ["active", "starting"] } },
    data: { status: "stopped", stoppedAt: new Date() },
  });
}
