import * as React from "react";
import { useEffect, useState } from "react";
import { Pencil, Plus, ShieldAlert, Trash2, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import {
  useAgentDefinitions,
  useCreateAgentDefinition,
  useUpdateAgentDefinition,
  useDeleteAgentDefinition,
  type AgentDefinition,
} from "@/hooks/use-agents";
import {
  argsToLines,
  envToLines,
  parseArgLines,
  parseEnvLines,
  parsePatternLines,
  patternsToLines,
} from "@/lib/agent-forms";

/**
 * Local rather than a `ui/` primitive: this is the only multi-line field in
 * the app so far, and adding a shared component for one caller would be
 * guessing at what the second one needs.
 */
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
 * These commands run as the user, with the user's full privileges — no
 * sandbox, no confirmation per command. That is the point of the feature (an
 * agent that cannot touch your files is useless), but it should never be a
 * surprise, so it is stated on the screen where commands are entered rather
 * than buried in docs.
 */
function PrivilegeWarning() {
  return (
    <div className="flex gap-2 rounded-md border border-yellow-600/40 bg-yellow-600/10 p-2.5">
      <ShieldAlert className="h-4 w-4 shrink-0 text-yellow-600" />
      <p className="text-xs text-muted-foreground">
        Agents run on this machine as you, with your full privileges — your files, your
        keys, your network. Only add commands you trust.
      </p>
    </div>
  );
}

interface FormState {
  name: string;
  command: string;
  argsText: string;
  envText: string;
  patternsText: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  command: "",
  argsText: "",
  envText: "",
  patternsText: "",
};

function formFromDefinition(def: AgentDefinition): FormState {
  return {
    name: def.name,
    command: def.command,
    argsText: argsToLines(def.args),
    envText: envToLines(def.env),
    // Optional on the wire — a backend that predates prompt patterns simply
    // yields an empty field rather than `undefined` reaching the textarea.
    patternsText: patternsToLines(def.promptPatterns),
  };
}

/**
 * Full CRUD over the agent registry, in two modes inside one dialog: a list of
 * definitions, and a form for the one being created or edited.
 *
 * Backend 400s are shown verbatim and inline, never rewritten — the messages
 * name the offending field ("invalid prompt pattern '('"), which is strictly
 * more than the client knows.
 */
export function AgentDefinitionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirm = useConfirm();
  const { addToast } = useToast();
  const { data: definitions, isLoading } = useAgentDefinitions();
  const createDefinition = useCreateAgentDefinition();
  const updateDefinition = useUpdateAgentDefinition();
  const deleteDefinition = useDeleteAgentDefinition();

  /** `null` = the list; a string id = editing it; `"new"` = creating. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  // Reopening always lands on the list — a half-filled form from last time is
  // never what the user came back for.
  useEffect(() => {
    if (open) {
      setEditing(null);
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  const isSaving = createDefinition.isPending || updateDefinition.isPending;

  const startCreate = () => {
    setEditing("new");
    setForm(EMPTY_FORM);
    setError(null);
  };

  const startEdit = (def: AgentDefinition) => {
    setEditing(def.id);
    setForm(formFromDefinition(def));
    setError(null);
  };

  const backToList = () => {
    setEditing(null);
    setError(null);
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const name = form.name.trim();
    const command = form.command.trim();
    if (!name || !command) {
      setError("Name and command are both required.");
      return;
    }

    // The one check done client-side: a malformed env line is a typo the user
    // can fix without a round trip, and the parser has to run here anyway to
    // build the request body.
    const env = parseEnvLines(form.envText);
    if (!env.ok) {
      setError(env.error);
      return;
    }

    const input = {
      name,
      command,
      args: parseArgLines(form.argsText),
      env: env.value,
      promptPatterns: parsePatternLines(form.patternsText),
    };

    try {
      if (editing && editing !== "new") {
        await updateDefinition.mutateAsync({ id: editing, ...input });
      } else {
        await createDefinition.mutateAsync(input);
      }
      backToList();
    } catch (err) {
      // Verbatim: the backend names the field.
      setError((err as Error).message);
    }
  }

  async function handleDelete(def: AgentDefinition) {
    const ok = await confirm({
      title: `Delete "${def.name}"?`,
      description: def.builtIn
        ? "This is a built-in agent, but deleting it is permanent — it will NOT come back when KlustrEye restarts. Running sessions keep going; only new sessions need the definition."
        : "This is permanent. Running sessions keep going; only new sessions need the definition.",
      confirmLabel: "Delete",
    });
    if (!ok) return;

    try {
      await deleteDefinition.mutateAsync(def.id);
      if (editing === def.id) backToList();
    } catch (err) {
      addToast({
        title: "Failed to delete agent",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  }

  const inForm = editing !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        onClose={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>
            {inForm ? (editing === "new" ? "New agent" : "Edit agent") : "Agents"}
          </DialogTitle>
          {!inForm && (
            <DialogDescription>
              The external CLI coding agents you can start a session with.
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <PrivilegeWarning />

          {!inForm && (
            <>
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && definitions && definitions.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No agents configured. Add one to start a session.
                </p>
              )}
              {definitions && definitions.length > 0 && (
                <ul className="rounded-md border divide-y">
                  {definitions.map((def) => (
                    <li key={def.id} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{def.name}</span>
                          {def.builtIn && (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              built-in
                            </Badge>
                          )}
                        </div>
                        <div
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={[def.command, ...(def.args ?? [])].join(" ")}
                        >
                          {[def.command, ...(def.args ?? [])].join(" ")}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title={`Edit ${def.name}`}
                        onClick={() => startEdit(def)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        title={`Delete ${def.name}`}
                        disabled={deleteDefinition.isPending}
                        onClick={() => handleDelete(def)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {inForm && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Field label="Name">
                <Input
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Claude Code"
                  autoFocus
                />
              </Field>

              <Field
                label="Command"
                hint="The executable to run. Must be on your PATH, or an absolute path."
              >
                <Input
                  className="font-mono text-xs"
                  value={form.command}
                  onChange={(e) => set("command", e.target.value)}
                  placeholder="claude"
                />
              </Field>

              <Field
                label="Arguments"
                hint={
                  <>
                    <strong>One argument per line — this is not a shell command.</strong>{" "}
                    <code className="font-mono">--model opus</code> on a single line is
                    ONE argument and will fail; put <code className="font-mono">--model</code>{" "}
                    and <code className="font-mono">opus</code> on separate lines. Blank
                    lines are ignored.
                  </>
                }
              >
                <Textarea
                  rows={4}
                  value={form.argsText}
                  onChange={(e) => set("argsText", e.target.value)}
                  placeholder={"--model\nopus"}
                />
              </Field>

              <Field
                label="Environment"
                hint="One KEY=VALUE per line. Added to the agent's environment on top of your own."
              >
                <Textarea
                  rows={3}
                  value={form.envText}
                  onChange={(e) => set("envText", e.target.value)}
                  placeholder={"NO_COLOR=1"}
                />
              </Field>

              <Field
                label="Prompt patterns"
                hint="One regular expression per line. When one matches the session's recent output, the session is marked “needs input” with high confidence — that is what lights the badge on the rail and raises a notification. Without patterns a quiet session is only ever “idle”, since a long build looks the same."
              >
                <Textarea
                  rows={3}
                  value={form.patternsText}
                  onChange={(e) => set("patternsText", e.target.value)}
                  placeholder={"\\? $\n\\(y/n\\)\\s*$"}
                />
              </Field>

              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive">
                  {error}
                </p>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={backToList}>
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={isSaving || !form.name.trim() || !form.command.trim()}
                >
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </div>

        {!inForm && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="button" onClick={startCreate}>
              <Plus className="h-4 w-4" />
              New agent
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
