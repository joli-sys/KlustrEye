import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Providers } from "@/components/providers";
import { Footer } from "@/components/footer";

// Pages
import HomePage from "@/app/page";
import ClusterLayout from "@/app/clusters/[contextName]/layout";
import OverviewPage from "@/app/clusters/[contextName]/overview/page";
import EventsPage from "@/app/clusters/[contextName]/events/page";
import CrdsPage from "@/app/clusters/[contextName]/crds/page";
import CrdResourcesPage from "@/app/clusters/[contextName]/crds/[group]/[version]/[plural]/page";
import CrdResourceDetailPage from "@/app/clusters/[contextName]/crds/[group]/[version]/[plural]/[name]/page";
import HelmPage from "@/app/clusters/[contextName]/helm/page";
import HelmReleasePage from "@/app/clusters/[contextName]/helm/[name]/page";
import SettingsPage from "@/app/clusters/[contextName]/settings/page";
import NodesPage from "@/app/clusters/[contextName]/nodes/page";
import NodeDetailPage from "@/app/clusters/[contextName]/nodes/[name]/page";
import PodsPage from "@/app/clusters/[contextName]/workloads/pods/page";
import PodDetailPage from "@/app/clusters/[contextName]/workloads/pods/[name]/page";
import DeploymentsPage from "@/app/clusters/[contextName]/workloads/deployments/page";
import DeploymentDetailPage from "@/app/clusters/[contextName]/workloads/deployments/[name]/page";
import StatefulSetsPage from "@/app/clusters/[contextName]/workloads/statefulsets/page";
import StatefulSetDetailPage from "@/app/clusters/[contextName]/workloads/statefulsets/[name]/page";
import DaemonSetsPage from "@/app/clusters/[contextName]/workloads/daemonsets/page";
import DaemonSetDetailPage from "@/app/clusters/[contextName]/workloads/daemonsets/[name]/page";
import ReplicaSetsPage from "@/app/clusters/[contextName]/workloads/replicasets/page";
import ReplicaSetDetailPage from "@/app/clusters/[contextName]/workloads/replicasets/[name]/page";
import JobsPage from "@/app/clusters/[contextName]/workloads/jobs/page";
import JobDetailPage from "@/app/clusters/[contextName]/workloads/jobs/[name]/page";
import CronJobsPage from "@/app/clusters/[contextName]/workloads/cronjobs/page";
import CronJobDetailPage from "@/app/clusters/[contextName]/workloads/cronjobs/[name]/page";
import HpaPage from "@/app/clusters/[contextName]/workloads/hpa/page";
import HpaDetailPage from "@/app/clusters/[contextName]/workloads/hpa/[name]/page";
import VpaPage from "@/app/clusters/[contextName]/workloads/vpa/page";
import VpaDetailPage from "@/app/clusters/[contextName]/workloads/vpa/[name]/page";
import PdbPage from "@/app/clusters/[contextName]/workloads/poddisruptionbudgets/page";
import PdbDetailPage from "@/app/clusters/[contextName]/workloads/poddisruptionbudgets/[name]/page";
import ServicesPage from "@/app/clusters/[contextName]/network/services/page";
import ServiceDetailPage from "@/app/clusters/[contextName]/network/services/[name]/page";
import IngressesPage from "@/app/clusters/[contextName]/network/ingresses/page";
import IngressDetailPage from "@/app/clusters/[contextName]/network/ingresses/[name]/page";
import PortForwardsPage from "@/app/clusters/[contextName]/network/port-forwards/page";
import NetworkMapPage from "@/app/clusters/[contextName]/network/map/page";
import ConfigMapsPage from "@/app/clusters/[contextName]/config/configmaps/page";
import ConfigMapDetailPage from "@/app/clusters/[contextName]/config/configmaps/[name]/page";
import SecretsPage from "@/app/clusters/[contextName]/config/secrets/page";
import SecretDetailPage from "@/app/clusters/[contextName]/config/secrets/[name]/page";
import ServiceAccountsPage from "@/app/clusters/[contextName]/config/serviceaccounts/page";
import ServiceAccountDetailPage from "@/app/clusters/[contextName]/config/serviceaccounts/[name]/page";
import PvcsPage from "@/app/clusters/[contextName]/storage/persistentvolumeclaims/page";
import PvcDetailPage from "@/app/clusters/[contextName]/storage/persistentvolumeclaims/[name]/page";
import RolesPage from "@/app/clusters/[contextName]/access/roles/page";
import RoleDetailPage from "@/app/clusters/[contextName]/access/roles/[name]/page";
import ClusterRolesPage from "@/app/clusters/[contextName]/access/clusterroles/page";
import ClusterRoleDetailPage from "@/app/clusters/[contextName]/access/clusterroles/[name]/page";
import RoleBindingsPage from "@/app/clusters/[contextName]/access/rolebindings/page";
import RoleBindingDetailPage from "@/app/clusters/[contextName]/access/rolebindings/[name]/page";
import ClusterRoleBindingsPage from "@/app/clusters/[contextName]/access/clusterrolebindings/page";
import ClusterRoleBindingDetailPage from "@/app/clusters/[contextName]/access/clusterrolebindings/[name]/page";
import PluginPage from "@/app/clusters/[contextName]/plugins/[pluginId]/page";

export default function App() {
  return (
    <BrowserRouter>
      <Providers>
        <div className="flex flex-col min-h-screen">
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/clusters/:contextName" element={<ClusterLayout />}>
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<OverviewPage />} />
                <Route path="events" element={<EventsPage />} />
                <Route path="crds" element={<CrdsPage />} />
                <Route path="crds/:group/:version/:plural" element={<CrdResourcesPage />} />
                <Route path="crds/:group/:version/:plural/:name" element={<CrdResourceDetailPage />} />
                <Route path="helm" element={<HelmPage />} />
                <Route path="helm/:name" element={<HelmReleasePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="nodes" element={<NodesPage />} />
                <Route path="nodes/:name" element={<NodeDetailPage />} />
                <Route path="workloads/pods" element={<PodsPage />} />
                <Route path="workloads/pods/:name" element={<PodDetailPage />} />
                <Route path="workloads/deployments" element={<DeploymentsPage />} />
                <Route path="workloads/deployments/:name" element={<DeploymentDetailPage />} />
                <Route path="workloads/statefulsets" element={<StatefulSetsPage />} />
                <Route path="workloads/statefulsets/:name" element={<StatefulSetDetailPage />} />
                <Route path="workloads/daemonsets" element={<DaemonSetsPage />} />
                <Route path="workloads/daemonsets/:name" element={<DaemonSetDetailPage />} />
                <Route path="workloads/replicasets" element={<ReplicaSetsPage />} />
                <Route path="workloads/replicasets/:name" element={<ReplicaSetDetailPage />} />
                <Route path="workloads/jobs" element={<JobsPage />} />
                <Route path="workloads/jobs/:name" element={<JobDetailPage />} />
                <Route path="workloads/cronjobs" element={<CronJobsPage />} />
                <Route path="workloads/cronjobs/:name" element={<CronJobDetailPage />} />
                <Route path="workloads/hpa" element={<HpaPage />} />
                <Route path="workloads/hpa/:name" element={<HpaDetailPage />} />
                <Route path="workloads/vpa" element={<VpaPage />} />
                <Route path="workloads/vpa/:name" element={<VpaDetailPage />} />
                <Route path="workloads/poddisruptionbudgets" element={<PdbPage />} />
                <Route path="workloads/poddisruptionbudgets/:name" element={<PdbDetailPage />} />
                <Route path="network/services" element={<ServicesPage />} />
                <Route path="network/services/:name" element={<ServiceDetailPage />} />
                <Route path="network/ingresses" element={<IngressesPage />} />
                <Route path="network/ingresses/:name" element={<IngressDetailPage />} />
                <Route path="network/port-forwards" element={<PortForwardsPage />} />
                <Route path="network/map" element={<NetworkMapPage />} />
                <Route path="config/configmaps" element={<ConfigMapsPage />} />
                <Route path="config/configmaps/:name" element={<ConfigMapDetailPage />} />
                <Route path="config/secrets" element={<SecretsPage />} />
                <Route path="config/secrets/:name" element={<SecretDetailPage />} />
                <Route path="config/serviceaccounts" element={<ServiceAccountsPage />} />
                <Route path="config/serviceaccounts/:name" element={<ServiceAccountDetailPage />} />
                <Route path="storage/persistentvolumeclaims" element={<PvcsPage />} />
                <Route path="storage/persistentvolumeclaims/:name" element={<PvcDetailPage />} />
                <Route path="access/roles" element={<RolesPage />} />
                <Route path="access/roles/:name" element={<RoleDetailPage />} />
                <Route path="access/clusterroles" element={<ClusterRolesPage />} />
                <Route path="access/clusterroles/:name" element={<ClusterRoleDetailPage />} />
                <Route path="access/rolebindings" element={<RoleBindingsPage />} />
                <Route path="access/rolebindings/:name" element={<RoleBindingDetailPage />} />
                <Route path="access/clusterrolebindings" element={<ClusterRoleBindingsPage />} />
                <Route path="access/clusterrolebindings/:name" element={<ClusterRoleBindingDetailPage />} />
                <Route path="plugins/:pluginId" element={<PluginPage />} />
              </Route>
            </Routes>
          </div>
          <Footer />
        </div>
      </Providers>
    </BrowserRouter>
  );
}
