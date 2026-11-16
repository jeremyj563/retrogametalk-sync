---
title: Inline Sync-Page Failed Queue Drawer & Catalog Cleanup
status: implemented
created_at: 2026-11-16T02:23:17Z
implemented_at: 2026-11-16T02:27:25Z
---

# Inline Sync-Page Failed Queue Drawer & Catalog Cleanup

Relocates the **Failed Queue** out of the Catalog view switcher into an inline slide-down recovery drawer directly inside the **Sync** page, triggered by clicking `{count} failed · Review` on the Mirrored Files KPI card. This restores **Indexed Catalog** and **Local Disk Tree** as a clean two-way library toggle while keeping row-level **Retry** actions and the **Needs Attention** status filter intact inside Indexed Catalog.

---

## User Review & Critical Decisions

> [!IMPORTANT] All key placement and behavior decisions were confirmed during clarification:
> - **Primary Home**: Clicking `{count} failed · Review` on the **Sync** page opens a slide-down drawer directly inside the **Sync** page rather than navigating away to Catalog.
> - **Zero-Failure Visibility**: Because the drawer only opens on demand from the KPI card's `{count} failed · Review` button—which itself only renders when `failedItems > 0`—there is no permanent tab, badge, or button clutter when the repository is healthy.
> - **Catalog Continuity**: **Indexed Catalog** retains per-row **Retry** buttons, drawer **Retry** buttons, and the **Needs Attention (Failed & Partial)**, **Partial**, and **Failed** status filters.

---

## 1. Overview & Core Concept

- **What It Does**:
  - **Catalog View Simplification**: Removes **Failed Queue** from the Catalog header switcher so **Indexed Catalog** and **Local Disk Tree** sit side-by-side as pure mirrored-library views (database view vs. filesystem view).
  - **Sync-Page Slide-Down Recovery Drawer**: Expands smoothly directly beneath the 4-Column KPI Strip on the **Sync** page whenever the user clicks `{count} failed · Review`, surfacing the full failed/partial release recovery workflow right next to live run telemetry and logs.
- **Target User Context**: Immediately after a sync finishes with partial/failed downloads—or after an unexpected container restart—the operator stays on the **Sync** monitor, inspects error reasons, runs single-item or batch retries, watches live progress/log output in the same view, and closes the drawer when done.
- **Key Value**: Eliminates awkward navigation whiplash between operational retry recovery and library browsing/SD-card exporting while keeping zero UI chrome on screen when everything succeeded.

---

## 2. User Experience & Visual Design

### Layout Rhythm & Viewport Presence

Following the existing CRT SaaS Monitoring Console language:

- **Sync Page Anchor Hierarchy**:
  1. Active Runner Phase Status Panel (with existing inline **Edit Cutoff** panel).
  2. 4-Column KPI Strip (single-elevation `border-crt-border`, `tabular-nums`), where Card 1 renders `{count} failed · Review` (or `{count} failed · Hide` while expanded) as a crisp crimson affordance whenever failures exist.
  3. **Slide-Down Failed Queue Drawer** (inserted directly below the KPI strip in natural document flow with smooth `opacity`/`transform` reveal respecting `prefers-reduced-motion`; single-elevation flat surface matching the KPI strip, never nested card boxes inside cards).
  4. Telemetry Chart & Recent Sync Runs (2-column split) and Real-Time Activity Log.

- **Drawer Header & Action Bar**:
  - Left: Clear heading (`Failed Queue` + live tabular count) paired with unboxed muted summary text, zero decorative dots or pill capsules.
  - Right: Single-line (`whitespace-nowrap shrink-0`) action group:
    - Primary CTA: **Retry All Failed ({count})** (or **Retry Failed ({count})** when a system filter is active), showing active `Starting Retry...` / spinning icon feedback and disabled cleanly while a run is active or login is unverified.
    - Secondary actions: **Refresh** and **Close** (`×` / `Close`).

- **Filter & Bulk Selection Controls**:
  - Single-row filter bar below a hairline divider: live search input (`Filter failed titles or files...`), console dropdown (`All Systems` with per-system failed counts), conditional **Reset Filter** button, and right-aligned tabular count (`Showing X of Y failed/partial releases`).
  - Checking one or more rows reveals the contextual bulk action bar (**Retry Selected (N)**, two-step **Delete Selected (N) → Confirm Delete / Cancel**, **Clear Selection**).

- **High-Density Table & Detail Inspection**:
  - Compact rows (`py-3`) with crisp alignment: Checkbox, System (`font-mono`), Release Title + Failing Files (displaying exact filename + inline crimson error detail), Status (`XCircle`/`AlertCircle` icon paired with `failed` or `partial` text—never color-only), and right-aligned **Retry** (live `Retrying...` + spin synced with SSE background retry runs) + **Delete** buttons.
  - Clicking any row opens the existing **Game Detail Drawer** right over the **Sync** page so operators can inspect descriptions, specs, or retry individual discs/files without switching tabs.

- **Catalog Header Cleanup**:
  - Catalog's primary view toggle becomes strictly two paired options: `Indexed Catalog (N)` and `Local Disk Tree`.
  - Any previously saved browser view preference of `'failed'` gracefully falls back to `'catalog'`.

- **State Completeness**:
  - **Populated State**: Live list from `needs_retry`, kept updated via SSE `catalog_updated` and active-run completion refreshes.
  - **Loading State**: Compact matching row skeletons on initial drawer open.
  - **Empty / Recovered State**: If the operator resolves or deletes all failed releases while the drawer is open, the drawer stays calmly open showing an "All downloads recovered" confirmation message and a **Close Drawer** button rather than abruptly vanishing mid-action.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: In-Flow Slide-Down Panel Below KPI Strip vs. Modal Overlay**
  - *Chosen Approach*: An inline expandable slide-down panel directly beneath the KPI strip inside the **Sync** view.
  - *Why*: Operators initiating retries want to watch the **Active Runner Phase Status Panel**, live transfer progress bar, and **Real-Time Activity Log** immediately above and below without a backdrop blocking status visibility. This mirrors the already-established inline **Edit Cutoff** expansion pattern in the same workspace.
  - *Alternatives Considered*: Full-screen overlay modal (blocks live telemetry logs and active transfer bar) or dedicated left-rail tab (adds permanent sidebar navigation noise even when zero failures exist).

- **Decision 2: Reusable Shared Component + Preserved Detail Inspection**
  - *Chosen Approach*: Extract the failed-queue list/filter/bulk-recovery UI into a focused component rendered by the **Sync** view, sharing **Game Detail Drawer** inspection and top-level retry state tracking from the application shell.
  - *Why*: Prevents duplicating retry orchestration, selection pruning, live SSE refresh logic, and drawer state across views.
  - *Alternatives Considered*: Duplicating a stripped-down summary list inside the **Sync** page without search, batch selection, or detail inspection (would force users back into Catalog anyway for multi-disc or metadata inspection).

- **Decision 3: Smooth Collapse & Recovery Handling When Failures Hit Zero**
  - *Chosen Approach*: Keep the drawer open with an explicit recovered state until the user clicks **Close** (or toggles `{count} failed · Hide` closed), while hiding the KPI trigger button cleanly once closed and `failedItems === 0`.
  - *Why*: Auto-closing the moment the final retry finishes would cause jarring layout jumps right under the user's cursor; letting them see confirmation and click **Close** feels deliberate.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Hierarchy

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Application Shell                                                       │
│  ├─ Manages activeRun, activeRetryItemId, catalogRevision (SSE),        │
│  │  errorBanner, handleRetryItem, handleRetryAllFailed                  │
│  ├─ Left Sidebar Navigation (Sync · Catalog · Schedule · Operations)    │
│  └─ Active Section Viewport                                             │
│       ├─ Sync View                                                      │
│       │    ├─ Active Runner Panel (+ inline Edit Cutoff)                │
│       │    ├─ 4-Column KPI Strip                                        │
│       │    │    └─ Mirrored Files Card: [N failed · Review] (toggle)    │
│       │    ├─ Slide-Down Failed Queue Drawer (when expanded)            │
│       │    │    ├─ Header Actions: Retry All Failed · Refresh · Close   │
│       │    │    ├─ Filters: Search · System Dropdown · Reset            │
│       │    │    ├─ Bulk Bar: Retry Selected · Delete Selected (confirm) │
│       │    │    ├─ Releases Table (Checkbox, Error Details, Row Retry)  │
│       │    │    └─ Opens Game Detail Drawer on row click                │
│       │    ├─ Rate Limiter Chart & Sync Runs Table                      │
│       │    └─ Real-Time Activity Log                                    │
│       └─ Catalog View                                                   │
│            ├─ 2-Mode Toggle: [Indexed Catalog | Local Disk Tree]        │
│            └─ Indexed Catalog keeps row Retry + Needs Attention filter  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State Strategy

- **Existing Backend APIs Reused Directly (Zero Backend Schema Changes Needed)**:
  - Query failed/partial releases: `GET /api/items?status=needs_retry&search=...&system=...&sort=discovered_desc&limit=150`
  - Single release detail (for opening the detail drawer): `GET /api/items/:id`
  - Single release or file retry: `POST /api/items/:id/retry`
  - Batch/filtered retry: `POST /api/items/retry-failed` with optional `{ system, ids }`
  - Bulk/single deletion: `DELETE /api/items` with `{ ids }`
- **Client UI State**:
  - Drawer open/closed state lives in the **Sync** view (`failedQueueOpen`, boolean, closed by default).
  - Live synchronization subscribes to existing `catalogRevision` (bumped by SSE `catalog_updated` and run-finish transitions) and receives `activeRetryItemId` so row/drawer **Retry** spinners remain active across the async `202 Accepted` background retry lifecycle.
  - Catalog view preference state narrows `viewMode` to `'catalog' | 'filesystem'` and sanitizes legacy stored `'failed'` values to `'catalog'`.
