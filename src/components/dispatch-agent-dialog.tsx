import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, FolderOpen, Paperclip } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { workspacePath } from "@/lib/paths";
import { errorText, isTauri, pickFolder } from "@/lib/folder-picker";
import { useTabStore } from "@/lib/stores/tab-store";
import {
  composeDispatchPrompt,
  formatAttachmentSize,
  toSeedAttachments,
  type DispatchAttachment,
  type DispatchPreset,
} from "@/lib/agent-dispatch";
import {
  AgentSessionError,
  useAgentDefinitions,
  useCreateAgentSession,
  waitForSeedStatus,
} from "@/hooks/use-agents";

interface DispatchAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wsId: string;
  /** The workspace's bound folder, prefilled as the working directory. */
  folderPath?: string | null;
  /** What is being handed over — "the logs from api-7f9". Shown in the header. */
  subject: string;
  /** The name the new session gets. */
  sessionTitle: string;
  presets: DispatchPreset[];
  /**
   * Builds the file to attach. A factory rather than a value because the
   * content is up to half a megabyte of log, and because it must be snapshotted
   * ONCE per opening: with `follow` on, recomputing per render would let the
   * log move under the user between reading "240 KiB" and pressing the button.
   */
  buildAttachment: () => DispatchAttachment;
}

/**
 * Hands a Kubernetes view's context to a real agent session: pick an agent,
 * pick or write the task, choose where it runs, see exactly what gets attached,
 * then start the session and open its tab.
 *
 * Deliberately distinct from the inline AI actions ("Analyze Logs", "Explain
 * This"), which stream a read-only answer into a panel. This starts a process
 * in a directory that can read the repository, edit files and run commands —
 * the dialog says so in as many words, because a user who cannot tell the two
 * apart will pick the wrong one.
 */
export function DispatchAgentDialog({
  open,
  onOpenChange,
  wsId,
  folderPath,
  subject,
  sessionTitle,
  presets,
  buildAttachment,
}: DispatchAgentDialogProps) {
  const navigate = useNavigate();
  const { openTab } = useTabStore();
  const { addToast } = useToast();

  const { data: definitions, isLoading: definitionsLoading } = useAgentDefinitions();
  const createSession = useCreateAgentSession(wsId);

  const [definitionId, setDefinitionId] = useState("");
  const [task, setTask] = useState(presets[0]?.prompt ?? "");
  const [cwd, setCwd] = useState(folderPath ?? "");

  // The factory changes identity every render (it closes over the current
  // logs); the ref keeps `useMemo` keyed on the OPENING, which is the snapshot
  // boundary that matters, without lying to the dependency list.
  const buildRef = useRef(buildAttachment);
  buildRef.current = buildAttachment;
  const attachment = useMemo(() => (open ? buildRef.current() : null), [open]);

  // Reset on each opening: the dialog is mounted by a long-lived page, and a
  // task edited for the previous pod is a trap rather than a convenience.
  useEffect(() => {
    if (!open) return;
    setTask(presets[0]?.prompt ?? "");
    setCwd(folderPath ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Preselect the only sensible default, and follow the list if it loads after
  // the dialog is already open.
  useEffect(() => {
    if (!definitionId && definitions && definitions.length > 0) {
      setDefinitionId(definitions[0].id);
    }
  }, [definitions, definitionId]);

  const trimmedCwd = cwd.trim();
  const hasFolder = !!folderPath;
  // Either an explicit directory or a bound folder to fall back on — checked
  // here so a click never walks into the backend's 400.
  const hasSomewhereToRun = !!trimmedCwd || hasFolder;
  const noAgents = !definitionsLoading && (definitions?.length ?? 0) === 0;
  const trimmedTask = task.trim();

  const canSubmit =
    !!definitionId && !!trimmedTask && hasSomewhereToRun && !createSession.isPending;

  async function handleBrowse() {
    try {
      const selected = await pickFolder();
      // null means cancelled — leave the field alone, say nothing.
      if (selected) setCwd(selected);
    } catch (e) {
      // Without this the rejection is unhandled and the button looks inert.
      // eslint-disable-next-line no-console
      console.error("Folder picker failed:", e);
      addToast({
        title: "Could not open the folder picker",
        description: errorText(e) + " You can still type an absolute path into the field.",
        variant: "destructive",
      });
    }
  }

  /**
   * Reports whether the primed prompt actually reached the agent.
   *
   * Fire-and-forget: this outlives the dialog on purpose, because the answer
   * takes up to 30s and the user is already looking at the session's terminal
   * by then. Silence on success — the prompt is visible in the terminal — and a
   * toast only when the prompt is NOT there, which is the case the user cannot
   * otherwise explain.
   */
  function reportSeedOutcome(sessionId: string, prompt: string) {
    void waitForSeedStatus(wsId, sessionId).then((status) => {
      if (status === null || status === "sent" || status === "none") return;
      if (status === "pending") {
        addToast({
          title: "The task has not been sent yet",
          description:
            "The agent is still starting up. If it never picks the task up, paste it into the session yourself.",
          variant: "info",
        });
        return;
      }
      addToast({
        title: "The task was not delivered",
        description:
          (status === "timed_out"
            ? "The agent never reached a prompt in time. "
            : "The agent exited or refused the input. ") +
          "The session is running and the attached file is on disk — paste the task into it yourself:\n" +
          prompt,
        variant: "destructive",
      });
    });
  }

  const handleSubmit = async () => {
    if (!canSubmit || !attachment) return;

    const prompt = composeDispatchPrompt(trimmedTask, [attachment]);

    try {
      const session = await createSession.mutateAsync({
        definitionId,
        title: sessionTitle,
        // Omitted rather than sent empty, so the backend falls back to the
        // workspace folder instead of resolving "".
        cwd: trimmedCwd || undefined,
        initialPrompt: prompt,
        attachments: toSeedAttachments([attachment]),
      });

      onOpenChange(false);

      // BOTH calls, in this order — `openTab` alone registers a tab that
      // nothing routes to. Exactly as `sidebar-agents.tsx` does it, off ONE
      // href so the two cannot disagree.
      const href = workspacePath(wsId, "agents/" + session.id);
      openTab(wsId, href, session.title, "agent", { sessionId: session.id });
      navigate(href);

      reportSeedOutcome(session.id, prompt);
    } catch (err) {
      if (err instanceof AgentSessionError && err.status === 413) {
        addToast({
          title: "Too much context to attach",
          description:
            "The attached file is over the per-session limit. Narrow the logs (fewer lines, or a search filter) and try again.",
          variant: "destructive",
        });
      } else if (err instanceof AgentSessionError && err.status === 400) {
        addToast({
          title: "Can't start agent",
          // Verbatim: a 400 says which of "nowhere to run" and "that directory
          // doesn't exist" it was, which fixed copy cannot.
          description: err.message || "Choose a working directory that exists.",
          variant: "destructive",
        });
      } else if (err instanceof AgentSessionError && err.status === 429) {
        addToast({
          title: "Too many agent sessions",
          description: "Kill an existing session before starting another.",
          variant: "destructive",
        });
      } else {
        addToast({
          title: "Failed to start agent",
          description: errorText(err),
          variant: "destructive",
        });
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-4 w-4" />
            Ask an agent about {subject}
          </DialogTitle>
          <DialogDescription>
            This starts a real agent process in the working directory below — it can read
            that repository, edit files and run commands. For a read-only explanation, use
            the AI action instead.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Agent">
            <Select
              value={definitionId}
              onChange={(e) => setDefinitionId(e.target.value)}
              options={(definitions ?? []).map((d) => ({ value: d.id, label: d.name }))}
              placeholder={definitionsLoading ? "Loading agents…" : "Choose an agent"}
              disabled={noAgents || definitionsLoading}
            />
            {noAgents && (
              <p className="text-xs text-destructive">
                No agents are configured, so there is nothing to hand this to. Add one
                under Terminals &amp; Agents → Manage agents in the sidebar, then reopen
                this dialog.
              </p>
            )}
          </Field>

          <Field
            label="Task"
            hint="Sent to the agent as typed — pick a starting point and edit it."
          >
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant={task === preset.prompt ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setTask(preset.prompt)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder="What should the agent do?"
              className={cn(
                "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm transition-colors",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              )}
            />
          </Field>

          <Field
            label="Working directory"
            hint="Where the agent runs, and the only place it can touch files."
          >
            <div className="flex items-center gap-1">
              <Input
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder={hasFolder ? folderPath ?? "" : "/path/to/folder"}
                title={trimmedCwd || "Working directory for the new session"}
              />
              {isTauri() && (
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Browse for a folder"
                  onClick={handleBrowse}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              )}
            </div>
            {!hasSomewhereToRun && (
              <p className="text-xs text-muted-foreground">
                This workspace has no folder bound — enter a working directory to run an
                agent.
              </p>
            )}
          </Field>

          {attachment && (
            <Field label="What gets attached">
              <div className="rounded-md border border-input px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-mono" title={attachment.name}>
                    {attachment.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatAttachmentSize(attachment.bytes)}
                  </span>
                </div>
                {attachment.truncated && (
                  <p className="mt-1.5 text-muted-foreground">
                    Only the {attachment.kept === "tail" ? "last" : "first"}{" "}
                    {formatAttachmentSize(attachment.bytes)} of {formatAttachmentSize(attachment.originalBytes)}{" "}
                    is attached; the file says so at the {attachment.kept === "tail" ? "top" : "bottom"}.
                  </p>
                )}
                <p className="mt-1.5 text-muted-foreground">
                  Written to a file in KlustrEye's own data directory — not into your
                  repository — and the agent is given its path.
                </p>
              </div>
            </Field>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="gap-1.5">
            <Bot className="h-4 w-4" />
            {createSession.isPending ? "Starting…" : "Start agent session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground/80">{hint}</p>}
    </div>
  );
}
