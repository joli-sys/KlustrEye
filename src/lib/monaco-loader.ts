/**
 * Points `@monaco-editor/react` at the bundled `monaco-editor` package.
 *
 * Without this the loader fetches monaco from a CDN at runtime, producing a
 * SECOND monaco instance alongside the npm one that
 * `src/lib/editor/model-registry.ts` imports. A model created by one instance
 * cannot be attached to an editor created by the other, so the registry's
 * entire purpose — keeping an unsaved buffer alive across the unmount/remount
 * that react-router performs on every tab switch — would silently break.
 * (It also removes a network dependency the Tauri desktop build cannot rely
 * on.)
 *
 * Import this for its side effects from `src/App.tsx` at module scope: once
 * any <Editor> has mounted, `loader.init()` has run and `loader.config()` is
 * ignored, so configuring lazily would lose the race against `yaml-editor.tsx`
 * (whose monaco import IS lazy).
 */
import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";

import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

/**
 * A bundled monaco has no built-in worker URLs. Without this hook it throws
 * "You must define a function MonacoEnvironment.getWorkerUrl or
 * MonacoEnvironment.getWorker" the first time a language service is needed —
 * which for the base editor worker is as early as the first keystroke.
 */
globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

loader.config({ monaco });
