---
title: Unify Existing On-Disk Releases as Downloaded in Catalog
status: implemented
created_at: 2026-11-16T01:53:25Z
implemented_at: 2026-11-16T01:55:00Z
---

# Unify Existing On-Disk Releases as "Downloaded" in Catalog

Ensure every release whose files already exist locally on disk retains **Downloaded** status in the Catalog across incremental and full syncs—making it immediately visible under the **Downloaded** filter and ready for export—while preserving per-run deduplication (**Skipped**) counts in Sync History.

## User Review & Critical Decisions

- **Confirmed Catalog Behavior**: Always categorize items and files as **Downloaded** whenever valid files exist on disk—even when a subsequent sync skips re-downloading them.
- **Confirmed Telemetry Behavior**: Keep per-run **Skipped** counts inside **Sync History** runs (`Skipped` column and run summaries) so you can still verify when a sync deduplicated existing files instead of hitting upstream bandwidth.
- **Confirmed Migration & Filter Cleanup**: Automatically convert all existing `skipped` Catalog items and files to **Downloaded** via an automated schema migration (v7), and remove the **Skipped (Exists)** option from the Catalog Status filter dropdown.

---

## 1. Overview & Core Concept

- **What It Does**: Decouples *Catalog state* ("Is this release mirrored on disk and ready to export?") from *Sync Run outcome* ("Did this particular run fetch new bytes or skip an existing file?").
- **Why It Matters**: Previously, running a Full Sync overwrote already-downloaded Catalog entries to `skipped` whenever the downloader detected the archive already existed on disk—causing previously downloaded ROMs to vanish from the **Downloaded** filter.

---

## 2. User Experience & Visual Design

1. **Consistent "Downloaded" Status Across Re-Syncs**: Deduped local files retain `downloaded` status in Catalog releases and files while preserving existing `downloaded_at` timestamps (or backfilling from local file mtime).
2. **Clean Catalog Status Filter**: Removed **Skipped (Exists)** from the Catalog Status dropdown and auto-upgraded any saved `skipped` filter preference to `downloaded`.
3. **Automatic One-Time Upgrade (v7)**: Schema v7 migrates existing `skipped` rows in `catalog_release_files` and `catalog_releases` to `downloaded`.
4. **Overview & Sync History Clarity**: Overview KPI displays clean `downloaded` count, while Sync History continues displaying per-run `Skipped` counts.

---

## 3. Technical Architecture & Data Strategy

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                      Sync Orchestrator & Downloader                       │
│  • Local file exists & size > 0 ─▶ Downloader returns `outcome: skipped`  │
│  • Increments Sync Run `skippedCount` (Sync History telemetry preserved)  │
│  • Persists Catalog File & Release status = `downloaded` (non-destructive │
│    on existing `downloaded_at`)                                           │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                    SQLite Catalog Store (Schema v7)                       │
│  • Migration v7: updates legacy `skipped` files/releases ─▶ `downloaded`  │
│  • Aggregate status rollups classify complete local sets as `downloaded`  │
└──────────────────────────────────┬────────────────────────────────────────┘
                                   ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                         Catalog & Overview UI                             │
│  • Catalog Status filter removes `Skipped (Exists)` (auto-upgrades saved  │
│    `skipped` prefs to `downloaded`)                                       │
│  • Overview KPI displays clean downloaded count; Run History keeps Skipped│
└───────────────────────────────────────────────────────────────────────────┘
```
