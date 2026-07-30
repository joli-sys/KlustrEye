import { describe, expect, it } from "vitest";
import {
  MCP_CONFIG_PATH,
  applyServerFields,
  commandLine,
  emptyMcpConfig,
  envCount,
  extraKeys,
  isRemote,
  parseMcpConfig,
  serialiseMcpConfig,
  transportOf,
  validateConfig,
  validateServer,
  type McpConfig,
  type McpServer,
} from "./mcp-config";

/** Parse that fails the test rather than the type-check when text is bad. */
function parseOk(text: string): McpConfig {
  const result = parseMcpConfig(text);
  if (!result.ok) throw new Error(`expected a parse, got: ${result.error}`);
  return result.config;
}

function serverNamed(config: McpConfig, name: string): McpServer {
  const found = config.servers.find((s) => s.name === name);
  if (!found) throw new Error(`no server "${name}"`);
  return found;
}

describe("parseMcpConfig", () => {
  it("reads a real stdio server", () => {
    const config = parseOk(`{
      "mcpServers": {
        "claude-flow": {
          "command": "npx",
          "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"],
          "env": { "KEY": "value" },
          "autoStart": false
        }
      }
    }`);

    expect(config.servers).toHaveLength(1);
    const server = serverNamed(config, "claude-flow");
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", "@claude-flow/cli@latest", "mcp", "start"]);
    expect(server.env).toEqual({ KEY: "value" });
    expect(transportOf(server)).toBe("stdio");
    // `autoStart` is not a field we model, so it is held rather than dropped.
    expect(server.extra).toEqual({ autoStart: false });
  });

  it("reads remote servers by their type", () => {
    const config = parseOk(`{
      "mcpServers": {
        "over-http": { "type": "http", "url": "https://example.test/mcp" },
        "over-sse": { "type": "sse", "url": "https://example.test/sse" }
      }
    }`);

    expect(transportOf(serverNamed(config, "over-http"))).toBe("http");
    expect(transportOf(serverNamed(config, "over-sse"))).toBe("sse");
    expect(isRemote(serverNamed(config, "over-sse"))).toBe(true);
    expect(isRemote(serverNamed(config, "over-http"))).toBe(true);
  });

  it("treats an empty or whitespace-only file as an empty config", () => {
    expect(parseOk("").servers).toEqual([]);
    expect(parseOk("   \n\t ").servers).toEqual([]);
  });

  it("remembers a file that had no mcpServers key at all", () => {
    const config = parseOk(`{ "somethingElse": 1 }`);
    expect(config.hadServersKey).toBe(false);
    // ...and does not invent one on the way back out.
    expect(serialiseMcpConfig(config)).toBe('{\n  "somethingElse": 1\n}\n');
  });

  it("reports malformed JSON instead of throwing", () => {
    const result = parseMcpConfig("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error).toBeTruthy();
  });

  it("never answers malformed input with an empty config", () => {
    // The dangerous failure mode: `{ ok: true, servers: [] }` here would let a
    // caller save `{"mcpServers":{}}` over content it could not read.
    for (const text of [
      "{ not json",
      "[]",
      '"a string"',
      "null",
      '{ "mcpServers": [] }',
      '{ "mcpServers": "nope" }',
      '{ "mcpServers": { "broken": 42 } }',
      '{ "mcpServers": { "broken": null } }',
    ]) {
      expect(parseMcpConfig(text).ok, text).toBe(false);
    }
  });

  it("keeps a malformed known field rather than discarding it", () => {
    const config = parseOk(`{
      "mcpServers": {
        "odd": { "command": 42, "args": "not-an-array", "env": { "K": 1 } }
      }
    }`);

    const server = serverNamed(config, "odd");
    expect(server.command).toBeUndefined();
    expect(server.args).toBeUndefined();
    expect(server.env).toBeUndefined();
    expect(server.extra).toEqual({
      command: 42,
      args: "not-an-array",
      env: { K: 1 },
    });
    // And the round trip still writes exactly what was there.
    expect(JSON.parse(serialiseMcpConfig(config)).mcpServers.odd).toEqual({
      command: 42,
      args: "not-an-array",
      env: { K: 1 },
    });
  });
});

describe("serialiseMcpConfig", () => {
  it("uses 2-space indent and a trailing newline", () => {
    const config = parseOk(`{"mcpServers":{"a":{"command":"x"}}}`);
    expect(serialiseMcpConfig(config)).toBe(
      '{\n  "mcpServers": {\n    "a": {\n      "command": "x"\n    }\n  }\n}\n'
    );
  });

  it("writes an empty server map when the key was there", () => {
    expect(serialiseMcpConfig(emptyMcpConfig())).toBe(
      '{\n  "mcpServers": {}\n}\n'
    );
  });

  it("lets a typed edit win over a malformed value parked in extra", () => {
    const config = parseOk(`{"mcpServers":{"odd":{"command":42}}}`);
    // The user fixes it in the editor.
    config.servers[0].command = "npx";
    delete config.servers[0].extra.command;
    expect(JSON.parse(serialiseMcpConfig(config)).mcpServers.odd).toEqual({
      command: "npx",
    });
  });
});

describe("round trip preserves unknown fields", () => {
  // The single most important guarantee in this module: `.mcp.json` belongs to
  // Claude Code and other tools, and will carry keys this build has never
  // heard of. Losing one is invisible until the user's agent stops working.
  const ORIGINAL = `{
  "mcpServers": {
    "claude-flow": {
      "command": "npx",
      "args": ["-y", "@claude-flow/cli@latest", "mcp", "start"],
      "env": { "KEY": "value" },
      "autoStart": false,
      "timeoutMs": 30000,
      "someFutureFlag": { "nested": ["deep", 1, null, true] }
    },
    "remote": {
      "type": "http",
      "url": "https://example.test/mcp",
      "headers": { "Authorization": "Bearer x" }
    }
  },
  "$schema": "https://example.test/mcp.schema.json",
  "inputs": [{ "id": "token", "type": "promptString" }],
  "unknownTopLevel": { "anything": "at all" }
}`;

  it("drops nothing — every key survives, values intact", () => {
    const first = parseOk(ORIGINAL);
    const text = serialiseMcpConfig(first);
    const before = JSON.parse(ORIGINAL);
    const after = JSON.parse(text);

    // Unknown TOP-LEVEL keys.
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(after.$schema).toEqual(before.$schema);
    expect(after.inputs).toEqual(before.inputs);
    expect(after.unknownTopLevel).toEqual(before.unknownTopLevel);

    // Unknown SERVER keys, including nested structures.
    expect(Object.keys(after.mcpServers).sort()).toEqual(
      Object.keys(before.mcpServers).sort()
    );
    for (const name of Object.keys(before.mcpServers)) {
      expect(Object.keys(after.mcpServers[name]).sort(), name).toEqual(
        Object.keys(before.mcpServers[name]).sort()
      );
      expect(after.mcpServers[name], name).toEqual(before.mcpServers[name]);
    }

    // Deep equality of the whole document is the real assertion.
    expect(after).toEqual(before);
  });

  it("is stable — a second round trip is byte-identical to the first", () => {
    const once = serialiseMcpConfig(parseOk(ORIGINAL));
    const twice = serialiseMcpConfig(parseOk(once));
    expect(twice).toBe(once);
  });

  it("keeps unknown keys through an actual edit", () => {
    const config = parseOk(ORIGINAL);
    // Edit ONE modelled field, the way the dialog does.
    serverNamed(config, "claude-flow").command = "bunx";

    const after = JSON.parse(serialiseMcpConfig(config));
    expect(after.mcpServers["claude-flow"].command).toBe("bunx");
    expect(after.mcpServers["claude-flow"].autoStart).toBe(false);
    expect(after.mcpServers["claude-flow"].timeoutMs).toBe(30000);
    expect(after.mcpServers["claude-flow"].someFutureFlag).toEqual({
      nested: ["deep", 1, null, true],
    });
    expect(after.mcpServers.remote.headers).toEqual({
      Authorization: "Bearer x",
    });
    expect(after.$schema).toBe("https://example.test/mcp.schema.json");
    expect(after.unknownTopLevel).toEqual({ anything: "at all" });
  });

  it("keeps the other servers' unknown keys when one is removed", () => {
    const config = parseOk(ORIGINAL);
    config.servers = config.servers.filter((s) => s.name !== "claude-flow");

    const after = JSON.parse(serialiseMcpConfig(config));
    expect(Object.keys(after.mcpServers)).toEqual(["remote"]);
    expect(after.mcpServers.remote.headers).toEqual({
      Authorization: "Bearer x",
    });
    expect(after.inputs).toEqual([{ id: "token", type: "promptString" }]);
  });
});

describe("applyServerFields", () => {
  const withExtras: McpServer = {
    name: "svc",
    command: "npx",
    args: ["-y", "pkg"],
    env: { A: "1" },
    extra: { autoStart: false, someFutureFlag: { nested: true } },
  };

  it("edits a stdio server without disturbing unknown keys", () => {
    const next = applyServerFields(withExtras, {
      name: "svc",
      transport: "stdio",
      command: "bunx",
      args: ["-y", "other"],
      env: { A: "2" },
    });

    expect(next.command).toBe("bunx");
    expect(next.args).toEqual(["-y", "other"]);
    expect(next.env).toEqual({ A: "2" });
    expect(next.extra).toEqual({ autoStart: false, someFutureFlag: { nested: true } });
  });

  it("trims the name, command and url", () => {
    const next = applyServerFields(withExtras, {
      name: "  spaced  ",
      transport: "stdio",
      command: "  npx  ",
    });
    expect(next.name).toBe("spaced");
    expect(next.command).toBe("npx");

    const remote = applyServerFields(withExtras, {
      name: "r",
      transport: "http",
      url: "  https://example.test  ",
    });
    expect(remote.url).toBe("https://example.test");
  });

  it("drops the other transport's fields on a switch, keeping unknown keys", () => {
    const remote = applyServerFields(withExtras, {
      name: "svc",
      transport: "http",
      url: "https://example.test/mcp",
    });

    expect(remote.type).toBe("http");
    expect(remote.url).toBe("https://example.test/mcp");
    // A stdio command left on an http server would be a contradiction.
    expect(remote.command).toBeUndefined();
    expect(remote.args).toBeUndefined();
    // ...but nothing unrecognised is collateral damage.
    expect(remote.extra).toEqual({ autoStart: false, someFutureFlag: { nested: true } });
    expect(serialiseMcpConfig({
      servers: [remote],
      extraTop: {},
      hadServersKey: true,
    })).toContain("someFutureFlag");
  });

  it("writes no type key for stdio", () => {
    const back = applyServerFields(
      { name: "r", type: "http", url: "https://x.test", extra: {} },
      { name: "r", transport: "stdio", command: "npx" }
    );
    expect(back.type).toBeUndefined();
    expect(back.url).toBeUndefined();
    expect(JSON.parse(
      serialiseMcpConfig({ servers: [back], extraTop: {}, hadServersKey: true })
    ).mcpServers.r).toEqual({ command: "npx" });
  });

  it("omits empty args and env rather than writing empty containers", () => {
    const next = applyServerFields(withExtras, {
      name: "svc",
      transport: "stdio",
      command: "npx",
      args: [],
      env: {},
    });
    expect(next.args).toBeUndefined();
    expect(next.env).toBeUndefined();
    expect(JSON.parse(
      serialiseMcpConfig({ servers: [next], extraTop: {}, hadServersKey: true })
    ).mcpServers.svc).toEqual({
      command: "npx",
      autoStart: false,
      someFutureFlag: { nested: true },
    });
  });

  it("clears a malformed value from extra once the field is fixed", () => {
    const config = parseOk(`{"mcpServers":{"odd":{"command":42,"keepMe":true}}}`);
    const fixed = applyServerFields(serverNamed(config, "odd"), {
      name: "odd",
      transport: "stdio",
      command: "npx",
    });

    expect(validateServer(fixed)).toBeNull();
    expect(JSON.parse(
      serialiseMcpConfig({ servers: [fixed], extraTop: {}, hadServersKey: true })
    ).mcpServers.odd).toEqual({ command: "npx", keepMe: true });
  });

  it("leaves the original untouched", () => {
    const before = JSON.parse(JSON.stringify(withExtras));
    applyServerFields(withExtras, { name: "x", transport: "http", url: "u" });
    expect(withExtras).toEqual(before);
  });
});

describe("validateServer", () => {
  const stdio = (over: Partial<McpServer> = {}): McpServer => ({
    name: "a",
    command: "npx",
    extra: {},
    ...over,
  });

  it("accepts a well-formed stdio server", () => {
    expect(validateServer(stdio())).toBeNull();
    expect(validateServer(stdio({ args: ["-y", "pkg"], env: { K: "v" } }))).toBeNull();
  });

  it("accepts a well-formed remote server", () => {
    expect(
      validateServer({
        name: "r",
        type: "http",
        url: "https://example.test",
        extra: {},
      })
    ).toBeNull();
  });

  it("requires a name", () => {
    expect(validateServer(stdio({ name: "" }))).toMatch(/name is required/i);
    expect(validateServer(stdio({ name: "   " }))).toMatch(/name is required/i);
  });

  it("requires a command for stdio", () => {
    expect(validateServer(stdio({ command: undefined }))).toMatch(/needs a command/i);
    expect(validateServer(stdio({ command: "  " }))).toMatch(/needs a command/i);
  });

  it("requires a url for http and sse", () => {
    for (const type of ["http", "sse"] as const) {
      expect(
        validateServer({ name: "r", type, extra: {} }),
        type
      ).toMatch(/needs a url/i);
    }
  });

  it("rejects an unrecognised transport", () => {
    expect(
      validateServer({ name: "r", type: "carrier-pigeon", url: "x", extra: {} })
    ).toMatch(/must be one of/i);
  });

  it("reports a malformed args, env, command or url held in extra", () => {
    expect(validateServer(stdio({ extra: { args: "nope" } }))).toMatch(
      /"args" must be an array of strings/
    );
    expect(validateServer(stdio({ extra: { env: { K: 1 } } }))).toMatch(
      /"env" must be an object/
    );
    expect(validateServer(stdio({ command: undefined, extra: { command: 42 } }))).toMatch(
      /"command" must be a string/
    );
    expect(
      validateServer({ name: "r", type: "http", extra: { url: 7 } })
    ).toMatch(/"url" must be a string/);
    expect(validateServer(stdio({ extra: { type: 1 } }))).toMatch(
      /"type" must be a string/
    );
  });

  it("rejects a name another server already uses", () => {
    expect(validateServer(stdio({ name: "dup" }), { otherNames: ["dup"] })).toMatch(
      /already called/i
    );
    expect(validateServer(stdio({ name: "fine" }), { otherNames: ["dup"] })).toBeNull();
  });
});

describe("validateConfig", () => {
  it("passes a good config and names the offender in a bad one", () => {
    const good = parseOk(`{"mcpServers":{"a":{"command":"x"}}}`);
    expect(validateConfig(good)).toBeNull();

    const bad = parseOk(`{"mcpServers":{"a":{"command":"x"},"b":{}}}`);
    expect(validateConfig(bad)).toMatch(/^b: /);
  });
});

describe("display helpers", () => {
  it("joins a command with its arguments", () => {
    expect(
      commandLine({ name: "a", command: "npx", args: ["-y", "pkg"], extra: {} })
    ).toBe("npx -y pkg");
    expect(commandLine({ name: "a", command: "npx", extra: {} })).toBe("npx");
    expect(commandLine({ name: "a", extra: {} })).toBe("");
  });

  it("counts env vars without exposing their values", () => {
    expect(envCount({ name: "a", env: { A: "1", B: "2" }, extra: {} })).toBe(2);
    expect(envCount({ name: "a", extra: {} })).toBe(0);
  });

  it("lists the unknown keys it is carrying", () => {
    const config = parseOk(`{"mcpServers":{"a":{"command":"x","autoStart":true}}}`);
    expect(extraKeys(serverNamed(config, "a"))).toEqual(["autoStart"]);
  });

  it("points at the workspace-root config path", () => {
    expect(MCP_CONFIG_PATH).toBe(".mcp.json");
  });
});
