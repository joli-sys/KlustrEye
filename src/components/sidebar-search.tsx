import { FindInFiles } from "@/components/find-in-files";
import type { Workspace } from "@/hooks/use-workspaces";

/** Search needs a folder on disk to walk, so a broken binding gets the same
 *  note the Explorer shows rather than a search box that can only ever fail. */
export function SidebarSearch({
  workspace,
  wsId,
}: {
  workspace: Workspace;
  wsId: string;
}) {
  if (!workspace.folderExists) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">Folder not found.</p>
    );
  }
  return <FindInFiles wsId={wsId} />;
}
