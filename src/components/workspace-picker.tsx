import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Pencil, Trash2, FolderOpen, Server, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useWorkspaces, useDeleteWorkspace, type Workspace } from "@/hooks/use-workspaces";
import { workspacePath, clusterPath } from "@/lib/paths";
import { WorkspaceDialog } from "@/components/workspace-dialog";

export function WorkspacePicker() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const [dialogWorkspace, setDialogWorkspace] = useState<Workspace | null | undefined>(undefined);
  const deleteWorkspace = useDeleteWorkspace();
  const confirm = useConfirm();
  const { addToast } = useToast();

  async function handleDelete(ws: Workspace) {
    const confirmed = await confirm({
      title: `Delete workspace "${ws.name}"?`,
      description: "This removes the workspace only — the folder on disk is not deleted.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;

    deleteWorkspace.mutate(ws.id, {
      onError: (err) => {
        addToast({
          title: "Failed to delete workspace",
          description: (err as Error).message,
          variant: "destructive",
        });
      },
    });
  }

  const hasWorkspaces = !isLoading && workspaces && workspaces.length > 0;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Workspaces</h2>
        <Button size="sm" onClick={() => setDialogWorkspace(null)}>
          <Plus className="h-4 w-4" />
          New workspace
        </Button>
      </div>

      {!isLoading && !hasWorkspaces && (
        <p className="text-sm text-muted-foreground">
          No workspaces yet. Create one to pin a project folder and cluster together.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {hasWorkspaces && workspaces?.map((ws) => {
          const href = ws.contextName
            ? clusterPath(ws.id, ws.contextName, "overview")
            : workspacePath(ws.id);

          return (
            <div key={ws.id} className="relative group">
              <Link to={href}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                  <CardContent className="pt-6">
                    <h3 className="font-semibold truncate pr-14">{ws.name}</h3>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {ws.folderPath && (
                        <Badge variant={ws.folderExists ? "secondary" : "warning"}>
                          <FolderOpen className="h-3 w-3 mr-1" />
                          <span className="truncate max-w-40">{ws.folderPath}</span>
                        </Badge>
                      )}
                      {ws.contextName && (
                        <Badge variant={ws.contextExists ? "secondary" : "warning"}>
                          <Server className="h-3 w-3 mr-1" />
                          {ws.contextName}
                        </Badge>
                      )}
                      {(!ws.folderExists && ws.folderPath) || (!ws.contextExists && ws.contextName) ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          needs attention
                        </Badge>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <div className="absolute top-4 right-4 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setDialogWorkspace(ws);
                  }}
                  className="p-1.5 rounded hover:bg-accent"
                  title="Edit workspace"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete(ws);
                  }}
                  className="p-1.5 rounded hover:bg-accent"
                  title="Delete workspace"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {dialogWorkspace !== undefined && (
        <WorkspaceDialog
          workspace={dialogWorkspace}
          open
          onOpenChange={(open) => !open && setDialogWorkspace(undefined)}
        />
      )}
    </div>
  );
}
