import { useParams, Outlet } from "react-router-dom";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TabBar } from "@/components/tab-bar";
import { ClusterColorProvider } from "@/components/cluster-color-provider";
import { MobileSidebarDrawer } from "@/components/mobile-sidebar-drawer";
import { ClusterShellTerminal } from "@/components/cluster-shell-terminal";

export default function ClusterLayout() {
  const { contextName = "" } = useParams();
  const decodedContext = decodeURIComponent(contextName);

  return (
    <ClusterColorProvider contextName={decodedContext}>
      <div className="flex flex-1 overflow-hidden">
        <div className="hidden md:flex">
          <Sidebar contextName={decodedContext} />
        </div>
        <MobileSidebarDrawer contextName={decodedContext} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header contextName={decodedContext} />
          <TabBar contextName={decodedContext} />
          <main className="flex-1 overflow-auto p-4">
            <Outlet />
          </main>
          <ClusterShellTerminal contextName={decodedContext} />
        </div>
      </div>
    </ClusterColorProvider>
  );
}
