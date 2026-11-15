---
title: Automated SQLite Schema Migrations
status: implemented
created_at: 2026-11-15T20:02:00Z
implemented_at: 2026-11-15T20:06:35Z
reconstructed: true
---

# Automated SQLite Schema Migrations

> **Archive Note:** This feature was designed and implemented prior to `/docs/plans` archiving being enabled. This document records the verified migration architecture implemented in `src/server/migrations.ts`, `src/server/db.ts`, `src/server/orchestrator.ts`, and `server.ts`.

---

### Core Objectives

Formalize automatic, zero-touch SQLite schema upgrades whenever a new container image revision starts against an existing persistent volume (`DATA_DIR/scraper.db`), with WAL-safe backups, rollback protection, and operational observability.

---

### Implemented Architecture

1. **Ordered Append-Only Migration Registry (`src/server/migrations.ts`)**:
   - Defines `SCHEMA_MIGRATIONS` (`v1`–`v4`) with monotonic version validation and SHA-256 checksums:
     - `v1` (`initial_core_schema`): Core tables (`scraper_config`, `sync_runs`, `catalog_releases`, `catalog_release_files`, `activity_logs`, `distributed_locks`) and retirement of legacy `repository_items`.
     - `v2` (`config_discovery_and_auth_history`): Adds `discovered_systems_json` and `last_authenticated_at` to `scraper_config`.
     - `v3` (`release_remote_updated_at_and_index`): Adds `remote_updated_at` column and `idx_releases_remote_updated_at` index on `catalog_releases`.
     - `v4` (`legacy_config_defaults_and_data_dir_normalization`): Normalizes retired URLs, legacy User-Agent strings, and migrated `DOWNLOAD_DIR` defaults.
2. **Pre-Migration WAL-Safe Snapshot (`VACUUM INTO`)**:
   - Before applying any pending migration to an existing non-empty database, writes an atomic snapshot to `<DATA_DIR>/backups/scraper.db.pre-v<from>-to-v<to>-<timestamp>.bak` and retains the 5 most recent backups.
3. **Transactional Execution & Version Tracking**:
   - Records every applied step in `schema_migrations` (`version`, `name`, `description`, `checksum`, `applied_at`, `duration_ms`) and synchronizes `PRAGMA user_version` atomically inside each migration transaction.
   - Supports optional `disableForeignKeys` with post-migration `PRAGMA foreign_key_check` verification.
4. **Rollback / Downgrade Guard**:
   - If the database on disk has a higher version than the running binary (`previousVersion > targetVersion`), logs a rollback warning and skips forward migrations rather than failing or corrupting newer data.
5. **Observability Endpoints (`server.ts`, `src/server/orchestrator.ts`)**:
   - `GET /api/schema` exposes `currentVersion`, `targetVersion`, `backupPath`, `appliedNow`, `history`, and `rollbackWarning`.
   - `GET /readyz` reports `schemaVersion` alongside pod readiness.
   - `GET /metrics` exports the Prometheus gauge `rgt_db_schema_version`.
