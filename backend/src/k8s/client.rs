use anyhow::{Context, Result};
use dashmap::DashMap;
use kube::{Client, Config};
use kube::config::{KubeConfigOptions, Kubeconfig};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::provider::detect_cloud_provider;

pub type KubeconfigPath = Arc<RwLock<Option<String>>>;

pub struct KubeClientCache {
    clients: DashMap<String, Arc<Client>>,
    pub kubeconfig_path: KubeconfigPath,
}

impl KubeClientCache {
    pub fn new() -> Self {
        Self {
            clients: DashMap::new(),
            kubeconfig_path: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn get_client(&self, context_name: &str) -> Result<Arc<Client>> {
        if let Some(client) = self.clients.get(context_name) {
            return Ok(client.clone());
        }

        let path = self.kubeconfig_path.read().await.clone();
        let kubeconfig = load_kubeconfig(path.as_deref())?;

        let options = KubeConfigOptions {
            context: Some(context_name.to_string()),
            ..Default::default()
        };

        let config = Config::from_custom_kubeconfig(kubeconfig, &options)
            .await
            .with_context(|| format!("Failed to build config for context '{context_name}'"))?;

        let client = Arc::new(
            Client::try_from(config)
                .with_context(|| format!("Failed to create client for context '{context_name}'"))?,
        );

        self.clients.insert(context_name.to_string(), client.clone());
        Ok(client)
    }

    pub fn invalidate(&self, context_name: Option<&str>) {
        match context_name {
            Some(ctx) => { self.clients.remove(ctx); }
            None => { self.clients.clear(); }
        }
    }
}

pub fn load_kubeconfig(path: Option<&str>) -> Result<Kubeconfig> {
    if let Some(p) = path {
        Kubeconfig::read_from(p).with_context(|| format!("Failed to read kubeconfig from {p}"))
    } else if let Ok(env_path) = std::env::var("KUBECONFIG_PATH") {
        Kubeconfig::read_from(&env_path)
            .with_context(|| format!("Failed to read kubeconfig from KUBECONFIG_PATH={env_path}"))
    } else {
        Kubeconfig::read().context("Failed to read default kubeconfig")
    }
}

#[derive(Serialize)]
pub struct ClusterContextInfo {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub namespace: String,
    #[serde(rename = "isCurrent")]
    pub is_current: bool,
    pub provider: String,
    #[serde(rename = "cloudProvider")]
    pub cloud_provider: String,
}

pub async fn get_contexts(kubeconfig_path: Option<&str>) -> Result<Vec<ClusterContextInfo>> {
    let kubeconfig = load_kubeconfig(kubeconfig_path)?;
    let current_context = kubeconfig.current_context.clone().unwrap_or_default();

    let infos = kubeconfig
        .contexts
        .iter()
        .map(|named_ctx| {
            let ctx = named_ctx.context.as_ref();
            let cluster_name = ctx.map(|c| c.cluster.clone()).unwrap_or_default();
            let user = ctx.map(|c| c.user.clone()).unwrap_or_default().unwrap_or_default();
            let namespace = ctx
                .and_then(|c| c.namespace.clone())
                .unwrap_or_else(|| "default".to_string());

            let server_url = kubeconfig
                .clusters
                .iter()
                .find(|c| c.name == cluster_name)
                .and_then(|c| c.cluster.as_ref())
                .and_then(|c| c.server.as_deref())
                .unwrap_or("")
                .to_string();

            ClusterContextInfo {
                name: named_ctx.name.clone(),
                cluster: cluster_name,
                user,
                namespace,
                is_current: named_ctx.name == current_context,
                provider: "kubeconfig".to_string(),
                cloud_provider: detect_cloud_provider(&server_url, None),
            }
        })
        .collect();

    Ok(infos)
}

pub async fn test_connection(client: &Client) -> (bool, Option<String>, Option<String>) {
    match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.apiserver_version(),
    )
    .await
    {
        Ok(Ok(info)) => (true, Some(info.git_version), None),
        Ok(Err(e)) => (false, None, Some(e.to_string())),
        Err(_) => (false, None, Some("Connection timed out".to_string())),
    }
}
