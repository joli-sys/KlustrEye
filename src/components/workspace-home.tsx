import { Link } from "react-router-dom";
import { FolderOpen, Server, ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { KlustrEyeLogo } from "@/components/klustreye-logo";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { useWorkspace } from "@/hooks/use-workspaces";
import { clusterPath } from "@/lib/paths";

/**
 * Index route for `/w/:wsId`. Without it a folder-only workspace (a supported
 * binding combination) renders an empty <Outlet /> — no header, no way home.
 *
 * Shows the workspace name, its bindings, and what each surface currently
 * offers. Keep the copy here in step with what has actually shipped — it was
 * written in P0 saying "file browsing arrives in P1", and stayed that way
 * after P1 landed the file tree, which read as a missing feature to anyone
 * opening a folder-bound workspace.
 */
export function WorkspaceHome() {
  const wsId = useWorkspaceId();
  // Cache-hot: WorkspaceLayout (parent route) already fetched and gated on it.
  const { data: workspace } = useWorkspace(wsId);

  if (!workspace) return null;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl p-8">
        <div className="mb-6 flex items-center justify-between">
          <KlustrEyeLogo size="sm" />
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            All workspaces
          </Link>
        </div>

        <h1 className="text-2xl font-semibold">{workspace.name}</h1>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {workspace.folderPath && (
            <Badge variant={workspace.folderExists ? "secondary" : "warning"}>
              <FolderOpen className="h-3 w-3 mr-1" />
              <span className="truncate max-w-80">{workspace.folderPath}</span>
            </Badge>
          )}
          {workspace.contextName && (
            <Badge variant={workspace.contextExists ? "secondary" : "warning"}>
              <Server className="h-3 w-3 mr-1" />
              {workspace.contextName}
            </Badge>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium mb-1">Files</div>
              {!workspace.folderPath ? (
                <p className="text-sm text-muted-foreground">
                  No folder bound. Edit this workspace to add one.
                </p>
              ) : !workspace.folderExists ? (
                <p className="text-sm text-muted-foreground">
                  Folder not found: {workspace.folderPath}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a file from the sidebar to start editing, or search it
                  with Find in Files.
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-sm font-medium mb-1">Terminals &amp; Agents</div>
              <p className="text-sm text-muted-foreground">
                Agent sessions arrive in P3.
              </p>
            </CardContent>
          </Card>
        </div>

        {workspace.contextName && (
          <Link
            to={clusterPath(workspace.id, workspace.contextName, "overview")}
            className="mt-6 inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Server className="h-3.5 w-3.5" />
            Open {workspace.contextName}
          </Link>
        )}
      </div>
    </div>
  );
}
