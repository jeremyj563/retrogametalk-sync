import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { normalizeStorageFolderConfig } from '../shared/storageFolderMappings.ts';
import {
  CANONICAL_SYSTEM_ALIAS_GROUPS,
  filterValidSystemSlugs,
  sanitizeSystemFilterString,
} from '../shared/systemCatalog.ts';
import { decodeHtmlEntities, hasHtmlEntities } from './releaseTags.ts';
import type { AppliedMigrationRecord, DatabaseMigrationReport } from './types.ts';

export interface MigrationContext {
  dataDir: string;
  defaultDownloadDir: string;
}

export interface SchemaMigration {
  version: number;
  name: string;
  description: string;
  disableForeignKeys?: boolean;
  up: (db: Database.Database, ctx: MigrationContext) => void;
}

const MAX_RETAINED_BACKUPS = 5;

function logDbMigration(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
  const line = `[${new Date().toISOString()}] [DB] [${level}] ${message}`;
  if (level === 'ERROR') {
    console.error(line);
  } else if (level === 'WARN') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function tableHasColumn(db: Database.Database, tableName: string, columnName: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as { name: string }[];
  return rows.some((row) => row.name === columnName);
}

function computeMigrationChecksum(migration: SchemaMigration): string {
  return crypto
    .createHash('sha256')
    .update(`${migration.version}:${migration.name}:${migration.up.toString()}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Ordered, append-only SQLite schema migrations.
 * Add new schema changes by appending the next sequential integer version here.
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'initial_core_schema',
    description: 'Create core config, sync runs, grouped catalog releases/files, activity logs, and distributed locks tables',
    up: (db) => {
      const hadLegacyItemsTable = Boolean(
        db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'repository_items'`).get(),
      );

      db.exec(`
        CREATE TABLE IF NOT EXISTS scraper_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_url TEXT NOT NULL,
          login_url TEXT NOT NULL,
          username TEXT NOT NULL DEFAULT '',
          password_enc TEXT NOT NULL DEFAULT '',
          download_dir TEXT NOT NULL,
          cron_schedule TEXT NOT NULL DEFAULT '0 */6 * * *',
          schedule_enabled INTEGER NOT NULL DEFAULT 0,
          base_delay_ms INTEGER NOT NULL DEFAULT 1500,
          min_delay_ms INTEGER NOT NULL DEFAULT 750,
          max_delay_ms INTEGER NOT NULL DEFAULT 60000,
          backoff_multiplier REAL NOT NULL DEFAULT 2.0,
          max_retries INTEGER NOT NULL DEFAULT 5,
          max_concurrency INTEGER NOT NULL DEFAULT 1,
          request_timeout_ms INTEGER NOT NULL DEFAULT 30000,
          user_agent TEXT NOT NULL DEFAULT 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          system_filter TEXT NOT NULL DEFAULT '',
          discovered_systems_json TEXT NOT NULL DEFAULT '[]',
          last_watermark_at TEXT,
          last_authenticated_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trigger_type TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          pages_crawled INTEGER NOT NULL DEFAULT 0,
          new_found INTEGER NOT NULL DEFAULT 0,
          downloaded_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          bytes_downloaded INTEGER NOT NULL DEFAULT 0,
          rate_limit_hits INTEGER NOT NULL DEFAULT 0,
          avg_delay_ms INTEGER NOT NULL DEFAULT 0,
          error_summary TEXT
        );

        CREATE TABLE IF NOT EXISTS catalog_releases (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          remote_url TEXT NOT NULL UNIQUE,
          wp_post_id INTEGER,
          wp_post_type TEXT,
          remote_path TEXT NOT NULL,
          local_path TEXT NOT NULL,
          system_name TEXT NOT NULL,
          release_type TEXT NOT NULL DEFAULT 'Retail ROM',
          release_tags_json TEXT NOT NULL DEFAULT '[]',
          title TEXT NOT NULL,
          file_size_bytes INTEGER NOT NULL DEFAULT 0,
          published_at TEXT,
          remote_updated_at TEXT,
          status TEXT NOT NULL DEFAULT 'queued',
          error_message TEXT,
          last_run_id INTEGER,
          discovered_at TEXT NOT NULL,
          downloaded_at TEXT,
          publisher TEXT,
          developer TEXT,
          release_year TEXT,
          genres_json TEXT NOT NULL DEFAULT '[]',
          regions_json TEXT NOT NULL DEFAULT '[]',
          languages_json TEXT NOT NULL DEFAULT '[]',
          sources_json TEXT NOT NULL DEFAULT '[]',
          cover_local_path TEXT,
          screenshots_json TEXT NOT NULL DEFAULT '[]',
          metadata_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_releases_system ON catalog_releases(system_name);
        CREATE INDEX IF NOT EXISTS idx_releases_status ON catalog_releases(status);

        CREATE TABLE IF NOT EXISTS catalog_release_files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          release_id INTEGER NOT NULL REFERENCES catalog_releases(id) ON DELETE CASCADE,
          remote_url TEXT NOT NULL UNIQUE,
          download_url TEXT NOT NULL,
          remote_path TEXT NOT NULL,
          local_path TEXT NOT NULL,
          filename TEXT NOT NULL,
          display_label TEXT NOT NULL,
          file_role TEXT NOT NULL DEFAULT 'ROM',
          file_size_bytes INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          error_message TEXT,
          last_run_id INTEGER,
          discovered_at TEXT NOT NULL,
          downloaded_at TEXT,
          UNIQUE(release_id, filename)
        );

        CREATE INDEX IF NOT EXISTS idx_release_files_release_id ON catalog_release_files(release_id);
        CREATE INDEX IF NOT EXISTS idx_release_files_local_path ON catalog_release_files(local_path);

        CREATE TABLE IF NOT EXISTS activity_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id INTEGER,
          level TEXT NOT NULL,
          message TEXT NOT NULL,
          detail TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS distributed_locks (
          lock_name TEXT PRIMARY KEY,
          holder_id TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
      `);

      // Cleanly retire legacy v1 flat table if upgrading from an early pre-grouped release
      if (hadLegacyItemsTable) {
        db.prepare('DROP TABLE IF EXISTS repository_items').run();
        const hasConfig = db.prepare(`SELECT 1 FROM scraper_config WHERE id = 1`).get();
        if (hasConfig) {
          db.prepare('UPDATE scraper_config SET last_watermark_at = NULL WHERE id = 1').run();
        }
      }
    },
  },
  {
    version: 2,
    name: 'config_discovery_and_auth_history',
    description: 'Add discovered_systems_json and last_authenticated_at columns to scraper_config for pod-restart persistence',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'discovered_systems_json')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN discovered_systems_json TEXT NOT NULL DEFAULT '[]'`).run();
      }
      if (!tableHasColumn(db, 'scraper_config', 'last_authenticated_at')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN last_authenticated_at TEXT`).run();
      }
    },
  },
  {
    version: 3,
    name: 'release_remote_updated_at_and_index',
    description: 'Add remote_updated_at timestamp column and index on catalog_releases for delta sync tracking',
    up: (db) => {
      if (!tableHasColumn(db, 'catalog_releases', 'remote_updated_at')) {
        db.prepare(`ALTER TABLE catalog_releases ADD COLUMN remote_updated_at TEXT`).run();
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_releases_remote_updated_at ON catalog_releases(remote_updated_at);`);
    },
  },
  {
    version: 4,
    name: 'legacy_config_defaults_and_data_dir_normalization',
    description: 'Normalize retired repository URLs, legacy User-Agent strings, and migrated DOWNLOAD_DIR paths',
    up: (db, ctx) => {
      const existing = db
        .prepare('SELECT id, base_url, login_url, download_dir FROM scraper_config WHERE id = 1')
        .get() as { id: number; base_url: string; login_url: string; download_dir: string } | undefined;

      if (!existing) return;

      if (existing.base_url === 'https://retrogametalk.com/repository/') {
        db.prepare('UPDATE scraper_config SET base_url = ? WHERE id = 1').run('https://retrogametalk.com/repo/');
      }
      if (existing.login_url === 'https://retrogametalk.com/wp-login.php') {
        db.prepare('UPDATE scraper_config SET login_url = ? WHERE id = 1').run('https://retrogametalk.com/login/');
      }
      db.prepare('UPDATE scraper_config SET user_agent = ? WHERE id = 1 AND user_agent IN (?, ?, ?)').run(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      );
      const legacyDownloadDirs = new Set([
        path.resolve('./data/repository'),
        path.resolve('/app/data/repository'),
      ]);
      if (ctx.dataDir === '/run/repo/.rgt-data' && legacyDownloadDirs.has(path.resolve(existing.download_dir))) {
        db.prepare('UPDATE scraper_config SET download_dir = ? WHERE id = 1').run(ctx.defaultDownloadDir);
      }
    },
  },
  {
    version: 5,
    name: 'rom_export_naming_and_device_presets',
    description: 'Add ROM naming template, FAT32 sanitization, and SD card device folder preset columns to scraper_config',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'rom_naming_template')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN rom_naming_template TEXT NOT NULL DEFAULT '{title}{regionParen}{tagBracket}'`).run();
      }
      if (!tableHasColumn(db, 'scraper_config', 'rom_sanitize_fat32')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN rom_sanitize_fat32 INTEGER NOT NULL DEFAULT 1`).run();
      }
      if (!tableHasColumn(db, 'scraper_config', 'rom_max_filename_len')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN rom_max_filename_len INTEGER NOT NULL DEFAULT 0`).run();
      }
      if (!tableHasColumn(db, 'scraper_config', 'device_preset')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN device_preset TEXT NOT NULL DEFAULT 'everdrive'`).run();
      }
      if (!tableHasColumn(db, 'scraper_config', 'device_folder_map_json')) {
        db.prepare(`ALTER TABLE scraper_config ADD COLUMN device_folder_map_json TEXT NOT NULL DEFAULT '{}'`).run();
      }
    },
  },
  {
    version: 6,
    name: 'catalog_sort_indexes',
    description: 'Add indexes on published_at, discovered_at, downloaded_at, title (NOCASE), and file_size_bytes on catalog_releases for server-side catalog sorting',
    up: (db) => {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_releases_published_at ON catalog_releases(published_at DESC);
        CREATE INDEX IF NOT EXISTS idx_releases_discovered_at ON catalog_releases(discovered_at DESC);
        CREATE INDEX IF NOT EXISTS idx_releases_downloaded_at ON catalog_releases(downloaded_at DESC);
        CREATE INDEX IF NOT EXISTS idx_releases_title_nocase ON catalog_releases(title COLLATE NOCASE);
        CREATE INDEX IF NOT EXISTS idx_releases_file_size ON catalog_releases(file_size_bytes DESC);
      `);
    },
  },
  {
    version: 7,
    name: 'convert_skipped_catalog_items_to_downloaded',
    description: 'Convert existing skipped catalog release and file statuses to downloaded while preserving per-run skipped_count history',
    up: (db) => {
      db.prepare(`
        UPDATE catalog_release_files
        SET
          status = 'downloaded',
          downloaded_at = COALESCE(downloaded_at, discovered_at)
        WHERE status = 'skipped'
      `).run();
      db.prepare(`
        UPDATE catalog_releases
        SET
          status = 'downloaded',
          downloaded_at = COALESCE(downloaded_at, discovered_at)
        WHERE status = 'skipped'
      `).run();
    },
  },
  {
    version: 8,
    name: 'add_dry_run_flag_to_sync_runs',
    description: 'Decouple dry_run boolean flag from sync_runs.mode so Incremental, Full, and Retry runs can all execute as dry runs',
    up: (db) => {
      if (!tableHasColumn(db, 'sync_runs', 'dry_run')) {
        db.exec('ALTER TABLE sync_runs ADD COLUMN dry_run INTEGER NOT NULL DEFAULT 0');
      }
      db.prepare(`
        UPDATE sync_runs
        SET dry_run = 1, mode = 'incremental'
        WHERE mode = 'dry_run'
      `).run();
    },
  },
  {
    version: 9,
    name: 'add_release_type_filter_to_scraper_config',
    description: 'Add allowed_release_types_json column to scraper_config for global release type allowlist sync filtering',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'allowed_release_types_json')) {
        db.prepare(
          `ALTER TABLE scraper_config ADD COLUMN allowed_release_types_json TEXT NOT NULL DEFAULT '[]'`,
        ).run();
      }
    },
  },
  {
    version: 10,
    name: 'prune_non_system_pages_from_config',
    description: 'Remove non-system WordPress utility slugs (screenshots-wanted, sitemap, user-agreement, etc.) from discovered systems and active system filter',
    up: (db) => {
      const row = db
        .prepare('SELECT discovered_systems_json, system_filter FROM scraper_config WHERE id = 1')
        .get() as { discovered_systems_json?: string; system_filter?: string } | undefined;
      if (!row) return;

      let parsedSystems: string[] = [];
      try {
        const raw = JSON.parse(String(row.discovered_systems_json || '[]'));
        if (Array.isArray(raw)) {
          parsedSystems = raw.map(String);
        }
      } catch {
        parsedSystems = [];
      }

      const cleanedSystems = filterValidSystemSlugs(parsedSystems);
      const cleanedFilter = sanitizeSystemFilterString(String(row.system_filter || ''));

      db.prepare(
        'UPDATE scraper_config SET discovered_systems_json = ?, system_filter = ? WHERE id = 1',
      ).run(JSON.stringify(cleanedSystems), cleanedFilter);
    },
  },
  {
    version: 11,
    name: 'add_custom_brand_logo_url',
    description: 'Add custom_brand_logo_url column to scraper_config for customizable header branding',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'custom_brand_logo_url')) {
        db.prepare(
          `ALTER TABLE scraper_config ADD COLUMN custom_brand_logo_url TEXT NOT NULL DEFAULT ''`,
        ).run();
      }
    },
  },
  {
    version: 12,
    name: 'retire_custom_brand_logo_url',
    description: 'Clear retired custom_brand_logo_url values after replacing header branding with the built-in CSS CRT banner',
    up: (db) => {
      if (tableHasColumn(db, 'scraper_config', 'custom_brand_logo_url')) {
        db.prepare(`UPDATE scraper_config SET custom_brand_logo_url = '' WHERE id = 1`).run();
      }
    },
  },
  {
    version: 13,
    name: 'catalog_release_storage_install_tracking',
    description: 'Add installed_at and installed_device_label columns to catalog_releases to track games installed to external storage devices',
    up: (db) => {
      if (!tableHasColumn(db, 'catalog_releases', 'installed_at')) {
        db.prepare(`ALTER TABLE catalog_releases ADD COLUMN installed_at TEXT`).run();
      }
      if (!tableHasColumn(db, 'catalog_releases', 'installed_device_label')) {
        db.prepare(`ALTER TABLE catalog_releases ADD COLUMN installed_device_label TEXT`).run();
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_releases_installed_at ON catalog_releases(installed_at);`);
    },
  },
  {
    version: 14,
    name: 'storage_folder_mappings_and_retire_presets',
    description: 'Add storage_folder_config_json to scraper_config for console and per-ROM-type folder mappings while migrating legacy custom folder overrides',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'storage_folder_config_json')) {
        db.prepare(
          `ALTER TABLE scraper_config ADD COLUMN storage_folder_config_json TEXT NOT NULL DEFAULT '{}'`,
        ).run();
      }

      const row = db
        .prepare(
          `SELECT device_preset, device_folder_map_json, storage_folder_config_json FROM scraper_config WHERE id = 1`,
        )
        .get() as
        | {
            device_preset?: string;
            device_folder_map_json?: string;
            storage_folder_config_json?: string;
          }
        | undefined;
      if (!row) return;

      const legacyPresetMaps: Record<string, Record<string, string>> = {
        mister: {
          'nes-roms': 'games/NES',
          'fds-roms': 'games/NES',
          famicom_disk_system: 'games/NES',
          'snes-roms': 'games/SNES',
          'snes-rom': 'games/SNES',
          'n64-roms': 'games/N64',
          'gb-roms': 'games/GAMEBOY',
          'gameboy-roms': 'games/GAMEBOY',
          'gbc-roms': 'games/GAMEBOY2P',
          'gameboy-color-roms': 'games/GAMEBOY2P',
          'gba-roms': 'games/GBA',
          'genesis-roms': 'games/Genesis',
          sega_genesis_roms: 'games/Genesis',
          'sega-cd-iso': 'games/MegaCD',
          sega_cd_isos: 'games/MegaCD',
          '32x-roms': 'games/S32X',
          sega_32x_roms: 'games/S32X',
          'sms-roms': 'games/SMS',
          sms_roms: 'games/SMS',
          'gg-roms': 'games/SMS',
          'game-gear': 'games/SMS',
          'pc-engine-roms': 'games/TGFX16',
          'turbografx-16': 'games/TGFX16',
          'pce-cd-iso': 'games/TGFX16-CD',
          'turbografx-cd': 'games/TGFX16-CD',
          'psx-iso': 'games/PSX',
          'ps1-iso': 'games/PSX',
          'saturn-iso': 'games/Saturn',
          sega_saturn_isos: 'games/Saturn',
          'neogeo-roms': 'games/NeoGeo',
          'neo-geo-cd': 'games/NeoGeo',
          wonderswan: 'games/WonderSwan',
          'msx-roms': 'games/MSX',
        },
        onion: {
          'nes-roms': 'Roms/FC',
          'fds-roms': 'Roms/FDS',
          famicom_disk_system: 'Roms/FDS',
          'snes-roms': 'Roms/SFC',
          'snes-rom': 'Roms/SFC',
          'gb-roms': 'Roms/GB',
          'gameboy-roms': 'Roms/GB',
          'gbc-roms': 'Roms/GBC',
          'gameboy-color-roms': 'Roms/GBC',
          'gba-roms': 'Roms/GBA',
          'genesis-roms': 'Roms/MD',
          sega_genesis_roms: 'Roms/MD',
          'sega-cd-iso': 'Roms/SEGACD',
          sega_cd_isos: 'Roms/SEGACD',
          '32x-roms': 'Roms/THIRTYTWOX',
          sega_32x_roms: 'Roms/THIRTYTWOX',
          'sms-roms': 'Roms/MS',
          sms_roms: 'Roms/MS',
          'gg-roms': 'Roms/GG',
          'game-gear': 'Roms/GG',
          'pc-engine-roms': 'Roms/PCE',
          'turbografx-16': 'Roms/PCE',
          'pce-cd-iso': 'Roms/PCECD',
          'turbografx-cd': 'Roms/PCECD',
          'psx-iso': 'Roms/PS',
          'ps1-iso': 'Roms/PS',
          'nds-roms': 'Roms/NDS',
          'ngp-roms': 'Roms/NGP',
          'neo-geo-pocket': 'Roms/NGP',
          'neo-geo-cd': 'Roms/NEOCD',
          'ws-roms': 'Roms/WS',
          wonderswan: 'Roms/WS',
          'msx-roms': 'Roms/MSX',
        },
        analogue: {
          'nes-roms': 'Assets/nes/common',
          'snes-roms': 'Assets/snes/common',
          'snes-rom': 'Assets/snes/common',
          'gb-roms': 'Assets/gb/common',
          'gameboy-roms': 'Assets/gb/common',
          'gbc-roms': 'Assets/gbc/common',
          'gameboy-color-roms': 'Assets/gbc/common',
          'gba-roms': 'Assets/gba/common',
          'genesis-roms': 'Assets/genesis/common',
          sega_genesis_roms: 'Assets/genesis/common',
          'sms-roms': 'Assets/sms/common',
          sms_roms: 'Assets/sms/common',
          'gg-roms': 'Assets/gg/common',
          'game-gear': 'Assets/gg/common',
          'pc-engine-roms': 'Assets/pce/common',
          'turbografx-16': 'Assets/pce/common',
          'pce-cd-iso': 'Assets/pcecd/common',
          'turbografx-cd': 'Assets/pcecd/common',
          'neogeo-roms': 'Assets/ng/common',
          wonderswan: 'Assets/wonderswan/common',
        },
        ode: {
          'gamecube-iso': 'games',
          gamecube: 'games',
          'wii-iso': 'wbfs',
        },
      };

      const mergedSystemFolders: Record<string, string> = {};
      const presetKey = String(row.device_preset || '').trim().toLowerCase();
      if (legacyPresetMaps[presetKey]) {
        Object.assign(mergedSystemFolders, legacyPresetMaps[presetKey]);
      }

      try {
        const parsedLegacyMap = JSON.parse(String(row.device_folder_map_json || '{}'));
        if (parsedLegacyMap && typeof parsedLegacyMap === 'object' && !Array.isArray(parsedLegacyMap)) {
          for (const [k, v] of Object.entries(parsedLegacyMap)) {
            if (typeof v === 'string' && v.trim()) {
              mergedSystemFolders[String(k).trim().toLowerCase()] = v.trim();
            }
          }
        }
      } catch {
        // Ignore malformed legacy JSON
      }

      let existingConfigRaw: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(String(row.storage_folder_config_json || '{}'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existingConfigRaw = parsed as Record<string, unknown>;
        }
      } catch {
        existingConfigRaw = {};
      }

      const normalized = normalizeStorageFolderConfig({
        ...existingConfigRaw,
        systemFolders: {
          ...mergedSystemFolders,
          ...(existingConfigRaw.systemFolders && typeof existingConfigRaw.systemFolders === 'object'
            ? (existingConfigRaw.systemFolders as Record<string, unknown>)
            : {}),
        },
      });

      db.prepare(`UPDATE scraper_config SET storage_folder_config_json = ? WHERE id = 1`).run(
        JSON.stringify(normalized),
      );
    },
  },
  {
    version: 15,
    name: 'canonicalize_rgt_system_slugs',
    description:
      'Normalize RetroGameTalk WP CPT / alias slugs (gb_roms, gbc_roms, gcn-iso, psx2psp, etc.) to canonical public URL slugs across catalog and config',
    up: (db) => {
      // 1. Consolidate catalog_releases.system_name onto each group's canonical slug (index 0)
      for (const group of CANONICAL_SYSTEM_ALIAS_GROUPS) {
        const canonical = group[0]!.trim().toLowerCase();
        const aliases = group
          .slice(1)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s && s !== canonical);
        if (aliases.length === 0) continue;
        const placeholders = aliases.map(() => '?').join(', ');
        db.prepare(
          `UPDATE catalog_releases SET system_name = ? WHERE LOWER(system_name) IN (${placeholders})`,
        ).run(canonical, ...aliases);
      }

      // 2. Deduplicate & canonicalize scraper_config discovered systems, system filter, and folder mappings
      const row = db
        .prepare(
          'SELECT discovered_systems_json, system_filter, storage_folder_config_json FROM scraper_config WHERE id = 1',
        )
        .get() as
        | {
            discovered_systems_json?: string;
            system_filter?: string;
            storage_folder_config_json?: string;
          }
        | undefined;
      if (!row) return;

      let parsedSystems: string[] = [];
      try {
        const raw = JSON.parse(String(row.discovered_systems_json || '[]'));
        if (Array.isArray(raw)) {
          parsedSystems = raw.map(String);
        }
      } catch {
        parsedSystems = [];
      }

      let parsedStorageConfig: unknown = {};
      try {
        parsedStorageConfig = JSON.parse(String(row.storage_folder_config_json || '{}'));
      } catch {
        parsedStorageConfig = {};
      }

      const cleanedSystems = filterValidSystemSlugs(parsedSystems);
      const cleanedFilter = sanitizeSystemFilterString(String(row.system_filter || ''));
      const cleanedStorageConfig = normalizeStorageFolderConfig(parsedStorageConfig);

      db.prepare(
        `UPDATE scraper_config
         SET discovered_systems_json = ?, system_filter = ?, storage_folder_config_json = ?
         WHERE id = 1`,
      ).run(
        JSON.stringify(cleanedSystems),
        cleanedFilter,
        JSON.stringify(cleanedStorageConfig),
      );
    },
  },
  {
    version: 16,
    name: 'download_chunk_acceleration_settings',
    description: 'Add multi-chunk HTTP Range concurrency and minimum file size threshold columns to scraper_config',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'download_chunk_concurrency')) {
        db.exec(
          `ALTER TABLE scraper_config ADD COLUMN download_chunk_concurrency INTEGER NOT NULL DEFAULT 3;`,
        );
      }
      if (!tableHasColumn(db, 'scraper_config', 'download_chunk_min_size_mb')) {
        db.exec(
          `ALTER TABLE scraper_config ADD COLUMN download_chunk_min_size_mb INTEGER NOT NULL DEFAULT 8;`,
        );
      }
    },
  },
  {
    version: 17,
    name: 'safe_rgt_traffic_shaping_defaults',
    description:
      'Reset aggressive 1.1.0 multi-chunk defaults (3x / 8 MiB) to single-stream safe defaults (1x / 32 MiB) and tune existing preset profiles for RGT edge limits',
    up: (db) => {
      const row = db
        .prepare(
          `SELECT base_delay_ms, min_delay_ms, max_delay_ms, backoff_multiplier, max_retries, max_concurrency, download_chunk_concurrency, download_chunk_min_size_mb
           FROM scraper_config WHERE id = 1`,
        )
        .get() as
        | {
            base_delay_ms: number;
            min_delay_ms: number;
            max_delay_ms: number;
            backoff_multiplier: number;
            max_retries: number;
            max_concurrency: number;
            download_chunk_concurrency?: number;
            download_chunk_min_size_mb?: number;
          }
        | undefined;
      if (!row) return;

      // Upgrade previous v16 defaults (3x chunks / 8 MiB threshold) that trigger mirror 503 cascades
      const chunkConc = Number(row.download_chunk_concurrency ?? 3);
      const chunkMinMb = Number(row.download_chunk_min_size_mb ?? 8);
      if (chunkConc > 1 || chunkMinMb <= 8) {
        db.prepare(
          `UPDATE scraper_config
           SET download_chunk_concurrency = 1,
               download_chunk_min_size_mb = CASE WHEN download_chunk_min_size_mb <= 8 THEN 32 ELSE download_chunk_min_size_mb END
           WHERE id = 1`,
        ).run();
      }

      // Upgrade untouched preset profiles cleanly so users stay on their chosen preset with safer bounds
      const isOldBrisk =
        row.base_delay_ms === 900 &&
        row.min_delay_ms === 450 &&
        row.max_delay_ms === 45000 &&
        Math.abs(row.backoff_multiplier - 1.8) < 0.001 &&
        row.max_concurrency === 2;
      const isOldBalanced =
        row.base_delay_ms === 1500 &&
        row.min_delay_ms === 750 &&
        row.max_delay_ms === 60000 &&
        Math.abs(row.backoff_multiplier - 2.0) < 0.001 &&
        row.max_concurrency === 1;
      const isOldGentle =
        row.base_delay_ms === 2500 &&
        row.min_delay_ms === 1500 &&
        row.max_delay_ms === 90000 &&
        Math.abs(row.backoff_multiplier - 2.2) < 0.001 &&
        row.max_concurrency === 1;

      if (isOldBrisk) {
        db.prepare(
          `UPDATE scraper_config
           SET base_delay_ms = 1100, min_delay_ms = 650, max_delay_ms = 30000, backoff_multiplier = 1.6
           WHERE id = 1`,
        ).run();
      } else if (isOldBalanced) {
        db.prepare(
          `UPDATE scraper_config
           SET max_delay_ms = 45000, backoff_multiplier = 1.8, max_retries = 4
           WHERE id = 1`,
        ).run();
      } else if (isOldGentle) {
        db.prepare(
          `UPDATE scraper_config
           SET max_delay_ms = 60000, backoff_multiplier = 2.0
           WHERE id = 1`,
        ).run();
      }
    },
  },
  {
    version: 18,
    name: 'decoupled_catalog_indexing',
    description:
      'Add auto_download_new_releases and system_index_state_json to scraper_config, size_is_estimated and status index to catalog_releases',
    up: (db) => {
      if (!tableHasColumn(db, 'scraper_config', 'auto_download_new_releases')) {
        db.exec(
          `ALTER TABLE scraper_config ADD COLUMN auto_download_new_releases INTEGER NOT NULL DEFAULT 1;`,
        );
      }
      if (!tableHasColumn(db, 'scraper_config', 'system_index_state_json')) {
        db.exec(
          `ALTER TABLE scraper_config ADD COLUMN system_index_state_json TEXT NOT NULL DEFAULT '{}';`,
        );
      }
      if (!tableHasColumn(db, 'catalog_releases', 'size_is_estimated')) {
        db.exec(
          `ALTER TABLE catalog_releases ADD COLUMN size_is_estimated INTEGER NOT NULL DEFAULT 0;`,
        );
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_catalog_releases_status ON catalog_releases(status);`);
    },
  },
  {
    version: 19,
    name: 'achievements_system',
    description:
      'Add SQLite persistence tables for console-style trophies, cumulative milestone counters, and baseline seeding metadata',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS achievements_state (
          id TEXT PRIMARY KEY,
          unlocked_at TEXT,
          progress_current INTEGER NOT NULL DEFAULT 0,
          progress_target INTEGER NOT NULL DEFAULT 1,
          silent INTEGER NOT NULL DEFAULT 0,
          seen INTEGER NOT NULL DEFAULT 0,
          meta_json TEXT
        );

        CREATE TABLE IF NOT EXISTS achievement_counters (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS achievements_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_achievements_state_unlocked ON achievements_state(unlocked_at DESC);
      `);
    },
  },
  {
    version: 20,
    name: 'sync_run_structured_summary',
    description:
      'Persist structured Dry Run and index-first sync run summary snapshots on sync_runs',
    up: (db) => {
      if (!tableHasColumn(db, 'sync_runs', 'summary_json')) {
        db.exec('ALTER TABLE sync_runs ADD COLUMN summary_json TEXT;');
      }
    },
  },
  {
    version: 21,
    name: 'decode_html_entities_in_titles',
    description:
      'Decode raw HTML entities (e.g. &amp;, &#038;, &#8217;) in catalog release titles, metadata fields, and file display labels without altering local disk paths',
    up: (db) => {
      const releaseRows = db
        .prepare(
          `SELECT id, title, publisher, developer, metadata_json
           FROM catalog_releases
           WHERE title LIKE '%&%'
              OR publisher LIKE '%&%'
              OR developer LIKE '%&%'
              OR metadata_json LIKE '%&%'`,
        )
        .all() as {
        id: number;
        title: string;
        publisher: string | null;
        developer: string | null;
        metadata_json: string | null;
      }[];

      const updateReleaseStmt = db.prepare(
        `UPDATE catalog_releases
         SET title = ?, publisher = ?, developer = ?, metadata_json = ?
         WHERE id = ?`,
      );

      for (const row of releaseRows) {
        let changed = false;
        const nextTitle = hasHtmlEntities(row.title) ? decodeHtmlEntities(row.title) : row.title;
        if (nextTitle !== row.title) changed = true;

        const nextPublisher =
          row.publisher && hasHtmlEntities(row.publisher)
            ? decodeHtmlEntities(row.publisher)
            : row.publisher;
        if (nextPublisher !== row.publisher) changed = true;

        const nextDeveloper =
          row.developer && hasHtmlEntities(row.developer)
            ? decodeHtmlEntities(row.developer)
            : row.developer;
        if (nextDeveloper !== row.developer) changed = true;

        let nextMetadataJson = row.metadata_json;
        if (row.metadata_json && hasHtmlEntities(row.metadata_json)) {
          try {
            const parsed = JSON.parse(row.metadata_json) as Record<string, unknown>;
            let metaChanged = false;
            for (const key of ['title', 'subtitle', 'publisher', 'developer', 'consoleName'] as const) {
              const val = parsed[key];
              if (typeof val === 'string' && hasHtmlEntities(val)) {
                const decoded = decodeHtmlEntities(val);
                if (decoded !== val) {
                  parsed[key] = decoded;
                  metaChanged = true;
                }
              }
            }
            if (Array.isArray(parsed.downloadHints)) {
              for (const hint of parsed.downloadHints) {
                if (hint && typeof hint === 'object') {
                  const h = hint as { filename?: unknown };
                  if (typeof h.filename === 'string' && hasHtmlEntities(h.filename)) {
                    const decoded = decodeHtmlEntities(h.filename);
                    if (decoded !== h.filename) {
                      h.filename = decoded;
                      metaChanged = true;
                    }
                  }
                }
              }
            }
            if (metaChanged) {
              nextMetadataJson = JSON.stringify(parsed);
              changed = true;
            }
          } catch {
            // Preserve malformed metadata_json as-is
          }
        }

        if (changed) {
          updateReleaseStmt.run(nextTitle, nextPublisher, nextDeveloper, nextMetadataJson, row.id);
        }
      }

      const fileRows = db
        .prepare(
          `SELECT id, display_label
           FROM catalog_release_files
           WHERE display_label LIKE '%&%'`,
        )
        .all() as { id: number; display_label: string }[];

      const updateFileStmt = db.prepare(
        `UPDATE catalog_release_files
         SET display_label = ?
         WHERE id = ?`,
      );

      for (const row of fileRows) {
        if (hasHtmlEntities(row.display_label)) {
          const nextLabel = decodeHtmlEntities(row.display_label);
          if (nextLabel !== row.display_label) {
            updateFileStmt.run(nextLabel, row.id);
          }
        }
      }
    },
  },
  {
    version: 22,
    name: 'prune_false_positive_html_download_files',
    description:
      'Remove non-downloaded false-positive HTML navigation links erroneously queued as .zip files (e.g. /repo/<system>/download-japan/) and recalculate parent release statuses',
    up: (db) => {
      const isFalsePositiveHtmlPageUrl = (rawUrl: string): boolean => {
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) return false;
        let parsed: URL;
        try {
          parsed = new URL(rawUrl);
        } catch {
          return false;
        }
        const pathnameLower = parsed.pathname.toLowerCase();
        const lowerHref = parsed.href.toLowerCase();
        if (
          pathnameLower.endsWith('/download.php') ||
          lowerHref.includes('download.php?') ||
          parsed.searchParams.has('file') ||
          parsed.searchParams.has('wpdmdl') ||
          parsed.searchParams.get('action')?.toLowerCase() === 'download'
        ) {
          return false;
        }
        const ext = path.extname(pathnameLower);
        if (ext && ext !== '.html' && ext !== '.htm' && ext !== '.php') {
          return false;
        }
        return (
          pathnameLower.endsWith('/') ||
          pathnameLower.endsWith('.html') ||
          pathnameLower.endsWith('.htm')
        );
      };

      const candidateRows = db
        .prepare(
          `SELECT id, release_id, download_url, status, error_message
           FROM catalog_release_files
           WHERE status IN ('failed', 'queued', 'available', 'pending')`,
        )
        .all() as {
        id: number;
        release_id: number;
        download_url: string;
        status: string;
        error_message: string | null;
      }[];

      const deleteStmt = db.prepare('DELETE FROM catalog_release_files WHERE id = ?');
      const affectedReleaseIds = new Set<number>();

      for (const row of candidateRows) {
        if (!isFalsePositiveHtmlPageUrl(row.download_url)) continue;
        deleteStmt.run(row.id);
        affectedReleaseIds.add(row.release_id);
      }

      if (affectedReleaseIds.size === 0) return;

      const selectFilesStmt = db.prepare(
        `SELECT filename, file_size_bytes, status, error_message, downloaded_at
         FROM catalog_release_files
         WHERE release_id = ?`,
      );
      const selectReleaseStmt = db.prepare(
        `SELECT status, file_size_bytes, downloaded_at
         FROM catalog_releases
         WHERE id = ?`,
      );
      const updateReleaseStmt = db.prepare(
        `UPDATE catalog_releases
         SET status = ?, error_message = ?, file_size_bytes = ?, downloaded_at = ?
         WHERE id = ?`,
      );

      for (const releaseId of affectedReleaseIds) {
        const rel = selectReleaseStmt.get(releaseId) as
          | { status: string; file_size_bytes: number; downloaded_at: string | null }
          | undefined;
        if (!rel) continue;

        const remaining = selectFilesStmt.all(releaseId) as {
          filename: string;
          file_size_bytes: number;
          status: string;
          error_message: string | null;
          downloaded_at: string | null;
        }[];

        if (remaining.length === 0) continue;

        let totalBytes = 0;
        let downloadedCount = 0;
        let failedCount = 0;
        let downloadingCount = 0;
        let availableCount = 0;
        let firstError: string | null = null;
        let latestDownloadedAt = rel.downloaded_at;

        for (const f of remaining) {
          if (f.file_size_bytes > 0) totalBytes += f.file_size_bytes;
          if (f.status === 'downloaded' || f.status === 'skipped') downloadedCount += 1;
          else if (f.status === 'failed') {
            failedCount += 1;
            if (!firstError && f.error_message) firstError = `${f.filename}: ${f.error_message}`;
          } else if (f.status === 'downloading') {
            downloadingCount += 1;
          } else if (f.status === 'available') {
            availableCount += 1;
          }
          if (f.downloaded_at && (!latestDownloadedAt || f.downloaded_at > latestDownloadedAt)) {
            latestDownloadedAt = f.downloaded_at;
          }
        }

        let nextStatus = rel.status;
        if (downloadingCount > 0) nextStatus = 'downloading';
        else if (failedCount === remaining.length) nextStatus = 'failed';
        else if (downloadedCount === remaining.length) nextStatus = 'downloaded';
        else if (downloadedCount > 0) nextStatus = 'partial';
        else if (availableCount === remaining.length) nextStatus = 'available';
        else nextStatus = 'queued';

        const nextBytes =
          totalBytes > 0
            ? totalBytes
            : nextStatus === 'available' || nextStatus === 'queued'
              ? rel.file_size_bytes
              : 0;

        updateReleaseStmt.run(nextStatus, firstError, nextBytes, latestDownloadedAt, releaseId);
      }
    },
  },
];

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

function createPreMigrationBackup(db: Database.Database, dataDir: string, fromVersion: number, toVersion: number): string | null {
  const backupsDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `scraper.db.pre-v${fromVersion}-to-v${toVersion}-${stamp}.bak`;
  const backupPath = path.join(backupsDir, filename);

  // VACUUM INTO creates an atomic, WAL-consistent standalone snapshot without blocking/mutating live WAL state.
  // SQLite does not accept parameter binding for VACUUM INTO filenames in all builds, so escape single quotes safely.
  const escaped = backupPath.replace(/'/g, "''");
  db.exec(`VACUUM INTO '${escaped}'`);

  // Prune older snapshots so persistent storage stays bounded across many image deployments
  try {
    const entries = fs
      .readdirSync(backupsDir)
      .filter((name) => name.startsWith('scraper.db.') && name.endsWith('.bak'))
      .map((name) => {
        const full = path.join(backupsDir, name);
        return { name, full, mtimeMs: fs.statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const stale of entries.slice(MAX_RETAINED_BACKUPS)) {
      fs.rmSync(stale.full, { force: true });
    }
  } catch {
    // Non-fatal backup pruning error
  }

  return backupPath;
}

function readAppliedHistory(db: Database.Database): AppliedMigrationRecord[] {
  const rows = db
    .prepare('SELECT version, name, description, checksum, applied_at, duration_ms FROM schema_migrations ORDER BY version ASC')
    .all() as {
    version: number;
    name: string;
    description: string;
    checksum: string;
    applied_at: string;
    duration_ms: number;
  }[];

  return rows.map((row) => ({
    version: Number(row.version),
    name: String(row.name),
    description: String(row.description),
    checksum: String(row.checksum),
    appliedAt: String(row.applied_at),
    durationMs: Number(row.duration_ms),
  }));
}

export function runDatabaseMigrations(
  db: Database.Database,
  ctx: MigrationContext,
  migrations: readonly SchemaMigration[] = SCHEMA_MIGRATIONS,
): DatabaseMigrationReport {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i].version <= sorted[i - 1].version) {
      throw new Error(`Duplicate or out-of-order migration version v${sorted[i].version}`);
    }
  }

  const targetVersion = sorted.length > 0 ? sorted[sorted.length - 1].version : 0;

  const existingAppTables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'`)
    .all() as { name: string }[];
  const hadExistingData = existingAppTables.length > 0;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL
    );
  `);

  const pragmaVersion = Number(db.pragma('user_version', { simple: true }) || 0);
  const recorded = readAppliedHistory(db);
  const recordedByVersion = new Map<number, AppliedMigrationRecord>();
  let maxRecordedVersion = 0;
  for (const rec of recorded) {
    recordedByVersion.set(rec.version, rec);
    if (rec.version > maxRecordedVersion) {
      maxRecordedVersion = rec.version;
    }
  }

  const previousVersion = Math.max(pragmaVersion, maxRecordedVersion);

  // Detect rollback (existing DB has newer schema than running binary knows)
  let rollbackWarning: string | null = null;
  if (previousVersion > targetVersion) {
    rollbackWarning = `Database schema v${previousVersion} is newer than binary target v${targetVersion}; skipping forward migrations to avoid data loss.`;
    logDbMigration('WARN', rollbackWarning);
    return {
      previousVersion,
      currentVersion: previousVersion,
      targetVersion,
      backupPath: null,
      appliedNow: [],
      history: recorded,
      rollbackWarning,
    };
  }

  // Verify checksums of already-applied migrations (informational warning only)
  for (const m of sorted) {
    const prev = recordedByVersion.get(m.version);
    if (prev) {
      const expectedChecksum = computeMigrationChecksum(m);
      if (prev.checksum !== expectedChecksum || prev.name !== m.name) {
        logDbMigration(
          'WARN',
          `Migration v${m.version} ("${m.name}") checksum/name differs from recorded history ("${prev.name}"); leaving applied schema intact.`,
        );
      }
    }
  }

  const pending = sorted.filter((m) => m.version > previousVersion && !recordedByVersion.has(m.version));
  if (pending.length === 0) {
    if (pragmaVersion !== targetVersion && maxRecordedVersion === targetVersion) {
      db.pragma(`user_version = ${targetVersion}`);
    }
    logDbMigration('INFO', `SQLite schema up to date at v${previousVersion} (${recorded.length}/${sorted.length} migrations recorded)`);
    return {
      previousVersion,
      currentVersion: previousVersion,
      targetVersion,
      backupPath: null,
      appliedNow: [],
      history: recorded,
      rollbackWarning: null,
    };
  }

  let backupPath: string | null = null;
  if (hadExistingData) {
    try {
      backupPath = createPreMigrationBackup(db, ctx.dataDir, previousVersion, targetVersion);
      logDbMigration('INFO', `Created pre-migration snapshot: ${backupPath}`);
    } catch (err) {
      logDbMigration(
        'WARN',
        `Pre-migration snapshot skipped (${err instanceof Error ? err.message : String(err)}); proceeding with transactional migration`,
      );
    }
  }

  const appliedNow: AppliedMigrationRecord[] = [];

  for (const migration of pending) {
    const startedMs = performance.now();
    const checksum = computeMigrationChecksum(migration);
    const appliedAt = new Date().toISOString();

    if (migration.disableForeignKeys) {
      db.pragma('foreign_keys = OFF');
    }

    try {
      const runTx = db.transaction(() => {
        migration.up(db, ctx);
        const durationMs = Math.max(0, Math.round(performance.now() - startedMs));
        db.prepare(`
          INSERT INTO schema_migrations (version, name, description, checksum, applied_at, duration_ms)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(migration.version, migration.name, migration.description, checksum, appliedAt, durationMs);
        db.pragma(`user_version = ${migration.version}`);
        return durationMs;
      });

      const durationMs = runTx();

      if (migration.disableForeignKeys) {
        db.pragma('foreign_keys = ON');
        const fkViolations = db.pragma('foreign_key_check') as unknown[];
        if (fkViolations.length > 0) {
          throw new Error(`Foreign key integrity check failed after migration v${migration.version} (${fkViolations.length} violation(s))`);
        }
      }

      appliedNow.push({
        version: migration.version,
        name: migration.name,
        description: migration.description,
        checksum,
        appliedAt,
        durationMs,
      });

      logDbMigration('INFO', `Applied migration v${migration.version} (${migration.name}) in ${durationMs}ms`);
    } catch (err) {
      if (migration.disableForeignKeys) {
        try {
          db.pragma('foreign_keys = ON');
        } catch {
          // Ignore secondary pragma error
        }
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      logDbMigration(
        'ERROR',
        `Migration v${migration.version} (${migration.name}) failed and rolled back: ${errMsg}${backupPath ? ` (backup preserved at ${backupPath})` : ''}`,
      );
      throw err;
    }
  }

  const finalVersion = Number(db.pragma('user_version', { simple: true }) || targetVersion);
  const fullHistory = readAppliedHistory(db);

  logDbMigration(
    'INFO',
    `Schema migration complete: v${previousVersion} -> v${finalVersion} (+${appliedNow.length} migration(s))`,
  );

  return {
    previousVersion,
    currentVersion: finalVersion,
    targetVersion,
    backupPath,
    appliedNow,
    history: fullHistory,
    rollbackWarning: null,
  };
}
