import { NetworkMap } from "@/components/network-map/network-map";
import { useParams } from "react-router-dom";

export default function NetworkMapPage() {
  const { contextName = "" } = useParams();
  const ctx = decodeURIComponent(contextName);

  return (
    <div className="h-[calc(100vh-5rem)]">
      <NetworkMap contextName={ctx} />
    </div>
  );
}
