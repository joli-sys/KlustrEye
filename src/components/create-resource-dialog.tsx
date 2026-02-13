"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { YamlEditor } from "@/components/yaml-editor";
import { useCreateResource } from "@/hooks/use-resources";
import { useToast } from "@/components/ui/toast";
import type { ResourceKind } from "@/lib/constants";
import { RESOURCE_REGISTRY } from "@/lib/constants";
import { parse } from "yaml";

const DEFAULT_TEMPLATES: Partial<Record<ResourceKind, string>> = {
  pods: `apiVersion: v1
kind: Pod
metadata:
  name: my-pod
  namespace: default
spec:
  containers:
    - name: main
      image: nginx:latest
      ports:
        - containerPort: 80`,
  deployments: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-deployment
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80`,
  services: `apiVersion: v1
kind: Service
metadata:
  name: my-service
  namespace: default
spec:
  selector:
    app: my-app
  ports:
    - port: 80
      targetPort: 80
  type: ClusterIP`,
  configmaps: `apiVersion: v1
kind: ConfigMap
metadata:
  name: my-config
  namespace: default
data:
  key: value`,
  statefulsets: `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: my-statefulset
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: my-app
  serviceName: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: main
          image: nginx:latest
          ports:
            - containerPort: 80`,
  daemonsets: `apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: my-daemonset
  namespace: default
spec:
  selector:
    matchLabels:
      app: my-app
  template:
    metadata:
      labels:
        app: my-app
    spec:
      containers:
        - name: main
          image: nginx:latest`,
  jobs: `apiVersion: batch/v1
kind: Job
metadata:
  name: my-job
  namespace: default
spec:
  template:
    spec:
      containers:
        - name: main
          image: busybox
          command: ["echo", "Hello"]
      restartPolicy: Never
  backoffLimit: 4`,
  cronjobs: `apiVersion: batch/v1
kind: CronJob
metadata:
  name: my-cronjob
  namespace: default
spec:
  schedule: "*/5 * * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: main
              image: busybox
              command: ["echo", "Hello"]
          restartPolicy: Never`,
  ingresses: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: my-ingress
  namespace: default
spec:
  rules:
    - host: example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: my-service
                port:
                  number: 80`,
  secrets: `apiVersion: v1
kind: Secret
metadata:
  name: my-secret
  namespace: default
type: Opaque
stringData:
  key: value`,
  persistentvolumeclaims: `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-pvc
  namespace: default
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi`,
};

interface CreateResourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  kind: ResourceKind;
  namespace?: string;
}

export function CreateResourceDialog({
  open,
  onOpenChange,
  contextName,
  kind,
  namespace,
}: CreateResourceDialogProps) {
  const entry = RESOURCE_REGISTRY[kind];
  const [yaml, setYaml] = useState(DEFAULT_TEMPLATES[kind] || `apiVersion: ${entry.apiVersion}\nkind: ${entry.kind}\nmetadata:\n  name: my-resource\n  namespace: ${namespace || "default"}`);
  const createMutation = useCreateResource(contextName, kind);
  const { addToast } = useToast();

  const handleCreate = async () => {
    try {
      const body = parse(yaml);
      const ns = body.metadata?.namespace || namespace;
      await createMutation.mutateAsync({ body, namespace: ns });
      addToast({ title: `${entry.label} created`, variant: "success" });
      onOpenChange(false);
    } catch (err) {
      addToast({ title: "Create failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Create {entry.label}</DialogTitle>
        </DialogHeader>
        <div className="border rounded-md overflow-hidden">
          <YamlEditor value={yaml} onChange={setYaml} height="400px" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
