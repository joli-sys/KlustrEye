use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    k8s::port_forward,
    AppState,
};

pub async fn list_port_forwards(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let sessions =
        port_forward::list_active_port_forwards(&state.db, &state.port_forwards, Some(&context_name))
            .await
            .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "sessions": sessions })))
}

#[derive(Deserialize)]
pub struct StartBody {
    pub namespace: String,
    #[serde(rename = "resourceType")]
    pub resource_type: String,
    #[serde(rename = "resourceName")]
    pub resource_name: String,
    #[serde(rename = "localPort")]
    pub local_port: u16,
    #[serde(rename = "remotePort")]
    pub remote_port: u16,
}

pub async fn start_port_forward(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<StartBody>,
) -> Result<Json<Value>> {
    if body.namespace.is_empty()
        || body.resource_type.is_empty()
        || body.resource_name.is_empty()
    {
        return Err(AppError::BadRequest(
            "Missing required fields: namespace, resourceType, resourceName, localPort, remotePort"
                .to_string(),
        ));
    }

    if body.resource_type != "pod" && body.resource_type != "service" {
        return Err(AppError::BadRequest(
            "resourceType must be 'pod' or 'service'".to_string(),
        ));
    }

    let session = port_forward::start_port_forward(
        &state.db,
        &state.port_forwards,
        &context_name,
        &body.namespace,
        &body.resource_type,
        &body.resource_name,
        body.local_port,
        body.remote_port,
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "session": session })))
}

pub async fn stop_port_forward(
    Path((_context_name, session_id)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    port_forward::stop_port_forward(&state.db, &state.port_forwards, &session_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(serde_json::json!({ "ok": true })))
}
