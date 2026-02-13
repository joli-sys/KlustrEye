"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCw } from "lucide-react";

interface TerminalPanelProps {
  contextName: string;
  namespace: string;
  podName: string;
  containers: string[];
}

// Load xterm dynamically (no SSR)
const TerminalComponent = dynamic(() => import("./terminal-inner").then((m) => m.TerminalInner), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full" />,
});

export function TerminalPanel({ contextName, namespace, podName, containers }: TerminalPanelProps) {
  const [container, setContainer] = useState(containers[0] || "");
  const [key, setKey] = useState(0); // Force remount on reconnect

  const wsUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/terminal/${encodeURIComponent(contextName)}/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/${encodeURIComponent(container)}`
      : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {containers.length > 1 && (
          <Select
            value={container}
            onChange={(e) => {
              setContainer(e.target.value);
              setKey((k) => k + 1);
            }}
            options={containers.map((c) => ({ value: c, label: c }))}
            className="w-40"
          />
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setKey((k) => k + 1)}
          className="gap-1"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Reconnect
        </Button>
      </div>
      <div className="border rounded-md overflow-hidden bg-black">
        {wsUrl && <TerminalComponent key={key} wsUrl={wsUrl} />}
      </div>
    </div>
  );
}
