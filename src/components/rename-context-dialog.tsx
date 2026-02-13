"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useOrganizations, useAssignClusterOrganization } from "@/hooks/use-organizations";

interface RenameContextDialogProps {
  contextName: string;
  currentDisplayName: string | null;
  currentOrganizationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RenameContextDialog({
  contextName,
  currentDisplayName,
  currentOrganizationId,
  open,
  onOpenChange,
}: RenameContextDialogProps) {
  const [displayName, setDisplayName] = useState(currentDisplayName || "");
  const [orgId, setOrgId] = useState(currentOrganizationId || "");
  const queryClient = useQueryClient();
  const { data: orgs } = useOrganizations();
  const assignOrg = useAssignClusterOrganization();

  const rename = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(contextName)}/rename`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: name }),
        }
      );
      if (!res.ok) throw new Error("Rename failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clusters"] });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newOrgId = orgId || null;
    const orgChanged = newOrgId !== (currentOrganizationId || null);

    rename.mutate(displayName.trim(), {
      onSuccess: () => {
        if (orgChanged) {
          assignOrg.mutate(
            { contextName, organizationId: newOrgId },
            { onSuccess: () => onOpenChange(false) }
          );
        } else {
          onOpenChange(false);
        }
      },
    });
  }

  const orgOptions = [
    { value: "", label: "None" },
    ...(orgs?.map((o) => ({ value: o.id, label: o.name })) ?? []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Edit Cluster</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                Context: {contextName}
              </label>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">
                Organization
              </label>
              <Select
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                options={orgOptions}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={rename.isPending || assignOrg.isPending}>
              {rename.isPending || assignOrg.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
