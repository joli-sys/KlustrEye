import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_NAME_MAX_CHARS,
  buildPodLogAttachment,
  buildResourceYamlAttachment,
  capAttachmentContent,
  composeDispatchPrompt,
  formatAttachmentSize,
  logDispatchPresets,
  resourceDispatchPresets,
  sanitizeAttachmentName,
  toSeedAttachments,
} from "./agent-dispatch";

const utf8 = (s: string) => new TextEncoder().encode(s).length;

describe("formatAttachmentSize", () => {
  it("spells the unit out, because these numbers land in prose", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(131_072)).toBe("128 KiB");
    expect(formatAttachmentSize(512_172)).toBe("500.2 KiB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5 MiB");
  });
});

describe("sanitizeAttachmentName", () => {
  it("leaves an ordinary name alone", () => {
    expect(sanitizeAttachmentName("pod-api-7f9-logs.txt")).toBe("pod-api-7f9-logs.txt");
  });

  it("replaces path separators so the name is one component", () => {
    // Interior dots survive — only the separators are replaced, exactly as the
    // backend does it, so both sides land on the same filename.
    expect(sanitizeAttachmentName("logs/../../etc/passwd")).toBe("logs-..-..-etc-passwd");
  });

  it("cannot spell a traversal, however it is written", () => {
    // Dots survive INSIDE a name (`pod.log`) but never at the edges, which is
    // what makes `.` and `..` unrepresentable rather than blocklisted.
    expect(sanitizeAttachmentName("..")).toBe("context.txt");
    expect(sanitizeAttachmentName("../../")).toBe("context.txt");
    expect(sanitizeAttachmentName(".hidden.")).toBe("hidden");
    expect(sanitizeAttachmentName("pod.log")).toBe("pod.log");
  });

  it("strips control characters, including a NUL and a newline", () => {
    const hostile = `logs${String.fromCharCode(0)}\n\r${String.fromCharCode(127)}.txt`;
    const cleaned = sanitizeAttachmentName(hostile);
    expect(cleaned).toBe("logs----.txt");
    expect([...cleaned].some((c) => c.codePointAt(0)! < 0x20)).toBe(false);
  });

  it("falls back when nothing recognisable survives", () => {
    // `///` sanitises to `---`, which names nothing a user could recognise.
    expect(sanitizeAttachmentName("///")).toBe("context.txt");
    expect(sanitizeAttachmentName("///", "pod-logs.txt")).toBe("pod-logs.txt");
  });

  it("caps a long name but keeps its extension", () => {
    const long = `pod-${"a".repeat(200)}-logs.txt`;
    const capped = sanitizeAttachmentName(long);
    expect([...capped].length).toBe(ATTACHMENT_NAME_MAX_CHARS);
    // The extension is what makes the file recognisable in the agent's
    // transcript, so a flat truncation losing it would be a regression.
    expect(capped.endsWith(".txt")).toBe(true);
  });

  it("counts characters, not bytes, so multi-byte names are not cut short", () => {
    const capped = sanitizeAttachmentName(`${"é".repeat(200)}.txt`);
    expect([...capped].length).toBe(ATTACHMENT_NAME_MAX_CHARS);
  });
});

describe("capAttachmentContent", () => {
  it("passes content under the cap through untouched", () => {
    const text = "line 1\nline 2\n";
    const capped = capAttachmentContent(text, { maxBytes: 1024 });
    expect(capped.content).toBe(text);
    expect(capped.truncated).toBe(false);
    expect(capped.bytes).toBe(utf8(text));
    expect(capped.originalBytes).toBe(utf8(text));
  });

  it("keeps the END of a log, not the start", () => {
    const lines = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    lines.push("panic: the failure the user asked about");
    const text = lines.join("\n");

    const capped = capAttachmentContent(text, { maxBytes: 2048, keep: "tail" });

    expect(capped.truncated).toBe(true);
    expect(capped.content).toContain("panic: the failure the user asked about");
    expect(capped.content).not.toContain("line 0\n");
    // The last line must be intact — this is the whole point of keeping the tail.
    expect(capped.content.endsWith("panic: the failure the user asked about")).toBe(true);
  });

  it("stays inside the byte budget, marker included", () => {
    const text = "x".repeat(100_000);
    const capped = capAttachmentContent(text, { maxBytes: 4096 });
    expect(capped.bytes).toBeLessThanOrEqual(4096);
    expect(capped.originalBytes).toBe(100_000);
  });

  it("says inside the content that it was truncated", () => {
    // An agent handed a partial log with no note will draw conclusions the
    // dropped half contradicts.
    const capped = capAttachmentContent("y".repeat(50_000), { maxBytes: 4096 });
    expect(capped.content).toContain("truncated");
    expect(capped.content.split("\n")[0]).toMatch(/^\[KlustrEye: truncated to the last /);
  });

  it("drops the partial first line rather than starting mid-line", () => {
    const text = Array.from({ length: 400 }, (_, i) => `${i}: ${"z".repeat(40)}`).join("\n");
    const capped = capAttachmentContent(text, { maxBytes: 1024 });
    const firstLogLine = capped.content.split("\n")[1];
    expect(firstLogLine).toMatch(/^\d+: z+$/);
  });

  it("keeps a single enormous line rather than emptying the file", () => {
    // No newline anywhere in the kept region: trimming to a line boundary
    // would leave nothing but the marker.
    const capped = capAttachmentContent("w".repeat(20_000), { maxBytes: 2048 });
    expect(capped.content).toContain("w".repeat(100));
  });

  it("never splits a multi-byte character", () => {
    const capped = capAttachmentContent("é".repeat(20_000), { maxBytes: 2048 });
    expect(capped.content).not.toContain("�");
  });

  it("keeps the HEAD for a manifest, where the structure is", () => {
    const yaml = `apiVersion: apps/v1\nkind: Deployment\n${"  # filler\n".repeat(5000)}`;
    const capped = capAttachmentContent(yaml, { maxBytes: 2048, keep: "head" });
    expect(capped.truncated).toBe(true);
    expect(capped.kept).toBe("head");
    expect(capped.content.startsWith("apiVersion: apps/v1\nkind: Deployment\n")).toBe(true);
    // The marker goes last so it cannot be mistaken for part of the document.
    expect(capped.content.trimEnd().endsWith("]")).toBe(true);
  });
});

describe("buildPodLogAttachment", () => {
  it("names the file after the pod and container", () => {
    const built = buildPodLogAttachment({
      podName: "api-7f9c8d",
      container: "api",
      logs: "hello\n",
    });
    expect(built.name).toBe("pod-api-7f9c8d-api-logs.txt");
    expect(built.content).toBe("hello\n");
    expect(built.truncated).toBe(false);
  });

  it("omits the container when there is only one to speak of", () => {
    const built = buildPodLogAttachment({ podName: "api-7f9c8d", logs: "hello\n" });
    expect(built.name).toBe("pod-api-7f9c8d-logs.txt");
  });

  it("keeps the tail of a large log", () => {
    const logs = `${"noise\n".repeat(100_000)}OOMKilled`;
    const built = buildPodLogAttachment({ podName: "api", logs, maxBytes: 8192 });
    expect(built.truncated).toBe(true);
    expect(built.kept).toBe("tail");
    expect(built.content.endsWith("OOMKilled")).toBe(true);
    expect(built.bytes).toBeLessThanOrEqual(8192);
  });
});

describe("buildResourceYamlAttachment", () => {
  it("names the file after the kind and resource", () => {
    const built = buildResourceYamlAttachment({
      kind: "Deployment",
      name: "api",
      yaml: "kind: Deployment\n",
    });
    expect(built.name).toBe("deployment-api.yaml");
  });

  it("survives a resource name that looks like a path", () => {
    const built = buildResourceYamlAttachment({
      kind: "ConfigMap",
      name: "../../etc/shadow",
      yaml: "kind: ConfigMap\n",
    });
    expect(built.name).toBe("configmap-..-..-etc-shadow.yaml");
    expect(built.name).not.toContain("/");
  });
});

describe("composeDispatchPrompt", () => {
  it("is the task text followed by a line per attachment", () => {
    const attachment = buildPodLogAttachment({
      podName: "api",
      container: "api",
      logs: "hello\n",
    });
    expect(composeDispatchPrompt("  Explain these logs.  ", [attachment])).toBe(
      "Explain these logs.\n\nAttached context:\npod-api-api-logs.txt"
    );
  });

  it("tells the agent the attachment is partial", () => {
    const attachment = buildPodLogAttachment({
      podName: "api",
      logs: "q\n".repeat(50_000),
      maxBytes: 4096,
    });
    const prompt = composeDispatchPrompt("Find the root cause.", [attachment]);
    expect(prompt).toContain("Find the root cause.");
    expect(prompt).toContain("pod-api-logs.txt (truncated: only the last ");
  });

  it("lists several attachments in the order they were given", () => {
    const a = buildPodLogAttachment({ podName: "api", logs: "a\n" });
    const b = buildResourceYamlAttachment({ kind: "Pod", name: "api", yaml: "b\n" });
    expect(composeDispatchPrompt("Look.", [a, b])).toBe(
      "Look.\n\nAttached context:\npod-api-logs.txt\npod-api.yaml"
    );
  });

  it("still names the attachments when the task field is empty", () => {
    const a = buildPodLogAttachment({ podName: "api", logs: "a\n" });
    expect(composeDispatchPrompt("   ", [a])).toBe("Attached context:\npod-api-logs.txt");
  });

  it("is just the task when there is nothing attached", () => {
    expect(composeDispatchPrompt("Do the thing.", [])).toBe("Do the thing.");
  });
});

describe("toSeedAttachments", () => {
  it("sends only name and content — the sizes are for the UI", () => {
    const built = buildPodLogAttachment({ podName: "api", logs: "hello\n" });
    expect(toSeedAttachments([built])).toEqual([
      { name: "pod-api-logs.txt", content: "hello\n" },
    ]);
  });
});

describe("presets", () => {
  it("name the pod, container and namespace so the prompt stands alone", () => {
    const presets = logDispatchPresets({
      podName: "api-7f9",
      container: "api",
      namespace: "prod",
    });
    expect(presets.map((p) => p.id)).toEqual(["explain", "root-cause", "fix"]);
    for (const preset of presets) {
      expect(preset.prompt).toContain("api-7f9");
      expect(preset.prompt).toContain("container api");
      expect(preset.prompt).toContain("namespace prod");
    }
  });

  it("omit what it does not know rather than saying 'undefined'", () => {
    for (const preset of logDispatchPresets({ podName: "api-7f9" })) {
      expect(preset.prompt).not.toContain("undefined");
      expect(preset.prompt).not.toContain("container");
      expect(preset.prompt).not.toContain("namespace");
    }
  });

  it("name the resource for a resource dispatch", () => {
    const presets = resourceDispatchPresets({
      kind: "Deployment",
      name: "api",
      namespace: "prod",
    });
    expect(presets.map((p) => p.id)).toEqual(["explain", "review", "compare"]);
    for (const preset of presets) {
      expect(preset.prompt).toContain("Deployment api");
      expect(preset.prompt).toContain("namespace prod");
    }
  });
});
