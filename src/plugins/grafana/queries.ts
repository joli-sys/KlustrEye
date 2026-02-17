export type TimeRange = "1h" | "6h" | "24h" | "7d";

interface TimeRangeParams {
  start: number;
  end: number;
  step: number;
}

const STEP_MAP: Record<TimeRange, number> = {
  "1h": 15,
  "6h": 60,
  "24h": 300,
  "7d": 1800,
};

const DURATION_SECONDS: Record<TimeRange, number> = {
  "1h": 3600,
  "6h": 21600,
  "24h": 86400,
  "7d": 604800,
};

export function getTimeRangeParams(range: TimeRange): TimeRangeParams {
  const end = Math.floor(Date.now() / 1000);
  const start = end - DURATION_SECONDS[range];
  return { start, end, step: STEP_MAP[range] };
}

export function podCpuQuery(pod: string, namespace: string): string {
  return `sum(rate(container_cpu_usage_seconds_total{pod="${pod}",namespace="${namespace}",container!="POD",container!=""}[5m])) by (container)`;
}

export function podMemoryQuery(pod: string, namespace: string): string {
  return `sum(container_memory_working_set_bytes{pod="${pod}",namespace="${namespace}",container!="POD",container!=""}) by (container)`;
}

export function nodeCpuQuery(node: string): string {
  return `1 - avg(rate(node_cpu_seconds_total{mode="idle",instance=~"${node}.*"}[5m]))`;
}

export function nodeMemoryQuery(node: string): string {
  return `node_memory_MemTotal_bytes{instance=~"${node}.*"} - node_memory_MemAvailable_bytes{instance=~"${node}.*"}`;
}
