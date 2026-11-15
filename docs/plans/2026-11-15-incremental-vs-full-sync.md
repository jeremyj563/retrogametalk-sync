---
title: Incremental Sync vs. Full Sync
status: implemented
created_at: 2026-11-15T19:45:00Z
implemented_at: 2026-11-15T19:55:00Z
reconstructed: true
---

# Incremental Sync vs. Full Sync

> **Archive Note:** This plan was originally drafted and executed before `/docs/plans` archiving was enabled, so the temporary `implementation_plan.md` artifact was overwritten by later plans. This record summarizes the confirmed requirements and verified implementation in the codebase.

---

### Confirmed Product Decisions

1. **Delta Scope (`Newly created and updated releases`)**: Incremental Sync and Dry Run pull both newly published releases and existing releases updated on RetroGameTalk since the active cutoff timestamp (via `modified_after` / `remote_updated_at`).
2. **Initial Watermark Fallback (`Last 24 hours`)**: When Incremental Sync runs before any prior sync watermark exists (`last_watermark_at IS NULL`), it defaults to a rolling 24-hour lookback window rather than crawling the entire archive.
3. **Manual Cutoff Inspection & Override**: The Sync tab surfaces the active Incremental Cutoff timestamp and an inline **Edit Cutoff** control (with `datetime-local` input, quick presets `24h Ago`, `7d Ago`, `30d Ago`, `Now`, and **Reset Default**).
4. **Full Sync Safety Guard**: Because **Full Sync** crawls every release in scope with no page cap, triggering **Full Sync** requires inline confirmation in the top action bar before starting.

---

### Implementation Summary

- **Backend Orchestration (`src/server/orchestrator.ts`, `src/server/rgtClient.ts`, `src/server/db.ts`)**:
  - `incremental` and `dry_run` modes compute `effectiveCutoffIso = cfg.lastWatermarkAt || now - 24h` and query WordPress posts modified/created after the cutoff (`modified_after`), tracking `remote_updated_at` alongside `published_at`.
  - Scheduled cron runs execute in `incremental` mode and advance `last_watermark_at` cleanly without letting Dry Run or Retry runs corrupt the watermark.
  - `full` mode performs an uncapped crawl across the configured system scope.
- **Frontend Controls (`src/App.tsx`, `src/components/OverviewPanel.tsx`)**:
  - Top bar selector separates **Dry Run**, **Incremental Sync**, and **Full Sync**, rendering an inline amber confirmation strip when **Full Sync** is initiated.
  - Overview / Sync status panel displays `Incremental Cutoff: <timestamp> | Last 24h (auto default)` with **Edit Cutoff** inline controls backed by `PUT /api/config` (`lastWatermarkAt`).
