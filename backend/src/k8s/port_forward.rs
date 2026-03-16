use anyhow::{anyhow, Result};
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use uuid::Uuid;

pub type PortForwardProcesses = Arc<Mutex<HashMap<String, Child>>>;

pub fn new_processes() -> PortForwardProcesses {
    Arc::new(Mutex::new(HashMap::new()))
}

pub async fn is_port_available(port: u16) -> bool {
    tokio::net::TcpListener::bind(("127.0.0.1", port)).await.is_ok()
}

pub async fn start_port_forward(
    db: &SqlitePool,
    processes: &PortForwardProcesses,
    context_name: &str,
    namespace: &str,
    resource_type: &str,
    resource_name: &str,
    local_port: u16,
    remote_port: u16,
) -> Result<serde_json::Value> {
    if !is_port_available(local_port).await {
        return Err(anyhow!("Port {local_port} is already in use"));
    }

    let session_id = Uuid::new_v4().to_string();

    sqlx::query(
        "INSERT INTO port_forward_sessions
         (id, context_name, namespace, resource_type, resource_name, local_port, remote_port, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'starting')",
    )
    .bind(&session_id)
    .bind(context_name)
    .bind(namespace)
    .bind(resource_type)
    .bind(resource_name)
    .bind(local_port as i64)
    .bind(remote_port as i64)
    .execute(db)
    .await?;

    let target = format!("{resource_type}/{resource_name}");
    let port_mapping = format!("{local_port}:{remote_port}");

    let mut child = Command::new("kubectl")
        .args([
            "port-forward",
            &target,
            &port_mapping,
            "-n",
            namespace,
            "--context",
            context_name,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;

    let pid = child.id();

    // Poll for success (wait up to 5s for "Forwarding from" output or process exit)
    let stdout = child.stdout.take();
    drop(stdout); // we won't read it in detail, just wait

    // Give it a moment to start
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // Check process is still alive
    match child.try_wait() {
        Ok(Some(status)) => {
            let code = status.code().unwrap_or(-1);
            sqlx::query(
                "UPDATE port_forward_sessions SET status = 'error',
                 error_message = ?, stopped_at = datetime('now') WHERE id = ?",
            )
            .bind(format!("Process exited with code {code}"))
            .bind(&session_id)
            .execute(db)
            .await?;
            return Err(anyhow!("kubectl port-forward exited immediately with code {code}"));
        }
        Ok(None) => {
            // Still running — mark active
            sqlx::query(
                "UPDATE port_forward_sessions SET status = 'active', pid = ? WHERE id = ?",
            )
            .bind(pid.map(|p| p as i64))
            .bind(&session_id)
            .execute(db)
            .await?;

            processes.lock().await.insert(session_id.clone(), child);
        }
        Err(e) => {
            return Err(anyhow!("Failed to check process status: {e}"));
        }
    }

    let row = sqlx::query_as::<_, PortForwardSession>(
        "SELECT * FROM port_forward_sessions WHERE id = ?",
    )
    .bind(&session_id)
    .fetch_one(db)
    .await?;

    Ok(serde_json::to_value(row)?)
}

pub async fn stop_port_forward(
    db: &SqlitePool,
    processes: &PortForwardProcesses,
    session_id: &str,
) -> Result<()> {
    let mut map = processes.lock().await;
    if let Some(mut child) = map.remove(session_id) {
        let _ = child.kill().await;
    }

    sqlx::query(
        "UPDATE port_forward_sessions SET status = 'stopped', stopped_at = datetime('now')
         WHERE id = ?",
    )
    .bind(session_id)
    .execute(db)
    .await?;

    Ok(())
}

pub async fn list_active_port_forwards(
    db: &SqlitePool,
    processes: &PortForwardProcesses,
    context_name: Option<&str>,
) -> Result<Vec<serde_json::Value>> {
    let rows: Vec<PortForwardSession> = if let Some(ctx) = context_name {
        sqlx::query_as(
            "SELECT * FROM port_forward_sessions WHERE status IN ('active', 'starting') AND context_name = ?
             ORDER BY created_at DESC",
        )
        .bind(ctx)
        .fetch_all(db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT * FROM port_forward_sessions WHERE status IN ('active', 'starting')
             ORDER BY created_at DESC",
        )
        .fetch_all(db)
        .await?
    };

    let map = processes.lock().await;
    let mut result = Vec::new();
    for row in rows {
        if !map.contains_key(&row.id) {
            // Stale — mark stopped
            let _ = sqlx::query(
                "UPDATE port_forward_sessions SET status = 'stopped', stopped_at = datetime('now')
                 WHERE id = ?",
            )
            .bind(&row.id)
            .execute(db)
            .await;
            continue;
        }
        result.push(serde_json::to_value(row)?);
    }

    Ok(result)
}

pub async fn cleanup_all(db: &SqlitePool, processes: &PortForwardProcesses) {
    let mut map = processes.lock().await;
    for (_, mut child) in map.drain() {
        let _ = child.kill().await;
    }

    let _ = sqlx::query(
        "UPDATE port_forward_sessions SET status = 'stopped', stopped_at = datetime('now')
         WHERE status IN ('active', 'starting')",
    )
    .execute(db)
    .await;
}

#[derive(sqlx::FromRow, serde::Serialize)]
pub struct PortForwardSession {
    pub id: String,
    pub context_name: String,
    pub namespace: String,
    pub resource_type: String,
    pub resource_name: String,
    pub local_port: i64,
    pub remote_port: i64,
    pub status: String,
    pub error_message: Option<String>,
    pub pid: Option<i64>,
    pub created_at: String,
    pub stopped_at: Option<String>,
}
