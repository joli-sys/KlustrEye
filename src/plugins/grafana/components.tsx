"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCpu, formatBytes } from "@/lib/utils";
import type { PrometheusSeries } from "./server";
import type { TimeRange } from "./queries";
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

const TIME_RANGES: { value: TimeRange; label: string }[] = [
  { value: "1h", label: "1h" },
  { value: "6h", label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

const SERIES_COLORS = [
  "oklch(0.648 0.2 260)",
  "oklch(0.648 0.2 145)",
  "oklch(0.648 0.2 30)",
  "oklch(0.648 0.2 330)",
  "oklch(0.648 0.2 200)",
];

interface HistoricalMetricsChartProps {
  cpuSeries: PrometheusSeries[];
  memorySeries: PrometheusSeries[];
  timeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  isLoading: boolean;
  error?: string | null;
  queries?: string[];
}

function formatTimestamp(ts: number, range: TimeRange): string {
  const date = new Date(ts * 1000);
  if (range === "7d") {
    return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function seriesLabel(metric: Record<string, string>): string {
  return metric.container || metric.instance || "total";
}

interface DataPoint {
  timestamp: number;
  [key: string]: number;
}

function buildChartData(series: PrometheusSeries[]): {
  data: DataPoint[];
  keys: string[];
} {
  if (series.length === 0) return { data: [], keys: [] };

  const keys = series.map((s) => seriesLabel(s.metric));
  const timestampMap = new Map<number, DataPoint>();

  for (const s of series) {
    const key = seriesLabel(s.metric);
    for (const dp of s.dataPoints) {
      let point = timestampMap.get(dp.timestamp);
      if (!point) {
        point = { timestamp: dp.timestamp };
        timestampMap.set(dp.timestamp, point);
      }
      point[key] = dp.value;
    }
  }

  const data = Array.from(timestampMap.values()).sort(
    (a, b) => a.timestamp - b.timestamp
  );

  return { data, keys };
}

export function HistoricalMetricsChart({
  cpuSeries,
  memorySeries,
  timeRange,
  onTimeRangeChange,
  isLoading,
  error,
  queries,
}: HistoricalMetricsChartProps) {
  const cpuChart = useMemo(() => buildChartData(cpuSeries), [cpuSeries]);
  const memChart = useMemo(() => buildChartData(memorySeries), [memorySeries]);

  const tooltipStyle = {
    backgroundColor: "oklch(0.178 0 0)",
    border: "1px solid oklch(0.3 0 0)",
    color: "oklch(0.985 0 0)",
    borderRadius: "6px",
    fontSize: "12px",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Historical Metrics
        </h3>
        <div className="flex gap-1">
          {TIME_RANGES.map((r) => (
            <Button
              key={r.value}
              variant={timeRange === r.value ? "default" : "outline"}
              size="sm"
              className="h-7 px-2.5 text-xs"
              onClick={() => onTimeRangeChange(r.value)}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      )}

      {error && (
        <div className="text-center py-8 text-sm text-destructive">{error}</div>
      )}

      {!isLoading && !error && cpuChart.data.length === 0 && memChart.data.length === 0 && (
        <div className="py-6 space-y-3">
          <p className="text-center text-sm text-muted-foreground">
            No historical data available for this time range.
          </p>
          {queries && queries.length > 0 && (
            <details className="text-xs text-muted-foreground border rounded-md p-3">
              <summary className="cursor-pointer font-medium">
                PromQL queries sent (test these in Grafana Explore)
              </summary>
              <div className="mt-2 space-y-1.5">
                {queries.map((q, i) => (
                  <pre
                    key={i}
                    className="bg-muted rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all font-mono"
                  >
                    {q}
                  </pre>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {!isLoading && !error && (cpuChart.data.length > 0 || memChart.data.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">CPU Usage (Historical)</CardTitle>
            </CardHeader>
            <CardContent>
              {cpuChart.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={cpuChart.data}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.3 0 0)"
                    />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(v: number) =>
                        formatTimestamp(v, timeRange)
                      }
                      tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatCpu(v)}
                      tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                      width={60}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(v: unknown) =>
                        new Date((v as number) * 1000).toLocaleString()
                      }
                      formatter={(value: number | undefined) => [value != null ? formatCpu(value) : "-", "CPU"]}
                    />
                    {cpuChart.keys.length > 1 && <Legend />}
                    {cpuChart.keys.map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  No CPU data
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Memory Usage (Historical)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {memChart.data.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={memChart.data}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="oklch(0.3 0 0)"
                    />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(v: number) =>
                        formatTimestamp(v, timeRange)
                      }
                      tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tickFormatter={(v: number) => formatBytes(v)}
                      tick={{ fontSize: 11, fill: "oklch(0.708 0 0)" }}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(v: unknown) =>
                        new Date((v as number) * 1000).toLocaleString()
                      }
                      formatter={(value: number | undefined) => [
                        value != null ? formatBytes(value) : "-",
                        "Memory",
                      ]}
                    />
                    {memChart.keys.length > 1 && <Legend />}
                    {memChart.keys.map((key, i) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-sm text-muted-foreground">
                  No memory data
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
