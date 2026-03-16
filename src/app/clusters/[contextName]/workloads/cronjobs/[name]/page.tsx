import { useState } from "react";
import { useSearchParams, useParams } from "react-router-dom";
import { ResourceDetail } from "@/components/resource-detail";
import { TriggerCronJobDialog } from "@/components/trigger-cronjob-dialog";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export default function CronJobDetailPage() {
  const { contextName = "", name = "" } = useParams();
  const ctx = decodeURIComponent(contextName);
  const [searchParams] = useSearchParams();
  const namespace = searchParams.get("ns") || "default";
  const [triggerOpen, setTriggerOpen] = useState(false);

  return (
    <>
      <ResourceDetail
        contextName={ctx}
        kind="cronjobs"
        name={name}
        namespace={namespace}
        headerActions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setTriggerOpen(true)}>
            <Play className="h-3.5 w-3.5" />
            Trigger
          </Button>
        }
      />
      <TriggerCronJobDialog
        open={triggerOpen}
        onOpenChange={setTriggerOpen}
        contextName={ctx}
        name={name}
        namespace={namespace}
      />
    </>
  );
}
