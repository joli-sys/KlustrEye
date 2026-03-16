use axum::{
    extract::{Path, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    k8s::{client::get_contexts, provider::detect_cloud_provider},
    AppState,
};

pub async fn list_clusters(State(state): State<AppState>) -> Result<Json<Value>> {
    let kubeconfig_path = state.clients.kubeconfig_path.read().await.clone();

    let contexts = get_contexts(kubeconfig_path.as_deref())
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let stored: Vec<StoredCluster> = sqlx::query_as(
        "SELECT cc.context_name, cc.display_name, cc.last_namespace, cc.organization_id,
                o.name as organization_name,
                (SELECT value FROM cluster_settings WHERE cluster_id = cc.id AND key = 'colorScheme') as color_scheme,
                (SELECT value FROM cluster_settings WHERE cluster_id = cc.id AND key = 'cloudProvider') as cloud_provider_override
         FROM cluster_contexts cc
         LEFT JOIN organizations o ON o.id = cc.organization_id",
    )
    .fetch_all(&state.db)
    .await?;

    let stored_map: std::collections::HashMap<_, _> =
        stored.iter().map(|s| (s.context_name.clone(), s)).collect();

    let result: Vec<Value> = contexts
        .iter()
        .map(|ctx| {
            let s = stored_map.get(&ctx.name);
            json!({
                "name": ctx.name,
                "cluster": ctx.cluster,
                "user": ctx.user,
                "namespace": ctx.namespace,
                "isCurrent": ctx.is_current,
                "provider": ctx.provider,
                "cloudProvider": s.and_then(|s| s.cloud_provider_override.as_deref()).unwrap_or(&ctx.cloud_provider),
                "displayName": s.and_then(|s| s.display_name.as_deref()),
                "colorScheme": s.and_then(|s| s.color_scheme.as_deref()),
                "organizationId": s.and_then(|s| s.organization_id.as_deref()),
                "organizationName": s.and_then(|s| s.organization_name.as_deref()),
                "lastNamespace": s.map(|s| s.last_namespace.as_str()).unwrap_or("default"),
            })
        })
        .collect();

    Ok(Json(Value::Array(result)))
}

pub async fn get_cluster(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let client = state
        .clients
        .get_client(&context_name)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let (ok, version, error) = crate::k8s::client::test_connection(&client).await;

    let server_url = {
        let path = state.clients.kubeconfig_path.read().await.clone();
        let kc = crate::k8s::client::load_kubeconfig(path.as_deref())
            .map_err(|e| AppError::Internal(e.to_string()))?;
        kc.contexts
            .iter()
            .find(|c| c.name == context_name)
            .and_then(|c| c.context.as_ref())
            .and_then(|c| {
                kc.clusters
                    .iter()
                    .find(|cl| cl.name == c.cluster)
                    .and_then(|cl| cl.cluster.as_ref())
                    .and_then(|cl| cl.server.clone())
            })
            .unwrap_or_default()
    };

    let cloud_provider = detect_cloud_provider(&server_url, version.as_deref());

    if ok && cloud_provider != "kubernetes" {
        let _ = upsert_cluster_setting(&state.db, &context_name, "cloudProvider", &cloud_provider).await;
    }

    Ok(Json(json!({
        "contextName": context_name,
        "cloudProvider": cloud_provider,
        "ok": ok,
        "version": version,
        "error": error,
    })))
}

pub async fn rename_cluster(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<RenameBody>,
) -> Result<Json<Value>> {
    ensure_cluster_context(&state.db, &context_name).await?;
    sqlx::query(
        "UPDATE cluster_contexts SET display_name = ?, updated_at = datetime('now')
         WHERE context_name = ?",
    )
    .bind(&body.display_name)
    .bind(&context_name)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn set_namespace(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<NamespaceBody>,
) -> Result<Json<Value>> {
    ensure_cluster_context(&state.db, &context_name).await?;
    sqlx::query(
        "UPDATE cluster_contexts SET last_namespace = ?, updated_at = datetime('now')
         WHERE context_name = ?",
    )
    .bind(&body.namespace)
    .bind(&context_name)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true })))
}

pub async fn set_color(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<ColorBody>,
) -> Result<Json<Value>> {
    upsert_cluster_setting(&state.db, &context_name, "colorScheme", &body.color_scheme).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn set_organization(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<OrgBody>,
) -> Result<Json<Value>> {
    ensure_cluster_context(&state.db, &context_name).await?;
    sqlx::query(
        "UPDATE cluster_contexts SET organization_id = ?, updated_at = datetime('now')
         WHERE context_name = ?",
    )
    .bind(&body.organization_id)
    .bind(&context_name)
    .execute(&state.db)
    .await?;

    Ok(Json(json!({ "ok": true })))
}

// --- Helpers ---

pub async fn ensure_cluster_context(db: &SqlitePool, context_name: &str) -> Result<String> {
    let existing: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM cluster_contexts WHERE context_name = ?",
    )
    .bind(context_name)
    .fetch_optional(db)
    .await?;

    if let Some((id,)) = existing {
        return Ok(id);
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO cluster_contexts (id, context_name) VALUES (?, ?)",
    )
    .bind(&id)
    .bind(context_name)
    .execute(db)
    .await?;

    Ok(id)
}

pub async fn upsert_cluster_setting(
    db: &SqlitePool,
    context_name: &str,
    key: &str,
    value: &str,
) -> Result<()> {
    let cluster_id = ensure_cluster_context(db, context_name).await?;
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO cluster_settings (id, cluster_id, key, value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(cluster_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
    )
    .bind(&id)
    .bind(&cluster_id)
    .bind(key)
    .bind(value)
    .execute(db)
    .await?;
    Ok(())
}

// --- DB row types ---

#[derive(sqlx::FromRow)]
struct StoredCluster {
    context_name: String,
    display_name: Option<String>,
    last_namespace: String,
    organization_id: Option<String>,
    organization_name: Option<String>,
    color_scheme: Option<String>,
    cloud_provider_override: Option<String>,
}

// --- Request bodies ---

#[derive(Deserialize)]
pub struct RenameBody {
    #[serde(rename = "displayName")]
    pub display_name: Option<String>,
}

#[derive(Deserialize)]
pub struct NamespaceBody {
    pub namespace: String,
}

#[derive(Deserialize)]
pub struct ColorBody {
    #[serde(rename = "colorScheme")]
    pub color_scheme: String,
}

#[derive(Deserialize)]
pub struct OrgBody {
    #[serde(rename = "organizationId")]
    pub organization_id: Option<String>,
}
