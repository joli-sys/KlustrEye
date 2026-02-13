"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Skeleton className="h-[500px] w-full" />,
});

interface YamlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export function YamlEditor({ value, onChange, readOnly = false, height = "500px" }: YamlEditorProps) {
  return (
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
  );
}
