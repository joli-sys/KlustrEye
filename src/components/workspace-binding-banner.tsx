import { Workspace } from "@/hooks/use-workspaces";
import { missingClusters, workspaceHasNoBindings } from "@/lib/workspace-clusters";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

interface Props {
  workspace: Workspace;
  mode: "banner" | "repair";
  onRebind?: () => void;
}

export function WorkspaceBindingBanner({ workspace, mode, onRebind }: Props) {
  const folderBroken = !!workspace.folderPath && !workspace.folderExists;
  // Which bindings are gone, not merely that some are: with several clusters
  // bound, "a cluster is missing" leaves the user guessing which one to fix.
  const missing = missingClusters(workspace.clusters);
  const nothingBound = workspaceHasNoBindings(workspace);

  const messages: string[] = [];
  if (folderBroken) messages.push(`Folder not found: ${workspace.folderPath}`);
  if (missing.length === 1) {
    messages.push(
      `Cluster context "${missing[0].contextName}" is not in the current kubeconfig.`
    );
  } else if (missing.length > 1) {
    messages.push(
      `${missing.length} cluster contexts are not in the current kubeconfig: ` +
        `${missing.map((c) => c.contextName).join(", ")}.`
    );
  }
  if (nothingBound) messages.push("This workspace has no folder and no cluster bound.");

  if (mode === "banner") {
    return (
      <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm">
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1">{messages.join(" ")}</span>
        {onRebind && (
          <Button variant="outline" size="sm" onClick={onRebind}>
            Rebind
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div>
        <h2 className="text-lg font-medium">{workspace.name} needs attention</h2>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>
      {onRebind && <Button onClick={onRebind}>Rebind workspace</Button>}
    </div>
  );
}
