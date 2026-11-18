---
title: Decoupled Catalog Indexing & On-Demand ROM Acquisition
status: implemented
created_at: 2026-11-18T14:26:42Z
implemented_at: 2026-11-18T14:43:00Z
---

# Decoupled Catalog Indexing & On-Demand ROM Acquisition

RetroGameTalk Sync shifts from a download-coupled crawler to an always-ready browseable game library: authenticating automatically populates the Catalog via fast WordPress REST indexing (`available` status), puts single-click, multi-select, and filtered bulk downloads directly in the user's hands, and keeps scheduled incremental syncs automatically downloading new releases that match configured rules.

## User Review & Critical Decisions

> [!IMPORTANT]
> All foundational product decisions were confirmed during clarification and govern this architecture:
> - **Auto-Index Scope Upon Authentication**: **Filtered consoles first, full site on click** — connecting or saving valid credentials immediately indexes the user's filtered/target consoles in the background, with a one-click control to expand indexing across all remaining discovered consoles.
> - **Scheduled Incremental Behavior**: **Auto-download new releases matching rules** — scheduled incremental runs keep the entire catalog up to date while automatically downloading only new/updated releases matching the active System Filter and Release Type filters (with an explicit setting to pause auto-downloads when index-only mode is desired).
> - **Cover Art for Un-Downloaded Games**: **Lazy-cache visible thumbnails cleanly** — the server proxies and caches remote cover artwork into the local asset cache only as cards scroll into view, keeping upfront indexing fast and respectful of RGT rate limits.
> - **Catalog Download Triggers**: **Single-click, multi-select, and Download Filtered** — users can queue any `available` game directly from its card/row/drawer, queue checked selections via a smooth contextual action bar, or trigger **Download Filtered** (including **Download All** for one or more selected consoles) with size/count confirmation.

---

## 1. Overview & Core Concept

- **What It Does**: Separates **Catalog Discovery** from **Archive Downloading**. As soon as credentials verify against RetroGameTalk, a lightweight background indexer queries WordPress REST pages (100 releases per request) to populate game titles, systems, release tags, regions, languages, genres, publishers, estimated file sizes, and remote artwork pointers directly into the local database with `available` status. Users browse, filter, preview lazy-cached box art, and selectively queue individual games, multi-select batches, or entire filtered systems—while scheduled incremental syncs continue discovering updates and automatically mirroring newly released games matching the user's rules so ready-to-install ROMs are waiting whenever the user opens the app.
- **Target Audience / Persona**: Retro handheld collectors, Flashcart/ODE owners, and self-hosted ROM preservationists running RetroGameTalk Sync across single-console sets or curated multi-system libraries who want instant visibility without blindly mirroring terabytes upfront.
- **Key Value**: Time-to-browse drops from hours/gigabytes to seconds. Users gain full library visibility before committing disk space, retain one-click "Download Whole Console" capability via filtered bulk queueing, and keep hands-free automated incremental downloads active on schedule.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Instant Library Hydration on Connect**
   - User verifies credentials in System Settings (or restarts an already-authenticated instance with unindexed target systems).
   - A mellow, non-intrusive **Catalog Indexer** status strip fades open in the Catalog toolbar and Sync Rules panel showing the active console, indexed page count, and total cataloged titles.
   - Targeted consoles (configured via System Filter, or top priority consoles if unfiltered) index first; once complete, a subtle inline action (`Index All Remaining Consoles`) lets the user expand indexing across the rest of the site whenever desired.
2. **Browsing Un-Downloaded (`Available`) Releases & Lazy Artwork**
   - Newly indexed releases appear smoothly in both Box-Art Grid and Table views as `Available` without inflating the `Mirrored` or `Failed / Needs Retry` counters.
   - As `Available` cards enter the viewport, an `IntersectionObserver` resolves their box-art endpoint (`/api/items/:id/asset?kind=cover&lazy=1`); the server fetches and caches the thumbnail under bounded concurrency/rate pacing, and the image fades in smoothly (`320ms` ease-out) over a crisp phosphor-framed console placeholder—never shifting layout geometry.
3. **Granular, Multi-Select, and Filtered Bulk Downloading**
   - **Single Click**: Clicking `Download` on a card, table row, or inside the Game Detail Drawer transitions that release smoothly from `Available` -> `Queued` -> `Downloading` -> `Downloaded`, displaying real-time byte stream and percentage telemetry.
   - **Multi-Select Action Dock**: Checking 1 or more releases reveals **`Queue Downloads (N)`**, alongside **`Express Install`**, **`Install to Storage`**, and **`Delete`**.
   - **Download Filtered / Entire Console(s)**: Filtering by one or more Systems (plus optional Types/Regions/Languages) exposes a **`Download Filtered`** / **`Download All`** action that opens a smooth inline `.crt-accordion-grid` confirmation strip summarizing release count, skipped already-downloaded count, and estimated disk impact (`~Est. Size`) before queueing a dedicated download job.
4. **Automated Scheduled Incremental Sync**
   - When the cron schedule fires, Incremental Sync fetches newly published or modified WP REST records since the watermark:
     - Releases matching the configured System Filter + Release Type rules (and when `autoDownloadNewReleases` is enabled) automatically enter the download queue and mirror to disk cleanly.
     - Newly discovered releases outside automated download rules are still cataloged as `Available`, ready for manual browsing later.

### Visual Identity & Theme & Motion

- **Mellow, Non-Snappy Timing Tokens**:
  - Smooth `.crt-accordion-grid` / opacity transitions (`280ms–360ms` with `cubic-bezier(0.16, 1, 0.3, 1)`), preventing abrupt height jumps or snappy pops.
  - Lazy-cached cover thumbnails cross-fade from placeholder to loaded artwork over `320ms` (`opacity` transition only) inside fixed `aspect-[3/4]` / `w-8 h-10` frames.
  - Background Catalog Indexer progress bar integrates with `[data-crt-motion]` (`off` | `low` | `medium` | `high` | `ultra`) and `@media (prefers-reduced-motion: reduce)` fallbacks.

---

## 3. Architecture & Technical Summary

- **Schema Migration (`v18`, `decoupled_catalog_indexing`)**:
  - Added `auto_download_new_releases` (default `1`) and `system_index_state_json` to `scraper_config`.
  - Added `size_is_estimated` to `catalog_releases` and expanded rollup/totals queries to treat `'available'` as a first-class un-downloaded status excluded from `failedItems` and `totalBytesMirrored`.
- **Shared & Server Modules**:
  - `src/shared/fileSize.ts` (`parseHumanFileSizeToBytes`, `estimateDownloadHintsBytes`).
  - `src/server/rgtClient.ts` (`fetchCoverToFile`, `onPostsPage` page streaming & `totalPages`).
  - `src/server/orchestrator.ts` (`startCatalogIndex`, `stopCatalogIndex`, `ensureLazyCoverAsset`, `queueCatalogDownloads`, `executeDownloadQueue`, auto-index on startup/auth, and `autoDownloadNewReleases` incremental gate).
  - `server.ts` endpoints: `POST /api/catalog/index`, `POST /api/catalog/index/stop`, `POST /api/items/download`, `POST /api/items/:id/download-queue`, and `?lazy=1` support on `GET /api/items/:id/asset`.
- **Release Versioning**: `1.4.0` minor release synchronized across `package.json`, `k8s/charts/retrogametalk-sync/Chart.yaml`, and `CHANGELOG.md`.
