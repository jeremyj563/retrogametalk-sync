---
title: Non-Destructive Local Disk Cleanup & Storage Guardrails
status: implemented
created_at: 2026-11-22T20:35:00Z
implemented_at: 2026-11-26T22:55:00Z
---

# Non-Destructive Local Disk Cleanup & Storage Guardrails

Separate **reclaiming local mirror disk space** from **deleting a catalog entry**, add safe bulk local-file eviction (preserving catalog metadata and device install history), and introduce disk-space pre-flight guardrails before large disc-based download queues can fill a volume.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Remove Local Files vs. Delete Catalog Entry**:
>   - **Free Space (Remove Local Files)** becomes the default cleanup action for downloaded games—deleting mirrored archive files from disk and resetting the release cleanly to `available` while keeping its Catalog entry, cover art, favorites/collections, and device install history intact.
>   - **Remove from Catalog & Disk** remains available only as an explicit destructive option (or for stale/orphaned entries) since indexed RGT posts otherwise reappear on the next catalog refresh anyway.
> - **Sync Rule Interaction on Evicted Games**: When a user explicitly frees disk space for a game that matches active Sync Rules, optionally offer a checkbox *"Also ignore in future Auto-Syncs"* (or note that Full Sync will re-download it unless excluded/ignored) so evicted gigabytes don't unexpectedly re-download on the next scheduled run.
> - **Low-Disk Guardrail**: Warn before queueing a batch whose estimated byte footprint exceeds remaining free disk space (minus a configurable safety reserve, e.g. `2 GiB`), and automatically pause active downloads if free space drops below the reserve threshold.

---

## 1. Overview & Core Concept

Today, `DELETE /api/items/:id` deletes both the downloaded archive(s) on disk **and** the entire `catalog_releases` row from SQLite. For users with finite SSD/NAS space—especially once mirroring CD/DVD systems like Sega CD, PS1, Dreamcast, GameCube, or PS2—this creates two problems:
1. There is no clean way to say *"I already installed this 1.2 GB ISO to my handheld (or decided I don't need it mirrored right now)—delete the local archive to free space, but keep it browsable in my Catalog."*
2. Queueing a filtered batch of disc-based games gives an estimated size, but doesn't warn when the batch exceeds the actual free bytes left on `DOWNLOAD_DIR`.

### Core Outcomes
1. **Non-Destructive "Free Space" Action**: Remove local archive files for a single game or bulk-selected games while resetting `status` to `available` and preserving cover art, metadata, collections, and install tracking.
2. **Storage Footprint Cleanup Helpers**: Quick-jump from the **Storage** telemetry readout (or Catalog Stats) straight into Catalog sorted by `File Size (Largest)` + `Downloaded`, making it trivial to reclaim dozens of gigabytes in seconds.
3. **Pre-Queue & Runtime Disk Guardrails**: Compare estimated queue size against live `status.storage.diskFreeBytes` in both **Download Filtered** confirmation and **Sync Rule Readiness**, warning clearly before starting and halting active transfers gracefully if disk free space drops below a configurable floor.

---

## 2. User Experience & Visual Design

### Game Details & Catalog Bulk Bar
- **Game Details `More` Menu**:
  - For downloaded/partial releases, show **`Remove Local Files (Free 642 MB)`** (amber) cleanly separated from destructive **`Delete from Catalog & Disk`** (crimson).
  - Confirmation prompt displays exact reclaimed bytes and confirms: *"Catalog metadata and device install history will be preserved; you can re-download anytime."*
- **Catalog Bulk Selection Bar**:
  - When selected items include downloaded releases, show **`Free Space (N · 4.8 GB)`** alongside `Queue Downloads` and `Install to <Device>`.
  - Clicking reveals an inline confirmation bar (`Confirm Free 4.8 GB from N games · Cancel`) before evicting files.

### Disk Space Guardrail Banner
- In **Catalog > Download Filtered Confirmation** and **Monitor / Sync Rules > Queue Pending**:
  - If `estimatedQueueBytes > diskFreeBytes - reserveBytes`, show an amber warning inline:
    - `Estimated download (~42.3 GB) exceeds available disk space (18.4 GB free after 2 GB safety reserve).`
- In **System Settings > Local Mirror Paths**:
  - Add an optional `Minimum Free Disk Space Reserve (GB)` setting (default `2 GB`, overridable via `SCRAPER_MIN_FREE_DISK_GB`).

---

## 3. Architecture & Technical Approach

### Backend (`server.ts`, `src/server/db.ts`, `src/server/orchestrator.ts`)
1. **New Endpoint `POST /api/items/evict-files`**:
   - Accepts `{ ids: number[], ignoreInSync?: boolean }`.
   - Deletes each release's mirrored archive file(s) (and any orphaned `.part` / `.part.meta.json` files) safely within `DOWNLOAD_DIR`, prunes empty release/system directories, resets `catalog_release_files` rows (preserving download hints or clearing file status to `available`), recomputes release rollup to `available`, and preserves `catalog_releases` metadata, cover cache, and install columns.
   - Returns `{ evictedItemsCount, deletedFilesCount, freedBytes }`.
2. **Runtime Free-Space Guard (`src/server/orchestrator.ts`)**:
   - Before starting each queued download (and before allocating multi-chunk sparse files), check `statfsSync(downloadDir)` against `minFreeDiskBytes`.
   - If insufficient space remains, gracefully stop the run with a clear, actionable `warn`/`error` Activity Log message instead of hitting `ENOSPC` mid-write.

### Frontend (`src/components/CatalogPanel.tsx`, `GameDetailDrawer.tsx`, `SystemSettingsPanel.tsx`)
- Wire `Free Space` single + bulk flows with exact reclaimed byte totals and instant Catalog/storage status refresh.
- Add free-space comparison warning in `filteredDownloadConfirm` strip.

---

## 4. Verification Plan
- Unit tests for `evictLocalFilesForReleaseIds` verifying local archive removal, `.part` cleanup, `status -> available` reset, preservation of `lastInstalledAt` / cover art / metadata, and path-traversal protection within `DOWNLOAD_DIR`.
- Unit tests for disk-space threshold evaluation (`freeBytes - reserveBytes < estimatedBytes`).
- End-to-end test: download a test release → click **Free Space** → confirm file disappears from disk, storage usage drops, and game remains visible in Catalog as `Not Downloaded` (`available`) with install history intact.
