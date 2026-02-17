"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePortForwards, useStopPortForward } from "@/hooks/use-port-forward";
import { Cable, ExternalLink, Square } from "lucide-react";

export function PortForwardIndicator({ contextName }: { contextName: string }) {
  const { data: forwards } = usePortForwards(contextName);
  const stopMutation = useStopPortForward(contextName);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const count = forwards?.length || 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  if (count === 0) return null;

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setOpen(!open)}
      >
        <Cable className="h-3.5 w-3.5" />
        <Badge variant="secondary" className="h-5 min-w-5 px-1 text-xs">
          {count}
        </Badge>
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-md border bg-card shadow-lg z-50">
          <div className="p-3 border-b">
            <h3 className="font-medium text-sm">Active Port Forwards</h3>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {forwards?.map((f) => (
              <div key={f.id} className="flex items-center justify-between p-3 border-b last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground truncate">
                    {f.resourceType}/{f.resourceName}
                  </div>
                  <div className="font-mono text-sm">
                    :{f.localPort} → :{f.remotePort}
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <a
                    href={`http://localhost:${f.localPort}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => stopMutation.mutate(f.id)}
                    disabled={stopMutation.isPending}
                    className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-destructive/10 text-destructive"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
