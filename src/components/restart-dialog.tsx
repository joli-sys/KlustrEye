"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { usePatchResource } from "@/hooks/use-resources";
import type { ResourceKind } from "@/lib/constants";

interface RestartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
}

export function RestartDialog({
  open,
  onOpenChange,
  contextName,
  kind,
  name,
  namespace,
}: RestartDialogProps) {
  const patchMutation = usePatchResource(contextName, kind);
  const { addToast } = useToast();

  const handleRestart = async () => {
    try {
      await patchMutation.mutateAsync({
        name,
        namespace,
        patch: {
          spec: {
            template: {
              metadata: {
                annotations: {
                  "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
                },
              },
            },
          },
        },
      });
      addToast({
        title: "Restart initiated",
        description: `${name} is restarting. Pods will be recreated.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Restart failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Restart {name}</DialogTitle>
          <DialogDescription>
            This will trigger a rolling restart. All pods will be recreated gradually.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleRestart} disabled={patchMutation.isPending}>
            {patchMutation.isPending ? "Restarting..." : "Restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
