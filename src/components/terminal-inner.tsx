
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface TerminalInnerProps {
  wsUrl: string;
  className?: string;
  connectMessage?: string;
  /**
   * Called once, immediately after the terminal is created and opened, with
   * the instance and a writer for the socket behind it.
   *
   * Optional and additive — consumers that only need a terminal on a socket
   * pass nothing and get exactly the behaviour they had before this existed.
   *
   * `send` reads the connection at call time rather than closing over it, so
   * it keeps working across the reconnects this component owns. Handing one
   * out is the point: a caller that needs to write (a composer box, say) must
   * not open a second WebSocket, because this component is the only owner of
   * the session's connection and of its lifecycle.
   */
  onReady?: (term: Terminal, send: (data: string) => void) => void;
}

export function TerminalInner({ wsUrl, className, connectMessage, onReady }: TerminalInnerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Held in a ref, and read only from the init effect, so that a caller
  // passing an inline arrow cannot re-run that effect — it must stay `[]`,
  // since recreating xterm would throw away the scrollback.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Initialize xterm once — never torn down on wsUrl changes
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#e5e5e5",
        selectionBackground: "#333333",
      },
      convertEol: false,
      scrollback: 5000,
      // @xterm/addon-search highlights matches through xterm's decoration API,
      // which is still "proposed" and throws "You must set the allowProposedApi
      // option to true to use proposed API" on the first search otherwise.
      // Harmless for the consumers that do not search — it only permits the
      // API, it does not change behaviour.
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    fitAddon.fit();
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    onReadyRef.current?.(term, (data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) ws.send(data);
    });

    // Handle resize — skip when the container has no dimensions (e.g. panel is hidden)
    const resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width === 0 || rect.height === 0) return;
      fitAddon.fit();
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      wsRef.current?.close();
      term.dispose();
    };
  }, []);

  // Reconnect WebSocket whenever wsUrl changes (cluster navigation) without recreating xterm
  useEffect(() => {
    const term = termRef.current;
    if (!term || !wsUrl) return;

    // Close previous connection
    wsRef.current?.close();

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    const inputDisposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    ws.onopen = () => {
      const msg = connectMessage !== undefined ? connectMessage : "Connected to container...\r\n";
      if (msg) term.writeln(msg);
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln("\r\n\x1b[31mWebSocket error\x1b[0m");
    };

    ws.onclose = (event) => {
      term.writeln(`\r\n\x1b[33mConnection closed (${event.code})\x1b[0m`);
    };

    return () => {
      inputDisposable.dispose();
      ws.close();
    };
  }, [wsUrl, connectMessage]);

  return <div ref={terminalRef} className={className || "h-96"} />;
}
