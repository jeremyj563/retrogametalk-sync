---
title: Catalog Sorting & Chronological Discovery
status: implemented
created_at: 2026-11-16T00:46:38Z
implemented_at: 2026-11-16T00:49:00Z
---

# Catalog Sorting & Chronological Discovery

Add fast, database-backed sorting across the Indexed Catalog (both Table and Box-Art Grid views), defaulting to **Newest site submissions first** and supporting alphabetical, file size, download/discovery recency, and original game release year ordering via a unified toolbar dropdown and synchronized clickable table column headers.

## User Review & Critical Decisions

> [!IMPORTANT]
> All core UX and sorting preferences from your review are locked in below.

- **Confirmed Default Sort**: **Newest site submissions first** (`publishedAt` descending, falling back gracefully to `remoteUpdatedAt` / `discoveredAt` when an older record lacks a publish date).
- **Confirmed Sort Modes**:
  - Site submissions (`Newest Submissions` / `Oldest Submissions`)
  - Alphabetical (`Title A → Z` / `Title Z → A`, case-insensitive)
  - File size (`Largest First` / `Smallest First`)
  - Sync activity (`Recently Downloaded` / `Recently Discovered`)
  - Original release era (`Release Year: Newest` / `Release Year: Oldest`, placing valid 4-digit years ahead of unparsed entries)
- **Confirmed Placement**: Unified sort selector in the Catalog toolbar (works across both Table and Box-Art Grid views) **plus** interactive clickable column headers in Table view that stay bidirectionally synced.
- **Open Choice (Recommended Default Applied)**: Changing filters (`Clear All Filters`) preserves your selected sort mode and persists it in browser storage alongside your layout preference (`Table` vs `Box-Art Grid`), rather than snapping back on every filter reset.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces the fixed internal insertion ordering (`id DESC`) of the Indexed Catalog with an explicit, whitelist-validated server sort parameter (`sort`) backed by indexed SQLite queries, paired with intuitive UI controls in both Table and Box-Art Grid layouts.
- **Target Audience / Persona**: Retro collectors and handheld/ODE power users browsing hundreds or thousands of indexed ROMs, hacks, translations, and disc sets who want newly added RetroGameTalk releases right at the top—or want to quickly hunt down massive multi-disc ISOs, browse alphabetically, or filter by era.
- **Key Value**: Because the Catalog paginates server-side (`150` items per query), performing sorting in SQLite before pagination guarantees accurate global ordering across the entire library rather than merely reordering the current page slice.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Zero-Friction Default Arrival**: Opening the Catalog loads **Newest Submissions** first automatically, surfacing the latest RetroGameTalk submissions immediately without manual clicks.
2. **Unified Sort Selector (Table & Box-Art Grid)**:
   - Positioned inline in the Catalog filter toolbar beside the status selector using the existing dark phosphor select styling (`bg-crt-bg`, `border-crt-border`, highlighted in `border-crt-phosphor/60 text-crt-phosphor` when changed from default).
   - Displays clear human-readable labels for all sort modes (`Newest Submissions`, `Oldest Submissions`, `Title (A → Z)`, `Title (Z → A)`, `File Size (Largest)`, `File Size (Smallest)`, `Recently Downloaded`, `Recently Discovered`, `Release Year (Newest)`, `Release Year (Oldest)`, `System (A → Z)`, `System (Z → A)`).
   - Switching between **Table** and **Box-Art Grid** preserves the active sort and triggers no redundant visual clutter.
3. **Clickable Table Column Headers (Table View)**:
   - Key headers in the Indexed Catalog table are interactive `<button>` controls with directional sort indicators (`ArrowUp`, `ArrowDown`, or muted `ArrowUpDown`):
     - **System**: Toggles `System (A → Z)` ↔ `System (Z → A)`.
     - **Release & Mirrored Path**: Toggles `Title (A → Z)` ↔ `Title (Z → A)`.
     - **Size**: Toggles `File Size (Largest)` ↔ `File Size (Smallest)`.
     - **Submitted / Downloaded / Discovered**: Clicking the right-hand column header toggles `Newest Submissions` ↔ `Oldest Submissions`.
   - Active column headers highlight cleanly in phosphor green (`text-crt-phosphor`).
4. **Contextual Row Date Clarity**:
   - When sorted by site submissions (or title/size/year/system), the timestamp cell displays the release's site submission date (`publishedAt`, with fallback to `remoteUpdatedAt` / `downloadedAt` / `discoveredAt`).
   - When sorted by **Recently Downloaded** or **Recently Discovered**, the cell reflects `downloadedAt` or `discoveredAt` accordingly.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Server-Side SQLite Sorting vs. Client-Side Array Sorting**: Executed inside SQLite via `ORDER BY` before `LIMIT` / `OFFSET` so global ordering holds across multi-hundred-release catalogs.
- **Decision 2: Strict SQL Sort Whitelist & Safe Fallback Coalescing**: Uses a fixed `Record<CatalogSortOption, string>` lookup (`normalizeCatalogSort`), coalesced timestamps, and numeric year extraction so missing dates/years never corrupt ordering.
- **Decision 3: Independent Sort Persistence & Schema Indexing (v6)**: Persists `sort` in `localStorage` independently of `activeFilterCount`, and adds SQLite indexes (`published_at`, `discovered_at`, `downloaded_at`, `title COLLATE NOCASE`, `file_size_bytes`).

---

## 4. Technical Architecture & Data Strategy

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                         Catalog View (Frontend)                           │
│  Toolbar Sort Dropdown  <── syncs `sort` state ──>  Clickable Table <th/> │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   │ GET /api/items?sort=...
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                   Express API & SQLite Query Engine (v6)                  │
│  normalizeCatalogSort(sort) -> CATALOG_SORT_ORDER_BY -> ORDER BY + LIMIT  │
└───────────────────────────────────────────────────────────────────────────┘
```
