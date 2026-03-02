"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { useNamespaces, useClusters } from "@/hooks/use-clusters";
import { useUIStore } from "@/lib/stores/ui-store";
import { cn } from "@/lib/utils";
import { ChevronDown, Check, Search, Layers } from "lucide-react";

export function NamespaceSelector({ contextName }: { contextName: string }) {
  const { data: namespaces } = useNamespaces(contextName);
  const { data: clusters } = useClusters();
  const ns = useUIStore((s) => s.namespaceByCluster[contextName]);
  const setClusterNamespace = useUIStore((s) => s.setClusterNamespace);
  const hydrated = useRef(false);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [openedViaKeyboard, setOpenedViaKeyboard] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Hydrate from DB if the store has no entry for this cluster
  useEffect(() => {
    if (ns || hydrated.current) return;
    hydrated.current = true;
    const cluster = clusters?.find((c) => c.name === contextName);
    const dbNs = cluster?.lastNamespace ?? "default";
    setClusterNamespace(contextName, dbNs);
  }, [ns, clusters, contextName, setClusterNamespace]);

  const selectedNamespace = ns ?? "default";

  const allOptions = useMemo(() => {
    return [
      { value: "__all__", label: "All Namespaces" },
      ...(namespaces || []).map((n) => ({
        value: n.name,
        label: n.name,
      })),
    ];
  }, [namespaces]);

  const filterLower = filter.toLowerCase();

  const filteredOptions = useMemo(() => {
    if (!filter) return allOptions;
    return allOptions.filter((o) => o.label.toLowerCase().includes(filterLower));
  }, [allOptions, filterLower]);

  // Listen for global Cmd+N toggle event
  useEffect(() => {
    function handleToggle() {
      setOpen((prev) => {
        if (!prev) setOpenedViaKeyboard(true);
        return !prev;
      });
    }
    window.addEventListener("toggle-namespace-selector", handleToggle);
    return () => window.removeEventListener("toggle-namespace-selector", handleToggle);
  }, []);

  // Clear filter and keyboard flag when closing
  useEffect(() => {
    if (!open) {
      setFilter("");
      setOpenedViaKeyboard(false);
    }
  }, [open]);

  // Focus filter input when opening
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => filterInputRef.current?.focus());
    }
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Reset highlight: current namespace on open/clear, first item on filter change
  useEffect(() => {
    if (!open) return;
    if (!filter) {
      const idx = filteredOptions.findIndex((o) => o.value === selectedNamespace);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    } else {
      setHighlightedIndex(0);
    }
  }, [open, filterLower, filteredOptions, selectedNamespace]);

  // Keyboard navigation
  useEffect(() => {
    if (!open || filteredOptions.length === 0) return;
    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((i) => (i + 1) % filteredOptions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex(
            (i) => (i - 1 + filteredOptions.length) % filteredOptions.length
          );
          break;
        case "Enter":
          e.preventDefault();
          if (filteredOptions[highlightedIndex]) {
            selectNamespace(filteredOptions[highlightedIndex].value);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, filteredOptions, highlightedIndex]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    const el = ref.current?.querySelector(
      `[data-ns-index="${highlightedIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlightedIndex]);

  function selectNamespace(value: string) {
    setClusterNamespace(contextName, value);
    setOpen(false);
    // Fire-and-forget save to DB
    fetch(
      `/api/clusters/${encodeURIComponent(contextName)}/settings/namespace`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ namespace: value }),
      }
    ).catch(() => {});
  }

  const displayLabel =
    selectedNamespace === "__all__"
      ? "All Namespaces"
      : selectedNamespace;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring w-32 md:w-48"
        title="Switch namespace (⌘N)"
      >
        <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate flex-1 text-left">{displayLabel}</span>
        <kbd className="pointer-events-none hidden md:inline-flex h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>N
        </kbd>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform text-muted-foreground md:hidden",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 right-0 top-full mt-1 bg-card border rounded-md shadow-lg py-1 min-w-[220px] w-max">
          {(allOptions.length > 5 || openedViaKeyboard) && (
            <div className="px-2 pb-1 pt-1">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={filterInputRef}
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter namespaces..."
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto">
            {filteredOptions.map((opt, index) => {
              const isHighlighted = index === highlightedIndex;
              const isSelected = opt.value === selectedNamespace;
              return (
                <button
                  key={opt.value}
                  data-ns-index={index}
                  onClick={() => selectNamespace(opt.value)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={cn(
                    "flex items-center gap-2 w-full px-3 py-1.5 text-sm text-left",
                    isHighlighted ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <span className="truncate flex-1">{opt.label}</span>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 shrink-0 ml-auto" />
                  )}
                </button>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No namespaces found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
