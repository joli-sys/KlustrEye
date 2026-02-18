"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface UsePodLogsOptions {
  contextName: string;
  namespace: string;
  podName: string;
  container?: string;
  follow?: boolean;
  tailLines?: number;
  previous?: boolean;
}

export function usePodLogs({
  contextName,
  namespace,
  podName,
  container,
  follow = false,
  tailLines = 200,
  previous = false,
}: UsePodLogsOptions) {
  const [logs, setLogs] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchLogs = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);
    setLogs("");

    const params = new URLSearchParams({
      namespace,
      follow: String(follow),
      tailLines: String(tailLines),
      previous: String(previous),
    });
    if (container) params.set("container", container);

    const url = `/api/clusters/${encodeURIComponent(contextName)}/pods/${encodeURIComponent(podName)}/logs?${params}`;

    try {
      if (!follow) {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error("Failed to fetch logs");
        const text = await res.text();
        setLogs(text);
        setIsLoading(false);
        return;
      }

      // Streaming mode — read SSE chunks and append lines
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error("Failed to connect to log stream");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No readable stream");

      const decoder = new TextDecoder();
      setIsLoading(false);
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (part.startsWith("data: ")) {
            try {
              const data = JSON.parse(part.slice(6));
              if (data.line) {
                setLogs((prev) => prev + data.line);
              }
              if (data.error) setError(data.error);
            } catch {
              // ignore parse errors
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
        setIsLoading(false);
      }
    }
  }, [contextName, namespace, podName, container, follow, tailLines, previous]);

  useEffect(() => {
    fetchLogs();
    return () => abortRef.current?.abort();
  }, [fetchLogs]);

  return { logs, isLoading, error, refetch: fetchLogs };
}
