export type CloudProvider = "eks" | "gke" | "aks" | "kubernetes";

export const PROVIDER_LABELS: Record<CloudProvider, string> = {
  eks: "Amazon EKS",
  gke: "Google GKE",
  aks: "Azure AKS",
  kubernetes: "Kubernetes",
};

export function detectCloudProvider(serverUrl: string, version?: string): CloudProvider {
  try {
    const hostname = new URL(serverUrl).hostname;
    if (hostname.endsWith(".eks.amazonaws.com")) return "eks";
    if (hostname.endsWith(".azmk8s.io")) return "aks";
    if (hostname.endsWith(".gke.goog") || hostname.includes("container.googleapis.com")) return "gke";
  } catch {
    // invalid URL — fall through
  }
  if (version) {
    if (version.includes("-gke.")) return "gke";
    if (version.includes("-eks-")) return "eks";
  }
  return "kubernetes";
}
