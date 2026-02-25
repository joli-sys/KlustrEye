import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { gunzipSync } from "zlib";
import { getCoreApi } from "./client";

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

/**
 * Resolve the chart reference and version for an installed release.
 * Reads the chart name/version from the Helm release secret, then
 * searches configured repos for the full repo/chart reference.
 * Returns { chartRef, version }.
 */
async function resolveChartRef(
  contextName: string,
  name: string,
  namespace: string
): Promise<{ chartRef: string; version: string }> {
  // Get current revision from helm list
  const listOut = await helm(
    ["list", "--filter", `^${name}$`, "--namespace", namespace, "--output", "json"],
    contextName
  );
  const releases = JSON.parse(listOut || "[]");
  const revision = releases[0]?.revision;
  if (!revision) {
    throw new Error(`Release "${name}" not found in namespace "${namespace}"`);
  }

  // Read chart metadata from the release secret
  const api = getCoreApi(contextName);
  const secretName = `sh.helm.release.v1.${name}.v${revision}`;
  const secret = await api.readNamespacedSecret({ name: secretName, namespace });
  const releaseB64 = secret.data?.release;
  if (!releaseB64) {
    throw new Error(`Helm release secret "${secretName}" has no release data`);
  }

  const outer = Buffer.from(releaseB64, "base64");
  const inner = Buffer.from(outer.toString("utf-8"), "base64");
  const json = gunzipSync(inner).toString("utf-8");
  const release = JSON.parse(json);
  const chartName = release?.chart?.metadata?.name;
  const chartVersion = release?.chart?.metadata?.version;

  if (!chartName) {
    throw new Error("Chart metadata missing in release secret");
  }

  // Search configured repos for the full repo/chart reference
  try {
    const searchOut = await helm(
      ["search", "repo", chartName, "--version", chartVersion || "", "--output", "json"],
      contextName
    );
    const results = JSON.parse(searchOut || "[]") as { name: string; version: string }[];
    const exact = results.find(
      (r) => (r.name === chartName || r.name.endsWith(`/${chartName}`)) &&
             (!chartVersion || r.version === chartVersion)
    );
    if (exact) return { chartRef: exact.name, version: exact.version };
    // Fallback: match by name only
    const byName = results.find((r) => r.name === chartName || r.name.endsWith(`/${chartName}`));
    if (byName) return { chartRef: byName.name, version: chartVersion || byName.version };
  } catch {
    // repo search failed
  }

  throw new Error(
    `Chart "${chartName}" (version ${chartVersion || "unknown"}) not found in any configured Helm repo. ` +
    `Add the repo with "helm repo add" and try again.`
  );
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
  chart: string | undefined,
  namespace: string,
  valuesYaml?: string,
  version?: string
): Promise<string> {
  let tmpFile: string | undefined;

  try {
    let chartRef = chart;
    let chartVersion = version;
    if (!chartRef) {
      const resolved = await resolveChartRef(contextName, name, namespace);
      chartRef = resolved.chartRef;
      chartVersion = chartVersion || resolved.version;
    }

    const args = ["upgrade", name, chartRef, "--namespace", namespace, "--atomic", "--output", "json"];
    if (chartVersion) args.push("--version", chartVersion);

    if (valuesYaml) {
      tmpFile = join(tmpdir(), `helm-values-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
      await writeFile(tmpFile, valuesYaml, "utf-8");
      args.push("--values", tmpFile);
    }

    return await helm(args, contextName);
  } finally {
    if (tmpFile) await unlink(tmpFile).catch(() => {});
  }
}

export async function templateRelease(
  contextName: string,
  name: string,
  namespace: string,
  valuesYaml?: string
): Promise<string> {
  let tmpFile: string | undefined;

  try {
    const { chartRef, version } = await resolveChartRef(contextName, name, namespace);
    const args = ["template", name, chartRef, "--namespace", namespace, "--version", version];

    if (valuesYaml) {
      tmpFile = join(tmpdir(), `helm-values-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);
      await writeFile(tmpFile, valuesYaml, "utf-8");
      args.push("--values", tmpFile);
    }

    return await helm(args, contextName);
  } finally {
    if (tmpFile) await unlink(tmpFile).catch(() => {});
  }
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
