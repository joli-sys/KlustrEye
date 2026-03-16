use anyhow::{anyhow, Result};
use std::process::Stdio;
use tokio::process::Command;

fn extra_paths() -> Vec<String> {
    let home = dirs::home_dir().unwrap_or_default();
    if cfg!(windows) {
        vec![
            r"C:\Program Files\Helm".to_string(),
            home.join(".rd\\bin").to_string_lossy().to_string(),
            home.join("scoop\\shims").to_string_lossy().to_string(),
        ]
    } else {
        vec![
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
            home.join(".rd/bin").to_string_lossy().to_string(),
            home.join(".docker/bin").to_string_lossy().to_string(),
        ]
    }
}

fn build_path_env() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ";" } else { ":" };
    let extras = extra_paths().join(sep);
    format!("{current}{sep}{extras}")
}

async fn helm(args: &[&str], kube_context: Option<&str>) -> Result<String> {
    let mut full_args: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    if let Some(ctx) = kube_context {
        full_args.push("--kube-context".to_string());
        full_args.push(ctx.to_string());
    }

    let output = Command::new("helm")
        .args(&full_args)
        .env("PATH", build_path_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("helm failed: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub async fn list_releases(context_name: &str, namespace: Option<&str>) -> Result<serde_json::Value> {
    let mut args = vec!["list", "--output", "json"];
    let ns_owned;
    if let Some(ns) = namespace {
        ns_owned = ns.to_string();
        args.push("--namespace");
        args.push(&ns_owned);
    } else {
        args.push("--all-namespaces");
    }

    let out = helm(&args, Some(context_name)).await?;
    Ok(serde_json::from_str(&out).unwrap_or(serde_json::Value::Array(vec![])))
}

pub async fn get_release(
    context_name: &str,
    name: &str,
    namespace: &str,
) -> Result<serde_json::Value> {
    let status_args = ["status", name, "--namespace", namespace, "--output", "json"];
    let values_args = ["get", "values", name, "--namespace", namespace, "--output", "json"];
    let manifest_args = ["get", "manifest", name, "--namespace", namespace];
    let (status_out, values_out, manifest_out) = tokio::try_join!(
        helm(&status_args, Some(context_name)),
        helm(&values_args, Some(context_name)),
        helm(&manifest_args, Some(context_name)),
    )?;

    Ok(serde_json::json!({
        "release": serde_json::from_str::<serde_json::Value>(&status_out).unwrap_or_default(),
        "values": serde_json::from_str::<serde_json::Value>(&values_out).unwrap_or_default(),
        "manifest": manifest_out,
    }))
}

pub async fn get_release_history(
    context_name: &str,
    name: &str,
    namespace: &str,
) -> Result<serde_json::Value> {
    let out = helm(
        &["history", name, "--namespace", namespace, "--output", "json"],
        Some(context_name),
    )
    .await?;
    Ok(serde_json::from_str(&out).unwrap_or(serde_json::Value::Array(vec![])))
}

pub async fn install_chart(
    context_name: &str,
    release_name: &str,
    chart: &str,
    namespace: &str,
    values: Option<&serde_json::Value>,
    version: Option<&str>,
) -> Result<String> {
    let mut args: Vec<String> = vec![
        "install".into(),
        release_name.into(),
        chart.into(),
        "--namespace".into(),
        namespace.into(),
        "--create-namespace".into(),
        "--output".into(),
        "json".into(),
    ];

    if let Some(v) = version {
        args.push("--version".into());
        args.push(v.into());
    }

    if let Some(vals) = values {
        for (k, v) in vals.as_object().into_iter().flatten() {
            args.push("--set".into());
            args.push(format!("{k}={v}"));
        }
    }

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    helm(&args_ref, Some(context_name)).await
}

pub async fn upgrade_release(
    context_name: &str,
    name: &str,
    chart: Option<&str>,
    namespace: &str,
    values_yaml: Option<&str>,
    version: Option<&str>,
) -> Result<String> {
    let chart_ref = if let Some(c) = chart {
        c.to_string()
    } else {
        resolve_chart_ref(context_name, name, namespace).await?.0
    };

    let tmp_file = if let Some(yaml) = values_yaml {
        let f = tempfile::NamedTempFile::with_suffix(".yaml")?;
        std::fs::write(f.path(), yaml)?;
        Some(f)
    } else {
        None
    };

    let mut args: Vec<String> = vec![
        "upgrade".into(),
        name.into(),
        chart_ref,
        "--namespace".into(),
        namespace.into(),
        "--atomic".into(),
        "--output".into(),
        "json".into(),
    ];

    if let Some(v) = version {
        args.push("--version".into());
        args.push(v.into());
    }

    if let Some(ref f) = tmp_file {
        args.push("--values".into());
        args.push(f.path().to_string_lossy().to_string());
    }

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    helm(&args_ref, Some(context_name)).await
}

pub async fn template_release(
    context_name: &str,
    name: &str,
    namespace: &str,
    values_yaml: Option<&str>,
) -> Result<String> {
    let (chart_ref, version) = resolve_chart_ref(context_name, name, namespace).await?;

    let tmp_file = if let Some(yaml) = values_yaml {
        let f = tempfile::NamedTempFile::with_suffix(".yaml")?;
        std::fs::write(f.path(), yaml)?;
        Some(f)
    } else {
        None
    };

    let mut args: Vec<String> = vec![
        "template".into(),
        name.into(),
        chart_ref,
        "--namespace".into(),
        namespace.into(),
        "--version".into(),
        version,
    ];

    if let Some(ref f) = tmp_file {
        args.push("--values".into());
        args.push(f.path().to_string_lossy().to_string());
    }

    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();
    helm(&args_ref, Some(context_name)).await
}

pub async fn uninstall_release(context_name: &str, name: &str, namespace: &str) -> Result<String> {
    helm(&["uninstall", name, "--namespace", namespace], Some(context_name)).await
}

pub async fn rollback_release(
    context_name: &str,
    name: &str,
    namespace: &str,
    revision: u32,
) -> Result<String> {
    let rev = revision.to_string();
    helm(&["rollback", name, &rev, "--namespace", namespace], Some(context_name)).await
}

async fn resolve_chart_ref(
    context_name: &str,
    name: &str,
    namespace: &str,
) -> Result<(String, String)> {
    let list_out = helm(
        &["list", "--filter", &format!("^{name}$"), "--namespace", namespace, "--output", "json"],
        Some(context_name),
    )
    .await?;

    let releases: serde_json::Value =
        serde_json::from_str(&list_out).unwrap_or(serde_json::Value::Array(vec![]));
    let chart = releases[0]["chart"]
        .as_str()
        .ok_or_else(|| anyhow!("Release '{name}' not found"))?;

    // chart is like "nginx-1.2.3" — split at last '-'
    let (chart_name, chart_version) = chart
        .rsplit_once('-')
        .ok_or_else(|| anyhow!("Cannot parse chart name from '{chart}'"))?;

    // Search repos for full reference
    let search_out = helm(
        &["search", "repo", chart_name, "--output", "json"],
        Some(context_name),
    )
    .await
    .unwrap_or_default();

    let results: serde_json::Value =
        serde_json::from_str(&search_out).unwrap_or(serde_json::Value::Array(vec![]));

    if let Some(arr) = results.as_array() {
        if let Some(found) = arr.iter().find(|r| {
            r["name"]
                .as_str()
                .map(|n| n == chart_name || n.ends_with(&format!("/{chart_name}")))
                .unwrap_or(false)
        }) {
            let full_name = found["name"].as_str().unwrap_or(chart_name).to_string();
            let version = found["version"].as_str().unwrap_or(chart_version).to_string();
            return Ok((full_name, version));
        }
    }

    Err(anyhow!(
        "Chart '{chart_name}' not found in any Helm repo. Run 'helm repo add' first."
    ))
}
