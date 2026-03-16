use axum::{
    body::Body,
    extract::{Path, Query, State},
    response::Response,
};
use futures::StreamExt;
use k8s_openapi::api::core::v1::Pod;
use kube::{api::LogParams, Api};
use serde::Deserialize;
use tokio_util::compat::FuturesAsyncReadCompatExt;
use tokio_util::io::ReaderStream;

use crate::{error::{AppError, Result}, AppState};

#[derive(Deserialize)]
pub struct LogQuery {
    pub namespace: Option<String>,
    pub container: Option<String>,
    pub follow: Option<String>,
    #[serde(rename = "tailLines")]
    pub tail_lines: Option<i64>,
    pub previous: Option<String>,
}

pub async fn get_pod_logs(
    Path((context_name, pod_name)): Path<(String, String)>,
    Query(q): Query<LogQuery>,
    State(state): State<AppState>,
) -> Result<Response> {
    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let namespace = q.namespace.as_deref().unwrap_or("default");
    let follow = q.follow.as_deref() == Some("true");
    let tail_lines = q.tail_lines.unwrap_or(200);
    let previous = q.previous.as_deref() == Some("true");
    let container = q.container.clone();

    let pods: Api<Pod> = Api::namespaced((*client).clone(), namespace);

    if !follow {
        let params = LogParams {
            container: container.clone(),
            tail_lines: Some(tail_lines),
            previous,
            ..Default::default()
        };
        let log = pods.logs(&pod_name, &params).await
            .map_err(|e| AppError::Kubernetes(e.to_string()))?;

        return Ok(Response::builder()
            .header("Content-Type", "text/plain")
            .body(Body::from(log))
            .unwrap());
    }

    // Streaming SSE
    let params = LogParams {
        container: container.clone(),
        tail_lines: Some(tail_lines),
        previous,
        follow: true,
        ..Default::default()
    };

    let stream = pods.log_stream(&pod_name, &params).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    let reader_stream = ReaderStream::new(stream.compat());
    let sse_stream = reader_stream.map(|chunk: std::result::Result<bytes::Bytes, std::io::Error>| {
        match chunk {
            Ok(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                let payload = serde_json::json!({ "line": line });
                Ok::<_, std::convert::Infallible>(
                    format!("data: {}\n\n", payload).into_bytes()
                )
            }
            Err(e) => {
                let payload = serde_json::json!({ "error": e.to_string() });
                Ok::<_, std::convert::Infallible>(
                    format!("data: {}\n\n", payload).into_bytes()
                )
            }
        }
    });

    let body = Body::from_stream(sse_stream);

    Ok(Response::builder()
        .header("Content-Type", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .header("Connection", "keep-alive")
        .body(body)
        .unwrap())
}

pub async fn trigger_cronjob(
    Path((context_name, name)): Path<(String, String)>,
    Query(q): Query<std::collections::HashMap<String, String>>,
    State(state): State<AppState>,
) -> Result<axum::Json<serde_json::Value>> {
    use kube::api::{Api, PostParams};
    use k8s_openapi::api::batch::v1::{CronJob, Job};
    use kube::api::ObjectMeta;

    let client = state.clients.get_client(&context_name).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let namespace = q.get("namespace").map(String::as_str).unwrap_or("default");

    let cronjobs: Api<CronJob> = Api::namespaced((*client).clone(), namespace);
    let cj = cronjobs.get(&name).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    let spec = cj.spec.as_ref()
        .ok_or_else(|| AppError::Internal("CronJob has no spec".to_string()))?;

    let job_template = spec.job_template.clone();
    let job_name = format!("{name}-manual-{}", uuid::Uuid::new_v4().simple());

    let mut job = Job {
        metadata: ObjectMeta {
            name: Some(job_name.clone()),
            namespace: Some(namespace.to_string()),
            ..Default::default()
        },
        spec: job_template.spec,
        ..Default::default()
    };

    // Set owner reference
    if let Some(uid) = cj.metadata.uid.as_deref() {
        job.metadata.owner_references = Some(vec![
            k8s_openapi::apimachinery::pkg::apis::meta::v1::OwnerReference {
                api_version: "batch/v1".to_string(),
                block_owner_deletion: Some(true),
                controller: Some(true),
                kind: "CronJob".to_string(),
                name: name.clone(),
                uid: uid.to_string(),
            }
        ]);
    }

    let jobs: Api<Job> = Api::namespaced((*client).clone(), namespace);
    jobs.create(&PostParams::default(), &job).await
        .map_err(|e| AppError::Kubernetes(e.to_string()))?;

    Ok(axum::Json(serde_json::json!({ "ok": true, "jobName": job_name })))
}
