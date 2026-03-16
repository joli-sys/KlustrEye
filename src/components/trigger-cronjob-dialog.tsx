

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useTriggerCronJob } from "@/hooks/use-resources";

interface TriggerCronJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  name: string;
  namespace: string;
}

export function TriggerCronJobDialog({
  open,
  onOpenChange,
  contextName,
  name,
  namespace,
}: TriggerCronJobDialogProps) {
  const triggerMutation = useTriggerCronJob(contextName);
  const { addToast } = useToast();

  const handleTrigger = async () => {
    try {
      const result = await triggerMutation.mutateAsync({ name, namespace });
      addToast({
        title: "CronJob triggered",
        description: `Created job: ${result.jobName}`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Trigger failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Trigger CronJob</DialogTitle>
          <DialogDescription>
            This will create a new Job from the CronJob template immediately.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          CronJob: <span className="font-medium">{name}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Namespace: {namespace}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTrigger} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending ? "Triggering..." : "Trigger Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
