import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import MonacoEditor from "@monaco-editor/react";
import type * as monaco from "monaco-editor";
import { AlertTriangle, FileQuestion, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { useWorkspaceId } from "@/hooks/use-cluster-path";
import { FileSaveError, useFile, useSaveFile, type FileContent } from "@/hooks/use-files";
import {
  disposeModel,
  fileModelKey,
  getOrCreateModel,
  getViewState,
  isDirty,
  markSaved,
  setViewState,
} from "@/lib/editor/model-registry";
import { useTabStore } from "@/lib/stores/tab-store";

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  rs: "rust",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  markdown: "markdown",
  // monaco 0.55 ships no TOML grammar; `ini` is the closest it has and renders
  // `[section]` / `key = value` sensibly.
  toml: "ini",
  ini: "ini",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  py: "python",
  go: "go",
  sql: "sql",
  xml: "xml",
  tf: "hcl",
};

const LANGUAGE_BY_BASENAME: Record<string, string> = {
  dockerfile: "dockerfile",
};

/** Best-effort Monaco language id for a path; `plaintext` when unknown. */
export function languageForPath(path: string): string {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  const byName = LANGUAGE_BY_BASENAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  // dot === 0 is a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return "plaintext";
  return LANGUAGE_BY_EXTENSION[base.slice(dot + 1)] ?? "plaintext";
}

/**
 * The tab href is built by whoever opened the tab, while `location.pathname`
 * comes back percent-encoded from the router. Comparing decoded forms keeps
 * the dirty indicator attached for paths containing spaces or other escapes.
 */
function samePath(a: string, b: string): boolean {
  const decode = (s: string) => {
    try {
      return decodeURI(s);
    } catch {
      return s;
    }
  };
  return decode(a) === decode(b);
}

/**
 * `tab-store` exposes no dirty setter, so write the flag through zustand's
 * store API. No-ops when no tab matches — navigating straight to a file URL
 * without a tab open is legal.
 */
function setTabDirty(wsId: string, href: string, dirty: boolean): void {
  useTabStore.setState((state) => {
    const tabs = state.tabsByWorkspace[wsId];
    if (!tabs) return state;
    const index = tabs.findIndex((t) => samePath(t.href, href));
    if (index === -1 || !!tabs[index].dirty === dirty) return state;
    const next = tabs.slice();
    next[index] = { ...next[index], dirty };
    return { tabsByWorkspace: { ...state.tabsByWorkspace, [wsId]: next } };
  });
}

/** Follows the `dark` class that `use-theme` toggles on <html>. */
function useMonacoTheme(): "vs-dark" | "vs" {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setDark(root.classList.contains("dark"));
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    return () => observer.disconnect();
  }, []);
  return dark ? "vs-dark" : "vs";
}

const EDITOR_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  scrollBeyondLastLine: false,
  tabSize: 2,
  automaticLayout: true,
  lineNumbers: "on",
  renderLineHighlight: "line",
  padding: { top: 8 },
};

export function FileEditor() {
  const wsId = useWorkspaceId();
  const path = useParams()["*"] ?? "";
  const href = useLocation().pathname;
  const { addToast } = useToast();
  const theme = useMonacoTheme();
  const saveFile = useSaveFile();

  const { data, isFetching, isError, error, refetch } = useFile(
    wsId,
    path || undefined
  );

  // Built by `fileModelKey` rather than inline: `tab-bar` derives the same key
  // from the tab payload when releasing a closed buffer, and two spellings of
  // it would leak every model instead of freeing it.
  const modelKey = useMemo(() => fileModelKey(wsId, path), [wsId, path]);
  const language = useMemo(() => languageForPath(path), [path]);

  const [dirty, setDirty] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  /** Bumped after a reload-from-disk so the attach effect rebuilds the model. */
  const [reloadNonce, setReloadNonce] = useState(0);

  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /** mtime of the last successful read — the optimistic-concurrency baseline. */
  const baseModifiedMsRef = useRef<number | undefined>(undefined);
  const dataRef = useRef<FileContent | undefined>(undefined);
  dataRef.current = data;

  // ONE effect on purpose — never split this back into "set from data" plus
  // "clear on modelKey". `useFile` is `staleTime: Infinity`, so returning to an
  // already-read file is served from cache SYNCHRONOUSLY: `data` and `modelKey`
  // change in the same render, so both effects would run and the clear — React
  // flushes passive effects in declaration order — would win. The baseline
  // would then stay `undefined` forever and `doSave`'s not-ready guard would
  // block every save of that file for the life of the page.
  //
  // A new file still gets a fresh baseline rather than the previous file's
  // mtime: `data` is `undefined` while its read is in flight, so the write
  // below clears the ref exactly as the old second effect did.
  useEffect(() => {
    baseModifiedMsRef.current = data?.modifiedMs;
  }, [data, modelKey]);

  const syncDirty = useCallback(() => {
    const next = isDirty(modelKey);
    setDirty(next);
    setTabDirty(wsId, href, next);
  }, [modelKey, wsId, href]);

  // `@monaco-editor/react` captures `onMount` once on first render, and the
  // save keybinding is registered once with the editor, so both reach the
  // current implementation through refs.
  const syncDirtyRef = useRef(syncDirty);
  syncDirtyRef.current = syncDirty;
  const saveRef = useRef<() => void>(() => {});

  const handleMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor, monacoApi: typeof monaco) => {
    editorRef.current = editor;
    editor.onDidDispose(() => {
      editorRef.current = null;
      setEditorReady(false);
    });

    // Registered on this editor's own keybinding service, so Cmd/Ctrl+S is
    // only intercepted while the editor has keyboard focus — everything else
    // on the page keeps the shortcut.
    editor.addAction({
      id: "klustreye.saveFile",
      label: "Save File",
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS],
      run: () => saveRef.current(),
    });

    setEditorReady(true);
  }, []);

  const hasData = !!data;

  /**
   * Attaching the model lives here rather than in `onMount` because react-router
   * reuses this component across `files/*` navigations — the Monaco editor is
   * never remounted when you switch from one file to another, so `onMount`
   * fires at most once.
   */
  useEffect(() => {
    const editor = editorRef.current;
    const current = dataRef.current;
    if (!editor || !current || current.encoding === "binary") return;
    const key = modelKey;

    // THE load-bearing call: when a model is already registered for this key
    // it comes back untouched, unsaved edits and undo stack intact. Never
    // setValue() the freshly fetched content over it — that is exactly the
    // silent data loss the registry exists to prevent.
    const model = getOrCreateModel(key, current.content, language);
    if (editor.getModel() !== model) {
      editor.setModel(model);
      const saved = getViewState(key);
      if (saved) editor.restoreViewState(saved);
    }

    const sub = model.onDidChangeContent(() => syncDirtyRef.current());
    syncDirtyRef.current();

    return () => {
      sub.dispose();
      // Leave the model in the registry — it is what keeps the buffer alive
      // until the tab is actually closed.
      const ed = editorRef.current;
      if (ed) setViewState(key, ed.saveViewState());
    };
  }, [editorReady, modelKey, language, hasData, reloadNonce]);

  const doSave = useCallback(
    async (force: boolean) => {
      const model = editorRef.current?.getModel();
      if (!model || !wsId || !path) return;
      if (!force && baseModifiedMsRef.current === undefined) {
        // Omitting the baseline is an unconditional overwrite. Never do that
        // implicitly just because the read has not landed yet.
        addToast({
          title: "Not ready to save",
          description: "Still reading this file from disk — try again in a moment.",
          variant: "destructive",
        });
        return;
      }
      try {
        const result = await saveFile.mutateAsync({
          wsId,
          path,
          content: model.getValue(),
          baseModifiedMs: force ? undefined : baseModifiedMsRef.current,
        });
        baseModifiedMsRef.current = result.modifiedMs;
        markSaved(modelKey);
        syncDirtyRef.current();
        setConflictOpen(false);
        addToast({ title: "Saved", description: path, variant: "success" });
      } catch (e) {
        if (e instanceof FileSaveError && e.status === 409) {
          // Reloading discards the user's edits; overwriting discards whatever
          // the other writer produced. Both destroy work, so the choice is
          // theirs to make — never resolve it silently.
          setConflictOpen(true);
          addToast({
            title: "File changed on disk",
            description: `${path} was modified since it was opened. Choose whether to reload or overwrite.`,
            variant: "destructive",
          });
          return;
        }
        addToast({
          title: "Save failed",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        });
      }
    },
    [wsId, path, modelKey, saveFile, addToast]
  );

  useEffect(() => {
    saveRef.current = () => {
      void doSave(false);
    };
  }, [doSave]);

  const handleReloadFromDisk = useCallback(async () => {
    setConflictOpen(false);
    setReloading(true);
    try {
      const fresh = await refetch();
      if (fresh.error || !fresh.data) {
        addToast({
          title: "Reload failed",
          description:
            fresh.error instanceof Error
              ? fresh.error.message
              : "Could not read the file.",
          variant: "destructive",
        });
        return;
      }
      // getOrCreateModel deliberately never overwrites an existing buffer, so
      // reseeding from disk means dropping the entry first and letting the
      // attach effect rebuild it from the fresh content.
      editorRef.current?.setModel(null);
      // disposeModel drops the view state with it — a caret offset into the
      // old buffer means nothing once the content is replaced from disk.
      disposeModel(modelKey);
      baseModifiedMsRef.current = fresh.data.modifiedMs;
      setReloadNonce((n) => n + 1);
      addToast({ title: "Reloaded from disk", description: path, variant: "info" });
    } finally {
      setReloading(false);
    }
  }, [refetch, modelKey, path, addToast]);

  if (!path) {
    return <Centered icon={FileQuestion} title="No file selected" />;
  }

  if (isError && !data) {
    return (
      <Centered
        icon={AlertTriangle}
        title="Could not open file"
        detail={error instanceof Error ? error.message : path}
        note="Unsaved edits for this file are still held in memory and reappear once it can be read again."
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RotateCcw /> Retry
          </Button>
        }
      />
    );
  }

  if (data?.encoding === "binary") {
    return (
      <Centered
        icon={FileQuestion}
        title="Binary file — not shown"
        detail={`${path} (${data.size} bytes)`}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate font-mono text-xs text-muted-foreground">{path}</span>
        {dirty && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
            title="Unsaved changes"
          />
        )}
        <div className="flex-1" />
        {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button
          variant="ghost"
          size="sm"
          disabled={saveFile.isPending || reloading || !data}
          onClick={() => void doSave(false)}
        >
          {saveFile.isPending ? <Loader2 className="animate-spin" /> : <Save />}
          Save
        </Button>
      </div>

      {/* The editor stays mounted across file switches; only the model swaps.
          Remounting Monaco per file would cost ~100ms and drop the view state. */}
      <div className="relative min-h-0 flex-1">
        <MonacoEditor
          height="100%"
          theme={theme}
          keepCurrentModel
          options={EDITOR_OPTIONS}
          onMount={handleMount}
          loading={<Skeleton className="h-full w-full" />}
        />
        {!data && (
          <div className="absolute inset-0 bg-background p-4">
            <Skeleton className="h-full w-full" />
          </div>
        )}
      </div>

      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>File changed on disk</DialogTitle>
            <DialogDescription className="whitespace-pre-wrap">
              {`${path} was modified by something else since you opened it.\n\n` +
                "Reload from disk discards your unsaved edits.\n" +
                "Overwrite discards the other change.\n" +
                "Keep editing leaves the file on disk untouched."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflictOpen(false)}>
              Keep editing
            </Button>
            <Button
              variant="outline"
              disabled={reloading}
              onClick={() => void handleReloadFromDisk()}
            >
              Reload from disk
            </Button>
            <Button
              variant="destructive"
              disabled={saveFile.isPending}
              onClick={() => void doSave(true)}
            >
              Overwrite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Centered({
  icon: Icon,
  title,
  detail,
  note,
  action,
}: {
  icon: typeof FileQuestion;
  title: string;
  detail?: string;
  note?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      {detail && (
        <p className="max-w-lg break-all font-mono text-xs text-muted-foreground">
          {detail}
        </p>
      )}
      {note && <p className="max-w-lg text-xs text-muted-foreground">{note}</p>}
      {action}
    </div>
  );
}
