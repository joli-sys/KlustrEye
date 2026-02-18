"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { useTabStore } from "@/lib/stores/tab-store";
import { SIDEBAR_SECTIONS } from "@/lib/constants";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** Build a lookup from href suffix → label from sidebar sections */
const hrefToLabel: Record<string, string> = {};
for (const section of SIDEBAR_SECTIONS) {
  for (const item of section.items) {
    hrefToLabel[item.href] = item.label;
  }
}

function deriveTitleFromPath(pathname: string): string {
  // pathname like /clusters/<ctx>/workloads/pods/my-pod
  const parts = pathname.split("/");
  // Find index of "clusters" and skip context
  const clustersIdx = parts.indexOf("clusters");
  if (clustersIdx === -1) return parts[parts.length - 1] || "Page";
  const subParts = parts.slice(clustersIdx + 2); // after contextName
  const subPath = subParts.join("/");

  // Check exact sidebar match
  if (hrefToLabel[subPath]) return hrefToLabel[subPath];

  // Check if the parent path matches a sidebar entry (detail page)
  const parentPath = subParts.slice(0, -1).join("/");
  if (hrefToLabel[parentPath]) {
    // It's a detail page — use the resource name (last segment)
    return decodeURIComponent(subParts[subParts.length - 1]);
  }

  // Fallback: prettify last segment
  const last = subParts[subParts.length - 1] || "Page";
  return decodeURIComponent(last)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function TabBar({ contextName }: { contextName: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);

  const tabs = useTabStore((s) => s.getTabs(contextName));
  const activeTabId = useTabStore((s) => s.getActiveTabId(contextName));
  const { updateActiveTab, setActiveTab, closeTab } = useTabStore();

  // Auto-sync: when URL changes, update the active tab's href/title
  useEffect(() => {
    const search = searchParams.toString();
    const fullHref = search ? `${pathname}?${search}` : pathname;
    const title = deriveTitleFromPath(pathname);
    updateActiveTab(contextName, fullHref, title);
  }, [pathname, searchParams, contextName, updateActiveTab]);

  // Scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  // Hide when ≤1 tabs
  if (tabs.length <= 1) return null;

  return (
    <div
      ref={scrollRef}
      className="flex items-center border-b bg-card overflow-x-auto scrollbar-none"
      style={{ minHeight: 32 }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            className={cn(
              "group flex items-center gap-1 px-3 py-1 text-xs cursor-pointer border-b-2 shrink-0 max-w-[180px] transition-colors",
              isActive
                ? "border-primary text-foreground bg-muted/30"
                : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/20"
            )}
            onClick={() => {
              setActiveTab(contextName, tab.id);
              router.push(tab.href);
            }}
          >
            <span className="truncate">{tab.title}</span>
            <button
              className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                const wasActive = tab.id === activeTabId;
                closeTab(contextName, tab.id);
                if (wasActive) {
                  // Navigate to the now-active tab
                  const updatedTabs = useTabStore.getState().getTabs(contextName);
                  const newActiveId = useTabStore.getState().getActiveTabId(contextName);
                  const newActive = updatedTabs.find((t) => t.id === newActiveId);
                  if (newActive) router.push(newActive.href);
                }
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
