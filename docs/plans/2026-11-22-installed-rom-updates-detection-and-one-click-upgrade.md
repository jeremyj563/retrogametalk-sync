---
title: Installed ROM Update Detection & One-Click Device Upgrades
status: planned
created_at: 2026-11-22T20:35:00Z
implemented_at: null
---

# Installed ROM Update Detection & One-Click Device Upgrades

Close the loop for actively updated RetroGameTalk fan translations and ROM hacks by automatically detecting when a release already installed on a handheld/storage device has received a newer version on RGT, surfacing clear **Update Available** indicators in the Catalog, and offering a 1-click **Update Outdated on `<Device>`** batch upgrade workflow.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirm the following design choices before implementation:
> - **Update Detection Signal**: A release is flagged as **Update Available** when it is marked installed on a device (`lastInstalledAt` is set) AND either its newest mirrored file (`downloadedAt`) or RGT's `remoteUpdatedAt` is newer than `lastInstalledAt` (with optional filename/version comparison when a device is mounted).
> - **Automatic Superseded ROM Cleanup**: When running a 1-click device upgrade, the installer automatically deletes the older version file on the mounted device (using existing `findUpgradeCandidateOnCard` stem matching) once the new ROM finishes streaming cleanly.
> - **Auto-Download vs. On-Demand Queue**: If a release has `remoteUpdatedAt > lastInstalledAt` but the newer archive hasn't been downloaded locally yet, offer a 1-click **Download & Update** step (or queue all outdated updates first).

---

## 1. Overview & Core Concept

RetroGameTalk's greatest strength is its living library of fan translations, MSU-1 patches, bugfix hacks, and QoL improvements that regularly jump from `v1.0` to `v1.2`, `v2.0`, etc. Today, RGT Sync tracks `lastInstalledAt` and `lastInstalledDevice`, and can detect an older file on a mounted SD card *only* after the user manually navigates to that specific game and initiates an install.

As a result, players have no easy way to answer the question: **"Which games already sitting on my handheld have received an update on RetroGameTalk since I last copied them over?"**

### Core Outcomes
1. **Instant Drift Visibility**: Any installed release whose local download or RGT timestamp is newer than its device install timestamp displays a subtle **Update Available** indicator (amber accent) in Catalog cards, List rows, and Game Details.
2. **Dedicated Catalog Filter**: Add an **Updates Available (`N`)** quick filter alongside `Installed` / `Not Installed` so users can immediately isolate every outdated game across their library.
3. **One-Click Batch Upgrade**: When a storage device is mounted, surface an **Update Outdated (`N`) on `<Device>`** action in both the Sidebar Storage Drive Bay and the Catalog toolbar that runs all eligible upgrades in one click via the existing async `BulkInstallDock` pipeline.
4. **Safe Atomic Replacement**: Stream the new ROM to the mounted device first, verify write completion, remove the superseded older-version file (when the filename changed, e.g., `v1.1` → `v1.2`), and advance `lastInstalledAt`.

---

## 2. User Experience & Visual Design

### Surfaces & Interactions
- **Catalog Filter Bar**:
  - When 1+ installed releases have newer versions, show a contextual **Updates (`N`)** toggle button next to `Installed` / `Not Installed`.
  - Grid cards & List rows for outdated installed games show `Update` (amber) on the 1-click device button instead of `Reinstall`, with tooltip detailing the timestamp/version change.
- **Storage Device Sidebar Dock**:
  - When mounted and outdated games exist for the current device, display a compact inline strip: `N update(s) ready` + **Update All (`N`)** button.
- **Game Details Drawer**:
  - When a game is outdated relative to the mounted device, promote the primary CTA to **Update on `<Device>`** and show a concise comparison line (`Installed Mar 12 · Updated on RGT Apr 04`).
- **Bulk Install Dock / Review Modal**:
  - Highlight upgraded rows distinctly (`Upgraded · Replaced v1.1`) in the completion summary.

```
Mounted Device + Delta Catalog/Sync Completed
                     │
                     ▼
   Query releases where installed AND (latest_file_downloaded_at > last_installed_at
                                       OR remote_updated_at > last_installed_at)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   Mirrored locally          Metadata newer on RGT
   (ready to stream)         (needs local re-download)
        │                         │
        ▼                         ▼
[Update All on <Device>]    [Queue Updates (N)]
   Streams new ROM,            Downloads updated archives,
   removes old version file,   then promotes to Ready to Update
   updates last_installed_at
```

---

## 3. Architecture & Technical Approach

### Shared & Backend
1. **Update Drift Derivation (`src/shared/deviceInstallUpdates.ts`)**:
   - Pure helper `classifyInstalledUpdateState(item)` returning `'up_to_date' | 'update_ready_local' | 'update_available_remote' | 'not_installed'` using `lastInstalledAt`, max downloaded file `downloadedAt`, and `remoteUpdatedAt` (with a small grace threshold so same-second writes never false-positive).
   - Store `last_installed_file_id` and `last_installed_filename` (new SQLite migration) so version/file drift is exact even if `remoteUpdatedAt` gets touched for a description-only edit on WordPress.
2. **Catalog Query & Facets (`src/server/db.ts`, `server.ts`)**:
   - Extend `GET /api/items` and `GET /api/items/ids` with `installedFilter=outdated` (or `updateAvailable=true`).
   - Include `facets.counts.installed.outdated` so toolbar counts stay accurate across active filters.
   - Extend `POST /api/items/installed` to accept and persist `installedFileId` and `installedFilename` alongside `deviceLabel`.

### Frontend
1. **`src/hooks/useBulkStorageInstaller.ts`**:
   - Pass `installedFileId` + `installedFilename` when reporting successful installs to `/api/items/installed`.
   - Add `upgradeOutdatedItems(itemIds)` convenience wrapper that runs Express Install with `overwriteExisting: true` and `replaceOlder: true` enabled automatically.
2. **`src/components/CatalogPanel.tsx`, `GameDetailDrawer.tsx`, `StorageDeviceSidebarDock.tsx`**:
   - Wire the `Updates (N)` filter, `Update` card/drawer CTA copy, and 1-click **Update All (`N`)** trigger in the drive bay.

---

## 4. Verification Plan
- Unit tests for `classifyInstalledUpdateState` (description-only edit vs. new downloaded file vs. brand-new `remoteUpdatedAt`, timestamp grace window, un-installed items).
- SQLite migration + query tests verifying `installedFilter=outdated` and `facets.counts.installed.outdated`.
- End-to-end check: mount folder with `Game (v1.0).sfc`, simulate newer mirrored `Game (v1.1).sfc`, verify `Updates (1)` appears and 1-click upgrade replaces `v1.0` with `v1.1` and clears the outdated badge.
