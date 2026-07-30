/**
 * Reading and writing `.mcp.json`, the per-project list of MCP servers.
 *
 * THE FILE IS NOT OURS. `.mcp.json` is read by Claude Code and other tools,
 * and it will contain keys this build has never heard of — today's unknown
 * field is tomorrow's feature. So the parse/serialise round trip is written
 * around one rule: **nothing is ever dropped**. Every key we do not model is
 * carried through verbatim, on each server (`McpServer.extra`) and at the top
 * level (`McpConfig.extraTop`). A field that silently vanishes on save is
 * invisible until the user's agent stops working, which is the worst kind of
 * bug this feature could ship.
 *
 * Pure on purpose — no React, no fetch. vitest has no DOM harness in this
 * repo, so logic left inside a component is logic that never gets tested, and
 * the round trip is precisely the part worth testing.
 */

import { errorText } from "@/lib/folder-picker";

/** Workspace-relative path. `.mcp.json` always sits at the folder root. */
export const MCP_CONFIG_PATH = ".mcp.json";

export type McpTransport = "stdio" | "http" | "sse";

export const MCP_TRANSPORTS: readonly McpTransport[] = ["stdio", "http", "sse"];

/**
 * One entry of `mcpServers`.
 *
 * The typed fields hold a value ONLY when the file's value had the expected
 * shape. A `"command": 42` stays in `extra` untouched instead of being coerced
 * or discarded — `validateServer` reports it, `serialiseMcpConfig` writes it
 * back, and the user's file survives a round trip through a UI that could not
 * display it.
 */
export interface McpServer {
  /** The key under `mcpServers`. */
  name: string;
  /** Verbatim `type`. Absent means stdio; see `transportOf`. */
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Every key of this server that is not one of the above. Never dropped. */
  extra: Record<string, unknown>;
}

export interface McpConfig {
  servers: McpServer[];
  /** Every top-level key other than `mcpServers`. Never dropped. */
  extraTop: Record<string, unknown>;
  /**
   * Whether the source actually had an `mcpServers` key. A file that never
   * had one and has no servers should not grow an empty `"mcpServers": {}`
   * just because it passed through this editor.
   */
  hadServersKey: boolean;
}

export type McpParseResult =
  | { ok: true; config: McpConfig }
  | { ok: false; error: string };

export function emptyMcpConfig(): McpConfig {
  return { servers: [], extraTop: {}, hadServersKey: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Human wording for an unexpected JSON value, for error messages. */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string") return "a string";
  if (typeof value === "number") return "a number";
  if (typeof value === "boolean") return "a boolean";
  return typeof value;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;
}

function asStringMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  return Object.values(value).every((item) => typeof item === "string")
    ? (value as Record<string, string>)
    : undefined;
}

/**
 * Pulls the fields we model out of one raw server object, leaving everything
 * else — and anything malformed — in `extra`.
 */
function parseServer(name: string, raw: Record<string, unknown>): McpServer {
  const extra: Record<string, unknown> = { ...raw };
  const server: McpServer = { name, extra };

  for (const key of ["type", "command", "url"] as const) {
    const value = raw[key];
    if (typeof value === "string") {
      server[key] = value;
      delete extra[key];
    }
  }

  const args = asStringArray(raw.args);
  if (args !== undefined) {
    server.args = args;
    delete extra.args;
  }

  const env = asStringMap(raw.env);
  if (env !== undefined) {
    server.env = env;
    delete extra.env;
  }

  return server;
}

/**
 * Text → config.
 *
 * NEVER throws, and never answers a malformed file with an empty config: a
 * caller that then saved would write `{}` over content it could not read. A
 * failure comes back as `{ ok: false }` with a message worth showing, and the
 * only correct response to it is to refuse to save.
 *
 * A whitespace-only file is treated as empty rather than malformed — there is
 * no content to lose, and dead-ending on a zero-byte file helps nobody.
 */
export function parseMcpConfig(text: string): McpParseResult {
  if (!text.trim()) return { ok: true, config: emptyMcpConfig() };

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    // `errorText` rather than `.message`: this has to survive being thrown as
    // something other than an Error, and SyntaxError's message carries the
    // offset the user needs anyway.
    return { ok: false, error: errorText(e) };
  }

  if (!isPlainObject(root)) {
    return {
      ok: false,
      error: `Expected a JSON object at the top level, found ${describe(root)}.`,
    };
  }

  const { mcpServers, ...extraTop } = root;
  const hadServersKey = "mcpServers" in root;

  if (hadServersKey && !isPlainObject(mcpServers)) {
    return {
      ok: false,
      error: `"mcpServers" must be an object mapping server names to definitions, found ${describe(
        mcpServers
      )}.`,
    };
  }

  const servers: McpServer[] = [];
  for (const [name, raw] of Object.entries(mcpServers ?? {})) {
    // Refusing beats dropping. A non-object entry cannot be represented here,
    // so continuing would mean a later save silently deletes it.
    if (!isPlainObject(raw)) {
      return {
        ok: false,
        error: `Server "${name}" must be an object, found ${describe(raw)}.`,
      };
    }
    servers.push(parseServer(name, raw));
  }

  return { ok: true, config: { servers, extraTop, hadServersKey } };
}

/**
 * Known keys first in a natural reading order, then everything unrecognised.
 *
 * Extras are appended rather than spread first so that a malformed known key
 * parked in `extra` (say a numeric `command`) cannot clobber the value the
 * user has since typed to fix it.
 */
function serialiseServer(server: McpServer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (server.type !== undefined) out.type = server.type;
  if (server.command !== undefined) out.command = server.command;
  if (server.args !== undefined) out.args = server.args;
  if (server.env !== undefined) out.env = server.env;
  if (server.url !== undefined) out.url = server.url;

  for (const [key, value] of Object.entries(server.extra)) {
    if (key in out) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Config → text: 2-space indent, trailing newline.
 *
 * Key VALUES round-trip exactly. Key ORDER is normalised — the fields we model
 * are written first and unrecognised ones keep their relative order after
 * them — so a file whose keys were written in an unusual order comes back
 * reordered but complete.
 */
export function serialiseMcpConfig(config: McpConfig): string {
  const map: Record<string, unknown> = {};
  for (const server of config.servers) {
    map[server.name] = serialiseServer(server);
  }

  const root: Record<string, unknown> = {};
  if (config.hadServersKey || config.servers.length > 0) {
    root.mcpServers = map;
  }
  for (const [key, value] of Object.entries(config.extraTop)) {
    if (key in root) continue;
    root[key] = value;
  }

  return JSON.stringify(root, null, 2) + "\n";
}

/**
 * The transport to show and validate against.
 *
 * An unrecognised `type` reads as stdio here so the UI always has something to
 * render; `validateServer` is what refuses it.
 */
export function transportOf(server: McpServer): McpTransport {
  return server.type === "http" || server.type === "sse" ? server.type : "stdio";
}

export function isRemote(server: McpServer): boolean {
  return transportOf(server) !== "stdio";
}

/** Display only — `command` plus its arguments, as one line. */
export function commandLine(server: McpServer): string {
  return [server.command ?? "", ...(server.args ?? [])]
    .filter((part) => part.length > 0)
    .join(" ");
}

/**
 * How MANY env vars, never which. These hold API keys and tokens, so the
 * overview counts them and the editor is the only place values are shown.
 */
export function envCount(server: McpServer): number {
  return Object.keys(server.env ?? {}).length;
}

/** Unrecognised keys carried through untouched, for the "preserved" hint. */
export function extraKeys(server: McpServer): string[] {
  return Object.keys(server.extra);
}

/** The modelled fields of a server, as an editor hands them back. */
export interface ServerFields {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/**
 * Folds edited fields back onto the server they came from.
 *
 * Written as a fold rather than a fresh object so that every key this build
 * does not model rides along untouched — building a new server from the form
 * would be exactly the silent data loss this module exists to prevent.
 *
 * Switching transport DELETES the other transport's fields rather than leaving
 * them behind: a stdio `command` sitting on an http server is not preserved
 * history, it is a contradiction the next reader has to resolve. Unknown keys
 * are never touched by a switch.
 *
 * The five modelled keys are also cleared from `extra`, where parse parks a
 * malformed value. Without that, a `"command": 42` the user has just replaced
 * would be written back out alongside the fix.
 */
export function applyServerFields(base: McpServer, fields: ServerFields): McpServer {
  const extra = { ...base.extra };
  for (const key of ["type", "command", "args", "env", "url"] as const) {
    delete extra[key];
  }

  const next: McpServer = { ...base, name: fields.name.trim(), extra };
  delete next.type;
  delete next.command;
  delete next.args;
  delete next.env;
  delete next.url;

  if (fields.transport === "stdio") {
    // stdio is the implied default, so no `type` key is written for it.
    next.command = (fields.command ?? "").trim();
    if (fields.args && fields.args.length > 0) next.args = fields.args;
  } else {
    next.type = fields.transport;
    next.url = (fields.url ?? "").trim();
  }

  if (fields.env && Object.keys(fields.env).length > 0) next.env = fields.env;

  return next;
}

export interface ValidateOptions {
  /** Names of the OTHER servers, so a rename cannot silently clobber one. */
  otherNames?: string[];
}

/**
 * The first problem with a server, or `null` when it is fit to save.
 *
 * Note the `extra` checks: a known key only ends up there when its value had
 * the wrong shape, so its presence is exactly the "args must be an array of
 * strings" case — reported rather than rewritten, since the alternative is
 * discarding whatever the user actually wrote.
 */
export function validateServer(
  server: McpServer,
  options: ValidateOptions = {}
): string | null {
  const name = server.name.trim();
  if (!name) return "A server name is required.";
  if (options.otherNames?.includes(name)) {
    return `Another server is already called "${name}".`;
  }

  if ("type" in server.extra) return `"type" must be a string.`;
  if ("command" in server.extra) return `"command" must be a string.`;
  if ("url" in server.extra) return `"url" must be a string.`;
  if ("args" in server.extra) return `"args" must be an array of strings.`;
  if ("env" in server.extra) {
    return `"env" must be an object whose values are all strings.`;
  }

  if (
    server.type !== undefined &&
    !MCP_TRANSPORTS.includes(server.type as McpTransport)
  ) {
    return `"type" must be one of ${MCP_TRANSPORTS.join(", ")} — got "${server.type}".`;
  }

  if (transportOf(server) === "stdio") {
    if (!server.command?.trim()) return "A stdio server needs a command.";
  } else if (!server.url?.trim()) {
    return `A ${server.type} server needs a url.`;
  }

  return null;
}

/** The first problem across the whole config, or `null`. */
export function validateConfig(config: McpConfig): string | null {
  for (let i = 0; i < config.servers.length; i++) {
    const server = config.servers[i];
    const otherNames = config.servers
      .filter((_, j) => j !== i)
      .map((s) => s.name.trim());
    const error = validateServer(server, { otherNames });
    if (error) return `${server.name.trim() || "(unnamed)"}: ${error}`;
  }
  return null;
}
