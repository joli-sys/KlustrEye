
import { useState, useRef, useEffect, useMemo } from "react";
import { usePodLogs } from "@/hooks/use-pod-logs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, Search, ArrowDown, Sparkles, Regex, Bot } from "lucide-react";
import { useInlineAiAction } from "@/hooks/use-ai";
import { DispatchAgentDialog } from "@/components/dispatch-agent-dialog";
import { buildPodLogAttachment, logDispatchPresets } from "@/lib/agent-dispatch";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { useWorkspace } from "@/hooks/use-workspaces";

interface LogViewerProps {
  contextName: string;
  namespace: string;
  podName: string;
  containers: string[];
  resourceKind?: string;
  resourceName?: string;
}

export function LogViewer({ contextName, namespace, podName, containers, resourceKind, resourceName }: LogViewerProps) {
  const [container, setContainer] = useState(containers[0] || "");
  const [follow, setFollow] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [search, setSearch] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [previous, setPrevious] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const { triggerAction } = useInlineAiAction();
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const wsId = useWorkspaceId();
  const { data: workspace } = useWorkspace(wsId || undefined);

  const regexError = useMemo(() => {
    if (!useRegex || !search) return null;
    try { new RegExp(search, "i"); return null; }
    catch (e) { return (e as Error).message; }
  }, [useRegex, search]);

  const { logs, isLoading, error, refetch } = usePodLogs({
    contextName,
    namespace,
    podName,
    container,
    follow,
    tailLines,
    previous,
  });

  useEffect(() => {
    if (follow && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, follow]);

  const filteredLines = useMemo(() => {
    const lines = logs.split("\n");
    if (!search) return lines;
    if (useRegex) {
      if (regexError) return lines;
      const re = new RegExp(search, "i");
      return lines.filter((line) => re.test(line));
    }
    return lines.filter((line) => line.toLowerCase().includes(search.toLowerCase()));
  }, [logs, search, useRegex, regexError]);

  // What both hand-off actions send: the lines the user is actually looking at,
  // search filter included. Attaching the unfiltered log would hand the agent
  // something other than what is on screen.
  const visibleLogText = useMemo(() => filteredLines.join("\n"), [filteredLines]);
  const hasLogsToHandOff = visibleLogText.trim().length > 0;

  const handleDownload = () => {
    const blob = new Blob([logs], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${podName}-${container}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {containers.length > 1 && (
          <Select
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            options={containers.map((c) => ({ value: c, label: c }))}
            className="w-40"
          />
        )}
        <Select
          value={String(tailLines)}
          onChange={(e) => setTailLines(Number(e.target.value))}
          options={[
            { value: "100", label: "100 lines" },
            { value: "200", label: "200 lines" },
            { value: "500", label: "500 lines" },
            { value: "1000", label: "1000 lines" },
          ]}
          className="w-32"
        />
        <div className="relative flex-1 max-w-xs flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={useRegex ? "Regex pattern..." : "Search logs..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`pl-8 ${regexError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
              title={regexError ?? undefined}
            />
          </div>
          <Button
            variant={useRegex ? "default" : "outline"}
            size="icon"
            onClick={() => setUseRegex(!useRegex)}
            title={useRegex ? "Regex mode on" : "Enable regex mode"}
            className="shrink-0 h-8 w-8"
          >
            <Regex className="h-3.5 w-3.5" />
          </Button>
        </div>
        {search && !regexError && (
          <span className="text-xs text-muted-foreground shrink-0">
            {filteredLines.length} match{filteredLines.length !== 1 ? "es" : ""}
          </span>
        )}
        <Button
          variant={follow ? "default" : "outline"}
          size="sm"
          onClick={() => setFollow(!follow)}
          className="gap-1"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {follow ? "Following" : "Follow"}
        </Button>
        <Button
          variant={previous ? "default" : "outline"}
          size="sm"
          onClick={() => setPrevious(!previous)}
        >
          Previous
        </Button>
        <Button variant="outline" size="icon" onClick={refetch}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          // The two hand-off actions sit side by side, so each says what it is:
          // this one answers, the next one acts.
          title="Read-only: streams an explanation of these logs into the AI panel. Changes nothing."
          onClick={() =>
            triggerAction(
              "Analyze these logs and identify errors, warnings, or anomalies:",
              {
                cluster: contextName,
                namespace,
                resource_kind: resourceKind ?? "Pod",
                resource_name: resourceName ?? podName,
                log_lines: visibleLogText,
              }
            )
          }
          className="gap-1.5"
        >
          <Sparkles className="h-3.5 w-3.5" />
          Analyze Logs
        </Button>
        {wsId && (
          <Button
            variant="outline"
            size="sm"
            title="Starts a real agent session in a terminal: it can read your repository, edit files and run commands."
            disabled={!hasLogsToHandOff}
            onClick={() => setDispatchOpen(true)}
            className="gap-1.5"
          >
            <Bot className="h-3.5 w-3.5" />
            Ask an agent
          </Button>
        )}
      </div>

      {wsId && (
        <DispatchAgentDialog
          open={dispatchOpen}
          onOpenChange={setDispatchOpen}
          wsId={wsId}
          folderPath={workspace?.folderPath}
          subject={`the logs from ${podName}`}
          sessionTitle={`Logs: ${podName}`}
          presets={logDispatchPresets({ podName, container, namespace })}
          buildAttachment={() =>
            buildPodLogAttachment({
              podName,
              container: container || undefined,
              logs: visibleLogText,
            })
          }
        />
      )}

      {error && (
        <div className="text-red-400 text-sm p-3 border border-red-800 rounded-md">
          {error}
        </div>
      )}

      {isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <pre
          ref={logRef}
          className="bg-black text-green-400 font-mono text-xs p-4 rounded-md overflow-auto max-h-[600px] min-h-[200px] leading-relaxed"
        >
          {filteredLines.map((line, i) => (
            <div key={i} className={`hover:bg-white/5 ${getLogLevelClass(line)}`}>
              <span className="text-muted-foreground select-none mr-2 inline-block w-8 text-right">
                {i + 1}
              </span>
              {search && !regexError ? highlightSearch(line, search, useRegex) : line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function highlightSearch(text: string, search: string, isRegex: boolean) {
  if (!search) return text;
  try {
    const pattern = isRegex ? search : search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = text.split(new RegExp(`(${pattern})`, "gi"));
    return (
      <>
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <mark key={i} className="bg-yellow-600 text-white">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  } catch {
    return text;
  }
}

function getLogLevelClass(line: string): string {
  if (/\b(error|err|fatal|critical)\b/i.test(line)) return "text-red-400";
  if (/\b(warn(?:ing)?)\b/i.test(line)) return "text-yellow-400";
  if (/\b(debug|trace)\b/i.test(line)) return "text-slate-500";
  return "";
}
