"use client";

import { useState } from "react";
import type { PluginResourceExtensionProps } from "@/lib/plugins/types";
import { useGrafanaConfig, usePodHistoricalMetrics, useNodeHistoricalMetrics } from "./hooks";
import { HistoricalMetricsChart } from "./components";
import type { TimeRange } from "./queries";

export function GrafanaPodExtension({ contextName, name, namespace }: PluginResourceExtensionProps) {
  const { data: grafanaConfig } = useGrafanaConfig(contextName);
  const grafanaConfigured = !!grafanaConfig?.hasToken;
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const { data: historicalData, isLoading, error } =
    usePodHistoricalMetrics(contextName, name, namespace ?? "default", timeRange, grafanaConfigured);

  if (!grafanaConfigured) return null;

  return (
    <HistoricalMetricsChart
      cpuSeries={historicalData?.cpu ?? []}
      memorySeries={historicalData?.memory ?? []}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
      isLoading={isLoading}
      error={error?.message}
      queries={historicalData?.queries}
    />
  );
}

export function GrafanaNodeExtension({ contextName, name }: PluginResourceExtensionProps) {
  const { data: grafanaConfig } = useGrafanaConfig(contextName);
  const grafanaConfigured = !!grafanaConfig?.hasToken;
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const { data: historicalData, isLoading, error } =
    useNodeHistoricalMetrics(contextName, name, timeRange, grafanaConfigured);

  if (!grafanaConfigured) return null;

  return (
    <HistoricalMetricsChart
      cpuSeries={historicalData?.cpu ?? []}
      memorySeries={historicalData?.memory ?? []}
      timeRange={timeRange}
      onTimeRangeChange={setTimeRange}
      isLoading={isLoading}
      error={error?.message}
      queries={historicalData?.queries}
    />
  );
}
