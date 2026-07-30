import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSearchFiles, type SearchMatch } from "@/hooks/use-files";
import { useTabStore } from "@/lib/stores/tab-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { workspacePath } from "@/lib/paths";

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function groupByPath(matches: SearchMatch[]): Map<string, SearchMatch[]> {
  const groups = new Map<string, SearchMatch[]>();
  for (const m of matches) {
    const list = groups.get(m.path);
    if (list) {
      list.push(m);
    } else {
      groups.set(m.path, [m]);
    }
  }
  return groups;
}

/**
 * Split a preview line into (before, match, after) around the reported
 * column, for highlighting. `column` is a byte offset from the backend and
 * the preview can be truncated, so this is verified against the query
 * before use — a slightly-off highlight is worse than none, so it falls
 * back to plain text rather than risk one.
 */
function splitPreview(
  preview: string,
  column: number,
  query: string
): { before: string; match: string; after: string } | null {
  const end = column + query.length;
  if (
    column < 0 ||
    end > preview.length ||
    preview.slice(column, end).toLowerCase() !== query.toLowerCase()
  ) {
    return null;
  }
  return {
    before: preview.slice(0, column),
    match: preview.slice(column, end),
    after: preview.slice(end),
  };
}

export function FindInFiles({ wsId }: { wsId: string }) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, DEBOUNCE_MS);
  const { openTab } = useTabStore();
  const navigate = useNavigate();
  const pendingSearchQuery = useUIStore((s) => s.pendingSearchQuery);
  const setPendingSearchQuery = useUIStore((s) => s.setPendingSearchQuery);

  // Consumes the one-shot signal from "Search workspace" (file-not-found
  // state): seed the input, then clear it back to null so switching to
  // Search again later never silently re-seeds a stale query.
  useEffect(() => {
    if (pendingSearchQuery === null) return;
    setQuery(pendingSearchQuery);
    setPendingSearchQuery(null);
  }, [pendingSearchQuery, setPendingSearchQuery]);

  const { data, isLoading, isFetching, isError } = useSearchFiles(
    wsId,
    debouncedQuery
  );

  const groups = useMemo(
    () => (data ? groupByPath(data.matches) : null),
    [data]
  );

  const handleOpen = (match: SearchMatch) => {
    // ONE href for both calls — see the same pattern in `file-tree`. Opening
    // the tab alone never mounted the editor, so a result click did nothing
    // visible until the tab was clicked too.
    const href = workspacePath(wsId, "files/" + match.path);
    openTab(wsId, href, basename(match.path), "file", {
      path: match.path,
      line: String(match.line),
    });
    // The line travels in the router's location state, NOT the URL: two
    // matches in one file must resolve to the same href or they would open as
    // two tabs. `FileEditor` reads it back and scrolls there. Navigating to a
    // pathname that is already current still mints a fresh location key, so
    // clicking a second match in the file already open re-fires the jump.
    navigate(href, { state: { line: match.line } });
  };

  const showResults = debouncedQuery.length >= MIN_QUERY_LENGTH;

  return (
    <div className="mb-1">
      <div className="flex items-center gap-2 px-2 py-1.5 mx-1 rounded-md border bg-background">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find in files..."
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {isFetching && showResults && (
          <Loader2 className="h-3 w-3 shrink-0 text-muted-foreground animate-spin" />
        )}
        {query && !isFetching && (
          <button
            className="shrink-0 p-0.5 rounded hover:bg-accent transition-colors"
            onClick={() => setQuery("")}
            title="Clear"
          >
            <X className="h-3 w-3 text-muted-foreground" />
          </button>
        )}
      </div>

      {query.length > 0 && !showResults && (
        <p className="px-3 py-1 text-xs text-muted-foreground">
          Type at least {MIN_QUERY_LENGTH} characters
        </p>
      )}

      {showResults && isLoading && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          Searching...
        </div>
      )}

      {showResults && isError && (
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Search failed
        </div>
      )}

      {showResults && !isLoading && !isError && groups && groups.size === 0 && (
        <p className="px-3 py-1 text-xs text-muted-foreground">No matches</p>
      )}

      {showResults && !isLoading && !isError && groups && groups.size > 0 && (
        <div>
          {[...groups.entries()].map(([path, matches]) => (
            <div key={path}>
              <div
                className="px-3 py-1 mx-1 text-sm font-medium text-foreground truncate"
                title={path}
              >
                {basename(path)}
              </div>
              {matches.map((m, i) => {
                const split = splitPreview(m.preview, m.column, debouncedQuery);
                return (
                  <div
                    key={`${path}-${m.line}-${i}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpen(m)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleOpen(m);
                      }
                    }}
                    className={cn(
                      "flex items-baseline gap-2 px-3 py-1 mx-1 rounded-md text-xs cursor-pointer transition-colors",
                      "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                    style={{ paddingLeft: "26px" }}
                    title={`${path}:${m.line}`}
                  >
                    <span className="shrink-0 tabular-nums text-muted-foreground/70">
                      {m.line}
                    </span>
                    <span className="truncate font-mono">
                      {split ? (
                        <>
                          {split.before}
                          <mark className="bg-primary/30 text-foreground rounded-sm">
                            {split.match}
                          </mark>
                          {split.after}
                        </>
                      ) : (
                        m.preview
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {data?.truncated && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground italic">
              Showing first {data.matches.length} matches; refine your search.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
