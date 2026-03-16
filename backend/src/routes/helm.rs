use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    k8s::helm,
    AppState,
};

#[derive(Deserialize)]
pub struct HelmQuery {
    pub namespace: Option<String>,
    pub view: Option<String>,
}

pub async fn list_releases(
    Path(context_name): Path<String>,
    Query(q): Query<HelmQuery>,
    State(_state): State<AppState>,
) -> Result<Json<Value>> {
    let releases = helm::list_releases(&context_name, q.namespace.as_deref()).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(releases))
}

#[derive(Deserialize)]
pub struct InstallBody {
    #[serde(rename = "releaseName")]
    pub release_name: String,
    pub chart: String,
    pub namespace: String,
    pub values: Option<Value>,
    pub version: Option<String>,
}

pub async fn install_release(
    Path(context_name): Path<String>,
    State(_state): State<AppState>,
    Json(body): Json<InstallBody>,
) -> Result<Json<Value>> {
    if body.release_name.is_empty() || body.chart.is_empty() || body.namespace.is_empty() {
        return Err(AppError::BadRequest(
            "releaseName, chart, and namespace are required".to_string(),
        ));
    }

    let result = helm::install_chart(
        &context_name,
        &body.release_name,
        &body.chart,
        &body.namespace,
        body.values.as_ref(),
        body.version.as_deref(),
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true, "output": result })))
}

pub async fn get_release(
    Path((context_name, name)): Path<(String, String)>,
    Query(q): Query<HelmQuery>,
    State(_state): State<AppState>,
) -> Result<Json<Value>> {
    let namespace = q.namespace.as_deref().unwrap_or("default");

    if q.view.as_deref() == Some("history") {
        let history = helm::get_release_history(&context_name, &name, namespace).await
            .map_err(|e| AppError::Internal(e.to_string()))?;
        return Ok(Json(history));
    }

    let release = helm::get_release(&context_name, &name, namespace).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(release))
}

#[derive(Deserialize)]
pub struct UpdateReleaseBody {
    pub namespace: String,
    pub action: Option<String>,
    pub chart: Option<String>,
    pub revision: Option<u32>,
    #[serde(rename = "valuesYaml")]
    pub values_yaml: Option<String>,
    pub version: Option<String>,
}

pub async fn update_release(
    Path((context_name, name)): Path<(String, String)>,
    State(_state): State<AppState>,
    Json(body): Json<UpdateReleaseBody>,
) -> Result<Json<Value>> {
    match body.action.as_deref() {
        Some("dry-run") => {
            let manifest = helm::template_release(
                &context_name,
                &name,
                &body.namespace,
                body.values_yaml.as_deref(),
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(Json(serde_json::json!({ "ok": true, "manifest": manifest })))
        }
        Some("upgrade") => {
            let result = helm::upgrade_release(
                &context_name,
                &name,
                body.chart.as_deref(),
                &body.namespace,
                body.values_yaml.as_deref(),
                body.version.as_deref(),
            )
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(Json(serde_json::json!({ "ok": true, "output": result })))
        }
        _ => {
            if let Some(rev) = body.revision {
                let result = helm::rollback_release(&context_name, &name, &body.namespace, rev)
                    .await
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                Ok(Json(serde_json::json!({ "ok": true, "output": result })))
            } else {
                Err(AppError::BadRequest("Specify action or revision".to_string()))
            }
        }
    }
}

pub async fn delete_release(
    Path((context_name, name)): Path<(String, String)>,
    Query(q): Query<HelmQuery>,
    State(_state): State<AppState>,
) -> Result<Json<Value>> {
    let namespace = q.namespace.as_deref().unwrap_or("default");
    let result = helm::uninstall_release(&context_name, &name, namespace).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(serde_json::json!({ "ok": true, "output": result })))
}
