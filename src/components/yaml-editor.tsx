import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export function YamlEditor({ value, onChange, readOnly = false, height = "500px" }: YamlEditorProps) {
  return (
    <Suspense fallback={<Skeleton style={{ height }} className="w-full" />}>
      <MonacoEditor
        height={height}
        language="yaml"
        theme="vs-dark"
        value={value}
        onChange={(val) => onChange?.(val || "")}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          scrollBeyondLastLine: false,
          wordWrap: "on",
          tabSize: 2,
          automaticLayout: true,
          lineNumbers: "on",
          renderLineHighlight: "line",
          padding: { top: 8 },
        }}
      />
    </Suspense>
  );
}
