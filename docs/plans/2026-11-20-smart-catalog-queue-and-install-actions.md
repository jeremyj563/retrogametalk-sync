---
title: Smart Status-Aware Catalog Queue & Install Actions
status: implemented
created_at: 2026-11-20T19:33:55Z
implemented_at: 2026-11-20T19:38:00Z
---

# Smart Status-Aware Catalog Queue & Install Actions

Make the Catalog's **Queue Downloads**, **Download Filtered / Download All**, **Express Install**, and **Install to Storage Device** actions aware of each release's live download state—hiding actions that have zero eligible items, showing exact actionable counts on mixed selections with informative skip tooltips, and preserving accuracy across multi-page selections and live sync updates.

## User Review & Critical Decisions

> [!IMPORTANT]
> All three behavioral decisions below were confirmed during clarification and drive this implementation.

- **Confirmed Decision 1 — Zero-Eligible Behavior**: When zero selected items need downloading (such as all 41 selected games already downloaded), **hide** the `Queue Downloads` button instead of rendering a disabled zero-count button. Apply the same clean contextual hiding to `Download Filtered / Download All` when zero filtered items are queueable, and to `Express Install` / `Install to Storage Device` when zero selected items exist on disk.
- **Confirmed Decision 2 — Unified Action Scope**: Apply status-aware eligibility and exact counting across all three related action groups: bulk **Queue Downloads**, toolbar **Download Filtered / Download All**, and bulk **Express Install** / **Install to Storage Device**.
- **Confirmed Decision 3 — Mixed Selection Formatting**: Display the exact actionable count on the button label (for example, `Queue Downloads (4)` or `Express Install (6)`) and put the breakdown of skipped items (already downloaded, already queued, or not yet downloaded) into the hover tooltip.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces raw selection totals (`selectedIds.length`) and static filter toolbar presence with live status-aware eligibility classification across both single-page and cross-page Catalog selections.
- **Target Audience / Persona**: RetroGameTalk Sync operators curating, downloading, and exporting ROM sets from the Indexed Catalog—especially when filtering by console, download state, or sync rules and selecting batches across pages.
- **Key Value**: Eliminates confusing phantom download/install counts (like `Queue Downloads (41)` on 41 already-downloaded games or `Express Install (310)` on 310 un-downloaded releases), removes dead clutter from the bulk bar and toolbar, and guarantees clicks only dispatch truly eligible release IDs.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **All-Downloaded Selection (e.g., `Game Gear` + `Downloaded (41)`, all 41 selected)**:
     - Top toolbar hides `Download Filtered` because 0 filtered releases need downloading.
     - Bulk bar hides `Queue Downloads` and foregrounds the actions that actually apply: `Express Install (41)`, `Install to Storage Device (41)`, `Flag Installed`, `Delete Selected (41)`, and `Clear Selection`.
  2. **All-Undownloaded Selection (e.g., `Not Downloaded (310)`, all 310 selected)**:
     - Top toolbar displays `Download Filtered (310)`.
     - Bulk bar displays `Queue Downloads (310)`, `Delete Selected (310)`, and `Clear Selection`—hiding `Express Install` and `Install to Storage Device` since zero selected releases have ROM files on disk yet.
  3. **Mixed Selection (e.g., 10 selected: 4 `available`, 5 `downloaded`, 1 `queued`)**:
     - Bulk bar displays `Queue Downloads (4)` (tooltip: *"Queue 4 un-downloaded releases for background download (5 already downloaded, 1 already queued skipped)"*). Clicking queues only those 4 IDs.
     - Bulk bar displays `Express Install (5)` and `Install to Storage Device (5)` (tooltip notes 5 un-downloaded/queued releases skipped). Clicking sends only the 5 on-disk IDs to the storage installer.
  4. **Partial Releases**:
     - A `partial` release has some files already on disk and others missing, so it counts toward **both** `Queue Downloads` (to finish missing archives) and `Express Install` / `Install to Storage Device` (to install already-fetched files)—staying 100% consistent with backend queue logic.
  5. **Live Sync & Cross-Page Resilience**:
     - If a user clicks `Select All Filtered` across multiple pages, every off-page release's status is captured from the IDs index endpoint so counts stay exact even if the user later unchecks individual cards or navigates pages.
     - As background sync events complete downloads or enqueue items, visible and cross-page selection counts recalculate smoothly without losing selection state.
- **Visual Identity & Theme**:
  - Preserves the existing CRT Catalog toolbar and contextual bulk-selection bar styling (`crt-cta-beam`, phosphor/amber/crimson accents, tabular-nums counts) with zero new chrome—strictly cleaner contextual visibility matching how `Flag Installed` / `Unflag Installed` already appear only when applicable.
- **Interactive Feedback & Motion**:
  - Clicking `Download Filtered (N)` continues to open the smooth mellow confirmation accordion with estimated footprint and skip summary, and automatically closes if live updates drop the filtered queueable count to zero.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Single Shared Status Classification Taxonomy**
  - *Chosen Approach*: Align frontend selection classification 1-to-1 with the server's existing release eligibility rules:
    - **Queueable**: `available`, `failed`, `partial`
    - **Installable (On Disk)**: `downloaded`, `skipped`, `partial`
    - **Already In-Flight (Skipped by Queue)**: `queued`, `downloading`
  - *Why*: Guarantees the counts shown on buttons always match the exact items queued or sent to the storage installer, preventing "0 new downloads queued" surprises after clicking.
  - *Alternatives Considered*: Treating `queued` items as queueable or hiding `partial` items from install was rejected because it would contradict backend queue/install rules.
- **Decision 2: Server-Supplied `queueableFiltered` Count on Catalog Queries**
  - *Chosen Approach*: Compute the exact count of queueable releases matching the active Catalog filters right alongside existing facet counts during each catalog query, rather than firing a separate background request on every filter change.
  - *Why*: Existing `downloaded.notDownloaded` facet counts intentionally ignore the `Downloaded` / `Status` filter so toggle chips keep their numbers—meaning they cannot tell whether the *active* filtered view itself has queueable items. Returning a lightweight `queueableFiltered` count directly in the catalog response gives instant, zero-extra-RTT accuracy for `Download Filtered (N)`.
  - *Alternatives Considered*: Polling `/api/items/ids` on every keystroke/filter change was rejected to avoid redundant HTTP round-trips.
- **Decision 3: Status Cache + Cross-Page ID Breakdown for Multi-Page Selections**
  - *Chosen Approach*: Track a per-ID status map fed by visible catalog pages and by the cross-page `Select All Matching` IDs response (enriched with `alreadyQueuedIds` alongside the existing `queueableIds` and `downloadableIds`), and quietly re-sync off-page selection statuses when live catalog revisions arrive while cross-page items are selected.
  - *Why*: Lets users select all matching items across pages, uncheck specific games, paginate, or watch downloads finish live while every bulk action count stays 100% accurate.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Status Eligibility & Data Flow Diagram**:

```text
  Catalog Query (Active Filters)                Cross-Page Select All
               │                                           │
               ▼                                           ▼
  ┌──────────────────────────────┐        ┌───────────────────────────────────┐
  │ Catalog Facets & Page Rows   │        │ Filtered IDs Index                │
  │ • page items (+ live status) │        │ • ids                             │
  │ • facets.counts              │        │ • queueableIds (avail/fail/part)  │
  │   └─ queueableFiltered       │        │ • downloadableIds (dl/skip/part)  │
  └──────────────┬───────────────┘        │ • alreadyQueuedIds (q/dl-ing)     │
                 │                        └────────────────┬──────────────────┘
                 ▼                                         ▼
  ┌───────────────────────────────────────────────────────────────────────────┐
  │ Selection Status Cache (Map<itemId, status>) + Pure Selection Summarizer  │
  │   • queueableIds[]        -> Queue Downloads (N)    [hidden if 0]         │
  │   • installableIds[]      -> Express / Storage (M)  [hidden if 0]         │
  │   • skipped breakdowns    -> Hover tooltips (downloaded / queued / etc.)  │
  │   • queueableFiltered     -> Download Filtered (K)  [hidden if 0]         │
  └───────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Extend catalog facet counts with `queueableFiltered: number` (honoring all active filters including `downloaded`, `status`, `installed`, `syncRules`, `system`, and `search`).
  - Extend the filtered IDs index payload with `alreadyQueuedIds: number[]` alongside the existing `ids`, `queueableIds`, and `downloadableIds` arrays.
  - Introduce a pure, unit-tested selection summarizer utility that classifies statuses, extracts exact `queueableIds` and `installableIds`, and formats concise hover tooltip skip breakdowns.
- **Interactive Component & State Mapping**:
  - **Top Toolbar (`Download Filtered / Download All`)**: Hidden when `queueableFiltered === 0`; displays `Download Filtered (K)` or `Download All (K)` when `K > 0`, and auto-collapses its confirmation strip if live sync reduces `K` to `0`.
  - **Bulk Selection Bar (`Queue Downloads`)**: Hidden when `queueableIds.length === 0`; displays `Queue Downloads (N)` with a tooltip listing already-downloaded/queued skips, and dispatches only `queueableIds` on click.
  - **Bulk Selection Bar (`Express Install` & `Install to Storage Device`)**: Hidden when `installableIds.length === 0`; displays exact on-disk count `(M)` with a tooltip noting any un-downloaded selected releases skipped, and dispatches only `installableIds` on click.
  - **Verification & Release Hygiene**: Add unit tests for the selection summarizer, tooltip formatting, and backend `queueableFiltered` / `alreadyQueuedIds` queries; archive the plan and release as a lockstep `1.21.10` update upon execution.
