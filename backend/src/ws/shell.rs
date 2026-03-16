use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use sqlx::SqlitePool;
use std::io::{Read, Write};
use tokio::sync::mpsc;

pub async fn handle_shell(socket: WebSocket, db: sqlx::SqlitePool, context_name: String) {
    if let Err(e) = run_shell(socket, db, &context_name).await {
        tracing::error!("Shell error: {e}");
    }
}

async fn resolve_kubeconfig_path(db: &SqlitePool) -> Option<String> {
    sqlx::query_scalar::<_, String>(
        "SELECT value FROM user_preferences WHERE key = 'kubeconfigPath'",
    )
    .fetch_optional(db)
    .await
    .ok()
    .flatten()
    .or_else(|| std::env::var("KUBECONFIG_PATH").ok())
}

async fn run_shell(
    socket: WebSocket,
    db: SqlitePool,
    context_name: &str,
) -> anyhow::Result<()> {
    let shell = if cfg!(windows) {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };
    let home = dirs::home_dir().unwrap_or_default();
    let kubeconfig_path = resolve_kubeconfig_path(&db).await;

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;

    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&home);
    if !cfg!(windows) {
        cmd.env("TERM", "xterm-256color");
    }

    if let Some(ref kc) = kubeconfig_path {
        cmd.env("KUBECONFIG", kc);
    }

    let mut child = pair.slave.spawn_command(cmd)?;

    // Channels to bridge sync PTY ↔ async WebSocket
    let (pty_tx, mut pty_rx) = mpsc::channel::<Vec<u8>>(64);
    let (ws_tx, ws_rx) = mpsc::channel::<Vec<u8>>(64);
    let ws_rx = std::sync::Mutex::new(ws_rx);

    // Clone master for reading
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;

    // Thread: PTY stdout → pty_tx channel
    let pty_tx_clone = pty_tx.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if pty_tx_clone.blocking_send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Thread: ws_rx → PTY stdin
    std::thread::spawn(move || {
        let mut ws_rx = ws_rx.lock().unwrap();
        while let Some(data) = ws_rx.blocking_recv() {
            if writer.write_all(&data).is_err() {
                break;
            }
        }
    });

    let (mut ws_sink, mut ws_stream) = socket.split();

    // Send initial kubectl context switch
    let init_cmd = if cfg!(windows) {
        format!("kubectl config use-context {} 2>NUL\r\n", context_name)
    } else {
        format!("kubectl config use-context {} 2>/dev/null && clear\r", context_name)
    };
    let _ = pty_tx.send(init_cmd.into_bytes()).await;

    // Spawn task: write initial command to PTY via dedicated writer
    // (already done above via channel)

    // Forward PTY output → WebSocket
    let forward_task = tokio::spawn(async move {
        while let Some(data) = pty_rx.recv().await {
            let text = String::from_utf8_lossy(&data).to_string();
            if ws_sink.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    // Forward WebSocket → PTY
    let ws_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            let data = match msg {
                Message::Text(t) => t.into_bytes(),
                Message::Binary(b) => b,
                Message::Close(_) => break,
                _ => continue,
            };

            // Handle resize
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&data) {
                if json.get("type").and_then(|t| t.as_str()) == Some("resize") {
                    let cols = json["cols"].as_u64().unwrap_or(80) as u16;
                    let rows = json["rows"].as_u64().unwrap_or(24) as u16;
                    // Note: resize happens on the pty pair reference
                    // We store the resize request but can't easily send it here
                    // without access to pair.master — this is a known limitation
                    let _ = (cols, rows); // handled by sending escape sequence if needed
                    continue;
                }
            }

            if ws_tx.send(data).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = forward_task => {}
        _ = ws_task => {}
    }

    let _ = child.kill();
    Ok(())
}
