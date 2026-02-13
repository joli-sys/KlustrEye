"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { usePodMetrics } from "@/hooks/use-metrics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseCpuValue, parseMemoryValue, formatCpu, formatBytes } from "@/lib/utils";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface MetricSample {
  time: string;
  timestamp: number;
  cpu: number;
  memory: number;
}

interface PodMetricsChartProps {
  contextName: string;
  podName: string;
  namespace: string;
}

const MAX_SAMPLES = 60;

export function PodMetricsChart({ contextName, podName, namespace }: PodMetricsChartProps) {
  const { data: metricsData } = usePodMetrics(contextName, namespace);
  const [samples, setSamples] = useState<MetricSample[]>([]);
  const lastTimestamp = useRef(0);

  useEffect(() => {
    if (!metricsData) return;
    const items = (metricsData as Record<string, unknown>)?.items as Record<string, unknown>[] | undefined;
    if (!items) return;

    const pod = items.find((item) => {
      const meta = item.metadata as Record<string, unknown>;
      return meta?.name === podName && meta?.namespace === namespace;
    });
    if (!pod) return;

    const containers = pod.containers as Record<string, unknown>[] | undefined;
    if (!containers?.length) return;

    let totalCpu = 0;
    let totalMemory = 0;
    for (const c of containers) {
      const usage = c.usage as Record<string, string>;
      if (usage) {
        if (usage.cpu) totalCpu += parseCpuValue(usage.cpu);
        if (usage.memory) totalMemory += parseMemoryValue(usage.memory);
      }
    }

    const now = Date.now();
    if (now - lastTimestamp.current < 5000) return;
    lastTimestamp.current = now;

    setSamples((prev) => {
      const next = [
        ...prev,
        {
          time: new Date(now).toLocaleTimeString(),
          timestamp: now,
          cpu: totalCpu,
          memory: totalMemory,
        },
      ];
      return next.slice(-MAX_SAMPLES);
    });
  }, [metricsData, podName, namespace]);

  const cpuDomain = useMemo(() => {
    if (samples.length === 0) return [0, 0.1];
    const max = Math.max(...samples.map((s) => s.cpu));
    return [0, Math.max(max * 1.2, 0.001)];
  }, [samples]);

  const memDomain = useMemo(() => {
    if (samples.length === 0) return [0, 1024 * 1024];
    const max = Math.max(...samples.map((s) => s.memory));
    return [0, Math.max(max * 1.2, 1024)];
  }, [samples]);

  if (samples.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Collecting metrics data...</p>
        <p className="text-sm mt-1">Samples are recorded every ~10 seconds while you view this page.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">CPU Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={samples}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0 0)" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={cpuDomain}
                tickFormatter={(v: number) => formatCpu(v)}
                tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                width={60}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.178 0 0)",
                  border: "1px solid oklch(0.3 0 0)",
                  color: "oklch(0.985 0 0)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
                formatter={(value: number | undefined) => [value != null ? formatCpu(value) : "-", "CPU"]}
              />
              <Line
                type="monotone"
                dataKey="cpu"
                stroke="oklch(0.648 0.2 260)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Memory Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={samples}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0 0)" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={memDomain}
                tickFormatter={(v: number) => formatBytes(v)}
                tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.178 0 0)",
                  border: "1px solid oklch(0.3 0 0)",
                  color: "oklch(0.985 0 0)",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
                formatter={(value: number | undefined) => [value != null ? formatBytes(value) : "-", "Memory"]}
              />
              <Line
                type="monotone"
                dataKey="memory"
                stroke="oklch(0.648 0.2 145)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
