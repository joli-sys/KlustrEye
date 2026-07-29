

import { useUIStore } from "@/lib/stores/ui-store";
import { Sidebar } from "@/components/sidebar";
import type { Workspace } from "@/hooks/use-workspaces";

export function MobileSidebarDrawer({ workspace, contextName }: { workspace: Workspace; contextName?: string }) {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();

  if (!mobileSidebarOpen) return null;

  return (
    <div className="md:hidden fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setMobileSidebarOpen(false)}
      />
      {/* Sidebar panel — rail (w-12) + view panel (w-56). `forceExpanded`
          keeps the panel open, so the drawer is never just a bare rail. */}
      <div className="fixed inset-y-0 left-0 z-50 w-[17rem]">
        <Sidebar
          workspace={workspace}
          contextName={contextName}
          onNavigate={() => setMobileSidebarOpen(false)}
          forceExpanded
        />
      </div>
    </div>
  );
}
