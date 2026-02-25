import type { WebSocket } from "ws";
import * as pty from "node-pty";
import { homedir } from "os";
import { chmodSync, statSync } from "fs";
import { join } from "path";

// node-pty requires its spawn-helper binary to be executable.
// npm install sometimes strips the execute bit — fix it once at import time.
try {
  const spawnHelper = join(
    require.resolve("node-pty/package.json"),
    "..",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper"
  );
  const st = statSync(spawnHelper);
  if (!(st.mode & 0o111)) {
    chmodSync(spawnHelper, st.mode | 0o755);
  }
} catch {
  // prebuilt path may differ — ignore and let spawn report the real error
}

interface ShellParams {
  contextName: string;
}

async function resolveKubeconfigPath(): Promise<string | undefined> {
  try {
    const { prisma } = await import("@/lib/prisma");
    const pref = await prisma.userPreference.findUnique({
      where: { key: "kubeconfigPath" },
    });
    if (pref?.value) return pref.value;
  } catch {
    // DB not ready — fall through
  }
  if (process.env.KUBECONFIG_PATH) return process.env.KUBECONFIG_PATH;
  return undefined; // kubectl will use ~/.kube/config by default
}

export async function handleShellConnection(ws: WebSocket, params: ShellParams) {
  const { contextName } = params;

  const shell = process.env.SHELL || "/bin/bash";
  const home = homedir();
  const kubeconfigPath = await resolveKubeconfigPath();

  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (kubeconfigPath) {
    env.KUBECONFIG = kubeconfigPath;
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: home,
      env,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to spawn shell";
    if (ws.readyState === ws.OPEN) {
      ws.send(`\r\nError: ${message}\r\n`);
      ws.close(1011, message);
    }
    return;
  }

  // Switch to the correct kubectl context
  ptyProcess.write(`kubectl config use-context ${contextName} 2>/dev/null && clear\r`);

  // PTY stdout → WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  ptyProcess.onExit(() => {
    if (ws.readyState === ws.OPEN) {
      ws.close(1000, "Shell exited");
    }
  });

  // WebSocket → PTY stdin
  ws.on("message", (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === "resize") {
        ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — treat as stdin input
    }
    ptyProcess.write(msg);
  });

  const cleanup = () => {
    try {
      ptyProcess.kill();
    } catch {
      // already dead
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}
