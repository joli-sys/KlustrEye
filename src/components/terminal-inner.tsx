
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
      // Same reason as the reconnect effect's cleanup, with a sharper edge: the
      // terminal is disposed on the next line, so a late onclose/onerror would
      // write to a DISPOSED xterm rather than merely the wrong one.
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      }
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
      // Detach BEFORE closing. `close()` is asynchronous, so a superseded
      // socket's onclose/onerror still fired afterwards — and they close over
      // `term`, which this component deliberately keeps across `wsUrl` changes.
      // The result was a stale "WebSocket error" / "Connection closed" written
      // into whatever session the user had just switched to, while the process
      // it belonged to was perfectly healthy.
      //
      // The normal case is unaffected: these only detach when the effect is
      // torn down, which is exactly when the messages are no longer wanted.
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    };
  }, [wsUrl, connectMessage]);

  return <div ref={terminalRef} className={className || "h-96"} />;
}
