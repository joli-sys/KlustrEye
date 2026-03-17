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
        "SELECT key, value FROM cluster_settings WHERE cluster_id = ?
         AND (key LIKE 'opencost.%' OR key IN ('grafanaUrl', 'grafanaServiceAccountToken', 'grafanaDatasourceId'))",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    let grafana_configured = map.contains_key("grafanaUrl")
        && map.contains_key("grafanaServiceAccountToken")
        && map.contains_key("grafanaDatasourceId");

    Ok(Json(json!({
        "url": map.get("opencost.url").cloned().unwrap_or_default(),
        "hasToken": map.contains_key("opencost.token"),
        "metricsSource": map.get("opencost.metricsSource").cloned().unwrap_or_else(|| "opencost".to_string()),
        "prometheusUrl": map.get("opencost.prometheusUrl").cloned().unwrap_or_default(),
        "hasPrometheusToken": map.contains_key("opencost.prometheusToken"),
        "grafanaConfigured": grafana_configured,
        "clusterLabel": map.get("opencost.clusterLabel").cloned().unwrap_or_default(),
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
    #[serde(rename = "clusterLabel")]
    pub cluster_label: Option<String>,
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
    if let Some(label) = &body.cluster_label {
        upsert_cluster_setting(&state.db, &context_name, "opencost.clusterLabel", label).await?;
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
            let url = format!(
                "{}/api/v1/query?query={}",
                prom_url.trim_end_matches('/'),
                urlencoding::encode("count(node_total_hourly_cost)")
            );
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

// --- Summary (for cluster overview) ---

pub async fn get_summary(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;

    match config.metrics_source.as_str() {
        "prometheus" | "mimir" => {
            let prom_url = config.prometheus_url.as_deref().unwrap_or("");
            if prom_url.is_empty() {
                return Ok(Json(json!({ "hourly": null, "monthly": null })));
            }
            let cl_filter = config
                .cluster_label
                .as_deref()
                .filter(|s| !s.is_empty())
                .map(|c| format!(r#"cluster="{}""#, c))
                .unwrap_or_default();
            let summary_query = if cl_filter.is_empty() {
                "sum(node_total_hourly_cost)".to_string()
            } else {
                format!("sum(node_total_hourly_cost{{{}}})", cl_filter)
            };
            let url = format!(
                "{}/api/v1/query?query={}",
                prom_url.trim_end_matches('/'),
                urlencoding::encode(&summary_query)
            );
            match make_request(&url, config.prometheus_token.as_deref()).await {
                Ok(body) => {
                    let hourly = body
                        .get("data").and_then(|d| d.get("result"))
                        .and_then(|r| r.as_array()).and_then(|a| a.first())
                        .and_then(|v| v.get("value")).and_then(|v| v.as_array())
                        .and_then(|v| v.get(1)).and_then(|v| v.as_str())
                        .and_then(|s| s.parse::<f64>().ok());
                    Ok(Json(json!({
                        "hourly": hourly,
                        "monthly": hourly.map(|h| h * 730.0),
                    })))
                }
                Err(_) => Ok(Json(json!({ "hourly": null, "monthly": null }))),
            }
        }
        _ => {
            let oc_url = config.url.as_deref().unwrap_or("");
            if oc_url.is_empty() {
                return Ok(Json(json!({ "hourly": null, "monthly": null })));
            }
            let url = format!(
                "{}/model/allocation?window=1h&aggregate=cluster&accumulate=false",
                oc_url.trim_end_matches('/')
            );
            match make_request(&url, config.token.as_deref()).await {
                Ok(body) => {
                    let allocs = body.get("data")
                        .and_then(|d| d.as_array()).and_then(|a| a.first())
                        .and_then(|v| v.as_object());
                    let hourly = allocs.map(|map| {
                        map.values()
                            .filter_map(|v| v.get("totalCost").and_then(|c| c.as_f64()))
                            .sum::<f64>()
                    });
                    Ok(Json(json!({
                        "hourly": hourly,
                        "monthly": hourly.map(|h| h * 730.0),
                    })))
                }
                Err(_) => Ok(Json(json!({ "hourly": null, "monthly": null }))),
            }
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
    cluster_label: Option<String>,
}

/// Extract a short cluster name from an ARN or context name.
/// arn:aws:eks:region:account:cluster/name → "name"
/// gke_project_region_cluster → "cluster"
/// plain-name → "plain-name"
fn extract_cluster_name(context_name: &str) -> String {
    if let Some(pos) = context_name.rfind('/') {
        return context_name[pos + 1..].to_string();
    }
    if context_name.starts_with("gke_") {
        if let Some(last) = context_name.split('_').last() {
            if !last.is_empty() {
                return last.to_string();
            }
        }
    }
    context_name.to_string()
}

fn datasource_proxy_base(grafana_url: &str, datasource_id: &str) -> String {
    let proxy_path = if datasource_id.chars().all(|c| c.is_ascii_digit()) {
        format!("/api/datasources/proxy/{}", datasource_id)
    } else {
        format!("/api/datasources/proxy/uid/{}", datasource_id)
    };
    format!("{}{}", grafana_url.trim_end_matches('/'), proxy_path)
}

async fn load_config(context_name: &str, state: &AppState) -> Result<OpenCostConfig> {
    let cluster_id = ensure_cluster_context(&state.db, context_name).await?;
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM cluster_settings WHERE cluster_id = ?
         AND (key LIKE 'opencost.%' OR key IN ('grafanaUrl', 'grafanaServiceAccountToken', 'grafanaDatasourceId'))",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    let metrics_source = map.get("opencost.metricsSource").cloned().unwrap_or_else(|| "opencost".to_string());

    // When metricsSource is "mimir", use Grafana/Mimir datasource proxy settings
    let (prometheus_url, prometheus_token) = if metrics_source == "mimir" {
        let grafana_url = map.get("grafanaUrl").cloned().filter(|s| !s.is_empty());
        let grafana_token = map.get("grafanaServiceAccountToken").cloned().filter(|s| !s.is_empty());
        let datasource_id = map.get("grafanaDatasourceId").cloned().filter(|s| !s.is_empty());

        match (grafana_url, datasource_id) {
            (Some(url), Some(ds_id)) => (
                Some(datasource_proxy_base(&url, &ds_id)),
                grafana_token,
            ),
            _ => (
                map.get("opencost.prometheusUrl").cloned().filter(|s| !s.is_empty()),
                map.get("opencost.prometheusToken").cloned().filter(|s| !s.is_empty()),
            ),
        }
    } else {
        (
            map.get("opencost.prometheusUrl").cloned().filter(|s| !s.is_empty()),
            map.get("opencost.prometheusToken").cloned().filter(|s| !s.is_empty()),
        )
    };

    // Use stored clusterLabel if set, otherwise extract from context name
    let cluster_label = map
        .get("opencost.clusterLabel")
        .filter(|s| !s.is_empty())
        .cloned()
        .or_else(|| Some(extract_cluster_name(context_name)));

    Ok(OpenCostConfig {
        url: map.get("opencost.url").cloned().filter(|s| !s.is_empty()),
        token: map.get("opencost.token").cloned().filter(|s| !s.is_empty()),
        metrics_source,
        prometheus_url,
        prometheus_token,
        cluster_label,
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

    let hours = window_to_hours(window);
    let (cpu_query, ram_query, total_query) =
        build_allocation_queries(aggregate, window, hours, namespace, config.cluster_label.as_deref());

    let mut results = serde_json::Map::new();
    for (key, query) in [("cpu", &cpu_query), ("ram", &ram_query), ("total", &total_query)] {
        let url = format!(
            "{}/api/v1/query?query={}",
            prom_url.trim_end_matches('/'),
            urlencoding::encode(query)
        );
        match make_request(&url, config.prometheus_token.as_deref()).await {
            Ok(body) => { results.insert(key.to_string(), body); }
            Err(e) => { results.insert(key.to_string(), json!({ "error": e.to_string() })); }
        }
    }

    Ok(Json(Value::Object(results)))
}

fn build_allocation_queries(
    aggregate: &str,
    window: &str,
    hours: f64,
    namespace: Option<&str>,
    cluster_label: Option<&str>,
) -> (String, String, String) {
    // Optional cluster prefix for all selectors: cluster="name",
    let cl = cluster_label
        .filter(|s| !s.is_empty())
        .map(|c| format!(r#"cluster="{}", "#, c))
        .unwrap_or_default();

    // Node-level metric selector (no namespace/pod)
    let node_sel = cl.trim_end_matches(", ").to_string();
    let node_filter = if node_sel.is_empty() { String::new() } else { format!("{{{}}}", node_sel) };

    match aggregate {
        "pod" => {
            let selector = if let Some(ns) = namespace {
                format!(r#"{cl}pod!="", namespace="{}""#, ns)
            } else {
                format!(r#"{cl}pod!="", namespace!="""#)
            };
            (
                format!(
                    r#"sum by (namespace, pod) (avg_over_time(container_cpu_allocation{{{selector}}}[{window}]) * on(instance) group_left() avg_over_time(node_cpu_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (namespace, pod) (avg_over_time(container_memory_allocation_bytes{{{selector}}}[{window}]) / (1024*1024*1024) * on(instance) group_left() avg_over_time(node_ram_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (namespace, pod) (avg_over_time(container_cpu_allocation{{{selector}}}[{window}]) * on(instance) group_left() avg_over_time(node_cpu_hourly_cost{node_filter}[{window}]) + avg_over_time(container_memory_allocation_bytes{{{selector}}}[{window}]) / (1024*1024*1024) * on(instance) group_left() avg_over_time(node_ram_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
            )
        }
        "node" => {
            let cpu_cap_sel = if node_sel.is_empty() {
                r#"resource="cpu", unit="core""#.to_string()
            } else {
                format!(r#"{}, resource="cpu", unit="core""#, node_sel)
            };
            let mem_cap_sel = if node_sel.is_empty() {
                r#"resource="memory", unit="byte""#.to_string()
            } else {
                format!(r#"{}, resource="memory", unit="byte""#, node_sel)
            };
            (
                format!(
                    r#"sum by (node) (avg_over_time(kube_node_status_capacity{{{cpu_cap_sel}}}[{window}]) * on(node) group_left() avg_over_time(node_cpu_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (node) (avg_over_time(kube_node_status_capacity{{{mem_cap_sel}}}[{window}]) / (1024*1024*1024) * on(node) group_left() avg_over_time(node_ram_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (node) (avg_over_time(node_total_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
            )
        }
        _ => {
            // namespace
            let base = if let Some(ns) = namespace {
                format!(r#"{cl}namespace!="", namespace="{}""#, ns)
            } else {
                format!(r#"{cl}namespace!="""#)
            };
            (
                format!(
                    r#"sum by (namespace) (avg_over_time(container_cpu_allocation{{{base}}}[{window}]) * on(instance) group_left() avg_over_time(node_cpu_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (namespace) (avg_over_time(container_memory_allocation_bytes{{{base}}}[{window}]) / (1024*1024*1024) * on(instance) group_left() avg_over_time(node_ram_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
                format!(
                    r#"sum by (namespace) (avg_over_time(container_cpu_allocation{{{base}}}[{window}]) * on(instance) group_left() avg_over_time(node_cpu_hourly_cost{node_filter}[{window}]) + avg_over_time(container_memory_allocation_bytes{{{base}}}[{window}]) / (1024*1024*1024) * on(instance) group_left() avg_over_time(node_ram_hourly_cost{node_filter}[{window}])) * {hours}"#
                ),
            )
        }
    }
}

async fn get_assets_from_prometheus(config: &OpenCostConfig, window: &str) -> Result<Json<Value>> {
    let prom_url = config.prometheus_url.as_deref().unwrap_or("");
    if prom_url.is_empty() {
        return Err(AppError::BadRequest("Prometheus/Mimir URL not configured".into()));
    }

    let hours = window_to_hours(window);
    let (cpu_query, ram_query, total_query) =
        build_allocation_queries("node", window, hours, None, config.cluster_label.as_deref());

    let mut results = serde_json::Map::new();
    for (key, query) in [("cpu", &cpu_query), ("ram", &ram_query), ("total", &total_query)] {
        let url = format!(
            "{}/api/v1/query?query={}",
            prom_url.trim_end_matches('/'),
            urlencoding::encode(query)
        );
        match make_request(&url, config.prometheus_token.as_deref()).await {
            Ok(body) => { results.insert(key.to_string(), body); }
            Err(e) => { results.insert(key.to_string(), json!({ "error": e.to_string() })); }
        }
    }

    Ok(Json(Value::Object(results)))
}

fn window_to_hours(window: &str) -> f64 {
    match window {
        "1h" => 1.0,
        "6h" => 6.0,
        "12h" => 12.0,
        "2d" => 48.0,
        "7d" => 168.0,
        "30d" => 720.0,
        _ => 24.0,
    }
}
