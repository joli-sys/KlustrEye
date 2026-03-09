"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { ErrorBoundary } from "@/components/error-boundary";
import { CommandPalette } from "@/components/command-palette";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchInterval: 15_000,
            retry: 1,
          },
        },
      })
  );

  useKeyboardShortcuts();

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <TooltipProvider>
          <ConfirmProvider>
            <ErrorBoundary>
              {children}
              <CommandPalette />
            </ErrorBoundary>
          </ConfirmProvider>
        </TooltipProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
