import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { TabBar } from "@/components/tab-bar";
import { ClusterColorProvider } from "@/components/cluster-color-provider";

export default async function ClusterLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ contextName: string }>;
}) {
  const { contextName } = await params;
  const decodedContext = decodeURIComponent(contextName);

  return (
    <ClusterColorProvider contextName={decodedContext}>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar contextName={decodedContext} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <Header contextName={decodedContext} />
          <TabBar contextName={decodedContext} />
          <main className="flex-1 overflow-auto p-4">{children}</main>
        </div>
      </div>
    </ClusterColorProvider>
  );
}
