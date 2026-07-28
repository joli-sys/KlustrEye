

import { useEffect, useRef } from "react";
import { useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { useTabStore, type Tab } from "@/lib/stores/tab-store";
import { SIDEBAR_SECTIONS } from "@/lib/constants";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { fileModelKey, isDirty, releaseIfClean } from "@/lib/editor/model-registry";

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

/**
 * The Monaco registry key for a file tab, or `null` for every other kind.
 *
 * Only `file` tabs own a buffer, and only those carry `payload.path`. Built
 * through the same `fileModelKey` the editor uses — a second spelling of the
 * key would silently fail to find the model and leak it.
 */
function modelKeyForTab(wsId: string, tab: Tab): string | null {
  if (tab.kind !== "file") return null;
  const path = tab.payload?.path;
  return path === undefined ? null : fileModelKey(wsId, path);
}

export function TabBar({ wsId }: { wsId: string }) {
  const pathname = useLocation().pathname;
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirm();

  const tabs = useTabStore((s) => s.tabsByWorkspace[wsId]);
  const activeTabId = useTabStore((s) => s.activeTabIdByWorkspace[wsId] ?? null);
  const { updateActiveTab, setActiveTab, closeTab } = useTabStore();

  /**
   * Closing a tab is the only routine way a buffer stops being reachable, so
   * it is also the only place that can free one. Two rules, in order:
   *
   * 1. Never discard unsaved work silently — a dirty tab asks first.
   * 2. Never dispose a dirty model even after the user confirms. The buffer
   *    outlives the tab and reappears when the file is reopened; leaking it is
   *    recoverable, losing it is not. `releaseIfClean` enforces this.
   */
  const handleClose = async (tab: Tab) => {
    const key = modelKeyForTab(wsId, tab);
    // The registry is the authority on dirtiness; `tab.dirty` is a mirror
    // written by the editor and is only as fresh as its last render.
    const dirty = key ? isDirty(key) : !!tab.dirty;

    if (dirty) {
      const confirmed = await confirm({
        title: "Close tab with unsaved changes?",
        description:
          `${tab.title} has edits that are not written to disk.\n\n` +
          "Nothing on disk changes either way, and the buffer is kept in " +
          "memory until the app closes — reopening the file brings the edits " +
          "back.",
        confirmLabel: "Close tab",
      });
      if (!confirmed) return;
    }

    const wasActive = tab.id === activeTabId;
    closeTab(wsId, tab.id);
    if (key) releaseIfClean(key);

    if (wasActive) {
      // Navigate to the now-active tab
      const state = useTabStore.getState();
      const updatedTabs = state.tabsByWorkspace[wsId] || [];
      const newActiveId = state.activeTabIdByWorkspace[wsId];
      const newActive = updatedTabs.find((t) => t.id === newActiveId);
      if (newActive) navigate(newActive.href);
    }
  };

  // Auto-sync: when URL changes, update the active tab's href/title.
  // Only k8s tabs derive their title from the path — file/terminal/agent/diff
  // tabs carry their own title and must keep it.
  useEffect(() => {
    const search = searchParams.toString();
    const fullHref = search ? `${pathname}?${search}` : pathname;
    const state = useTabStore.getState();
    const activeId = state.activeTabIdByWorkspace[wsId];
    const tab = (state.tabsByWorkspace[wsId] || []).find((t) => t.id === activeId);
    if (!tab) return;
    const title = tab.kind === "k8s" ? deriveTitleFromPath(pathname) : tab.title;
    updateActiveTab(wsId, fullHref, title);
  }, [pathname, searchParams, wsId, updateActiveTab]);

  // Scroll active tab into view
  useEffect(() => {
    if (!activeTabId || !scrollRef.current) return;
    const el = scrollRef.current.querySelector(`[data-tab-id="${activeTabId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId]);

  // Hide when ≤1 tabs
  if (!tabs || tabs.length <= 1) return null;

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
              setActiveTab(wsId, tab.id);
              navigate(tab.href);
            }}
          >
            <span className="truncate">{tab.title}</span>
            {/* The IDE convention: a dot marks unsaved work and gives way to
                the close button on hover, so the two never fight for the slot. */}
            {tab.dirty && (
              <span
                className="ml-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary group-hover:hidden"
                title="Unsaved changes"
              />
            )}
            <button
              className={cn(
                "ml-1 rounded p-0.5 hover:bg-muted transition-opacity",
                tab.dirty ? "hidden group-hover:block" : "opacity-0 group-hover:opacity-100"
              )}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                void handleClose(tab);
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
