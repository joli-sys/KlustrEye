"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { useTabStore } from "@/lib/stores/tab-store";
import { useSavedSearches } from "@/lib/stores/saved-searches-store";
import { SIDEBAR_SECTIONS, RESOURCE_ROUTE_MAP, RESOURCE_REGISTRY, type ResourceKind } from "@/lib/constants";
import { KlustrEyeLogo } from "@/components/klustreye-logo";
import { ClusterSwitcher } from "@/components/cluster-switcher";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Server, Box, Layers, Database, Cpu, Copy, Play, Clock,
  Network, Globe, FileText, KeyRound, UserCog, HardDrive, Activity, Anchor,
  Puzzle, Cable, Share2, ShieldCheck, ArrowUpDown, SlidersHorizontal,
  PanelLeftClose, PanelLeft, Settings, BarChart3, Star, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPluginsWithPages } from "@/lib/plugins/registry";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Server, Box, Layers, Database, Cpu, Copy, Play, Clock,
  Network, Globe, FileText, KeyRound, UserCog, HardDrive, Activity, Anchor,
  Puzzle, Cable, Share2, ShieldCheck, ArrowUpDown, SlidersHorizontal, Settings, BarChart3,
};

const pagePlugins = getPluginsWithPages();

export function Sidebar({ contextName }: { contextName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { sidebarOpen, toggleSidebar, setSelectedNamespace } = useUIStore();
  const { openTab } = useTabStore();
  const { searches: savedSearches, removeSearch } = useSavedSearches();
  const basePath = `/clusters/${encodeURIComponent(contextName)}`;

  return (
    <aside
      className={cn(
        "flex flex-col border-r bg-card transition-all duration-200 shrink-0",
        sidebarOpen ? "w-56" : "w-14"
      )}
    >
      <div className="flex items-center justify-center border-b py-2 px-3 relative">
        {sidebarOpen && (
          <Link href="/" className="overflow-hidden">
            <KlustrEyeLogo size="sm" />
          </Link>
        )}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className={cn("shrink-0", sidebarOpen ? "absolute right-2" : "")}>
          {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
        </Button>
      </div>

      <div className="border-b">
        <ClusterSwitcher contextName={contextName} sidebarOpen={sidebarOpen} />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        {SIDEBAR_SECTIONS.map((section, i) => (
          <div key={i} className="mb-2">
            {sidebarOpen && (
              <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const Icon = iconMap[item.icon] || Box;
              const href = `${basePath}/${item.href}`;
              const isActive = pathname === href || pathname.startsWith(href + "/");

              return (
                <Link
                  key={item.href}
                  href={href}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.button === 1) {
                      e.preventDefault();
                      openTab(contextName, href, item.label);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openTab(contextName, href, item.label);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  title={!sidebarOpen ? item.label : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {sidebarOpen && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
        {pagePlugins.length > 0 && (
          <div className="mb-2">
            {sidebarOpen && (
              <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Integrations
              </div>
            )}
            {pagePlugins.map((plugin) => {
              const Icon = iconMap[plugin.manifest.icon] || Puzzle;
              const href = `${basePath}/plugins/${plugin.manifest.id}`;
              const isActive = pathname === href || pathname.startsWith(href + "/");

              return (
                <Link
                  key={plugin.manifest.id}
                  href={href}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.button === 1) {
                      e.preventDefault();
                      openTab(contextName, href, plugin.manifest.name);
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openTab(contextName, href, plugin.manifest.name);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                  title={!sidebarOpen ? plugin.manifest.name : undefined}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {sidebarOpen && <span className="truncate">{plugin.manifest.name}</span>}
                </Link>
              );
            })}
          </div>
        )}
        {savedSearches.length > 0 && (
          <div className="mb-2 border-t pt-2">
            {sidebarOpen && (
              <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Star className="h-3 w-3" />
                Saved Searches
              </div>
            )}
            {savedSearches.map((s) => {
              const route = RESOURCE_ROUTE_MAP[s.kind];
              const path = route?.path ?? s.kind;
              const href = `${basePath}/${path}?filter=${encodeURIComponent(s.query)}`;
              const registry = RESOURCE_REGISTRY[s.kind as ResourceKind];
              const kindLabel = registry?.kind ?? s.kind;
              const tooltip = [
                s.name,
                `Kind: ${kindLabel}`,
                `Filter: ${s.query}`,
                s.namespace ? `Namespace: ${s.namespace}` : null,
              ].filter(Boolean).join("\n");

              return (
                <div
                  key={s.id}
                  className="group flex items-center gap-1 mx-1 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors cursor-pointer"
                  title={tooltip}
                  onClick={() => {
                    if (s.namespace) setSelectedNamespace(s.namespace);
                    router.push(href);
                  }}
                >
                  <div className="flex items-center gap-3 px-3 py-1.5 min-w-0 flex-1">
                    <Star className="h-4 w-4 shrink-0 text-yellow-500" />
                    {sidebarOpen && (
                      <>
                        <span className="truncate flex-1">{s.name}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">{kindLabel}</Badge>
                      </>
                    )}
                  </div>
                  {sidebarOpen && (
                    <button
                      className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded hover:bg-accent transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSearch(s.id);
                      }}
                      title="Remove favorite"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>

      <div className="border-t p-2">
        <Link
          href={`${basePath}/settings`}
          className={cn(
            "flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors",
            pathname.includes("/settings") && "bg-accent text-accent-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {sidebarOpen && <span>Settings</span>}
        </Link>
      </div>
    </aside>
  );
}
