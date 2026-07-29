import { FileTree } from "@/components/file-tree";
import type { Workspace } from "@/hooks/use-workspaces";

/**
 * Only mounted when `workspace.folderPath` is set (the rail hides the Explorer
 * icon otherwise), but the folder can still be *missing* — a bound path whose
 * directory was moved or deleted. That degraded case gets a line of text
 * rather than a tree that would render as a permanent error row.
 */
export function SidebarExplorer({ workspace }: { workspace: Workspace }) {
  if (!workspace.folderExists) {
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">Folder not found.</p>
    );
  }
  return <FileTree />;
}
