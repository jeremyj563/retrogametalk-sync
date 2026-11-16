---
title: Multi-Select Catalog Filtering & Active Filter Bar
status: implemented
created_at: 2026-11-16T03:50:15Z
implemented_at: 2026-11-16T03:56:20Z
---

# Multi-Select Catalog Filtering & Active Filter Bar

Upgrades the Catalog toolbar from single-value `<select>` menus to **multi-select searchable checkbox dropdowns** across **all seven metadata dimensions**—complete with **Any / All** match-mode toggles on multi-tag fields, live option item counts, and a **removable active-filter summary bar** for rapid library discovery and bulk SD card curation.

---

## User Review & Critical Decisions

> [!IMPORTANT] Built around your confirmed preferences:
> - **7 Multi-Select Dimensions**: Multi-selection across all 6 existing filters (**Systems**, **Types**, **Genres**, **Regions**, **Languages**, **Statuses**) plus **Release Sources**.
> - **Flexible Match Logic (`Any` vs. `All`)**: Selecting multiple values matches **Any (`OR`)** by default within each filter (and **All (`AND`)** across separate filter categories), while multi-tag filters (**Types**, **Genres**, **Regions**, **Languages**, **Sources**) include an inline **Any | All** toggle so you can either broaden results or require every chosen tag simultaneously (e.g., *English Translation* **AND** *Hack*).
> - **Searchable Checkbox Popovers + Active Filter Bar**: Each filter button opens a searchable checkbox menu with tabular item counts, paired with a dedicated removable active-filter strip beneath the controls for one-click pruning or full reset.

---

## 1. Overview & Core Concept

- **What It Does**: Lets operators combine any number of console systems, ROM/release types, genres, regions, languages, release sources, and transfer statuses in a single Catalog query—both for browsing/playing and for selecting cross-console batches to send directly to an SD card.
- **Target Audience / Context**: Retro library curators filtering multi-console handheld sets (e.g., *SNES + GBA + Genesis* RPGs in *USA or English Translation*, excluding failed transfers) without running repetitive one-system-at-a-time searches.
- **Key Value**: Turns rigid one-value dropdowns into a fast, faceted query builder while keeping the high-density CRT dashboard toolbar compact and single-line.

---

## 2. User Experience & Visual Design

### A. Key User Flows

1. **Multi-Select Searchable Popover Flow**:
   - Clicking any filter trigger button (`Systems`, `Types`, `Genres`, `Regions`, `Languages`, `Sources`, `Statuses`) opens an anchored popover panel without shifting table/grid layout.
   - Typing in the popover's quick search input (`Filter options...`) narrows the checkbox list immediately; keyboard `Escape` or clicking outside closes the menu cleanly.
   - Checking or unchecking options updates the Catalog table or Box-Art Grid live via SQLite-backed queries, keeping bulk-selection checkboxes scoped accurately to matching items.
   - Multi-tag popovers (`Types`, `Genres`, `Regions`, `Languages`, `Sources`) display a compact **Match: Any | All** segmented switch in the popover header when you want intersection (`AND`) vs. union (`OR`) matching, alongside quick **Select Visible** and **Reset** actions.
2. **Active Filter Summary & Quick Removal Flow**:
   - Whenever any search term or filter values are active, a clean secondary row appears inside the Catalog toolbar listing each active selection as a compact interactive removal button (e.g., `System: SNES ×`, `Type (All): Hack ×`, `Language: English ×`) with **Clear All (`N`)** aligned to the right.
   - Clicking an individual filter token removes only that value; clicking **Clear All** resets search, all seven filter selections, and match modes in one action.

### B. Visual Identity & CRT Dashboard Discipline

- **Aesthetic & Surface Hierarchy**: Matches the dark CRT monitoring console (`bg-crt-bg`, `bg-crt-surface`, `border-crt-border`, `border-crt-border-strong`) with single-elevation popover surfaces (`z-40`, sitting naturally beneath the `z-[60..62]` CRT Scanlines, Aperture Grille, and Vignette glass).
- **Color & Contrast (`60-30-10` Discipline)**:
  - Inactive filter triggers remain neutral (`border-crt-border text-crt-text`).
  - Active filter triggers highlight with crisp phosphor borders (`border-crt-phosphor/60 text-crt-phosphor`) and a tabular count summary (e.g., `Systems (3)` or `SNES` when 1 is selected).
  - Semantic amber (`text-crt-amber`) is reserved for the `Clear All` reset control so primary phosphor accents stay focused on active selections.
- **Typography & Tabular Alignment**:
  - Trigger buttons, option labels, and active filter controls enforce single-line layout (`whitespace-nowrap shrink-0` with `truncate` max-width safeguards).
  - Every option row displays right-aligned `font-mono tabular-nums` release counts so curators can see archive distribution before clicking.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Backed SQLite Multi-Value Filtering (`Any` & `All`) vs. Client-Side Filtering**
  - *Chosen Approach*: Extend the `/api/items` SQLite query builder to accept multi-value arrays and per-facet match modes (`any` | `all`), executing parameterized `IN (...)` clauses for scalar columns (`system_name`, `status`) and `EXISTS` / `COUNT(DISTINCT value)` subqueries over `json_each(...)` for JSON array columns.
  - *Why*: Ensures accurate `totalItems` counts, proper sorting, and complete results across thousands of indexed releases rather than filtering only the first 150 loaded rows in the browser.
  - *Alternatives Considered*: Filtering loaded items in React memory (would break pagination/limit totals and miss matching releases beyond row 150).

- **Decision 2: Live Facet Option Counts Included in Catalog Query Payload**
  - *Chosen Approach*: Aggregate distinct option counts for `tags`, `genres`, `regions`, `languages`, `sources`, and `statuses` in SQLite alongside `facets` so every checkbox row displays how many catalog releases carry that attribute.
  - *Why*: Prevents "zero-result guessing" in long facet lists like Genres, Languages, or Sources while adding negligible overhead on local SQLite WAL reads.
  - *Alternatives Considered*: Showing counts only on `Systems` and plain uncounted strings on all other dropdowns (inconsistent UX).

- **Decision 3: Seamless `localStorage` State Migration**
  - *Chosen Approach*: Automatically upgrade any previously saved single-string preferences (e.g., `systemFilter: "SNES"`) into the new multi-select array structure on load.
  - *Why*: Preserves existing saved Catalog preferences without requiring manual storage clearing.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ Catalog Toolbar & Multi-Select State (Persisted in localStorage)           │
│  ├─ Search Input + Sort Selector + Table/Box-Art Grid Toggle               │
│  ├─ 7 Searchable Multi-Select Popovers:                                    │
│  │    • Scalar (Any/OR): [Systems] · [Statuses]                            │
│  │    • Multi-Tag (Any/OR or All/AND): [Types] · [Genres] · [Regions]      │
│  │                                     [Languages] · [Sources]             │
│  └─ Removable Active Filter Bar:                                           │
│       • Individual value removal buttons + match-mode indicator + Clear All│
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
                                      ▼  GET /api/items (repeated/CSV params + match modes)
┌────────────────────────────────────────────────────────────────────────────┐
│ Express API & SQLite Parameterized Faceted Query Engine                    │
│  ├─ Scalar Filters:                                                        │
│  │    • system_name IN (?, ?, ...)                                         │
│  │    • status IN (...)  [expands 'needs_retry' -> 'failed', 'partial']    │
│  ├─ JSON Array Filters (json_each on tags, genres, regions, langs, sources)│
│  │    • mode = 'any' -> EXISTS (... WHERE value IN (?, ...))               │
│  │    • mode = 'all' -> (SELECT COUNT(DISTINCT value) ... ) = N            │
│  └─ Facet & Count Aggregator -> returns items + total + facets + counts    │
└────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Interactive State Mapping

- **Filter State Model**:
  - `systems: string[]`
  - `statuses: string[]` (supports `downloaded`, `needs_retry`, `partial`, `failed`, `queued`, `downloading`)
  - `tags: string[]` + `tagsMode: 'any' | 'all'`
  - `genres: string[]` + `genresMode: 'any' | 'all'`
  - `regions: string[]` + `regionsMode: 'any' | 'all'`
  - `languages: string[]` + `languagesMode: 'any' | 'all'`
  - `sources: string[]` + `sourcesMode: 'any' | 'all'`
- **Popover Interaction & Accessibility**:
  - Only one filter popover stays open at a time; opening another automatically closes the previous one.
  - Auto-focuses the internal option search input when opened on desktop, supports keyboard `Escape` dismissal, and resets its internal option search string on close.
  - Preserves selected options at the top or clearly checked even if a newly synced catalog snapshot hasn't refreshed facets yet, ensuring any active filter can always be unchecked or cleared.
