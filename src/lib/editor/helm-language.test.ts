import { describe, it, expect } from "vitest";
// monaco's own Monarch compiler and tokenizer, reached by their internal
// paths. `monaco-editor`'s package exports expose `"./*"`, and neither module
// touches the DOM, so both load under vitest's `environment: "node"` where
// `monaco-editor` itself cannot.
//
// This is the only honest way to check a Monarch grammar without a browser.
// A malformed grammar is not a build error and not a type error: monaco
// compiles it lazily and throws — or worse, silently mis-colours — the first
// time a helm model is tokenized, i.e. in front of the user. Several classes
// of mistake (group counts that do not cover the whole match, a rule that
// makes no progress, a `next` state that does not exist) are only detected
// when a line actually runs through the lexer, which is what this does.
// @ts-expect-error — internal monaco module, no type declarations shipped.
import { compile } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchCompile.js";
// @ts-expect-error — internal monaco module, no type declarations shipped.
import { MonarchTokenizer } from "monaco-editor/esm/vs/editor/standalone/common/monarch/monarchLexer.js";
import {
  HELM_LANGUAGE_ID,
  helmMonarchLanguage,
  helmLanguageConfiguration,
} from "@/lib/editor/helm-language";

/**
 * `MonarchTokenizer` reaches for two platform services. Neither participates
 * in tokenization of a grammar without embedded languages, so both are stubbed
 * down to the members the constructor and hot path actually call.
 */
const languageServiceStub = {
  getLanguageIdByLanguageName: () => null,
  getLanguageIdByMimeType: () => null,
};
const configurationServiceStub = {
  getValue: () => 20000, // editor.maxTokenizationLineLength
  onDidChangeConfiguration: () => ({ dispose() {} }),
};

function makeTokenizer() {
  const lexer = compile(HELM_LANGUAGE_ID, helmMonarchLanguage);
  return new MonarchTokenizer(
    languageServiceStub,
    null,
    HELM_LANGUAGE_ID,
    lexer,
    configurationServiceStub
  );
}

/**
 * Tokenize `lines` as one document, so state carried across line boundaries
 * (an unterminated quote, an unclosed `{{`) is exercised rather than reset.
 * Returns one array of bare token types per line — `tokenPostfix` stripped,
 * and `white` dropped as noise.
 */
function tokenizeLines(lines: string[]): string[][] {
  const tokenizer = makeTokenizer();
  let state = tokenizer.getInitialState();
  return lines.map((line) => {
    const result = tokenizer.tokenize(line, true, state);
    state = result.endState;
    return result.tokens
      .map((t: { type: string }) => t.type.replace(/\.helm$/, ""))
      .filter((t: string) => t !== "white");
  });
}

const tokenize = (line: string): string[] => tokenizeLines([line])[0];

describe("helm Monarch grammar", () => {
  it("compiles, and exposes exactly the states it transitions into", () => {
    const lexer = compile(HELM_LANGUAGE_ID, helmMonarchLanguage);
    // `compile` throws on a dangling `@state`, so reaching here already proves
    // the references resolve; pinning the set makes dropping one deliberate.
    expect(Object.keys(lexer.tokenizer).sort()).toEqual([
      "action",
      "actionComment",
      "doubleQuoted",
      "root",
      "singleQuoted",
    ]);
    expect(lexer.start).toBe("root");
  });

  it("tokenizes ordinary YAML the way YAML should look", () => {
    expect(tokenize("apiVersion: apps/v1")).toEqual([
      "type", // apiVersion
      "delimiter", // :
      "string", // apps/v1
    ]);
    expect(tokenize("  replicas: 3  # how many")).toEqual([
      "type",
      "delimiter",
      "number",
      "comment",
    ]);
    expect(tokenize("  tls: true")).toEqual(["type", "delimiter", "keyword"]);
    expect(tokenize("  - name: my-app")).toEqual([
      "delimiter", // block sequence dash
      "type",
      "delimiter",
      "string",
    ]);
    expect(tokenize("---")).toEqual(["delimiter"]);
  });

  it("marks a Go template directive as a directive, not as YAML", () => {
    // THE case the yaml grammar gets wrong: no colon on the line, so yaml
    // reads the whole thing as one bare scalar.
    expect(tokenize("{{- if .Values.ingress.enabled }}")).toEqual([
      "metatag", // {{-
      "keyword", // if
      "variable", // .Values.ingress.enabled
      "metatag", // }}
    ]);
    expect(tokenize("{{- end }}")).toEqual(["metatag", "keyword", "metatag"]);
  });

  it("keeps the key a key when the value is a directive", () => {
    expect(tokenize("  image: {{ .Values.image.repository }}")).toEqual([
      "type",
      "delimiter",
      "metatag",
      "variable",
      "metatag",
    ]);
  });

  it("highlights a directive nested inside a quoted scalar", () => {
    // `"{{ … }}"` is the single most common line in a chart. Colouring the
    // whole value as one string is not wrong exactly, but it hides the
    // interpolation, which is the only interesting part.
    expect(tokenize('  name: "{{ include "chart.fullname" . }}-web"')).toEqual([
      "type",
      "delimiter",
      "string", // opening "
      "metatag", // {{
      "identifier", // include
      "string", // "chart.fullname"
      "variable", // .
      "metatag", // }}
      "string", // -web"
    ]);
    // Single quotes too, including YAML's '' escape.
    expect(tokenize("  cmd: 'don''t {{ .Values.x }}'")).toEqual([
      "type",
      "delimiter",
      "string",
      "string.escape",
      "string",
      "metatag",
      "variable",
      "metatag",
      "string",
    ]);
  });

  it("understands pipelines, functions and the root context", () => {
    expect(
      tokenize('  sum: {{ include (print $.Template.BasePath "/cm.yaml") . | sha256sum }}')
    ).toEqual([
      "type",
      "delimiter",
      "metatag",
      "identifier", // include
      "delimiter", // (
      "keyword", // print
      // `$` and `.Template.BasePath` are two rules but one token — monaco
      // coalesces adjacent runs of the same type.
      "variable",
      "string", // "/cm.yaml"
      "delimiter", // )
      "variable", // .
      "delimiter", // |
      "identifier", // sha256sum
      "metatag",
    ]);
  });

  it("treats {{/* … */}} as a comment", () => {
    expect(tokenize("{{/* not rendered */}}")).toEqual([
      "metatag",
      "comment",
      "metatag",
    ]);
  });

  it("does not let a directive inside a YAML comment escape the comment", () => {
    expect(tokenize("# see {{ .Values.x }} above")).toEqual(["comment"]);
  });

  it("recovers on the next line from an unterminated quote", () => {
    // Without the explicit invalid-quote rules the string state would carry
    // to end of file and paint every remaining line as a string.
    expect(
      tokenizeLines(["  bad: \"unterminated", "  after: fine"])
    ).toEqual([
      ["type", "delimiter", "invalid"],
      ["type", "delimiter", "string"],
    ]);
  });

  it("declares the comment syntax Helm actually uses", () => {
    // `{{/* … */}}`, not `<!-- -->` and not `//`. Drives Cmd+/ in the editor.
    expect(helmLanguageConfiguration.comments).toEqual({
      lineComment: "#",
      blockComment: ["{{/*", "*/}}"],
    });
  });
});
