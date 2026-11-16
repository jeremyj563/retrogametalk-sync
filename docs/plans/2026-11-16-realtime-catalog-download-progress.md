---
title: Realtime Catalog Download Progress
status: implemented
created_at: 2026-11-16T16:09:18Z
implemented_at: 2026-11-16T16:14:30Z
---

# Realtime Catalog Download Progress

Deliver live, zero-polling transfer progress directly on downloading catalog entries across the Box-Art Grid, Catalog Table, and Game Detail Drawer using the existing Server-Sent Events transfer stream. Whenever an item enters the `downloading` state, users see real-time progress bars, completion percentages, transferred/total bytes, and live throughput instead of a static text label.

## User Review & Critical Decisions

> [!IMPORTANT] All primary UX and scope choices below were confirmed during clarification and govern this design.

- **Confirmed — Full Surface Coverage**: Display live download telemetry across all three views: **Box-Art Grid cards**, **Catalog Table rows**, and the **Game Detail Drawer** (both the drawer status header and the matching file row inside multi-file releases).
- **Confirmed — Telemetry Granularity**: Show a **progress bar**, **percentage** (when total size is known), **bytes received / total bytes**, and **transfer speed** (`B/s`, `KB/s`, `MB/s`).
- **Confirmed — Grid Card Presentation**: Pair a **cover artwork progress overlay** (working seamlessly over both placeholder skeleton covers and already-mirrored box art) with a **compact progress bar and live telemetry readout in the card footer**.

---

## 1. Overview & Core Concept

- **What It Does**: Connects catalog presentation surfaces to the live `activeTransfer` stream already emitted during sync and single-item retries. Any catalog release (and specific file inside a multi-file release) currently transferring renders real-time byte-level telemetry, smooth bar fill, and speed readout, gracefully falling back to an explicit connecting/preparing state before the archive HTTP stream begins or when upstream omits `Content-Length`.
- **Target Audience / Persona**: Homelab operators and retro archive collectors monitoring active sync runs or single-release retries directly from the Catalog tab without switching back to Overview.
- **Key Value**: Eliminates blind waiting on "skeleton" downloading cards—users immediately confirm whether a large ISO or multi-archive release is actively streaming, at what speed, and how close it is to completion.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Discovery & Skeleton Phase (Before Archive Bytes Start)**:
   - A newly discovered release appears in the Catalog with `downloading` status while its cover art and metadata mirror.
   - Its grid card and table row display a crisp phosphor-accented `Preparing…` / `Starting…` indicator with a subtle indeterminate sweep bar so the entry feels alive from the first millisecond.
2. **Active Archive Streaming Phase**:
   - Once the archive stream opens, the matching catalog entry (`activeTransfer.itemId === item.id`) transitions immediately into live progress mode:
     - **Box-Art Grid Card**: A measured dark scrim anchors cleanly at the bottom edge of the 3:4 cover frame (`>= 4.5:1` contrast over either placeholder icon art or mirrored cover art), presenting the active filename, live percentage, `received / total`, and speed (`MB/s`), paired with a thin progress bar and compact status telemetry in the footer row.
     - **Catalog Table Row**: The `Status` cell expands inline cleanly without overflowing row geometry—showing a live percentage + speed readout, `bytesReceived / totalBytes` subline, and a crisp hairline-bordered progress track underneath—keeping row height balanced and numeric columns vertically aligned.
     - **Game Detail Drawer**: Opening any downloading release surfaces a dedicated live transfer strip right below the drawer header, and highlights the specific file row (`fileId` or `filename` match) inside the **Included Files** list with its own real-time progress bar, bytes, percentage, and speed.
3. **Unknown Total Size (`Content-Length` Omitted)**:
   - When an upstream file omits total size (`totalBytes === null`), UI surfaces never fabricate a percentage; instead they render an animated indeterminate phosphor sweep bar alongside exact `bytesReceived` and `bytesPerSec`.
4. **Completion & Multi-File Transitions**:
   - As one file finishes in a multi-file release and the next file resolves its link, the previous file flips cleanly to `downloaded` while the release card smoothly resets to preparing/connecting until the next archive stream begins.

### Visual Identity & Spatial Rules

- **Theme Alignment**: Preserves the existing CRT workstation palette (`--color-crt-bg`, `--color-crt-surface`, `--color-crt-border`, `--color-crt-text`, `--color-crt-muted`, `--color-crt-phosphor`, `--color-crt-amber`) across Green, Amber, and Cyan phosphor presets—avoiding any unrequested visual divergence.
- **Typography & Tabular Discipline**:
  - Card titles remain in `Chakra Petch` (`--font-display`); supporting labels remain in `DM Sans` (`--font-sans`).
  - Every live counter (`64%`, `142.4 MB / 220.0 MB`, `18.4 MB/s`) strictly uses `font-mono tabular-nums` so streaming digits never cause horizontal jitter or layout shift.
- **Anti-Slop & Contrast Discipline**:
  - **No nested pill badges or decorative dots**: Status telemetry renders as clean unboxed typographic pairs separated by `·` and paired with explicit functional icons (`Download` / progress track), never hue-only indicators or pill capsules.
  - **Single-elevation depth**: Overlays and table progress tracks sit flush within existing card/row boundaries using hairline `1px` borders and measured scrim gradients rather than nested floating cards.
  - **Motion & Accessibility**: Bar fill transitions settle smoothly (`duration-200`), indeterminate animations honor `prefers-reduced-motion`, and progress elements carry semantic `role="progressbar"` with `aria-valuenow` / `aria-valuemin` / `aria-valuemax` attributes where determinate.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Reuse Existing SSE `transfer` Stream Instead of Polling**
  - *Chosen Approach*: Consume the existing `status.activeTransfer` state pushed over `/api/events` directly inside the Catalog view and Detail Drawer, while enriching the backend payload with `fileId` and `fileIndex` / `totalFiles` context.
  - *Why*: Zero extra HTTP requests, instant sub-second UI updates matching Overview telemetry, and guaranteed server-authoritative consistency across tabs and multi-file releases.
  - *Alternatives Considered*: Polling `/api/items` on an interval—rejected because frequent SQLite reads add disk/CPU overhead and feel laggy compared to the already-streaming SSE pipe.

- **Decision 2: Match by `fileId` First (With `filename` Fallback) in the Detail Drawer**
  - *Chosen Approach*: Include `fileId` (and file sequence metadata) in the live `ActiveTransferState` payload so the backend identifies the exact database file record being streamed.
  - *Why*: Multi-file releases (e.g., dual-disc ISOs or bundled patches) can contain similarly named archives; `fileId` matching prevents highlighting the wrong row inside the drawer.
  - *Alternatives Considered*: Matching strictly by filename—simpler, but fragile when multiple files or retries share names.

- **Decision 3: Explicit Handling for Connecting & Unknown-Size Streams**
  - *Chosen Approach*: Render distinct visual states for (1) `downloading` before bytes flow (`Preparing…`), (2) determinate transfers (`totalBytes > 0`), and (3) indeterminate streams (`totalBytes === null`).
  - *Why*: Prevents flashing `0%` or broken `NaN%` values during link resolution, nonce refresh retries, or chunked transfers without `Content-Length`.
  - *Alternatives Considered*: Hiding progress until `totalBytes` is known—rejected because users explicitly notice the static `downloading` skeleton card right as discovery begins.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Data Flow Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Backend Sync Orchestrator                                                 │
│  • Sets release & file status = 'downloading'                             │
│  • Populates activeTransfer { itemId, fileId, filename, bytes, total, B/s } │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │
             SSE Event Stream (/api/events → event: 'transfer')
                                │
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Root App State (ServiceStatusSnapshot.activeTransfer)                     │
│  • Single authoritative live transfer state shared across all views       │
└───────────────┬───────────────────────────────┬───────────────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────────┐ ┌─────────────────────────────────────────┐
│ Catalog View                  │ │ Game Detail Drawer                      │
│  • Grid Card: Cover overlay   │ │  • Header Progress Banner (when open    │
│    scrim + footer telemetry   │ │    release matches activeTransfer)      │
│  • Table Row: Inline Status   │ │  • File Row Match (fileId || filename): │
│    cell bar, %, bytes, speed  │ │    inline file-level bar, %, B/s, bytes │
└───────────────────────────────┘ └─────────────────────────────────────────┘
```

### Data Model & State Strategy

- **Transfer State Enrichment**: Extend the shared `ActiveTransferState` contract with optional `fileId: number | null` (plus optional `fileIndex` / `totalFiles` when downloading multi-file releases) populated when initiating a file transfer on the server and cleared atomically on completion or abort.
- **Derived Progress Selector**: Introduce a small pure UI helper that resolves `(item, activeTransfer)` into normalized display telemetry (`mode: 'idle' | 'preparing' | 'determinate' | 'indeterminate'`, `percent`, `bytesLabel`, `speedLabel`, `activeFilename`), ensuring identical formatting, zero duplicated math, and consistent fallback behavior across Grid Cards, Table Rows, and Drawer rows.

### Interactive Component & State Mapping

- **Catalog Box-Art Grid Card**:
  - *Trigger*: `item.status === 'downloading'` or `activeTransfer?.itemId === item.id`.
  - *Behavior*: Preserves existing card selection checkboxes and click-to-open-drawer interaction cleanly above the scrim; clicking the card while downloading opens the Detail Drawer with live progress continuing uninterrupted.
- **Catalog Table Row**:
  - *Trigger*: Row `item.status === 'downloading'` or `activeTransfer?.itemId === item.id`.
  - *Behavior*: Renders compact inline progress telemetry inside the `Status` column without shifting table column widths; row click opens the drawer and checkbox selection remains isolated.
- **Game Detail Drawer**:
  - *Trigger*: Open release matches `activeTransfer?.itemId === item.id`, or individual file matches `activeTransfer.fileId === file.id` (falling back to filename match and `file.status === 'downloading'`).
  - *Behavior*: Updates smoothly in place without closing an open artwork lightbox or resetting user scroll position; transitions cleanly to completed state when the `catalog_updated` event refreshes item files.
