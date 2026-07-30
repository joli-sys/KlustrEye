/**
 * A Monarch grammar for Helm templates.
 *
 * A Helm template is YAML with Go template directives spliced into it —
 * `{{ .Values.image }}`, `{{- if .Values.ingress.enabled }}`,
 * `{{ include "chart.fullname" . }}`. Feeding that to monaco's `yaml` grammar
 * mis-tokenises exactly the lines that matter: `{{- if x }}` has no colon, so
 * YAML reads the whole line as a bare scalar, and `key: {{ .Values.x }}` opens
 * a flow mapping that never closes and drags the rest of the file with it.
 *
 * Deliberately modest — YAML's own grammar is 200 lines of anchors, tags and
 * block scalars, and a tokenizer that gets those subtly wrong is worse than
 * one that leaves them alone. What it covers: directives (anywhere, including
 * inside quoted scalars), comments, `key:`, quoted and bare scalars, numbers
 * and booleans.
 *
 * Token names are chosen from the set monaco's built-in `vs`/`vs-dark` themes
 * actually colour (see `editor/standalone/common/themes.js`) — an invented
 * name renders as plain foreground. `metatag` for the `{{ }}` delimiters is
 * what makes a directive read as "not YAML" at a glance.
 *
 * Data only, and `monaco` imported for TYPES ONLY, so this module stays
 * loadable under vitest's `environment: "node"` — `helm-language.test.ts`
 * runs monaco's own Monarch compiler over it. Registration lives in
 * `src/lib/monaco-loader.ts`.
 */
import type * as monaco from "monaco-editor";

export const HELM_LANGUAGE_ID = "helm";

export const helmLanguageConfiguration: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: "#", blockComment: ["{{/*", "*/}}"] },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  folding: { offSide: true },
};

export const helmMonarchLanguage: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".helm",

  // Go template control words and the pipeline functions a chart cannot avoid.
  // Only recognised INSIDE `{{ }}` — `if:` is a perfectly ordinary YAML key.
  keywords: [
    "if", "else", "end", "range", "with", "template", "define",
    "block", "and", "or", "not", "eq", "ne", "lt", "le", "gt", "ge", "len",
    "index", "print", "printf", "println", "nil", "true", "false",
  ],

  tokenizer: {
    root: [
      // FIRST, unconditionally: a directive can stand where a YAML key, a
      // value, or a whole line would. Every rule below it assumes it already
      // ran, which is what keeps `{{- if }}` off the key/scalar rules.
      [/\{\{-?/, { token: "metatag", next: "@action" }],

      [/[ \t\r\n]+/, "white"],
      [/#.*$/, "comment"],

      // Document markers and block-structure indicators.
      [/^---/, "delimiter"],
      [/^\.{3}/, "delimiter"],
      [/[-?:](?= |$)/, "delimiter"],

      // Unterminated quotes, caught before the string states so a stray quote
      // cannot carry the string colour across every following line.
      [/"([^"\\{]|\\.)*$/, "invalid"],
      [/'[^'{]*$/, "invalid"],
      [/"/, { token: "string", next: "@doubleQuoted" }],
      [/'/, { token: "string", next: "@singleQuoted" }],

      // `key:` — the leading character class excludes `{`, so a line starting
      // with a directive can never be read as a key.
      [/([A-Za-z_][\w.\-/]*)([ \t]*)(:)/, ["type", "white", "delimiter"]],

      [/\b(true|True|TRUE|false|False|FALSE|null|Null|NULL|yes|no|on|off)\b/, "keyword"],
      [/[+-]?\d+(\.\d+)?\b/, "number"],

      // Bare scalar. Stops at `{` so the directive rule gets first refusal on
      // the next pass, and at `#` so a trailing comment stays a comment.
      [/[^\s{#'"]+/, "string"],
      [/./, ""],
    ],

    // Inside `{{ … }}`. Pushed from root AND from either quoted-scalar state,
    // so `image: "{{ .Values.image }}"` highlights the directive rather than
    // painting the whole value as a string.
    action: [
      [/-?\}\}/, { token: "metatag", next: "@pop" }],
      [/\/\*/, { token: "comment", next: "@actionComment" }],
      [/"([^"\\]|\\.)*"/, "string"],
      [/`[^`]*`/, "string"],
      [/'([^'\\]|\\.)*'/, "string"],
      // `.Values.image.tag`, `$name`, and the bare `.` meaning "current scope".
      // `\w*` rather than a required first letter so the bare `$` in
      // `$.Template.BasePath` (the root context) is a variable too.
      [/\$\w*/, "variable"],
      [/\.[A-Za-z_][\w.]*/, "variable"],
      [/\.(?![A-Za-z_])/, "variable"],
      [/[+-]?\d+(\.\d+)?\b/, "number"],
      [
        /[A-Za-z_]\w*/,
        { cases: { "@keywords": "keyword", "@default": "identifier" } },
      ],
      [/[|():=,]/, "delimiter"],
      [/[ \t\r\n]+/, "white"],
      [/./, ""],
    ],

    actionComment: [
      [/\*\//, { token: "comment", next: "@pop" }],
      [/./, "comment"],
    ],

    doubleQuoted: [
      [/\{\{-?/, { token: "metatag", next: "@action" }],
      [/[^\\"{]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, { token: "string", next: "@pop" }],
      [/./, "string"],
    ],

    // YAML single quotes have no escapes; `''` is a literal quote.
    singleQuoted: [
      [/\{\{-?/, { token: "metatag", next: "@action" }],
      [/''/, "string.escape"],
      [/[^'{]+/, "string"],
      [/'/, { token: "string", next: "@pop" }],
      [/./, "string"],
    ],
  },
};
