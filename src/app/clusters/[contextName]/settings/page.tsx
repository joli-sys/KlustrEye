import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useClusters, useNamespaces } from "@/hooks/use-clusters";
import { useOrganizations, useAssignClusterOrganization } from "@/hooks/use-organizations";
import { useUIStore } from "@/lib/stores/ui-store";
import { getPlugins } from "@/lib/plugins/registry";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const plugins = getPlugins();

export default function SettingsPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const { addToast } = useToast();

  const queryClient = useQueryClient();
  const { data: clusters } = useClusters();
  const currentCluster = clusters?.find((c) => c.name === ctx);
  const { data: namespaces } = useNamespaces(ctx);
  const setClusterNamespace = useUIStore((s) => s.setClusterNamespace);
  const currentNs = useUIStore((s) => s.namespaceByCluster[ctx]) ?? currentCluster?.lastNamespace ?? "default";
  const [savingNs, setSavingNs] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState(false);

  const effectiveColor =
    selectedColor ?? currentCluster?.colorScheme ?? DEFAULT_COLOR_SCHEME;

  const { data: organizations } = useOrganizations();
  const assignOrg = useAssignClusterOrganization();

  const [displayName, setDisplayName] = useState(currentCluster?.displayName ?? "");
  const [savingName, setSavingName] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);

  const handleSaveDisplayName = async () => {
    setSavingName(true);
    try {
      const res = await fetch(`/api/clusters/${encodeURIComponent(ctx)}/rename`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: displayName.trim() || null }),
      });
      if (!res.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["clusters"] });
      addToast({ title: "Display name saved", variant: "success" });
    } catch {
      addToast({ title: "Failed to save display name", variant: "destructive" });
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveOrg = async (organizationId: string | null) => {
    setSavingOrg(true);
    try {
      await assignOrg.mutateAsync({ contextName: ctx, organizationId });
      addToast({ title: "Organization saved", variant: "success" });
    } catch {
      addToast({ title: "Failed to save organization", variant: "destructive" });
    } finally {
      setSavingOrg(false);
    }
  };

  const [editorFontSize, setEditorFontSize] = useState("13");
  const [pollingInterval, setPollingInterval] = useState("30");
  const [logTailLines, setLogTailLines] = useState("200");

  const handleSave = () => {
    addToast({ title: "Settings saved", variant: "success" });
  };

  const handleSaveNamespace = async (value: string) => {
    setSavingNs(true);
    try {
      setClusterNamespace(ctx, value);
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/settings/namespace`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ namespace: value }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["clusters"] });
      addToast({ title: "Default namespace saved", variant: "success" });
    } catch {
      addToast({ title: "Failed to save namespace", variant: "destructive" });
    } finally {
      setSavingNs(false);
    }
  };

  const handleSaveColor = async () => {
    setSavingColor(true);
    try {
      const res = await fetch(
        `/api/clusters/${encodeURIComponent(ctx)}/settings/color`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ colorScheme: effectiveColor }),
        }
      );
      if (!res.ok) throw new Error("Failed to save");
      await queryClient.invalidateQueries({ queryKey: ["clusters"] });
      addToast({ title: "Color scheme saved", variant: "success" });
    } catch {
      addToast({ title: "Failed to save color scheme", variant: "destructive" });
    } finally {
      setSavingColor(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-bold">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cluster Identity</CardTitle>
          <CardDescription>Customize how this cluster appears in KlustrEye</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Display Name</label>
            <div className="flex gap-2">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={ctx}
                className="max-w-xs"
              />
              <Button onClick={handleSaveDisplayName} disabled={savingName} size="sm">
                {savingName ? "Saving..." : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Leave blank to use the context name</p>
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Organization</label>
            <Select
              value={currentCluster?.organizationId ?? ""}
              onChange={(e) => handleSaveOrg(e.target.value || null)}
              disabled={savingOrg}
              options={[
                { value: "", label: "No organization" },
                ...(organizations ?? []).map((o) => ({ value: o.id, label: o.name })),
              ]}
              className="w-48"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Appearance</CardTitle>
          <CardDescription>Choose an accent color for this cluster</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {Object.entries(COLOR_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => setSelectedColor(key)}
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all",
                  effectiveColor === key
                    ? "border-foreground scale-110"
                    : "border-transparent hover:border-muted-foreground/50"
                )}
                style={{ backgroundColor: preset.dot }}
                title={preset.label}
              >
                {effectiveColor === key && (
                  <Check className="h-4 w-4 text-white" />
                )}
              </button>
            ))}
          </div>
          <Button onClick={handleSaveColor} disabled={savingColor} size="sm">
            {savingColor ? "Saving..." : "Save Color"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Namespace</CardTitle>
          <CardDescription>Namespace selected when you open this cluster</CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={currentNs}
            onChange={(e) => handleSaveNamespace(e.target.value)}
            disabled={savingNs}
            options={[
              { value: "__all__", label: "All Namespaces" },
              ...(namespaces || []).map((n) => ({
                value: n.name,
                label: n.name,
              })),
            ]}
            className="w-48"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Editor</CardTitle>
          <CardDescription>Configure the YAML editor</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Font Size</label>
            <Input
              type="number"
              value={editorFontSize}
              onChange={(e) => setEditorFontSize(e.target.value)}
              min="10"
              max="24"
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Polling</CardTitle>
          <CardDescription>Configure auto-refresh intervals</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Resource List Polling (seconds)</label>
            <Select
              value={pollingInterval}
              onChange={(e) => setPollingInterval(e.target.value)}
              options={[
                { value: "5", label: "5s" },
                { value: "10", label: "10s" },
                { value: "30", label: "30s" },
                { value: "60", label: "60s" },
                { value: "0", label: "Disabled" },
              ]}
              className="w-32"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Default Log Tail Lines</label>
            <Select
              value={logTailLines}
              onChange={(e) => setLogTailLines(e.target.value)}
              options={[
                { value: "100", label: "100" },
                { value: "200", label: "200" },
                { value: "500", label: "500" },
                { value: "1000", label: "1000" },
              ]}
              className="w-32"
            />
          </div>
        </CardContent>
      </Card>

      {plugins.map((plugin) => {
        const Panel = plugin.SettingsPanel;
        if (!Panel) return null;
        return <Panel key={plugin.manifest.id} contextName={ctx} />;
      })}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cluster</CardTitle>
          <CardDescription>Context: {ctx}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>Kubeconfig-based authentication. Edit your kubeconfig file to change credentials.</p>
        </CardContent>
      </Card>

      <Button onClick={handleSave}>Save Settings</Button>
    </div>
  );
}
