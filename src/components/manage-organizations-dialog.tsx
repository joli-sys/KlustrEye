"use client";

import { useState } from "react";
import {
  useOrganizations,
  useCreateOrganization,
  useDeleteOrganization,
} from "@/hooks/use-organizations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface ManageOrganizationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageOrganizationsDialog({
  open,
  onOpenChange,
}: ManageOrganizationsDialogProps) {
  const [name, setName] = useState("");
  const { data: orgs } = useOrganizations();
  const createOrg = useCreateOrganization();
  const deleteOrg = useDeleteOrganization();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createOrg.mutate(trimmed, { onSuccess: () => setName("") });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Manage Organizations</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleAdd} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New organization name"
            autoFocus
          />
          <Button type="submit" disabled={createOrg.isPending || !name.trim()}>
            Add
          </Button>
        </form>
        <div className="space-y-1 mt-2">
          {orgs?.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              No organizations yet
            </p>
          )}
          {orgs?.map((org) => (
            <div
              key={org.id}
              className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-accent/50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{org.name}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {org._count.clusters} cluster{org._count.clusters !== 1 ? "s" : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteOrg.mutate(org.id)}
                disabled={deleteOrg.isPending}
                className="h-7 w-7 p-0 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
