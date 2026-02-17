"use client";

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useRouter } from "next/navigation";
import { useNetworkGraph, type NetworkNodeData } from "./use-network-graph";
import { layoutGraph } from "./layout";
import { nodeTypes } from "./custom-nodes";
import { getResourceHref } from "@/lib/constants";
import { Share2 } from "lucide-react";

export function NetworkMap({ contextName }: { contextName: string }) {
  const router = useRouter();
  const { nodes: rawNodes, edges: rawEdges, isLoading } = useNetworkGraph(contextName);

  const layoutedNodes = useMemo(
    () => layoutGraph(rawNodes, rawEdges),
    [rawNodes, rawEdges]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  // Sync when data changes
  useMemo(() => {
    setNodes(layoutedNodes);
    setEdges(rawEdges);
  }, [layoutedNodes, rawEdges, setNodes, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const data = node.data as unknown as NetworkNodeData;
      const kindMap: Record<string, string> = {
        Ingress: "ingresses",
        Service: "services",
        Pod: "pods",
      };
      if (data.kind === "IngressRoute") {
        // IngressRoute is a CRD — no built-in detail page
        return;
      }
      const kind = kindMap[data.kind];
      if (kind) {
        const href = getResourceHref(contextName, kind, data.resourceName, data.namespace);
        router.push(href);
      }
    },
    [contextName, router]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          <span className="text-sm">Loading network topology...</span>
        </div>
      </div>
    );
  }

  if (rawNodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Share2 className="h-12 w-12 opacity-30" />
          <p className="text-sm">No network resources found</p>
          <p className="text-xs">Services and Ingresses will appear here when created</p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="[&_.react-flow__node]:cursor-pointer"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="oklch(0.3 0 0)" />
      <Controls
        showInteractive={false}
        className="!bg-card !border !border-border !rounded-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-muted-foreground [&>button:hover]:!bg-accent"
      />
      <MiniMap
        nodeColor={(node) => {
          const kind = (node.data as unknown as NetworkNodeData).kind;
          if (kind === "Ingress") return "oklch(0.65 0.18 300)";
          if (kind === "IngressRoute") return "oklch(0.7 0.18 55)";
          if (kind === "Service") return "oklch(0.648 0.2 260)";
          return "oklch(0.65 0.17 150)";
        }}
        className="!bg-card !border !border-border !rounded-lg"
        maskColor="oklch(0.15 0 0 / 0.7)"
      />
    </ReactFlow>
  );
}
