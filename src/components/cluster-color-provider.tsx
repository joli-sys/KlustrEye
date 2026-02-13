"use client";

import { useClusters } from "@/hooks/use-clusters";
import { COLOR_PRESETS, DEFAULT_COLOR_SCHEME } from "@/lib/color-presets";

interface ClusterColorProviderProps {
  contextName: string;
  children: React.ReactNode;
}

export function ClusterColorProvider({
  contextName,
  children,
}: ClusterColorProviderProps) {
  const { data: clusters } = useClusters();
  const cluster = clusters?.find((c) => c.name === contextName);
  const preset =
    COLOR_PRESETS[cluster?.colorScheme ?? ""] ??
    COLOR_PRESETS[DEFAULT_COLOR_SCHEME];

  return (
    <div
      className="contents"
      style={
        {
          "--primary": preset.primary,
          "--ring": preset.ring,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
