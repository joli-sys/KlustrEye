"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/stores/ui-store";

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-table-filter"));
      }

      // Cmd+T / Ctrl+T — toggle shell terminal
      if (e.key === "t" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor")) return;
        // Also skip if inside an xterm terminal to avoid conflicts
        if (target.closest(".xterm")) return;
        e.preventDefault();
        useUIStore.getState().toggleShellTerminal();
      }

      // Cmd+S / Ctrl+S — toggle cluster switcher
      if (e.key === "s" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor")) return;
        if (target.closest(".xterm")) return;
        e.preventDefault();
        useUIStore.getState().toggleClusterSwitcher();
      }

      // Cmd+F / Ctrl+F — focus the table/page filter instead of browser find
      if (e.key === "f" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor")) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-table-filter"));
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
