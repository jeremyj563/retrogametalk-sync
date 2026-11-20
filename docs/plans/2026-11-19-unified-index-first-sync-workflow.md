---
title: Unified Index-First Sync & Cohesive Rule Workflow
status: implemented
created_at: 2026-11-20T01:16:11Z
implemented_at: 2026-11-20T02:06:00Z
---

# Unified Index-First Sync & Cohesive Rule Workflow

Unify RetroGameTalk Sync around its pre-indexed SQLite catalog so **Background Indexing**, **Sync Rules**, **Catalog**, **Monitor**, **Incremental Sync**, and **Full Sync** operate as one transparent pipeline instead of isolated crawlers. Full Sync transitions from blind HTTP re-crawling to an index-first mirror with automatic stale-console and delta refreshes, backed by live pre-flight counts, Dry Run simulation previews, direct Catalog rule filtering, and one-click rule queueing from Monitor.

## Implemented Capabilities

1. **Shared Deterministic Sync Rule Matcher (`src/shared/syncRuleMatcher.ts`)**:
   - Normalizes target console slugs and RGT aliases (`canonicalizeSystemSlug`, `normalizeTargetConsoleSlugs`, `resolveTargetConsoleScope`).
   - Classifies per-console `system_index_state` cursors into `fresh`, `stale` (`> 12h`), and `unindexed` buckets (`classifySystemIndexFreshness`).
   - Evaluates catalog releases identically across SQLite filtering, pre-flight previews, Monitor queueing, Incremental Auto-Sync, and Index-First Full Sync (`doesCatalogReleaseMatchSyncRules`), checking release tags and child `file_role` entries.
2. **Database, Pre-Flight & Structured Dry Run Persistence (`v20` Migration)**:
   - Migration `v20` adds `summary_json TEXT` to `sync_runs` for machine-readable `SyncRunSummarySnapshot` payloads.
   - `queryRepositoryItems`, `queryRepositoryItemIds`, and `facets.counts.syncRulesMatched` support `syncRules=true` parity filtering.
   - Added `GET /api/sync/preflight` (`computeSyncPreflightSummary()`) surfacing target console freshness, pending rule matches, retryable vs. available breakdown, estimated footprint, already-downloaded skips, excluded counts, top consoles, and sample releases.
3. **Index-First Full Sync & Unified Discovery (`src/server/orchestrator.ts`)**:
   - Full Sync defaults to index-first execution (`refreshStaleIndexes = true` default, optional `legacyFullCrawl` fallback): Phase 1 refreshes unindexed/stale consoles and runs fast WP REST `modifiedAfter` delta sweeps across fresh consoles; Phase 2 mirrors rule-matched pending releases straight from SQLite while verifying on-disk file sizes (`defaultFileExistsWithBytes`).
   - Dry Run executions remain strictly non-mutating and persist `SyncRunSummarySnapshot` on the `sync_runs` row.
   - Scheduled Incremental delta discovery keeps per-console `lastIndexedAt` cursors fresh and cleanly branches between `Auto-Download` and `Index Only`.
4. **Cohesive UI Workflows Across Header, Monitor, Catalog & Sync Rules**:
   - **Header Pre-Flight Full Sync Strip**: Asynchronous `SyncPreflightSummary` preview with rule scope, pending footprint, console freshness counts, `Refresh Stale/Unindexed` switch, collapsible per-console & sample breakdown, `Inspect in Catalog`, `Force Legacy Remote Crawl`, `Dry Run Full`, and `Start Full Mirror`.
   - **Monitor (`OverviewPanel`)**: Inline **Sync Rule Readiness** strip with one-click `Queue Pending` (guarded confirmation for batches `> 25`), `View in Catalog`, and **Latest Dry Run** result summary strip with immediate execution CTA.
   - **Catalog (`CatalogPanel`)**: Persisted **`Matches Sync Rules`** quick-filter toggle with live facet count and removable Active Filter token, plus `filterPreset` navigation from Monitor, Sync Rules, and Pre-Flight.
   - **Sync Rules (`SyncRulesPanel`)**: Unified Stage 1 / Stage 2 pipeline clarity, `Preview Matches in Catalog` shortcut, and live stale/unindexed target console readiness indicators.
