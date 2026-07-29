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
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Terminal } from "@xterm/xterm";
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

  // The agent's process runs in the workspace's bound folder (the backend
  // resolves the cwd from it), so that folder is the working directory to
  // show. Absent for a workspace with no folder bound.
  const { data: workspace } = useWorkspace(wsId);
  const cwd = workspace?.folderPath ?? null;

  const session = sessions?.find((s) => s.id === sessionId);
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
