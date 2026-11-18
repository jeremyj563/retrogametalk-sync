---
title: Symmetric Catalog Download & Install Quick Filters
status: implemented
created_at: 2026-11-18T19:14:59Z
implemented_at: 2026-11-18T19:25:00Z
---

# Symmetric Catalog Download & Install Quick Filters

Adds a paired **`Downloaded (N)` / `Not Downloaded (N)`** toggle group to the Catalog toolbar alongside the existing **`Installed (N)` / `Not Installed (N)`** controls, backed by filter-aware server facet counts and kept bidirectionally synchronized with the **Status** multi-select dropdown.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core UX and behavior decisions were confirmed during clarification and govern this plan:
> - **Toolbar Organization**: **Two paired toggle groups for Download and Install** — mirrors the existing `Installed` / `Not Installed` pair with a matching `Downloaded` / `Not Downloaded` pair in the Catalog toolbar.
> - **Not Downloaded Scope**: **All un-downloaded items (Available, Queued, Failed)** — `Not Downloaded` surfaces every catalog item not yet mirrored on disk (`available`, `partial`, `failed`, `queued`, `downloading`).
> - **Status Dropdown Synchronization**: **Keep Status dropdown synced for granular states** — clicking either Download quick-toggle updates the Status selection directly, and picking matching or granular states in the Status dropdown stays cleanly reflected in the quick-toggle buttons and active filter strip.

---

## 1. Overview & Core Concept

- **What It Does**: Gives Catalog users identical one-click parity across both stages of a game's journey—**mirroring to local library (`Downloaded` / `Not Downloaded`)** and **deploying to handheld storage (`Installed` / `Not Installed`)**—without sacrificing fine-grained control over `Available`, `Partial`, `Failed`, `Queued`, or `Downloading` states inside the `Status` dropdown.
- **Target Audience / Persona**: RetroGameTalk Sync users curating large indexed libraries who routinely switch between browsing games ready to mirror onto the server (`Not Downloaded`), verifying local files (`Downloaded`), or picking mirrored titles not yet copied onto an SD card (`Not Installed`).
- **Key Value**: Removes the need to open a multi-select dropdown for the most common daily catalog split while keeping live, context-aware `(N)` item counts visible directly on the toolbar.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **One-Click Download & Install Filtering**
   - In the Catalog filter bar next to `Status`, two clean visual toggle groups sit side-by-side:
     - **Download State**: `Downloaded (N)` · `Not Downloaded (N)`
     - **Install State**: `Installed (N)` · `Not Installed (N)`
   - Clicking `Downloaded` filters immediately to mirrored releases (`downloaded` / `skipped`) and updates its button to an active phosphor state; clicking again clears the filter back to all statuses.
   - Clicking `Not Downloaded` filters immediately to every release not yet downloaded (`available`, `partial`, `failed`, `queued`, `downloading`) and updates its button to an active amber state; clicking again clears back to all statuses.
   - Both groups compose freely with each other and with every metadata facet (e.g., clicking `Downloaded` + `Not Installed` instantly lists every game ready on disk to export to an SD card).
2. **Two-Way Sync with the Status Dropdown & Active Filter Bar**
   - Clicking `Downloaded` checks `Downloaded` inside the `Status` dropdown; clicking `Not Downloaded` checks the un-downloaded granular states (`Available`, `Partial`, `Failed`, plus active `Queued`/`Downloading`) inside `Status`.
   - Opening the `Status` dropdown while `Not Downloaded` is active lets the user uncheck individual states (such as unchecking `Available` to inspect only `Partial` & `Failed`), automatically transitioning cleanly to granular `Status` filter chips without breaking selection.
   - Selecting only `Downloaded` inside the `Status` dropdown automatically highlights the `Downloaded` toolbar button.
   - Active Filter Tokens keep the strip concise: when the full `Not Downloaded` preset is active, one unified **`Download: Not Downloaded`** token renders (clearing back to all on `×`), whereas custom sub-selections render crisp individual `Status:` tokens.
3. **Contextual Toolbar Counts**
   - Just like `Installed (N)` and `Not Installed (N)`, the `(N)` counters inside `Downloaded` and `Not Downloaded` update live against all *other* active filters (Search, Systems, Types, Genres, Regions, Languages, Sources, and Install filter)—ignoring only the Download/Status filter itself so the user always sees how many matching items await download vs already live on disk.

### Visual Identity & Theme

- **Aesthetic Direction**: Continues the dark **Broadcast PVM / CRT Studio Console** language across **Green**, **Amber**, and **Cyan** phosphor palettes.
- **Consistent Button Styling & Hierarchy**:
  - `Downloaded`: Displays a crisp download glyph, `Downloaded` label, and `(count)` in `IBM Plex Mono` (`font-mono tabular-nums`), transitioning to phosphor accent (`bg-crt-phosphor/15 text-crt-phosphor border-crt-phosphor/70`) when active.
  - `Not Downloaded`: Displays `Not Downloaded` and `(count)` in `font-mono tabular-nums`, transitioning to amber accent (`bg-crt-amber/15 text-crt-amber border-crt-amber/70`) when active—matching `Installed` (phosphor) and `Not Installed` (amber) symmetrically.
- **Zero-Pill & Layout Restraint**:
  - Functional controls use crisp segmented/paired `<button>` elements (`whitespace-nowrap shrink-0`, single-line controls) with clean hairline borders and `gap-1.5` spacing—never static rounded pills on informational metadata.
  - Responsive toolbar wrapping keeps the Download pair, Install pair, `Status` dropdown, and Sort control cleanly aligned across desktop (`1440px`) and narrower viewports without horizontal overflow or layout shift.

### Interactive Feedback & Motion

- **Smooth Transitions & Living UI Harmony**:
  - Toggle active/inactive border and background transitions settle gently (`transition-colors` / `200ms` ease-out), respecting `prefers-reduced-motion` cleanly.
  - Clearing via the active filter chip (`×`), `Clear Filters`, or toggling the active button again resets both buttons and `Status` dropdown checkboxes in one frame with zero flicker.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Sync `Downloaded` / `Not Downloaded` Directly Into Existing `statuses` State**
  - *Chosen Approach*: Represent `Downloaded` (`['downloaded']`) and `Not Downloaded` (`['available', 'partial', 'failed', 'queued', 'downloading']`) using the existing persisted `statuses` filter array, rather than introducing a parallel independent `downloadedFilter` boolean/enum that can conflict with `Status`.
  - *Why*: Eliminates impossible contradictory states (such as `Downloaded` active alongside `Status: Failed`), preserves `localStorage` persistence cleanly without schema churn, and makes checkbox synchronization inside the `Status` multi-select dropdown automatic.
  - *Alternatives Considered*: Adding a separate `downloadedFilter` state alongside `statuses` (rejected because reconciling two separate download status filters creates edge-case conflicts in queries, filter tokens, and `Download Filtered`).

- **Decision 2: Context-Aware Server Facet Counts for Both Download & Install Pairs**
  - *Chosen Approach*: Add a lightweight aggregate count query alongside the existing installed facet query—applying all active non-status filters (`search`, `system`, `installed`, `tag`, `genre`, `region`, `language`, `source`) to compute exact `downloaded` and `notDownloaded` counts returned in catalog facet metadata.
  - *Why*: Global totals alone become misleading once a user filters to a specific system (e.g., `SNES`) or clicks `Not Installed`; contextual counts immediately reveal *"of the filtered Nintendo 64 RPGs, 14 are Downloaded and 86 are Not Downloaded"*.
  - *Alternatives Considered*: Reading global `status.totals` for the button numbers (rejected because numbers wouldn't reflect active System, Search, or Install filters, inconsistent with `Installed (N)` / `Not Installed (N)`).

- **Decision 3: Smart Suppression of Empty Transient Options in `Status` Dropdown**
  - *Chosen Approach*: Keep `'queued'` and `'downloading'` included in the `Not Downloaded` preset so in-flight items never vanish mid-queue, while only displaying `Queued (N)` / `Downloading (N)` rows inside the `Status` dropdown menu when their count is `> 0` (or when individually selected).
  - *Why*: Prevents cluttering the `Status` dropdown with `Queued (0)` and `Downloading (0)` options whenever `Not Downloaded` is active during idle periods.
  - *Alternatives Considered*: Always showing `Queued (0)` and `Downloading (0)` in the dropdown (rejected as unnecessary visual noise).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Catalog Filter Toolbar (React)                       │
│                                                                             │
│  [ Search ] [ 6 Metadata Facets ] [ Status Multi-Select ]                   │
│                                      ▲                                      │
│                                      │ Bidirectional Sync (`statuses[]`)    │
│                                      ▼                                      │
│  [ Download Group: Downloaded (N) | Not Downloaded (N) ]                    │
│  [ Install Group:  Installed (N)  | Not Installed (N)  ]  [ Sort Selector ] │
│                                      │                                      │
│                                      ▼                                      │
│            Active Filter Strip ("Download: Downloaded / Not Downloaded")    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ GET /api/items (filters + facets)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Catalog Query & Facet Engine (SQLite)                    │
│                                                                             │
│  • Filtered Items & Totals ── applies all active status/install/facet rules │
│  • listDownloadedFacetCounts ── counts downloaded vs notDownloaded ignoring │
│    `status` filter so both quick buttons always show live scoped counts     │
│  • listInstalledFacetCounts  ── counts installed vs notInstalled ignoring   │
│    `installed` filter (existing symmetric behavior)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Extended Facet Counts Shape**:
  - Extend `CatalogFacetCounts` (shared server & client TypeScript definitions) with an optional `downloaded` breakdown:
    - `downloaded`: count of matching rows where `status IN ('downloaded', 'skipped')`
    - `notDownloaded`: count of matching rows where `status NOT IN ('downloaded', 'skipped')`
- **Preset & Active State Derivation**:
  - Define canonical leaf un-downloaded statuses (`['available', 'partial', 'failed', 'queued', 'downloading']`).
  - Derive boolean flags purely from `statuses`:
    - `isDownloadedQuickActive`: `statuses.length === 1 && statuses[0] === 'downloaded'`
    - `isNotDownloadedQuickActive`: `!statuses.includes('downloaded')` and every leaf un-downloaded status is selected (covering both initial selection and live updates cleanly).

### Interactive Component & State Mapping

- **Download Toggle Group Handlers**:
  - `handleToggleDownloadedQuick()`: if `isDownloadedQuickActive`, clear `statuses` (`[]`); otherwise set `statuses` to `['downloaded']`.
  - `handleToggleNotDownloadedQuick()`: if `isNotDownloadedQuickActive`, clear `statuses` (`[]`); otherwise set `statuses` to the leaf un-downloaded statuses (`['available', 'partial', 'failed', 'queued', 'downloading']`).
- **Status Multi-Select Dropdown & Token Strip**:
  - Reads the shared `statuses` array directly; unchecking or adding any status immediately recalculates `isDownloadedQuickActive` / `isNotDownloadedQuickActive`.
  - Active filter tokens collapse the full un-downloaded set into a single removable **`Download: Not Downloaded`** token (and **`Download: Downloaded`** for `['downloaded']`), falling back seamlessly to individual **`Status: ...`** tokens for custom granular selections.
- **Server Facet Computation**:
  - `queryRepositoryItems` invokes `listDownloadedFacetCounts(params)` using `buildCatalogWhereAndOrder({ ...params, status: undefined })`, ensuring exact symmetry with `listInstalledFacetCounts(params)` and full responsiveness to search, system, metadata, and install filters.
