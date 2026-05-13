use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthIssue {
    pub severity: String,
    pub kind: String,
    pub name: String,
    pub namespace: Option<String>,
    pub reason: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthSummary {
    pub critical_count: usize,
    pub warning_count: usize,
    pub issues: Vec<HealthIssue>,
}

pub fn summarize_health(pods: &[Value], deployments: &[Value], events: &[Value]) -> HealthSummary {
    let mut issues = Vec::new();

    for pod in pods {
        collect_pod_issues(pod, &mut issues);
    }

    for deployment in deployments {
        collect_deployment_issues(deployment, &mut issues);
    }

    for event in events {
        collect_warning_event_issue(event, &mut issues);
    }

    issues.sort_by_key(|issue| match issue.severity.as_str() {
        "critical" => 0,
        _ => 1,
    });
    issues.truncate(25);

    let critical_count = issues
        .iter()
        .filter(|issue| issue.severity == "critical")
        .count();
    let warning_count = issues
        .iter()
        .filter(|issue| issue.severity == "warning")
        .count();

    HealthSummary {
        critical_count,
        warning_count,
        issues,
    }
}

fn collect_pod_issues(pod: &Value, issues: &mut Vec<HealthIssue>) {
    let name = string_at(pod, &["metadata", "name"]).unwrap_or("<unknown>");
    let namespace = string_at(pod, &["metadata", "namespace"]).map(str::to_string);
    let phase = string_at(pod, &["status", "phase"]).unwrap_or("");

    if matches!(phase, "Failed" | "Unknown") {
        issues.push(HealthIssue {
            severity: "critical".to_string(),
            kind: "Pod".to_string(),
            name: name.to_string(),
            namespace: namespace.clone(),
            reason: phase.to_string(),
            message: format!("Pod is in {phase} phase"),
        });
    } else if phase == "Pending" {
        issues.push(HealthIssue {
            severity: "warning".to_string(),
            kind: "Pod".to_string(),
            name: name.to_string(),
            namespace: namespace.clone(),
            reason: "Pending".to_string(),
            message: "Pod is still pending".to_string(),
        });
    }

    if let Some(statuses) = pod
        .pointer("/status/containerStatuses")
        .and_then(Value::as_array)
    {
        for status in statuses {
            let container_name = string_at(status, &["name"]).unwrap_or("container");
            let reason = string_at(status, &["state", "waiting", "reason"]);
            let Some(reason) = reason else { continue };
            let severity = match reason {
                "CrashLoopBackOff"
                | "ImagePullBackOff"
                | "ErrImagePull"
                | "CreateContainerConfigError"
                | "CreateContainerError"
                | "RunContainerError" => "critical",
                _ => "warning",
            };
            let waiting_message = string_at(status, &["state", "waiting", "message"])
                .unwrap_or("container is waiting");
            issues.push(HealthIssue {
                severity: severity.to_string(),
                kind: "Pod".to_string(),
                name: name.to_string(),
                namespace: namespace.clone(),
                reason: reason.to_string(),
                message: format!("Container {container_name}: {waiting_message}"),
            });
        }
    }
}

fn collect_deployment_issues(deployment: &Value, issues: &mut Vec<HealthIssue>) {
    let name = string_at(deployment, &["metadata", "name"]).unwrap_or("<unknown>");
    let namespace = string_at(deployment, &["metadata", "namespace"]).map(str::to_string);
    let desired = u64_at(deployment, &["spec", "replicas"]).unwrap_or(1);
    let available = u64_at(deployment, &["status", "availableReplicas"]).unwrap_or(0);
    let ready = u64_at(deployment, &["status", "readyReplicas"]).unwrap_or(0);
    let updated = u64_at(deployment, &["status", "updatedReplicas"]).unwrap_or(0);
    let observed_generation = u64_at(deployment, &["status", "observedGeneration"]).unwrap_or(0);
    let generation = u64_at(deployment, &["metadata", "generation"]).unwrap_or(0);

    if generation > observed_generation {
        issues.push(HealthIssue {
            severity: "warning".to_string(),
            kind: "Deployment".to_string(),
            name: name.to_string(),
            namespace: namespace.clone(),
            reason: "RolloutPending".to_string(),
            message: format!(
                "Controller has not observed the latest generation ({observed_generation}/{generation})"
            ),
        });
    }

    if desired > 0 && (available < desired || ready < desired || updated < desired) {
        issues.push(HealthIssue {
            severity: "warning".to_string(),
            kind: "Deployment".to_string(),
            name: name.to_string(),
            namespace: namespace.clone(),
            reason: "UnavailableReplicas".to_string(),
            message: format!("Deployment availability is {available}/{desired}; ready {ready}/{desired}; updated {updated}/{desired}"),
        });
    }

    if let Some(conditions) = deployment
        .pointer("/status/conditions")
        .and_then(Value::as_array)
    {
        for condition in conditions {
            let cond_type = string_at(condition, &["type"]).unwrap_or("");
            let cond_status = string_at(condition, &["status"]).unwrap_or("");
            let reason = string_at(condition, &["reason"]).unwrap_or(cond_type);
            if cond_type == "Progressing" && cond_status == "False" {
                let message =
                    string_at(condition, &["message"]).unwrap_or("Deployment is not progressing");
                issues.push(HealthIssue {
                    severity: "critical".to_string(),
                    kind: "Deployment".to_string(),
                    name: name.to_string(),
                    namespace: namespace.clone(),
                    reason: reason.to_string(),
                    message: message.to_string(),
                });
            }
        }
    }
}

fn collect_warning_event_issue(event: &Value, issues: &mut Vec<HealthIssue>) {
    if string_at(event, &["type"]) != Some("Warning") {
        return;
    }

    let kind = string_at(event, &["involvedObject", "kind"]).unwrap_or("Event");
    let name = string_at(event, &["involvedObject", "name"])
        .or_else(|| string_at(event, &["metadata", "name"]))
        .unwrap_or("<unknown>");
    let namespace = string_at(event, &["involvedObject", "namespace"])
        .or_else(|| string_at(event, &["metadata", "namespace"]))
        .map(str::to_string);
    let reason = string_at(event, &["reason"]).unwrap_or("Warning");
    let message = string_at(event, &["message"]).unwrap_or("Kubernetes warning event");

    issues.push(HealthIssue {
        severity: "warning".to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        namespace,
        reason: reason.to_string(),
        message: message.to_string(),
    });
}

fn string_at<'a>(value: &'a Value, path: &[&str]) -> Option<&'a str> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_str()
}

fn u64_at(value: &Value, path: &[&str]) -> Option<u64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current.as_u64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reports_crashlooping_pod_container_as_critical() {
        let pods = vec![json!({
            "metadata": {"name": "api-123", "namespace": "prod"},
            "status": {
                "phase": "Running",
                "containerStatuses": [{
                    "name": "api",
                    "state": {"waiting": {"reason": "CrashLoopBackOff", "message": "back-off restarting failed container"}}
                }]
            }
        })];

        let summary = summarize_health(&pods, &[], &[]);

        assert_eq!(summary.critical_count, 1);
        assert_eq!(summary.warning_count, 0);
        assert_eq!(summary.issues[0].kind, "Pod");
        assert_eq!(summary.issues[0].name, "api-123");
        assert_eq!(summary.issues[0].namespace.as_deref(), Some("prod"));
        assert_eq!(summary.issues[0].reason, "CrashLoopBackOff");
        assert!(summary.issues[0].message.contains("api"));
    }

    #[test]
    fn reports_unavailable_deployment_as_warning() {
        let deployments = vec![json!({
            "metadata": {"name": "web", "namespace": "prod", "generation": 7},
            "spec": {"replicas": 4},
            "status": {"replicas": 4, "readyReplicas": 2, "availableReplicas": 2, "updatedReplicas": 3, "observedGeneration": 7}
        })];

        let summary = summarize_health(&[], &deployments, &[]);

        assert_eq!(summary.critical_count, 0);
        assert_eq!(summary.warning_count, 1);
        assert_eq!(summary.issues[0].kind, "Deployment");
        assert_eq!(summary.issues[0].reason, "UnavailableReplicas");
        assert!(summary.issues[0].message.contains("2/4"));
    }

    #[test]
    fn reports_recent_warning_events_without_duplicate_normal_events() {
        let events = vec![
            json!({
                "type": "Warning",
                "reason": "FailedScheduling",
                "message": "0/3 nodes are available",
                "involvedObject": {"kind": "Pod", "name": "worker", "namespace": "batch"}
            }),
            json!({
                "type": "Normal",
                "reason": "Scheduled",
                "message": "Successfully assigned",
                "involvedObject": {"kind": "Pod", "name": "worker", "namespace": "batch"}
            }),
        ];

        let summary = summarize_health(&[], &[], &events);

        assert_eq!(summary.critical_count, 0);
        assert_eq!(summary.warning_count, 1);
        assert_eq!(summary.issues[0].kind, "Pod");
        assert_eq!(summary.issues[0].reason, "FailedScheduling");
    }

    #[test]
    fn returns_clean_summary_when_everything_is_healthy() {
        let pods = vec![json!({
            "metadata": {"name": "api-123", "namespace": "prod"},
            "status": {"phase": "Running", "containerStatuses": [{"name": "api", "ready": true}]}
        })];
        let deployments = vec![json!({
            "metadata": {"name": "web", "namespace": "prod", "generation": 2},
            "spec": {"replicas": 3},
            "status": {"replicas": 3, "readyReplicas": 3, "availableReplicas": 3, "updatedReplicas": 3, "observedGeneration": 2}
        })];

        let summary = summarize_health(&pods, &deployments, &[]);

        assert_eq!(summary.critical_count, 0);
        assert_eq!(summary.warning_count, 0);
        assert!(summary.issues.is_empty());
    }
}
