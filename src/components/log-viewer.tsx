"use client";

import { useState, useRef, useEffect } from "react";
import { usePodLogs } from "@/hooks/use-pod-logs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, RefreshCw, Search, ArrowDown } from "lucide-react";

interface LogViewerProps {
  contextName: string;
  namespace: string;
  podName: string;
  containers: string[];
}

export function LogViewer({ contextName, namespace, podName, containers }: LogViewerProps) {
  const [container, setContainer] = useState(containers[0] || "");
  const [follow, setFollow] = useState(false);
  const [tailLines, setTailLines] = useState(200);
  const [search, setSearch] = useState("");
  const [previous, setPrevious] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

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

  const filteredLines = search
    ? logs.split("\n").filter((line) => line.toLowerCase().includes(search.toLowerCase()))
    : logs.split("\n");

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
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
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
      </div>

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
            <div key={i} className="hover:bg-white/5">
              <span className="text-muted-foreground select-none mr-2 inline-block w-8 text-right">
                {i + 1}
              </span>
              {search ? highlightSearch(line, search) : line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function highlightSearch(text: string, search: string) {
  if (!search) return text;
  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === search.toLowerCase() ? (
          <mark key={i} className="bg-yellow-600 text-white">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}
