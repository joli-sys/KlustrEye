"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStartPortForward } from "@/hooks/use-port-forward";
import { useToast } from "@/components/ui/toast";

interface PortForwardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  namespace: string;
  resourceType: string;
  resourceName: string;
  remotePort: number;
}

export function PortForwardDialog({
  open,
  onOpenChange,
  contextName,
  namespace,
  resourceType,
  resourceName,
  remotePort,
}: PortForwardDialogProps) {
  const [localPort, setLocalPort] = useState(String(remotePort));
  const startMutation = useStartPortForward(contextName);
  const { addToast } = useToast();

  const handleStart = async () => {
    const port = parseInt(localPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      addToast({ title: "Invalid port", description: "Port must be between 1 and 65535", variant: "destructive" });
      return;
    }

    try {
      await startMutation.mutateAsync({
        namespace,
        resourceType,
        resourceName,
        localPort: port,
        remotePort,
      });
      addToast({
        title: "Port forward started",
        description: `localhost:${port} → ${resourceName}:${remotePort}`,
        variant: "success",
      });
      onOpenChange(false);
      window.open(`http://localhost:${port}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      addToast({
        title: "Port forward failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Port Forward</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Forward from <span className="font-mono font-medium text-foreground">{resourceType}/{resourceName}:{remotePort}</span>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Local Port</label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={localPort}
              onChange={(e) => setLocalPort(e.target.value)}
              placeholder="Local port"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={startMutation.isPending}>
            {startMutation.isPending ? "Starting..." : "Start"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
