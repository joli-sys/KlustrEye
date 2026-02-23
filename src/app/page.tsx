"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useClusters } from "@/hooks/use-clusters";
import { useOrganizations } from "@/hooks/use-organizations";
import { useKubeconfigSetting, useUpdateKubeconfigPath } from "@/hooks/use-kubeconfig-setting";
import { KlustrEyeLogo } from "@/components/klustreye-logo";
import { RenameContextDialog } from "@/components/rename-context-dialog";
import { ManageOrganizationsDialog } from "@/components/manage-organizations-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";
import { Server, AlertCircle, Pencil, Network, User, Box, FolderOpen, Settings, ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { CloudProviderIcon } from "@/components/cloud-provider-icon";
import Link from "next/link";
import type { ClusterContext } from "@/hooks/use-clusters";

export default function HomePage() {
  const { data: clusters, isLoading, error } = useClusters();
  const { data: orgs } = useOrganizations();
  const [renameCtx, setRenameCtx] = useState<{
    name: string;
    displayName: string | null;
    organizationId: string | null;
  } | null>(null);
  const [manageOrgsOpen, setManageOrgsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  const handleFocusFilter = useCallback(() => {
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, []);

  useEffect(() => {
    window.addEventListener("focus-table-filter", handleFocusFilter);
    return () => window.removeEventListener("focus-table-filter", handleFocusFilter);
  }, [handleFocusFilter]);

  const { data: kubeconfigSetting } = useKubeconfigSetting();
  const updateKubeconfig = useUpdateKubeconfigPath();
  const [kubeconfigInput, setKubeconfigInput] = useState("");

  useEffect(() => {
    if (kubeconfigSetting?.path !== undefined) {
      setKubeconfigInput(kubeconfigSetting.path);
    }
  }, [kubeconfigSetting?.path]);

  const hasOrgs = orgs && orgs.length > 0;

  const filteredClusters = useMemo(() => {
    if (!clusters) return undefined;
    if (!filterQuery.trim()) return clusters;
    const q = filterQuery.toLowerCase();
    return clusters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.displayName && c.displayName.toLowerCase().includes(q))
    );
  }, [clusters, filterQuery]);

  const grouped = useMemo(() => {
    if (!filteredClusters) return [];
    const groups = new Map<string | null, { name: string | null; clusters: ClusterContext[] }>();

    for (const ctx of filteredClusters) {
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
  }, [filteredClusters]);

  function renderClusterCard(ctx: ClusterContext) {
    return (
      <div key={ctx.name} className="relative group">
        <Link href={`/clusters/${encodeURIComponent(ctx.name)}/overview`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div
                    className="flex items-center justify-center h-12 w-12 rounded-lg"
                    style={{
                      backgroundColor:
                        (COLOR_PRESETS[ctx.colorScheme ?? ""] ??
                          COLOR_PRESETS[DEFAULT_COLOR_SCHEME]).dot,
                    }}
                  >
                    <Server className="h-6 w-6 text-white" />
                  </div>
                  {ctx.cloudProvider && ctx.cloudProvider !== "kubernetes" && (
                    <CloudProviderIcon provider={ctx.cloudProvider} size={28} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold truncate">
                      {ctx.displayName || ctx.name}
                    </h3>
                    {ctx.isCurrent && (
                      <Badge variant="secondary" className="shrink-0">current</Badge>
                    )}
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2 truncate">
                      <Network className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{ctx.cluster}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{ctx.user}</span>
                    </div>
                    <div className="flex items-center gap-2 truncate">
                      <Box className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{ctx.namespace}</span>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <button
          onClick={(e) => {
            e.preventDefault();
            setRenameCtx({
              name: ctx.name,
              displayName: ctx.displayName,
              organizationId: ctx.organizationId,
            });
          }}
          className="absolute top-4 right-10 p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity"
          title="Edit cluster"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="drag-region flex items-center justify-center pl-20 px-8 py-3 border-b bg-card">
        <div className="no-drag-region">
          <KlustrEyeLogo size="sm" />
        </div>
      </header>

      <div className="max-w-5xl mx-auto p-8 flex-1">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Clusters</h1>
            <p className="text-muted-foreground mt-1">
              Select a cluster to manage
            </p>
          </div>
          <div className="flex items-center gap-3">
            {clusters && clusters.length > 0 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  ref={filterInputRef}
                  placeholder="Filter clusters..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="pl-8 w-56 h-8 text-sm"
                />
                <kbd className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                  <span className="text-xs">⌘</span>F
                </kbd>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setManageOrgsOpen(true)}
            >
              <FolderOpen className="h-4 w-4 mr-2" />
              Manage Organizations
            </Button>
          </div>
        </div>

        {clusters && clusters.length > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setSettingsOpen(!settingsOpen)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Settings className="h-3.5 w-3.5" />
              Kubeconfig Settings
              {settingsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
            {settingsOpen && (
              <form
                className="flex gap-2 mt-3 max-w-lg"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateKubeconfig.mutate(kubeconfigInput);
                }}
              >
                <Input
                  placeholder="~/.kube/config"
                  value={kubeconfigInput}
                  onChange={(e) => setKubeconfigInput(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={updateKubeconfig.isPending}>
                  {updateKubeconfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : kubeconfigInput ? (
                    "Load"
                  ) : (
                    "Reset"
                  )}
                </Button>
              </form>
            )}
          </div>
        )}

        {error && (
          <Card className="max-w-md mx-auto mt-8">
            <CardContent className="pt-6 text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-red-400 opacity-75" />
              <p className="text-red-400 mb-1 font-medium">Failed to load kubeconfig</p>
              <p className="text-muted-foreground text-sm mb-4">{(error as Error).message}</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateKubeconfig.mutate(kubeconfigInput);
                }}
              >
                <Input
                  placeholder={typeof navigator !== "undefined" && navigator.userAgent.includes("Windows")
                    ? "C:\\Users\\you\\.kube\\config"
                    : "~/.kube/config"}
                  value={kubeconfigInput}
                  onChange={(e) => setKubeconfigInput(e.target.value)}
                />
                <Button type="submit" disabled={updateKubeconfig.isPending}>
                  {updateKubeconfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Load"
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2">
                Enter your kubeconfig file path to connect to clusters
              </p>
            </CardContent>
          </Card>
        )}

        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        )}

        {filteredClusters && !hasOrgs && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClusters.map(renderClusterCard)}
          </div>
        )}

        {filteredClusters && hasOrgs && (
          <div className="space-y-8">
            {grouped.map((group) => (
              <div key={group.name ?? "__ungrouped"}>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-lg font-semibold">
                    {group.name ?? "Ungrouped"}
                  </h2>
                  <Badge variant="secondary">{group.clusters.length}</Badge>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.clusters.map(renderClusterCard)}
                </div>
              </div>
            ))}
          </div>
        )}

        {clusters && clusters.length === 0 && (
          <Card className="max-w-md mx-auto mt-8">
            <CardContent className="pt-6 text-center">
              <Server className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground mb-4">No clusters found in kubeconfig</p>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateKubeconfig.mutate(kubeconfigInput);
                }}
              >
                <Input
                  placeholder="~/.kube/config"
                  value={kubeconfigInput}
                  onChange={(e) => setKubeconfigInput(e.target.value)}
                />
                <Button type="submit" disabled={updateKubeconfig.isPending}>
                  {updateKubeconfig.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Load"
                  )}
                </Button>
              </form>
              <p className="text-xs text-muted-foreground mt-2">
                Enter a custom kubeconfig file path, or leave empty for default
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {renameCtx && (
        <RenameContextDialog
          contextName={renameCtx.name}
          currentDisplayName={renameCtx.displayName}
          currentOrganizationId={renameCtx.organizationId}
          open
          onOpenChange={(open) => !open && setRenameCtx(null)}
        />
      )}

      <ManageOrganizationsDialog
        open={manageOrgsOpen}
        onOpenChange={setManageOrgsOpen}
      />

    </div>
  );
}
