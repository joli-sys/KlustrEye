use axum::{
    extract::{Path, State},
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
        "SELECT key, value FROM cluster_settings
         WHERE cluster_id = ? AND key IN ('grafanaUrl', 'grafanaServiceAccountToken', 'grafanaDatasourceId')",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    Ok(Json(json!({
        "url": map.get("grafanaUrl").cloned().unwrap_or_default(),
        "datasourceId": map.get("grafanaDatasourceId").cloned().unwrap_or_default(),
        "hasToken": map.contains_key("grafanaServiceAccountToken"),
    })))
}

#[derive(Deserialize)]
pub struct GrafanaSettingsBody {
    pub url: Option<String>,
    #[serde(rename = "serviceAccountToken")]
    pub service_account_token: Option<String>,
    #[serde(rename = "datasourceId")]
    pub datasource_id: Option<String>,
}

pub async fn put_settings(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<GrafanaSettingsBody>,
) -> Result<Json<Value>> {
    if let Some(url) = &body.url {
        let trimmed = url.trim_end_matches('/').to_string();
        upsert_cluster_setting(&state.db, &context_name, "grafanaUrl", &trimmed).await?;
    }
    if let Some(token) = &body.service_account_token {
        if token != "__keep__" && !token.is_empty() {
            upsert_cluster_setting(&state.db, &context_name, "grafanaServiceAccountToken", token).await?;
        }
    }
    if let Some(ds_id) = &body.datasource_id {
        upsert_cluster_setting(&state.db, &context_name, "grafanaDatasourceId", ds_id).await?;
    }

    Ok(Json(json!({ "ok": true })))
}

pub async fn test_connection(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;

    let Some(config) = config else {
        return Ok(Json(json!({ "ok": false, "error": "Grafana not configured" })));
    };

    let probe_url = format!(
        "{}{}/api/v1/query?query=up",
        config.url,
        datasource_proxy_path(&config.datasource_id)
    );

    match make_request(&probe_url, &config.token).await {
        Err(e) => return Ok(Json(json!({ "ok": false, "error": e.to_string() }))),
        Ok(body) => {
            if body.get("status").and_then(|s| s.as_str()) != Some("success") {
                let err = body.get("error").and_then(|e| e.as_str()).unwrap_or("Unexpected response");
                return Ok(Json(json!({ "ok": false, "error": err })));
            }
        }
    }

    // Probe for expected metrics
    let metrics = [
        ("containerCpu", "container_cpu_usage_seconds_total"),
        ("containerMemory", "container_memory_working_set_bytes"),
        ("nodeCpu", "node_cpu_seconds_total"),
        ("nodeMemory", "node_memory_MemTotal_bytes"),
    ];

    let mut results = serde_json::Map::new();
    for (key, metric) in metrics {
        let url = format!(
            "{}{}/api/v1/query?query=count({})",
            config.url,
            datasource_proxy_path(&config.datasource_id),
            urlencoding::encode(&format!("{{__name__=\"{}\"}}", metric))
        );
        let found = make_request(&url, &config.token).await
            .ok()
            .and_then(|b| {
                b.get("data")?.get("result")?.as_array()
                    .and_then(|r| r.first())
                    .and_then(|v| v.get("value"))
                    .and_then(|v| v.as_array())
                    .and_then(|v| v.get(1))
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.parse::<f64>().ok())
                    .map(|n| n > 0.0)
            })
            .unwrap_or(false);
        results.insert(key.to_string(), json!(found));
    }

    Ok(Json(json!({ "ok": true, "metrics": results })))
}

#[derive(Deserialize)]
pub struct QueryBody {
    pub queries: Vec<String>,
    #[serde(rename = "timeRange")]
    pub time_range: String,
}

pub async fn query(
    Path(context_name): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<QueryBody>,
) -> Result<Json<Value>> {
    let config = load_config(&context_name, &state).await?;

    let Some(config) = config else {
        return Err(AppError::BadRequest("Grafana not configured".into()));
    };

    let (start, end, step) = time_range_params(&body.time_range);

    let mut series_results = Vec::new();
    for query_str in &body.queries {
        let url = format!(
            "{}{}/api/v1/query_range?query={}&start={}&end={}&step={}",
            config.url,
            datasource_proxy_path(&config.datasource_id),
            urlencoding::encode(query_str),
            start,
            end,
            step
        );
        match make_request(&url, &config.token).await {
            Ok(body) => {
                let result = body
                    .get("data")
                    .and_then(|d| d.get("result"))
                    .cloned()
                    .unwrap_or(json!([]));

                let series: Vec<Value> = result
                    .as_array()
                    .map(|arr| {
                        arr.iter().map(|s| {
                            let metric = s.get("metric").cloned().unwrap_or(json!({}));
                            let data_points: Vec<Value> = s
                                .get("values")
                                .and_then(|v| v.as_array())
                                .map(|vals| {
                                    vals.iter().filter_map(|v| {
                                        let arr = v.as_array()?;
                                        let ts = arr.first()?.as_f64()?;
                                        let val: f64 = arr.get(1)?.as_str()?.parse().ok()?;
                                        Some(json!({ "timestamp": ts, "value": val }))
                                    }).collect()
                                })
                                .unwrap_or_default();
                            json!({ "metric": metric, "dataPoints": data_points })
                        }).collect()
                    })
                    .unwrap_or_default();

                series_results.push(json!(series));
            }
            Err(e) => {
                series_results.push(json!({ "error": e.to_string() }));
            }
        }
    }

    Ok(Json(json!({ "series": series_results, "queries": body.queries })))
}

// --- Helpers ---

struct GrafanaConfig {
    url: String,
    token: String,
    datasource_id: String,
}

async fn load_config(context_name: &str, state: &AppState) -> Result<Option<GrafanaConfig>> {
    let cluster_id = ensure_cluster_context(&state.db, context_name).await?;

    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT key, value FROM cluster_settings
         WHERE cluster_id = ? AND key IN ('grafanaUrl', 'grafanaServiceAccountToken', 'grafanaDatasourceId')",
    )
    .bind(&cluster_id)
    .fetch_all(&state.db)
    .await?;

    let map: HashMap<String, String> = rows.into_iter().collect();

    let url = map.get("grafanaUrl").cloned().filter(|s| !s.is_empty());
    let token = map.get("grafanaServiceAccountToken").cloned().filter(|s| !s.is_empty());
    let datasource_id = map.get("grafanaDatasourceId").cloned().filter(|s| !s.is_empty());

    match (url, token, datasource_id) {
        (Some(url), Some(token), Some(datasource_id)) => Ok(Some(GrafanaConfig { url, token, datasource_id })),
        _ => Ok(None),
    }
}

fn datasource_proxy_path(datasource_id: &str) -> String {
    if datasource_id.chars().all(|c| c.is_ascii_digit()) {
        format!("/api/datasources/proxy/{}", datasource_id)
    } else {
        format!("/api/datasources/proxy/uid/{}", datasource_id)
    }
}

async fn make_request(url: &str, token: &str) -> anyhow::Result<Value> {
    let client = reqwest::Client::builder().build()?;
    let resp = client
        .get(url)
        .bearer_auth(token)
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        anyhow::bail!("Request failed with {}: {}", status, text);
    }
    Ok(resp.json().await?)
}

fn time_range_params(range: &str) -> (u64, u64, u64) {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let (duration, step) = match range {
        "1h"  => (3600,   15),
        "6h"  => (21600,  60),
        "24h" => (86400,  300),
        "7d"  => (604800, 1800),
        _     => (86400,  300),
    };
    (now - duration, now, step)
}
