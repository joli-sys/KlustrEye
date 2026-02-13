import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface HelmRelease {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
}

interface HelmHistory {
  revision: number;
  updated: string;
  status: string;
  chart: string;
  app_version: string;
  description: string;
}

async function helm(args: string[], kubeContext?: string): Promise<string> {
  const fullArgs = [...args];

  if (kubeContext) {
    fullArgs.push("--kube-context", kubeContext);
  }

  const { stdout } = await execFileAsync("helm", fullArgs, {
    timeout: 60000,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function listReleases(
  contextName: string,
  namespace?: string
): Promise<HelmRelease[]> {
  const args = ["list", "--output", "json"];
  if (namespace) {
    args.push("--namespace", namespace);
  } else {
    args.push("--all-namespaces");
  }

  const output = await helm(args, contextName);
  return JSON.parse(output || "[]");
}

export async function getRelease(
  contextName: string,
  name: string,
  namespace: string
): Promise<{ release: HelmRelease; values: Record<string, unknown>; manifest: string }> {
  const [statusOut, valuesOut, manifestOut] = await Promise.all([
    helm(["status", name, "--namespace", namespace, "--output", "json"], contextName),
    helm(["get", "values", name, "--namespace", namespace, "--output", "json"], contextName),
    helm(["get", "manifest", name, "--namespace", namespace], contextName),
  ]);

  return {
    release: JSON.parse(statusOut),
    values: JSON.parse(valuesOut || "{}"),
    manifest: manifestOut,
  };
}

export async function getReleaseHistory(
  contextName: string,
  name: string,
  namespace: string
): Promise<HelmHistory[]> {
  const output = await helm(
    ["history", name, "--namespace", namespace, "--output", "json"],
    contextName
  );
  return JSON.parse(output || "[]");
}

export async function installChart(
  contextName: string,
  releaseName: string,
  chart: string,
  namespace: string,
  values?: Record<string, unknown>,
  version?: string
): Promise<string> {
  const args = ["install", releaseName, chart, "--namespace", namespace, "--create-namespace", "--output", "json"];
  if (version) args.push("--version", version);
  if (values) {
    args.push("--values", "-");
    // For values via stdin, we'd need a different approach
    // For simplicity, use --set for simple values
    args.pop(); args.pop(); // remove --values -
    for (const [key, val] of Object.entries(values)) {
      args.push("--set", `${key}=${val}`);
    }
  }

  return helm(args, contextName);
}

export async function upgradeRelease(
  contextName: string,
  name: string,
  chart: string,
  namespace: string,
  values?: Record<string, unknown>,
  version?: string
): Promise<string> {
  const args = ["upgrade", name, chart, "--namespace", namespace, "--output", "json"];
  if (version) args.push("--version", version);
  if (values) {
    for (const [key, val] of Object.entries(values)) {
      args.push("--set", `${key}=${val}`);
    }
  }

  return helm(args, contextName);
}

export async function uninstallRelease(
  contextName: string,
  name: string,
  namespace: string
): Promise<string> {
  return helm(["uninstall", name, "--namespace", namespace], contextName);
}

export async function rollbackRelease(
  contextName: string,
  name: string,
  namespace: string,
  revision: number
): Promise<string> {
  return helm(["rollback", name, String(revision), "--namespace", namespace], contextName);
}
