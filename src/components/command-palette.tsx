"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { useUIStore } from "@/lib/stores/ui-store";
import { useSavedSearches } from "@/lib/stores/saved-searches-store";
import { SIDEBAR_SECTIONS, getResourceHref, RESOURCE_ROUTE_MAP, RESOURCE_REGISTRY, type ResourceKind } from "@/lib/constants";
import { useResourceSearch, type SearchResult } from "@/hooks/use-search";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Loader2, X, Star } from "lucide-react";
import { cn } from "@/lib/utils";

type PaletteItem =
  | { type: "page"; label: string; href: string; section: string }
  | { type: "resource"; result: SearchResult; href: string }
  | { type: "favorite"; id: string; name: string; kind: string; query: string; namespace?: string; href: string };

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, setSelectedNamespace } = useUIStore();
  const { searches: savedSearches, removeSearch } = useSavedSearches();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const params = useParams();
  const contextName = params?.contextName as string;
  const ctx = contextName ? decodeURIComponent(contextName) : "";

  const favoriteItems: PaletteItem[] = useMemo(() => {
    if (query || !ctx || savedSearches.length === 0) return [];
    return savedSearches.map((s) => {
      const route = RESOURCE_ROUTE_MAP[s.kind];
      const path = route?.path ?? s.kind;
      const href = `/clusters/${encodeURIComponent(ctx)}/${path}?filter=${encodeURIComponent(s.query)}`;
      return {
        type: "favorite" as const,
        id: s.id,
        name: s.name,
        kind: s.kind,
        query: s.query,
        namespace: s.namespace,
        href,
      };
    });
  }, [query, ctx, savedSearches]);

  const debouncedQuery = useDebounce(query, 300);
  const { data: searchData, isFetching } = useResourceSearch(
    ctx,
    debouncedQuery
  );

  const pageItems = useMemo(() => {
    const items: PaletteItem[] = [];
    for (const section of SIDEBAR_SECTIONS) {
      for (const item of section.items) {
        items.push({
          type: "page",
          label: item.label,
          href: `/clusters/${contextName ? encodeURIComponent(contextName) : ""}/${item.href}`,
          section: section.title,
        });
      }
    }
    return items;
  }, [contextName]);

  const filteredPages = useMemo(() => {
    if (!query) return pageItems;
    const q = query.toLowerCase();
    return pageItems.filter((item) => {
      if (item.type !== "page") return false;
      return (
        item.label.toLowerCase().includes(q) ||
        item.section.toLowerCase().includes(q)
      );
    });
  }, [query, pageItems]);

  const resourceItems: PaletteItem[] = useMemo(() => {
    if (!searchData?.results?.length || !ctx) return [];
    return searchData.results.map((r) => ({
      type: "resource" as const,
      result: r,
      href: getResourceHref(ctx, r.kind, r.name, r.namespace),
    }));
  }, [searchData, ctx]);

  const flatItems = useMemo(() => {
    return [...favoriteItems, ...filteredPages, ...resourceItems];
  }, [favoriteItems, filteredPages, resourceItems]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === "Escape") {
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, searchData]);

  const navigate = useCallback(
    (item: PaletteItem) => {
      if (item.type === "favorite") {
        setSelectedNamespace(item.namespace ?? "__all__");
      }
      router.push(item.href);
      setCommandPaletteOpen(false);
    },
    [router, setCommandPaletteOpen, setSelectedNamespace]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatItems[selectedIndex]) {
      navigate(flatItems[selectedIndex]);
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-index="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!commandPaletteOpen) return null;

  const showResourceSection = query.length >= 2 && ctx && resourceItems.length > 0;
  const showLoading = query.length >= 2 && ctx && isFetching && resourceItems.length === 0;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div className="fixed inset-0 bg-black/60" onClick={() => setCommandPaletteOpen(false)} />
      <div className="relative z-50 w-full max-w-lg bg-card border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages & resources..."
            className="border-0 focus-visible:ring-0 shadow-none h-12"
          />
          {isFetching && query.length >= 2 && (
            <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />
          )}
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {/* Favorites section */}
          {favoriteItems.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Star className="h-3 w-3" />
                Favorites
              </div>
              {favoriteItems.map((item) => {
                if (item.type !== "favorite") return null;
                const idx = flatIndex++;
                const registry = RESOURCE_REGISTRY[item.kind as ResourceKind];
                const kindLabel = registry?.labelPlural ?? item.kind;
                return (
                  <button
                    key={item.id}
                    data-index={idx}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-accent transition-colors group",
                      idx === selectedIndex && "bg-accent"
                    )}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="font-medium truncate">{item.name}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
                      {kindLabel}
                    </Badge>
                    {item.namespace && (
                      <span className="text-xs text-muted-foreground shrink-0">{item.namespace}</span>
                    )}
                    <span
                      role="button"
                      className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeSearch(item.id);
                      }}
                    >
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                  </button>
                );
              })}
            </>
          )}

          {/* Pages section */}
          {filteredPages.length > 0 && (
            <>
              {(showResourceSection || query.length >= 2 || favoriteItems.length > 0) && (
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Pages
                </div>
              )}
              {filteredPages.map((item) => {
                if (item.type !== "page") return null;
                const idx = flatIndex++;
                return (
                  <button
                    key={item.href}
                    data-index={idx}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-accent transition-colors",
                      idx === selectedIndex && "bg-accent"
                    )}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.section}</span>
                  </button>
                );
              })}
            </>
          )}

          {/* Resources section */}
          {showResourceSection && (
            <>
              <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider mt-1 border-t pt-2">
                Resources
              </div>
              {resourceItems.map((item) => {
                if (item.type !== "resource") return null;
                const r = item.result;
                const idx = flatIndex++;
                return (
                  <button
                    key={`${r.kind}-${r.namespace}-${r.name}`}
                    data-index={idx}
                    className={cn(
                      "w-full text-left px-4 py-2 text-sm flex items-center gap-2 hover:bg-accent transition-colors",
                      idx === selectedIndex && "bg-accent"
                    )}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <span className="font-medium truncate">{r.name}</span>
                    {r.namespace && (
                      <span className="text-xs text-muted-foreground shrink-0">{r.namespace}</span>
                    )}
                    <Badge variant="outline" className="ml-auto shrink-0 text-[10px] px-1.5 py-0">
                      {r.kindLabel}
                    </Badge>
                    {r.matchDetail && (
                      <span className="text-[10px] text-muted-foreground shrink-0 max-w-[140px] truncate">
                        {r.matchDetail}
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {showLoading && (
            <div className="px-4 py-4 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching...
            </div>
          )}

          {flatItems.length === 0 && !showLoading && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No results found
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
