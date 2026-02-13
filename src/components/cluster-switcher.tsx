"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useClusters } from "@/hooks/use-clusters";
import { RenameContextDialog } from "@/components/rename-context-dialog";
import { cn } from "@/lib/utils";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";
import { Server, ChevronDown, Check, Pencil } from "lucide-react";
import type { ClusterContext } from "@/hooks/use-clusters";

interface ClusterSwitcherProps {
  contextName: string;
  sidebarOpen: boolean;
}

export function ClusterSwitcher({
  contextName,
  sidebarOpen,
}: ClusterSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [renameCtx, setRenameCtx] = useState<{
    name: string;
    displayName: string | null;
    organizationId: string | null;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { data: clusters } = useClusters();

  const current = clusters?.find((c) => c.name === contextName);
  const displayLabel = current?.displayName || contextName;

  const hasOrgs = clusters?.some((c) => c.organizationId !== null) ?? false;

  const grouped = useMemo(() => {
    if (!clusters) return [];
    const groups = new Map<string | null, { name: string | null; clusters: ClusterContext[] }>();

    for (const ctx of clusters) {
      const key = ctx.organizationId;
      if (!groups.has(key)) {
        groups.set(key, { name: ctx.organizationName, clusters: [] });
      }
      groups.get(key)!.clusters.push(ctx);
    }

    const entries = Array.from(groups.entries());
    entries.sort(([a, ga], [b, gb]) => {
      if (a === null && b !== null) return 1;
      if (a !== null && b === null) return -1;
      if (ga.name && gb.name) return ga.name.localeCompare(gb.name);
      return 0;
    });

    return entries.map(([, group]) => group);
  }, [clusters]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  function switchCluster(targetName: string) {
    const encoded = encodeURIComponent(targetName);
    const currentEncoded = encodeURIComponent(contextName);
    const newPath = pathname.replace(
      `/clusters/${currentEncoded}`,
      `/clusters/${encoded}`
    );
    router.push(newPath);
    setOpen(false);
  }

  function renderClusterItem(cluster: ClusterContext) {
    return (
      <div
        key={cluster.name}
        className="flex items-center group hover:bg-accent/50"
      >
        <button
          onClick={() => switchCluster(cluster.name)}
          className="flex items-center gap-2 flex-1 px-3 py-1.5 text-sm min-w-0"
        >
          <Server
            className="h-4 w-4 shrink-0"
            style={{
              color:
                (COLOR_PRESETS[cluster.colorScheme ?? ""] ??
                  COLOR_PRESETS[DEFAULT_COLOR_SCHEME]).dot,
            }}
          />
          <span className="truncate">
            {cluster.displayName || cluster.name}
          </span>
          {cluster.name === contextName && (
            <Check className="h-3.5 w-3.5 shrink-0 ml-auto" />
          )}
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setRenameCtx({
              name: cluster.name,
              displayName: cluster.displayName,
              organizationId: cluster.organizationId,
            });
          }}
          className="p-1.5 mr-2 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-opacity"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center w-full px-3 py-2 text-sm hover:bg-accent/50 transition-colors",
          sidebarOpen ? "gap-3 justify-between" : "justify-center"
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Server className="h-4 w-4 shrink-0" />
          {sidebarOpen && (
            <span className="truncate font-medium">{displayLabel}</span>
          )}
        </div>
        {sidebarOpen && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform text-muted-foreground",
              open && "rotate-180"
            )}
          />
        )}
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 bg-card border rounded-md shadow-lg py-1 min-w-[220px]",
            sidebarOpen
              ? "left-0 right-0 top-full mt-1"
              : "left-full top-0 ml-1"
          )}
        >
          {!hasOrgs && (
            <>
              <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                Clusters
              </div>
              {clusters?.map(renderClusterItem)}
            </>
          )}
          {hasOrgs &&
            grouped.map((group) => (
              <div key={group.name ?? "__ungrouped"}>
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase">
                  {group.name ?? "Ungrouped"}
                </div>
                {group.clusters.map(renderClusterItem)}
              </div>
            ))}
        </div>
      )}

      {renameCtx && (
        <RenameContextDialog
          contextName={renameCtx.name}
          currentDisplayName={renameCtx.displayName}
          currentOrganizationId={renameCtx.organizationId}
          open
          onOpenChange={(open) => !open && setRenameCtx(null)}
        />
      )}
    </div>
  );
}
