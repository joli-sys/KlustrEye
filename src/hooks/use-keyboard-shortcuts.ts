"use client";

import { useEffect } from "react";
import { useUIStore } from "@/lib/stores/ui-store";

function isEditable(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement;
  const tag = target.tagName.toLowerCase();
  if (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  ) {
    return true;
  }
  if (target.closest(".monaco-editor")) return true;
  if (target.closest(".xterm")) return true;
  return false;
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // --- Mod key shortcuts (work everywhere except editors/terminals) ---

      const mod = e.metaKey || e.ctrlKey;

      // Cmd+T / Ctrl+T — toggle shell terminal
      if (e.key === "t" && mod && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor") || target.closest(".xterm")) return;
        e.preventDefault();
        useUIStore.getState().toggleShellTerminal();
        return;
      }

      // Cmd+S / Ctrl+S — toggle cluster switcher
      if (e.key === "s" && mod && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor") || target.closest(".xterm")) return;
        e.preventDefault();
        useUIStore.getState().toggleClusterSwitcher();
        return;
      }

      // Cmd+N / Ctrl+N — toggle namespace selector
      if (e.key === "n" && mod && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor") || target.closest(".xterm")) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-namespace-selector"));
        return;
      }

      // Cmd+F / Ctrl+F — focus the table/page filter
      if (e.key === "f" && mod && !e.altKey && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.closest(".monaco-editor")) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-table-filter"));
        return;
      }

      // Ctrl+D — delete focused resource (K9s style)
      if (e.key === "d" && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (isEditable(e)) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "delete" } }));
        return;
      }

      // --- Plain key shortcuts (skip when in editable context) ---
      if (isEditable(e)) return;

      // / — Focus table filter
      if (e.key === "/" && !mod && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("focus-table-filter"));
        return;
      }

      // : — Open command palette (K9s style)
      if (e.key === ":" && !mod && !e.altKey) {
        e.preventDefault();
        useUIStore.getState().setCommandPaletteOpen(true);
        return;
      }

      // ? — Toggle keyboard shortcuts dialog
      if (e.key === "?" && !mod && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-keyboard-shortcuts"));
        return;
      }

      // Escape — go back
      if (e.key === "Escape" && !mod && !e.altKey && !e.shiftKey) {
        // Don't interfere with dialogs/palette — they handle Escape themselves
        // Only fire if nothing else is open
        const ui = useUIStore.getState();
        if (ui.commandPaletteOpen || ui.clusterSwitcherOpen) return;
        // Check if a dialog is open
        if (document.querySelector("[data-dialog-overlay]")) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("navigate-back"));
        return;
      }

      // j — Move down in table (K9s style)
      if (e.key === "j" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-navigate", { detail: { direction: "down" } }));
        return;
      }

      // k — Move up in table (K9s style)
      if (e.key === "k" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-navigate", { detail: { direction: "up" } }));
        return;
      }

      // g — Go to first row
      if (e.key === "g" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-navigate", { detail: { direction: "top" } }));
        return;
      }

      // G — Go to last row
      if (e.key === "G" && !mod && !e.altKey && e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-navigate", { detail: { direction: "bottom" } }));
        return;
      }

      // Enter — Open detail of focused row
      if (e.key === "Enter" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "enter" } }));
        return;
      }

      // d — Describe / open detail (K9s style)
      if (e.key === "d" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "describe" } }));
        return;
      }

      // e — Edit resource (K9s style)
      if (e.key === "e" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "edit" } }));
        return;
      }

      // l — View logs (K9s style, for pods)
      if (e.key === "l" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "logs" } }));
        return;
      }

      // s — Shell into pod (K9s style)
      if (e.key === "s" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "shell" } }));
        return;
      }

      // x — Toggle row selection (like space in K9s)
      if (e.key === "x" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("table-action", { detail: { action: "select" } }));
        return;
      }

      // 1-9 — Quick navigate to sidebar sections
      if (e.key >= "1" && e.key <= "9" && !mod && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        window.dispatchEvent(
          new CustomEvent("sidebar-navigate", { detail: { index: parseInt(e.key) - 1 } })
        );
        return;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
