---
title: Failed Downloads Queue, Batch Recovery & Stream Resilience
status: implemented
created_at: 2026-11-15T20:22:03Z
implemented_at: 2026-11-15T20:30:38Z
---

# Failed Downloads Queue, Batch Recovery & Stream Resilience

A dedicated **Failed Queue** inside Catalog—paired with a **Retry All Failed** batch runner, inline Sync tab shortcut, and decoupled archive stream timeouts with automatic drop recovery—makes failed and partial releases visible at a glance and recoverable individually or in one click.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> All core workflow and resilience decisions were confirmed during interactive clarification and are locked into this plan:

- **Confirmed Decision 1 — Queue Placement**: Surface a **Failed Queue (N)** view toggle directly inside the Catalog toolbar (alongside Indexed Catalog and Local Disk Tree), paired with a quick **failed-count jump link** on the Sync tab whenever failures exist.
- **Confirmed Decision 2 — Batch Retry Scope**: **Retry All Failed** targets all `failed` and `partial` releases across the catalog by default (retrying only failed or missing files within each release).
- **Confirmed Decision 3 — Sync Tab Visibility**: Add a concise failed-count jump link inside the Sync tab KPI strip (`N failed · Review in Catalog`) rather than crowding the Sync dashboard with a second full table.
- **Confirmed Decision 4 — Stream Timeout Resilience**: Decouple archive binary streaming timeouts from the short 30-second page/API timeout and automatically retry transient body-stream drops (such as `Body TimedOut` and socket resets) with fresh download links before marking any file as failed.

---

### 1. Overview & Core Concept

- **What It Does**:
  1. Surfaces every `failed` and `partial` release in a focused **Failed Queue** view inside Catalog, showing exact failing filenames and upstream error reasons inline without needing to open each item's drawer.
  2. Supports **Retry** on any individual release or individual file, plus **Retry All Failed** (or **Retry Selected**) to sequentially recover every failed/partial release under the orchestrator's rate-limited sync lock.
  3. Hardens binary archive transfers against `Body TimedOut` stream interruptions so large or slow ROM downloads automatically survive transient upstream stalls during Full and Incremental Syncs.
- **Target Audience / Persona**: Self-hosted retro game archivists running large Full Syncs or nightly Incremental Syncs who want unattended downloads to succeed more often and any remaining failures to be triaged and recovered cleanly.
- **Key Value**: Eliminates hunting through scrolling event logs to find failed downloads, prevents partial failures from hiding behind separate status filters, and cuts down transient timeout failures before they ever enter the queue.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Discovery from Sync Tab**: After a Full or Incremental Sync finishes with failures, the Sync tab's first KPI card displays a live crimson counter link (`N failed · Review`) next to the synced/deduped figures. Clicking it navigates directly to **Catalog → Failed Queue**.
  2. **Failed Queue Review**: Inside Catalog, a third segmented mode button (`Failed Queue (N)`) sits beside `Indexed Catalog` and `Local Disk Tree`. Switching to it filters the catalog to `failed` and `partial` releases and surfaces a dedicated action bar with **Retry All Failed (N)**, optional **Retry Selected**, and **Refresh**. Each row displays the system, release title, specific failing file name(s) (especially helpful for `partial` releases), and the recorded error message in crimson monospace text.
  3. **Individual & Batch Recovery**:
     - Clicking **Retry** on a row or inside the detail drawer re-fetches the release page for fresh nonces and signed download keys, downloads missing/failed files, skips files already on disk, and removes the item from the Failed Queue once healthy.
     - Clicking **Retry All Failed (N)** launches a tracked retry run inside the standard orchestrator lock. The top bar transitions to its active running state with a **Stop** button, the Sync transfer bar streams live file speed and progress, and succeeded items disappear from the Failed Queue in real time via SSE updates. Clicking **Stop** halts cleanly while keeping already-recovered items marked downloaded.
- **Visual Identity & Theme**:
  - Preserves the existing retro CRT terminal aesthetic: deep obsidian canvas (`--color-crt-bg`), dark structural surfaces (`--color-crt-surface`, `--color-crt-elevated`), hairline `1px` borders (`--color-crt-border`), phosphor green (`--color-crt-phosphor`) for healthy/primary actions, amber (`--color-crt-amber`) for partial warnings and confirmation prompts, and crimson (`--color-crt-crimson`) paired with explicit text/icons for failure states.
  - Preserves the `Chakra Petch` display headings, `DM Sans` body labels, and `IBM Plex Mono` (`tabular-nums`) for all file counts, error strings, byte rates, and queue counters.
- **Component Styling & Layout**:
  - Follows single-elevation flat containers with hairline `1px` dividers and no nested card-within-card boxes, no static metadata pill capsules, and no thick left accent borders.
  - Keeps the one-row Top Bar Contract intact; the new **Failed Queue** toggle lives inside the Catalog toolbar and the jump link sits inline inside the existing Sync KPI strip.
  - Complete state coverage in Failed Queue: loading skeleton rows, populated failure rows with inline error messages and per-row **Retry** / **Delete** controls, and a clean zero-failure empty state (`No failed or partial releases`) with a one-click button to return to the full catalog.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Failed Queue as a Mode Toggle + Needs-Attention Filter**:
  - *Chosen Approach*: Add a third segmented mode (`Failed Queue (N)`) in the Catalog toolbar alongside a `Needs Attention (Failed & Partial)` option in the status dropdown, plus a jump link on the Sync tab.
  - *Why*: Keeps top-level navigation to four clean sections (`Sync`, `Catalog`, `Schedule`, `Operations`) while making failed items one click away from both the Sync summary and the Catalog workspace.
  - *Alternatives Considered*: Adding a fifth top-level nav tab (crowds navigation for an exception-handling workflow) or relying only on a status dropdown (hides `partial` releases when filtering by `failed`).
- **Decision 2 — Orchestrator-Locked Batch Retry (`triggerType: 'retry'`)**:
  - *Chosen Approach*: Run **Retry All Failed** as a tracked run through the existing sync orchestrator lock rather than firing parallel background loops.
  - *Why*: Reuses the adaptive AIMD rate limiter, prevents collisions with cron/manual syncs, surfaces live progress in the Sync transfer bar and Event Stream, supports **Stop**, and safely leaves `last_watermark_at` untouched so Incremental Sync cutoffs remain accurate.
  - *Alternatives Considered*: Firing parallel `retryItem` API requests from the browser (would bypass the single-flight lock, hammer RGT rate limits, and lose progress if the user closes the tab).
- **Decision 3 — Decoupled Archive Stream Timeout + Fresh-Key Mid-Stream Auto-Retry**:
  - *Chosen Approach*: Keep `requestTimeoutMs` (default 30s) for metadata/API/HTML fetches while giving binary archive downloads a dedicated generous stream timeout (e.g., `Math.max(requestTimeoutMs * 6, 180_000)` / inactivity-resilient transfer) and adding bounded automatic retries on mid-stream `TimedOut` / `ECONNRESET` failures, refreshing the release's dynamic download link before retrying.
  - *Why*: `download.php` signed keys can expire and CDN transfers for multi-megabyte archives frequently exceed 30s; retrying with a fresh link solves both transient network drops and token expiry without inflating page-scrape timeouts.
  - *Alternatives Considered*: Only raising global `requestTimeoutMs` (slows failure detection for hung HTML/login probes without recovering dropped TCP streams).

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Flow Diagram**:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                                 Frontend UI                               │
│  ┌──────────────────────┐       ┌──────────────────────────────────────┐  │
│  │ Sync Tab KPI Card    │──────▶│ Catalog Workspace                    │  │
│  │ "N failed · Review"  │ jump  │ [Indexed Catalog | Failed Queue (N)  │  │
│  └──────────────────────┘       │  | Local Disk Tree]                  │  │
│                                 │  ├─ Action Bar: Retry All Failed (N) │  │
│                                 │  ├─ Inline file errors + Retry btn   │  │
│                                 │  └─ Real-time SSE status/catalog     │  │
│                                 └───────────────┬──────────────────────┘  │
└─────────────────────────────────────────────────┼─────────────────────────┘
                                                  │ HTTP POST / GET
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                            API & Orchestrator                             │
│  • GET  /api/items?status=needs_retry  (queries status IN failed,partial) │
│  • POST /api/items/:id/retry           (single release / single file)     │
│  • POST /api/items/retry-failed        (batch queue: all or selected IDs) │
│                                                                           │
│  Orchestrator Batch Loop (Acquires Lock · trigger='retry' · No Watermark) │
│   └─▶ For each failed/partial release:                                    │
│        1. Re-fetch RGT release page -> mint fresh nonce & download keys   │
│        2. Filter child files to failed or missing on disk                 │
│        3. Download via HTTP Client (extended binary stream timeout +      │
│           automatic retry on Body TimedOut / stream reset)                │
│        4. Update file & parent rollup status in SQLite + emit SSE event   │
└─────────────────────────────────────────────────┬─────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                          SQLite Persistence Layer                         │
│  • catalog_releases       (parent rollup status: failed | partial | ok)   │
│  • catalog_release_files  (per-file status, error_message, local_path)    │
│  • sync_runs              (batch retry run metrics & history)             │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Existing SQLite tables already record per-file `status` and `error_message` plus parent rollup `status` (`failed`, `partial`, `downloaded`, `skipped`).
  - Query support expands `status=needs_retry` to match `status IN ('failed', 'partial')` and exposes `needsRetryCount` (alongside `failedItems`) in status snapshots so the **Failed Queue (N)** badge count is always accurate even before opening Catalog.
  - Batch retry creates a standard `sync_runs` row (`triggerType: 'retry'`) so SSE status, active transfer telemetry, and run history remain unified.
- **Interactive Component & State Mapping**:
  - **Sync KPI Jump Link**: Reads `status.totals.failedItems`; clicking switches active section to Catalog and activates `Failed Queue` mode.
  - **Catalog Toolbar & Failed Queue**: `Failed Queue (N)` mode switches the query to `status=needs_retry`, shows failing child filenames + `errorMessage` inline per row, provides **Retry** per release, **Retry Selected**, and **Retry All Failed (N)** (disabled while a sync run is active or login is unverified).
  - **Detail Drawer**: Continues to show per-file failure reasons and individual **Retry** actions, syncing live when a batch or single retry resolves a file.
- **Download Stream Resilience**:
  - Decouples binary archive download timeout from `requestTimeoutMs` (allowing longer transfers without prematurely killing active streams) and wraps `downloadFileAtomic` + release-page dynamic link resolution in bounded retry handling when stream reads abort with `TimedOut` or socket reset errors.
