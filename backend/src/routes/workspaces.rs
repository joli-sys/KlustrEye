use axum::{extract::{Path, State}, Json};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    k8s::client::get_contexts,
    AppState,
};

/// Workspace ids must never equal "clusters": tab-bar.tsx:22 locates the
/// cluster segment via parts.indexOf("clusters"), which would match the
/// workspace id instead.
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

/// Trims, drops blanks, and de-duplicates while preserving caller order.
///
/// The array index IS the `sort_order`, so a duplicate must collapse onto its
/// FIRST occurrence — otherwise a repeated context would either violate the
/// composite primary key or silently reorder the list.
pub fn normalize_context_names(names: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in names {
        let name = raw.trim();
        if name.is_empty() || out.iter().any(|kept| kept == name) {
            continue;
        }
        out.push(name.to_string());
    }
    out
}

#[derive(sqlx::FromRow)]
struct WorkspaceRow {
    id: String,
    name: String,
    folder_path: Option<String>,
    sort_order: i64,
    last_opened_at: Option<String>,
}

#[derive(sqlx::FromRow)]
struct BindingRow {
    workspace_id: String,
    context_name: String,
    sort_order: i64,
}

#[derive(Deserialize)]
pub struct WorkspaceBody {
    pub name: String,
    #[serde(rename = "folderPath")]
    pub folder_path: Option<String>,
    /// Ordered — the index becomes `sort_order`. Absent or empty means no
    /// clusters bound. `PUT` replaces this set wholesale.
    #[serde(rename = "contextNames", default)]
    pub context_names: Vec<String>,
}

#[derive(Deserialize)]
pub struct ResolveClusterBody {
    #[serde(rename = "contextName")]
    pub context_name: String,
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

// `context_name` is deliberately absent: it is a legacy column (see db.rs) and
// the join table is authoritative.
const SELECT_COLS: &str = "id, name, folder_path, sort_order, last_opened_at";

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

/// Loads the cluster bindings, either for every workspace or for one.
/// Returned already ordered by `sort_order`.
async fn load_bindings(
    db: &sqlx::SqlitePool,
    only_workspace: Option<&str>,
) -> Result<HashMap<String, Vec<BindingRow>>> {
    const ORDER: &str = "ORDER BY sort_order ASC, context_name ASC";
    let rows: Vec<BindingRow> = match only_workspace {
        Some(ws_id) => sqlx::query_as(&format!(
            "SELECT workspace_id, context_name, sort_order FROM workspace_clusters
             WHERE workspace_id = ? {ORDER}"
        ))
        .bind(ws_id)
        .fetch_all(db)
        .await?,
        None => sqlx::query_as(&format!(
            "SELECT workspace_id, context_name, sort_order FROM workspace_clusters {ORDER}"
        ))
        .fetch_all(db)
        .await?,
    };

    let mut map: HashMap<String, Vec<BindingRow>> = HashMap::new();
    for row in rows {
        map.entry(row.workspace_id.clone()).or_default().push(row);
    }
    Ok(map)
}

/// `exists` is derived per cluster from the kubeconfig read once per request —
/// never persisted, exactly as the old scalar `contextExists` was.
fn clusters_json(bound: &[BindingRow], contexts: &[String]) -> Value {
    Value::Array(
        bound
            .iter()
            .map(|b| {
                json!({
                    "contextName": b.context_name,
                    "exists": context_exists(contexts, &b.context_name),
                    "sortOrder": b.sort_order,
                })
            })
            .collect(),
    )
}

async fn row_to_json(row: &WorkspaceRow, bound: &[BindingRow], contexts: &[String]) -> Value {
    let folder_exists = match &row.folder_path {
        Some(p) => tokio::fs::metadata(p).await.map(|m| m.is_dir()).unwrap_or(false),
        None => false,
    };

    json!({
        "id": row.id,
        "name": row.name,
        "folderPath": row.folder_path,
        "clusters": clusters_json(bound, contexts),
        "sortOrder": row.sort_order,
        "lastOpenedAt": row.last_opened_at,
        "folderExists": folder_exists,
    })
}

/// Replaces a workspace's whole cluster set inside the caller's transaction, so
/// a failure can never leave a workspace half-bound.
///
/// Also rewrites the legacy `workspaces.context_name` to the first bound cluster
/// (or NULL). Nothing reads it; it exists so an older build sharing this
/// database still sees one sane cluster.
async fn write_cluster_bindings(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ws_id: &str,
    names: &[String],
) -> Result<()> {
    sqlx::query("DELETE FROM workspace_clusters WHERE workspace_id = ?")
        .bind(ws_id)
        .execute(&mut **tx)
        .await?;

    for (index, name) in names.iter().enumerate() {
        sqlx::query(
            "INSERT INTO workspace_clusters (workspace_id, context_name, sort_order)
             VALUES (?, ?, ?)",
        )
        .bind(ws_id)
        .bind(name)
        .bind(index as i64)
        .execute(&mut **tx)
        .await?;
    }

    sqlx::query("UPDATE workspaces SET context_name = ? WHERE id = ?")
        .bind(names.first().map(String::as_str))
        .bind(ws_id)
        .execute(&mut **tx)
        .await?;

    Ok(())
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
    let bindings = load_bindings(&state.db, None).await?;
    let mut out = Vec::with_capacity(rows.len());
    for row in &rows {
        let bound = bindings.get(&row.id).map(Vec::as_slice).unwrap_or(&[]);
        out.push(row_to_json(row, bound, &contexts).await);
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
    let bindings = load_bindings(&state.db, Some(&ws_id)).await?;
    let bound = bindings.get(&ws_id).map(Vec::as_slice).unwrap_or(&[]);
    Ok(Json(row_to_json(&row, bound, &contexts).await))
}

pub async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<WorkspaceBody>,
) -> Result<Json<Value>> {
    validate_workspace_name(&body.name).map_err(AppError::BadRequest)?;
    let folder = canonicalize_folder(body.folder_path).await?;
    let contexts = normalize_context_names(&body.context_names);

    let id = Uuid::new_v4().to_string();
    validate_workspace_id(&id).map_err(AppError::BadRequest)?;

    let mut tx = state.db.begin().await?;
    sqlx::query(
        "INSERT INTO workspaces (id, name, folder_path, last_opened_at)
         VALUES (?, ?, ?, datetime('now'))",
    )
    .bind(&id)
    .bind(body.name.trim())
    .bind(&folder)
    .execute(&mut *tx)
    .await?;
    write_cluster_bindings(&mut tx, &id, &contexts).await?;
    tx.commit().await?;

    get_workspace(Path(id), State(state)).await
}

pub async fn update_workspace(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<WorkspaceBody>,
) -> Result<Json<Value>> {
    validate_workspace_name(&body.name).map_err(AppError::BadRequest)?;
    let folder = canonicalize_folder(body.folder_path).await?;
    let contexts = normalize_context_names(&body.context_names);

    let mut tx = state.db.begin().await?;

    // Single statement, not one UPDATE per field. `context_name` is rewritten
    // by write_cluster_bindings below.
    let res = sqlx::query(
        "UPDATE workspaces
         SET name = ?, folder_path = ?, updated_at = datetime('now')
         WHERE id = ?",
    )
    .bind(body.name.trim())
    .bind(&folder)
    .bind(&ws_id)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        // Roll back so an unknown id cannot leave orphan join rows behind.
        tx.rollback().await?;
        return Err(AppError::NotFound(format!("workspace {ws_id} not found")));
    }

    // Wholesale replacement: the request body is the complete new set.
    write_cluster_bindings(&mut tx, &ws_id, &contexts).await?;
    tx.commit().await?;

    get_workspace(Path(ws_id), State(state)).await
}

pub async fn delete_workspace(
    Path(ws_id): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let mut tx = state.db.begin().await?;

    // Explicit — SQLite foreign keys are not enabled on this pool, so the
    // ON DELETE CASCADE on workspace_clusters never fires.
    sqlx::query("DELETE FROM workspace_clusters WHERE workspace_id = ?")
        .bind(&ws_id)
        .execute(&mut *tx)
        .await?;

    let res = sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(&ws_id)
        .execute(&mut *tx)
        .await?;

    if res.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(AppError::NotFound(format!("workspace {ws_id} not found")));
    }
    tx.commit().await?;
    // 200 with a JSON body, NOT the 204 the spec text says: the client calls
    // `res.json()` (use-workspaces.ts:96) and a bodyless 204 would throw a
    // SyntaxError straight into the error-toast path. Change both or neither.
    Ok(Json(json!({ "ok": true })))
}

/// Returns the OLDEST workspace that binds `context_name`, creating one bound to
/// just that cluster when none does.
///
/// A read-then-insert pair races: `<React.StrictMode>` double-mounts
/// `LegacyClusterRedirect`, and a double-click in `cluster-switcher.tsx` fires
/// two resolves, so both callers see `None` and both insert. The guard is the
/// conditional INSERT, and because the workspace row and its join row are now
/// two statements they must land together — hence the transaction, which stops
/// a second caller from observing a workspace that has no binding yet.
///
/// A cluster may still legitimately belong to several workspaces (created via
/// `create_workspace`/`PUT`); this endpoint just never adds another one itself.
async fn resolve_or_create_workspace_id(
    db: &sqlx::SqlitePool,
    context_name: &str,
    display_name: Option<&str>,
) -> Result<String> {
    let candidate_id = Uuid::new_v4().to_string();
    let name = display_name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or(context_name);

    let mut tx = db.begin().await?;

    let inserted = sqlx::query(
        "INSERT INTO workspaces (id, name, context_name, last_opened_at)
         SELECT ?, ?, ?, datetime('now')
         WHERE NOT EXISTS (SELECT 1 FROM workspace_clusters WHERE context_name = ?)",
    )
    .bind(&candidate_id)
    .bind(name)
    .bind(context_name)
    .bind(context_name)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        > 0;

    if inserted {
        sqlx::query(
            "INSERT INTO workspace_clusters (workspace_id, context_name, sort_order)
             VALUES (?, ?, 0)",
        )
        .bind(&candidate_id)
        .bind(context_name)
        .execute(&mut *tx)
        .await?;
    }

    // Re-read rather than trusting candidate_id: a concurrent request may have
    // won the insert, and the oldest row is the canonical one. `created_at` has
    // one-second resolution, so rowid breaks ties.
    let id: Option<String> = sqlx::query_scalar(
        "SELECT w.id FROM workspaces w
         JOIN workspace_clusters wc ON wc.workspace_id = w.id
         WHERE wc.context_name = ?
         ORDER BY w.created_at ASC, w.rowid ASC LIMIT 1",
    )
    .bind(context_name)
    .fetch_optional(&mut *tx)
    .await?;

    let id = id.ok_or_else(|| {
        AppError::Internal(format!("could not resolve workspace for context {context_name}"))
    })?;

    sqlx::query("UPDATE workspaces SET last_opened_at = datetime('now') WHERE id = ?")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(id)
}

/// Resolve-or-lazily-create the workspace bound to a cluster context.
/// Backs both the `/clusters/:contextName/*` redirect shim and cluster switching.
pub async fn resolve_cluster_workspace(
    State(state): State<AppState>,
    Json(body): Json<ResolveClusterBody>,
) -> Result<Json<Value>> {
    let id = resolve_or_create_workspace_id(
        &state.db,
        &body.context_name,
        body.display_name.as_deref(),
    )
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
        // "clusters" would poison parts.indexOf("clusters") in tab-bar.tsx,
        // which locates the cluster segment by name.
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

    #[test]
    fn normalize_trims_drops_blanks_and_dedupes_keeping_first_position() {
        let input: Vec<String> = ["  prod ", "", "staging", "   ", "prod", "dev"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(normalize_context_names(&input), vec!["prod", "staging", "dev"]);
        assert!(normalize_context_names(&[]).is_empty());
    }

    #[test]
    fn clusters_json_derives_exists_per_cluster_in_order() {
        let bound = vec![
            BindingRow { workspace_id: "w".into(), context_name: "eks-prod".into(), sort_order: 0 },
            BindingRow { workspace_id: "w".into(), context_name: "eks-stage".into(), sort_order: 1 },
        ];
        let contexts = vec!["eks-prod".to_string()];
        let out = clusters_json(&bound, &contexts);

        assert_eq!(out[0]["contextName"], "eks-prod");
        assert_eq!(out[0]["exists"], true);
        assert_eq!(out[0]["sortOrder"], 0);
        assert_eq!(out[1]["contextName"], "eks-stage");
        assert_eq!(out[1]["exists"], false);

        // A missing kubeconfig yields an empty context list, never an error.
        let none = clusters_json(&bound, &[]);
        assert_eq!(none[0]["exists"], false);
        assert_eq!(none[1]["exists"], false);
    }

    /// max_connections(1): every connection to `:memory:` would otherwise get
    /// its own empty database.
    async fn test_pool() -> sqlx::SqlitePool {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::run_migrations(&db).await.unwrap();
        db
    }

    async fn bound_contexts(db: &sqlx::SqlitePool, ws_id: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT context_name FROM workspace_clusters WHERE workspace_id = ?
             ORDER BY sort_order ASC",
        )
        .bind(ws_id)
        .fetch_all(db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn backfill_copies_legacy_bindings_and_is_idempotent() {
        let db = test_pool().await;

        // A legacy workspace bound the old way, plus two rows the backfill must
        // skip: NULL and blank.
        for (id, ctx) in [("legacy", Some("prod")), ("unbound", None), ("blank", Some("  "))] {
            sqlx::query("INSERT INTO workspaces (id, name, context_name) VALUES (?, ?, ?)")
                .bind(id)
                .bind(id)
                .bind(ctx)
                .execute(&db)
                .await
                .unwrap();
        }

        // Simulates a restart against the same database.
        crate::db::run_migrations(&db).await.unwrap();
        crate::db::run_migrations(&db).await.unwrap();

        assert_eq!(bound_contexts(&db, "legacy").await, vec!["prod"]);
        assert!(bound_contexts(&db, "unbound").await.is_empty());
        assert!(bound_contexts(&db, "blank").await.is_empty());

        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspace_clusters")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(total, 1, "repeated migrations must not duplicate join rows");
    }

    #[tokio::test]
    async fn put_replaces_the_cluster_set_wholesale() {
        let db = test_pool().await;
        sqlx::query("INSERT INTO workspaces (id, name) VALUES ('w1', 'Work')")
            .execute(&db)
            .await
            .unwrap();

        let mut tx = db.begin().await.unwrap();
        write_cluster_bindings(&mut tx, "w1", &["a".to_string(), "b".to_string()])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(bound_contexts(&db, "w1").await, vec!["a", "b"]);

        // Overlapping-but-different set: "a" is dropped, "c" added, and "b"
        // moves to sort_order 0.
        let mut tx = db.begin().await.unwrap();
        write_cluster_bindings(&mut tx, "w1", &["b".to_string(), "c".to_string()])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(bound_contexts(&db, "w1").await, vec!["b", "c"]);

        let legacy: Option<String> =
            sqlx::query_scalar("SELECT context_name FROM workspaces WHERE id = 'w1'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(legacy.as_deref(), Some("b"), "legacy column tracks the first cluster");

        // An empty set unbinds everything and NULLs the legacy column.
        let mut tx = db.begin().await.unwrap();
        write_cluster_bindings(&mut tx, "w1", &[]).await.unwrap();
        tx.commit().await.unwrap();
        assert!(bound_contexts(&db, "w1").await.is_empty());
        let legacy: Option<String> =
            sqlx::query_scalar("SELECT context_name FROM workspaces WHERE id = 'w1'")
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(legacy, None);
    }

    #[tokio::test]
    async fn resolve_returns_an_existing_binding_and_creates_one_otherwise() {
        let db = test_pool().await;

        // Not bound anywhere yet -> a new workspace is created for it.
        let first = resolve_or_create_workspace_id(&db, "prod", None).await.unwrap();
        assert_eq!(bound_contexts(&db, &first).await, vec!["prod"]);

        // Already bound -> the same workspace comes back, no second row.
        let second = resolve_or_create_workspace_id(&db, "prod", Some("Production"))
            .await
            .unwrap();
        assert_eq!(first, second, "a repeated resolve must return the same workspace");

        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM workspace_clusters WHERE context_name = ?",
        )
        .bind("prod")
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(count, 1, "resolve must never insert a duplicate row");

        // A different context still gets its own workspace.
        let other = resolve_or_create_workspace_id(&db, "staging", None).await.unwrap();
        assert_ne!(first, other);
    }

    #[tokio::test]
    async fn resolve_finds_a_cluster_bound_as_a_secondary_member() {
        let db = test_pool().await;
        sqlx::query("INSERT INTO workspaces (id, name) VALUES ('multi', 'Multi')")
            .execute(&db)
            .await
            .unwrap();
        let mut tx = db.begin().await.unwrap();
        write_cluster_bindings(&mut tx, "multi", &["prod".to_string(), "stage".to_string()])
            .await
            .unwrap();
        tx.commit().await.unwrap();

        // "stage" is not the legacy `context_name`, only a join-table member.
        let resolved = resolve_or_create_workspace_id(&db, "stage", None).await.unwrap();
        assert_eq!(resolved, "multi");

        let workspaces: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workspaces")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(workspaces, 1, "resolve must not create a workspace for a bound cluster");
    }
}
