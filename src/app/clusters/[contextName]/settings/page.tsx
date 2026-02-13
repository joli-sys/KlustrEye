"use client";

import { use, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useClusters } from "@/hooks/use-clusters";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export default function SettingsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const { addToast } = useToast();

  const queryClient = useQueryClient();
  const { data: clusters } = useClusters();
  const currentCluster = clusters?.find((c) => c.name === ctx);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);
  const [savingColor, setSavingColor] = useState(false);

  // Initialize selectedColor from cluster data once loaded
  const effectiveColor =
    selectedColor ?? currentCluster?.colorScheme ?? DEFAULT_COLOR_SCHEME;

  const [editorFontSize, setEditorFontSize] = useState("13");
  const [pollingInterval, setPollingInterval] = useState("30");
  const [logTailLines, setLogTailLines] = useState("200");

  const handleSave = () => {
    // In a full implementation, this would persist to the DB via API
    addToast({ title: "Settings saved", variant: "success" });
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
