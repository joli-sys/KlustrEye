

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { usePatchResource } from "@/hooks/use-resources";
import type { ResourceKind } from "@/lib/constants";
import { Info } from "lucide-react";

interface ContainerResources {
  name: string;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

interface EditResourcesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
  containers: Record<string, unknown>[];
  readOnly?: boolean;
}

function parseContainerResources(containers: Record<string, unknown>[]): ContainerResources[] {
  return containers.map((c) => {
    const resources = c.resources as Record<string, unknown> | undefined;
    const requests = (resources?.requests as Record<string, string>) || {};
    const limits = (resources?.limits as Record<string, string>) || {};
    return {
      name: c.name as string,
      cpuRequest: requests.cpu || "",
      cpuLimit: limits.cpu || "",
      memoryRequest: requests.memory || "",
      memoryLimit: limits.memory || "",
    };
  });
}

export function EditResourcesDialog({
  open,
  onOpenChange,
  contextName,
  kind,
  name,
  namespace,
  containers,
  readOnly = false,
}: EditResourcesDialogProps) {
  const [resources, setResources] = useState<ContainerResources[]>([]);
  const patchMutation = usePatchResource(contextName, kind);
  const { addToast } = useToast();

  useEffect(() => {
    if (open) {
      setResources(parseContainerResources(containers));
    }
  }, [open, containers]);

  const updateField = (index: number, field: keyof ContainerResources, value: string) => {
    setResources((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    const containerPatches = resources.map((r) => {
      const requests: Record<string, string> = {};
      const limits: Record<string, string> = {};
      if (r.cpuRequest) requests.cpu = r.cpuRequest;
      if (r.memoryRequest) requests.memory = r.memoryRequest;
      if (r.cpuLimit) limits.cpu = r.cpuLimit;
      if (r.memoryLimit) limits.memory = r.memoryLimit;

      return {
        name: r.name,
        resources: {
          ...(Object.keys(requests).length > 0 ? { requests } : {}),
          ...(Object.keys(limits).length > 0 ? { limits } : {}),
        },
      };
    });

    const patch = {
      spec: {
        template: {
          spec: {
            containers: containerPatches,
          },
        },
      },
    };

    try {
      await patchMutation.mutateAsync({ name, namespace, patch });
      addToast({
        title: "Resources updated",
        description: `Container resources for ${name} have been updated`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Update failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Container Resources — {name}</DialogTitle>
          {readOnly && (
            <DialogDescription className="flex items-start gap-2 mt-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5 text-blue-400" />
              Pod resources are immutable. Edit the parent Deployment or ReplicaSet instead.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-6">
          {resources.map((r, i) => (
            <div key={r.name} className="space-y-3 rounded-lg border p-4">
              <h4 className="text-sm font-medium">{r.name}</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">CPU Request</span>
                  <Input
                    value={r.cpuRequest}
                    onChange={(e) => updateField(i, "cpuRequest", e.target.value)}
                    placeholder="e.g. 100m"
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">CPU Limit</span>
                  <Input
                    value={r.cpuLimit}
                    onChange={(e) => updateField(i, "cpuLimit", e.target.value)}
                    placeholder="e.g. 500m"
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Memory Request</span>
                  <Input
                    value={r.memoryRequest}
                    onChange={(e) => updateField(i, "memoryRequest", e.target.value)}
                    placeholder="e.g. 128Mi"
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Memory Limit</span>
                  <Input
                    value={r.memoryLimit}
                    onChange={(e) => updateField(i, "memoryLimit", e.target.value)}
                    placeholder="e.g. 512Mi"
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {readOnly ? "Close" : "Cancel"}
          </Button>
          {!readOnly && (
            <Button onClick={handleSave} disabled={patchMutation.isPending}>
              {patchMutation.isPending ? "Saving..." : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
