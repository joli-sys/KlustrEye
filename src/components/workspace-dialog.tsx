import { useEffect, useState } from "react";
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
import { useToast } from "@/components/ui/toast";
import { useClusters } from "@/hooks/use-clusters";
import {
  useCreateWorkspace,
  useUpdateWorkspace,
  type Workspace,
} from "@/hooks/use-workspaces";
import { FolderOpen } from "lucide-react";

interface WorkspaceDialogProps {
  workspace?: Workspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Tauri injects __TAURI_INTERNALS__; in browser dev mode there is no
// native picker, so the user types a path instead.
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function pickFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

export function WorkspaceDialog({ workspace, open, onOpenChange }: WorkspaceDialogProps) {
  const isEdit = !!workspace;
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [contextName, setContextName] = useState("");
  const { data: clusters } = useClusters();
  const { addToast } = useToast();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace();
  const isPending = createWorkspace.isPending || updateWorkspace.isPending;

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setFolderPath(workspace?.folderPath ?? "");
      setContextName(workspace?.contextName ?? "");
    }
  }, [open, workspace]);

  async function handleBrowse() {
    const selected = await pickFolder();
    if (selected) setFolderPath(selected);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const input = {
      name: trimmedName,
      folderPath: folderPath.trim() || null,
      contextName: contextName || null,
    };

    const onError = (err: unknown) => {
      addToast({
        title: isEdit ? "Failed to update workspace" : "Failed to create workspace",
        description: (err as Error).message,
        variant: "destructive",
      });
    };

    if (isEdit) {
      updateWorkspace.mutate(
        { id: workspace.id, ...input },
        {
          onSuccess: () => onOpenChange(false),
          onError,
        }
      );
    } else {
      createWorkspace.mutate(input, {
        onSuccess: () => onOpenChange(false),
        onError,
      });
    }
  }

  const clusterOptions = [
    { value: "", label: "None" },
    ...(clusters?.map((c) => ({ value: c.name, label: c.displayName || c.name })) ?? []),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Workspace" : "New Workspace"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Workspace name"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Folder</label>
              <div className="flex gap-2">
                <Input
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/path/to/folder"
                />
                {isTauri() && (
                  <Button type="button" variant="outline" onClick={handleBrowse}>
                    <FolderOpen className="h-4 w-4" />
                    Browse…
                  </Button>
                )}
              </div>
              {!isTauri() && (
                <p className="text-xs text-muted-foreground">Enter an absolute path</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm text-muted-foreground">Cluster</label>
              <Select
                value={contextName}
                onChange={(e) => setContextName(e.target.value)}
                options={clusterOptions}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
