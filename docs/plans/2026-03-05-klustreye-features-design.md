# KlustrEye Features Design

**Date:** 2026-03-05
**Status:** Approved

## Overview

This document describes the design for five new features and one bug fix for KlustrEye.

## 1. CronJob Trigger

**Goal:** Allow users to manually trigger a CronJob (create a Job immediately).

### Implementation

**New files:**
- `src/components/trigger-cronjob-dialog.tsx` - confirmation dialog

**API endpoint:**
- `POST /api/clusters/[contextName]/cronjobs/[name]/trigger?namespace=...`
- Creates a Job resource with:
  - `metadata.name`: `{cronjob-name}-manual-{unix-timestamp}`
  - `metadata.annotations`: `cronjob.kubernetes.io/instantiate: "manual"`
  - `spec`: copied from `cronjob.spec.jobTemplate.spec`

**UI changes:**
- `src/app/clusters/[contextName]/workloads/cronjobs/page.tsx` - add "Trigger" action button
- `src/app/clusters/[contextName]/workloads/cronjobs/[name]/page.tsx` - add button in header

**Hook:**
- `useTriggerCronJob()` in `src/hooks/use-resources.ts`

---

## 2. Deployment Scale & Restart

**Goal:** Make Scale more discoverable and add Restart functionality.

### Scale (existing, improve visibility)

Current implementation uses small icon button - make it more visible with text.

### Restart (new)

**New files:**
- `src/components/restart-dialog.tsx` - confirmation dialog

**API:**
- Uses existing PATCH endpoint `/api/clusters/[contextName]/resources/deployments/[name]`
- Patch body:
  ```json
  {
    "patch": {
      "spec": {
        "template": {
          "metadata": {
            "annotations": {
              "kubectl.kubernetes.io/restartedAt": "2026-03-05T20:00:00Z"
            }
          }
        }
      }
    }
  }
  ```

**UI changes:**
- `src/app/clusters/[contextName]/workloads/deployments/page.tsx` - add visible "Scale" and "Restart" buttons in actions column
- `src/app/clusters/[contextName]/workloads/deployments/[name]/page.tsx` - add both buttons with text in status card

**Hook:**
- `useRestartDeployment()` in `src/hooks/use-resources.ts`

---

## 3. Ingress Routing Rules

**Goal:** Display routing rules (host/path/service mapping) in Ingress detail view.

### Implementation

**File to modify:**
- `src/app/clusters/[contextName]/network/ingresses/[name]/page.tsx`

**New card "Routing Rules":**
- Table with columns:
  - **Host** (or `*` for default)
  - **Path**
  - **Path Type** (Prefix/Exact/ImplementationSpecific)
  - **Service**
  - **Port** (number or name)

**Data extraction:**
```
spec.rules[].host
spec.rules[].http.paths[].path
spec.rules[].http.paths[].pathType
spec.rules[].http.paths[].backend.service.name
spec.rules[].http.paths[].backend.service.port.number (or .name)
```

**Bonus:** Show lock icon for hosts with TLS configured.

---

## 4. Node Pods Count

**Goal:** Add "Pods" column to Nodes list showing DaemonSet vs other pods count.

### Implementation

**File to modify:**
- `src/app/clusters/[contextName]/nodes/page.tsx`

**New column:**
- **Header:** "Pods"
- **Format:** `{DS} / {Other}` (e.g., "3 / 12")
- **Tooltip:** "3 DaemonSet pods, 12 other pods"
- **Position:** After "Roles", before "Instance Type"

**Data fetching:**
- Fetch all pods in cluster: `useResources(ctx, "pods")`
- Aggregate by nodeName using useMemo
- DaemonSet pods: `metadata.ownerReferences[].kind === "DaemonSet"`
- Other: remaining pods on the node

---

## 5. Bug Fix: URL Encoding

**Problem:** Cluster names containing `/` (e.g., `omnetic/classic`) are inconsistently encoded/decoded, causing navigation issues with Cmd+K.

### Solution

1. **Navigation:** Always use `encodeURIComponent(contextName)` in URL paths
2. **Reading from URL:** Always use `decodeURIComponent(params.contextName)`
3. **Audit:** Review all `router.push()`, `Link href=`, and `useParams()` usages

**Key files to audit:**
- `src/components/cluster-switcher.tsx`
- `src/components/command-palette.tsx` (if exists)
- `src/lib/constants.ts` - `getResourceHref()`
- All page components with `[contextName]` param
