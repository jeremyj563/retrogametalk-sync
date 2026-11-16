# Implementation Plans Archive

This directory stores versioned Markdown snapshots of approved, implemented, and archived feature plans for **RetroGameTalk Sync**.

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
