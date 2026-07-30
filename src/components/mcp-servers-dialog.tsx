import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FilePlus2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/paths";
import { errorText } from "@/lib/folder-picker";
import { useTabStore } from "@/lib/stores/tab-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { FileSaveError, useDirectory, useFile, useSaveFile } from "@/hooks/use-files";
import {
  argsToLines,
  envToLines,
  parseArgLines,
  parseEnvLines,
} from "@/lib/agent-forms";
import {
  MCP_CONFIG_PATH,
  MCP_TRANSPORTS,
  applyServerFields,
  commandLine,
  emptyMcpConfig,
  envCount,
  extraKeys,
  parseMcpConfig,
  serialiseMcpConfig,
  transportOf,
  validateServer,
  type McpConfig,
  type McpServer,
  type McpTransport,
  type ServerFields,
} from "@/lib/mcp-config";

/** Local, matching `agent-definitions-dialog` — the app has no shared textarea. */
function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      spellCheck={false}
      className={cn(
        "flex w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The scope note.
 *
 * This dialog can only see the workspace folder — the filesystem API is
 * confined to it, by design. User-level servers live in `~/.claude.json`,
 * outside that boundary, and are NOT listed here. An "overview" that quietly
 * omitted half of someone's servers would be worse than no overview at all,
 * so the limit is stated on the screen rather than left to be discovered.
 */
function ScopeNote() {
  return (
    <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
      This is the project file <code className="font-mono">{MCP_CONFIG_PATH}</code> in
      the workspace folder. User-level servers configured in{" "}
      <code className="font-mono">~/.claude.json</code> live outside this folder and
      are not shown here.
    </p>
  );
}

interface FormState {
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  url: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  argsText: "",
  envText: "",
  url: "",
};

function formFromServer(server: McpServer): FormState {
  return {
    name: server.name,
    transport: transportOf(server),
    command: server.command ?? "",
    argsText: argsToLines(server.args),
    envText: envToLines(server.env),
    url: server.url ?? "",
  };
}

/**
 * Text fields → the typed values `applyServerFields` folds onto the server.
 * The text-to-value step reuses the agent-definition parsers, so the two
 * editors agree on what "one argument per line" and "KEY=VALUE" mean.
 */
function fieldsFromForm(form: FormState, env: Record<string, string>): ServerFields {
  return {
    name: form.name,
    transport: form.transport,
    command: form.command,
    args: parseArgLines(form.argsText),
    env,
    url: form.url,
  };
}

/**
 * The workspace's MCP servers: what tools an agent in this project actually
 * has. Read from and written back to `.mcp.json` through the ordinary confined
 * filesystem API — there is no MCP-specific backend.
 *
 * Every refusal in here is deliberate. The file belongs to Claude Code and
 * other tools as much as to us, so this dialog will not write over content it
 * could not parse, and will not resolve a save conflict on the user's behalf.
 */
export function McpServersDialog({
  open,
  onOpenChange,
  wsId,
  folderPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  folderPath: string | null | undefined;
}) {
  const navigate = useNavigate();
  const { openTab } = useTabStore();
  const confirm = useConfirm();
  const { addToast } = useToast();
  const saveFile = useSaveFile();

  const hasFolder = !!folderPath;

  // Existence is settled by LISTING the folder rather than by reading the file
  // and inspecting the failure: `useFile` throws a plain Error with no status,
  // so "no config yet" and "the read failed" would be told apart by matching
  // words in a backend message. The root listing is already cached by the
  // explorer, and it answers exactly.
  const listing = useDirectory(hasFolder && open ? wsId : undefined, "");
  const configExists = useMemo(
    () => !!listing.data?.entries.some((e) => !e.isDir && e.name === MCP_CONFIG_PATH),
    [listing.data]
  );

  const file = useFile(
    hasFolder && open && configExists ? wsId : undefined,
    MCP_CONFIG_PATH
  );

  /**
   * mtime of the last read — the optimistic-concurrency baseline sent with
   * every save. Held in a ref as well as in the query because a save updates
   * it immediately, while the invalidated read only catches up a round trip
   * later; without this, two saves in quick succession would 409 on nothing.
   */
  const baseModifiedMsRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    baseModifiedMsRef.current = file.data?.modifiedMs;
  }, [file.data]);

  /**
   * Re-read on open. `useFile` is `staleTime: Infinity` so that an open editor
   * buffer is never refetched out from under the user — which means reopening
   * this dialog would otherwise show whatever was cached the first time. An
   * overview that quietly shows a stale list is the bug this feature exists to
   * avoid, and the stale mtime would 409 the first save on top of it.
   */
  const refetchFile = file.refetch;
  const refreshedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      refreshedRef.current = false;
      return;
    }
    if (!configExists || refreshedRef.current) return;
    refreshedRef.current = true;
    void refetchFile();
  }, [open, configExists, refetchFile]);

  const parsed = useMemo(
    () => (file.data ? parseMcpConfig(file.data.content) : null),
    [file.data]
  );

  /**
   * The edited config. Seeded from the file and then owned by this component,
   * so an add/remove is visible before it is saved.
   *
   * `null` until a config has been parsed — never an empty config as a
   * stand-in, which is what a later save would then write over the file.
   */
  const [draft, setDraft] = useState<McpConfig | null>(null);
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  // Reopening lands on the list with whatever is on disk — a half-filled form
  // or a stale draft from last time is never what the user came back for.
  useEffect(() => {
    if (open) {
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError(null);
      setConflict(false);
    }
  }, [open]);

  useEffect(() => {
    setDraft(parsed?.ok ? parsed.config : null);
  }, [parsed]);

  const parseError = parsed && !parsed.ok ? parsed.error : null;

  const openInEditor = () => {
    // ONE href for both calls — a mismatch silently renames or strands the
    // tab. Same construction as `file-tree`.
    const href = workspacePath(wsId, "files/" + MCP_CONFIG_PATH);
    openTab(wsId, href, MCP_CONFIG_PATH, "file", { path: MCP_CONFIG_PATH });
    navigate(href);
    onOpenChange(false);
  };

  /**
   * Writes the config out.
   *
   * Always sends the baseline mtime. A 409 means the file changed underneath
   * us — the user edited it in the editor, or an agent rewrote it — and the
   * only safe answer is to say so and offer a reload. Overwriting is not
   * offered: whatever landed there is very likely a server this dialog never
   * saw, and blowing it away is not a choice worth putting one click away.
   */
  const writeConfig = async (next: McpConfig, successMessage: string) => {
    try {
      const result = await saveFile.mutateAsync({
        wsId,
        path: MCP_CONFIG_PATH,
        content: serialiseMcpConfig(next),
        baseModifiedMs: baseModifiedMsRef.current,
      });
      baseModifiedMsRef.current = result.modifiedMs;
      setDraft(next);
      setConflict(false);
      addToast({ title: successMessage, description: MCP_CONFIG_PATH, variant: "success" });
      return true;
    } catch (e) {
      if (e instanceof FileSaveError && e.status === 409) {
        setConflict(true);
        addToast({
          title: `${MCP_CONFIG_PATH} changed on disk`,
          description:
            "Something else wrote the file since it was opened. Reload before saving so the other change is not lost.",
          variant: "destructive",
        });
        return false;
      }
      addToast({
        title: "Could not save " + MCP_CONFIG_PATH,
        description: errorText(e),
        variant: "destructive",
      });
      return false;
    }
  };

  const handleCreate = async () => {
    // A brand-new file: no baseline to send, and none to be stale.
    baseModifiedMsRef.current = undefined;
    const created = emptyMcpConfig();
    if (await writeConfig(created, `Created ${MCP_CONFIG_PATH}`)) {
      await listing.refetch();
    }
  };

  const handleReload = async () => {
    setConflict(false);
    await listing.refetch();
    const fresh = await file.refetch();
    if (fresh.data) baseModifiedMsRef.current = fresh.data.modifiedMs;
    setEditing(null);
    setFormError(null);
    addToast({
      title: "Reloaded from disk",
      description: MCP_CONFIG_PATH,
      variant: "info",
    });
  };

  const startCreate = () => {
    setEditing("new");
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const startEdit = (index: number) => {
    if (!draft) return;
    setEditing(index);
    setForm(formFromServer(draft.servers[index]));
    setFormError(null);
  };

  const backToList = () => {
    setEditing(null);
    setFormError(null);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft || editing === null) return;
    setFormError(null);

    // The env textarea is parsed here because the result is needed to build
    // the server anyway, and a typo is fixable without a round trip.
    const env = parseEnvLines(form.envText);
    if (!env.ok) {
      setFormError(env.error);
      return;
    }

    const index = editing === "new" ? draft.servers.length : editing;
    const base: McpServer =
      editing === "new" ? { name: "", extra: {} } : draft.servers[index];
    const server = applyServerFields(base, fieldsFromForm(form, env.value));

    const otherNames = draft.servers
      .filter((_, i) => i !== index)
      .map((s) => s.name.trim());
    const invalid = validateServer(server, { otherNames });
    if (invalid) {
      setFormError(invalid);
      return;
    }

    const servers = draft.servers.slice();
    servers[index] = server;
    const next: McpConfig = { ...draft, servers, hadServersKey: true };

    if (await writeConfig(next, editing === "new" ? "Server added" : "Server saved")) {
      backToList();
    }
  }

  async function handleDelete(index: number) {
    if (!draft) return;
    const server = draft.servers[index];
    const ok = await confirm({
      title: `Remove "${server.name}"?`,
      description: `It will be deleted from ${MCP_CONFIG_PATH}. Agents in this project lose the tools it provides.`,
      confirmLabel: "Remove",
    });
    if (!ok) return;

    const servers = draft.servers.filter((_, i) => i !== index);
    const next: McpConfig = { ...draft, servers, hadServersKey: true };
    if (await writeConfig(next, "Server removed") && editing === index) backToList();
  }

  const inForm = editing !== null;
  const isBusy = saveFile.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        onClose={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>
            {inForm
              ? editing === "new"
                ? "New MCP server"
                : "Edit MCP server"
              : "MCP servers"}
          </DialogTitle>
          {!inForm && (
            <DialogDescription>
              The servers that decide which tools an agent in this project has.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* No folder: the same shape of answer the Agents panel gives — say
              what is missing and why, never a bare error. */}
          {!hasFolder && (
            <>
              <p className="text-sm text-muted-foreground">
                <code className="font-mono">{MCP_CONFIG_PATH}</code> is a project file,
                and this workspace has no folder bound — so there is no project to read
                it from. Bind a folder to the workspace and it will show up here.
              </p>
              <ScopeNote />
            </>
          )}

          {hasFolder && (
            <>
              <ScopeNote />

              {listing.isLoading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Looking for {MCP_CONFIG_PATH}…
                </p>
              )}

              {listing.isError && (
                <Notice
                  title="Could not read the workspace folder"
                  detail={errorText(listing.error)}
                  action={
                    <Button variant="outline" size="sm" onClick={() => void listing.refetch()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  }
                />
              )}

              {/* No config yet is a normal state, not a failure. */}
              {!listing.isLoading && !listing.isError && !configExists && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    This project has no <code className="font-mono">{MCP_CONFIG_PATH}</code>{" "}
                    yet. Create one to start adding servers.
                  </p>
                  <Button size="sm" disabled={isBusy} onClick={() => void handleCreate()}>
                    <FilePlus2 className="h-4 w-4" />
                    {isBusy ? "Creating…" : `Create ${MCP_CONFIG_PATH}`}
                  </Button>
                </div>
              )}

              {configExists && file.isLoading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reading {MCP_CONFIG_PATH}…
                </p>
              )}

              {configExists && file.isError && (
                <Notice
                  title={`Could not read ${MCP_CONFIG_PATH}`}
                  detail={errorText(file.error)}
                  action={
                    <Button variant="outline" size="sm" onClick={() => void file.refetch()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  }
                />
              )}

              {file.data?.encoding === "binary" && (
                <Notice
                  title={`${MCP_CONFIG_PATH} is not text`}
                  detail="It reads as binary, so it cannot be shown or edited here."
                />
              )}

              {/* Malformed: show the error and the file as it stands, and
                  refuse to write. There is no "fix it for me" on offer,
                  because every such fix discards content we could not read. */}
              {parseError && (
                <div className="space-y-3">
                  <Notice
                    title={`${MCP_CONFIG_PATH} is not valid JSON`}
                    detail={parseError}
                    note="Nothing here will be saved over it until the file parses — that would destroy whatever could not be read. Fix it in the editor, then reload."
                  />
                  <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-[11px] leading-relaxed">
                    {file.data?.content}
                  </pre>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={openInEditor}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open in editor
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void handleReload()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reload
                    </Button>
                  </div>
                </div>
              )}

              {conflict && (
                <Notice
                  title={`${MCP_CONFIG_PATH} changed on disk`}
                  detail="Something else — the editor, or an agent — wrote the file after it was opened here."
                  note="Reload to pick up that change. Your unsaved edit in this dialog is discarded; overwriting is not offered, because the file may now hold servers this dialog never saw."
                  action={
                    <Button variant="outline" size="sm" onClick={() => void handleReload()}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reload from disk
                    </Button>
                  }
                />
              )}

              {draft && !inForm && (
                <>
                  {draft.servers.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No MCP servers in this project yet.
                    </p>
                  )}
                  {draft.servers.length > 0 && (
                    <ul className="divide-y rounded-md border">
                      {draft.servers.map((server, index) => (
                        <ServerRow
                          key={`${server.name}-${index}`}
                          server={server}
                          disabled={isBusy}
                          onEdit={() => startEdit(index)}
                          onDelete={() => void handleDelete(index)}
                        />
                      ))}
                    </ul>
                  )}
                </>
              )}

              {draft && inForm && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <Field label="Name" hint="The key this server appears under.">
                    <Input
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="claude-flow"
                      autoFocus
                    />
                  </Field>

                  <Field
                    label="Transport"
                    hint="stdio launches a local process. http and sse connect to a server over the network."
                  >
                    <Select
                      value={form.transport}
                      onChange={(e) => set("transport", e.target.value as McpTransport)}
                      options={MCP_TRANSPORTS.map((t) => ({ value: t, label: t }))}
                    />
                  </Field>

                  {form.transport === "stdio" ? (
                    <>
                      <Field
                        label="Command"
                        hint="The executable to run. Must be on your PATH, or an absolute path."
                      >
                        <Input
                          className="font-mono text-xs"
                          value={form.command}
                          onChange={(e) => set("command", e.target.value)}
                          placeholder="npx"
                        />
                      </Field>

                      <Field
                        label="Arguments"
                        hint={
                          <>
                            <strong>One argument per line — this is not a shell command.</strong>{" "}
                            <code className="font-mono">-y pkg</code> on a single line is ONE
                            argument and will fail. Blank lines are ignored.
                          </>
                        }
                      >
                        <Textarea
                          rows={4}
                          value={form.argsText}
                          onChange={(e) => set("argsText", e.target.value)}
                          placeholder={"-y\n@claude-flow/cli@latest\nmcp\nstart"}
                        />
                      </Field>
                    </>
                  ) : (
                    <Field label="URL" hint="Where the server is reachable.">
                      <Input
                        className="font-mono text-xs"
                        value={form.url}
                        onChange={(e) => set("url", e.target.value)}
                        placeholder="https://example.com/mcp"
                      />
                    </Field>
                  )}

                  <Field
                    label="Environment"
                    hint="One KEY=VALUE per line. These often hold API keys — they are stored in plain text in .mcp.json, which is usually committed to the repository."
                  >
                    <Textarea
                      rows={3}
                      value={form.envText}
                      onChange={(e) => set("envText", e.target.value)}
                      placeholder={"API_KEY=…"}
                    />
                  </Field>

                  {editing !== "new" && extraKeys(draft.servers[editing]).length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Kept as written and not editable here:{" "}
                      <code className="font-mono">
                        {extraKeys(draft.servers[editing]).join(", ")}
                      </code>
                    </p>
                  )}

                  {formError && (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                      {formError}
                    </p>
                  )}

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={backToList}>
                      <ArrowLeft className="h-4 w-4" />
                      Back
                    </Button>
                    <Button type="submit" disabled={isBusy}>
                      {isBusy ? "Saving…" : "Save"}
                    </Button>
                  </DialogFooter>
                </form>
              )}
            </>
          )}
        </div>

        {!inForm && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            {draft && (
              <Button type="button" disabled={isBusy} onClick={startCreate}>
                <Plus className="h-4 w-4" />
                New server
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ServerRow({
  server,
  disabled,
  onEdit,
  onDelete,
}: {
  server: McpServer;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const transport = transportOf(server);
  const count = envCount(server);
  const line = transport === "stdio" ? commandLine(server) : server.url ?? "";
  const problem = validateServer(server);

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{server.name}</span>
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
            {transport}
          </Badge>
          {/* Values are never shown — env holds API keys and tokens. */}
          {count > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {count} env var{count === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground" title={line}>
          {line || <span className="italic">nothing to run</span>}
        </div>
        {problem && (
          <div className="flex items-center gap-1 text-[10px] text-destructive">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {problem}
          </div>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        title={`Edit ${server.name}`}
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        title={`Remove ${server.name}`}
        disabled={disabled}
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

function Notice({
  title,
  detail,
  note,
  action,
}: {
  title: string;
  detail?: string;
  note?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5">
      <p className="text-sm font-medium">{title}</p>
      {detail && (
        <p className="break-words font-mono text-xs text-muted-foreground">{detail}</p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {action}
    </div>
  );
}
