import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/lib/stores/ui-store";
import { useTabStore } from "@/lib/stores/tab-store";
import { useSavedSearches } from "@/lib/stores/saved-searches-store";
import { SIDEBAR_SECTIONS, RESOURCE_ROUTE_MAP, RESOURCE_REGISTRY, type ResourceKind } from "@/lib/constants";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { clusterSwitchHref } from "@/lib/paths";
import { orderedClusters } from "@/lib/workspace-clusters";
import type { Workspace } from "@/hooks/use-workspaces";
import { ClusterSwitcher } from "@/components/cluster-switcher";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard, Server, Box, Layers, Database, Cpu, Copy, Play, Clock,
  Network, Globe, FileText, KeyRound, UserCog, HardDrive, Activity, Anchor,
  Puzzle, Cable, Share2, ShieldCheck, ArrowUpDown, SlidersHorizontal,
  Settings, BarChart3, Star, X,
  Shield, UserCheck, UsersRound, CircleDollarSign,
  AlertCircle,
} from "lucide-react";
import { getPluginsWithPages } from "@/lib/plugins/registry";

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard, Server, Box, Layers, Database, Cpu, Copy, Play, Clock,
  Network, Globe, FileText, KeyRound, UserCog, HardDrive, Activity, Anchor,
  Puzzle, Cable, Share2, ShieldCheck, ArrowUpDown, SlidersHorizontal, Settings, BarChart3,
  Shield, UserCheck, UsersRound, CircleDollarSign,
};

const pagePlugins = getPluginsWithPages();

const linkClass = (isActive: boolean) =>
  cn(
    "flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm transition-colors",
    isActive
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
  );

const sectionHeaderClass =
  "px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider";

/**
 * The workspace's clusters, and the Kubernetes nav for whichever one is
 * active. Only mounted when the workspace binds at least one cluster —
 * `basePath` is therefore always a real path here, which is what lets every
 * href below be built unconditionally.
 *
 * `contextName` is the ACTIVE cluster (route first, first binding as the
 * fallback), not "the" cluster of the workspace: a workspace binds many, and
 * the list at the top is how the user moves between them.
 */
export function SidebarCluster({
  workspace,
  contextName,
  basePath,
  onNavigate,
}: {
  workspace: Workspace;
  contextName: string;
  basePath: string;
  onNavigate?: () => void;
}) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const setWorkspaceNamespace = useUIStore((s) => s.setWorkspaceNamespace);
  const { openTab } = useTabStore();
  const { searches: savedSearches, removeSearch } = useSavedSearches();
  const wsId = useWorkspaceId();
  const bound = orderedClusters(workspace.clusters);

  /**
   * A single healthy binding is already named by the switcher above, and a
   * one-row list under it reads as a rendering bug. Anything else — a second
   * cluster to move to, or one that fell out of the kubeconfig — carries
   * information the switcher's collapsed header cannot show.
   */
  const showClusterList = bound.length > 1 || bound.some((c) => !c.exists);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b shrink-0">
        <ClusterSwitcher workspace={workspace} contextName={contextName} sidebarOpen />
      </div>

      {/* Every binding, including the broken ones: hiding a cluster that fell
          out of the kubeconfig leaves the user nothing to act on. */}
      {showClusterList && (
        <div className="border-b shrink-0 py-1">
          <div className={sectionHeaderClass}>Clusters</div>
          {bound.map((cluster) => {
            const isActive = cluster.contextName === contextName;
            if (!cluster.exists) {
              return (
                <div
                  key={cluster.contextName}
                  title={`"${cluster.contextName}" is not in the current kubeconfig. Rebind the workspace to fix it.`}
                  className="flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm text-muted-foreground/60 cursor-not-allowed"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 text-yellow-600" />
                  <span className="truncate line-through">{cluster.contextName}</span>
                  <Badge variant="warning" className="ml-auto shrink-0 text-[10px]">
                    missing
                  </Badge>
                </div>
              );
            }
            return (
              <Link
                key={cluster.contextName}
                to={clusterSwitchHref(wsId, contextName, cluster.contextName, pathname, search)}
                onClick={() => onNavigate?.()}
                aria-current={isActive ? "true" : undefined}
                className={linkClass(isActive)}
              >
                <Server className="h-4 w-4 shrink-0" />
                <span className="truncate">{cluster.contextName}</span>
                {isActive && (
                  <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                    current
                  </Badge>
                )}
              </Link>
            );
          })}
        </div>
      )}

      <nav className="flex-1 min-h-0 overflow-y-auto py-2">
        {SIDEBAR_SECTIONS.map((section, i) => (
          <div key={i} className="mb-2">
            <div className={sectionHeaderClass}>{section.title}</div>
            {section.items.map((item) => {
              const Icon = iconMap[item.icon] || Box;
              const href = `${basePath}/${item.href}`;
              const isActive = pathname === href || pathname.startsWith(href + "/");

              return (
                <Link
                  key={item.href}
                  to={href}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.button === 1) {
                      e.preventDefault();
                      openTab(wsId, href, item.label);
                    } else {
                      onNavigate?.();
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openTab(wsId, href, item.label);
                    }
                  }}
                  className={linkClass(isActive)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        ))}

        {pagePlugins.length > 0 && (
          <div className="mb-2">
            <div className={sectionHeaderClass}>Integrations</div>
            {pagePlugins.map((plugin) => {
              const Icon = iconMap[plugin.manifest.icon] || Puzzle;
              const href = `${basePath}/plugins/${plugin.manifest.id}`;
              const isActive = pathname === href || pathname.startsWith(href + "/");

              return (
                <Link
                  key={plugin.manifest.id}
                  to={href}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.button === 1) {
                      e.preventDefault();
                      openTab(wsId, href, plugin.manifest.name);
                    } else {
                      onNavigate?.();
                    }
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      openTab(wsId, href, plugin.manifest.name);
                    }
                  }}
                  className={linkClass(isActive)}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{plugin.manifest.name}</span>
                </Link>
              );
            })}
          </div>
        )}

        {savedSearches.length > 0 && (
          <div className="mb-2 border-t pt-2">
            <div className={cn(sectionHeaderClass, "flex items-center gap-1.5")}>
              <Star className="h-3 w-3" />
              Saved Searches
            </div>
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
                    if (s.namespace) setWorkspaceNamespace(wsId, s.namespace);
                    navigate(href);
                    onNavigate?.();
                  }}
                >
                  <div className="flex items-center gap-3 px-3 py-1.5 min-w-0 flex-1">
                    <Star className="h-4 w-4 shrink-0 text-yellow-500" />
                    <span className="truncate flex-1">{s.name}</span>
                    <Badge variant="secondary" className="text-[10px] shrink-0">{kindLabel}</Badge>
                  </div>
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
                </div>
              );
            })}
          </div>
        )}
      </nav>

      {/* Cluster settings — there is no workspace-level settings page, so this
          footer belongs to the Cluster view rather than to the panel shell. */}
      <div className="border-t p-2 shrink-0">
        <Link
          to={`${basePath}/settings`}
          onClick={() => onNavigate?.()}
          className={cn(
            "flex items-center gap-3 px-3 py-1.5 mx-1 rounded-md text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors",
            pathname.includes("/settings") && "bg-primary/10 text-primary font-medium"
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  );
}
