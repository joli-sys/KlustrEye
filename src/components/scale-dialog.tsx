

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { usePatchResource } from "@/hooks/use-resources";
import type { ResourceKind } from "@/lib/constants";
import { Minus, Plus } from "lucide-react";

interface ScaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  currentReplicas: number;
}

export function ScaleDialog({
  open,
  onOpenChange,
  contextName,
  kind,
  name,
  namespace,
  currentReplicas,
}: ScaleDialogProps) {
  const [replicas, setReplicas] = useState(currentReplicas);
  const patchMutation = usePatchResource(contextName, kind);
  const { addToast } = useToast();

  // Reset when dialog opens with new value
  const handleOpenChange = (value: boolean) => {
    if (value) setReplicas(currentReplicas);
    onOpenChange(value);
  };

  const handleScale = async () => {
    try {
      await patchMutation.mutateAsync({
        name,
        namespace,
        patch: { spec: { replicas } },
      });
      addToast({
        title: "Scaled successfully",
        description: `${name} scaled to ${replicas} replica${replicas !== 1 ? "s" : ""}`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Scale failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onClose={() => handleOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Scale {name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Current replicas: <span className="font-medium text-foreground">{currentReplicas}</span>
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setReplicas((r) => Math.max(0, r - 1))}
              disabled={replicas <= 0}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              min={0}
              value={replicas}
              onChange={(e) => setReplicas(Math.max(0, parseInt(e.target.value) || 0))}
              className="w-24 text-center"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setReplicas((r) => r + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {replicas === 0 && (
            <p className="text-sm text-yellow-500">
              Setting replicas to 0 will stop all pods.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleScale}
            disabled={replicas === currentReplicas || patchMutation.isPending}
          >
            {patchMutation.isPending ? "Scaling..." : "Scale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
