import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Loader2, CircleCheck, CircleX } from "lucide-react";
import { useOpenCostSettings, useSaveOpenCostSettings, useTestOpenCostConnection } from "./hooks";
import type { MetricsSource } from "./hooks";
import { useGrafanaConfig } from "@/plugins/grafana/hooks";

export function OpenCostSettingsPanel({ contextName }: { contextName: string }) {
  const { addToast } = useToast();
  const { data: settings } = useOpenCostSettings(contextName);
  const { data: grafanaConfig } = useGrafanaConfig(contextName);
  const save = useSaveOpenCostSettings(contextName);
  const test = useTestOpenCostConnection(contextName);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [metricsSource, setMetricsSource] = useState<MetricsSource>("opencost");
  const [prometheusUrl, setPrometheusUrl] = useState("");
  const [prometheusToken, setPrometheusToken] = useState("");
  const [clusterLabel, setClusterLabel] = useState("");

  useEffect(() => {
    if (settings) {
      setUrl(settings.url || "");
      setMetricsSource(settings.metricsSource || "opencost");
      setPrometheusUrl(settings.prometheusUrl || "");
      setClusterLabel(settings.clusterLabel || "");
    }
  }, [settings]);

  const isPrometheus = metricsSource === "prometheus" || metricsSource === "mimir";
  const canSave =
    (metricsSource === "opencost" && (url || settings?.url)) ||
    (metricsSource === "mimir") ||
    (metricsSource === "prometheus" && (prometheusUrl || settings?.prometheusUrl));
  const canTest = settings?.url || settings?.prometheusUrl || settings?.grafanaConfigured;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">OpenCost</CardTitle>
        <CardDescription>Kubernetes cost monitoring and allocation</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Metrics source selector */}
        <div>
          <label className="text-sm font-medium mb-1.5 block">Metrics Source</label>
          <div className="flex gap-2">
            {(["opencost", "prometheus", "mimir"] as MetricsSource[]).map((src) => (
              <button
                key={src}
                onClick={() => setMetricsSource(src)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  metricsSource === src
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {src === "opencost" ? "OpenCost API" : src === "prometheus" ? "Prometheus" : "Mimir"}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            {metricsSource === "opencost"
              ? "Query the OpenCost REST API directly for cost allocation data"
              : metricsSource === "prometheus"
              ? "Query opencost_* metrics from a Prometheus instance"
              : "Query opencost_* metrics from a Mimir instance (Prometheus-compatible API)"}
          </p>
        </div>

        {/* OpenCost URL (shown for all sources but required only for opencost) */}
        {metricsSource === "opencost" && (
          <>
            <div>
              <label className="text-sm font-medium mb-1 block">OpenCost URL</label>
              <Input
                type="url"
                placeholder="http://opencost.opencost.svc:9090"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                The OpenCost service URL — reachable from within the cluster or via port-forward
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Bearer Token (optional)</label>
              <Input
                type="password"
                placeholder="Token for OpenCost API authentication"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              {settings?.hasToken && !token && (
                <p className="text-xs text-muted-foreground mt-1">Token is saved. Enter a new value to update it.</p>
              )}
            </div>
          </>
        )}

        {/* Mimir — reuse Grafana/Mimir configuration */}
        {metricsSource === "mimir" && (
          <div className="rounded-md border p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-sm">
              {settings?.grafanaConfigured || grafanaConfig?.hasToken ? (
                <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <CircleX className="h-4 w-4 text-red-500 shrink-0" />
              )}
              <span className="font-medium">
                {settings?.grafanaConfigured || grafanaConfig?.hasToken
                  ? "Grafana / Mimir is configured"
                  : "Grafana / Mimir is not configured"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              OpenCost will query <span className="font-mono">opencost_*</span> metrics through
              the Grafana datasource proxy using your Grafana / Mimir plugin settings.
              {!settings?.grafanaConfigured && !grafanaConfig?.hasToken && (
                <> Configure the <strong>Grafana / Mimir</strong> plugin first.</>
              )}
            </p>
          </div>
        )}

        {/* Prometheus fields */}
        {metricsSource === "prometheus" && (
          <>
            <div>
              <label className="text-sm font-medium mb-1 block">Prometheus URL</label>
              <Input
                type="url"
                placeholder="http://prometheus.monitoring.svc:9090"
                value={prometheusUrl}
                onChange={(e) => setPrometheusUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Must expose the <span className="font-mono">/api/v1/query</span> endpoint and have{" "}
                <span className="font-mono">opencost_*</span> metrics scraped
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Bearer Token (optional)</label>
              <Input
                type="password"
                placeholder="Token for Prometheus authentication"
                value={prometheusToken}
                onChange={(e) => setPrometheusToken(e.target.value)}
              />
              {settings?.hasPrometheusToken && !prometheusToken && (
                <p className="text-xs text-muted-foreground mt-1">Token is saved. Enter a new value to update it.</p>
              )}
            </div>
          </>
        )}

        {/* Cluster label (prometheus + mimir) */}
        {isPrometheus && (
          <div>
            <label className="text-sm font-medium mb-1 block">Cluster Label (optional)</label>
            <Input
              placeholder="e.g. classic-red"
              value={clusterLabel}
              onChange={(e) => setClusterLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Filters metrics by <span className="font-mono">cluster=&quot;…&quot;</span>. Leave blank to auto-detect from the context name.
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={test.isPending || !canTest}
            onClick={() => {
              test.mutate(undefined, {
                onSuccess: (data) => {
                  if (data.ok) {
                    addToast({ title: "Connection successful", variant: "success" });
                  } else {
                    addToast({ title: "Connection failed", description: data.error, variant: "destructive" });
                  }
                },
                onError: (err) => addToast({ title: "Connection failed", description: err.message, variant: "destructive" }),
              });
            }}
          >
            {test.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Test Connection
          </Button>
          <Button
            size="sm"
            disabled={save.isPending || !canSave}
            onClick={() => {
              save.mutate(
                {
                  url: metricsSource === "opencost" ? url : undefined,
                  token: token || "__keep__",
                  metricsSource,
                  prometheusUrl: isPrometheus ? prometheusUrl : undefined,
                  prometheusToken: prometheusToken || "__keep__",
                  clusterLabel: isPrometheus ? clusterLabel : undefined,
                },
                {
                  onSuccess: () => {
                    setToken("");
                    setPrometheusToken("");
                    addToast({ title: "OpenCost settings saved", variant: "success" });
                  },
                  onError: (err) => addToast({ title: "Failed to save", description: err.message, variant: "destructive" }),
                }
              );
            }}
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save
          </Button>
        </div>

        {/* Test result */}
        {test.data && (
          <div className="rounded-md border p-3 flex items-center gap-2 text-sm">
            {test.data.ok ? (
              <CircleCheck className="h-4 w-4 text-green-500 shrink-0" />
            ) : (
              <CircleX className="h-4 w-4 text-red-500 shrink-0" />
            )}
            <span>
              {test.data.ok
                ? isPrometheus
                  ? test.data.hasOpenCostMetrics
                    ? "Connected — opencost_* metrics found"
                    : "Connected, but no opencost_* metrics found. Ensure OpenCost is scraping into this datasource."
                  : "Connected to OpenCost API"
                : test.data.error || "Connection failed"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
