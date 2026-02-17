"use client";

import { use } from "react";
import { NetworkMap } from "@/components/network-map/network-map";

export default function NetworkMapPage({
  params,
}: {
  params: Promise<{ contextName: string }>;
}) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);

  return (
    <div className="h-[calc(100vh-5rem)]">
      <NetworkMap contextName={ctx} />
    </div>
  );
}
