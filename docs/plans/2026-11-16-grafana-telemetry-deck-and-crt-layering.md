---
title: Grafana-Style Telemetry Graph Deck & Full-Screen CRT Overlay Layering
status: implemented
created_at: 2026-11-16T03:18:29Z
implemented_at: 2026-11-16T03:27:50Z
---

# Grafana-Style Telemetry Graph Deck & Full-Screen CRT Overlay Layering

Upgrades the Sync monitor's static rate-limiter chart into a **6-slide Grafana-style interactive telemetry deck** complete with snapped crosshairs, multi-series hover tooltips, summary stat legends, tab + arrow navigation, and hover-aware auto-cycling—while fixing the **CRT Display** optical stacking order so Scanlines, Aperture Grille, Vignette, and Gauss Glow apply seamlessly across slide-over drawers and modals without obstructing fullscreen box-art or screenshot zoom.

---

## User Review & Critical Decisions

> [!IMPORTANT] Updated to incorporate your requested **Downloaded Release Types** graph alongside all previously confirmed choices:
> - **CRT Overlay Stacking**: CRT screen effects (**Scanlines**, **Aperture Grille**, **Vignette**, **Gauss Glow**, **RGB Fringe**, and **Phosphor Palette**) will render across slide-over drawers and modals (`Game Detail Drawer`, `SD Card Export Modal`), while the **fullscreen photo/screenshot zoom lightbox** renders above the CRT glass so zoomed artwork stays crisp and unobstructed.
> - **6-Graph Telemetry Deck**: Includes all six live operational & library telemetry views:
>   1. **Adaptive Rate Limiter & Latency (`Pacing`)**
>   2. **Live Download Speed & Run Bandwidth (`Speed`)**
>   3. **Sync Run Outcomes (`Runs`)**
>   4. **Storage Footprint by Console (`Consoles`)**
>   5. **Downloaded Release Types (`Types`)** — *Translations, Hacks, Ports, Homebrew, Undubs, Retail ROMs, etc.*
>   6. **Upstream Latency Percentiles (`Latency`)**
> - **Deck Navigation**: Combines a single-line **tab strip**, **prev/next (`‹` / `›`) arrows**, and an optional **Auto-Cycle** toggle (automatically paused whenever your cursor hovers inside the chart to inspect data).

---

## 1. Overview & Core Concept

- **What It Does**:
  - **Authentic Full-Tube CRT Layering**: Elevates the pointer-safe CRT glass layers above drawers and modals while decoupling the fullscreen artwork lightbox into its own top-level layer above the CRT glass.
  - **Grafana-Grade Interactive Telemetry Deck**: Turns the Sync page's chart panel into a 6-card observability deck with precision mouse-tracking crosshairs, snapped data-point/bar highlights, floating dark-surface tooltips, and compact `min` / `avg` / `max` / `last` tabular metric footers.
- **Target Audience / Context**: Operators monitoring live sync throughput, diagnosing upstream rate-limiting or tail latency spikes, tracking archive composition across consoles and ROM types (hacks, translations, ports, homebrew), and browsing game details under a cohesive CRT aesthetic.
- **Key Value**: Delivers deep, live operational and collection insights inside the footprint of a single dashboard card without visual clutter or layout shift.

---

## 2. User Experience & Visual Design

### A. CRT Glass Stacking Across Drawers & Clean Photo Zoom

- **Unified CRT Tube Glass**: Opening **Game Detail Drawer** (from Catalog or the Sync Failed Queue) or **Send to SD Card** renders the panel behind the active Scanlines, Aperture Grille, and Vignette layers, with subtle ambient phosphor glow and dynamic `Green` / `Amber` / `Cyan` palette tokens applied throughout.
- **Crystal-Clear Artwork Lightbox**: Clicking any cover art or screenshot inside the detail drawer opens the fullscreen zoom viewer above all CRT optical overlays—with glow/fringe shadows suppressed inside the lightbox—so pixel art and box scans can be inspected cleanly.

### B. Grafana-Style Telemetry Deck Layout & Aesthetics

Styled for the dark CRT monitoring console (`border-crt-border`, `bg-crt-surface`, `font-mono tabular-nums`, zero nested card clutter, 60-30-10 color discipline):

- **Deck Header & Controls**:
  - **Title & Dynamic Subtitle**: Updates smoothly per active slide with live sample/item counts on the right.
  - **Navigation Strip**: Compact single-row segmented tab bar (`Pacing` · `Speed` · `Runs` · `Consoles` · `Types` · `Latency`) paired with `‹` / `›` step buttons and a compact **Auto** cycle toggle (`8s` cadence, automatically paused while hovering over the plot area). Active tab and auto-cycle preferences persist in `localStorage`.
- **Grafana Crosshair & Floating Tooltip Interaction**:
  - Moving the cursor across any time-series or categorical plot snaps a crisp 1px dashed vertical guide line (and horizontal value guide on continuous series) to the nearest sample index or bar row, illuminating glowing active-point rings or row highlights.
  - A floating high-contrast readout panel (`bg-crt-bg/95`, `border-crt-border-strong`, automatically flipping left/right or top/bottom near edges so it never clips) displays the exact timestamp, run, console, or release type alongside color-keyed series values.
- **Grafana Summary Legend Footer**:
  - Directly beneath the plot canvas, a compact monospace legend strip displays series swatches alongside key summary figures (`min`, `avg`, `max`, `last`, `p50`/`p95`, or top category shares) using strict `tabular-nums` alignment.

### C. Six Interactive Views & Empty/Live States

1. **Pacing (`Adaptive Rate Limiter & Latency`)**:
   - Dual-line + subtle phosphor area fill plotting **AIMD Request Delay (`ms`)** against **Upstream HTTP Latency (`ms`)** with crimson **Throttle (`429`)** event markers and horizontal `ms` Y-axis scale ticks.
2. **Speed (`Live Download Speed & Run Bandwidth`)**:
   - Plots real-time streaming transfer speed (`MB/s`) captured from live download progress events (backed by an in-memory server ring buffer so switching tabs or refreshing mid-run keeps the curve intact), showing active filename/console in the crosshair tooltip. When no live file stream samples exist yet, seamlessly displays per-run average throughput (`MB/s`) and downloaded volume from sync history.
3. **Runs (`Sync Run Outcomes & Volume`)**:
   - Chronological stacked bar chart across recent sync runs comparing **Downloaded** (phosphor), **Skipped** (muted), and **Failed** (crimson) counts with an overlaid bytes-downloaded trend line; hovering a run column highlights the bar stack and reveals full run metadata (`#ID`, mode, duration, item breakdown, mirrored bytes).
4. **Consoles (`Storage Footprint by Console`)**:
   - Ranked horizontal distribution bars of mirrored consoles by disk footprint (`GB`/`MB`) and share of total archive (`%`), with interactive hover focus revealing exact byte size, `%` of repository, downloaded count, and failed count per system.
5. **Types (`Downloaded Release Types`)**:
   - Ranked horizontal distribution & composition chart of downloaded releases categorized across **Translations** (e.g. English/fan translations & undubs), **Hacks**, **Ports**, **Homebrew**, **Prototypes / Demos**, **Retail ROMs**, and other indexed release tags—with interactive row crosshair/tooltips showing exact **downloaded release count**, **share `%` of downloaded library**, and **mirrored disk footprint (`GB`/`MB`)** per type.
6. **Latency (`Upstream Latency Percentiles`)**:
   - Rolling tail-latency curves plotting **Rolling `p50` (Median)**, **Rolling `p95`**, and **Rolling `Max`** response times (`ms`) across the upstream request window (`120` samples), with crosshair inspection and overall `p50` · `p90` · `p95` · `max` readout.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Sibling Stacking Context for Lightbox vs. Nested Fixed Container**
  - *Chosen Approach*: Render the fullscreen photo lightbox as a sibling fragment outside the `z-50` drawer container at `z-[80]`, while placing the pointer-safe CRT glass overlays at `z-[60]–z-[62]`.
  - *Why*: In CSS, a `position: fixed; z-index: 50` parent traps all children inside its `50` stacking context regardless of child `z-index`. Separating the drawer (`z-50`), CRT glass (`z-[60..62]`), and lightbox (`z-[80]`) guarantees drawers and modals sit under the CRT glass while zoomed photos sit cleanly above it.
  - *Alternatives Considered*: Duplicating CRT overlay divs inside each modal component (would double-darken scanlines and vignette over the background).

- **Decision 2: SQLite `json_each` Aggregation for Downloaded Release Types**
  - *Chosen Approach*: Aggregate downloaded release tags directly inside the SQLite catalog summary query using `json_each(release_tags_json)` (with clean fallback to `release_type` / `Retail ROM` when untagged) and include `releaseTypes` in the real-time status snapshot.
  - *Why*: Reflects multi-tagged releases accurately (e.g., a title that is both an *English Translation* and a *Hack*), updates automatically via SSE whenever new downloads finish, and requires zero extra client API requests.
  - *Alternatives Considered*: Client-side counting from paginated `/api/items` responses (would only reflect the first 150 items instead of the entire downloaded repository).

- **Decision 3: Custom Zero-Dependency SVG + Pointer Math & Server Transfer Ring Buffer**
  - *Chosen Approach*: Build a dedicated SVG Grafana chart engine bound natively to `--color-crt-phosphor` CSS variables, backed by a 90-sample server transfer speed buffer and 120-sample rate-limiter buffer.
  - *Why*: Delivers instant 60fps crosshair tracking, immediate `Green` / `Amber` / `Cyan` palette reactivity, and persistent live curves across tab switches or reloads.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Backend Scraper Orchestrator, Rate Limiter & SQLite Aggregator             │
│  ├─ Rate Limiter Ring Buffer (120 samples: delayMs, latencyMs, throttled)  │
│  ├─ Transfer Speed Ring Buffer (90 samples: bytesPerSec, file, system)     │
│  ├─ SQLite Totals + Systems + Downloaded Release Types (json_each tags)    │
│  └─ Streams live updates via SSE ('status' & 'transfer') + /api/status     │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Root Viewport Stacking Hierarchy                                           │
│  ├─ z-[80] Fullscreen Artwork Lightbox (clean, above CRT glass, no bloom)  │
│  ├─ z-[60..62] Pointer-Safe CRT Glass (Grille · Scanlines · Vignette)      │
│  ├─ z-50 Slide-Over Drawers & Modals (Game Detail · SD Card Exporter)      │
│  └─ z-0..40 Main Workspace, Sticky Header & Sync Monitor                   │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ Sync View (Balanced 2-Column Grid: Telemetry Deck + Recent Sync Runs)      │
│  └─ 6-Slide Telemetry Graph Deck                                           │
│       ├─ Controls: [Pacing|Speed|Runs|Consoles|Types|Latency]              │
│       │            + [‹] [›] + [Auto Cycle (hover-paused)]                 │
│       ├─ Interactive SVG / Bar Viewport:                                   │
│       │    • Pointer X/Y -> Nearest Sample or Category Snapping            │
│       │    • Dashed Crosshair + Active Point Rings / Row Focus             │
│       │    • Edge-Flipping Multi-Series Grafana Tooltip                    │
│       └─ Tabular Summary Legend (min · avg · max · last / share % / bytes) │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Interactive State Mapping

- **Downloaded Release Type Breakdown (`releaseTypes`)**: Added to `ServiceStatusSnapshot`, sorted by `downloadedItems DESC, totalBytes DESC`, containing `{ typeName, downloadedItems, totalItems, totalBytes }` for downloaded releases.
- **Transfer Telemetry Sample (`transferHistory`)**: Sampled at ~500ms intervals during active downloads on the server and updated live in client state when `transfer` SSE events arrive.
- **Deck Persistence (`rgt_sync_telemetry_deck_v1`)**: Stores `{ activeSlide, autoCycle }` in `localStorage`, pausing the `8s` interval whenever the pointer is inside the chart inspection surface.
