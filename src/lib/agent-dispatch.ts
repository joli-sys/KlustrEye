/**
 * Pure helpers for handing a Kubernetes view's context to an agent session:
 * naming the file the context is written to, capping how much of it is sent,
 * and composing the prompt that names it.
 *
 * Split out of the dialog because every one of these is a place a silent
 * failure hides — a name the backend rejects becomes a missing attachment, a
 * cap that keeps the WRONG end of a log throws away the failure the user asked
 * about — and vitest has no DOM harness in this repo, so logic left inside a
 * component is logic that never gets tested.
 *
 * The backend owns the durable half of this contract (`backend/src/agents`):
 * it sanitizes names again, writes the files under the app-data directory
 * (never into the user's repo), enforces an 8 MB per-session budget with a 413,
 * and appends the files' ABSOLUTE paths to whatever prompt it is given. Nothing
 * here duplicates that work; it only keeps the client from walking into it.
 */

/**
 * Sizes for prose, in binary units spelled in full.
 *
 * `formatBytes` in `lib/utils` renders "500.2 Ki", which is fine in a metrics
 * column and ambiguous in a sentence — and one of the places these numbers land
 * is a marker line inside the attached file, read by an agent rather than by
 * someone who knows the app's conventions.
 */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${Number(kib.toFixed(1))} KiB`;
  return `${Number((kib / 1024).toFixed(1))} MiB`;
}

/**
 * How much attachment content this client will send, per attachment.
 *
 * Far below the backend's 8 MB per-session budget on purpose: a 413 is a
 * preventable error the user could have been warned about, and being told "the
 * last 512 KiB of the log was attached" before submitting beats a rejection
 * after. Pod logs routinely run to megabytes, so this cap is reached in normal
 * use, not only in the pathological case.
 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 512 * 1024;

/**
 * Mirrors `ATTACHMENT_NAME_MAX_CHARS` in `backend/src/agents/mod.rs`. Kept in
 * step so the name shown in the dialog is the name the file gets (modulo the
 * backend's `NN-` ordinal prefix), rather than a longer one the user never sees
 * truncated.
 */
export const ATTACHMENT_NAME_MAX_CHARS = 80;

/** Used when nothing recognisable survives sanitising. */
const FALLBACK_ATTACHMENT_NAME = "context.txt";

export interface DispatchAttachment {
  /** Already sanitised — safe to send and safe to show. */
  name: string;
  content: string;
  /** UTF-8 bytes of `content`, i.e. what is actually sent. */
  bytes: number;
  /** UTF-8 bytes of the text before capping. Equal to `bytes` when whole. */
  originalBytes: number;
  truncated: boolean;
  /** Which end survived. Only meaningful when `truncated`. */
  kept: "head" | "tail";
}

const encoder = new TextEncoder();
// Lossy on purpose: a byte slice may begin mid-codepoint, and the U+FFFD it
// leaves behind is how `tailBytes` detects and strips that.
const decoder = new TextDecoder();

function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Caps a name to `ATTACHMENT_NAME_MAX_CHARS` while keeping a trailing
 * extension.
 *
 * The backend's own cap is a plain char-wise truncation, which would eat
 * `.yaml` off a long resource name and leave the user with an extensionless
 * file. Capping here first means the backend sees a name already inside its
 * limit and passes it through unchanged, so both sides agree on the result.
 */
function capNameKeepingExtension(name: string): string {
  const chars = [...name];
  if (chars.length <= ATTACHMENT_NAME_MAX_CHARS) return name;

  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const extChars = [...ext];

  // An "extension" longer than the budget is not an extension — drop it and
  // truncate flat rather than returning nothing but a suffix.
  if (extChars.length === 0 || extChars.length + 1 >= ATTACHMENT_NAME_MAX_CHARS) {
    return chars.slice(0, ATTACHMENT_NAME_MAX_CHARS).join("");
  }

  const stem = chars.slice(0, ATTACHMENT_NAME_MAX_CHARS - extChars.length).join("");
  return stem + ext;
}

/**
 * Turns a suggested name into one harmless path component.
 *
 * Mirrors `sanitize_attachment_name` in `backend/src/agents/mod.rs`: separators
 * and the other characters that steer a path are replaced, control characters
 * go with them, and dots at the edges are stripped so `.` and `..` cannot be
 * spelled. Done client-side as well as server-side not for safety — the server
 * is the one that matters — but because a name the server rejects becomes a
 * file called `attachment`, and the user should be shown the name they will
 * actually get.
 *
 * Always returns something usable, unlike the backend's `Option`: the caller
 * here has a screen to fill.
 */
export function sanitizeAttachmentName(
  raw: string,
  fallback: string = FALLBACK_ATTACHMENT_NAME
): string {
  const replaced = [...raw]
    .map((c) => {
      // C0, DEL and C1: a NUL or a newline in a filename is as unwelcome as a
      // separator, and a name built from log text can carry either.
      const code = c.codePointAt(0) ?? 0;
      const isControl = code < 0x20 || (code >= 0x7f && code <= 0x9f);
      return isControl || "/\\:*?\"<>|".includes(c) ? "-" : c;
    })
    .join("");

  const trimmed = replaced.trim().replace(/^\.+|\.+$/g, "").trim();
  const capped = capNameKeepingExtension(trimmed).trim();

  // A name made only of what the replacements left behind — `../..` becomes
  // `-` — names nothing to a human either.
  if (!/[\p{L}\p{N}]/u.test(capped)) return fallback;
  return capped;
}

export interface CapOptions {
  maxBytes?: number;
  /**
   * `"tail"` for logs — the end is where the failure is, and a log truncated
   * from the front still contains the crash. `"head"` for a manifest, whose
   * structure is at the top.
   */
  keep?: "head" | "tail";
}

export interface CappedContent {
  content: string;
  bytes: number;
  originalBytes: number;
  truncated: boolean;
  kept: "head" | "tail";
}

/** The last `maxBytes` UTF-8 bytes, never split mid-codepoint. */
function tailBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const out = decoder.decode(bytes.subarray(bytes.length - maxBytes));
  // The slice can begin inside a multi-byte character; the decoder marks that
  // with U+FFFD, which is a mojibake artifact rather than log content.
  return out.replace(/^\uFFFD+/, "");
}

/** The first `maxBytes` UTF-8 bytes, never split mid-codepoint. */
function headBytes(text: string, maxBytes: number): string {
  const bytes = encoder.encode(text);
  if (bytes.length <= maxBytes) return text;
  const out = decoder.decode(bytes.subarray(0, maxBytes));
  return out.replace(/\uFFFD+$/, "");
}

/**
 * Caps text to a byte budget, keeping one end and saying so INSIDE the content.
 *
 * The marker matters as much as the truncation: an agent handed a partial log
 * with no note will happily conclude "the process starts up cleanly" from a
 * file whose first half was dropped. The marker's own bytes are subtracted from
 * the budget, so the returned content is never larger than `maxBytes`.
 */
export function capAttachmentContent(text: string, options: CapOptions = {}): CappedContent {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const kept = options.keep ?? "tail";
  const originalBytes = utf8Bytes(text);

  if (originalBytes <= maxBytes) {
    return { content: text, bytes: originalBytes, originalBytes, truncated: false, kept };
  }

  const marker =
    kept === "tail"
      ? `[KlustrEye: truncated to the last ${formatAttachmentSize(maxBytes)} of ${formatAttachmentSize(
          originalBytes
        )} — earlier output was dropped]\n`
      : `[KlustrEye: truncated to the first ${formatAttachmentSize(maxBytes)} of ${formatAttachmentSize(
          originalBytes
        )} — the rest was dropped]\n`;

  const budget = Math.max(0, maxBytes - utf8Bytes(marker));

  let body = kept === "tail" ? tailBytes(text, budget) : headBytes(text, budget);

  // Start (or end) on a line boundary: a half line at the cut is noise, and for
  // a manifest a half line is invalid YAML. `-1` means the kept region holds no
  // newline at all — one enormous line — in which case there is nothing to trim
  // to and dropping it would leave an empty file.
  if (kept === "tail") {
    const nl = body.indexOf("\n");
    if (nl !== -1) body = body.slice(nl + 1);
  } else {
    const nl = body.lastIndexOf("\n");
    if (nl !== -1) body = body.slice(0, nl + 1);
  }

  const content = kept === "tail" ? marker + body : body + marker;
  return { content, bytes: utf8Bytes(content), originalBytes, truncated: true, kept };
}

/**
 * The file a pod's logs are attached as.
 *
 * The container is in the name because a multi-container pod's logs are asked
 * about one container at a time, and two attachments called `logs.txt` are two
 * files the user cannot tell apart in the agent's transcript.
 */
export function buildPodLogAttachment(input: {
  podName: string;
  container?: string;
  logs: string;
  maxBytes?: number;
}): DispatchAttachment {
  const suffix = input.container ? `-${input.container}` : "";
  const name = sanitizeAttachmentName(
    `pod-${input.podName}${suffix}-logs.txt`,
    "pod-logs.txt"
  );
  const capped = capAttachmentContent(input.logs, {
    maxBytes: input.maxBytes,
    keep: "tail",
  });
  return { name, ...capped };
}

/** The file a resource's manifest is attached as. */
export function buildResourceYamlAttachment(input: {
  kind: string;
  name: string;
  yaml: string;
  maxBytes?: number;
}): DispatchAttachment {
  const name = sanitizeAttachmentName(
    `${input.kind.toLowerCase()}-${input.name}.yaml`,
    "resource.yaml"
  );
  const capped = capAttachmentContent(input.yaml, {
    maxBytes: input.maxBytes,
    keep: "head",
  });
  return { name, ...capped };
}

/**
 * What the agent is actually asked: the user's wording, then one line naming
 * each attached file.
 *
 * Deliberately mechanical — no persona, no invented instructions. The task text
 * is the user's and is passed through as typed.
 *
 * The backend appends the files' absolute paths under its own "Attached files:"
 * heading, in this same order. The names listed here are not redundant with
 * that: a path is `…/agent-attachments/<session>/01-pod-api-logs.txt`, and this
 * is where the agent is told the file is truncated — which changes what
 * conclusions the log can support.
 */
export function composeDispatchPrompt(
  task: string,
  attachments: DispatchAttachment[]
): string {
  const trimmed = task.trim();
  if (attachments.length === 0) return trimmed;

  const lines = attachments.map((a) => {
    if (!a.truncated) return a.name;
    const which = a.kept === "tail" ? "last" : "first";
    return `${a.name} (truncated: only the ${which} ${formatAttachmentSize(
      a.bytes
    )} of ${formatAttachmentSize(a.originalBytes)} is included)`;
  });

  const header = "Attached context:";
  return trimmed
    ? `${trimmed}\n\n${header}\n${lines.join("\n")}`
    : `${header}\n${lines.join("\n")}`;
}

/** The wire shape the create-session endpoint takes. */
export function toSeedAttachments(
  attachments: DispatchAttachment[]
): { name: string; content: string }[] {
  return attachments.map((a) => ({ name: a.name, content: a.content }));
}

export interface DispatchPreset {
  id: string;
  label: string;
  /** Prefilled into the task field, and editable from there. */
  prompt: string;
}

/**
 * Starting points for a logs question.
 *
 * They name the pod and container rather than saying "these logs" because the
 * agent's session is a fresh terminal with none of this screen's context, and
 * because the user edits these before sending — a prompt that reads as a
 * complete sentence is easier to adjust than a fragment.
 */
export function logDispatchPresets(input: {
  podName: string;
  container?: string;
  namespace?: string;
}): DispatchPreset[] {
  const where = input.container
    ? `pod ${input.podName} (container ${input.container})`
    : `pod ${input.podName}`;
  const scope = input.namespace ? `${where} in namespace ${input.namespace}` : where;

  return [
    {
      id: "explain",
      label: "Explain these logs",
      prompt: `Read the attached logs from ${scope} and explain what they show, including any errors or warnings.`,
    },
    {
      id: "root-cause",
      label: "Find the root cause",
      prompt: `The attached logs are from ${scope}. Find the root cause of the failures in them, using the repository in your working directory to check the code paths involved.`,
    },
    {
      id: "fix",
      label: "Suggest a fix",
      prompt: `The attached logs are from ${scope}. Diagnose the problem and propose a concrete fix, pointing at the specific files and lines that need to change.`,
    },
  ];
}

/** Starting points for a resource question. */
export function resourceDispatchPresets(input: {
  kind: string;
  name: string;
  namespace?: string;
}): DispatchPreset[] {
  const where = input.namespace
    ? `${input.kind} ${input.name} in namespace ${input.namespace}`
    : `${input.kind} ${input.name}`;

  return [
    {
      id: "explain",
      label: "Explain this resource",
      prompt: `Read the attached manifest for ${where} and explain what it does and how it is configured.`,
    },
    {
      id: "review",
      label: "Review the configuration",
      prompt: `Review the attached manifest for ${where} and point out misconfigurations, missing limits or probes, and anything that looks risky in production.`,
    },
    {
      id: "compare",
      label: "Compare with the repo",
      prompt: `The attached manifest is the live ${where}. Compare it with the manifests or chart in your working directory and list where the cluster has drifted from what the repository declares.`,
    },
  ];
}
