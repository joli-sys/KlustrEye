"use client";

import { NamespaceSelector } from "@/components/namespace-selector";
import { PortForwardIndicator } from "@/components/port-forward-indicator";
import { useClusters } from "@/hooks/use-clusters";
import { Button } from "@/components/ui/button";
import { Search, Menu, Terminal } from "lucide-react";
import { useUIStore } from "@/lib/stores/ui-store";

export function Header({ contextName }: { contextName: string }) {
  const { setCommandPaletteOpen, setMobileSidebarOpen, toggleShellTerminal, shellTerminalOpen } = useUIStore();
  const { data: clusters } = useClusters();
  const current = clusters?.find((c) => c.name === contextName);
  const displayName = current?.displayName;

  return (
    <header className="drag-region flex items-center justify-between px-4 border-b h-14 bg-card">
      <div className="no-drag-region flex items-center gap-2 md:gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden shrink-0"
          onClick={() => setMobileSidebarOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <div className="min-w-0">
          <h2 className="font-semibold text-sm truncate">{displayName || contextName}</h2>
          {displayName && (
            <p className="text-xs text-muted-foreground truncate">{contextName}</p>
          )}
        </div>
        <NamespaceSelector contextName={contextName} />
      </div>
      <div className="no-drag-region flex items-center gap-2">
        <PortForwardIndicator contextName={contextName} />
        <Button
          variant={shellTerminalOpen ? "secondary" : "outline"}
          size="sm"
          className="gap-1.5 text-muted-foreground"
          onClick={toggleShellTerminal}
          title="Toggle terminal (⌘T)"
        >
          <Terminal className="h-3.5 w-3.5" />
          <kbd className="pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>T
          </kbd>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 text-muted-foreground"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs hidden sm:inline">Search...</span>
          <kbd className="ml-2 pointer-events-none hidden sm:inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
      </div>
    </header>
  );
}
