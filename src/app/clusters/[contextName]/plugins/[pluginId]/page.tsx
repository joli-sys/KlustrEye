import { getPlugin } from "@/lib/plugins/registry";
import { useParams } from "react-router-dom";

export default function PluginPage() {
  const { contextName = "", pluginId = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const plugin = getPlugin(pluginId);

  if (!plugin || !plugin.Page) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Plugin not found: {pluginId}
      </div>
    );
  }

  const PageComponent = plugin.Page;
  return <PageComponent contextName={ctx} />;
}
