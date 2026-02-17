import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PluginServerHandlers } from "@/lib/plugins/types";
import { getTimeRangeParams, type TimeRange } from "./queries";

// --- Grafana client logic ---

export interface GrafanaConfig {
  url: string;
  serviceAccountToken: string;
  datasourceId: string;
}

export async function getGrafanaConfig(
  contextName: string
): Promise<GrafanaConfig | null> {
  const cluster = await prisma.clusterContext.findUnique({
    where: { contextName },
    include: { settings: true },
  });
  if (!cluster) return null;

  const settingsMap = new Map(
    cluster.settings.map((s) => [s.key, s.value])
  );

  const url = settingsMap.get("grafanaUrl");
  const serviceAccountToken = settingsMap.get("grafanaServiceAccountToken");
  const datasourceId = settingsMap.get("grafanaDatasourceId");

  if (!url || !serviceAccountToken || !datasourceId) return null;

  return { url: url.replace(/\/+$/, ""), serviceAccountToken, datasourceId };
}

function datasourceProxyPath(datasourceId: string): string {
  if (/^\d+$/.test(datasourceId)) {
    return `/api/datasources/proxy/${datasourceId}`;
  }
  return `/api/datasources/proxy/uid/${datasourceId}`;
}

interface QueryParams {
  query: string;
  start: number;
  end: number;
  step: number;
}

interface PrometheusDataPoint {
  timestamp: number;
  value: number;
}

export interface PrometheusSeries {
  metric: Record<string, string>;
  dataPoints: PrometheusDataPoint[];
}

export async function queryGrafana(
  config: GrafanaConfig,
  params: QueryParams
): Promise<PrometheusSeries[]> {
  const url = new URL(
    `${datasourceProxyPath(config.datasourceId)}/api/v1/query_range`,
    config.url
  );
  url.searchParams.set("query", params.query);
  url.searchParams.set("start", String(params.start));
  url.searchParams.set("end", String(params.end));
  url.searchParams.set("step", String(params.step));

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${config.serviceAccountToken}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Grafana query failed (${res.status}): ${body}`);
  }

  const json = await res.json();

  if (json.status !== "success") {
    throw new Error(`Grafana query error: ${json.error ?? "unknown"}`);
  }

  const result = json.data?.result as
    | { metric: Record<string, string>; values: [number, string][] }[]
    | undefined;

  if (!result) return [];

  return result.map((series) => ({
    metric: series.metric,
    dataPoints: series.values.map(([ts, val]) => ({
      timestamp: ts,
      value: parseFloat(val),
    })),
  }));
}

export interface ConnectionTestResult {
  ok: boolean;
  error?: string;
  metrics?: {
    containerCpu: boolean;
    containerMemory: boolean;
    nodeCpu: boolean;
    nodeMemory: boolean;
  };
}

async function probeMetric(
  config: GrafanaConfig,
  metric: string,
  signal: AbortSignal
): Promise<boolean> {
  try {
    const url = new URL(
      `${datasourceProxyPath(config.datasourceId)}/api/v1/query`,
      config.url
    );
    url.searchParams.set("query", `count(${metric})`);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${config.serviceAccountToken}` },
      signal,
    });
    if (!res.ok) return false;
    const json = await res.json();
    const result = json.data?.result as { value?: [number, string] }[] | undefined;
    return !!result?.length && parseFloat(result[0].value?.[1] ?? "0") > 0;
  } catch {
    return false;
  }
}

export async function testGrafanaConnection(
  config: GrafanaConfig
): Promise<ConnectionTestResult> {
  try {
    const url = new URL(
      `${datasourceProxyPath(config.datasourceId)}/api/v1/query`,
      config.url
    );
    url.searchParams.set("query", "up");

    const signal = AbortSignal.timeout(15_000);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${config.serviceAccountToken}` },
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body}` };
    }

    const json = await res.json();
    if (json.status !== "success") {
      return { ok: false, error: json.error ?? "Unexpected response" };
    }

    const [containerCpu, containerMemory, nodeCpu, nodeMemory] =
      await Promise.all([
        probeMetric(config, "container_cpu_usage_seconds_total", signal),
        probeMetric(config, "container_memory_working_set_bytes", signal),
        probeMetric(config, "node_cpu_seconds_total", signal),
        probeMetric(config, "node_memory_MemTotal_bytes", signal),
      ]);

    return {
      ok: true,
      metrics: { containerCpu, containerMemory, nodeCpu, nodeMemory },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Connection failed",
    };
  }
}

// --- Plugin server handler exports ---

export const serverHandlers: PluginServerHandlers = {
  settings: {
    async get(contextName: string) {
      try {
        const config = await getGrafanaConfig(contextName);

        if (!config) {
          return NextResponse.json({ url: "", datasourceId: "", hasToken: false });
        }

        return NextResponse.json({
          url: config.url,
          datasourceId: config.datasourceId,
          hasToken: true,
        });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to load Grafana config";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },

    async put(contextName: string, request: NextRequest) {
      try {
        const { url, serviceAccountToken, datasourceId } = await request.json();

        if (!url || !datasourceId) {
          return NextResponse.json(
            { error: "url and datasourceId are required" },
            { status: 400 }
          );
        }

        const cluster = await prisma.clusterContext.upsert({
          where: { contextName },
          update: {},
          create: { contextName },
        });

        const settings: { key: string; value: string }[] = [
          { key: "grafanaUrl", value: String(url).replace(/\/+$/, "") },
          { key: "grafanaDatasourceId", value: String(datasourceId) },
        ];

        if (serviceAccountToken && serviceAccountToken !== "__keep__") {
          settings.push({
            key: "grafanaServiceAccountToken",
            value: String(serviceAccountToken),
          });
        } else if (!serviceAccountToken) {
          const existing = await prisma.clusterSetting.findUnique({
            where: {
              clusterId_key: {
                clusterId: cluster.id,
                key: "grafanaServiceAccountToken",
              },
            },
          });
          if (!existing) {
            return NextResponse.json(
              { error: "serviceAccountToken is required" },
              { status: 400 }
            );
          }
        }

        for (const { key, value } of settings) {
          await prisma.clusterSetting.upsert({
            where: { clusterId_key: { clusterId: cluster.id, key } },
            update: { value },
            create: { clusterId: cluster.id, key, value },
          });
        }

        return NextResponse.json({ ok: true });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Failed to save Grafana config";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    },

    async test(contextName: string) {
      try {
        const config = await getGrafanaConfig(contextName);

        if (!config) {
          return NextResponse.json(
            { ok: false, error: "Grafana not configured" },
            { status: 400 }
          );
        }

        const result = await testGrafanaConnection(config);
        return NextResponse.json(result);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Connection test failed";
        return NextResponse.json({ ok: false, error: message }, { status: 500 });
      }
    },
  },

  async api(contextName: string, path: string[], request: NextRequest) {
    // path[0] === "query"
    if (path[0] === "query" && request.method === "POST") {
      try {
        const { queries, timeRange } = (await request.json()) as {
          queries: string[];
          timeRange: TimeRange;
        };

        if (!queries?.length || !timeRange) {
          return NextResponse.json(
            { error: "queries and timeRange are required" },
            { status: 400 }
          );
        }

        const config = await getGrafanaConfig(contextName);
        if (!config) {
          return NextResponse.json(
            { error: "Grafana not configured for this cluster" },
            { status: 404 }
          );
        }

        const { start, end, step } = getTimeRangeParams(timeRange);

        const results = await Promise.all(
          queries.map((query) =>
            queryGrafana(config, { query, start, end, step })
          )
        );

        return NextResponse.json({ series: results, queries });
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : "Grafana query failed";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },
};
