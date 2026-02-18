"use client";

import { Handle, Position } from "@xyflow/react";
import { Globe, Network, Box, Route } from "lucide-react";
import type { NetworkNodeData } from "./use-network-graph";

function StatusDot({ status }: { status?: string }) {
  let color = "bg-red-500";
  if (status === "Running") color = "bg-green-500";
  else if (status === "Succeeded") color = "bg-blue-500";
  else if (status === "Terminating") color = "bg-purple-500";
  else if (status === "Pending" || status === "NotReady" || status?.startsWith("Init:"))
    color = "bg-yellow-500";

  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color}`} title={status} />
  );
}

export function IngressNode({ data }: { data: NetworkNodeData }) {
  return (
    <div className="bg-card border rounded-lg px-3 py-2 min-w-[160px] border-l-[3px]" style={{ borderLeftColor: "oklch(0.65 0.18 300)" }}>
      <Handle type="source" position={Position.Right} className="!bg-purple-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 text-purple-400 shrink-0" />
        <span className="text-sm font-medium text-card-foreground truncate">{data.label}</span>
      </div>
      {data.hosts && data.hosts.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {data.hosts.map((host, i) => (
            <div key={i} className="text-[10px] font-mono text-purple-300/80 truncate max-w-[200px]">{host}</div>
          ))}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-0.5">{data.namespace}</div>
    </div>
  );
}

export function IngressRouteNode({ data }: { data: NetworkNodeData }) {
  return (
    <div className="bg-card border rounded-lg px-3 py-2 min-w-[170px] border-l-[3px]" style={{ borderLeftColor: "oklch(0.7 0.18 55)" }}>
      <Handle type="source" position={Position.Right} className="!bg-orange-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Route className="h-3.5 w-3.5 text-orange-400 shrink-0" />
        <span className="text-sm font-medium text-card-foreground truncate">{data.label}</span>
        <span className="text-[9px] bg-orange-500/20 text-orange-300 px-1 rounded">Traefik</span>
      </div>
      {data.hosts && data.hosts.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {data.hosts.map((host, i) => (
            <div key={i} className="text-[10px] font-mono text-orange-300/80 truncate max-w-[200px]">{host}</div>
          ))}
        </div>
      )}
      {data.entryPoints && data.entryPoints.length > 0 && (
        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
          {data.entryPoints.map((ep, i) => (
            <span key={i} className="text-[9px] bg-orange-500/10 text-orange-300/70 px-1 rounded">{ep}</span>
          ))}
        </div>
      )}
      {data.matchRules && data.matchRules.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {data.matchRules.slice(0, 2).map((rule, i) => (
            <div key={i} className="text-[9px] font-mono text-muted-foreground truncate max-w-[210px]">{rule}</div>
          ))}
          {data.matchRules.length > 2 && (
            <div className="text-[9px] text-muted-foreground">+{data.matchRules.length - 2} more</div>
          )}
        </div>
      )}
      <div className="text-[10px] text-muted-foreground mt-0.5">{data.namespace}</div>
    </div>
  );
}

export function ServiceNode({ data }: { data: NetworkNodeData }) {
  return (
    <div className="bg-card border rounded-lg px-3 py-2 min-w-[160px] border-l-[3px]" style={{ borderLeftColor: "oklch(0.648 0.2 260)" }}>
      <Handle type="target" position={Position.Left} className="!bg-blue-400 !w-2 !h-2" />
      <Handle type="source" position={Position.Right} className="!bg-blue-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Network className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-sm font-medium text-card-foreground truncate">{data.label}</span>
        {data.serviceType && (
          <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1 rounded">{data.serviceType}</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-muted-foreground">{data.namespace}</span>
        {data.ports && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{data.ports}</span>
        )}
      </div>
    </div>
  );
}

export function PodNode({ data }: { data: NetworkNodeData }) {
  return (
    <div className="bg-card border rounded-lg px-3 py-2 min-w-[140px] border-l-[3px]" style={{ borderLeftColor: "oklch(0.65 0.17 150)" }}>
      <Handle type="target" position={Position.Left} className="!bg-green-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Box className="h-3.5 w-3.5 text-green-400 shrink-0" />
        <span className="text-xs font-medium text-card-foreground truncate max-w-[120px]">{data.label}</span>
        <StatusDot status={data.status} />
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-muted-foreground">{data.namespace}</span>
        {data.owner && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{data.owner}</span>
        )}
        {data.status && data.status !== "Running" && (
          <span className="text-[9px] text-yellow-400 truncate">{data.status}</span>
        )}
      </div>
    </div>
  );
}

export const nodeTypes = {
  ingress: IngressNode,
  ingressroute: IngressRouteNode,
  service: ServiceNode,
  pod: PodNode,
};
