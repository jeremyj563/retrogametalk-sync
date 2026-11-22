---
title: Favorites, Custom Collections & Per-Game Sync Rule Overrides
status: implemented
created_at: 2026-11-22T20:35:00Z
implemented_at: 2026-11-22T21:55:00Z
---

# Favorites, Custom Collections & Per-Game Sync Rule Overrides

Introduce personal curation to RetroGameTalk Sync with **Favorites (`⭐`)**, named **Collections / Loadouts** (e.g., *"Miyoo Mini Essentials"*, *"SNES RPG Backlog"*, *"Co-op Night"*), 1-click **Install Collection to `<Device>`**, and per-game **Pin** / **Ignore** overrides for Sync Rules.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Favorites vs. Custom Collections**: Keep **Favorites** as a dedicated 1-click star toggle on every game (stored as a built-in flag or system collection) alongside unlimited user-created **Collections** (many-to-many with `catalog_releases`).
> - **Collection-to-Device Sync**: Each collection supports both **Queue Missing Downloads** (for catalog-only entries) and **Install Collection to `<Device>`** (streaming all downloaded games in the collection in one click).
> - **Per-Game Sync Rule Overrides**:
>   - **Pin to Sync**: Forces Full Sync & Incremental Sync to download and keep this release updated even if its console or release type falls outside global Sync Rules.
>   - **Ignore in Sync**: Excludes this specific release from automatic Full/Incremental Sync downloads without affecting manual on-demand downloads.

---

## 1. Overview & Core Concept

When browsing a catalog of thousands of ROMs, fan translations, and hacks, filters alone are ephemeral—users still have to mentally remember which 35 games belong on their travel handheld or which RPGs they plan to play next. Meanwhile, global Sync Rules are intentionally broad (Console + Release Type), making it awkward to pull in one beloved PlayStation translation without enabling the entire PlayStation console, or to skip a handful of giant unwanted releases inside an enabled console.

### Core Outcomes
1. **One-Click Favorites**: Star/unstar any release from Catalog cards, List rows, or Game Details, with an instant **Favorites (`N`)** toolbar toggle.
2. **Custom Collections / Handheld Loadouts**: Create, rename, and delete named collections; add/remove single games or bulk-selected Catalog items; filter the Catalog by any collection.
3. **One-Click Collection Actions**: From a collection's header strip, queue all un-downloaded games in that collection or **Install Collection (`N`) to `<Device>`** in one click.
4. **Per-Game Sync Overrides (`Pin` / `Ignore`)**: Override global Sync Rules on individual games from Game Details (`More` menu) or bulk selection, respected seamlessly by Sync Preflight, Full Sync, Incremental Sync, and Catalog's `Matches Sync Rules` filter.

---

## 2. User Experience & Visual Design

### Catalog & Game Details Integration
- **Catalog Cards & List Rows**:
  - Subtle hover/active star icon in the top-right corner of box-art cards and list rows for instant favoriting without opening the drawer.
  - Compact `Collection` dropdown filter in the Catalog filter bar (showing `Favorites` first, followed by custom collections with item counts and a `+ New Collection…` action).
- **Bulk Selection Bar**:
  - Add **`+ Collection`** popover button allowing multi-selected games to be added to (or removed from) any collection, starred, or marked **Pin / Ignore**.
- **Collection Active Banner**:
  - When viewing a specific collection in the Catalog, render a crisp contextual strip above the grid showing the collection name, total game count, downloaded/installed breakdown, and 1-click actions: **Queue Missing (`N`)**, **Install to `<Device>` (`N`)**, **Rename**, and **Delete Collection**.
- **Game Details Drawer**:
  - Star toggle in the drawer header beside the title.
  - Compact collection chips (`+ Add to Collection`) below the metadata strip.
  - Sync override selector in `More` menu: `Default (Follow Sync Rules)` / `Pin (Always Sync)` / `Ignore (Skip in Auto-Sync)`.

---

## 3. Architecture & Technical Approach

### Database Schema (Next SQLite Migration)
- `user_collections`: `id INTEGER PRIMARY KEY`, `name TEXT NOT NULL UNIQUE`, `description TEXT`, `sort_order INTEGER DEFAULT 0`, `created_at TEXT`, `updated_at TEXT`.
- `user_collection_items`: `collection_id INTEGER NOT NULL`, `release_id INTEGER NOT NULL`, `added_at TEXT NOT NULL`, `PRIMARY KEY (collection_id, release_id)` with `ON DELETE CASCADE` on both FKs.
- Add columns to `catalog_releases`:
  - `is_favorite INTEGER NOT NULL DEFAULT 0` (indexed)
  - `sync_override TEXT NOT NULL DEFAULT 'default'` (`'default' | 'pin' | 'ignore'`, indexed)

### Backend API (`server.ts`, `src/server/db.ts`, `src/shared/syncRuleMatcher.ts`)
- `GET /api/collections` — list collections with item counts, downloaded counts, and estimated sizes.
- `POST /api/collections` / `PATCH /api/collections/:id` / `DELETE /api/collections/:id` — CRUD.
- `POST /api/collections/:id/items` & `DELETE /api/collections/:id/items` — bulk add/remove `releaseIds`.
- `POST /api/items/favorite` — toggle favorite for one or more `releaseIds`.
- `POST /api/items/sync-override` — set `'default' | 'pin' | 'ignore'` for one or more `releaseIds`.
- Extend `GET /api/items`, `GET /api/items/ids`, and `computeSyncPreflightSummary` to support `favoriteOnly`, `collectionId`, and `sync_override` (`pin` always matches Sync Rules; `ignore` never matches automatic Sync Rules).

### Frontend
- New `CollectionPickerPopover.tsx` component reused by Catalog bulk bar and Game Details.
- Extend `CatalogPanel.tsx` filter bar, active filter tokens, and collection action header.
- Extend `GameDetailDrawer.tsx` header star + collection chips + `More` sync override toggle.

---

## 4. Verification Plan
- Unit tests for SQLite migration, collection CRUD, cascade deletion, and `syncRuleMatcher` Pin/Ignore precedence across Full Sync, Incremental Sync, Preflight, and Catalog `Matches Sync Rules`.
- Verify bulk-selecting 10 games → adding to a new collection → filtering by that collection → clicking **Install to `<Device>`** streams all downloaded games in the collection cleanly.
