use anyhow::{anyhow, Result};
use kube::{
    api::{Api, ApiResource, DynamicObject, ListParams, ObjectList, Patch, PatchParams,
          PostParams, DeleteParams},
    Client,
};
use serde_json::Value;

pub struct ResourceInfo {
    pub plural: &'static str,
    pub kind: &'static str,
    pub api_group: &'static str,
    pub version: &'static str,
    pub namespaced: bool,
}

pub fn lookup_resource(kind: &str) -> Option<&'static ResourceInfo> {
    RESOURCE_REGISTRY.iter().find(|r| r.plural == kind)
}

pub static RESOURCE_REGISTRY: &[ResourceInfo] = &[
    ResourceInfo { plural: "pods", kind: "Pod", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "deployments", kind: "Deployment", api_group: "apps", version: "v1", namespaced: true },
    ResourceInfo { plural: "statefulsets", kind: "StatefulSet", api_group: "apps", version: "v1", namespaced: true },
    ResourceInfo { plural: "daemonsets", kind: "DaemonSet", api_group: "apps", version: "v1", namespaced: true },
    ResourceInfo { plural: "replicasets", kind: "ReplicaSet", api_group: "apps", version: "v1", namespaced: true },
    ResourceInfo { plural: "jobs", kind: "Job", api_group: "batch", version: "v1", namespaced: true },
    ResourceInfo { plural: "cronjobs", kind: "CronJob", api_group: "batch", version: "v1", namespaced: true },
    ResourceInfo { plural: "services", kind: "Service", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "ingresses", kind: "Ingress", api_group: "networking.k8s.io", version: "v1", namespaced: true },
    ResourceInfo { plural: "configmaps", kind: "ConfigMap", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "secrets", kind: "Secret", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "persistentvolumeclaims", kind: "PersistentVolumeClaim", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "serviceaccounts", kind: "ServiceAccount", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "nodes", kind: "Node", api_group: "", version: "v1", namespaced: false },
    ResourceInfo { plural: "namespaces", kind: "Namespace", api_group: "", version: "v1", namespaced: false },
    ResourceInfo { plural: "poddisruptionbudgets", kind: "PodDisruptionBudget", api_group: "policy", version: "v1", namespaced: true },
    ResourceInfo { plural: "horizontalpodautoscalers", kind: "HorizontalPodAutoscaler", api_group: "autoscaling", version: "v2", namespaced: true },
    ResourceInfo { plural: "events", kind: "Event", api_group: "", version: "v1", namespaced: true },
    ResourceInfo { plural: "roles", kind: "Role", api_group: "rbac.authorization.k8s.io", version: "v1", namespaced: true },
    ResourceInfo { plural: "clusterroles", kind: "ClusterRole", api_group: "rbac.authorization.k8s.io", version: "v1", namespaced: false },
    ResourceInfo { plural: "rolebindings", kind: "RoleBinding", api_group: "rbac.authorization.k8s.io", version: "v1", namespaced: true },
    ResourceInfo { plural: "clusterrolebindings", kind: "ClusterRoleBinding", api_group: "rbac.authorization.k8s.io", version: "v1", namespaced: false },
    ResourceInfo { plural: "persistentvolumes", kind: "PersistentVolume", api_group: "", version: "v1", namespaced: false },
    ResourceInfo { plural: "storageclasses", kind: "StorageClass", api_group: "storage.k8s.io", version: "v1", namespaced: false },
    ResourceInfo { plural: "customresourcedefinitions", kind: "CustomResourceDefinition", api_group: "apiextensions.k8s.io", version: "v1", namespaced: false },
];

fn make_api_resource(info: &ResourceInfo) -> ApiResource {
    let api_version = if info.api_group.is_empty() {
        info.version.to_string()
    } else {
        format!("{}/{}", info.api_group, info.version)
    };
    ApiResource {
        group: info.api_group.to_string(),
        version: info.version.to_string(),
        api_version,
        kind: info.kind.to_string(),
        plural: info.plural.to_string(),
    }
}

fn get_api(client: Client, info: &ResourceInfo, namespace: Option<&str>) -> Api<DynamicObject> {
    let ar = make_api_resource(info);
    if info.namespaced {
        match namespace {
            Some(ns) => Api::namespaced_with(client, ns, &ar),
            None => Api::all_with(client, &ar),
        }
    } else {
        Api::all_with(client, &ar)
    }
}

pub async fn list_resources(
    client: Client,
    kind: &str,
    namespace: Option<&str>,
) -> Result<ObjectList<DynamicObject>> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace);
    Ok(api.list(&ListParams::default()).await?)
}

pub async fn get_resource(
    client: Client,
    kind: &str,
    name: &str,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace.or(Some("default")));
    Ok(api.get(name).await?)
}

pub async fn create_resource(
    client: Client,
    kind: &str,
    body: Value,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace.or(Some("default")));
    let obj: DynamicObject = serde_json::from_value(body)?;
    Ok(api.create(&PostParams::default(), &obj).await?)
}

pub async fn update_resource(
    client: Client,
    kind: &str,
    name: &str,
    body: Value,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace.or(Some("default")));
    let mut obj: DynamicObject = serde_json::from_value(body)?;
    obj.metadata.name = Some(name.to_string());
    Ok(api.replace(name, &PostParams::default(), &obj).await?)
}

pub async fn delete_resource(
    client: Client,
    kind: &str,
    name: &str,
    namespace: Option<&str>,
) -> Result<()> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace.or(Some("default")));
    api.delete(name, &DeleteParams::default()).await?;
    Ok(())
}

pub async fn patch_resource(
    client: Client,
    kind: &str,
    name: &str,
    patch: Value,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let info = lookup_resource(kind).ok_or_else(|| anyhow!("Unknown resource kind: {kind}"))?;
    let api = get_api(client, info, namespace.or(Some("default")));
    let params = PatchParams::apply("klustreye").force();
    Ok(api.patch(name, &params, &Patch::Merge(patch)).await?)
}

pub async fn list_custom_resources(
    client: Client,
    group: &str,
    version: &str,
    plural: &str,
    namespace: Option<&str>,
) -> Result<ObjectList<DynamicObject>> {
    let ar = ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version: format!("{group}/{version}"),
        kind: plural.to_string(),
        plural: plural.to_string(),
    };
    let api: Api<DynamicObject> = match namespace {
        Some(ns) => Api::namespaced_with(client, ns, &ar),
        None => Api::all_with(client, &ar),
    };
    Ok(api.list(&ListParams::default()).await?)
}

pub async fn get_custom_resource(
    client: Client,
    group: &str,
    version: &str,
    plural: &str,
    name: &str,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let ar = ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version: format!("{group}/{version}"),
        kind: plural.to_string(),
        plural: plural.to_string(),
    };
    let api: Api<DynamicObject> = match namespace {
        Some(ns) => Api::namespaced_with(client, ns, &ar),
        None => Api::all_with(client, &ar),
    };
    Ok(api.get(name).await?)
}

pub async fn update_custom_resource(
    client: Client,
    group: &str,
    version: &str,
    plural: &str,
    name: &str,
    body: Value,
    namespace: Option<&str>,
) -> Result<DynamicObject> {
    let ar = ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version: format!("{group}/{version}"),
        kind: plural.to_string(),
        plural: plural.to_string(),
    };
    let api: Api<DynamicObject> = match namespace {
        Some(ns) => Api::namespaced_with(client, ns, &ar),
        None => Api::all_with(client, &ar),
    };
    let mut obj: DynamicObject = serde_json::from_value(body)?;
    obj.metadata.name = Some(name.to_string());
    Ok(api.replace(name, &PostParams::default(), &obj).await?)
}

pub async fn delete_custom_resource(
    client: Client,
    group: &str,
    version: &str,
    plural: &str,
    name: &str,
    namespace: Option<&str>,
) -> Result<()> {
    let ar = ApiResource {
        group: group.to_string(),
        version: version.to_string(),
        api_version: format!("{group}/{version}"),
        kind: plural.to_string(),
        plural: plural.to_string(),
    };
    let api: Api<DynamicObject> = match namespace {
        Some(ns) => Api::namespaced_with(client, ns, &ar),
        None => Api::all_with(client, &ar),
    };
    api.delete(name, &DeleteParams::default()).await?;
    Ok(())
}
