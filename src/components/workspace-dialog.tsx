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
import { orderedClusters } from "@/lib/workspace-clusters";
// Shared with the agents sidebar's folder field — see `lib/folder-picker.ts`
// for why cancel and failure must stay distinguishable.
import { isTauri, pickFolder } from "@/lib/folder-picker";
import { FolderOpen, ChevronUp, ChevronDown, X, AlertCircle } from "lucide-react";

interface WorkspaceDialogProps {
  workspace?: Workspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WorkspaceDialog({ workspace, open, onOpenChange }: WorkspaceDialogProps) {
  const isEdit = !!workspace;
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  /**
   * Ordered — the index becomes each binding's `sortOrder`, and the first entry
   * is the cluster the workspace opens on. Held as plain context names rather
   * than as kubeconfig entries so a bound-but-missing context SURVIVES a save:
   * building the list from `useClusters()` would quietly drop it the moment
   * the user edited anything else.
   */
  const [contextNames, setContextNames] = useState<string[]>([]);
  const { data: clusters } = useClusters();
  const { addToast } = useToast();
  const createWorkspace = useCreateWorkspace();
  const updateWorkspace = useUpdateWorkspace();
  const isPending = createWorkspace.isPending || updateWorkspace.isPending;

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setFolderPath(workspace?.folderPath ?? "");
      setContextNames(orderedClusters(workspace?.clusters).map((c) => c.contextName));
    }
  }, [open, workspace]);

  async function handleBrowse() {
    try {
      const selected = await pickFolder();
      // null means the user cancelled — leave the field alone, say nothing.
      if (selected) setFolderPath(selected);
    } catch (e) {
      // Without this the rejection was unhandled and the button looked inert.
      // eslint-disable-next-line no-console
      console.error("Folder picker failed:", e);
      addToast({
        title: "Could not open the folder picker",
        description:
          (e as Error).message +
          " You can still type an absolute path into the field.",
        variant: "destructive",
      });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const input = {
      name: trimmedName,
      folderPath: folderPath.trim() || null,
      contextNames,
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

  const clusterLabel = (contextName: string) =>
    clusters?.find((c) => c.name === contextName)?.displayName || contextName;

  const isMissing = (contextName: string) =>
    !!clusters && !clusters.some((c) => c.name === contextName);

  const unselected = (clusters ?? []).filter((c) => !contextNames.includes(c.name));

  const addOptions = [
    {
      value: "",
      label: unselected.length ? "Add a cluster…" : "No other clusters in the kubeconfig",
    },
    ...unselected.map((c) => ({ value: c.name, label: c.displayName || c.name })),
  ];

  function addCluster(contextName: string) {
    if (!contextName) return;
    setContextNames((prev) => (prev.includes(contextName) ? prev : [...prev, contextName]));
  }

  function removeCluster(index: number) {
    setContextNames((prev) => prev.filter((_, i) => i !== index));
  }

  /** Swap with the neighbour; the ends simply have nowhere to go. */
  function moveCluster(index: number, delta: number) {
    setContextNames((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

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
              <label className="text-sm text-muted-foreground">Clusters</label>
              {contextNames.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No clusters bound. A workspace can hold any number, or none.
                </p>
              ) : (
                <ul className="rounded-md border divide-y">
                  {contextNames.map((ctx, index) => (
                    <li key={ctx} className="flex items-center gap-2 px-2 py-1.5">
                      <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {index + 1}.
                      </span>
                      <span className="flex-1 min-w-0 truncate text-sm">
                        {clusterLabel(ctx)}
                      </span>
                      {isMissing(ctx) && (
                        <span
                          className="flex items-center gap-1 shrink-0 text-[10px] uppercase text-yellow-600"
                          title="Not in the current kubeconfig. Kept so saving does not silently unbind it."
                        >
                          <AlertCircle className="h-3 w-3" />
                          missing
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => moveCluster(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveCluster(index, 1)}
                        disabled={index === contextNames.length - 1}
                        title="Move down"
                        className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeCluster(index)}
                        title="Remove"
                        className="p-1 rounded hover:bg-accent"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Select
                value=""
                disabled={unselected.length === 0}
                onChange={(e) => addCluster(e.target.value)}
                options={addOptions}
              />
              <p className="text-xs text-muted-foreground">
                The first cluster is the one the workspace opens on.
              </p>
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
