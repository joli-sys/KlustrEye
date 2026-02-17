import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_SIZES: Record<string, { width: number; height: number }> = {
  ingress: { width: 200, height: 70 },
  ingressroute: { width: 220, height: 90 },
  service: { width: 180, height: 70 },
  pod: { width: 160, height: 50 },
};

export function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 30 });

  for (const node of nodes) {
    const kind = (node.data as { kind?: string }).kind?.toLowerCase() ?? "pod";
    const size = NODE_SIZES[kind] ?? NODE_SIZES.pod;
    g.setNode(node.id, { width: size.width, height: size.height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const kind = (node.data as { kind?: string }).kind?.toLowerCase() ?? "pod";
    const size = NODE_SIZES[kind] ?? NODE_SIZES.pod;
    return {
      ...node,
      position: {
        x: pos.x - size.width / 2,
        y: pos.y - size.height / 2,
      },
    };
  });
}
