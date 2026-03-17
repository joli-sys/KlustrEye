use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::{
    error::{AppError, Result},
    routes::clusters::{ensure_cluster_context, upsert_cluster_setting},
    AppState,
};

// --- Settings ---

pub async fn get_settings(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let cluster_id = ensure_cluster_context(&state.db, &context_name).await?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM cluster_settings WHERE cluster_id = ? AND key LIKE 'opencost.%'",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    Ok(Json(json!({
        "url": map.get("opencost.url").cloned().unwrap_or_default(),
        "hasToken": map.contains_key("opencost.token"),
        "metricsSource": map.get("opencost.metricsSource").cloned().unwrap_or_else(|| "opencost".to_string()),
        "prometheusUrl": map.get("opencost.prometheusUrl").cloned().unwrap_or_default(),
        "hasPrometheusToken": map.contains_key("opencost.prometheusToken"),
    })))
}

#[derive(Deserialize)]
pub struct OpenCostSettingsBody {
    pub url: Option<String>,
    pub token: Option<String>,
    #[serde(rename = "metricsSource")]
    pub metrics_source: Option<String>,
    #[serde(rename = "prometheusUrl")]
    pub prometheus_url: Option<String>,
    #[serde(rename = "prometheusToken")]
    pub prometheus_token: Option<String>,
}

pub async fn put_settings(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<OpenCostSettingsBody>,
) -> Result<Json<Value>> {
    if let Some(url) = &body.url {
        upsert_cluster_setting(&state.db, &context_name, "opencost.url", url).await?;
    }
    if let Some(token) = &body.token {
        if token != "__keep__" {
            upsert_cluster_setting(&state.db, &context_name, "opencost.token", token).await?;
        }
    }
    if let Some(source) = &body.metrics_source {
        upsert_cluster_setting(&state.db, &context_name, "opencost.metricsSource", source).await?;
    }
    if let Some(url) = &body.prometheus_url {
        upsert_cluster_setting(&state.db, &context_name, "opencost.prometheusUrl", url).await?;
    }
    if let Some(token) = &body.prometheus_token {
        if token != "__keep__" {
            upsert_cluster_setting(&state.db, &context_name, "opencost.prometheusToken", token).await?;
        }
    }
    Ok(Json(json!({ "ok": true })))
}

pub async fn test_connection(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;

    match config.metrics_source.as_str() {
        "prometheus" | "mimir" => {
            let prom_url = config.prometheus_url.as_deref().unwrap_or("");
            if prom_url.is_empty() {
                return Ok(Json(json!({ "ok": false, "error": "Prometheus/Mimir URL not configured" })));
            }
            let url = format!("{}/api/v1/query?query=opencost_node_total_hourly_cost", prom_url.trim_end_matches('/'));
            let result = make_request(&url, config.prometheus_token.as_deref()).await;
            match result {
                Ok(body) => {
                    let has_data = body
                        .get("data")
                        .and_then(|d| d.get("result"))
                        .and_then(|r| r.as_array())
                        .map(|a| !a.is_empty())
                        .unwrap_or(false);
                    Ok(Json(json!({
                        "ok": true,
                        "hasOpenCostMetrics": has_data,
                    })))
                }
                Err(e) => Ok(Json(json!({ "ok": false, "error": e.to_string() }))),
            }
        }
        _ => {
            // OpenCost direct
            let oc_url = config.url.as_deref().unwrap_or("");
            if oc_url.is_empty() {
                return Ok(Json(json!({ "ok": false, "error": "OpenCost URL not configured" })));
            }
            let url = format!("{}/model/allocation?window=1d&aggregate=namespace", oc_url.trim_end_matches('/'));
            let result = make_request(&url, config.token.as_deref()).await;
            match result {
                Ok(_) => Ok(Json(json!({ "ok": true }))),
                Err(e) => Ok(Json(json!({ "ok": false, "error": e.to_string() }))),
            }
        }
    }
}

// --- Allocation (namespace/pod/node cost breakdown via OpenCost API) ---

#[derive(Deserialize)]
pub struct AllocationQuery {
    pub window: Option<String>,
    pub aggregate: Option<String>,
    pub namespace: Option<String>,
    pub accumulate: Option<bool>,
}

pub async fn get_allocation(
    Path(context_name): Path<String>,
    Query(q): Query<AllocationQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;
    let window = q.window.as_deref().unwrap_or("1d");
    let aggregate = q.aggregate.as_deref().unwrap_or("namespace");

    match config.metrics_source.as_str() {
        "prometheus" | "mimir" => {
            get_allocation_from_prometheus(&config, window, aggregate, q.namespace.as_deref()).await
        }
        _ => {
            get_allocation_from_opencost(&config, window, aggregate, q.namespace.as_deref(), q.accumulate).await
        }
    }
}

// --- Assets (node costs via OpenCost API) ---

pub async fn get_assets(
    Path(context_name): Path<String>,
    Query(q): Query<AllocationQuery>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;
    let window = q.window.as_deref().unwrap_or("1d");

    match config.metrics_source.as_str() {
        "prometheus" | "mimir" => {
            get_assets_from_prometheus(&config, window).await
        }
        _ => {
            let oc_url = config.url.as_deref().unwrap_or("");
            if oc_url.is_empty() {
                return Err(AppError::BadRequest("OpenCost URL not configured".into()));
            }
            let url = format!(
                "{}/model/assets?window={}&aggregate=node",
                oc_url.trim_end_matches('/'),
                window
            );
            let body = make_request(&url, config.token.as_deref()).await
                .map_err(|e| AppError::Internal(e.to_string()))?;
            Ok(Json(body))
        }
    }
}

// --- Helpers ---

struct OpenCostConfig {
    url: Option<String>,
    token: Option<String>,
    metrics_source: String,
    prometheus_url: Option<String>,
    prometheus_token: Option<String>,
}

async fn load_config(context_name: &str, state: &AppState) -> Result<OpenCostConfig> {
    let cluster_id = ensure_cluster_context(&state.db, context_name).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM cluster_settings WHERE cluster_id = ? AND key LIKE 'opencost.%'",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    Ok(OpenCostConfig {
        url: map.get("opencost.url").cloned().filter(|s| !s.is_empty()),
        token: map.get("opencost.token").cloned().filter(|s| !s.is_empty()),
        metrics_source: map.get("opencost.metricsSource").cloned().unwrap_or_else(|| "opencost".to_string()),
        prometheus_url: map.get("opencost.prometheusUrl").cloned().filter(|s| !s.is_empty()),
        prometheus_token: map.get("opencost.prometheusToken").cloned().filter(|s| !s.is_empty()),
    })
}

async fn make_request(url: &str, token: Option<&str>) -> anyhow::Result<Value> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()?;
    let mut req = client.get(url);
    if let Some(t) = token {
        req = req.bearer_auth(t);
    }
    let resp = req.send().await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Request failed with {}: {}", status, text);
    }
    Ok(resp.json().await?)
}

async fn get_allocation_from_opencost(
    config: &OpenCostConfig,
    window: &str,
    aggregate: &str,
    namespace: Option<&str>,
    accumulate: Option<bool>,
) -> Result<Json<Value>> {
    let oc_url = config.url.as_deref().unwrap_or("");
    if oc_url.is_empty() {
        return Err(AppError::BadRequest("OpenCost URL not configured".into()));
    }
    let mut url = format!(
        "{}/model/allocation?window={}&aggregate={}&accumulate={}",
        oc_url.trim_end_matches('/'),
        window,
        aggregate,
        accumulate.unwrap_or(true),
    );
    if let Some(ns) = namespace {
        url.push_str(&format!("&filterNamespaces={}", ns));
    }
    let body = make_request(&url, config.token.as_deref()).await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(body))
}

async fn get_allocation_from_prometheus(
    config: &OpenCostConfig,
    window: &str,
    aggregate: &str,
    namespace: Option<&str>,
) -> Result<Json<Value>> {
    let prom_url = config.prometheus_url.as_deref().unwrap_or("");
    if prom_url.is_empty() {
        return Err(AppError::BadRequest("Prometheus/Mimir URL not configured".into()));
    }

    // Build PromQL queries for cost metrics based on aggregate
    let (cpu_query, ram_query, total_query) = match aggregate {
        "pod" => {
            let ns_filter = namespace.map(|ns| format!(", namespace=\"{}\"", ns)).unwrap_or_default();
            (
                format!("sum by (pod, namespace) (opencost_pod_cpu_cost{{{}}})", ns_filter.trim_start_matches(", ")),
                format!("sum by (pod, namespace) (opencost_pod_ram_cost{{{}}})", ns_filter.trim_start_matches(", ")),
                format!("sum by (pod, namespace) (opencost_pod_total_cost{{{}}})", ns_filter.trim_start_matches(", ")),
            )
        }
        "node" => (
            "sum by (node) (opencost_node_cpu_hourly_cost)".to_string(),
            "sum by (node) (opencost_node_ram_hourly_cost)".to_string(),
            "sum by (node) (opencost_node_total_hourly_cost)".to_string(),
        ),
        _ => {
            // namespace
            let ns_filter = namespace.map(|ns| format!("namespace=\"{}\"", ns)).unwrap_or_default();
            let filter = if ns_filter.is_empty() { String::new() } else { format!("{{{}}}", ns_filter) };
            (
                format!("sum by (namespace) (opencost_pod_cpu_cost{})", filter),
                format!("sum by (namespace) (opencost_pod_ram_cost{})", filter),
                format!("sum by (namespace) (opencost_pod_total_cost{})", filter),
            )
        }
    };

    // Convert window to seconds for Prometheus range
    let duration_secs = window_to_seconds(window);
    let step = if duration_secs <= 3600 { "60" } else { "300" };

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let start = now - duration_secs;

    let mut results = serde_json::Map::new();
    for (key, query) in [("cpu", &cpu_query), ("ram", &ram_query), ("total", &total_query)] {
        let url = format!(
            "{}/api/v1/query_range?query={}&start={}&end={}&step={}",
            prom_url.trim_end_matches('/'),
            urlencoding::encode(query),
            start,
            now,
            step
        );
        match make_request(&url, config.prometheus_token.as_deref()).await {
            Ok(body) => { results.insert(key.to_string(), body); }
            Err(e) => { results.insert(key.to_string(), json!({ "error": e.to_string() })); }
        }
    }

    Ok(Json(Value::Object(results)))
}

async fn get_assets_from_prometheus(config: &OpenCostConfig, window: &str) -> Result<Json<Value>> {
    let prom_url = config.prometheus_url.as_deref().unwrap_or("");
    if prom_url.is_empty() {
        return Err(AppError::BadRequest("Prometheus/Mimir URL not configured".into()));
    }

    let query = "sum by (node) (opencost_node_total_hourly_cost)";
    let url = format!(
        "{}/api/v1/query?query={}",
        prom_url.trim_end_matches('/'),
        urlencoding::encode(query)
    );

    let body = make_request(&url, config.prometheus_token.as_deref()).await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(json!({ "window": window, "data": body })))
}

fn window_to_seconds(window: &str) -> u64 {
    match window {
        "1h" => 3600,
        "6h" => 6 * 3600,
        "12h" => 12 * 3600,
        "2d" => 2 * 86400,
        "7d" => 7 * 86400,
        "30d" => 30 * 86400,
        _ => 86400, // 1d default
    }
}
