# KlustrEye Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add CronJob trigger, Deployment scale/restart, Ingress routing rules display, Node pods count, and fix URL encoding bug.

**Architecture:** Each feature follows existing patterns - React Query hooks for data fetching, dialog components for user interactions, and the existing PATCH API for mutations. The URL encoding fix requires auditing navigation code.

**Tech Stack:** Next.js 16, React 19, TypeScript, TanStack Query, Tailwind CSS, shadcn/ui, @kubernetes/client-node

---

## Task 1: CronJob Trigger - API Endpoint

**Files:**
- Create: `src/app/api/clusters/[contextName]/cronjobs/[name]/trigger/route.ts`

**Step 1: Create the API route**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { getK8sClient } from "@/lib/k8s/client";
import * as k8s from "@kubernetes/client-node";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contextName: string; name: string }> }
) {
  const { contextName, name } = await params;
  const ctx = decodeURIComponent(contextName);
  const { searchParams } = new URL(request.url);
  const namespace = searchParams.get("namespace") || "default";

  try {
    const { batchApi } = getK8sClient(ctx);

    // Get the CronJob
    const { body: cronJob } = await batchApi.readNamespacedCronJob(name, namespace);

    // Create Job from CronJob template
    const timestamp = Math.floor(Date.now() / 1000);
    const jobName = `${name}-manual-${timestamp}`;

    const job: k8s.V1Job = {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: {
        name: jobName,
        namespace,
        annotations: {
          "cronjob.kubernetes.io/instantiate": "manual",
        },
        ownerReferences: [
          {
            apiVersion: "batch/v1",
            kind: "CronJob",
            name: cronJob.metadata!.name!,
            uid: cronJob.metadata!.uid!,
            controller: true,
          },
        ],
      },
      spec: cronJob.spec!.jobTemplate.spec,
    };

    const { body: created } = await batchApi.createNamespacedJob(namespace, job);
    return NextResponse.json({ success: true, jobName: created.metadata?.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger CronJob";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**Step 2: Test manually**

Run: `curl -X POST "http://localhost:3000/api/clusters/YOUR_CONTEXT/cronjobs/YOUR_CRONJOB/trigger?namespace=default"`
Expected: `{"success":true,"jobName":"your-cronjob-manual-1709654321"}`

**Step 3: Commit**

```bash
git add src/app/api/clusters/\[contextName\]/cronjobs/\[name\]/trigger/route.ts
git commit -m "feat(api): add CronJob trigger endpoint"
```

---

## Task 2: CronJob Trigger - Hook

**Files:**
- Modify: `src/hooks/use-resources.ts`

**Step 1: Add the trigger hook**

Add after `useDeleteResource`:

```typescript
export function useTriggerCronJob(contextName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, namespace }: { name: string; namespace: string }) => {
      const url = `/api/clusters/${encodeURIComponent(contextName)}/cronjobs/${encodeURIComponent(name)}/trigger?namespace=${encodeURIComponent(namespace)}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to trigger CronJob");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources", contextName, "jobs"] });
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/hooks/use-resources.ts
git commit -m "feat(hooks): add useTriggerCronJob hook"
```

---

## Task 3: CronJob Trigger - Dialog Component

**Files:**
- Create: `src/components/trigger-cronjob-dialog.tsx`

**Step 1: Create the dialog**

```typescript
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useTriggerCronJob } from "@/hooks/use-resources";

interface TriggerCronJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  name: string;
  namespace: string;
}

export function TriggerCronJobDialog({
  open,
  onOpenChange,
  contextName,
  name,
  namespace,
}: TriggerCronJobDialogProps) {
  const triggerMutation = useTriggerCronJob(contextName);
  const { addToast } = useToast();

  const handleTrigger = async () => {
    try {
      const result = await triggerMutation.mutateAsync({ name, namespace });
      addToast({
        title: "CronJob triggered",
        description: `Created job: ${result.jobName}`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Trigger failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Trigger CronJob</DialogTitle>
          <DialogDescription>
            This will create a new Job from the CronJob template immediately.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          CronJob: <span className="font-medium">{name}</span>
        </p>
        <p className="text-sm text-muted-foreground">
          Namespace: {namespace}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleTrigger} disabled={triggerMutation.isPending}>
            {triggerMutation.isPending ? "Triggering..." : "Trigger Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/trigger-cronjob-dialog.tsx
git commit -m "feat(ui): add TriggerCronJobDialog component"
```

---

## Task 4: CronJob Trigger - List Page Integration

**Files:**
- Modify: `src/app/clusters/[contextName]/workloads/cronjobs/page.tsx`

**Step 1: Add trigger button to list**

Replace entire file content:

```typescript
"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { TriggerCronJobDialog } from "@/components/trigger-cronjob-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

export default function CronJobsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);
  const [triggerTarget, setTriggerTarget] = useState<{ name: string; namespace: string } | null>(null);

  const columns: ColumnDef<Record<string, unknown>>[] = [
    nameColumn(),
    namespaceColumn(),
    {
      id: "schedule",
      header: "Schedule",
      accessorFn: (row) => (row.spec as Record<string, unknown>)?.schedule,
    },
    {
      id: "suspend",
      header: "Suspend",
      accessorFn: (row) => (row.spec as Record<string, unknown>)?.suspend ? "Yes" : "No",
    },
    {
      id: "active",
      header: "Active",
      accessorFn: (row) => ((row.status as Record<string, unknown>)?.active as unknown[] || []).length,
    },
    {
      id: "lastSchedule",
      header: "Last Schedule",
      accessorFn: (row) => (row.status as Record<string, unknown>)?.lastScheduleTime || "-",
    },
    ageColumn(),
    {
      id: "trigger",
      header: "",
      cell: ({ row }) => {
        const metadata = row.original.metadata as Record<string, unknown>;
        return (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              setTriggerTarget({
                name: metadata.name as string,
                namespace: metadata.namespace as string,
              });
            }}
          >
            <Play className="h-3.5 w-3.5" />
            Trigger
          </Button>
        );
      },
      size: 100,
    },
  ];

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="cronjobs"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="cronjobs"
      />
      {triggerTarget && (
        <TriggerCronJobDialog
          open={!!triggerTarget}
          onOpenChange={(open) => { if (!open) setTriggerTarget(null); }}
          contextName={ctx}
          name={triggerTarget.name}
          namespace={triggerTarget.namespace}
        />
      )}
    </>
  );
}
```

**Step 2: Test in browser**

Navigate to CronJobs list, verify "Trigger" button appears in each row.

**Step 3: Commit**

```bash
git add src/app/clusters/\[contextName\]/workloads/cronjobs/page.tsx
git commit -m "feat(ui): add trigger button to CronJobs list"
```

---

## Task 5: CronJob Trigger - Detail Page Integration

**Files:**
- Modify: `src/app/clusters/[contextName]/workloads/cronjobs/[name]/page.tsx`

**Step 1: Add trigger button to detail**

Replace entire file content:

```typescript
"use client";

import { use, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { TriggerCronJobDialog } from "@/components/trigger-cronjob-dialog";
import { Button } from "@/components/ui/button";
import { Play } from "lucide-react";

export default function CronJobDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
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
```

**Step 2: Update ResourceDetail to support headerActions**

Check if `ResourceDetail` already supports `headerActions` prop. If not, we need to add it.

**Step 3: Commit**

```bash
git add src/app/clusters/\[contextName\]/workloads/cronjobs/\[name\]/page.tsx
git commit -m "feat(ui): add trigger button to CronJob detail page"
```

---

## Task 6: Deployment Restart - Dialog Component

**Files:**
- Create: `src/components/restart-dialog.tsx`

**Step 1: Create the restart dialog**

```typescript
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { usePatchResource } from "@/hooks/use-resources";
import type { ResourceKind } from "@/lib/constants";

interface RestartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contextName: string;
  kind: ResourceKind;
  name: string;
  namespace?: string;
}

export function RestartDialog({
  open,
  onOpenChange,
  contextName,
  kind,
  name,
  namespace,
}: RestartDialogProps) {
  const patchMutation = usePatchResource(contextName, kind);
  const { addToast } = useToast();

  const handleRestart = async () => {
    try {
      await patchMutation.mutateAsync({
        name,
        namespace,
        patch: {
          spec: {
            template: {
              metadata: {
                annotations: {
                  "kubectl.kubernetes.io/restartedAt": new Date().toISOString(),
                },
              },
            },
          },
        },
      });
      addToast({
        title: "Restart initiated",
        description: `${name} is restarting. Pods will be recreated.`,
        variant: "success",
      });
      onOpenChange(false);
    } catch (err) {
      addToast({
        title: "Restart failed",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Restart {name}</DialogTitle>
          <DialogDescription>
            This will trigger a rolling restart. All pods will be recreated gradually.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleRestart} disabled={patchMutation.isPending}>
            {patchMutation.isPending ? "Restarting..." : "Restart"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/restart-dialog.tsx
git commit -m "feat(ui): add RestartDialog component"
```

---

## Task 7: Deployment Scale & Restart - List Page

**Files:**
- Modify: `src/app/clusters/[contextName]/workloads/deployments/page.tsx`

**Step 1: Add visible Scale and Restart buttons**

Replace entire file content:

```typescript
"use client";

import { use, useState } from "react";
import { ResourceListPage } from "@/components/resource-list-page";
import { CreateResourceDialog } from "@/components/create-resource-dialog";
import { ScaleDialog } from "@/components/scale-dialog";
import { RestartDialog } from "@/components/restart-dialog";
import { nameColumn, namespaceColumn, ageColumn } from "@/components/resource-table";
import { Button } from "@/components/ui/button";
import { Scaling, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

export default function DeploymentsPage({ params }: { params: Promise<{ contextName: string }> }) {
  const { contextName } = use(params);
  const ctx = decodeURIComponent(contextName);
  const [createOpen, setCreateOpen] = useState(false);
  const [scaleTarget, setScaleTarget] = useState<{
    name: string;
    namespace: string;
    replicas: number;
  } | null>(null);
  const [restartTarget, setRestartTarget] = useState<{
    name: string;
    namespace: string;
  } | null>(null);

  const columns: ColumnDef<Record<string, unknown>>[] = [
    nameColumn(),
    namespaceColumn(),
    {
      id: "ready",
      header: "Ready",
      accessorFn: (row) => {
        const status = row.status as Record<string, unknown>;
        return `${status?.readyReplicas || 0}/${status?.replicas || 0}`;
      },
    },
    {
      id: "upToDate",
      header: "Up-to-date",
      accessorFn: (row) => (row.status as Record<string, unknown>)?.updatedReplicas || 0,
    },
    {
      id: "available",
      header: "Available",
      accessorFn: (row) => (row.status as Record<string, unknown>)?.availableReplicas || 0,
    },
    ageColumn(),
    {
      id: "actions_custom",
      header: "",
      cell: ({ row }) => {
        const metadata = row.original.metadata as Record<string, unknown>;
        const spec = row.original.spec as Record<string, unknown>;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setScaleTarget({
                  name: metadata.name as string,
                  namespace: metadata.namespace as string,
                  replicas: (spec?.replicas as number) || 0,
                });
              }}
            >
              <Scaling className="h-3.5 w-3.5" />
              Scale
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={(e) => {
                e.stopPropagation();
                setRestartTarget({
                  name: metadata.name as string,
                  namespace: metadata.namespace as string,
                });
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restart
            </Button>
          </div>
        );
      },
      size: 180,
    },
  ];

  return (
    <>
      <ResourceListPage
        contextName={ctx}
        kind="deployments"
        columns={columns}
        onCreate={() => setCreateOpen(true)}
        detailLinkFn={(item) => {
          const metadata = item.metadata as Record<string, unknown>;
          return `/clusters/${encodeURIComponent(ctx)}/workloads/deployments/${metadata.name}?ns=${metadata.namespace}`;
        }}
      />
      <CreateResourceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        contextName={ctx}
        kind="deployments"
      />
      {scaleTarget && (
        <ScaleDialog
          open={!!scaleTarget}
          onOpenChange={(open) => { if (!open) setScaleTarget(null); }}
          contextName={ctx}
          kind="deployments"
          name={scaleTarget.name}
          namespace={scaleTarget.namespace}
          currentReplicas={scaleTarget.replicas}
        />
      )}
      {restartTarget && (
        <RestartDialog
          open={!!restartTarget}
          onOpenChange={(open) => { if (!open) setRestartTarget(null); }}
          contextName={ctx}
          kind="deployments"
          name={restartTarget.name}
          namespace={restartTarget.namespace}
        />
      )}
    </>
  );
}
```

**Step 2: Test in browser**

Navigate to Deployments list, verify "Scale" and "Restart" buttons appear in each row.

**Step 3: Commit**

```bash
git add src/app/clusters/\[contextName\]/workloads/deployments/page.tsx
git commit -m "feat(ui): add visible Scale and Restart buttons to Deployments list"
```

---

## Task 8: Deployment Scale & Restart - Detail Page

**Files:**
- Modify: `src/app/clusters/[contextName]/workloads/deployments/[name]/page.tsx`

**Step 1: Update detail page with restart button**

In the existing file, add import for `RestartDialog` and `RotateCcw`, add state for restart dialog, add Restart button next to Scale in the status card, and add the dialog.

Key changes:
1. Import: `import { RestartDialog } from "@/components/restart-dialog";`
2. Import: Add `RotateCcw` to lucide imports
3. State: `const [restartOpen, setRestartOpen] = useState(false);`
4. In Replicas row, add Restart button next to Scale button
5. Add `<RestartDialog ... />` at the end

**Step 2: Commit**

```bash
git add src/app/clusters/\[contextName\]/workloads/deployments/\[name\]/page.tsx
git commit -m "feat(ui): add Restart button to Deployment detail page"
```

---

## Task 9: Ingress Routing Rules Card

**Files:**
- Modify: `src/app/clusters/[contextName]/network/ingresses/[name]/page.tsx`

**Step 1: Replace with custom detail view**

```typescript
"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceDetail } from "@/components/resource-detail";
import { useResource } from "@/hooks/use-resources";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Lock } from "lucide-react";

interface IngressRule {
  host?: string;
  http?: {
    paths: Array<{
      path: string;
      pathType: string;
      backend: {
        service: {
          name: string;
          port: { number?: number; name?: string };
        };
      };
    }>;
  };
}

interface IngressTLS {
  hosts?: string[];
  secretName?: string;
}

export default function IngressDetailPage({ params }: { params: Promise<{ contextName: string; name: string }> }) {
  const { contextName, name } = use(params);
  const ctx = decodeURIComponent(contextName);
  const searchParams = useSearchParams();
  const namespace = searchParams.get("ns") || "default";

  const { data } = useResource(ctx, "ingresses", name, namespace);

  const spec = (data?.spec as Record<string, unknown>) || {};
  const rules = (spec.rules as IngressRule[]) || [];
  const tls = (spec.tls as IngressTLS[]) || [];

  // Build set of TLS-enabled hosts
  const tlsHosts = new Set<string>();
  for (const t of tls) {
    for (const h of t.hosts || []) {
      tlsHosts.add(h);
    }
  }

  // Flatten rules into rows
  const routingRows: Array<{
    host: string;
    path: string;
    pathType: string;
    service: string;
    port: string;
    hasTls: boolean;
  }> = [];

  for (const rule of rules) {
    const host = rule.host || "*";
    const hasTls = tlsHosts.has(host);
    for (const p of rule.http?.paths || []) {
      routingRows.push({
        host,
        path: p.path || "/",
        pathType: p.pathType || "Prefix",
        service: p.backend.service.name,
        port: String(p.backend.service.port.number || p.backend.service.port.name || ""),
        hasTls,
      });
    }
  }

  return (
    <ResourceDetail contextName={ctx} kind="ingresses" name={name} namespace={namespace}>
      {routingRows.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Routing Rules</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Host</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Path</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Path Type</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Service</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Port</th>
                  </tr>
                </thead>
                <tbody>
                  {routingRows.map((row, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          {row.hasTls && <Lock className="h-3.5 w-3.5 text-green-500" />}
                          <span className="font-mono text-xs">{row.host}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{row.path}</td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="text-xs">{row.pathType}</Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{row.service}</td>
                      <td className="px-3 py-2 font-mono text-xs">{row.port}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </ResourceDetail>
  );
}
```

**Step 2: Test in browser**

Navigate to an Ingress detail, verify "Routing Rules" card appears with table.

**Step 3: Commit**

```bash
git add src/app/clusters/\[contextName\]/network/ingresses/\[name\]/page.tsx
git commit -m "feat(ui): add Routing Rules card to Ingress detail"
```

---

## Task 10: Node Pods Count Column

**Files:**
- Modify: `src/app/clusters/[contextName]/nodes/page.tsx`

**Step 1: Add pods column with DaemonSet/Other split**

Add to imports:
```typescript
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```

Add after `metricsMap` useMemo:
```typescript
const { data: podsData } = useResources(ctx, "pods");

const podsByNode = useMemo(() => {
  const map = new Map<string, { daemonset: number; other: number }>();
  const pods = (podsData || []) as Record<string, unknown>[];

  for (const pod of pods) {
    const spec = pod.spec as Record<string, unknown>;
    const metadata = pod.metadata as Record<string, unknown>;
    const nodeName = spec?.nodeName as string;
    if (!nodeName) continue;

    if (!map.has(nodeName)) {
      map.set(nodeName, { daemonset: 0, other: 0 });
    }
    const entry = map.get(nodeName)!;

    const ownerRefs = (metadata?.ownerReferences as Record<string, unknown>[]) || [];
    const isDaemonSet = ownerRefs.some((ref) => ref.kind === "DaemonSet");

    if (isDaemonSet) {
      entry.daemonset++;
    } else {
      entry.other++;
    }
  }

  return map;
}, [podsData]);
```

Add new column after "roles" column (around line 78):
```typescript
{
  id: "pods",
  header: "Pods",
  accessorFn: (row) => {
    const name = (row.metadata as Record<string, unknown>)?.name as string;
    const counts = podsByNode.get(name);
    if (!counts) return 0;
    return counts.daemonset + counts.other;
  },
  cell: ({ row }) => {
    const name = (row.original.metadata as Record<string, unknown>)?.name as string;
    const counts = podsByNode.get(name);
    if (!counts) return <span className="text-muted-foreground text-xs">-</span>;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            <span className="text-muted-foreground">{counts.daemonset}</span>
            <span className="text-muted-foreground mx-1">/</span>
            <span>{counts.other}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{counts.daemonset} DaemonSet pods, {counts.other} other pods</p>
        </TooltipContent>
      </Tooltip>
    );
  },
},
```

**Step 2: Test in browser**

Navigate to Nodes list, verify "Pods" column shows "X / Y" format with tooltip.

**Step 3: Commit**

```bash
git add src/app/clusters/\[contextName\]/nodes/page.tsx
git commit -m "feat(ui): add Pods column to Nodes list with DaemonSet/Other split"
```

---

## Task 11: URL Encoding Bug Fix - Audit & Fix

**Files:**
- Audit: `src/components/command-palette.tsx` (line 71)
- Audit: `src/components/cluster-switcher.tsx` (lines 169-175)
- Audit: `src/components/sidebar.tsx`

**Step 1: Fix command-palette.tsx**

Line 71 uses `contextName` directly without decoding first, then encodes. This causes double-encoding if contextName is already encoded from params.

Change line 71 from:
```typescript
href: `/clusters/${contextName ? encodeURIComponent(contextName) : ""}/${item.href}`,
```
to:
```typescript
href: `/clusters/${ctx ? encodeURIComponent(ctx) : ""}/${item.href}`,
```

The `ctx` is already decoded on line 38, so this is correct.

**Step 2: Verify cluster-switcher.tsx**

Lines 169-175 look correct - it encodes `targetName` and `contextName` (both are raw context names, not URL-encoded).

**Step 3: Check sidebar.tsx for any issues**

Look for any navigation that doesn't properly encode/decode.

**Step 4: Test**

1. Switch to a cluster with `/` in name (e.g., `omnetic/classic`)
2. Use Cmd+K to navigate to different pages
3. Verify URL shows `omnetic%2Fclassic` consistently
4. Verify navigation works without errors

**Step 5: Commit**

```bash
git add src/components/command-palette.tsx
git commit -m "fix: consistent URL encoding for cluster names with special characters"
```

---

## Task 12: ResourceDetail headerActions Support

**Files:**
- Modify: `src/components/resource-detail.tsx`

**Step 1: Check if headerActions prop exists**

Read the file and check if it already supports `headerActions` prop.

**Step 2: Add headerActions prop if needed**

Add to interface:
```typescript
headerActions?: React.ReactNode;
```

Add to the header area where the title is rendered, next to any existing buttons.

**Step 3: Commit**

```bash
git add src/components/resource-detail.tsx
git commit -m "feat(ui): add headerActions prop to ResourceDetail"
```

---

## Task 13: Final Testing & Version Bump

**Step 1: Run full test**

```bash
npm run build && npm run start
```

**Step 2: Manual testing checklist**

- [ ] CronJob list: Trigger button visible, dialog works
- [ ] CronJob detail: Trigger button in header, dialog works
- [ ] Deployment list: Scale and Restart buttons visible
- [ ] Deployment detail: Scale and Restart buttons work
- [ ] Ingress detail: Routing Rules card with table
- [ ] Nodes list: Pods column with DS/Other format
- [ ] URL encoding: Navigate with Cmd+K on cluster with `/` in name

**Step 3: Bump version**

```bash
npm version patch -m "chore: bump version to %s"
```

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize new features"
```
