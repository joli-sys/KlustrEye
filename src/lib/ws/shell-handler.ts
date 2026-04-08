// @ts-nocheck
import type { WebSocket } from "ws";
import * as pty from "node-pty";
import { homedir, tmpdir } from "os";
import { chmodSync, statSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, readdirSync } from "fs";
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

interface Session {
  ptyProcess: pty.IPty;
  outputBuffer: string[];
  activeWs: WebSocket | null;
}

// Persistent PTY sessions keyed by contextName — survive WebSocket disconnects
const sessions = new Map<string, Session>();
const RING_BUFFER_SIZE = 500;

/**
 * Creates a minimal kubeconfig containing only `current-context`.
 * It is meant to be PREPENDED to the user's existing KUBECONFIG files so that
 * kubectl merges all files — our file's current-context wins, all cluster/user
 * definitions come from the original files. This works with any number of
 * kubeconfig files and doesn't require reading or parsing the originals.
 */
function buildSessionKubeconfig(contextName: string, home: string): string {
  const safeName = contextName.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
  // Write to ~/.kube/ which is always writable (kubectl itself uses it).
  // Avoid tmpdir() which may be restricted in sandboxed Tauri environments.
  const kubeDir = join(home, ".kube");
  mkdirSync(kubeDir, { recursive: true });
  const dest = join(kubeDir, `klustreye-${safeName}.yaml`);
  writeFileSync(
    dest,
    `apiVersion: v1\nkind: Config\ncurrent-context: ${contextName}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  return dest;
}

/**
 * Scans ~/.kube/ for kubeconfig files (YAML/no-extension, excluding known non-kubeconfigs).
 * Returns a colon-separated KUBECONFIG string so kubectl can find ALL contexts.
 */
function discoverKubeconfigPaths(home: string): string {
  const kubeDir = join(home, ".kube");
  const defaults = [`${kubeDir}/config`];
  try {
    const entries = readdirSync(kubeDir, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      // Skip cache dirs, http-cache, lock files, known non-kubeconfigs, and our own files
      if (
        name.startsWith("klustreye-") ||
        name === "cache" ||
        name === "http-cache" ||
        name.endsWith(".lock") ||
        name.endsWith(".json") ||
        name.endsWith(".log") ||
        name.endsWith(".pid")
      ) continue;
      found.push(join(kubeDir, name));
    }
    return found.length > 0 ? found.join(":") : defaults.join(":");
  } catch {
    return defaults.join(":");
  }
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

  // Resume existing session if available
  const existing = sessions.get(contextName);
  if (existing) {
    // Disconnect old WS if still attached
    if (existing.activeWs && existing.activeWs !== ws && existing.activeWs.readyState === existing.activeWs.OPEN) {
      existing.activeWs.close(1000, "Replaced by new connection");
    }
    existing.activeWs = ws;

    // Replay buffered output so the terminal catches up
    for (const chunk of existing.outputBuffer) {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    }

    attachWsToSession(ws, existing, contextName);
    return;
  }

  // --- New session ---
  const kubeconfigPath = await resolveKubeconfigPath();
  const shell = process.env.SHELL || "/bin/zsh";
  const home = homedir();

  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  // Ensure common kubectl install locations are in PATH (important in Tauri/packaged env)
  const extraPaths = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
  env.PATH = env.PATH ? `${env.PATH}:${extraPaths}` : extraPaths;

  // Build a minimal kubeconfig that only declares current-context.
  // It will be PREPENDED to whatever KUBECONFIG the shell sets so kubectl
  // merges all files — our current-context wins, cluster/user defs come from originals.
  let sessionKubeconfigPath = "";
  try {
    sessionKubeconfigPath = buildSessionKubeconfig(contextName, home);
  } catch {
    // File creation failed — debounce will fall back to kubectl config use-context
  }

  const shellBin = shell.split("/").pop() ?? "";
  // Shell-safe single-quoted path for use inside shell scripts
  const safePath = sessionKubeconfigPath.replace(/'/g, "'\\''");
  // After .zshrc runs $KUBECONFIG is the user's full multi-file path; prepend ours.
  // If KUBECONFIG wasn't set, fall back to ~/.kube/config.
  const kubeExport =
    `export KUBECONFIG='${safePath}':` +
    '"${KUBECONFIG:-$HOME/.kube/config}"';

  let spawnArgs: string[] = [];

  if (shellBin === "zsh" && sessionKubeconfigPath) {
    try {
      const tempZDir = mkdtempSync(join(tmpdir(), "klustreye-zsh-"));

      // .zshenv runs first, before .zshrc.
      // Register a one-shot precmd hook here so it fires AFTER .zshrc (and any
      // plugin manager) has finished — guaranteeing our KUBECONFIG wins last.
      writeFileSync(
        join(tempZDir, ".zshenv"),
        `[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv" 2>/dev/null\n` +
        `_klustreye_init() {\n` +
        `  export KUBECONFIG='${safePath}':` + '"${KUBECONFIG:-$HOME/.kube/config}"\n' +
        '  precmd_functions=("${(@)precmd_functions:#_klustreye_init}")\n' +
        `  unset -f _klustreye_init\n` +
        `}\n` +
        `precmd_functions+=(_klustreye_init)\n`,
        { mode: 0o600 }
      );
      // .zshrc: restore ZDOTDIR so user's .zshrc nested sources resolve correctly,
      // then source it. KUBECONFIG is handled by the precmd hook above.
      writeFileSync(
        join(tempZDir, ".zshrc"),
        `export ZDOTDIR="$HOME"\n` +
        `[[ -f "$HOME/.zshrc" ]] && source "$HOME/.zshrc" 2>/dev/null\n`,
        { mode: 0o600 }
      );
      env.ZDOTDIR = tempZDir;
    } catch {
      // ZDOTDIR setup failed — debounce fallback below will handle it
    }
  } else if (shellBin === "bash" && sessionKubeconfigPath) {
    try {
      const rcFile = join(tmpdir(), `klustreye-bashrc-${Date.now()}.sh`);
      writeFileSync(
        rcFile,
        `[[ -f "$HOME/.bash_profile" ]] && source "$HOME/.bash_profile" 2>/dev/null\n` +
        `[[ -f "$HOME/.bashrc" ]] && source "$HOME/.bashrc" 2>/dev/null\n` +
        kubeExport + "\n",
        { mode: 0o600 }
      );
      spawnArgs = ["--rcfile", rcFile];
    } catch {
      // rcfile setup failed — debounce fallback below will handle it
    }
  }

  // Always set KUBECONFIG to ALL discovered kubeconfig files before spawn so
  // kubectl can find contexts from any file (e.g. config_jakku with EKS contexts).
  // Explicit kubeconfigPath from settings takes priority if set, otherwise auto-discover.
  if (kubeconfigPath) {
    env.KUBECONFIG = kubeconfigPath;
  } else {
    env.KUBECONFIG = discoverKubeconfigPaths(home);
  }

  let ptyProcess: pty.IPty;
  try {
    ptyProcess = pty.spawn(shell, spawnArgs, {
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

  const session: Session = { ptyProcess, outputBuffer: [], activeWs: ws };
  sessions.set(contextName, session);

  // Inject context setup once the shell is ready.
  // If the temp kubeconfig was created: prepend it to existing KUBECONFIG.
  // If creation failed: fall back to `kubectl config use-context`.
  const safeCtx = contextName.replace(/'/g, "'\\''");
  const initCmd = sessionKubeconfigPath
    ? kubeExport
    : `kubectl config use-context '${safeCtx}'`;
  let shellInitialized = false;
  let shellInitDebounce: ReturnType<typeof setTimeout> | null = null;

  const runInitCmd = () => {
    if (shellInitialized) return;
    shellInitialized = true;
    if (shellInitDebounce) clearTimeout(shellInitDebounce);
    ptyProcess.write(initCmd + "\r");
  };

  // Primary: 1500ms of PTY silence = shell is idle at prompt
  // Fallback: fixed 10s timeout in case onData never fires or debounce keeps resetting
  // (heavy configs like oh-my-zsh + ssh-agent can take >3s to initialize)
  const initFallbackTimeout = setTimeout(runInitCmd, 10000);

  // PTY stdout → ring buffer + active WebSocket
  ptyProcess.onData((data) => {
    session.outputBuffer.push(data);
    if (session.outputBuffer.length > RING_BUFFER_SIZE) session.outputBuffer.shift();
    if (session.activeWs?.readyState === session.activeWs?.OPEN) {
      session.activeWs.send(data);
    }

    if (!shellInitialized) {
      if (shellInitDebounce) clearTimeout(shellInitDebounce);
      shellInitDebounce = setTimeout(runInitCmd, 1500);
    }
  });

  ptyProcess.onExit(() => {
    clearTimeout(initFallbackTimeout);
    if (shellInitDebounce) clearTimeout(shellInitDebounce);
    sessions.delete(contextName);
    if (session.activeWs?.readyState === session.activeWs?.OPEN) {
      session.activeWs.close(1000, "Shell exited");
    }
  });

  attachWsToSession(ws, session, contextName);
}

function attachWsToSession(ws: WebSocket, session: Session, contextName: string) {
  // WebSocket → PTY stdin
  ws.on("message", (data) => {
    const msg = data.toString();
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === "resize") {
        session.ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — treat as stdin input
    }
    session.ptyProcess.write(msg);
  });

  ws.on("close", () => {
    // Detach WS but keep PTY alive for reconnection
    if (sessions.get(contextName)?.activeWs === ws) {
      sessions.get(contextName)!.activeWs = null;
    }
  });

  ws.on("error", () => {
    if (sessions.get(contextName)?.activeWs === ws) {
      sessions.get(contextName)!.activeWs = null;
    }
  });
}
