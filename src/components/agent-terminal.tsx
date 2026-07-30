import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import type { ISearchOptions, SearchAddon } from "@xterm/addon-search";
import {
  AlertTriangle,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  Loader2,
  Search,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { useWorkspace } from "@/hooks/use-workspaces";
import { basename, findFileReferences, resolveFileReference } from "@/lib/file-link";
import { workspacePath } from "@/lib/paths";
import { useTabStore } from "@/lib/stores/tab-store";
import { cn } from "@/lib/utils";

const TerminalComponent = lazy(() =>
  import("./terminal-inner").then((m) => ({ default: m.TerminalInner }))
);

/**
 * The fields of an agent session this view actually reads.
 *
 * Deliberately a local shape rather than a shared one: everything here comes
 * from `GET /api/workspaces/:wsId/agent-sessions`, and the query key matches
 * the sidebar's, so the two share one cache entry without sharing a module.
 *
 * `activity` and `waitingConfidence` are optional for the same reason they are
 * in `use-agents`: a client talking to an older backend never sees them, so
 * their absence has to read as "unknown", not as a state.
 */
interface AgentSession {
  id: string;
  title: string;
  status: string;
  exitCode: number | null;
  /**
   * The directory the agent process was started in. Null for a session that
   * took the workspace's folder, and for rows written before per-session
   * working directories existed — see `AgentSessionRow` in the backend.
   */
  cwd?: string | null;
  activity?: "working" | "waiting" | "exited";
  waitingConfidence?: "high" | "low" | null;
}

/**
 * Built from `window.location.host`, never from the current pathname.
 *
 * The page is served from the same origin as the backend, so the host is the
 * one thing that is always right; deriving a socket URL from the route would
 * make it depend on which workspace tab happens to be open.
 */
function agentWsUrl(sessionId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/agent/${encodeURIComponent(sessionId)}`;
}

/**
 * Search decorations must be passed on every call, not once at construction:
 * `onDidChangeResults` only fires while they are enabled, and that event is
 * the only source of a match count.
 */
const SEARCH_OPTIONS: ISearchOptions = {
  decorations: {
    matchBackground: "#553d00",
    matchOverviewRuler: "#a37f00",
    activeMatchBackground: "#a37f00",
    activeMatchColorOverviewRuler: "#ffcc00",
  },
};

/**
 * Run a search-addon call without letting a failure take down the pane.
 *
 * The addon threw "You must set the allowProposedApi option to true" straight
 * through React, so the ErrorBoundary replaced the WHOLE agent session — a live
 * terminal lost because a search failed. The option is set now
 * (terminal-inner.tsx), but a search is never worth the session.
 */
function safeSearch(run: () => void): void {
  try {
    run();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Terminal search failed:", e);
  }
}

/**
 * The same discipline as `safeSearch`, for the file-link provider.
 *
 * `provideLinks` runs on mouse move over the transcript and reaches into the
 * buffer cell by cell, so a torn-down terminal or an unexpected line shape is
 * a throw inside a callback xterm invokes — which would climb into React and
 * let the ErrorBoundary replace a LIVE agent session. A link is never worth
 * the session; a failed one just leaves plain text.
 */
function safeLink(run: () => void): void {
  try {
    run();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Terminal file links failed:", e);
  }
}

/**
 * One agent session's PTY, attached over `/ws/agent/:session_id`, wrapped in
 * chat-like chrome: a header, scrollback search, a jump-to-latest control and
 * a sticky composer.
 *
 * The transcript itself stays a real terminal. A CLI agent emits ANSI — cursor
 * moves, in-place redraws, spinners — not a stream of messages, so there is
 * nothing to parse into bubbles and any attempt would break the first time an
 * agent redrew a line. The chat feeling comes from the chrome around xterm,
 * and the terminal stays directly focusable and typeable underneath it because
 * interactive agents read raw-mode keys (arrows, Ctrl-C) that a text input
 * cannot express.
 *
 * Attaching replays the session's scrollback and then streams live output, and
 * detaching leaves the process running — so unmounting this route, or closing
 * the tab that holds it, is not a way to stop an agent. Killing one is the
 * sidebar's job.
 */
export function AgentTerminal() {
  const wsId = useWorkspaceId();
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const openTab = useTabStore((s) => s.openTab);
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState<Terminal | null>(null);
  const [search, setSearch] = useState<SearchAddon | null>(null);
  const sendRef = useRef<(data: string) => void>(() => {});

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: sessions, isLoading, isError, error } = useQuery<AgentSession[]>({
    queryKey: ["agent-sessions", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const res = await fetch(
        `/api/workspaces/${encodeURIComponent(wsId)}/agent-sessions`
      );
      if (!res.ok) throw new Error("Failed to fetch agent sessions");
      return res.json();
    },
    // An exit arrives down the socket as a notice, not as a status change this
    // query would notice, so poll while the session is alive and stop the
    // moment it is not — an exited session's row never changes again.
    refetchInterval: (query) =>
      query.state.data?.some((s) => s.id === sessionId && s.status === "running")
        ? 5000
        : false,
  });

  const { data: workspace } = useWorkspace(wsId);
  const folderPath = workspace?.folderPath ?? null;

  const session = sessions?.find((s) => s.id === sessionId);

  /**
   * Where this agent's relative paths point.
   *
   * A session can be started anywhere now, so the workspace folder is only the
   * FALLBACK — the same one `choose_cwd` applies on the backend when a session
   * carries no explicit cwd. Reading the folder first would resolve `src/x.ts`
   * from an agent running in `backend/` to the wrong file entirely.
   */
  const cwd = session?.cwd ?? folderPath;
  const exited = session !== undefined && session.status !== "running";
  const hasSession = session !== undefined;

  /**
   * An exited session's PTY is gone: what is on screen is a transcript, not a
   * prompt. xterm has no way to know that, so keystrokes would still travel
   * down the socket and disappear.
   *
   * Blocked in the CAPTURE phase on the wrapper, with a native listener: xterm
   * reads input from a helper textarea it owns, and stopping the event before
   * it reaches that element is the only way to disarm it from outside the
   * component. Modifier combos are let through so copy and select-all still
   * work on the scrollback, which is the entire reason to open a dead session.
   *
   * Only the terminal frame is wrapped, never the chrome: the search field and
   * composer live outside it, so searching a dead session still works.
   */
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !exited) return;
    const block = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      e.stopPropagation();
    };
    frame.addEventListener("keydown", block, true);
    return () => frame.removeEventListener("keydown", block, true);
  }, [exited]);

  const handleReady = useCallback((instance: Terminal, send: (data: string) => void) => {
    sendRef.current = send;
    setTerm(instance);
  }, []);

  /**
   * The search addon is fetched on demand — this component is statically
   * routed, so a top-level import would put the addon in the entry bundle
   * alongside a terminal that is itself lazily loaded.
   *
   * The terminal can be disposed (or, under StrictMode, replaced) before the
   * chunk lands, so a late arrival is discarded rather than loaded into a dead
   * instance.
   */
  useEffect(() => {
    if (!term) return;
    let cancelled = false;
    void import("@xterm/addon-search").then(({ SearchAddon }) => {
      if (cancelled) return;
      const addon = new SearchAddon();
      term.loadAddon(addon);
      setSearch(addon);
    });
    return () => {
      cancelled = true;
      setSearch(null);
    };
  }, [term]);

  // Follow the viewport rather than polling it: xterm reports every scroll,
  // whether the user drove it or new output did.
  useEffect(() => {
    if (!term) return;
    const update = () => {
      const buffer = term.buffer.active;
      setAtBottom(buffer.viewportY >= buffer.baseY);
    };
    update();
    const disposable = term.onScroll(update);
    return () => disposable.dispose();
  }, [term]);

  /**
   * Open a file the agent named, in the editor, at the line it named.
   *
   * BOTH calls, in this order. `openTab` registers the tab but does not route
   * anywhere, so on its own it leaves a tab that looks selected over whatever
   * was already on screen — a bug that shipped here once already. `navigate`
   * is what actually mounts the editor, and the two must agree on one href or
   * `openTab`'s dedup (keyed on href) opens a second tab for the same file.
   *
   * The line rides in the router's location state rather than the URL, for the
   * same reason `find-in-files` does it: two references to one file have to
   * resolve to the same href. `FileEditor` reads it back and reveals the line.
   */
  const openFile = useCallback(
    (path: string, line?: number) => {
      const href = workspacePath(wsId, `files/${path}`);
      openTab(wsId, href, basename(path), "file", { path });
      // No `state` at all when there is no line: an explicit `{ line:
      // undefined }` would still be a fresh state object, and the editor's
      // reveal effect keys off the location, not off the value.
      if (line === undefined) navigate(href);
      else navigate(href, { state: { line } });
    },
    [wsId, openTab, navigate]
  );

  /**
   * File paths in the transcript become links.
   *
   * A separate provider from the web-links addon that `terminal-inner` loads:
   * that one owns URLs, this one owns paths, and neither can express the
   * other's rules. Re-registered whenever the resolution inputs change,
   * because the provider closes over them — and disposed on the way out, since
   * a provider left on a disposed terminal is a leak and a stale closure.
   *
   * Nothing is registered without a bound folder: the file API is confined to
   * one, so every path would resolve to "not linkable" anyway.
   */
  useEffect(() => {
    if (!term || !folderPath) return;
    const disposable = term.registerLinkProvider(
      createFileLinkProvider(term, cwd, folderPath, openFile)
    );
    return () => disposable.dispose();
  }, [term, cwd, folderPath, openFile]);

  // The addon's own count, which knows about the whole scrollback. `index` is
  // -1 when there are more matches than it will decorate.
  useEffect(() => {
    if (!search) return;
    const disposable = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setMatches({ index: resultIndex, count: resultCount });
    });
    return () => disposable.dispose();
  }, [search]);

  /**
   * Re-run as the query is typed. `incremental` grows the current selection
   * while the term still matches instead of jumping to the following hit, so
   * typing does not walk the viewport down the buffer.
   */
  useEffect(() => {
    if (!search || !searchOpen) return;
    if (!searchQuery) {
      safeSearch(() => search.clearDecorations());
      setMatches(null);
      return;
    }
    safeSearch(() =>
      search.findNext(searchQuery, { ...SEARCH_OPTIONS, incremental: true })
    );
  }, [search, searchOpen, searchQuery]);

  useEffect(() => {
    if (searchOpen) focusSearchField(searchInputRef.current);
  }, [searchOpen]);

  /**
   * Cmd/Ctrl+F, in the CAPTURE phase on the whole view.
   *
   * Capturing on an ancestor is what lets this win from inside the terminal:
   * xterm handles keys on a textarea it owns, and the event has to be taken
   * before it gets there. The same listener covers the chrome, so the shortcut
   * behaves the same wherever focus happens to be.
   *
   * Escape is deliberately NOT handled here — it is a live key for the agent
   * (menus, vim), so it only dismisses search from the fields that own it.
   *
   * `hasSession` is in the deps because the element this attaches to only
   * exists once the session has loaded — every earlier render returns a
   * different branch, so without it the first run would find a null ref and
   * nothing would ever re-run to attach the listener.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.altKey || !(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      // Already open: the effect above will not re-fire, so focus here.
      if (searchOpen) focusSearchField(searchInputRef.current);
      else setSearchOpen(true);
    };
    root.addEventListener("keydown", onKeyDown, true);
    return () => root.removeEventListener("keydown", onKeyDown, true);
  }, [searchOpen, hasSession]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setMatches(null);
    safeSearch(() => search?.clearDecorations());
    term?.focus();
  }, [search, term]);

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
      return;
    }
    if (e.key !== "Enter" || !searchQuery) return;
    e.preventDefault();
    if (e.shiftKey) safeSearch(() => search?.findPrevious(searchQuery, SEARCH_OPTIONS));
    else safeSearch(() => search?.findNext(searchQuery, SEARCH_OPTIONS));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (exited || !draft) return;
    // `\r` is what a terminal sends for Return; `\n` would leave line-based
    // prompts waiting for the rest of the line.
    sendRef.current(`${draft}\r`);
    setDraft("");
    term?.scrollToBottom();
  };

  const copyTranscript = async () => {
    if (!term) return;
    try {
      await navigator.clipboard.writeText(readTranscript(term));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Reset the copied acknowledgement without leaving a timer behind on unmount.
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Centered
        title="Could not load this agent session"
        detail={error instanceof Error ? error.message : sessionId}
      />
    );
  }

  if (!session) {
    return (
      <Centered
        title="This agent session no longer exists"
        detail={sessionId}
        note="Its record was removed. Start a new session from the Agents panel."
      />
    );
  }

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="shrink-0 truncate text-xs font-medium">{session.title}</span>
        <ActivityBadge session={session} exited={exited} />
        {cwd && (
          <span
            className="hidden min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground md:inline"
            title={cwd}
          >
            {cwd}
          </span>
        )}
        <div className="flex-1" />
        {exited && (
          <span className="hidden shrink-0 text-xs text-muted-foreground lg:inline">
            Read-only — this session has ended
          </span>
        )}
        <span className="hidden shrink-0 truncate font-mono text-[11px] text-muted-foreground xl:inline">
          {session.id}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label="Search transcript"
          aria-pressed={searchOpen}
          title="Search transcript (⌘F / Ctrl+F)"
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          aria-label="Copy transcript"
          title="Copy the full transcript as plain text"
          disabled={!term}
          onClick={copyTranscript}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {searchOpen && (
        <div className="flex items-center gap-1 border-b bg-muted/40 px-3 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            onBlur={() => search?.clearActiveDecoration()}
            placeholder="Find in transcript"
            aria-label="Find in transcript"
            autoComplete="off"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          <span
            aria-live="polite"
            className="shrink-0 tabular-nums text-[11px] text-muted-foreground"
          >
            {matchLabel(searchQuery, matches)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Previous match"
            title="Previous match (Shift+Enter)"
            disabled={!searchQuery || !search}
            onClick={() => safeSearch(() => search?.findPrevious(searchQuery, SEARCH_OPTIONS))}
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Next match"
            title="Next match (Enter)"
            disabled={!searchQuery || !search}
            onClick={() => safeSearch(() => search?.findNext(searchQuery, SEARCH_OPTIONS))}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            aria-label="Close search"
            title="Close search (Esc)"
            onClick={closeSearch}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={frameRef}
          aria-readonly={exited || undefined}
          className={cn(
            "h-full bg-black",
            // Not decoration: the dashed rule is the only thing on screen once
            // the header scrolls out of a small pane that says this terminal
            // takes no input.
            exited && "border-t-2 border-dashed border-muted-foreground/40"
          )}
        >
          <Suspense fallback={<Skeleton className="h-full w-full" />}>
            <TerminalComponent
              /**
               * Keyed by session so each one gets its OWN xterm instance.
               *
               * `TerminalInner` deliberately creates its terminal once and only
               * reconnects the socket when `wsUrl` changes — right for the
               * cluster shell, wrong here: attaching replays the session's
               * scrollback, so switching A -> B appended B's transcript to A's
               * buffer, and coming back to A appended A's again. Both agents'
               * output ended up interleaved in one pane.
               *
               * `terminal-panel.tsx` and `cluster-shell-terminal.tsx` already
               * key theirs; this was the one that did not.
               */
              key={sessionId}
              wsUrl={agentWsUrl(sessionId)}
              className="h-full"
              // The backend opens with the scrollback replay; a "Connected"
              // banner would be written on top of the agent's own first line.
              connectMessage=""
              onReady={handleReady}
            />
          </Suspense>
        </div>

        {/* Outside the frame on purpose: the exited-session key blocker above
            swallows unmodified keys, which would break activating this from
            the keyboard on exactly the sessions people scroll back through. */}
        {!atBottom && (
          <Button
            variant="secondary"
            size="sm"
            className="absolute bottom-3 right-5 h-7 gap-1 shadow-lg"
            onClick={() => {
              term?.scrollToBottom();
              term?.focus();
            }}
          >
            <ArrowDown className="h-3.5 w-3.5" />
            Jump to latest
          </Button>
        )}
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            term?.focus();
          }}
          disabled={exited}
          placeholder={
            exited ? "This session has ended" : "Message the agent — Enter to send"
          }
          title="Sends a line of text. Raw keys (arrows, Ctrl-C, Tab) go to the terminal itself — click it and type there."
          aria-label="Message the agent"
          className="h-8 text-xs"
        />
        <Button type="submit" size="sm" className="h-8 shrink-0 gap-1" disabled={exited || !draft}>
          <CornerDownLeft className="h-3.5 w-3.5" />
          Send
        </Button>
      </form>
    </div>
  );
}

/** Focus and select in one step, so a repeat ⌘F replaces the previous term. */
function focusSearchField(field: HTMLInputElement | null) {
  field?.focus();
  field?.select();
}

/**
 * Reads the whole scrollback as plain text.
 *
 * The buffer holds decoded cells, so ANSI is already gone by the time it gets
 * here — nothing to strip. Two things do need handling: a line xterm wrapped
 * is a separate row and must be rejoined rather than broken mid-word, and the
 * buffer is padded out to the viewport height, so a short session would
 * otherwise copy as mostly blank lines.
 */
function readTranscript(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buffer.length; i++) {
    const line = buffer.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length > 0) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

/**
 * How far the wrap-joining below will walk in either direction. xterm's own
 * web-links addon uses the same bound, for the same reason: a pathological
 * unbroken line must not make a mouse move O(scrollback).
 */
const WRAP_SCAN_LIMIT = 2048;

/**
 * An xterm link provider for the file paths an agent prints.
 *
 * Matching and resolution are `@/lib/file-link`'s job and are tested there.
 * What is left here is the part that genuinely needs a terminal: joining
 * wrapped rows back into the logical line the agent actually wrote, and
 * mapping string offsets in that line back to buffer cells.
 */
function createFileLinkProvider(
  term: Terminal,
  cwd: string | null,
  folderPath: string,
  onOpen: (path: string, line?: number) => void
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      let links: ILink[] | undefined;
      safeLink(() => {
        links = computeFileLinks(term, bufferLineNumber, cwd, folderPath, onOpen);
      });
      // Always answered, even after a failure: xterm waits on this callback,
      // and never calling it would stall link detection for the whole row.
      callback(links);
    },
  };
}

function computeFileLinks(
  term: Terminal,
  bufferLineNumber: number,
  cwd: string | null,
  folderPath: string,
  onOpen: (path: string, line?: number) => void
): ILink[] | undefined {
  const { text, topIndex } = windowedLine(term, bufferLineNumber - 1);
  if (!text) return undefined;

  const links: ILink[] = [];
  for (const ref of findFileReferences(text)) {
    const target = resolveFileReference(ref.path, cwd, folderPath);
    // Left as plain text on purpose. The filesystem API is confined to the
    // workspace folder and answers 403 outside it, so underlining this would
    // be an invitation to a click that cannot work.
    if (!target.linkable) continue;

    const [startY, startX] = mapStringIndex(term, topIndex, 0, ref.start);
    if (startY === -1) continue;
    const [endY, endX] = mapStringIndex(term, startY, startX, ref.length);
    if (endY === -1) continue;

    const tooltip = `Open ${target.absolutePath}${ref.line === undefined ? "" : `:${ref.line}`}`;
    let hoverElement: HTMLElement | null = null;
    const clearHover = () => {
      hoverElement?.remove();
      hoverElement = null;
    };

    links.push({
      // 1-based and right-inclusive, which `mapStringIndex` is not: the start
      // needs +1, the end is already the cell past the match.
      range: { start: { x: startX + 1, y: startY + 1 }, end: { x: endX, y: endY + 1 } },
      text: text.slice(ref.start, ref.start + ref.length),
      activate: () => safeLink(() => onOpen(target.path, ref.line)),
      hover: (event) =>
        safeLink(() => {
          clearHover();
          hoverElement = showLinkTooltip(term, event, tooltip);
        }),
      leave: () => safeLink(clearHover),
      // xterm releases links on every re-render of the row, so without this a
      // tooltip whose link is dropped mid-hover would never be taken down.
      dispose: () => safeLink(clearHover),
    });
  }

  return links.length > 0 ? links : undefined;
}

/**
 * The wrapped rows around `lineIndex`, joined, plus the buffer index of the
 * first of them.
 *
 * A terminal breaks a long line across rows, so `src/lib/` and `main.tf:42`
 * can sit on different ones — matching a single row would miss the reference
 * and, worse, could match the tail on its own and link a path that never
 * existed. Ported from xterm's web-links addon (`LinkComputer`), including its
 * stop-at-whitespace heuristic: a row containing a space cannot be the middle
 * of an unbroken token, so the scan stops there.
 */
function windowedLine(term: Terminal, lineIndex: number): { text: string; topIndex: number } {
  const buffer = term.buffer.active;
  const current = buffer.getLine(lineIndex);
  if (!current) return { text: "", topIndex: lineIndex };

  const currentText = current.translateToString(true);
  const lines: string[] = [];
  let topIndex = lineIndex;
  let length = 0;

  if (current.isWrapped && currentText[0] !== " ") {
    while (length < WRAP_SCAN_LIMIT) {
      const previous = buffer.getLine(topIndex - 1);
      // Do NOT move topIndex past a row that is not there — it is the anchor
      // the offsets below are measured from.
      if (!previous) break;
      topIndex--;
      const text = previous.translateToString(true);
      length += text.length;
      lines.push(text);
      if (!previous.isWrapped || text.includes(" ")) break;
    }
    lines.reverse();
  }

  lines.push(currentText);

  length = 0;
  for (let i = lineIndex + 1; length < WRAP_SCAN_LIMIT; i++) {
    const next = buffer.getLine(i);
    if (!next || !next.isWrapped) break;
    const text = next.translateToString(true);
    length += text.length;
    lines.push(text);
    if (text.includes(" ")) break;
  }

  return { text: lines.join(""), topIndex };
}

/**
 * A string offset within a joined line, back to a `[lineIndex, column]` cell
 * position — both 0-based — or `[-1, -1]` if it runs off the end of the
 * buffer.
 *
 * Not arithmetic: `translateToString` collapses a double-width character into
 * one string character occupying two cells, so the only reliable way across is
 * to walk the cells. Ported from xterm's web-links addon, wide-char correction
 * included.
 */
function mapStringIndex(
  term: Terminal,
  lineIndex: number,
  startColumn: number,
  stringIndex: number
): [number, number] {
  const buffer = term.buffer.active;
  const cell = buffer.getNullCell();
  let line = lineIndex;
  let start = startColumn;
  let remaining = stringIndex;

  while (remaining) {
    const bufferLine = buffer.getLine(line);
    if (!bufferLine) return [-1, -1];
    for (let i = start; i < bufferLine.length; i++) {
      bufferLine.getCell(i, cell);
      const chars = cell.getChars();
      if (cell.getWidth()) {
        remaining -= chars.length || 1;
        // A wide character that did not fit is pushed to the next row, leaving
        // this cell empty; the string has no character for it, so give one
        // back.
        if (i === bufferLine.length - 1 && chars === "") {
          const wrapped = buffer.getLine(line + 1);
          if (wrapped?.isWrapped) {
            wrapped.getCell(0, cell);
            if (cell.getWidth() === 2) remaining += 1;
          }
        }
      }
      if (remaining < 0) return [line, i];
    }
    line++;
    start = 0;
  }

  return [line, start];
}

/**
 * A hover label saying what a click will open.
 *
 * Built by hand rather than with a `title` attribute because a terminal row is
 * a run of cells, not an element per link — there is nothing to hang one on.
 * The `xterm-hover` class is xterm's own contract: it stops the pointer from
 * falling through the label and activating whatever link is underneath.
 */
function showLinkTooltip(term: Terminal, event: MouseEvent, label: string): HTMLElement | null {
  const host = term.element;
  if (!host) return null;

  const bounds = host.getBoundingClientRect();
  const element = document.createElement("div");
  element.className = "xterm-hover";
  element.textContent = label;
  element.style.cssText = [
    "position:absolute",
    "z-index:10",
    "max-width:90%",
    "padding:2px 6px",
    "border-radius:4px",
    "background:#1f1f1f",
    "color:#e5e5e5",
    "border:1px solid #3f3f3f",
    "font-size:11px",
    "font-family:inherit",
    "white-space:nowrap",
    "overflow:hidden",
    "text-overflow:ellipsis",
    "pointer-events:none",
  ].join(";");
  // Above the pointer, so the label never covers the path it describes.
  element.style.left = `${Math.max(0, event.clientX - bounds.left)}px`;
  element.style.top = `${Math.max(0, event.clientY - bounds.top - 22)}px`;

  host.appendChild(element);
  return element;
}

function matchLabel(query: string, matches: { index: number; count: number } | null): string {
  if (!query || !matches) return "";
  if (matches.count === 0) return "No results";
  // -1 means the addon stopped counting positions past its highlight limit.
  if (matches.index < 0) return `${matches.count}+ matches`;
  return `${matches.index + 1} of ${matches.count}`;
}

/**
 * Status, plus the backend's activity heuristic when it reports one.
 *
 * The copy stays hedged for a reason: `waiting` only means "no output
 * recently", which a long silent build looks exactly like. Only a matched
 * prompt pattern (`waitingConfidence: "high"`) earns a claim that the agent
 * wants the user.
 */
function ActivityBadge({ session, exited }: { session: AgentSession; exited: boolean }) {
  if (exited) return <Badge variant="secondary">{exitLabel(session.exitCode)}</Badge>;

  if (session.activity === "waiting") {
    return session.waitingConfidence === "high" ? (
      <Badge variant="warning" className="shrink-0">
        Waiting for you
      </Badge>
    ) : (
      <Badge
        variant="outline"
        className="shrink-0"
        title="No output for a while — the agent may want input, or may just be working quietly"
      >
        Quiet
      </Badge>
    );
  }

  return (
    <Badge variant="success" className="shrink-0 gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      {session.activity === "working" ? "Working" : "Running"}
    </Badge>
  );
}

/** `exitCode` is null for a session killed by a signal — say so, don't guess. */
function exitLabel(exitCode: number | null): string {
  return exitCode === null || exitCode === undefined
    ? "Exited"
    : `Exited (code ${exitCode})`;
}

function Centered({
  title,
  detail,
  note,
}: {
  title: string;
  detail?: string;
  note?: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <AlertTriangle className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {detail && (
        <p className="max-w-lg break-all font-mono text-xs text-muted-foreground">
          {detail}
        </p>
      )}
      {note && <p className="max-w-lg text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
