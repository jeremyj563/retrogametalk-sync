# Implementation Plans Archive

This directory stores versioned, point-in-time Markdown snapshots of approved, implemented, and archived feature plans for **RetroGameTalk Sync**.

> **Historical Changelog Only:** Documents under `/docs/` are preserved strictly for human readers to follow how the application has evolved over time. Later features may supersede earlier plans, and these snapshots are intentionally never retroactively rewritten—always treat the live codebase as the sole source of truth for current behavior.

## File Naming & Frontmatter Convention

- **Filename format:** `YYYY-MM-DD-<slug>.md` (e.g., `2026-11-15-failed-downloads-queue-and-retry.md`)
- **Required YAML frontmatter:**

```yaml
---
title: Short Descriptive Plan Title
status: planned # planned | implemented
created_at: 2026-11-15T20:22:03Z
implemented_at: null # ISO-8601 UTC timestamp once executed, or null
---
```

> **Note on AI Studio Planning Mode:** During plan review (`Plan` phase), AI Studio's Zero Modification Rule limits writes to the temporary `implementation_plan.md` approval artifact. Plans are archived here upon execution (`Proceed`) or when explicitly saved as `status: planned` with `implemented_at: null`.

## Plan Index

| Date | Plan | Status | Created (UTC) | Implemented (UTC) | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-11-15 | [Incremental Sync vs. Full Sync](./2026-11-15-incremental-vs-full-sync.md) | `implemented` | `2026-11-15T19:45:00Z` | `2026-11-15T19:55:00Z` | Reconstructed from codebase (pre-archive) |
| 2026-11-15 | [Automated SQLite Schema Migrations](./2026-11-15-automated-sql-schema-migrations.md) | `implemented` | `2026-11-15T20:02:00Z` | `2026-11-15T20:06:35Z` | Reconstructed from codebase (pre-archive) |
| 2026-11-15 | [Failed Downloads Queue, Batch Recovery & Stream Resilience](./2026-11-15-failed-downloads-queue-and-retry.md) | `implemented` | `2026-11-15T20:22:03Z` | `2026-11-15T20:30:38Z` | Archived verbatim from `implementation_plan.md` |
| 2026-11-15 | [Prepared ROM Downloads & Direct-to-SD-Card Exporter](./2026-11-15-prepared-rom-downloads-and-sd-export.md) | `implemented` | `2026-11-15T21:31:00Z` | `2026-11-15T21:50:00Z` | Dual export workflow, 7z/zip streamer, v5 schema |
| 2026-11-16 | [Catalog Sorting & Chronological Discovery](./2026-11-16-catalog-sorting-and-chronological-discovery.md) | `implemented` | `2026-11-16T00:46:38Z` | `2026-11-16T00:49:00Z` | Server-backed SQLite sorting, v6 indexes, toolbar + table header sync |
| 2026-11-16 | [Unify Existing On-Disk Releases as Downloaded in Catalog](./2026-11-16-unify-skipped-catalog-items-as-downloaded.md) | `implemented` | `2026-11-16T01:53:25Z` | `2026-11-16T01:55:00Z` | v7 skipped->downloaded migration, preserve run skippedCount, clean UI filter |
| 2026-11-16 | [Inline Sync-Page Failed Queue Drawer & Catalog Cleanup](./2026-11-16-inline-sync-failed-queue-drawer.md) | `implemented` | `2026-11-16T02:23:17Z` | `2026-11-16T02:27:25Z` | Slide-down FailedQueueDrawer in OverviewPanel, 2-way Catalog toggle |
| 2026-11-16 | [Live CRT Scanlines Intensity Control](./2026-11-16-live-crt-scanlines-slider.md) | `implemented` | `2026-11-16T02:36:32Z` | `2026-11-16T02:43:17Z` | Sidebar ON/OFF + 0–100% live slider, bold contrast curve, localStorage |
| 2026-11-16 | [Retro CRT Display Studio & Visual FX Controls](./2026-11-16-retro-crt-display-studio.md) | `implemented` | `2026-11-16T02:51:25Z` | `2026-11-16T02:52:57Z` | Collapsible tuner, Green/Amber/Cyan palette, 5 live sliders, presets |
| 2026-11-16 | [Grafana-Style Telemetry Graph Deck & Full-Screen CRT Overlay Layering](./2026-11-16-grafana-telemetry-deck-and-crt-layering.md) | `implemented` | `2026-11-16T03:18:29Z` | `2026-11-16T03:27:50Z` | 6-slide Grafana crosshair/tooltip deck (incl. ROM Types) + CRT drawer layering |
| 2026-11-16 | [Multi-Select Catalog Filtering & Active Filter Bar](./2026-11-16-multi-select-catalog-filtering.md) | `implemented` | `2026-11-16T03:50:15Z` | `2026-11-16T03:56:20Z` | 7 searchable multi-select dropdowns (incl. Sources), Any/All tag mode, active bar |
| 2026-11-16 | [Sync Release Type Filtering on Operations](./2026-11-16-release-type-sync-filtering.md) | `implemented` | `2026-11-16T13:46:55Z` | `2026-11-16T13:52:00Z` | Global allowlist + grouped Translations, pre-download & per-file sync gates, v9 schema |
| 2026-11-16 | [Modified & Community ROMs Preset](./2026-11-16-modified-roms-preset.md) | `implemented` | `2026-11-16T14:06:27Z` | `2026-11-16T14:12:00Z` | One-click preset for Hacks, Translations (incl. MTL), Homebrew & Ports |
| 2026-11-16 | [Hacks + English + Ports Preset](./2026-11-16-hacks-english-ports-preset.md) | `implemented` | `2026-11-16T14:21:16Z` | `2026-11-16T14:22:00Z` | Replaces previous preset with English-only + MTL, Hacks, Homebrew & Ports |
| 2026-11-16 | [Target Consoles & Systems Cleanup & Redesign](./2026-11-16-target-consoles-cleanup-and-redesign.md) | `implemented` | `2026-11-16T14:30:21Z` | `2026-11-16T14:33:00Z` | Non-system WP page pruning (v10 + live /pages), brand grouping, friendly names, Advanced toggle |
| 2026-11-16 | [Multi-Platform Installation Docs & Publishing Roadmap](./2026-11-16-multi-platform-docs-and-publishing-roadmap.md) | `planned` | `2026-11-16T15:00:36Z` | `null` | Staged 6-platform + Helm docs, gated multi-arch GHCR/Docker Hub CI, Unraid/TrueNAS/Proxmox rollout |
| 2026-11-16 | [Realtime Catalog Download Progress](./2026-11-16-realtime-catalog-download-progress.md) | `implemented` | `2026-11-16T16:09:18Z` | `2026-11-16T16:14:30Z` | Live SSE progress bars, %, bytes & speed across Grid cards (cover overlay + footer), Table rows & Detail Drawer |
| 2026-11-16 | [Dual-Scope Realtime Catalog Download Progress](./2026-11-16-dual-scope-catalog-download-progress.md) | `implemented` | `2026-11-16T16:45:10Z` | `2026-11-16T16:47:45Z` | Separates Current File progress (cover/file bar) from Overall Catalog Item progress (footer/overall bar) on multi-file releases |
