pub fn detect_cloud_provider(server_url: &str, version: Option<&str>) -> String {
    let url = server_url.to_lowercase();

    if url.contains(".eks.amazonaws.com") || url.contains(".elb.amazonaws.com") {
        return "eks".to_string();
    }
    if url.contains(".azmk8s.io") || url.contains("azure") {
        return "aks".to_string();
    }
    if url.contains(".gke.io") || url.contains("gke") {
        return "gke".to_string();
    }

    if let Some(v) = version {
        let v = v.to_lowercase();
        if v.contains("eks") {
            return "eks".to_string();
        }
        if v.contains("gke") {
            return "gke".to_string();
        }
        if v.contains("aks") {
            return "aks".to_string();
        }
    }

    "kubernetes".to_string()
}
