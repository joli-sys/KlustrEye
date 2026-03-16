use axum::{extract::State, Json};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

use crate::{error::{AppError, Result}, AppState};

#[derive(Deserialize)]
pub struct KubeconfigBody {
    pub path: Option<String>,
}

pub async fn set_kubeconfig(
    State(state): State<AppState>,
    Json(body): Json<KubeconfigBody>,
) -> Result<Json<Value>> {
    // Persist to DB
    let key = "kubeconfigPath";
    match &body.path {
        Some(path) if !path.is_empty() => {
            let id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO user_preferences (id, key, value) VALUES (?, ?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(&id)
            .bind(key)
            .bind(path)
            .execute(&state.db)
            .await?;

            // Update in-memory path and clear client cache
            *state.clients.kubeconfig_path.write().await = Some(path.clone());
            state.clients.invalidate(None);
        }
        _ => {
            // Clear custom path — revert to default
            sqlx::query("DELETE FROM user_preferences WHERE key = ?")
                .bind(key)
                .execute(&state.db)
                .await?;

            *state.clients.kubeconfig_path.write().await = None;
            state.clients.invalidate(None);
        }
    }

    Ok(Json(serde_json::json!({ "ok": true })))
}

pub async fn get_kubeconfig(State(state): State<AppState>) -> Result<Json<Value>> {
    let path: Option<String> = sqlx::query_scalar(
        "SELECT value FROM user_preferences WHERE key = 'kubeconfigPath'",
    )
    .fetch_optional(&state.db)
    .await?;

    Ok(Json(serde_json::json!({ "path": path })))
}
