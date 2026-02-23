"use client";

import { NamespaceSelector } from "@/components/namespace-selector";
import { PortForwardIndicator } from "@/components/port-forward-indicator";
import { useClusters } from "@/hooks/use-clusters";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";

export function Header({ contextName }: { contextName: string }) {
  const { setCommandPaletteOpen } = useUIStore();
  const { data: clusters } = useClusters();
  const current = clusters?.find((c) => c.name === contextName);
  const displayName = current?.displayName;

  return (
    <header className="drag-region flex items-center justify-between px-4 border-b h-14 bg-card">
      <div className="no-drag-region flex items-center gap-4">
        <div>
          <h2 className="font-semibold text-sm">{displayName || contextName}</h2>
          {displayName && (
            <p className="text-xs text-muted-foreground">{contextName}</p>
          )}
        </div>
        <NamespaceSelector contextName={contextName} />
      </div>
      <div className="no-drag-region flex items-center gap-2">
        <PortForwardIndicator contextName={contextName} />
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Search...</span>
          <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
      </div>
    </header>
  );
}
