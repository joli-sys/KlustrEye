use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use k8s_openapi::api::core::v1::Pod;
use kube::{api::AttachParams, Api, Client};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub async fn handle_terminal(
    socket: WebSocket,
    client: Client,
    namespace: String,
    pod: String,
    container: String,
) {
    if let Err(e) = run_terminal(socket, client, &namespace, &pod, &container).await {
        tracing::error!("Terminal error: {e}");
    }
}

async fn run_terminal(
    socket: WebSocket,
    client: Client,
    namespace: &str,
    pod: &str,
    container: &str,
) -> anyhow::Result<()> {
    let pods: Api<Pod> = Api::namespaced(client, namespace);

    let mut attached = pods
        .exec(
            pod,
            ["/bin/sh", "-c", "exec bash 2>/dev/null || exec sh"],
            &AttachParams::default()
                .container(container)
                .stdin(true)
                .stdout(true)
                .stderr(false)
                .tty(true),
        )
        .await?;

    let mut stdin = attached.stdin().ok_or_else(|| anyhow::anyhow!("No stdin"))?;
    let mut stdout = attached.stdout().ok_or_else(|| anyhow::anyhow!("No stdout"))?;

    let (mut ws_sink, mut ws_stream) = socket.split();

    // stdout → WebSocket
    let stdout_task = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    if ws_sink.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // WebSocket → stdin (skip resize JSON messages)
    let stdin_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = ws_stream.next().await {
            let data = match msg {
                Message::Text(t) => t.into_bytes(),
                Message::Binary(b) => b,
                Message::Close(_) => break,
                _ => continue,
            };

            // Check for resize messages
            if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&data) {
                if json.get("type").and_then(|t| t.as_str()) == Some("resize") {
                    continue; // ignore resize in exec mode
                }
            }

            if stdin.write_all(&data).await.is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = stdout_task => {}
        _ = stdin_task => {}
    }

    Ok(())
}
