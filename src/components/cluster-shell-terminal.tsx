"use client";

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCw, X, Maximize2, Minimize2 } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";

const TerminalComponent = dynamic(
  () => import("./terminal-inner").then((m) => m.TerminalInner),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> }
);

interface ClusterShellTerminalProps {
  contextName: string;
}

export function ClusterShellTerminal({ contextName }: ClusterShellTerminalProps) {
  const { shellTerminalOpen, shellTerminalHeight, setShellTerminalOpen, setShellTerminalHeight } =
    useUIStore();
  const [key, setKey] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: shellTerminalHeight };

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - ev.clientY;
        const newHeight = Math.min(
          Math.max(dragRef.current.startHeight + delta, 120),
          window.innerHeight * 0.8
        );
        setShellTerminalHeight(newHeight);
      };

      const onMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [shellTerminalHeight, setShellTerminalHeight]
  );

  if (!shellTerminalOpen) return null;

  const wsUrl =
    typeof window !== "undefined"
      ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/shell/${encodeURIComponent(contextName)}`
      : "";

  const height = maximized ? "70vh" : `${shellTerminalHeight}px`;

  return (
    <div className="flex flex-col border-t bg-black" style={{ height, minHeight: 120 }}>
      {/* Drag handle */}
      <div
        className="h-1 cursor-row-resize bg-border hover:bg-primary/50 transition-colors shrink-0"
        onMouseDown={handleMouseDown}
      />
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-card border-b shrink-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Terminal</span>
          <span>&mdash;</span>
          <span>{contextName}</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setKey((k) => k + 1)}
            title="Reconnect"
          >
            <RotateCw className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setMaximized((m) => !m)}
            title={maximized ? "Restore" : "Maximize"}
          >
            {maximized ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setShellTerminalOpen(false)}
            title="Close"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>
      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        {wsUrl && (
          <TerminalComponent
            key={`${contextName}-${key}`}
            wsUrl={wsUrl}
            className="h-full"
            connectMessage=""
          />
        )}
      </div>
    </div>
  );
}
