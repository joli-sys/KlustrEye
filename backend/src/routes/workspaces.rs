use axum::{extract::{Path, State}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    k8s::client::get_contexts,
    AppState,
};

/// Workspace ids must never equal "clusters": tab-bar.tsx:22 and
/// resource-table.tsx:104 locate the cluster segment via
/// parts.indexOf("clusters"), which would match the workspace id instead.
const RESERVED_WORKSPACE_IDS: [&str; 1] = ["clusters"];

pub fn validate_workspace_name(name: &str) -> std::result::Result<(), String> {
    if name.trim().is_empty() {
        return Err("name is required".to_string());
    }
    Ok(())
}

pub fn validate_workspace_id(id: &str) -> std::result::Result<(), String> {
    let lowered = id.to_lowercase();
    if RESERVED_WORKSPACE_IDS.contains(&lowered.as_str()) {
        return Err(format!("workspace id '{id}' is reserved"));
    }
    Ok(())
}

pub fn context_exists(contexts: &[String], name: &str) -> bool {
    contexts.iter().any(|c| c == name)
}

#[derive(sqlx::FromRow)]
struct WorkspaceRow {
    id: String,
    name: String,
    folder_path: Option<String>,
    context_name: Option<String>,
    sort_order: i64,
    last_opened_at: Option<String>,
}

#[derive(Deserialize)]
pub struct WorkspaceBody {
    pub name: String,
    #[serde(rename = "folderPath")]
    pub folder_path: Option<String>,
    #[serde(rename = "contextName")]
    pub context_name: Option<String>,
}

#[derive(Deserialize)]
pub struct ResolveClusterBody {
    #[serde(rename = "contextName")]
    pub context_name: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

const SELECT_COLS: &str = "id, name, folder_path, context_name, sort_order, last_opened_at";

/// Reads the kubeconfig ONCE. Never fails the request: if the kubeconfig is
/// missing or unreadable, every workspace simply reports contextExists=false.
async fn load_context_names(state: &AppState) -> Vec<String> {
    let path: Option<String> = sqlx::query_scalar(
        "SELECT value FROM user_preferences WHERE key = 'kubeconfigPath'",
    )
    .fetch_optional(&state.db)
    .await
    .ok()
    .flatten();

    match get_contexts(path.as_deref()).await {
        Ok(list) => list.into_iter().map(|c| c.name).collect(),
        Err(_) => Vec::new(),
    }
}

async fn row_to_json(row: &WorkspaceRow, contexts: &[String]) -> Value {
    let folder_exists = match &row.folder_path {
        Some(p) => tokio::fs::metadata(p).await.map(|m| m.is_dir()).unwrap_or(false),
        None => false,
    };
    let context_exists_flag = row
        .context_name
        .as_ref()
        .map(|c| context_exists(contexts, c))
        .unwrap_or(false);

    json!({
        "id": row.id,
        "name": row.name,
        "folderPath": row.folder_path,
        "contextName": row.context_name,
        "sortOrder": row.sort_order,
        "lastOpenedAt": row.last_opened_at,
        "contextExists": context_exists_flag,
        "folderExists": folder_exists,
    })
}

/// Validates folder_path and canonicalizes it. Uses tokio::fs, never std::fs.
async fn canonicalize_folder(folder_path: Option<String>) -> Result<Option<String>> {
    let Some(p) = folder_path.filter(|p| !p.trim().is_empty()) else {
        return Ok(None);
    };
    let meta = tokio::fs::metadata(&p)
        .await
        .map_err(|_| AppError::BadRequest(format!("folder not found: {p}")))?;
    if !meta.is_dir() {
        return Err(AppError::BadRequest(format!("not a directory: {p}")));
    }
    let canonical = tokio::fs::canonicalize(&p)
        .await
        .map_err(|_| AppError::BadRequest(format!("cannot resolve folder: {p}")))?;
    Ok(Some(canonical.to_string_lossy().to_string()))
}

pub async fn list_workspaces(State(state): State<AppState>) -> Result<Json<Value>> {
    let rows: Vec<WorkspaceRow> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLS} FROM workspaces ORDER BY sort_order ASC, last_opened_at DESC, name ASC"
    ))
    .fetch_all(&state.db)
    .await?;

    let contexts = load_context_names(&state).await;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        out.push(row_to_json(row, &contexts).await);
    }
    Ok(Json(json!(out)))
}

pub async fn get_workspace(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let row: Option<WorkspaceRow> =
        sqlx::query_as(&format!("SELECT {SELECT_COLS} FROM workspaces WHERE id = ?"))
            .bind(&ws_id)
            .fetch_optional(&state.db)
            .await?;

    let row = row.ok_or_else(|| AppError::NotFound(format!("workspace {ws_id} not found")))?;
    let contexts = load_context_names(&state).await;
    Ok(Json(row_to_json(&row, &contexts).await))
}

pub async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<WorkspaceBody>,
) -> Result<Json<Value>> {
    validate_workspace_name(&body.name).map_err(AppError::BadRequest)?;
    let folder = canonicalize_folder(body.folder_path).await?;

    let id = Uuid::new_v4().to_string();
    validate_workspace_id(&id).map_err(AppError::BadRequest)?;

    sqlx::query(
        "INSERT INTO workspaces (id, name, folder_path, context_name, last_opened_at)
         VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(body.name.trim())
    .bind(&folder)
    .bind(&body.context_name)
    .execute(&state.db)
    .await?;

    get_workspace(Path(id), State(state)).await
}

pub async fn update_workspace(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<WorkspaceBody>,
) -> Result<Json<Value>> {
    validate_workspace_name(&body.name).map_err(AppError::BadRequest)?;
    let folder = canonicalize_folder(body.folder_path).await?;

    // Single statement, not one UPDATE per field.
    let res = sqlx::query(
        "UPDATE workspaces
         SET name = ?, folder_path = ?, context_name = ?, updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(body.name.trim())
    .bind(&folder)
    .bind(&body.context_name)
    .bind(&ws_id)
    .execute(&state.db)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("workspace {ws_id} not found")));
    }
    get_workspace(Path(ws_id), State(state)).await
}

pub async fn delete_workspace(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let res = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(&ws_id)
        .execute(&state.db)
        .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::NotFound(format!("workspace {ws_id} not found")));
    }
    Ok(Json(json!({ "ok": true })))
}

/// Resolve-or-lazily-create the workspace bound to a cluster context.
/// Backs both the `/clusters/:contextName/*` redirect shim and cluster switching.
pub async fn resolve_cluster_workspace(
    State(state): State<AppState>,
    Json(body): Json<ResolveClusterBody>,
) -> Result<Json<Value>> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT id FROM workspaces WHERE context_name = ? ORDER BY created_at ASC LIMIT 1",
    )
    .bind(&body.context_name)
    .fetch_optional(&state.db)
    .await?;

    if let Some(id) = existing {
        sqlx::query("UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?")
            .bind(&id)
            .execute(&state.db)
            .await?;
        return get_workspace(Path(id), State(state)).await;
    }

    let id = Uuid::new_v4().to_string();
    let name = body
        .display_name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| body.context_name.clone());

    sqlx::query(
        "INSERT INTO workspaces (id, name, context_name, last_opened_at)
         VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(name.trim())
    .bind(&body.context_name)
    .execute(&state.db)
    .await?;

    get_workspace(Path(id), State(state)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_whitespace_names() {
        assert!(validate_workspace_name("").is_err());
        assert!(validate_workspace_name("   ").is_err());
        assert!(validate_workspace_name("\t\n").is_err());
    }

    #[test]
    fn accepts_names_with_surrounding_whitespace() {
        assert!(validate_workspace_name("  prod  ").is_ok());
        assert!(validate_workspace_name("prod").is_ok());
    }

    #[test]
    fn rejects_reserved_workspace_id() {
        // "clusters" would poison parts.indexOf("clusters") in tab-bar.tsx
        // and resource-table.tsx, which locate segments by name.
        assert!(validate_workspace_id("clusters").is_err());
        assert!(validate_workspace_id("Clusters").is_err());
    }

    #[test]
    fn accepts_uuid_workspace_id() {
        assert!(validate_workspace_id("3f2b1c94-0000-4000-8000-000000000000").is_ok());
    }

    #[test]
    fn context_exists_matches_exactly() {
        let ctxs = vec!["prod".to_string(), "staging".to_string()];
        assert!(context_exists(&ctxs, "prod"));
        assert!(!context_exists(&ctxs, "PROD"));
        assert!(!context_exists(&ctxs, "missing"));
        assert!(!context_exists(&[], "prod"));
    }
}
