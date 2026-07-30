/**
 * Path → Monaco language id.
 *
 * Deliberately free of any `monaco-editor` import. vitest runs with
 * `environment: "node"` and monaco reads `window` at module scope, so anything
 * that transitively reaches it cannot be imported from a test — which is why
 * this lives here rather than next to the editor component that uses it.
 *
 * Every id returned here must be REGISTERED with monaco, not merely plausible:
 * an unknown language id is not an error, it silently renders as plaintext.
 * `yaml`, `hcl`, `json`, `ini`, … come from monaco's `basic-languages`, all of
 * which `esm/vs/editor/editor.main.js` (the entry `import "monaco-editor"`
 * resolves to) imports. `helm` is ours — `src/lib/monaco-loader.ts` registers
 * it, and that module must have run before a helm model is created.
 */

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
  // Terraform. monaco's grammar is registered under the id `hcl` and already
  // claims all three extensions itself.
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  // Terraform state is JSON, not HCL — it only lives next to HCL files.
  tfstate: "json",
};

const LANGUAGE_BY_BASENAME: Record<string, string> = {
  dockerfile: "dockerfile",
};

/**
 * Whether this path is a Helm template — YAML carrying Go template directives —
 * rather than ordinary YAML.
 *
 * A chart's `Chart.yaml` and `values.yaml` are plain YAML and MUST NOT come
 * back as `helm`: they sit at the chart root, so requiring a `templates/`
 * directory segment is what separates them. `.tpl` (partials, conventionally
 * `_helpers.tpl`) is a template wherever it lives — the extension exists for
 * nothing else.
 */
function isHelmTemplate(path: string, extension: string): boolean {
  if (extension === "tpl") return true;
  if (extension !== "yaml" && extension !== "yml") return false;
  // Only DIRECTORY segments count, so a file literally named `templates` is
  // not mistaken for the directory.
  const segments = path.toLowerCase().replace(/\\/g, "/").split("/");
  return segments.slice(0, -1).includes("templates");
}

/** Best-effort Monaco language id for a path; `plaintext` when unknown. */
export function languageForPath(path: string): string {
  const base = (path.split(/[/\\]/).pop() ?? "").toLowerCase();
  const byName = LANGUAGE_BY_BASENAME[base];
  if (byName) return byName;
  const dot = base.lastIndexOf(".");
  // dot === 0 is a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return "plaintext";
  const extension = base.slice(dot + 1);
  if (isHelmTemplate(path, extension)) return "helm";
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}
