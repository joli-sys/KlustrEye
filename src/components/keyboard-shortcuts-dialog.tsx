

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl";

const sections = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: [mod, "S"], description: "Open cluster switcher" },
      { keys: [mod, "N"], description: "Open namespace selector" },
      { keys: [mod, "K"], description: "Open command palette" },
    ],
  },
  {
    title: "Search & Filter",
    shortcuts: [
      { keys: [mod, "F"], description: "Focus filter" },
      { keys: ["/"], description: "Focus table filter" },
    ],
  },
  {
    title: "Terminal",
    shortcuts: [{ keys: [mod, "T"], description: "Toggle terminal" }],
  },
  {
    title: "Help",
    shortcuts: [{ keys: ["?"], description: "Show keyboard shortcuts" }],
  },
];

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)} className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i}>
                          {i > 0 && (
                            <span className="text-muted-foreground text-xs mx-0.5">+</span>
                          )}
                          <kbd className="inline-flex h-5 min-w-[20px] items-center justify-center rounded border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function useKeyboardShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handleToggle() {
      setOpen((prev) => !prev);
    }
    window.addEventListener("toggle-keyboard-shortcuts", handleToggle);
    return () => window.removeEventListener("toggle-keyboard-shortcuts", handleToggle);
  }, []);

  return { open, setOpen };
}
