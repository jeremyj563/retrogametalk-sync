import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, runDatabaseMigrations } from './migrations.ts';
import { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';
import {
  isCatalogStatusAlreadyDownloaded,
  isCatalogStatusAlreadyQueued,
  isCatalogStatusInstallable,
  isCatalogStatusQueueable,
} from '../shared/catalogSelection.ts';
import { normalizeCatalogSort } from '../shared/catalogSort.ts';
import { parseHumanFileSizeToBytes } from '../shared/fileSize.ts';
import {
  classifyFileRoleToTypeKeys,
  evaluateReleaseTypeMatch,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter.ts';
import { normalizeFilenameKey } from './syncFastSkip.ts';
import {
  createDefaultStorageFolderConfig,
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
} from '../shared/storageFolderMappings.ts';
import {
  generateUuidDeviceProfileId,
  makeStableDeviceProfileId,
  normalizeDeviceRomNaming,
  sanitizeDeviceColorKey,
  sanitizeDeviceIconKey,
  sanitizeDeviceProfileId,
  sanitizeInstalledPathsList,
  sanitizeIsoTimestamp,
  type DeviceUninstallTargetRecord,
} from '../shared/deviceProfiles.ts';
import {
  classifyRomNamingType,
  DEFAULT_ROM_NAMING_TEMPLATE,
  normalizeRomNamingTypeOverrides,
  ROM_NAMING_PREVIEW_TYPE_KEYS,
  type RomNamingPreviewSample,
  type RomNamingTypeKey,
} from '../shared/romNaming.ts';
import {
  canonicalizeSystemSlug,
  expandSystemAliases,
  filterValidSystemSlugs,
  resolveSystemDisplayInfo,
  sanitizeSystemFilterString,
} from '../shared/systemCatalog.ts';
import {
  classifySystemIndexFreshness,
  DEFAULT_INDEX_STALE_MS,
  doesCatalogReleaseMatchSyncRules,
  formatSyncRuleScopeSummary,
  normalizeSyncOverride,
  normalizeTargetConsoleSlugs,
  resolveTargetConsoleScope,
  type SyncOverrideMode,
} from '../shared/syncRuleMatcher.ts';
import {
  classifyInstalledUpdateState,
  hasActionableRemoteUpdate,
  type InstalledUpdateDownloadHintLike,
  type InstalledUpdateFileLike,
} from '../shared/deviceInstallUpdates.ts';
import type {
  ActivityLogRecord,
  CatalogFacetCounts,
  CatalogFacets,
  CatalogGrowthPoint,
  CatalogSortOption,
  CatalogStatsSnapshot,
  CompositionStat,
  ConfigUpdateInput,
  DatabaseMigrationReport,
  DeviceRomNamingOverrides,
  DownloadTrendDailyPoint,
  DownloadTrendRunPoint,
  DryRunConsoleBreakdown,
  DryRunSampleRelease,
  FileItemStatus,
  FilterMatchMode,
  ItemStatus,
  LogLevel,
  OutdatedInstalledItemSummary,
  OutdatedInstalledSummary,
  ReleaseDeviceInstallRecord,
  ReleaseFileRecord,
  ReleaseMetadata,
  ReleaseTypeBreakdown,
  RepositoryItemRecord,
  RunMode,
  RunStatus,
  RunTrigger,
  ScraperConfigInternal,
  ScraperConfigPublic,
  SizeBucketStat,
  StorageDeviceProfile,
  SyncPreflightSummary,
  SyncRunRecord,
  SyncRunSummarySnapshot,
  SystemBreakdown,
  SystemCoverageStat,
  SystemIndexCursor,
  UserCollectionRecord,
} from './types.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || '/run/repo/.rgt-data');
const DEFAULT_DOWNLOAD_DIR = path.resolve(
  process.env.DOWNLOAD_DIR || (process.env.DATA_DIR ? path.join(DATA_DIR, 'repository') : '/run/repo'),
);
const DB_PATH = path.join(DATA_DIR, 'scraper.db');
const KEY_PATH = path.join(DATA_DIR, '.keyfile');

let db: Database.Database | null = null;
let cachedKey: Buffer | null = null;
let lastMigrationReport: DatabaseMigrationReport | null = null;

export function getDataDir(): string {
  return DATA_DIR;
}

export function getCookieJarPath(): string {
  return path.join(DATA_DIR, 'cookies.json');
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length >= 16) {
    cachedKey = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
    return cachedKey;
  }

  if (fs.existsSync(KEY_PATH)) {
    const raw = fs.readFileSync(KEY_PATH, 'utf8').trim();
    cachedKey = Buffer.from(raw, 'hex');
    if (cachedKey.length === 32) return cachedKey;
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_PATH, generated.toString('hex'), { mode: 0o600 });
  cachedKey = generated;
  return cachedKey;
}

function encryptSecret(plaintext: string): string {
  if (!plaintext) return '';
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) return '';
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const ciphertext = Buffer.from(parts[2], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function migrateLegacyDataDirOnce(): void {
  if (DATA_DIR !== '/run/repo/.rgt-data' || fs.existsSync(DB_PATH)) {
    return;
  }

  const candidates = ['/app/data', '/run/repo', path.resolve('./data')]
    .map((p) => path.resolve(p))
    .filter((p) => p !== DATA_DIR && fs.existsSync(p));

  let bestDir: string | null = null;
  let bestMtimeMs = -1;

  for (const dir of candidates) {
    for (const marker of ['scraper.db-wal', 'scraper.db', 'cookies.json']) {
      const markerPath = path.join(dir, marker);
      if (!fs.existsSync(markerPath)) continue;
      try {
        const st = fs.statSync(markerPath);
        if (st.mtimeMs > bestMtimeMs) {
          bestMtimeMs = st.mtimeMs;
          bestDir = dir;
        }
      } catch {
        // Ignore unreadable candidate marker
      }
    }
  }

  if (!bestDir) return;

  for (const filename of ['scraper.db', 'scraper.db-wal', 'scraper.db-shm', 'cookies.json', '.keyfile']) {
    const src = path.join(bestDir, filename);
    const dst = path.join(DATA_DIR, filename);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.copyFileSync(src, dst);
      if (filename === 'cookies.json' || filename === '.keyfile') {
        fs.chmodSync(dst, 0o600);
      }
    } catch {
      // Proceed cleanly if individual legacy state file cannot be copied
    }
  }
}

export function initDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  migrateLegacyDataDirOnce();
  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  lastMigrationReport = runDatabaseMigrations(db, {
    dataDir: DATA_DIR,
    defaultDownloadDir: DEFAULT_DOWNLOAD_DIR,
  });

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM scraper_config WHERE id = 1').get() as { id: number } | undefined;
  if (!existing) {
    const envTypes = normalizeAllowedReleaseTypes(process.env.SCRAPER_RELEASE_TYPE_FILTER || '');
    db.prepare(`
      INSERT INTO scraper_config (
        id, base_url, login_url, username, password_enc, download_dir,
        cron_schedule, schedule_enabled, base_delay_ms, min_delay_ms, max_delay_ms,
        backoff_multiplier, max_retries, max_concurrency, request_timeout_ms,
        user_agent, system_filter, allowed_release_types_json, last_watermark_at,
        rom_naming_template, rom_naming_type_overrides_json, updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, 0, 1500, 750, 45000, 1.8, 4, 1, 30000, ?, ?, ?, NULL, ?, '{}', ?
      )
    `).run(
      process.env.RGT_BASE_URL || 'https://retrogametalk.com/repo/',
      process.env.RGT_LOGIN_URL || 'https://retrogametalk.com/login/',
      process.env.RGT_USERNAME || '',
      process.env.RGT_PASSWORD ? encryptSecret(process.env.RGT_PASSWORD) : '',
      DEFAULT_DOWNLOAD_DIR,
      process.env.CRON_SCHEDULE || '0 */6 * * *',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      process.env.SCRAPER_SYSTEM_FILTER || '',
      JSON.stringify(envTypes),
      DEFAULT_ROM_NAMING_TEMPLATE,
      now,
    );
  }

  // Record migration summary in activity_logs whenever a new revision actually applied migrations
  if (lastMigrationReport.appliedNow.length > 0) {
    const appliedLabels = lastMigrationReport.appliedNow.map((m) => `v${m.version}:${m.name}`).join(', ');
    db.prepare(`
      INSERT INTO activity_logs (run_id, level, message, detail, created_at)
      VALUES (NULL, 'info', ?, ?, ?)
    `).run(
      `Applied ${lastMigrationReport.appliedNow.length} SQLite schema migration(s): v${lastMigrationReport.previousVersion} → v${lastMigrationReport.currentVersion}`,
      `${appliedLabels}${lastMigrationReport.backupPath ? ` · Snapshot: ${lastMigrationReport.backupPath}` : ''}`,
      now,
    );
  } else if (lastMigrationReport.rollbackWarning) {
    db.prepare(`
      INSERT INTO activity_logs (run_id, level, message, detail, created_at)
      VALUES (NULL, 'warn', ?, NULL, ?)
    `).run(lastMigrationReport.rollbackWarning, now);
  }

  recoverInterruptedRunsOnStartup(db, now);

  const remainingRuns = db.prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };
  if (remainingRuns.count === 0) {
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'sync_runs'`).run();
  }

  invalidateReleaseFileRolesCache();
  return db;
}

export function recoverInterruptedRunsOnStartup(
  targetDb: Database.Database = getDb(),
  now: string = new Date().toISOString(),
): void {
  // Recover any stale running jobs left behind by an abrupt container kill
  const interruptedDownloadRuns = targetDb.prepare(`
    SELECT COUNT(*) as count FROM sync_runs
    WHERE status = 'running' AND trigger_type = 'download'
  `).get() as { count: number };
  const existingQueuedReleases = targetDb.prepare(`
    SELECT COUNT(*) as count FROM catalog_releases
    WHERE status = 'queued'
  `).get() as { count: number };
  const restoreDownloadingToQueued =
    Number(interruptedDownloadRuns.count || 0) > 0 || Number(existingQueuedReleases.count || 0) > 0;

  targetDb.prepare(`
    UPDATE sync_runs
    SET status = 'stopped', finished_at = ?, error_summary = COALESCE(error_summary, 'Interrupted by process restart')
    WHERE status = 'running'
  `).run(now);

  const interruptedReleaseRows = targetDb.prepare(`
    SELECT id FROM catalog_releases WHERE status = 'downloading'
    UNION
    SELECT DISTINCT release_id AS id FROM catalog_release_files WHERE status = 'downloading'
  `).all() as { id: number }[];

  if (restoreDownloadingToQueued) {
    targetDb.prepare(`
      UPDATE catalog_release_files
      SET status = 'queued', error_message = NULL
      WHERE status = 'downloading'
    `).run();

    targetDb.prepare(`
      UPDATE catalog_releases
      SET status = 'queued', error_message = NULL
      WHERE status = 'downloading'
    `).run();
  } else {
    targetDb.prepare(`
      UPDATE catalog_release_files
      SET status = 'failed', error_message = COALESCE(error_message, 'Interrupted by process restart')
      WHERE status = 'downloading'
    `).run();

    targetDb.prepare(`
      UPDATE catalog_releases
      SET status = 'failed', error_message = COALESCE(error_message, 'Interrupted by process restart')
      WHERE status = 'downloading'
    `).run();
  }

  for (const relRow of interruptedReleaseRows) {
    recomputeReleaseRollup(Number(relRow.id));
  }
}

export function getSchemaMigrationReport(): DatabaseMigrationReport {
  if (!db) {
    initDb();
  }
  if (lastMigrationReport) {
    return lastMigrationReport;
  }
  const currentVersion = Number(getDb().pragma('user_version', { simple: true }) || 0);
  return {
    previousVersion: currentVersion,
    currentVersion,
    targetVersion: LATEST_SCHEMA_VERSION,
    backupPath: null,
    appliedNow: [],
    history: [],
    rollbackWarning: null,
  };
}

function getDb(): Database.Database {
  return db || initDb();
}

export function getDbInstance(): Database.Database {
  return getDb();
}

export function getInternalConfig(): ScraperConfigInternal {
  const row = getDb().prepare('SELECT * FROM scraper_config WHERE id = 1').get() as Record<string, unknown>;
  const envOverrides: string[] = [];

  let baseUrl = String(row.base_url);
  let loginUrl = String(row.login_url);
  let username = String(row.username || '');
  let password = decryptSecret(String(row.password_enc || ''));
  let downloadDir = String(row.download_dir);
  let cronSchedule = String(row.cron_schedule);
  let systemFilter = String(row.system_filter || '');

  if (process.env.RGT_BASE_URL) {
    baseUrl = process.env.RGT_BASE_URL;
    envOverrides.push('RGT_BASE_URL');
  }
  if (process.env.RGT_LOGIN_URL) {
    loginUrl = process.env.RGT_LOGIN_URL;
    envOverrides.push('RGT_LOGIN_URL');
  }
  if (process.env.RGT_USERNAME) {
    username = process.env.RGT_USERNAME;
    envOverrides.push('RGT_USERNAME');
  }
  if (process.env.RGT_PASSWORD) {
    password = process.env.RGT_PASSWORD;
    envOverrides.push('RGT_PASSWORD');
  }
  if (process.env.DATA_DIR) {
    envOverrides.push('DATA_DIR');
  }
  if (process.env.DOWNLOAD_DIR) {
    downloadDir = path.resolve(process.env.DOWNLOAD_DIR);
    envOverrides.push('DOWNLOAD_DIR');
  }
  if (process.env.CRON_SCHEDULE) {
    cronSchedule = process.env.CRON_SCHEDULE;
    envOverrides.push('CRON_SCHEDULE');
  }
  if (process.env.SCRAPER_SYSTEM_FILTER !== undefined && process.env.SCRAPER_SYSTEM_FILTER !== '') {
    systemFilter = process.env.SCRAPER_SYSTEM_FILTER;
    envOverrides.push('SCRAPER_SYSTEM_FILTER');
  }

  let scheduleEnabled = Boolean(row.schedule_enabled);
  let autoDownloadNewReleases =
    row.auto_download_new_releases !== undefined ? Boolean(row.auto_download_new_releases) : true;
  let baseDelayMs = Number(row.base_delay_ms);
  let minDelayMs = Number(row.min_delay_ms);
  let maxDelayMs = Number(row.max_delay_ms);
  let backoffMultiplier = Number(row.backoff_multiplier);
  let maxRetries = Number(row.max_retries);
  let maxConcurrency = Number(row.max_concurrency);
  const rawRowChunkConc = Number(row.download_chunk_concurrency ?? 1);
  let downloadChunkConcurrency = Number.isFinite(rawRowChunkConc)
    ? Math.max(1, Math.min(4, Math.round(rawRowChunkConc)))
    : 1;
  const rawRowChunkMinMb = Number(row.download_chunk_min_size_mb ?? 32);
  let downloadChunkMinSizeMb = Number.isFinite(rawRowChunkMinMb)
    ? Math.max(4, Math.min(128, Math.round(rawRowChunkMinMb)))
    : 32;
  let requestTimeoutMs = Number(row.request_timeout_ms);
  let userAgent = String(row.user_agent);

  if (process.env.SCRAPER_SCHEDULE_ENABLED !== undefined && process.env.SCRAPER_SCHEDULE_ENABLED !== '') {
    scheduleEnabled = process.env.SCRAPER_SCHEDULE_ENABLED === 'true' || process.env.SCRAPER_SCHEDULE_ENABLED === '1';
    envOverrides.push('SCRAPER_SCHEDULE_ENABLED');
  }
  if (
    process.env.SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES !== undefined &&
    process.env.SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES !== ''
  ) {
    autoDownloadNewReleases =
      process.env.SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES === 'true' ||
      process.env.SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES === '1';
    envOverrides.push('SCRAPER_AUTO_DOWNLOAD_NEW_RELEASES');
  }
  if (process.env.SCRAPER_BASE_DELAY_MS) {
    baseDelayMs = Number(process.env.SCRAPER_BASE_DELAY_MS);
    envOverrides.push('SCRAPER_BASE_DELAY_MS');
  }
  if (process.env.SCRAPER_MIN_DELAY_MS) {
    minDelayMs = Number(process.env.SCRAPER_MIN_DELAY_MS);
    envOverrides.push('SCRAPER_MIN_DELAY_MS');
  }
  if (process.env.SCRAPER_MAX_DELAY_MS) {
    maxDelayMs = Number(process.env.SCRAPER_MAX_DELAY_MS);
    envOverrides.push('SCRAPER_MAX_DELAY_MS');
  }
  if (process.env.SCRAPER_BACKOFF_MULTIPLIER) {
    backoffMultiplier = Number(process.env.SCRAPER_BACKOFF_MULTIPLIER);
    envOverrides.push('SCRAPER_BACKOFF_MULTIPLIER');
  }
  if (process.env.SCRAPER_MAX_RETRIES) {
    maxRetries = Number(process.env.SCRAPER_MAX_RETRIES);
    envOverrides.push('SCRAPER_MAX_RETRIES');
  }
  if (process.env.SCRAPER_MAX_CONCURRENCY) {
    maxConcurrency = Number(process.env.SCRAPER_MAX_CONCURRENCY);
    envOverrides.push('SCRAPER_MAX_CONCURRENCY');
  }
  if (process.env.SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY) {
    const parsedChunkConc = Number(process.env.SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY);
    if (Number.isFinite(parsedChunkConc)) {
      downloadChunkConcurrency = Math.max(1, Math.min(4, Math.round(parsedChunkConc)));
    }
    envOverrides.push('SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY');
  }
  if (process.env.SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB) {
    const parsedMinMb = Number(process.env.SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB);
    if (Number.isFinite(parsedMinMb)) {
      downloadChunkMinSizeMb = Math.max(4, Math.min(128, Math.round(parsedMinMb)));
    }
    envOverrides.push('SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB');
  }
  if (process.env.SCRAPER_REQUEST_TIMEOUT_MS) {
    requestTimeoutMs = Number(process.env.SCRAPER_REQUEST_TIMEOUT_MS);
    envOverrides.push('SCRAPER_REQUEST_TIMEOUT_MS');
  }
  if (process.env.SCRAPER_USER_AGENT) {
    userAgent = process.env.SCRAPER_USER_AGENT;
    envOverrides.push('SCRAPER_USER_AGENT');
  }

  let discoveredSystems: string[] = [];
  try {
    const parsed = JSON.parse(String(row.discovered_systems_json || '[]'));
    if (Array.isArray(parsed)) {
      discoveredSystems = filterValidSystemSlugs(parsed.map(String));
    }
  } catch {
    discoveredSystems = [];
  }

  let storageFolderConfig = createDefaultStorageFolderConfig();
  try {
    const parsedFolderConfig = JSON.parse(String(row.storage_folder_config_json || '{}'));
    storageFolderConfig = normalizeStorageFolderConfig(parsedFolderConfig);
  } catch {
    storageFolderConfig = createDefaultStorageFolderConfig();
  }

  let allowedReleaseTypes: string[] = [];
  if (process.env.SCRAPER_RELEASE_TYPE_FILTER !== undefined && process.env.SCRAPER_RELEASE_TYPE_FILTER !== '') {
    allowedReleaseTypes = normalizeAllowedReleaseTypes(process.env.SCRAPER_RELEASE_TYPE_FILTER);
    envOverrides.push('SCRAPER_RELEASE_TYPE_FILTER');
  } else {
    try {
      const parsedTypes = JSON.parse(String(row.allowed_release_types_json || '[]'));
      allowedReleaseTypes = normalizeAllowedReleaseTypes(parsedTypes);
    } catch {
      allowedReleaseTypes = [];
    }
  }

  let systemIndexState: Record<string, SystemIndexCursor> = {};
  try {
    const parsedIndexState = JSON.parse(String(row.system_index_state_json || '{}'));
    if (parsedIndexState && typeof parsedIndexState === 'object' && !Array.isArray(parsedIndexState)) {
      systemIndexState = parsedIndexState as Record<string, SystemIndexCursor>;
    }
  } catch {
    systemIndexState = {};
  }

  return {
    baseUrl,
    loginUrl,
    username,
    password,
    hasPassword: password.length > 0,
    dataDir: DATA_DIR,
    downloadDir,
    cronSchedule,
    scheduleEnabled,
    baseDelayMs,
    minDelayMs,
    maxDelayMs,
    backoffMultiplier,
    maxRetries,
    maxConcurrency,
    downloadChunkConcurrency,
    downloadChunkMinSizeMb,
    requestTimeoutMs,
    userAgent,
    systemFilter,
    allowedReleaseTypes,
    discoveredSystems,
    lastWatermarkAt: row.last_watermark_at ? String(row.last_watermark_at) : null,
    romNamingTemplate: String(row.rom_naming_template || DEFAULT_ROM_NAMING_TEMPLATE),
    romNamingTypeOverrides: (() => {
      try {
        return normalizeRomNamingTypeOverrides(
          JSON.parse(String(row.rom_naming_type_overrides_json || '{}')),
        );
      } catch {
        return {};
      }
    })(),
    romSanitizeFat32: row.rom_sanitize_fat32 !== undefined ? Boolean(row.rom_sanitize_fat32) : true,
    romMaxFilenameLen: Math.max(0, Number(row.rom_max_filename_len || 0)),
    storageFolderConfig,
    autoDownloadNewReleases,
    systemIndexState,
    updatedAt: String(row.updated_at),
    envOverrides,
  };
}

export function getPublicConfig(): ScraperConfigPublic {
  const internal = getInternalConfig();
  return {
    ...internal,
    password: '',
    hasPassword: Boolean(internal.password),
  };
}

export function getSystemIndexState(): Record<string, SystemIndexCursor> {
  const row = getDb()
    .prepare('SELECT system_index_state_json FROM scraper_config WHERE id = 1')
    .get() as { system_index_state_json?: string } | undefined;
  try {
    const parsed = JSON.parse(String(row?.system_index_state_json || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, SystemIndexCursor>;
    }
  } catch {
    // ignore malformed state
  }
  return {};
}

export function updateSystemIndexCursor(systemSlug: string, cursor: SystemIndexCursor): Record<string, SystemIndexCursor> {
  const canonical = canonicalizeSystemSlug(systemSlug) || systemSlug.trim().toLowerCase();
  const tx = getDb().transaction(() => {
    const current = getSystemIndexState();
    current[canonical] = cursor;
    getDb()
      .prepare('UPDATE scraper_config SET system_index_state_json = ?, updated_at = ? WHERE id = 1')
      .run(JSON.stringify(current), new Date().toISOString());
    return current;
  });
  return tx();
}

export function invalidateSystemIndexCursors(systemSlugs: readonly string[]): Record<string, SystemIndexCursor> {
  const targetSet = new Set(
    systemSlugs
      .map((s) => (canonicalizeSystemSlug(s) || s.trim()).toLowerCase())
      .filter(Boolean),
  );
  if (targetSet.size === 0) return getSystemIndexState();
  const tx = getDb().transaction(() => {
    const current = getSystemIndexState();
    let changed = false;
    for (const [key, cursor] of Object.entries(current)) {
      const canonical = (canonicalizeSystemSlug(key) || key).toLowerCase();
      if (targetSet.has(canonical) && cursor?.fullyIndexed) {
        current[key] = {
          ...cursor,
          fullyIndexed: false,
        };
        changed = true;
      }
    }
    if (changed) {
      getDb()
        .prepare('UPDATE scraper_config SET system_index_state_json = ?, updated_at = ? WHERE id = 1')
        .run(JSON.stringify(current), new Date().toISOString());
    }
    return current;
  });
  return tx();
}

export function getCatalogReleaseCountsBySystem(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT system_name, COUNT(*) as count FROM catalog_releases GROUP BY system_name')
    .all() as { system_name: string; count: number }[];
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const canonical = (canonicalizeSystemSlug(String(row.system_name || '')) || String(row.system_name || '')).toLowerCase();
    if (!canonical) continue;
    counts[canonical] = (counts[canonical] ?? 0) + Number(row.count || 0);
  }
  return counts;
}

export function saveDiscoveredSystems(systems: string[]): string[] {
  const merged = filterValidSystemSlugs([
    ...getInternalConfig().discoveredSystems,
    ...systems,
  ]);

  getDb().prepare('UPDATE scraper_config SET discovered_systems_json = ?, updated_at = ? WHERE id = 1').run(
    JSON.stringify(merged),
    new Date().toISOString(),
  );

  return merged;
}

function validateHttpUrl(raw: string, fieldLabel: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel} is required and cannot be empty.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): enter a full URL starting with https:// or http://.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): protocol must be http:// or https://.`);
  }
  if (!parsed.hostname) {
    throw new Error(`Invalid ${fieldLabel} ("${trimmed}"): hostname is missing.`);
  }
  return parsed.toString();
}

function normalizeComparableUrl(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${cleanPath}${parsed.search}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function updateConfig(input: ConfigUpdateInput): ScraperConfigPublic {
  const current = getDb().prepare('SELECT * FROM scraper_config WHERE id = 1').get() as Record<string, unknown>;
  const now = new Date().toISOString();

  const nextBaseUrl = input.baseUrl !== undefined
    ? validateHttpUrl(input.baseUrl, 'Repository Base URL')
    : String(current.base_url).trim();
  const nextLoginUrl = input.loginUrl !== undefined
    ? validateHttpUrl(input.loginUrl, 'Login Endpoint URL')
    : String(current.login_url).trim();

  const nextDownloadDir = input.downloadDir !== undefined
    ? path.resolve(input.downloadDir.trim() || DEFAULT_DOWNLOAD_DIR)
    : String(current.download_dir);

  fs.mkdirSync(nextDownloadDir, { recursive: true });

  const nextUsername = (input.username ?? String(current.username)).trim();
  const clearPasswordRequested = input.clearPassword === true;
  const replacementPassword =
    typeof input.password === 'string' && input.password.length > 0 ? input.password : null;
  const nextPasswordEnc = clearPasswordRequested
    ? ''
    : replacementPassword !== null
      ? encryptSecret(replacementPassword)
      : String(current.password_enc || '');

  const effectiveCurrentBaseUrl = process.env.RGT_BASE_URL || String(current.base_url || '');
  const effectiveCurrentLoginUrl = process.env.RGT_LOGIN_URL || String(current.login_url || '');
  const effectiveCurrentUsername = process.env.RGT_USERNAME || String(current.username || '');
  const currentPasswordPlain = process.env.RGT_PASSWORD || decryptSecret(String(current.password_enc || ''));

  const baseChanged =
    !process.env.RGT_BASE_URL &&
    normalizeComparableUrl(nextBaseUrl) !== normalizeComparableUrl(effectiveCurrentBaseUrl);
  const loginChanged =
    !process.env.RGT_LOGIN_URL &&
    normalizeComparableUrl(nextLoginUrl) !== normalizeComparableUrl(effectiveCurrentLoginUrl);
  const usernameChanged =
    !process.env.RGT_USERNAME &&
    nextUsername !== effectiveCurrentUsername.trim();
  const passwordChanged =
    !process.env.RGT_PASSWORD &&
    ((clearPasswordRequested && currentPasswordPlain !== '') ||
      (replacementPassword !== null && replacementPassword !== currentPasswordPlain));

  const authCredentialsChanged = baseChanged || loginChanged || usernameChanged || passwordChanged;

  let nextWatermarkAt: string | null = current.last_watermark_at ? String(current.last_watermark_at) : null;
  if (input.lastWatermarkAt !== undefined) {
    if (input.lastWatermarkAt === null || input.lastWatermarkAt.trim() === '') {
      nextWatermarkAt = null;
    } else {
      const parsedMs = Date.parse(input.lastWatermarkAt.trim());
      if (Number.isNaN(parsedMs)) {
        throw new Error(
          `Invalid Incremental Cutoff timestamp ("${input.lastWatermarkAt}"): enter a valid date and time.`,
        );
      }
      nextWatermarkAt = new Date(parsedMs).toISOString();
    }
  }

  const minDelay = Math.max(250, Math.min(30000, Number(input.minDelayMs ?? current.min_delay_ms)));
  const maxDelay = Math.max(minDelay, Math.min(300000, Number(input.maxDelayMs ?? current.max_delay_ms)));
  const baseDelay = Math.max(minDelay, Math.min(maxDelay, Number(input.baseDelayMs ?? current.base_delay_ms)));

  const nextRomNamingTemplate =
    input.romNamingTemplate !== undefined
      ? (input.romNamingTemplate.trim().slice(0, 200) || DEFAULT_ROM_NAMING_TEMPLATE)
      : String(current.rom_naming_template || DEFAULT_ROM_NAMING_TEMPLATE);
  let nextRomNamingTypeOverridesJson = String(current.rom_naming_type_overrides_json || '{}');
  if (input.romNamingTypeOverrides !== undefined) {
    nextRomNamingTypeOverridesJson = JSON.stringify(
      normalizeRomNamingTypeOverrides(input.romNamingTypeOverrides),
    );
  }
  const nextRomSanitizeFat32 =
    input.romSanitizeFat32 !== undefined
      ? (input.romSanitizeFat32 ? 1 : 0)
      : Number(current.rom_sanitize_fat32 ?? 1);
  const rawMaxLen = Number(input.romMaxFilenameLen ?? current.rom_max_filename_len ?? 0);
  const nextRomMaxFilenameLen =
    !Number.isFinite(rawMaxLen) || rawMaxLen <= 0 ? 0 : Math.max(24, Math.min(255, Math.round(rawMaxLen)));
  let nextStorageFolderConfigJson = String(current.storage_folder_config_json || '{}');
  if (input.storageFolderConfig !== undefined) {
    nextStorageFolderConfigJson = JSON.stringify(
      normalizeStorageFolderConfig(input.storageFolderConfig),
    );
  }

  let nextAllowedReleaseTypesJson = String(current.allowed_release_types_json || '[]');
  if (input.allowedReleaseTypes !== undefined) {
    nextAllowedReleaseTypesJson = JSON.stringify(
      normalizeAllowedReleaseTypes(input.allowedReleaseTypes),
    );
  }

  getDb().prepare(`
    UPDATE scraper_config SET
      base_url = ?,
      login_url = ?,
      username = ?,
      password_enc = ?,
      download_dir = ?,
      cron_schedule = ?,
      schedule_enabled = ?,
      base_delay_ms = ?,
      min_delay_ms = ?,
      max_delay_ms = ?,
      backoff_multiplier = ?,
      max_retries = ?,
      max_concurrency = ?,
      download_chunk_concurrency = ?,
      download_chunk_min_size_mb = ?,
      request_timeout_ms = ?,
      user_agent = ?,
      system_filter = ?,
      allowed_release_types_json = ?,
      last_watermark_at = ?,
      rom_naming_template = ?,
      rom_naming_type_overrides_json = ?,
      rom_sanitize_fat32 = ?,
      rom_max_filename_len = ?,
      storage_folder_config_json = ?,
      auto_download_new_releases = ?,
      last_authenticated_at = ?,
      updated_at = ?
    WHERE id = 1
  `).run(
    nextBaseUrl,
    nextLoginUrl,
    nextUsername,
    nextPasswordEnc,
    nextDownloadDir,
    (input.cronSchedule ?? String(current.cron_schedule)).trim(),
    input.scheduleEnabled !== undefined ? (input.scheduleEnabled ? 1 : 0) : Number(current.schedule_enabled),
    baseDelay,
    minDelay,
    maxDelay,
    Math.max(1.2, Math.min(5.0, Number(input.backoffMultiplier ?? current.backoff_multiplier))),
    Math.max(0, Math.min(15, Number(input.maxRetries ?? current.max_retries))),
    Math.max(1, Math.min(4, Number(input.maxConcurrency ?? current.max_concurrency))),
    (() => {
      const n = Number(input.downloadChunkConcurrency ?? current.download_chunk_concurrency ?? 1);
      return Number.isFinite(n) ? Math.max(1, Math.min(4, Math.round(n))) : 1;
    })(),
    (() => {
      const n = Number(input.downloadChunkMinSizeMb ?? current.download_chunk_min_size_mb ?? 32);
      return Number.isFinite(n) ? Math.max(4, Math.min(128, Math.round(n))) : 32;
    })(),
    Math.max(5000, Math.min(180000, Number(input.requestTimeoutMs ?? current.request_timeout_ms))),
    (input.userAgent ?? String(current.user_agent)).trim(),
    sanitizeSystemFilterString((input.systemFilter ?? String(current.system_filter)).trim()),
    nextAllowedReleaseTypesJson,
    nextWatermarkAt,
    nextRomNamingTemplate,
    nextRomNamingTypeOverridesJson,
    nextRomSanitizeFat32,
    nextRomMaxFilenameLen,
    nextStorageFolderConfigJson,
    input.autoDownloadNewReleases !== undefined
      ? (input.autoDownloadNewReleases ? 1 : 0)
      : Number(current.auto_download_new_releases ?? 1),
    authCredentialsChanged ? null : (current.last_authenticated_at ? String(current.last_authenticated_at) : null),
    now,
  );

  return getPublicConfig();
}

export function getLastAuthenticatedAt(): string | null {
  const row = getDb().prepare('SELECT last_authenticated_at FROM scraper_config WHERE id = 1').get() as
    | { last_authenticated_at: string | null }
    | undefined;
  return row?.last_authenticated_at ? String(row.last_authenticated_at) : null;
}

export function recordSuccessfulLogin(isoTimestamp = new Date().toISOString()): string {
  getDb().prepare('UPDATE scraper_config SET last_authenticated_at = ?, updated_at = ? WHERE id = 1').run(
    isoTimestamp,
    isoTimestamp,
  );
  return isoTimestamp;
}

export function clearLoginHistory(): void {
  getDb().prepare('UPDATE scraper_config SET last_authenticated_at = NULL, updated_at = ? WHERE id = 1').run(
    new Date().toISOString(),
  );
}

export function setWatermark(isoTimestamp: string): void {
  getDb().prepare('UPDATE scraper_config SET last_watermark_at = ?, updated_at = ? WHERE id = 1').run(
    isoTimestamp,
    new Date().toISOString(),
  );
}

export function createSyncRun(triggerType: RunTrigger, mode: RunMode, dryRun = false): SyncRunRecord {
  const startedAt = new Date().toISOString();
  const isLegacyDry = mode === 'dry_run';
  const storedMode: RunMode = isLegacyDry ? 'incremental' : mode;
  const storedDryRun = dryRun || isLegacyDry ? 1 : 0;
  const info = getDb().prepare(`
    INSERT INTO sync_runs (trigger_type, mode, dry_run, status, started_at)
    VALUES (?, ?, ?, 'running', ?)
  `).run(triggerType, storedMode, storedDryRun, startedAt);

  return getSyncRunById(Number(info.lastInsertRowid))!;
}

export function getSyncRunById(id: number): SyncRunRecord | null {
  const row = getDb().prepare('SELECT * FROM sync_runs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapRunRow(row) : null;
}

export function updateSyncRun(
  id: number,
  patch: Partial<{
    status: RunStatus;
    finishedAt: string | null;
    pagesCrawled: number;
    newFound: number;
    downloadedCount: number;
    skippedCount: number;
    failedCount: number;
    bytesDownloaded: number;
    rateLimitHits: number;
    avgDelayMs: number;
    errorSummary: string | null;
    summary: SyncRunSummarySnapshot | null;
  }>,
): SyncRunRecord | null {
  const existing = getSyncRunById(id);
  if (!existing) return null;

  const nextSummaryJson =
    patch.summary !== undefined
      ? (patch.summary ? JSON.stringify(patch.summary) : null)
      : (existing.summary ? JSON.stringify(existing.summary) : null);

  getDb().prepare(`
    UPDATE sync_runs SET
      status = ?,
      finished_at = ?,
      pages_crawled = ?,
      new_found = ?,
      downloaded_count = ?,
      skipped_count = ?,
      failed_count = ?,
      bytes_downloaded = ?,
      rate_limit_hits = ?,
      avg_delay_ms = ?,
      error_summary = ?,
      summary_json = ?
    WHERE id = ?
  `).run(
    patch.status ?? existing.status,
    patch.finishedAt !== undefined ? patch.finishedAt : existing.finishedAt,
    patch.pagesCrawled ?? existing.pagesCrawled,
    patch.newFound ?? existing.newFound,
    patch.downloadedCount ?? existing.downloadedCount,
    patch.skippedCount ?? existing.skippedCount,
    patch.failedCount ?? existing.failedCount,
    patch.bytesDownloaded ?? existing.bytesDownloaded,
    patch.rateLimitHits ?? existing.rateLimitHits,
    patch.avgDelayMs ?? existing.avgDelayMs,
    patch.errorSummary !== undefined ? patch.errorSummary : existing.errorSummary,
    nextSummaryJson,
    id,
  );

  return getSyncRunById(id);
}

export function listSyncRuns(limit = 25): SyncRunRecord[] {
  const rows = getDb().prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(mapRunRow);
}

function mapRunRow(row: Record<string, unknown>): SyncRunRecord {
  const rawMode = String(row.mode);
  const isLegacyDry = rawMode === 'dry_run';
  let summary: SyncRunSummarySnapshot | null = null;
  if (row.summary_json) {
    try {
      summary = JSON.parse(String(row.summary_json)) as SyncRunSummarySnapshot;
    } catch {
      summary = null;
    }
  }
  return {
    id: Number(row.id),
    triggerType: String(row.trigger_type) as RunTrigger,
    mode: (isLegacyDry ? 'incremental' : rawMode) as RunMode,
    dryRun: Boolean(row.dry_run) || isLegacyDry,
    status: String(row.status) as RunStatus,
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    pagesCrawled: Number(row.pages_crawled),
    newFound: Number(row.new_found),
    downloadedCount: Number(row.downloaded_count),
    skippedCount: Number(row.skipped_count),
    failedCount: Number(row.failed_count),
    bytesDownloaded: Number(row.bytes_downloaded),
    rateLimitHits: Number(row.rate_limit_hits),
    avgDelayMs: Number(row.avg_delay_ms),
    errorSummary: row.error_summary ? String(row.error_summary) : null,
    summary,
  };
}

function parseJsonStringArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || '[]'));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mapFileRow(row: Record<string, unknown>): ReleaseFileRecord {
  return {
    id: Number(row.id),
    releaseId: Number(row.release_id),
    remoteUrl: String(row.remote_url),
    downloadUrl: String(row.download_url),
    remotePath: String(row.remote_path),
    localPath: String(row.local_path),
    filename: String(row.filename),
    displayLabel: String(row.display_label || row.filename),
    fileRole: String(row.file_role || 'ROM'),
    fileSizeBytes: Number(row.file_size_bytes || 0),
    status: String(row.status) as FileItemStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    lastRunId: row.last_run_id !== null ? Number(row.last_run_id) : null,
    discoveredAt: String(row.discovered_at),
    downloadedAt: row.downloaded_at ? String(row.downloaded_at) : null,
  };
}

function mapReleaseRow(
  row: Record<string, unknown>,
  files: ReleaseFileRecord[],
  collectionIds: number[] = [],
  deviceInstalls: ReleaseDeviceInstallRecord[] = [],
): RepositoryItemRecord {
  let parsedMeta: ReleaseMetadata | null = null;
  if (row.metadata_json) {
    try {
      parsedMeta = JSON.parse(String(row.metadata_json)) as ReleaseMetadata;
    } catch {
      parsedMeta = null;
    }
  }
  const screenshots = parseJsonStringArray(row.screenshots_json);
  const releaseTags = parseJsonStringArray(row.release_tags_json);
  const genres = parseJsonStringArray(row.genres_json);
  const regions = parseJsonStringArray(row.regions_json);
  const languages = parseJsonStringArray(row.languages_json);
  const sources = parseJsonStringArray(row.sources_json);

  return {
    id: Number(row.id),
    wpPostId: row.wp_post_id !== null && row.wp_post_id !== undefined ? Number(row.wp_post_id) : null,
    wpPostType: row.wp_post_type ? String(row.wp_post_type) : null,
    remoteUrl: String(row.remote_url),
    remotePath: String(row.remote_path),
    localPath: String(row.local_path),
    systemName: String(row.system_name),
    releaseType: String(row.release_type || releaseTags[0] || 'Retail ROM'),
    releaseTags,
    title: String(row.title),
    fileSizeBytes: Number(row.file_size_bytes || 0),
    sizeIsEstimated: Boolean(row.size_is_estimated),
    publishedAt: row.published_at ? String(row.published_at) : (parsedMeta?.publishedAt ?? null),
    remoteUpdatedAt: row.remote_updated_at ? String(row.remote_updated_at) : (parsedMeta?.remoteUpdatedAt ?? null),
    remoteCheckedAt: row.remote_checked_at ? String(row.remote_checked_at) : null,
    status: String(row.status) as ItemStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    lastRunId: row.last_run_id !== null ? Number(row.last_run_id) : null,
    discoveredAt: String(row.discovered_at),
    downloadedAt: row.downloaded_at ? String(row.downloaded_at) : null,
    publisher: row.publisher ? String(row.publisher) : null,
    developer: row.developer ? String(row.developer) : null,
    releaseYear: row.release_year ? String(row.release_year) : null,
    genres,
    regions,
    languages,
    sources,
    coverLocalPath: row.cover_local_path ? String(row.cover_local_path) : null,
    screenshotsCount: screenshots.length,
    hasMetadata: Boolean(parsedMeta),
    metadata: parsedMeta,
    installedAt: row.installed_at ? String(row.installed_at) : null,
    installedDeviceLabel: row.installed_device_label ? String(row.installed_device_label) : null,
    installedFileId:
      row.installed_file_id !== null && row.installed_file_id !== undefined
        ? Number(row.installed_file_id)
        : null,
    installedFilename: row.installed_filename ? String(row.installed_filename) : null,
    deviceInstalls,
    isFavorite: Boolean(row.is_favorite),
    syncOverride: normalizeSyncOverride(row.sync_override),
    collectionIds,
    filesCount: files.length,
    files,
  };
}

const SQLITE_ID_CHUNK_SIZE = 400;

function chunkNumberIds(ids: number[], chunkSize: number = SQLITE_ID_CHUNK_SIZE): number[][] {
  if (ids.length === 0) return [];
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    chunks.push(ids.slice(i, i + chunkSize));
  }
  return chunks;
}

function loadFilesByReleaseIds(releaseIds: number[]): Map<number, ReleaseFileRecord[]> {
  const map = new Map<number, ReleaseFileRecord[]>();
  if (releaseIds.length === 0) return map;
  for (const chunk of chunkNumberIds(releaseIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT * FROM catalog_release_files WHERE release_id IN (${placeholders}) ORDER BY id ASC`)
      .all(...chunk) as Record<string, unknown>[];
    for (const row of rows) {
      const file = mapFileRow(row);
      const list = map.get(file.releaseId) || [];
      list.push(file);
      map.set(file.releaseId, list);
    }
  }
  return map;
}

function loadCollectionIdsByReleaseIds(releaseIds: number[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  if (releaseIds.length === 0) return map;
  for (const chunk of chunkNumberIds(releaseIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT release_id, collection_id
         FROM user_collection_items
         WHERE release_id IN (${placeholders})
         ORDER BY collection_id ASC`,
      )
      .all(...chunk) as { release_id: number; collection_id: number }[];
    for (const row of rows) {
      const rid = Number(row.release_id);
      const cid = Number(row.collection_id);
      const list = map.get(rid) || [];
      list.push(cid);
      map.set(rid, list);
    }
  }
  return map;
}

function loadDeviceInstallsByReleaseIds(releaseIds: number[]): Map<number, ReleaseDeviceInstallRecord[]> {
  const map = new Map<number, ReleaseDeviceInstallRecord[]>();
  if (releaseIds.length === 0) return map;
  for (const chunk of chunkNumberIds(releaseIds)) {
    const placeholders = chunk.map(() => '?').join(',');
    const rows = getDb()
      .prepare(
        `SELECT
           di.release_id,
           di.device_id,
           di.installed_at,
           di.installed_file_id,
           di.installed_filename,
           di.installed_paths_json,
           COALESCE(dp.name, dp.volume_label, di.device_id) AS device_name,
           COALESCE(dp.volume_label, dp.name, di.device_id) AS volume_label,
           dp.icon_key AS device_icon_key,
           dp.color_key AS device_color_key
         FROM catalog_release_device_installs di
         LEFT JOIN storage_device_profiles dp ON dp.id = di.device_id
         WHERE di.release_id IN (${placeholders})
         ORDER BY di.installed_at DESC, device_name COLLATE NOCASE ASC`,
      )
      .all(...chunk) as Record<string, unknown>[];
    for (const row of rows) {
      const rid = Number(row.release_id);
      let parsedPaths: string[] = [];
      if (row.installed_paths_json) {
        try {
          parsedPaths = sanitizeInstalledPathsList(JSON.parse(String(row.installed_paths_json)));
        } catch {
          parsedPaths = [];
        }
      }
      const list = map.get(rid) || [];
      list.push({
        releaseId: rid,
        deviceId: String(row.device_id),
        deviceName: String(row.device_name),
        volumeLabel: String(row.volume_label),
        iconKey: sanitizeDeviceIconKey(row.device_icon_key),
        colorKey: sanitizeDeviceColorKey(row.device_color_key),
        installedAt: String(row.installed_at),
        installedFileId:
          row.installed_file_id !== null && row.installed_file_id !== undefined
            ? Number(row.installed_file_id)
            : null,
        installedFilename: row.installed_filename ? String(row.installed_filename) : null,
        installedPaths: parsedPaths,
      });
      map.set(rid, list);
    }
  }
  return map;
}

export function recomputeReleaseRollup(releaseId: number): RepositoryItemRecord | null {
  const row = getDb().prepare('SELECT * FROM catalog_releases WHERE id = ?').get(releaseId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;

  const fileRows = getDb()
    .prepare('SELECT * FROM catalog_release_files WHERE release_id = ? ORDER BY id ASC')
    .all(releaseId) as Record<string, unknown>[];
  const files = fileRows.map(mapFileRow);

  const genres = parseJsonStringArray(row.genres_json);
  const languages = parseJsonStringArray(row.languages_json);
  const sources = parseJsonStringArray(row.sources_json);
  const systemName = String(row.system_name);

  const fileRoles = files.map((f) => f.fileRole);
  const releaseTags = deriveReleaseTags({ genres, languages, sources, systemName }, fileRoles);
  const primaryType = releaseTags[0] || 'Retail ROM';

  let totalBytes = 0;
  let downloadedCount = 0;
  let failedCount = 0;
  let downloadingCount = 0;
  let availableCount = 0;
  let firstError: string | null = null;
  let latestDownloadedAt: string | null = row.downloaded_at ? String(row.downloaded_at) : null;

  for (const file of files) {
    if (file.fileSizeBytes > 0) totalBytes += file.fileSizeBytes;
    if (file.status === 'downloaded' || file.status === 'skipped') downloadedCount += 1;
    else if (file.status === 'failed') {
      failedCount += 1;
      if (!firstError && file.errorMessage) firstError = `${file.filename}: ${file.errorMessage}`;
    } else if (file.status === 'downloading') {
      downloadingCount += 1;
    } else if (file.status === 'available') {
      availableCount += 1;
    }
    if (file.downloadedAt && (!latestDownloadedAt || file.downloadedAt > latestDownloadedAt)) {
      latestDownloadedAt = file.downloadedAt;
    }
  }

  let status: ItemStatus = String(row.status) as ItemStatus;
  if (files.length > 0) {
    if (downloadingCount > 0) status = 'downloading';
    else if (failedCount === files.length) status = 'failed';
    else if (downloadedCount === files.length) status = 'downloaded';
    else if (downloadedCount > 0) status = 'partial';
    else if (availableCount === files.length) status = 'available';
    else status = 'queued';
  }

  // Preserve estimated parent byte size when indexed releases do not yet have file records
  const existingBytes = Number(row.file_size_bytes || 0);
  const resolvedBytes =
    totalBytes > 0
      ? totalBytes
      : status === 'available' || status === 'queued'
        ? existingBytes
        : 0;
  const sizeIsEstimated =
    downloadedCount === 0 &&
    (status === 'available' || status === 'queued') &&
    Boolean(row.size_is_estimated) &&
    resolvedBytes > 0
      ? 1
      : 0;

  // Keep embedded metadata.releaseTags synchronized when metadata_json exists
  let metadataJson = row.metadata_json ? String(row.metadata_json) : null;
  if (metadataJson) {
    try {
      const parsed = JSON.parse(metadataJson) as ReleaseMetadata;
      parsed.releaseTags = releaseTags;
      metadataJson = JSON.stringify(parsed);
    } catch {
      // Leave metadata_json intact if malformed
    }
  }

  getDb().prepare(`
    UPDATE catalog_releases SET
      release_type = ?,
      release_tags_json = ?,
      file_size_bytes = ?,
      size_is_estimated = ?,
      status = ?,
      error_message = ?,
      downloaded_at = ?,
      metadata_json = ?
    WHERE id = ?
  `).run(
    primaryType,
    JSON.stringify(releaseTags),
    resolvedBytes,
    sizeIsEstimated,
    status,
    files.length === 0 && status === 'failed'
      ? (row.error_message ? String(row.error_message) : 'Interrupted or failed before file download')
      : failedCount > 0
        ? firstError || `${failedCount} file transfer(s) failed`
        : null,
    latestDownloadedAt,
    metadataJson,
    releaseId,
  );

  refreshReleaseFileRolesCacheForRelease(releaseId);
  return getCatalogReleaseById(releaseId);
}

export function upsertCatalogRelease(input: {
  remoteUrl: string;
  remotePath: string;
  localPath: string;
  systemName: string;
  title: string;
  publishedAt?: string | null;
  remoteUpdatedAt?: string | null;
  status?: ItemStatus;
  lastRunId?: number | null;
  metadata?: ReleaseMetadata | null;
  coverLocalPath?: string | null;
  screenshotLocalPaths?: string[];
}): RepositoryItemRecord {
  const canonicalUrl = input.remoteUrl.split('#')[0];
  const canonicalSystemName = canonicalizeSystemSlug(input.systemName) || input.systemName;
  const now = new Date().toISOString();
  const meta = input.metadata ?? null;

  const genres = meta?.genres || [];
  const regions = meta?.regions || [];
  const languages = meta?.languages || [];
  const sources = meta?.sources || [];
  const releaseTags =
    meta?.releaseTags && meta.releaseTags.length > 0
      ? meta.releaseTags
      : deriveReleaseTags({ genres, languages, sources, systemName: canonicalSystemName }, []);
  const primaryType = releaseTags[0] || 'Retail ROM';

  const wpPostId = meta?.wpPostId ?? null;
  const wpPostType = meta?.wpPostType ?? null;
  const effectivePublishedAt = input.publishedAt ?? meta?.publishedAt ?? null;
  const effectiveRemoteUpdatedAt = input.remoteUpdatedAt ?? meta?.remoteUpdatedAt ?? null;
  const publisher = meta?.publisher ?? null;
  const developer = meta?.developer ?? null;
  const releaseYear = meta?.releaseYear ?? null;
  const genresJson = meta && genres.length > 0 ? JSON.stringify(genres) : null;
  const regionsJson = meta && regions.length > 0 ? JSON.stringify(regions) : null;
  const languagesJson = meta && languages.length > 0 ? JSON.stringify(languages) : null;
  const sourcesJson = meta && sources.length > 0 ? JSON.stringify(sources) : null;
  const tagsJson = JSON.stringify(releaseTags);
  const coverLocalPath = input.coverLocalPath ?? null;
  const screenshotsJson = input.screenshotLocalPaths ? JSON.stringify(input.screenshotLocalPaths) : null;
  const metadataJson = meta ? JSON.stringify({ ...meta, releaseTags }) : null;

  getDb().prepare(`
    INSERT INTO catalog_releases (
      remote_url, wp_post_id, wp_post_type, remote_path, local_path, system_name,
      release_type, release_tags_json, title, published_at, remote_updated_at, status, last_run_id, discovered_at,
      publisher, developer, release_year, genres_json, regions_json, languages_json, sources_json,
      cover_local_path, screenshots_json, metadata_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, COALESCE(?, '[]'), COALESCE(?, '[]'), COALESCE(?, '[]'), COALESCE(?, '[]'),
      ?, COALESCE(?, '[]'), ?
    )
    ON CONFLICT(remote_url) DO UPDATE SET
      wp_post_id = COALESCE(excluded.wp_post_id, catalog_releases.wp_post_id),
      wp_post_type = COALESCE(excluded.wp_post_type, catalog_releases.wp_post_type),
      remote_path = excluded.remote_path,
      local_path = excluded.local_path,
      system_name = excluded.system_name,
      title = COALESCE(NULLIF(excluded.title, ''), catalog_releases.title),
      published_at = COALESCE(excluded.published_at, catalog_releases.published_at),
      remote_updated_at = COALESCE(excluded.remote_updated_at, catalog_releases.remote_updated_at),
      last_run_id = COALESCE(excluded.last_run_id, catalog_releases.last_run_id),
      publisher = COALESCE(excluded.publisher, catalog_releases.publisher),
      developer = COALESCE(excluded.developer, catalog_releases.developer),
      release_year = COALESCE(excluded.release_year, catalog_releases.release_year),
      genres_json = CASE WHEN ? IS NOT NULL THEN excluded.genres_json ELSE catalog_releases.genres_json END,
      regions_json = CASE WHEN ? IS NOT NULL THEN excluded.regions_json ELSE catalog_releases.regions_json END,
      languages_json = CASE WHEN ? IS NOT NULL THEN excluded.languages_json ELSE catalog_releases.languages_json END,
      sources_json = CASE WHEN ? IS NOT NULL THEN excluded.sources_json ELSE catalog_releases.sources_json END,
      cover_local_path = COALESCE(excluded.cover_local_path, catalog_releases.cover_local_path),
      screenshots_json = CASE WHEN ? IS NOT NULL THEN excluded.screenshots_json ELSE catalog_releases.screenshots_json END,
      metadata_json = COALESCE(excluded.metadata_json, catalog_releases.metadata_json)
  `).run(
    canonicalUrl,
    wpPostId,
    wpPostType,
    input.remotePath,
    input.localPath,
    canonicalSystemName,
    primaryType,
    tagsJson,
    input.title,
    effectivePublishedAt,
    effectiveRemoteUpdatedAt,
    input.status ?? 'queued',
    input.lastRunId ?? null,
    now,
    publisher,
    developer,
    releaseYear,
    genresJson,
    regionsJson,
    languagesJson,
    sourcesJson,
    coverLocalPath,
    screenshotsJson,
    metadataJson,
    genresJson,
    regionsJson,
    languagesJson,
    sourcesJson,
    screenshotsJson,
  );

  const row = getDb().prepare('SELECT id FROM catalog_releases WHERE remote_url = ?').get(canonicalUrl) as {
    id: number;
  };
  return recomputeReleaseRollup(Number(row.id))!;
}

export function upsertIndexedWpRelease(input: {
  remoteUrl: string;
  remotePath: string;
  localPath: string;
  systemName: string;
  title: string;
  publishedAt?: string | null;
  remoteUpdatedAt?: string | null;
  estimatedBytes?: number;
  metadata: ReleaseMetadata;
  lastRunId?: number | null;
}): RepositoryItemRecord {
  const canonicalUrl = input.remoteUrl.split('#')[0];
  const canonicalSystemName = canonicalizeSystemSlug(input.systemName) || input.systemName;
  const now = new Date().toISOString();
  const estimatedBytes = Math.max(0, Math.round(Number(input.estimatedBytes || 0)));

  const genres = input.metadata.genres || [];
  const regions = input.metadata.regions || [];
  const languages = input.metadata.languages || [];
  const sources = input.metadata.sources || [];
  const releaseTags =
    input.metadata.releaseTags && input.metadata.releaseTags.length > 0
      ? input.metadata.releaseTags
      : deriveReleaseTags({ genres, languages, sources, systemName: canonicalSystemName }, []);
  const primaryType = releaseTags[0] || 'Retail ROM';

  const existing = getCatalogReleaseByRemoteUrl(canonicalUrl);
  let mergedMetadata: ReleaseMetadata = {
    ...input.metadata,
    releaseTags,
  };
  if (existing?.metadata) {
    const prev = existing.metadata;
    mergedMetadata = {
      ...prev,
      ...input.metadata,
      title: input.title || prev.title,
      subtitle: prev.subtitle ?? input.metadata.subtitle ?? null,
      consoleName: prev.consoleName ?? input.metadata.consoleName ?? null,
      formats: prev.formats?.length ? prev.formats : input.metadata.formats,
      coverUrl: input.metadata.coverUrl || prev.coverUrl,
      coverLocalRelPath: prev.coverLocalRelPath ?? input.metadata.coverLocalRelPath ?? null,
      coverCandidates: prev.coverCandidates?.length ? prev.coverCandidates : input.metadata.coverCandidates,
      screenshotUrls:
        prev.detailHydrated && prev.screenshotUrls.length > 0
          ? prev.screenshotUrls
          : input.metadata.screenshotUrls.length > 0
            ? input.metadata.screenshotUrls
            : prev.screenshotUrls,
      screenshotCandidates: prev.screenshotCandidates?.length
        ? prev.screenshotCandidates
        : input.metadata.screenshotCandidates,
      screenshotLocalRelPaths: prev.screenshotLocalRelPaths ?? [],
      screenshotsFullResVersion: prev.screenshotsFullResVersion,
      detailHydrated: Boolean(prev.detailHydrated || input.metadata.detailHydrated),
      specs: prev.specs?.length ? prev.specs : input.metadata.specs,
      downloadsCount: prev.downloadsCount ?? input.metadata.downloadsCount,
      releasedAgo: prev.releasedAgo ?? input.metadata.releasedAgo ?? null,
      updatedDate: prev.updatedDate ?? input.metadata.updatedDate ?? null,
      descriptionHtml:
        prev.descriptionHtml && prev.descriptionHtml.length >= (input.metadata.descriptionHtml?.length || 0)
          ? prev.descriptionHtml
          : input.metadata.descriptionHtml,
      descriptionText:
        prev.descriptionText && prev.descriptionText.length >= (input.metadata.descriptionText?.length || 0)
          ? prev.descriptionText
          : input.metadata.descriptionText,
      downloadHints: input.metadata.downloadHints?.length
        ? input.metadata.downloadHints
        : prev.downloadHints,
      releaseTags,
    };
  }

  const effectivePublishedAt = input.publishedAt ?? mergedMetadata.publishedAt ?? null;
  const effectiveRemoteUpdatedAt = input.remoteUpdatedAt ?? mergedMetadata.remoteUpdatedAt ?? null;

  getDb().prepare(`
    INSERT INTO catalog_releases (
      remote_url, wp_post_id, wp_post_type, remote_path, local_path, system_name,
      release_type, release_tags_json, title, file_size_bytes, size_is_estimated,
      published_at, remote_updated_at, status, last_run_id, discovered_at,
      publisher, developer, release_year, genres_json, regions_json, languages_json, sources_json,
      cover_local_path, screenshots_json, metadata_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, 'available', ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
      NULL, '[]', ?
    )
    ON CONFLICT(remote_url) DO UPDATE SET
      wp_post_id = COALESCE(excluded.wp_post_id, catalog_releases.wp_post_id),
      wp_post_type = COALESCE(excluded.wp_post_type, catalog_releases.wp_post_type),
      remote_path = excluded.remote_path,
      system_name = excluded.system_name,
      release_type = excluded.release_type,
      release_tags_json = excluded.release_tags_json,
      title = COALESCE(NULLIF(excluded.title, ''), catalog_releases.title),
      file_size_bytes = CASE
        WHEN catalog_releases.status = 'available' AND excluded.file_size_bytes > 0 THEN excluded.file_size_bytes
        ELSE catalog_releases.file_size_bytes
      END,
      size_is_estimated = CASE
        WHEN catalog_releases.status = 'available' AND excluded.file_size_bytes > 0 THEN 1
        ELSE catalog_releases.size_is_estimated
      END,
      published_at = COALESCE(excluded.published_at, catalog_releases.published_at),
      remote_updated_at = COALESCE(excluded.remote_updated_at, catalog_releases.remote_updated_at),
      publisher = COALESCE(excluded.publisher, catalog_releases.publisher),
      developer = COALESCE(excluded.developer, catalog_releases.developer),
      release_year = COALESCE(excluded.release_year, catalog_releases.release_year),
      genres_json = excluded.genres_json,
      regions_json = excluded.regions_json,
      languages_json = excluded.languages_json,
      sources_json = excluded.sources_json,
      metadata_json = excluded.metadata_json
  `).run(
    canonicalUrl,
    mergedMetadata.wpPostId ?? null,
    mergedMetadata.wpPostType ?? null,
    input.remotePath,
    input.localPath,
    canonicalSystemName,
    primaryType,
    JSON.stringify(releaseTags),
    input.title,
    estimatedBytes,
    estimatedBytes > 0 ? 1 : 0,
    effectivePublishedAt,
    effectiveRemoteUpdatedAt,
    input.lastRunId ?? null,
    now,
    mergedMetadata.publisher ?? null,
    mergedMetadata.developer ?? null,
    mergedMetadata.releaseYear ?? null,
    JSON.stringify(genres),
    JSON.stringify(regions),
    JSON.stringify(languages),
    JSON.stringify(sources),
    JSON.stringify(mergedMetadata),
  );

  const saved = getCatalogReleaseByRemoteUrl(canonicalUrl)!;
  refreshReleaseFileRolesCacheForRelease(saved.id);
  return saved;
}

export function updateCatalogCoverPath(releaseId: number, coverLocalPath: string): void {
  getDb()
    .prepare('UPDATE catalog_releases SET cover_local_path = ? WHERE id = ?')
    .run(coverLocalPath, releaseId);
}

export interface MarkCatalogItemsQueuedResult {
  queuedIds: number[];
  alreadyQueuedIds: number[];
  alreadyDownloadedIds: number[];
}

export function markCatalogItemsQueuedDetailed(
  ids: number[],
  runId?: number | null,
  options?: {
    activeOrPendingIds?: ReadonlySet<number>;
    allowIncompleteRuleDownloads?: boolean;
  },
): MarkCatalogItemsQueuedResult {
  const cleanIds = Array.from(
    new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { queuedIds: [], alreadyQueuedIds: [], alreadyDownloadedIds: [] };
  }

  const activeOrPendingIds = options?.activeOrPendingIds;
  const allowIncompleteRuleDownloads = Boolean(options?.allowIncompleteRuleDownloads);
  const ruleIndexMap = allowIncompleteRuleDownloads ? loadAllReleaseRuleIndexMap() : null;
  const allowedTypes = allowIncompleteRuleDownloads
    ? normalizeAllowedReleaseTypes(getPublicConfig().allowedReleaseTypes)
    : [];

  const tx = getDb().transaction(() => {
    const queuedIds: number[] = [];
    const alreadyQueuedIds: number[] = [];
    const alreadyDownloadedIds: number[] = [];

    for (const releaseId of cleanIds) {
      const row = getDb()
        .prepare(
          `SELECT id, status, downloaded_at, remote_updated_at, remote_checked_at,
                  json_extract(metadata_json, '$.downloadHints') AS download_hints_json
           FROM catalog_releases
           WHERE id = ?`,
        )
        .get(releaseId) as
        | {
            id: number;
            status: string;
            downloaded_at: string | null;
            remote_updated_at: string | null;
            remote_checked_at: string | null;
            download_hints_json: string | null;
          }
        | undefined;
      if (!row) continue;

      if (activeOrPendingIds?.has(releaseId) || row.status === 'downloading') {
        alreadyQueuedIds.push(releaseId);
        continue;
      }

      if (row.status === 'skipped') {
        alreadyDownloadedIds.push(releaseId);
        continue;
      }

      if (row.status === 'downloaded') {
        if (allowIncompleteRuleDownloads && ruleIndexMap) {
          const coverage = evaluateReleaseRuleMirrorCoverage(
            row.status,
            ruleIndexMap.get(releaseId),
            allowedTypes,
          );
          if (!coverage.fullyMirrored) {
            getDb()
              .prepare(`
                UPDATE catalog_releases
                SET status = 'queued',
                    error_message = NULL,
                    last_run_id = COALESCE(?, last_run_id)
                WHERE id = ?
              `)
              .run(runId ?? null, releaseId);
            queuedIds.push(releaseId);
            continue;
          }
        }
        const releaseFileRows = getDb()
          .prepare(
            `SELECT id, filename, local_path, status, downloaded_at
             FROM catalog_release_files
             WHERE release_id = ?`,
          )
          .all(releaseId) as {
          id: number;
          filename: string;
          local_path: string | null;
          status: string;
          downloaded_at: string | null;
        }[];
        const releaseFiles: InstalledUpdateFileLike[] = releaseFileRows.map((f) => ({
          id: Number(f.id),
          filename: String(f.filename),
          localPath: f.local_path ? String(f.local_path) : null,
          status: String(f.status),
          downloadedAt: f.downloaded_at ? String(f.downloaded_at) : null,
        }));
        const hasRemoteUpdate = hasActionableRemoteUpdate({
          status: row.status,
          downloadedAt: row.downloaded_at,
          remoteUpdatedAt: row.remote_updated_at,
          remoteCheckedAt: row.remote_checked_at,
          downloadHints: parseDownloadHintsJson(row.download_hints_json),
          files: releaseFiles,
        });

        if (hasRemoteUpdate) {
          getDb()
            .prepare(`
              UPDATE catalog_releases
              SET status = 'queued',
                  error_message = NULL,
                  last_run_id = COALESCE(?, last_run_id)
              WHERE id = ?
            `)
            .run(runId ?? null, releaseId);
          queuedIds.push(releaseId);
          continue;
        }
        alreadyDownloadedIds.push(releaseId);
        continue;
      }

      if (!['available', 'failed', 'partial', 'queued'].includes(row.status)) {
        continue;
      }

      getDb()
        .prepare(`
          UPDATE catalog_release_files
          SET status = 'queued',
              error_message = NULL,
              last_run_id = COALESCE(?, last_run_id)
          WHERE release_id = ? AND status IN ('available', 'failed')
        `)
        .run(runId ?? null, releaseId);

      if (row.status === 'available' || row.status === 'failed') {
        getDb()
          .prepare(`
            UPDATE catalog_releases
            SET status = 'queued',
                error_message = NULL,
                last_run_id = COALESCE(?, last_run_id)
            WHERE id = ?
          `)
          .run(runId ?? null, releaseId);
      }

      recomputeReleaseRollup(releaseId);
      queuedIds.push(releaseId);
    }
    return { queuedIds, alreadyQueuedIds, alreadyDownloadedIds };
  });

  return tx();
}

export function markCatalogItemsQueued(
  ids: number[],
  runId?: number | null,
): number[] {
  return markCatalogItemsQueuedDetailed(ids, runId).queuedIds;
}

/**
 * Returns all catalog release IDs currently waiting in `queued` state (either at
 * the release level or via individual queued files) so an interrupted or stopped
 * download queue can be cleanly resumed.
 */
export function listPausedQueuedReleaseIds(): number[] {
  const rows = getDb()
    .prepare(
      `SELECT id FROM catalog_releases WHERE status = 'queued'
       UNION
       SELECT DISTINCT release_id AS id FROM catalog_release_files WHERE status = 'queued'
       ORDER BY id ASC`,
    )
    .all() as { id: number }[];
  return rows.map((row) => Number(row.id));
}

/**
 * Clears any paused `queued` download state back to `available` (or `partial`
 * via rollup if some files in a multi-file release are already downloaded).
 */
export function clearPausedQueuedReleases(): { clearedCount: number } {
  const tx = getDb().transaction(() => {
    const affectedRows = getDb()
      .prepare(
        `SELECT id FROM catalog_releases WHERE status = 'queued'
         UNION
         SELECT DISTINCT release_id AS id FROM catalog_release_files WHERE status = 'queued'`,
      )
      .all() as { id: number }[];
    if (affectedRows.length === 0) {
      return { clearedCount: 0 };
    }

    getDb()
      .prepare(
        `UPDATE catalog_release_files
         SET status = 'available', error_message = NULL
         WHERE status = 'queued'`,
      )
      .run();

    getDb()
      .prepare(
        `UPDATE catalog_releases
         SET status = 'available', error_message = NULL
         WHERE status = 'queued'`,
      )
      .run();

    for (const row of affectedRows) {
      recomputeReleaseRollup(Number(row.id));
    }

    return { clearedCount: affectedRows.length };
  });

  return tx();
}

export function markCatalogReleaseFailed(
  releaseId: number,
  errorMessage: string,
  runId?: number | null,
): RepositoryItemRecord | null {
  getDb().prepare(`
    UPDATE catalog_releases
    SET status = 'failed',
        size_is_estimated = 0,
        error_message = ?,
        last_run_id = COALESCE(?, last_run_id)
    WHERE id = ?
  `).run(errorMessage, runId ?? null, releaseId);
  return recomputeReleaseRollup(releaseId);
}

export function upsertReleaseFile(input: {
  releaseId: number;
  targetFileId?: number;
  remoteUrl: string;
  downloadUrl: string;
  remotePath: string;
  localPath: string;
  filename: string;
  displayLabel?: string;
  fileRole?: string;
  fileSizeBytes?: number;
  status: FileItemStatus;
  errorMessage?: string | null;
  lastRunId?: number | null;
  downloadedAt?: string | null;
  preserveExistingDownloadedAt?: boolean;
}): { file: ReleaseFileRecord; release: RepositoryItemRecord } {
  const now = new Date().toISOString();
  const displayLabel = input.displayLabel || input.filename;
  const parent = getCatalogReleaseById(input.releaseId);
  const fileRole =
    input.fileRole ||
    classifyFileRole(input.filename, displayLabel, {
      genres: parent?.genres,
      languages: parent?.languages,
      sources: parent?.sources,
      title: parent?.title,
      systemName: parent?.systemName,
    });

  const conn = getDb();
  const tx = conn.transaction(() => {
    const byTarget =
      input.targetFileId !== undefined && Number.isInteger(input.targetFileId) && input.targetFileId > 0
        ? (conn
            .prepare('SELECT id FROM catalog_release_files WHERE id = ? AND release_id = ?')
            .get(input.targetFileId, input.releaseId) as { id: number } | undefined)
        : undefined;
    const byUrl = conn
      .prepare('SELECT id, release_id FROM catalog_release_files WHERE remote_url = ?')
      .get(input.remoteUrl) as { id: number; release_id: number } | undefined;
    const byName = conn
      .prepare('SELECT id FROM catalog_release_files WHERE release_id = ? AND filename = ?')
      .get(input.releaseId, input.filename) as { id: number } | undefined;

    const targetId =
      byUrl && byUrl.release_id !== input.releaseId
        ? byUrl.id
        : (byTarget?.id ?? byUrl?.id ?? byName?.id ?? null);

    if (targetId !== null) {
      if (byUrl && byUrl.release_id === input.releaseId && byUrl.id !== targetId) {
        conn.prepare('DELETE FROM catalog_release_files WHERE id = ?').run(byUrl.id);
      }
      if (byName && byName.id !== targetId) {
        conn.prepare('DELETE FROM catalog_release_files WHERE id = ?').run(byName.id);
      }
    }

    if (targetId !== null) {
      conn.prepare(`
        UPDATE catalog_release_files SET
          release_id = ?,
          remote_url = ?,
          download_url = ?,
          remote_path = ?,
          local_path = ?,
          filename = ?,
          display_label = ?,
          file_role = ?,
          file_size_bytes = CASE WHEN ? > 0 THEN ? ELSE file_size_bytes END,
          status = ?,
          error_message = ?,
          last_run_id = COALESCE(?, last_run_id),
          downloaded_at = ${input.preserveExistingDownloadedAt ? 'COALESCE(downloaded_at, ?)' : 'COALESCE(?, downloaded_at)'}
        WHERE id = ?
      `).run(
        input.releaseId,
        input.remoteUrl,
        input.downloadUrl,
        input.remotePath,
        input.localPath,
        input.filename,
        displayLabel,
        fileRole,
        input.fileSizeBytes ?? 0,
        input.fileSizeBytes ?? 0,
        input.status,
        input.errorMessage ?? null,
        input.lastRunId ?? null,
        input.downloadedAt ?? null,
        targetId,
      );
      return targetId;
    }

    const res = conn.prepare(`
      INSERT INTO catalog_release_files (
        release_id, remote_url, download_url, remote_path, local_path, filename,
        display_label, file_role, file_size_bytes, status, error_message,
        last_run_id, discovered_at, downloaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.releaseId,
      input.remoteUrl,
      input.downloadUrl,
      input.remotePath,
      input.localPath,
      input.filename,
      displayLabel,
      fileRole,
      input.fileSizeBytes ?? 0,
      input.status,
      input.errorMessage ?? null,
      input.lastRunId ?? null,
      now,
      input.downloadedAt ?? null,
    );
    return Number(res.lastInsertRowid);
  });

  const savedId = tx();
  const fileRow = conn
    .prepare('SELECT * FROM catalog_release_files WHERE id = ?')
    .get(savedId) as Record<string, unknown>;
  const release = recomputeReleaseRollup(input.releaseId)!;
  return {
    file: mapFileRow(fileRow),
    release,
  };
}

export function updateCatalogReleaseMetadata(
  id: number,
  metadata: ReleaseMetadata,
  coverLocalPath: string | null,
  screenshotLocalPaths: string[],
): RepositoryItemRecord | null {
  const existing = getCatalogReleaseById(id);
  if (!existing) return null;

  const genres = metadata.genres && metadata.genres.length > 0 ? metadata.genres : existing.genres;
  const regions = metadata.regions && metadata.regions.length > 0 ? metadata.regions : existing.regions;
  const languages = metadata.languages && metadata.languages.length > 0 ? metadata.languages : existing.languages;
  const sources = metadata.sources && metadata.sources.length > 0 ? metadata.sources : existing.sources;
  const mergedMetadata: ReleaseMetadata = {
    ...metadata,
    genres,
    regions,
    languages,
    sources,
  };

  const tx = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE catalog_releases SET
        wp_post_id = COALESCE(?, wp_post_id),
        wp_post_type = COALESCE(?, wp_post_type),
        title = COALESCE(NULLIF(?, ''), title),
        published_at = COALESCE(?, published_at),
        remote_updated_at = COALESCE(?, remote_updated_at),
        publisher = ?,
        developer = ?,
        release_year = ?,
        genres_json = ?,
        regions_json = ?,
        languages_json = ?,
        sources_json = ?,
        cover_local_path = ?,
        screenshots_json = ?,
        metadata_json = ?
      WHERE id = ?
    `).run(
      mergedMetadata.wpPostId ?? null,
      mergedMetadata.wpPostType ?? null,
      mergedMetadata.title,
      mergedMetadata.publishedAt ?? null,
      mergedMetadata.remoteUpdatedAt ?? null,
      mergedMetadata.publisher ?? null,
      mergedMetadata.developer ?? null,
      mergedMetadata.releaseYear ?? null,
      JSON.stringify(genres),
      JSON.stringify(regions),
      JSON.stringify(languages),
      JSON.stringify(sources),
      coverLocalPath,
      JSON.stringify(screenshotLocalPaths),
      JSON.stringify(mergedMetadata),
      id,
    );

    // Reclassify child file roles using the refreshed RGT taxonomy context
    const existingHintNames = (metadata.downloadHints || [])
      .map((h) => (h.filename || '').trim())
      .filter(Boolean);
    const siblingFilenames = Array.from(
      new Set([
        ...existing.files.map((f) => (f.filename || '').trim()).filter(Boolean),
        ...existingHintNames,
      ]),
    );
    for (const file of existing.files) {
      const nextRole = classifyFileRole(file.filename, file.displayLabel, {
        genres,
        languages,
        sources,
        title: metadata.title,
        systemName: existing.systemName,
        siblingFilenames,
      });
      getDb().prepare('UPDATE catalog_release_files SET file_role = ? WHERE id = ?').run(nextRole, file.id);
    }
  });

  tx();
  return recomputeReleaseRollup(id);
}

export function mergeCatalogReleaseDetailMetadata(
  id: number,
  metadata: ReleaseMetadata,
): RepositoryItemRecord | null {
  const existing = getCatalogReleaseById(id);
  if (!existing) return null;

  const genres = metadata.genres && metadata.genres.length > 0 ? metadata.genres : existing.genres;
  const regions = metadata.regions && metadata.regions.length > 0 ? metadata.regions : existing.regions;
  const languages = metadata.languages && metadata.languages.length > 0 ? metadata.languages : existing.languages;
  const sources = metadata.sources && metadata.sources.length > 0 ? metadata.sources : existing.sources;
  const mergedMetadata: ReleaseMetadata = {
    ...metadata,
    genres,
    regions,
    languages,
    sources,
  };

  const tx = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE catalog_releases SET
        wp_post_id = COALESCE(?, wp_post_id),
        wp_post_type = COALESCE(?, wp_post_type),
        title = COALESCE(NULLIF(?, ''), title),
        published_at = COALESCE(?, published_at),
        remote_updated_at = COALESCE(?, remote_updated_at),
        publisher = COALESCE(?, publisher),
        developer = COALESCE(?, developer),
        release_year = COALESCE(?, release_year),
        genres_json = ?,
        regions_json = ?,
        languages_json = ?,
        sources_json = ?,
        metadata_json = ?
      WHERE id = ?
    `).run(
      mergedMetadata.wpPostId ?? null,
      mergedMetadata.wpPostType ?? null,
      mergedMetadata.title,
      mergedMetadata.publishedAt ?? null,
      mergedMetadata.remoteUpdatedAt ?? null,
      mergedMetadata.publisher ?? null,
      mergedMetadata.developer ?? null,
      mergedMetadata.releaseYear ?? null,
      JSON.stringify(genres),
      JSON.stringify(regions),
      JSON.stringify(languages),
      JSON.stringify(sources),
      JSON.stringify(mergedMetadata),
      id,
    );

    const existingHintNames = (metadata.downloadHints || [])
      .map((h) => (h.filename || '').trim())
      .filter(Boolean);
    const siblingFilenames = Array.from(
      new Set([
        ...existing.files.map((f) => (f.filename || '').trim()).filter(Boolean),
        ...existingHintNames,
      ]),
    );
    for (const file of existing.files) {
      const nextRole = classifyFileRole(file.filename, file.displayLabel, {
        genres,
        languages,
        sources,
        title: metadata.title,
        systemName: existing.systemName,
        siblingFilenames,
      });
      getDb().prepare('UPDATE catalog_release_files SET file_role = ? WHERE id = ?').run(nextRole, file.id);
    }
  });

  tx();
  return recomputeReleaseRollup(id);
}

/**
 * Persist discovered download filenames into `metadata_json.downloadHints` for an already-indexed
 * catalog release when every file on the page was excluded by the active Release Type policy.
 * This lets Index-First Full Sync, Preflight, and Catalog Sync Rules evaluate concrete file roles
 * on subsequent runs without repeatedly re-fetching the same release page.
 */
export function persistDiscoveredReleaseDownloadHints(
  remoteUrl: string,
  hints: { filename: string; fileSize?: string | null }[],
  options?: { replace?: boolean },
): boolean {
  const canonical = remoteUrl.split('#')[0];
  const cleanHints = hints
    .map((h) => ({
      filename: (h.filename || '').trim(),
      fileSize: h.fileSize ?? null,
    }))
    .filter((h) => h.filename.length > 0);
  if (!canonical || cleanHints.length === 0) return false;

  const row = getDb()
    .prepare(
      `SELECT id, title, system_name, genres_json, languages_json, sources_json, metadata_json
       FROM catalog_releases
       WHERE remote_url = ?`,
    )
    .get(canonical) as
    | {
        id: number;
        title: string;
        system_name: string;
        genres_json: string | null;
        languages_json: string | null;
        sources_json: string | null;
        metadata_json: string | null;
      }
    | undefined;
  if (!row) return false;

  let metaObj: Record<string, unknown> = {};
  if (row.metadata_json) {
    try {
      const parsed = JSON.parse(row.metadata_json);
      if (parsed && typeof parsed === 'object') {
        metaObj = parsed as Record<string, unknown>;
      }
    } catch {
      metaObj = {};
    }
  }

  const existingHints = Array.isArray(metaObj.downloadHints)
    ? (metaObj.downloadHints as { filename?: string; fileSize?: string | null }[])
    : [];
  const existingFileSizeByKey = new Map<string, string | null>();
  const mergedByKey = new Map<string, { filename: string; fileSize: string | null }>();
  for (const h of existingHints) {
    const name = (h?.filename || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    existingFileSizeByKey.set(key, h.fileSize ?? null);
    if (!options?.replace) {
      mergedByKey.set(key, {
        filename: name,
        fileSize: h.fileSize ?? null,
      });
    }
  }
  for (const h of cleanHints) {
    const key = h.filename.toLowerCase();
    mergedByKey.set(key, {
      filename: h.filename,
      fileSize: h.fileSize ?? existingFileSizeByKey.get(key) ?? null,
    });
  }

  metaObj.downloadHints = Array.from(mergedByKey.values());
  getDb()
    .prepare('UPDATE catalog_releases SET metadata_json = ? WHERE id = ?')
    .run(JSON.stringify(metaObj), row.id);
  refreshReleaseFileRolesCacheForRelease(Number(row.id));
  return true;
}

/**
 * Records that a release's live RetroGameTalk download links were verified against
 * local mirrored files with zero failures. Clamps `remote_checked_at` to at least
 * `remote_updated_at` so minor clock skew cannot leave stale metadata-only WordPress
 * `modified_gmt` bumps re-triggering remote-update alerts, while intentionally leaving
 * `downloaded_at` untouched so unchanged files never falsely appear as `update_ready_local`.
 */
export function markCatalogReleaseRemoteChecked(
  releaseId: number,
  checkedAtIso?: string,
): void {
  const row = getDb()
    .prepare('SELECT remote_updated_at, remote_checked_at FROM catalog_releases WHERE id = ?')
    .get(releaseId) as
    | { remote_updated_at: string | null; remote_checked_at: string | null }
    | undefined;
  if (!row) return;

  const candidateIsos = [
    checkedAtIso || new Date().toISOString(),
    row.remote_updated_at,
    row.remote_checked_at,
  ];
  let bestIso = checkedAtIso || new Date().toISOString();
  let bestMs = Date.parse(bestIso);
  if (!Number.isFinite(bestMs)) {
    bestIso = new Date().toISOString();
    bestMs = Date.parse(bestIso);
  }
  for (const candidate of candidateIsos) {
    if (!candidate) continue;
    const ms = Date.parse(candidate);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      bestIso = candidate;
    }
  }

  getDb()
    .prepare('UPDATE catalog_releases SET remote_checked_at = ? WHERE id = ?')
    .run(bestIso, releaseId);
}

export function getCatalogReleaseById(id: number): RepositoryItemRecord | null {
  const row = getDb().prepare('SELECT * FROM catalog_releases WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const rid = Number(row.id);
  const filesMap = loadFilesByReleaseIds([rid]);
  const collectionsMap = loadCollectionIdsByReleaseIds([rid]);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds([rid]);
  return mapReleaseRow(
    row,
    filesMap.get(rid) || [],
    collectionsMap.get(rid) || [],
    deviceInstallsMap.get(rid) || [],
  );
}

export function getRepositoryItemById(id: number): RepositoryItemRecord | null {
  return getCatalogReleaseById(id);
}

export function getCatalogReleaseByRemoteUrl(remoteUrl: string): RepositoryItemRecord | null {
  const canonical = remoteUrl.split('#')[0];
  const row = getDb().prepare('SELECT * FROM catalog_releases WHERE remote_url = ?').get(canonical) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const rid = Number(row.id);
  const filesMap = loadFilesByReleaseIds([rid]);
  const collectionsMap = loadCollectionIdsByReleaseIds([rid]);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds([rid]);
  return mapReleaseRow(
    row,
    filesMap.get(rid) || [],
    collectionsMap.get(rid) || [],
    deviceInstallsMap.get(rid) || [],
  );
}

export function getRepositoryItemByRemoteUrl(remoteUrl: string): RepositoryItemRecord | null {
  return getCatalogReleaseByRemoteUrl(remoteUrl);
}

export function getReleaseFileById(fileId: number): ReleaseFileRecord | null {
  const row = getDb().prepare('SELECT * FROM catalog_release_files WHERE id = ?').get(fileId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapFileRow(row) : null;
}

export function getExistingReleaseLocalPaths(): Set<string> {
  const rows = getDb()
    .prepare('SELECT local_path FROM catalog_releases WHERE local_path IS NOT NULL AND local_path != \'\'')
    .all() as { local_path: string }[];
  return new Set(rows.map((r) => path.resolve(String(r.local_path))));
}

export function countSiblingItemsInDir(dirPath: string): number {
  const normalized = path.resolve(dirPath);
  const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM catalog_release_files WHERE local_path LIKE ?')
    .get(`${prefix}%`) as { count: number };
  return Number(row.count || 0);
}

type JsonFacetColumn =
  | 'release_tags_json'
  | 'genres_json'
  | 'regions_json'
  | 'languages_json'
  | 'sources_json';

function jsonFacetColumnExpr(columnName: JsonFacetColumn): string {
  if (columnName === 'release_tags_json') {
    return `CASE
      WHEN json_valid(catalog_releases.release_tags_json) AND json_array_length(catalog_releases.release_tags_json) > 0
      THEN catalog_releases.release_tags_json
      ELSE json_array(COALESCE(NULLIF(TRIM(catalog_releases.release_type), ''), 'Retail ROM'))
    END`;
  }
  return `CASE WHEN json_valid(catalog_releases.${columnName}) THEN catalog_releases.${columnName} ELSE '[]' END`;
}

function listDistinctJsonFacetWithCounts(columnName: JsonFacetColumn): {
  values: string[];
  counts: Record<string, number>;
} {
  const expr = jsonFacetColumnExpr(columnName);
  const rows = getDb()
    .prepare(
      `SELECT
        TRIM(CAST(je.value AS TEXT)) AS val,
        COUNT(DISTINCT catalog_releases.id) AS cnt
      FROM catalog_releases, json_each(${expr}) AS je
      WHERE je.value IS NOT NULL AND TRIM(CAST(je.value AS TEXT)) != ''
      GROUP BY val
      ORDER BY val COLLATE NOCASE ASC`,
    )
    .all() as { val: string; cnt: number }[];

  const values: string[] = [];
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const val = String(row.val);
    values.push(val);
    counts[val] = Number(row.cnt || 0);
  }
  return { values, counts };
}

function listStatusFacetCounts(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS cnt FROM catalog_releases GROUP BY status')
    .all() as { status: string; cnt: number }[];

  const raw: Record<string, number> = {};
  for (const row of rows) {
    raw[String(row.status)] = Number(row.cnt || 0);
  }

  return {
    ...raw,
    available: raw.available || 0,
    downloaded: (raw.downloaded || 0) + (raw.skipped || 0),
    needs_retry: (raw.failed || 0) + (raw.partial || 0),
    partial: raw.partial || 0,
    failed: raw.failed || 0,
    queued: raw.queued || 0,
    downloading: raw.downloading || 0,
  };
}

interface CachedReleaseFileCoverage {
  filenameKey: string;
  basenameKey: string;
  role: string;
  isMirrored: boolean;
  fileSizeBytes: number;
}

interface CachedReleaseHintCoverage {
  filenameKey: string;
  role: string;
  estimatedBytes: number;
}

interface CachedReleaseRuleData {
  systemName: string;
  fileRoles: string[];
  baseMetaTags: string[];
  files: CachedReleaseFileCoverage[];
  hints: CachedReleaseHintCoverage[];
}

interface ReleaseRuleCacheReleaseRow {
  id: number;
  title: string;
  system_name: string;
  genres_json: string | null;
  languages_json: string | null;
  sources_json: string | null;
  download_hints_json: string | null;
}

interface ReleaseRuleCacheFileRow {
  filename: string | null;
  display_label: string | null;
  local_path: string | null;
  file_role: string | null;
  status: string | null;
  file_size_bytes: number | null;
}

let releaseRuleIndexCache: Map<number, CachedReleaseRuleData> | null = null;
let releaseRuleIndexCacheDb: Database.Database | null = null;

export function invalidateReleaseFileRolesCache(): void {
  releaseRuleIndexCache = null;
  releaseRuleIndexCacheDb = null;
}

function parseDownloadHints(
  downloadHintsJson: string | null,
): { filename: string; fileSize: string | null }[] {
  if (!downloadHintsJson) return [];
  try {
    const parsed = JSON.parse(downloadHintsJson) as { filename?: unknown; fileSize?: unknown }[];
    if (!Array.isArray(parsed)) return [];
    const hints: { filename: string; fileSize: string | null }[] = [];
    for (const h of parsed) {
      const name = typeof h?.filename === 'string' ? h.filename.trim() : '';
      if (!name) continue;
      hints.push({
        filename: name,
        fileSize: typeof h?.fileSize === 'string' ? h.fileSize : null,
      });
    }
    return hints;
  } catch {
    return [];
  }
}

function computeReleaseRuleData(
  releaseRow: ReleaseRuleCacheReleaseRow,
  recordedFiles: ReleaseRuleCacheFileRow[],
): CachedReleaseRuleData {
  const hints = parseDownloadHints(releaseRow.download_hints_json);
  const hintNames = hints.map((h) => h.filename);
  const recordedFilenameSet = new Set<string>();
  const recordedRawFilenames: string[] = [];

  for (const f of recordedFiles) {
    const fname = String(f.filename || '').trim();
    if (fname) {
      recordedFilenameSet.add(fname.toLowerCase());
      recordedRawFilenames.push(fname);
    }
  }

  const genres = parseJsonStringArray(releaseRow.genres_json);
  const languages = parseJsonStringArray(releaseRow.languages_json);
  const sources = parseJsonStringArray(releaseRow.sources_json);
  const systemName = String(releaseRow.system_name || '');
  const siblingFilenames = Array.from(new Set([...recordedRawFilenames, ...hintNames]));
  const ctx = {
    genres,
    languages,
    sources,
    title: releaseRow.title,
    systemName,
    siblingFilenames,
  };

  const rolesList: string[] = [];
  const allRolesForMetaTags: string[] = [];
  const files: CachedReleaseFileCoverage[] = [];

  for (const f of recordedFiles) {
    const fname = String(f.filename || '').trim();
    const displayLabel = String(f.display_label || '').trim();
    const localPath = String(f.local_path || '').trim();
    const storedRole = String(f.file_role || '').trim();
    const classifiedRole = fname ? classifyFileRole(fname, displayLabel || fname, ctx) : storedRole;
    const effectiveRole =
      classifiedRole && classifiedRole !== 'ROM'
        ? classifiedRole
        : storedRole || classifiedRole;
    const matchRole = storedRole || classifiedRole;
    if (matchRole) {
      rolesList.push(matchRole);
    }
    if (effectiveRole) {
      allRolesForMetaTags.push(effectiveRole);
    }
    const status = String(f.status || 'available');
    files.push({
      filenameKey: fname ? normalizeFilenameKey(fname) : '',
      basenameKey: localPath ? normalizeFilenameKey(path.basename(localPath)) : '',
      role: effectiveRole || 'ROM',
      isMirrored: (status === 'downloaded' || status === 'skipped') && localPath.length > 0,
      fileSizeBytes: Math.max(0, Number(f.file_size_bytes || 0)),
    });
  }

  const hintItems: CachedReleaseHintCoverage[] = [];
  for (const hint of hints) {
    const hintRole = classifyFileRole(hint.filename, hint.filename, ctx);
    allRolesForMetaTags.push(hintRole);
    if (!recordedFilenameSet.has(hint.filename.toLowerCase())) {
      rolesList.push(hintRole);
    }
    hintItems.push({
      filenameKey: normalizeFilenameKey(hint.filename),
      role: hintRole,
      estimatedBytes: parseHumanFileSizeToBytes(hint.fileSize),
    });
  }

  const baseMetaTags = deriveReleaseTags(
    {
      genres,
      languages,
      sources,
      systemName,
    },
    allRolesForMetaTags,
  );

  return {
    systemName,
    fileRoles: rolesList,
    baseMetaTags,
    files,
    hints: hintItems,
  };
}

/**
 * Pure-DB mirror coverage check mirroring `isReleaseFullyMirroredForRules` without synchronous
 * filesystem `stat` calls (preserving Node.js event-loop responsiveness on HTTP requests).
 *
 * Returns `fullyMirrored: false` when a release is not yet mirrored for the active Release Type
 * policy — including `status = 'downloaded'` releases that still have unmirrored policy-eligible
 * sibling files in `downloadHints` (or zero recorded child files).
 */
function evaluateReleaseRuleMirrorCoverage(
  status: string,
  ruleData: CachedReleaseRuleData | undefined,
  allowedTypes: readonly string[],
): {
  fullyMirrored: boolean;
  unmirroredEstimatedBytes: number;
} {
  if (status === 'skipped') {
    return { fullyMirrored: true, unmirroredEstimatedBytes: 0 };
  }
  if (status === 'queued' || status === 'downloading') {
    return { fullyMirrored: false, unmirroredEstimatedBytes: 0 };
  }

  const files = ruleData?.files || [];
  if (files.length === 0) {
    return { fullyMirrored: false, unmirroredEstimatedBytes: 0 };
  }

  const hasTypeFilter = allowedTypes.length > 0;
  const mutableAllowedTypes = [...allowedTypes];
  const baseMetaTags = ruleData?.baseMetaTags || [];
  const systemName = ruleData?.systemName || '';
  const hints = ruleData?.hints || [];

  const mirroredDownloadKeys = new Set<string>();
  let mirroredEligibleCount = 0;
  let hasUnmirrored = false;
  let unmirroredBytes = 0;

  for (const file of files) {
    if (file.isMirrored) {
      if (file.filenameKey) mirroredDownloadKeys.add(file.filenameKey);
      if (file.basenameKey) mirroredDownloadKeys.add(file.basenameKey);
    }

    let isEligible = true;
    if (hasTypeFilter) {
      const fileTypeKeys = classifyFileRoleToTypeKeys(file.role, baseMetaTags, systemName);
      isEligible = evaluateReleaseTypeMatch(fileTypeKeys, mutableAllowedTypes).allowed;
    }

    if (!isEligible) {
      continue;
    }

    if (!file.isMirrored) {
      hasUnmirrored = true;
      unmirroredBytes += file.fileSizeBytes;
    } else {
      mirroredEligibleCount += 1;
    }
  }

  let eligibleHintsCount = 0;
  for (const hint of hints) {
    if (!hint.filenameKey) continue;

    if (hasTypeFilter) {
      const hintTypeKeys = classifyFileRoleToTypeKeys(hint.role, baseMetaTags, systemName);
      if (!evaluateReleaseTypeMatch(hintTypeKeys, mutableAllowedTypes).allowed) {
        continue;
      }
    }

    eligibleHintsCount += 1;
    if (!mirroredDownloadKeys.has(hint.filenameKey)) {
      hasUnmirrored = true;
      unmirroredBytes += hint.estimatedBytes;
    }
  }

  if (hasUnmirrored) {
    return {
      fullyMirrored: false,
      unmirroredEstimatedBytes: unmirroredBytes,
    };
  }

  if (mirroredEligibleCount === 0 && eligibleHintsCount === 0) {
    return {
      fullyMirrored: hasTypeFilter,
      unmirroredEstimatedBytes: 0,
    };
  }

  return {
    fullyMirrored: mirroredEligibleCount > 0,
    unmirroredEstimatedBytes: 0,
  };
}

function refreshReleaseFileRolesCacheForRelease(releaseId: number): void {
  const conn = getDb();
  if (!releaseRuleIndexCache || releaseRuleIndexCacheDb !== conn) {
    return;
  }

  const releaseRow = conn
    .prepare(
      `SELECT id, title, system_name, genres_json, languages_json, sources_json,
              json_extract(metadata_json, '$.downloadHints') AS download_hints_json
       FROM catalog_releases
       WHERE id = ?`,
    )
    .get(releaseId) as ReleaseRuleCacheReleaseRow | undefined;

  if (!releaseRow) {
    releaseRuleIndexCache.delete(releaseId);
    return;
  }

  const recordedFiles = conn
    .prepare(
      'SELECT filename, display_label, local_path, file_role, status, file_size_bytes FROM catalog_release_files WHERE release_id = ?',
    )
    .all(releaseId) as ReleaseRuleCacheFileRow[];

  releaseRuleIndexCache.set(releaseId, computeReleaseRuleData(releaseRow, recordedFiles));
}

function loadAllReleaseRuleIndexMap(): Map<number, CachedReleaseRuleData> {
  const conn = getDb();
  if (releaseRuleIndexCache && releaseRuleIndexCacheDb === conn) {
    return releaseRuleIndexCache;
  }

  const fileRows = conn
    .prepare(
      'SELECT release_id, filename, display_label, local_path, file_role, status, file_size_bytes FROM catalog_release_files',
    )
    .all() as (ReleaseRuleCacheFileRow & { release_id: number })[];

  const filesByRelease = new Map<number, ReleaseRuleCacheFileRow[]>();
  for (const row of fileRows) {
    const rid = Number(row.release_id);
    let list = filesByRelease.get(rid);
    if (!list) {
      list = [];
      filesByRelease.set(rid, list);
    }
    list.push(row);
  }

  // Extract ONLY `$.downloadHints` inside SQLite so multi-KB HTML descriptions & screenshots are
  // never copied into V8 heap or JSON-parsed on the Node.js event loop.
  const releaseRows = conn
    .prepare(
      `SELECT id, title, system_name, genres_json, languages_json, sources_json,
              CASE
                WHEN metadata_json IS NOT NULL THEN json_extract(metadata_json, '$.downloadHints')
                ELSE NULL
              END AS download_hints_json
       FROM catalog_releases`,
    )
    .all() as ReleaseRuleCacheReleaseRow[];

  const map = new Map<number, CachedReleaseRuleData>();
  for (const row of releaseRows) {
    const rid = Number(row.id);
    const recorded = filesByRelease.get(rid) || [];
    if (recorded.length === 0 && !row.download_hints_json) {
      continue;
    }
    map.set(rid, computeReleaseRuleData(row, recorded));
  }

  releaseRuleIndexCache = map;
  releaseRuleIndexCacheDb = conn;
  return map;
}

interface RuleFilterRow {
  id: number;
  title?: string;
  system_name: string;
  release_type: string | null;
  release_tags_json: string | null;
  status: string;
  file_size_bytes: number;
  installed_at?: string | null;
  is_outdated?: number;
  sync_override?: string | null;
  is_favorite?: number;
}

function parseDownloadHintsJson(raw: unknown): InstalledUpdateDownloadHintLike[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as InstalledUpdateDownloadHintLike[]) : null;
  } catch {
    return null;
  }
}

interface InstalledOutdatedPartition {
  outdatedIds: number[];
  localReadyIds: number[];
  remoteOnlyIds: number[];
  outdatedIdSet: Set<number>;
  localReadyIdSet: Set<number>;
  remoteOnlyIdSet: Set<number>;
}

/**
 * Single authoritative partition of installed releases with pending local or remote
 * updates, computed using the shared `classifyInstalledUpdateState()` classifier so
 * Sidebar totals, Catalog `Updates (N)` facet, Catalog `installed=outdated` filter,
 * and `GET /api/items/outdated` stay 100% consistent.
 */
function computeInstalledOutdatedPartition(deviceId?: string | null): InstalledOutdatedPartition {
  const scopedDeviceId = sanitizeDeviceProfileId(deviceId);
  const rows = (
    scopedDeviceId
      ? getDb()
          .prepare(
            `SELECT r.id, r.status,
                    di.installed_at AS installed_at,
                    COALESCE(dp.name, dp.volume_label, di.device_id) AS installed_device_label,
                    di.installed_file_id AS installed_file_id,
                    di.installed_filename AS installed_filename,
                    r.downloaded_at, r.remote_updated_at, r.remote_checked_at,
                    json_extract(r.metadata_json, '$.downloadHints') AS download_hints_json
             FROM catalog_release_device_installs di
             INNER JOIN catalog_releases r ON r.id = di.release_id
             LEFT JOIN storage_device_profiles dp ON dp.id = di.device_id
             WHERE di.device_id = ?`,
          )
          .all(scopedDeviceId)
      : getDb()
          .prepare(
            `SELECT id, status, installed_at, installed_device_label, installed_file_id,
                    installed_filename, downloaded_at, remote_updated_at, remote_checked_at,
                    json_extract(metadata_json, '$.downloadHints') AS download_hints_json
             FROM catalog_releases
             WHERE installed_at IS NOT NULL`,
          )
          .all()
  ) as {
    id: number;
    status: string;
    installed_at: string | null;
    installed_device_label: string | null;
    installed_file_id: number | null;
    installed_filename: string | null;
    downloaded_at: string | null;
    remote_updated_at: string | null;
    remote_checked_at: string | null;
    download_hints_json: string | null;
  }[];

  const outdatedIds: number[] = [];
  const localReadyIds: number[] = [];
  const remoteOnlyIds: number[] = [];
  const outdatedIdSet = new Set<number>();
  const localReadyIdSet = new Set<number>();
  const remoteOnlyIdSet = new Set<number>();

  if (rows.length === 0) {
    return {
      outdatedIds,
      localReadyIds,
      remoteOnlyIds,
      outdatedIdSet,
      localReadyIdSet,
      remoteOnlyIdSet,
    };
  }

  const installedIds = rows.map((r) => Number(r.id));
  const filesByReleaseId = new Map<number, InstalledUpdateFileLike[]>();
  const fileRows = getDb()
    .prepare(
      `SELECT id, release_id, filename, local_path, status, downloaded_at
       FROM catalog_release_files
       WHERE release_id IN (SELECT value FROM json_each(?))
       ORDER BY id ASC`,
    )
    .all(JSON.stringify(installedIds)) as {
    id: number;
    release_id: number;
    filename: string;
    local_path: string | null;
    status: string;
    downloaded_at: string | null;
  }[];

  for (const f of fileRows) {
    const rid = Number(f.release_id);
    const list = filesByReleaseId.get(rid) || [];
    list.push({
      id: Number(f.id),
      filename: String(f.filename),
      localPath: f.local_path ? String(f.local_path) : null,
      status: String(f.status),
      downloadedAt: f.downloaded_at ? String(f.downloaded_at) : null,
    });
    filesByReleaseId.set(rid, list);
  }

  for (const row of rows) {
    const id = Number(row.id);
    const info = classifyInstalledUpdateState({
      status: String(row.status),
      installedAt: row.installed_at ? String(row.installed_at) : null,
      installedDeviceLabel: row.installed_device_label ? String(row.installed_device_label) : null,
      installedFileId:
        row.installed_file_id !== null && row.installed_file_id !== undefined
          ? Number(row.installed_file_id)
          : null,
      installedFilename: row.installed_filename ? String(row.installed_filename) : null,
      downloadedAt: row.downloaded_at ? String(row.downloaded_at) : null,
      remoteUpdatedAt: row.remote_updated_at ? String(row.remote_updated_at) : null,
      remoteCheckedAt: row.remote_checked_at ? String(row.remote_checked_at) : null,
      downloadHints: parseDownloadHintsJson(row.download_hints_json),
      files: filesByReleaseId.get(id) || [],
    });

    if (!info.hasUpdate) continue;
    outdatedIds.push(id);
    outdatedIdSet.add(id);
    if (info.readyToUpgradeLocal) {
      localReadyIds.push(id);
      localReadyIdSet.add(id);
    } else if (info.needsLocalDownload) {
      remoteOnlyIds.push(id);
      remoteOnlyIdSet.add(id);
    }
  }

  return {
    outdatedIds,
    localReadyIds,
    remoteOnlyIds,
    outdatedIdSet,
    localReadyIdSet,
    remoteOnlyIdSet,
  };
}

function filterCandidateRowsBySyncRules<T extends RuleFilterRow>(
  rows: T[],
  cfg: ScraperConfigPublic,
  ruleIndexMap?: Map<number, CachedReleaseRuleData>,
): T[] {
  const allowedTypes = normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes);
  const indexLookup = allowedTypes.length > 0 ? (ruleIndexMap ?? loadAllReleaseRuleIndexMap()) : null;
  return rows.filter((row) =>
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: String(row.system_name || ''),
        releaseType: row.release_type ? String(row.release_type) : null,
        releaseTags: parseJsonStringArray(row.release_tags_json),
        fileRoles: indexLookup?.get(Number(row.id))?.fileRoles,
        syncOverride: row.sync_override,
      },
      cfg,
    ),
  );
}

function filterRuleMatchedRowsByDownloadedState<T extends RuleFilterRow>(
  rows: T[],
  downloadedFilter: string | undefined,
  allowedTypes: readonly string[],
  ruleIndexMap: Map<number, CachedReleaseRuleData>,
): T[] {
  if (downloadedFilter !== 'only' && downloadedFilter !== 'exclude') {
    return rows;
  }
  return rows.filter((row) => {
    const effectiveTypes = normalizeSyncOverride(row.sync_override) === 'pin' ? [] : allowedTypes;
    const coverage = evaluateReleaseRuleMirrorCoverage(
      String(row.status || 'available'),
      ruleIndexMap.get(Number(row.id)),
      effectiveTypes,
    );
    return downloadedFilter === 'only' ? coverage.fullyMirrored : !coverage.fullyMirrored;
  });
}

function listDownloadedFacetCounts(
  params: CatalogQueryFilterParams,
  cfg?: ScraperConfigPublic,
  ruleIndexMap?: Map<number, CachedReleaseRuleData>,
): {
  downloaded: number;
  notDownloaded: number;
} {
  const scopedParams: CatalogQueryFilterParams = {
    ...params,
    downloaded: undefined,
    status: undefined,
  };
  const resolvedCfg = cfg ?? (scopedParams.syncRules ? getPublicConfig() : undefined);
  const { where, args } = buildCatalogWhereAndOrder(scopedParams, resolvedCfg);

  if (scopedParams.syncRules && resolvedCfg) {
    const indexMap = ruleIndexMap ?? loadAllReleaseRuleIndexMap();
    const allowedTypes = normalizeAllowedReleaseTypes(resolvedCfg.allowedReleaseTypes);
    const candidateRows = getDb()
      .prepare(
        `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override
         FROM catalog_releases ${where}`,
      )
      .all(...args) as RuleFilterRow[];
    const matched = filterCandidateRowsBySyncRules(candidateRows, resolvedCfg, indexMap);
    let downloaded = 0;
    let notDownloaded = 0;
    for (const row of matched) {
      const effectiveTypes = normalizeSyncOverride(row.sync_override) === 'pin' ? [] : allowedTypes;
      const coverage = evaluateReleaseRuleMirrorCoverage(
        String(row.status || 'available'),
        indexMap.get(Number(row.id)),
        effectiveTypes,
      );
      if (coverage.fullyMirrored) downloaded += 1;
      else notDownloaded += 1;
    }
    return { downloaded, notDownloaded };
  }

  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN status IN ('downloaded', 'skipped') THEN 1 ELSE 0 END) AS downloaded_cnt,
        SUM(CASE WHEN status NOT IN ('downloaded', 'skipped') THEN 1 ELSE 0 END) AS not_downloaded_cnt
      FROM catalog_releases ${where}`,
    )
    .get(...args) as { downloaded_cnt: number | null; not_downloaded_cnt: number | null } | undefined;

  return {
    downloaded: Number(row?.downloaded_cnt || 0),
    notDownloaded: Number(row?.not_downloaded_cnt || 0),
  };
}

function listInstalledFacetCounts(
  params: CatalogQueryFilterParams,
  cfg?: ScraperConfigPublic,
  ruleIndexMap?: Map<number, CachedReleaseRuleData>,
): {
  installed: number;
  notInstalled: number;
  outdated: number;
} {
  const scopedDeviceId = sanitizeDeviceProfileId(params.deviceId);
  const scopedParams: CatalogQueryFilterParams = {
    ...params,
    installed: undefined,
  };
  const resolvedCfg = cfg ?? (scopedParams.syncRules ? getPublicConfig() : undefined);
  const { where, args } = buildCatalogWhereAndOrder(scopedParams, resolvedCfg);
  const outdatedPartition = computeInstalledOutdatedPartition(scopedDeviceId);

  if (scopedParams.syncRules && resolvedCfg) {
    const indexMap = ruleIndexMap ?? loadAllReleaseRuleIndexMap();
    const allowedTypes = normalizeAllowedReleaseTypes(resolvedCfg.allowedReleaseTypes);
    const deviceInstalledIds = scopedDeviceId
      ? new Set(
          (
            getDb()
              .prepare('SELECT release_id FROM catalog_release_device_installs WHERE device_id = ?')
              .all(scopedDeviceId) as { release_id: number }[]
          ).map((r) => Number(r.release_id)),
        )
      : null;
    const candidateRows = getDb()
      .prepare(
        `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, installed_at, sync_override
         FROM catalog_releases ${where}`,
      )
      .all(...args) as RuleFilterRow[];
    const matched = filterRuleMatchedRowsByDownloadedState(
      filterCandidateRowsBySyncRules(candidateRows, resolvedCfg, indexMap),
      scopedParams.downloaded,
      allowedTypes,
      indexMap,
    );
    let installed = 0;
    let notInstalled = 0;
    let outdated = 0;
    for (const row of matched) {
      const rid = Number(row.id);
      const isInstalled = deviceInstalledIds ? deviceInstalledIds.has(rid) : Boolean(row.installed_at);
      if (isInstalled) {
        installed += 1;
        if (outdatedPartition.outdatedIdSet.has(rid)) outdated += 1;
      } else {
        notInstalled += 1;
      }
    }
    return { installed, notInstalled, outdated };
  }

  const hasOutdatedCandidates = outdatedPartition.outdatedIds.length > 0;
  const selectArgs: unknown[] = [];
  const installedPredicate = scopedDeviceId
    ? 'EXISTS (SELECT 1 FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?)'
    : 'installed_at IS NOT NULL';
  const notInstalledPredicate = scopedDeviceId
    ? 'NOT EXISTS (SELECT 1 FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?)'
    : 'installed_at IS NULL';

  if (scopedDeviceId) {
    selectArgs.push(scopedDeviceId, scopedDeviceId);
  }

  const outdatedSelectExpr = hasOutdatedCandidates
    ? 'SUM(CASE WHEN id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END)'
    : '0';
  if (hasOutdatedCandidates) {
    selectArgs.push(JSON.stringify(outdatedPartition.outdatedIds));
  }

  const row = getDb()
    .prepare(
      `SELECT
        SUM(CASE WHEN ${installedPredicate} THEN 1 ELSE 0 END) AS installed_cnt,
        SUM(CASE WHEN ${notInstalledPredicate} THEN 1 ELSE 0 END) AS not_installed_cnt,
        ${outdatedSelectExpr} AS outdated_cnt
      FROM catalog_releases ${where}`,
    )
    .get(...selectArgs, ...args) as
    | { installed_cnt: number | null; not_installed_cnt: number | null; outdated_cnt: number | null }
    | undefined;

  return {
    installed: Number(row?.installed_cnt || 0),
    notInstalled: Number(row?.not_installed_cnt || 0),
    outdated: Number(row?.outdated_cnt || 0),
  };
}

function listSyncRulesMatchedFacetCount(
  params: CatalogQueryFilterParams,
  cfg: ScraperConfigPublic,
  ruleIndexMap?: Map<number, CachedReleaseRuleData>,
): number {
  const scopedParams: CatalogQueryFilterParams = {
    ...params,
    syncRules: true,
  };
  const { where, args } = buildCatalogWhereAndOrder(scopedParams, cfg);
  const allowedTypes = normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes);
  const needsCoverageFilter = params.downloaded === 'only' || params.downloaded === 'exclude';
  if (allowedTypes.length === 0 && !needsCoverageFilter) {
    const row = getDb()
      .prepare(`SELECT COUNT(*) AS cnt FROM catalog_releases ${where}`)
      .get(...args) as { cnt: number };
    return Number(row.cnt || 0);
  }
  const indexMap = ruleIndexMap ?? loadAllReleaseRuleIndexMap();
  const candidateRows = getDb()
    .prepare(
      `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override
       FROM catalog_releases ${where}`,
    )
    .all(...args) as RuleFilterRow[];
  const matched = filterRuleMatchedRowsByDownloadedState(
    filterCandidateRowsBySyncRules(candidateRows, cfg, indexMap),
    params.downloaded,
    allowedTypes,
    indexMap,
  );
  return matched.length;
}

function listCurationFacetCounts(
  params: CatalogQueryFilterParams,
  cfg?: ScraperConfigPublic,
  ruleIndexMap?: Map<number, CachedReleaseRuleData>,
): {
  favorites: number;
  syncOverrides: { pinned: number; ignored: number };
} {
  const favScopedParams: CatalogQueryFilterParams = {
    ...params,
    favoriteOnly: undefined,
  };
  const resolvedCfg = cfg ?? (favScopedParams.syncRules ? getPublicConfig() : undefined);
  const { where: favWhere, args: favArgs } = buildCatalogWhereAndOrder(favScopedParams, resolvedCfg);

  let favorites = 0;
  if (favScopedParams.syncRules && resolvedCfg) {
    const indexMap = ruleIndexMap ?? loadAllReleaseRuleIndexMap();
    const allowedTypes = normalizeAllowedReleaseTypes(resolvedCfg.allowedReleaseTypes);
    const favCandidates = getDb()
      .prepare(
        `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override, is_favorite
         FROM catalog_releases ${favWhere}`,
      )
      .all(...favArgs) as RuleFilterRow[];
    const matched = filterRuleMatchedRowsByDownloadedState(
      filterCandidateRowsBySyncRules(favCandidates, resolvedCfg, indexMap),
      favScopedParams.downloaded,
      allowedTypes,
      indexMap,
    );
    favorites = matched.reduce((acc, r) => acc + (r.is_favorite ? 1 : 0), 0);
  } else {
    const favRow = getDb()
      .prepare(`SELECT SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) AS fav_cnt FROM catalog_releases ${favWhere}`)
      .get(...favArgs) as { fav_cnt: number | null } | undefined;
    favorites = Number(favRow?.fav_cnt || 0);
  }

  const overrideRow = getDb()
    .prepare(
      `SELECT
         SUM(CASE WHEN sync_override = 'pin' THEN 1 ELSE 0 END) AS pinned_cnt,
         SUM(CASE WHEN sync_override = 'ignore' THEN 1 ELSE 0 END) AS ignored_cnt
       FROM catalog_releases`,
    )
    .get() as { pinned_cnt: number | null; ignored_cnt: number | null } | undefined;

  return {
    favorites,
    syncOverrides: {
      pinned: Number(overrideRow?.pinned_cnt || 0),
      ignored: Number(overrideRow?.ignored_cnt || 0),
    },
  };
}

function normalizeFilterList(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    const trimmed = String(entry).trim();
    if (!trimmed || trimmed === 'all' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function normalizeMatchMode(raw: string | undefined): FilterMatchMode {
  return raw === 'all' ? 'all' : 'any';
}

function appendJsonFacetCondition(
  conditions: string[],
  args: unknown[],
  columnName: JsonFacetColumn,
  rawValues: string | string[] | undefined,
  rawMode: string | undefined,
): void {
  const values = normalizeFilterList(rawValues);
  if (values.length === 0) return;

  const expr = jsonFacetColumnExpr(columnName);
  const placeholders = values.map(() => '?').join(', ');

  if (normalizeMatchMode(rawMode) === 'all' && values.length > 1) {
    conditions.push(
      `(SELECT COUNT(DISTINCT TRIM(CAST(je.value AS TEXT))) FROM json_each(${expr}) AS je WHERE TRIM(CAST(je.value AS TEXT)) IN (${placeholders})) = ?`,
    );
    args.push(...values, values.length);
  } else {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(${expr}) AS je WHERE TRIM(CAST(je.value AS TEXT)) IN (${placeholders}))`,
    );
    args.push(...values);
  }
}

const CATALOG_SORT_ORDER_BY: Record<CatalogSortOption, string> = {
  submitted_desc: 'COALESCE(published_at, remote_updated_at, discovered_at) DESC, COALESCE(wp_post_id, id) DESC, id DESC',
  submitted_asc: 'COALESCE(published_at, remote_updated_at, discovered_at) ASC, COALESCE(wp_post_id, id) ASC, id ASC',
  title_asc: 'title COLLATE NOCASE ASC, id DESC',
  title_desc: 'title COLLATE NOCASE DESC, id DESC',
  size_desc: 'file_size_bytes DESC, title COLLATE NOCASE ASC, id DESC',
  size_asc: 'file_size_bytes ASC, title COLLATE NOCASE ASC, id DESC',
  downloaded_desc: 'COALESCE(downloaded_at, discovered_at) DESC, id DESC',
  installed_desc: 'CASE WHEN installed_at IS NOT NULL THEN 0 ELSE 1 END ASC, installed_at DESC, COALESCE(downloaded_at, discovered_at) DESC, id DESC',
  discovered_desc: 'discovered_at DESC, id DESC',
  year_desc: "CASE WHEN release_year GLOB '[0-9][0-9][0-9][0-9]*' THEN 0 ELSE 1 END ASC, CAST(substr(release_year, 1, 4) AS INTEGER) DESC, title COLLATE NOCASE ASC, id DESC",
  year_asc: "CASE WHEN release_year GLOB '[0-9][0-9][0-9][0-9]*' THEN 0 ELSE 1 END ASC, CAST(substr(release_year, 1, 4) AS INTEGER) ASC, title COLLATE NOCASE ASC, id DESC",
  system_asc: 'system_name COLLATE NOCASE ASC, title COLLATE NOCASE ASC, id DESC',
  system_desc: 'system_name COLLATE NOCASE DESC, title COLLATE NOCASE ASC, id DESC',
};

export interface CatalogQueryFilterParams {
  search?: string;
  system?: string | string[];
  status?: string | string[];
  downloaded?: string;
  installed?: string;
  deviceId?: string;
  mountedDeviceId?: string;
  syncRules?: boolean;
  favoriteOnly?: boolean;
  collectionId?: number;
  syncOverride?: SyncOverrideMode;
  tag?: string | string[];
  tagMode?: string;
  genre?: string | string[];
  genreMode?: string;
  region?: string | string[];
  regionMode?: string;
  language?: string | string[];
  languageMode?: string;
  source?: string | string[];
  sourceMode?: string;
  sort?: string;
  /**
   * When true (no active download queue worker is running), paused `queued`
   * releases are counted as queueable/resumable rather than actively queued.
   */
  includePausedQueued?: boolean;
}

function buildCatalogWhereAndOrder(
  params: CatalogQueryFilterParams,
  cfgOverride?: ScraperConfigPublic,
): {
  where: string;
  args: unknown[];
  orderBy: string;
  orderArgs: unknown[];
} {
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push(`(
      title LIKE ?
      OR remote_path LIKE ?
      OR system_name LIKE ?
      OR COALESCE(publisher, '') LIKE ?
      OR COALESCE(developer, '') LIKE ?
      OR EXISTS (
        SELECT 1 FROM catalog_release_files f
        WHERE f.release_id = catalog_releases.id AND (f.filename LIKE ? OR f.display_label LIKE ?)
      )
    )`);
    args.push(q, q, q, q, q, q, q);
  }

  const systems = expandSystemAliases(normalizeFilterList(params.system));
  if (systems.length === 1) {
    conditions.push('system_name = ?');
    args.push(systems[0]);
  } else if (systems.length > 1) {
    conditions.push(`system_name IN (${systems.map(() => '?').join(', ')})`);
    args.push(...systems);
  }

  if (params.syncRules) {
    const ruleCfg = cfgOverride ?? getPublicConfig();
    conditions.push("COALESCE(sync_override, 'default') != 'ignore'");
    const ruleSystemSlugs = normalizeTargetConsoleSlugs(ruleCfg.systemFilter);
    if (ruleSystemSlugs.length > 0) {
      const ruleExpanded = expandSystemAliases(ruleSystemSlugs);
      if (ruleExpanded.length === 1) {
        conditions.push("(COALESCE(sync_override, 'default') = 'pin' OR LOWER(system_name) = ?)");
        args.push(ruleExpanded[0].toLowerCase());
      } else if (ruleExpanded.length > 1) {
        const lowerExpanded = ruleExpanded.map((s) => s.toLowerCase());
        conditions.push(
          `(COALESCE(sync_override, 'default') = 'pin' OR LOWER(system_name) IN (${lowerExpanded.map(() => '?').join(', ')}))`,
        );
        args.push(...lowerExpanded);
      }
    }
  }

  if (params.favoriteOnly) {
    conditions.push('is_favorite = 1');
  }

  if (params.collectionId !== undefined && Number.isInteger(params.collectionId) && params.collectionId > 0) {
    conditions.push(
      'EXISTS (SELECT 1 FROM user_collection_items uci WHERE uci.release_id = catalog_releases.id AND uci.collection_id = ?)',
    );
    args.push(params.collectionId);
  }

  if (params.syncOverride === 'pin' || params.syncOverride === 'ignore' || params.syncOverride === 'default') {
    conditions.push("COALESCE(sync_override, 'default') = ?");
    args.push(params.syncOverride);
  }

  const rawStatuses = normalizeFilterList(params.status);
  if (rawStatuses.length > 0) {
    const expandedSet = new Set<string>();
    for (const st of rawStatuses) {
      if (st === 'needs_retry') {
        expandedSet.add('failed');
        expandedSet.add('partial');
      } else if (st === 'downloaded') {
        expandedSet.add('downloaded');
        expandedSet.add('skipped');
      } else {
        expandedSet.add(st);
      }
    }
    const expanded = Array.from(expandedSet);
    if (expanded.length === 1) {
      conditions.push('status = ?');
      args.push(expanded[0]);
    } else if (expanded.length > 1) {
      conditions.push(`status IN (${expanded.map(() => '?').join(', ')})`);
      args.push(...expanded);
    }
  }

  appendJsonFacetCondition(conditions, args, 'release_tags_json', params.tag, params.tagMode);
  appendJsonFacetCondition(conditions, args, 'genres_json', params.genre, params.genreMode);
  appendJsonFacetCondition(conditions, args, 'regions_json', params.region, params.regionMode);
  appendJsonFacetCondition(conditions, args, 'languages_json', params.language, params.languageMode);
  appendJsonFacetCondition(conditions, args, 'sources_json', params.source, params.sourceMode);

  if (!params.syncRules) {
    if (params.downloaded === 'only') {
      conditions.push("status IN ('downloaded', 'skipped')");
    } else if (params.downloaded === 'exclude') {
      conditions.push("status NOT IN ('downloaded', 'skipped')");
    }
  }

  const scopedDeviceId = sanitizeDeviceProfileId(params.deviceId);
  if (params.installed === 'only') {
    if (scopedDeviceId) {
      conditions.push(
        'EXISTS (SELECT 1 FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?)',
      );
      args.push(scopedDeviceId);
    } else {
      conditions.push('installed_at IS NOT NULL');
    }
  } else if (params.installed === 'exclude') {
    if (scopedDeviceId) {
      conditions.push(
        'NOT EXISTS (SELECT 1 FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?)',
      );
      args.push(scopedDeviceId);
    } else {
      conditions.push('installed_at IS NULL');
    }
  } else if (params.installed === 'outdated') {
    const outdatedPartition = computeInstalledOutdatedPartition(scopedDeviceId);
    if (outdatedPartition.outdatedIds.length === 0) {
      conditions.push('1 = 0');
    } else {
      conditions.push('catalog_releases.id IN (SELECT value FROM json_each(?))');
      args.push(JSON.stringify(outdatedPartition.outdatedIds));
    }
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const sortKey = normalizeCatalogSort(params.sort);
  const orderArgs: unknown[] = [];
  let orderBy = CATALOG_SORT_ORDER_BY[sortKey];
  if (sortKey === 'installed_desc' && scopedDeviceId) {
    orderBy =
      'CASE WHEN (SELECT di.installed_at FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?) IS NOT NULL THEN 0 ELSE 1 END ASC, (SELECT di.installed_at FROM catalog_release_device_installs di WHERE di.release_id = catalog_releases.id AND di.device_id = ?) DESC, COALESCE(downloaded_at, discovered_at) DESC, id DESC';
    orderArgs.push(scopedDeviceId, scopedDeviceId);
  }
  return { where, args, orderBy, orderArgs };
}

export function queryRepositoryItemIds(params: CatalogQueryFilterParams): {
  ids: number[];
  downloadableIds: number[];
  queueableIds: number[];
  alreadyQueuedIds: number[];
  installedOnMountedIds: number[];
  estimatedQueueBytes: number;
  alreadyDownloadedCount: number;
  alreadyQueuedCount: number;
  total: number;
} {
  const cfg = params.syncRules ? getPublicConfig() : undefined;
  const allowedTypes = cfg ? normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes) : [];
  const ruleIndexMap = params.syncRules ? loadAllReleaseRuleIndexMap() : undefined;
  const { where, args, orderBy, orderArgs } = buildCatalogWhereAndOrder(params, cfg);
  let rows = getDb()
    .prepare(
      `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override
       FROM catalog_releases ${where} ORDER BY ${orderBy}`,
    )
    .all(...args, ...orderArgs) as RuleFilterRow[];

  if (params.syncRules && cfg && ruleIndexMap) {
    rows = filterRuleMatchedRowsByDownloadedState(
      filterCandidateRowsBySyncRules(rows, cfg, ruleIndexMap),
      params.downloaded,
      allowedTypes,
      ruleIndexMap,
    );
  }

  const ids: number[] = [];
  const downloadableIds: number[] = [];
  const queueableIds: number[] = [];
  const alreadyQueuedIds: number[] = [];
  let estimatedQueueBytes = 0;
  let alreadyDownloadedCount = 0;
  let alreadyQueuedCount = 0;

  const queueabilityOpts = { includePausedQueued: Boolean(params.includePausedQueued) };

  for (const row of rows) {
    const numId = Number(row.id);
    ids.push(numId);
    if (isCatalogStatusInstallable(row.status)) {
      downloadableIds.push(numId);
    }

    if (params.syncRules && ruleIndexMap) {
      const effectiveTypes = normalizeSyncOverride(row.sync_override) === 'pin' ? [] : allowedTypes;
      const coverage = evaluateReleaseRuleMirrorCoverage(
        String(row.status || 'available'),
        ruleIndexMap.get(numId),
        effectiveTypes,
      );
      if (coverage.fullyMirrored) {
        alreadyDownloadedCount += 1;
      } else if (isCatalogStatusAlreadyQueued(row.status, queueabilityOpts)) {
        alreadyQueuedIds.push(numId);
        alreadyQueuedCount += 1;
      } else if (isCatalogStatusQueueable(row.status, queueabilityOpts) || row.status === 'downloaded') {
        queueableIds.push(numId);
        const estBytes =
          row.status === 'downloaded' && coverage.unmirroredEstimatedBytes > 0
            ? coverage.unmirroredEstimatedBytes
            : Number(row.file_size_bytes || 0);
        estimatedQueueBytes += estBytes;
      }
      continue;
    }

    if (isCatalogStatusAlreadyDownloaded(row.status)) {
      alreadyDownloadedCount += 1;
    } else if (isCatalogStatusAlreadyQueued(row.status, queueabilityOpts)) {
      alreadyQueuedIds.push(numId);
      alreadyQueuedCount += 1;
    } else if (isCatalogStatusQueueable(row.status, queueabilityOpts)) {
      queueableIds.push(numId);
      estimatedQueueBytes += Number(row.file_size_bytes || 0);
    }
  }

  const mountedDeviceId = sanitizeDeviceProfileId(params.mountedDeviceId);
  let installedOnMountedIds: number[] = [];
  if (mountedDeviceId && ids.length > 0) {
    const installedSet = new Set<number>();
    for (const chunk of chunkNumberIds(ids)) {
      const placeholders = chunk.map(() => '?').join(',');
      const installedRows = getDb()
        .prepare(
          `SELECT release_id
           FROM catalog_release_device_installs
           WHERE device_id = ? AND release_id IN (${placeholders})`,
        )
        .all(mountedDeviceId, ...chunk) as { release_id: number }[];
      for (const installedRow of installedRows) {
        installedSet.add(Number(installedRow.release_id));
      }
    }
    installedOnMountedIds = ids.filter((id) => installedSet.has(id));
  }

  return {
    ids,
    downloadableIds,
    queueableIds,
    alreadyQueuedIds,
    installedOnMountedIds,
    estimatedQueueBytes,
    alreadyDownloadedCount,
    alreadyQueuedCount,
    total: ids.length,
  };
}

export function queryRepositoryItems(
  params: CatalogQueryFilterParams & {
    limit?: number;
    offset?: number;
  },
): { items: RepositoryItemRecord[]; total: number; facets: CatalogFacets } {
  const cfg = getPublicConfig();
  const allowedTypes = normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes);
  const hasTypeRules = allowedTypes.length > 0;
  const needsRuleIndex = Boolean(
    params.syncRules || hasTypeRules || params.downloaded === 'only' || params.downloaded === 'exclude',
  );
  const ruleIndexMap = needsRuleIndex ? loadAllReleaseRuleIndexMap() : undefined;

  const { where, args, orderBy, orderArgs } = buildCatalogWhereAndOrder(params, cfg);
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  let total = 0;
  let queueableFiltered = 0;
  let rows: Record<string, unknown>[] = [];

  const queueabilityOpts = { includePausedQueued: Boolean(params.includePausedQueued) };

  if (params.syncRules && ruleIndexMap) {
    const candidates = getDb()
      .prepare(
        `SELECT id, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override
         FROM catalog_releases ${where} ORDER BY ${orderBy}`,
      )
      .all(...args, ...orderArgs) as RuleFilterRow[];
    const matched = filterRuleMatchedRowsByDownloadedState(
      filterCandidateRowsBySyncRules(candidates, cfg, ruleIndexMap),
      params.downloaded,
      allowedTypes,
      ruleIndexMap,
    );
    total = matched.length;
    queueableFiltered = matched.reduce((acc, r) => {
      const effectiveTypes = normalizeSyncOverride(r.sync_override) === 'pin' ? [] : allowedTypes;
      const coverage = evaluateReleaseRuleMirrorCoverage(
        String(r.status || 'available'),
        ruleIndexMap.get(Number(r.id)),
        effectiveTypes,
      );
      if (coverage.fullyMirrored) return acc;
      if (isCatalogStatusQueueable(r.status, queueabilityOpts) || r.status === 'downloaded') return acc + 1;
      return acc;
    }, 0);
    const pageIds = matched.slice(offset, offset + limit).map((r) => Number(r.id));
    if (pageIds.length > 0) {
      const placeholders = pageIds.map(() => '?').join(', ');
      const fetched = getDb()
        .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
        .all(...pageIds) as Record<string, unknown>[];
      const byId = new Map<number, Record<string, unknown>>();
      for (const r of fetched) {
        byId.set(Number(r.id), r);
      }
      rows = pageIds
        .map((id) => byId.get(id))
        .filter((r): r is Record<string, unknown> => Boolean(r));
    }
  } else {
    const countRow = getDb().prepare(`SELECT COUNT(*) as count FROM catalog_releases ${where}`).get(...args) as {
      count: number;
    };
    total = Number(countRow.count);
    const queueableStatusSql = params.includePausedQueued
      ? "status IN ('available', 'failed', 'partial', 'queued')"
      : "status IN ('available', 'failed', 'partial')";
    const queueableWhere = where
      ? `${where} AND ${queueableStatusSql}`
      : `WHERE ${queueableStatusSql}`;
    const queueableRow = getDb()
      .prepare(`SELECT COUNT(*) as count FROM catalog_releases ${queueableWhere}`)
      .get(...args) as { count: number };
    queueableFiltered = Number(queueableRow.count);
    rows = getDb()
      .prepare(`SELECT * FROM catalog_releases ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...args, ...orderArgs, limit, offset) as Record<string, unknown>[];
  }

  const releaseIds = rows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(releaseIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(releaseIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(releaseIds);

  const tagsFacet = listDistinctJsonFacetWithCounts('release_tags_json');
  const genresFacet = listDistinctJsonFacetWithCounts('genres_json');
  const regionsFacet = listDistinctJsonFacetWithCounts('regions_json');
  const languagesFacet = listDistinctJsonFacetWithCounts('languages_json');
  const sourcesFacet = listDistinctJsonFacetWithCounts('sources_json');
  const statusCounts = listStatusFacetCounts();
  const downloadedCounts = listDownloadedFacetCounts(params, cfg, ruleIndexMap);
  const installedCounts = listInstalledFacetCounts(params, cfg, ruleIndexMap);
  const syncRulesMatched = listSyncRulesMatchedFacetCount(params, cfg, ruleIndexMap);
  const curationCounts = listCurationFacetCounts(params, cfg, ruleIndexMap);

  const counts: CatalogFacetCounts = {
    tags: tagsFacet.counts,
    genres: genresFacet.counts,
    regions: regionsFacet.counts,
    languages: languagesFacet.counts,
    sources: sourcesFacet.counts,
    statuses: statusCounts,
    downloaded: downloadedCounts,
    installed: installedCounts,
    syncRulesMatched,
    queueableFiltered,
    favorites: curationCounts.favorites,
    syncOverrides: curationCounts.syncOverrides,
  };

  const facets: CatalogFacets = {
    tags: tagsFacet.values,
    genres: genresFacet.values,
    regions: regionsFacet.values,
    languages: languagesFacet.values,
    sources: sourcesFacet.values,
    counts,
  };

  return {
    items: rows.map((r) =>
      mapReleaseRow(
        r,
        filesMap.get(Number(r.id)) || [],
        collectionsMap.get(Number(r.id)) || [],
        deviceInstallsMap.get(Number(r.id)) || [],
      ),
    ),
    total,
    facets,
  };
}

export function listCatalogReleasesForRuleSync(
  cfgOverride?: ScraperConfigPublic,
): {
  matched: RepositoryItemRecord[];
  excludedByRulesCount: number;
  totalCataloged: number;
} {
  const cfg = cfgOverride ?? getPublicConfig();
  const allRows = getDb()
    .prepare('SELECT * FROM catalog_releases ORDER BY system_name COLLATE NOCASE ASC, title COLLATE NOCASE ASC, id ASC')
    .all() as Record<string, unknown>[];
  const ruleIndexMap = loadAllReleaseRuleIndexMap();
  const matchedRows: Record<string, unknown>[] = [];
  let excludedByRulesCount = 0;

  for (const row of allRows) {
    const rid = Number(row.id);
    const matches = doesCatalogReleaseMatchSyncRules(
      {
        systemName: String(row.system_name || ''),
        releaseType: row.release_type ? String(row.release_type) : null,
        releaseTags: parseJsonStringArray(row.release_tags_json),
        fileRoles: ruleIndexMap.get(rid)?.fileRoles,
        syncOverride: row.sync_override ? String(row.sync_override) : 'default',
      },
      cfg,
    );
    if (matches) {
      matchedRows.push(row);
    } else {
      excludedByRulesCount += 1;
    }
  }

  const matchedIds = matchedRows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(matchedIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(matchedIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(matchedIds);
  const matched = matchedRows.map((r) =>
    mapReleaseRow(
      r,
      filesMap.get(Number(r.id)) || [],
      collectionsMap.get(Number(r.id)) || [],
      deviceInstallsMap.get(Number(r.id)) || [],
    ),
  );
  return {
    matched,
    excludedByRulesCount,
    totalCataloged: allRows.length,
  };
}

export function listPinnedCatalogReleases(): RepositoryItemRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM catalog_releases
       WHERE sync_override = 'pin'
       ORDER BY system_name COLLATE NOCASE ASC, title COLLATE NOCASE ASC, id ASC`,
    )
    .all() as Record<string, unknown>[];
  const releaseIds = rows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(releaseIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(releaseIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(releaseIds);
  return rows.map((r) =>
    mapReleaseRow(
      r,
      filesMap.get(Number(r.id)) || [],
      collectionsMap.get(Number(r.id)) || [],
      deviceInstallsMap.get(Number(r.id)) || [],
    ),
  );
}

export function computeSyncPreflightSummary(): SyncPreflightSummary {
  const cfg = getPublicConfig();
  const explicitConsoles = normalizeTargetConsoleSlugs(cfg.systemFilter);
  const allowedTypes = normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes);
  const targetSystems = resolveTargetConsoleScope(cfg.systemFilter, cfg.discoveredSystems);
  const freshness = classifySystemIndexFreshness(
    targetSystems,
    cfg.systemIndexState,
    Date.now(),
    DEFAULT_INDEX_STALE_MS,
    getCatalogReleaseCountsBySystem(),
  );

  const rows = getDb()
    .prepare(
      `SELECT id, title, system_name, release_type, release_tags_json, status, file_size_bytes, sync_override
       FROM catalog_releases
       ORDER BY COALESCE(published_at, remote_updated_at, discovered_at) DESC, id DESC`,
    )
    .all() as RuleFilterRow[];

  const ruleIndexMap = loadAllReleaseRuleIndexMap();

  let totalCataloged = 0;
  let totalRuleMatched = 0;
  let pendingDownloadCount = 0;
  let availablePendingCount = 0;
  let retryablePendingCount = 0;
  let queuedCount = 0;
  let alreadyDownloadedCount = 0;
  let excludedByRulesCount = 0;
  let estimatedPendingBytes = 0;

  const consoleMap = new Map<string, DryRunConsoleBreakdown>();
  const samplePendingReleases: DryRunSampleRelease[] = [];

  for (const row of rows) {
    totalCataloged += 1;
    const rid = Number(row.id);
    const ruleData = ruleIndexMap.get(rid);
    const override = normalizeSyncOverride(row.sync_override);
    const matches = doesCatalogReleaseMatchSyncRules(
      {
        systemName: String(row.system_name || ''),
        releaseType: row.release_type ? String(row.release_type) : null,
        releaseTags: parseJsonStringArray(row.release_tags_json),
        fileRoles: ruleData?.fileRoles,
        syncOverride: override,
      },
      cfg,
    );

    if (!matches) {
      excludedByRulesCount += 1;
      continue;
    }

    totalRuleMatched += 1;
    const status = String(row.status || 'available');
    const rowSizeBytes = Math.max(0, Number(row.file_size_bytes || 0));
    const effectiveTypes = override === 'pin' ? [] : allowedTypes;
    const coverage = evaluateReleaseRuleMirrorCoverage(status, ruleData, effectiveTypes);

    if (coverage.fullyMirrored) {
      alreadyDownloadedCount += 1;
      continue;
    }

    const sizeBytes =
      status === 'downloaded' && coverage.unmirroredEstimatedBytes > 0
        ? coverage.unmirroredEstimatedBytes
        : rowSizeBytes;

    pendingDownloadCount += 1;
    estimatedPendingBytes += sizeBytes;
    if (status === 'available' || status === 'downloaded') {
      availablePendingCount += 1;
    } else if (status === 'partial' || status === 'failed') {
      retryablePendingCount += 1;
    } else if (status === 'queued' || status === 'downloading') {
      queuedCount += 1;
    }

    const canonicalSys = (canonicalizeSystemSlug(String(row.system_name || '')) || String(row.system_name || '')).toLowerCase();
    const existingConsole = consoleMap.get(canonicalSys);
    if (existingConsole) {
      existingConsole.pendingCount += 1;
      existingConsole.estimatedBytes += sizeBytes;
    } else {
      consoleMap.set(canonicalSys, {
        systemName: canonicalSys,
        pendingCount: 1,
        estimatedBytes: sizeBytes,
      });
    }

    if (samplePendingReleases.length < 8) {
      samplePendingReleases.push({
        id: rid,
        title: String(row.title || ''),
        systemName: canonicalSys,
        releaseType: String(row.release_type || 'Retail ROM'),
        fileSizeBytes: sizeBytes,
        status,
      });
    }
  }

  const topPendingConsoles = Array.from(consoleMap.values())
    .sort((a, b) => b.pendingCount - a.pendingCount || b.estimatedBytes - a.estimatedBytes)
    .slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    ruleScopeLabel: formatSyncRuleScopeSummary(cfg.systemFilter, cfg.allowedReleaseTypes),
    hasCustomSystemFilter: explicitConsoles.length > 0,
    hasCustomTypeFilter: allowedTypes.length > 0,
    targetSystemsCount: targetSystems.length,
    targetSystems,
    freshConsoles: freshness.fresh,
    staleConsoles: freshness.stale,
    unindexedConsoles: freshness.unindexed,
    oldestIndexedAt: freshness.oldestIndexedAt,
    totalCataloged,
    totalRuleMatched,
    pendingDownloadCount,
    availablePendingCount,
    retryablePendingCount,
    queuedCount,
    alreadyDownloadedCount,
    excludedByRulesCount,
    estimatedPendingBytes,
    topPendingConsoles,
    samplePendingReleases,
    autoDownloadNewReleases: Boolean(cfg.autoDownloadNewReleases),
    lastWatermarkAt: cfg.lastWatermarkAt,
    scheduleEnabled: Boolean(cfg.scheduleEnabled),
  };
}

function mapStorageDeviceProfileRow(row: Record<string, unknown>): StorageDeviceProfile {
  let folderConfig: StorageFolderMappingConfig | null = null;
  if (row.folder_config_json) {
    try {
      folderConfig = normalizeStorageFolderConfig(JSON.parse(String(row.folder_config_json)));
    } catch {
      folderConfig = null;
    }
  }
  let romNaming: DeviceRomNamingOverrides | null = null;
  if (row.rom_naming_json) {
    try {
      romNaming = normalizeDeviceRomNaming(JSON.parse(String(row.rom_naming_json)));
    } catch {
      romNaming = null;
    }
  }
  return {
    id: String(row.id),
    name: String(row.name || row.volume_label || row.id),
    volumeLabel: String(row.volume_label || row.name || row.id),
    iconKey: sanitizeDeviceIconKey(row.icon_key),
    colorKey: sanitizeDeviceColorKey(row.color_key),
    isPinned: Boolean(Number(row.is_pinned || 0)),
    isArchived: Boolean(Number(row.is_archived || 0)),
    markerVerifiedAt: row.marker_verified_at ? String(row.marker_verified_at) : null,
    folderConfig,
    romNaming,
    lastMountedAt: row.last_mounted_at ? String(row.last_mounted_at) : null,
    installedCount: Number(row.installed_count || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const STORAGE_DEVICE_PROFILE_SELECT_SQL = `
  SELECT
    p.id,
    p.name,
    p.volume_label,
    p.icon_key,
    p.color_key,
    p.is_pinned,
    p.is_archived,
    p.marker_verified_at,
    p.folder_config_json,
    p.rom_naming_json,
    p.last_mounted_at,
    p.created_at,
    p.updated_at,
    COUNT(di.release_id) AS installed_count
  FROM storage_device_profiles p
  LEFT JOIN catalog_release_device_installs di ON di.device_id = p.id
`;

export function listStorageDeviceProfiles(): StorageDeviceProfile[] {
  const rows = getDb()
    .prepare(
      `${STORAGE_DEVICE_PROFILE_SELECT_SQL}
       GROUP BY p.id
       ORDER BY p.is_archived ASC, p.is_pinned DESC, COALESCE(p.last_mounted_at, p.updated_at, p.created_at) DESC, p.name COLLATE NOCASE ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapStorageDeviceProfileRow);
}

export function getStorageDeviceProfileById(id: string): StorageDeviceProfile | null {
  const cleanId = sanitizeDeviceProfileId(id);
  if (!cleanId) return null;
  const row = getDb()
    .prepare(
      `${STORAGE_DEVICE_PROFILE_SELECT_SQL}
       WHERE p.id = ?
       GROUP BY p.id`,
    )
    .get(cleanId) as Record<string, unknown> | undefined;
  return row ? mapStorageDeviceProfileRow(row) : null;
}

export function recomputeReleaseInstallRollups(releaseIds: number[]): void {
  const cleanIds = Array.from(
    new Set(releaseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) return;

  const latestStmt = getDb().prepare(
    `SELECT
       di.installed_at,
       COALESCE(dp.name, dp.volume_label, di.device_id) AS device_label,
       di.installed_file_id,
       di.installed_filename
     FROM catalog_release_device_installs di
     LEFT JOIN storage_device_profiles dp ON dp.id = di.device_id
     WHERE di.release_id = ?
     ORDER BY di.installed_at DESC, di.device_id ASC
     LIMIT 1`,
  );
  const setRollupStmt = getDb().prepare(
    `UPDATE catalog_releases
     SET installed_at = ?,
         installed_device_label = ?,
         installed_file_id = ?,
         installed_filename = ?
     WHERE id = ?`,
  );
  const clearRollupStmt = getDb().prepare(
    `UPDATE catalog_releases
     SET installed_at = NULL,
         installed_device_label = NULL,
         installed_file_id = NULL,
         installed_filename = NULL
     WHERE id = ?`,
  );

  const tx = getDb().transaction(() => {
    for (const rid of cleanIds) {
      const latest = latestStmt.get(rid) as
        | {
            installed_at: string;
            device_label: string | null;
            installed_file_id: number | null;
            installed_filename: string | null;
          }
        | undefined;
      if (latest) {
        setRollupStmt.run(
          latest.installed_at,
          latest.device_label,
          latest.installed_file_id,
          latest.installed_filename,
          rid,
        );
      } else {
        clearRollupStmt.run(rid);
      }
    }
  });
  tx();
}

export function upsertStorageDeviceProfileOnMount(options: {
  id?: string | null;
  volumeLabel: string;
  name?: string | null;
  createNew?: boolean;
  iconKey?: string | null;
  colorKey?: string | null;
  isPinned?: boolean;
  markerVerifiedAt?: string | null;
}): StorageDeviceProfile {
  const volumeLabel = (options.volumeLabel || '').trim().slice(0, 120) || 'Storage Device';
  const requestedName = options.name?.trim() ? options.name.trim().slice(0, 80) : null;
  const requestedId = sanitizeDeviceProfileId(options.id);
  const cleanMarkerVerifiedAt =
    options.markerVerifiedAt !== undefined ? sanitizeIsoTimestamp(options.markerVerifiedAt) : undefined;
  const now = new Date().toISOString();

  // 1. Match by explicit profile ID first (unless explicitly forcing new creation with an unused ID)
  if (requestedId && !options.createNew) {
    const existingById = getStorageDeviceProfileById(requestedId);
    if (existingById) {
      const nextMarkerVerifiedAt =
        cleanMarkerVerifiedAt !== undefined ? cleanMarkerVerifiedAt : existingById.markerVerifiedAt;
      getDb()
        .prepare(
          `UPDATE storage_device_profiles
           SET volume_label = ?,
               marker_verified_at = ?,
               last_mounted_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(volumeLabel, nextMarkerVerifiedAt, now, now, existingById.id);
      return getStorageDeviceProfileById(existingById.id) || existingById;
    }
  }

  // 2. If no explicit ID was requested and createNew is not forced, fall back to volume label match
  if (!requestedId && !options.createNew) {
    const existingByVolume = getDb()
      .prepare(
        `SELECT id FROM storage_device_profiles
         WHERE LOWER(TRIM(volume_label)) = LOWER(TRIM(?))
         ORDER BY is_archived ASC, COALESCE(last_mounted_at, updated_at, created_at) DESC
         LIMIT 1`,
      )
      .get(volumeLabel) as { id: string } | undefined;
    if (existingByVolume?.id) {
      const existingProfile = getStorageDeviceProfileById(existingByVolume.id);
      const nextMarkerVerifiedAt =
        cleanMarkerVerifiedAt !== undefined
          ? cleanMarkerVerifiedAt
          : existingProfile?.markerVerifiedAt ?? null;
      getDb()
        .prepare(
          `UPDATE storage_device_profiles
           SET marker_verified_at = ?,
               last_mounted_at = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(nextMarkerVerifiedAt, now, now, existingByVolume.id);
      const found = getStorageDeviceProfileById(existingByVolume.id);
      if (found) return found;
    }
  }

  // 3. Create new profile with hardware UUID (when createNew) or requested/deterministic ID
  const baseId =
    requestedId ||
    (options.createNew ? generateUuidDeviceProfileId() : makeStableDeviceProfileId(volumeLabel));
  let finalId = baseId;
  let suffix = 2;
  while (getDb().prepare('SELECT 1 FROM storage_device_profiles WHERE id = ?').get(finalId)) {
    finalId = options.createNew
      ? generateUuidDeviceProfileId()
      : `${baseId.slice(0, 68)}-${suffix++}`;
  }

  const displayName = requestedName || volumeLabel.slice(0, 80);
  const iconKey = sanitizeDeviceIconKey(options.iconKey);
  const colorKey = sanitizeDeviceColorKey(options.colorKey);
  const isPinned = options.isPinned ? 1 : 0;
  const markerVerifiedAt = cleanMarkerVerifiedAt ?? null;

  getDb()
    .prepare(
      `INSERT INTO storage_device_profiles (
         id, name, volume_label, icon_key, color_key, is_pinned, is_archived, marker_verified_at,
         folder_config_json, rom_naming_json, art_export_json, last_mounted_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, NULL, NULL, ?, ?, ?)`,
    )
    .run(
      finalId,
      displayName,
      volumeLabel,
      iconKey,
      colorKey,
      isPinned,
      markerVerifiedAt,
      now,
      now,
      now,
    );

  const created = getStorageDeviceProfileById(finalId);
  if (!created) {
    throw new Error('Failed to load newly created storage device profile');
  }
  return created;
}

export function updateStorageDeviceProfile(
  id: string,
  patch: {
    name?: string;
    iconKey?: string;
    colorKey?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    markerVerifiedAt?: string | null;
    folderConfig?: StorageFolderMappingConfig | null;
    romNaming?: DeviceRomNamingOverrides | null;
  },
): StorageDeviceProfile | null {
  const existing = getStorageDeviceProfileById(id);
  if (!existing) return null;

  const nextName =
    patch.name !== undefined ? patch.name.trim().slice(0, 80) : existing.name;
  if (!nextName) {
    throw new Error('Device profile name cannot be empty');
  }

  const nextIconKey =
    patch.iconKey !== undefined ? sanitizeDeviceIconKey(patch.iconKey, existing.iconKey) : existing.iconKey;
  const nextColorKey =
    patch.colorKey !== undefined ? sanitizeDeviceColorKey(patch.colorKey, existing.colorKey) : existing.colorKey;
  const nextIsArchived = patch.isArchived !== undefined ? Boolean(patch.isArchived) : existing.isArchived;
  // Archiving a device automatically unpins it unless explicitly re-pinned in the same call
  const nextIsPinned =
    patch.isPinned !== undefined
      ? Boolean(patch.isPinned)
      : nextIsArchived && !existing.isArchived
        ? false
        : existing.isPinned;
  const nextMarkerVerifiedAt =
    patch.markerVerifiedAt !== undefined
      ? patch.markerVerifiedAt === null
        ? null
        : sanitizeIsoTimestamp(patch.markerVerifiedAt)
      : existing.markerVerifiedAt;

  const nextFolderConfig =
    patch.folderConfig !== undefined
      ? patch.folderConfig === null
        ? null
        : normalizeStorageFolderConfig(patch.folderConfig)
      : existing.folderConfig;

  const nextRomNaming =
    patch.romNaming !== undefined
      ? patch.romNaming === null
        ? null
        : normalizeDeviceRomNaming(patch.romNaming)
      : existing.romNaming;

  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE storage_device_profiles
       SET name = ?,
           icon_key = ?,
           color_key = ?,
           is_pinned = ?,
           is_archived = ?,
           marker_verified_at = ?,
           folder_config_json = ?,
           rom_naming_json = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .run(
      nextName,
      nextIconKey,
      nextColorKey,
      nextIsPinned ? 1 : 0,
      nextIsArchived ? 1 : 0,
      nextMarkerVerifiedAt,
      nextFolderConfig ? JSON.stringify(nextFolderConfig) : null,
      nextRomNaming ? JSON.stringify(nextRomNaming) : null,
      now,
      existing.id,
    );

  if (nextName !== existing.name) {
    const affectedRows = getDb()
      .prepare('SELECT release_id FROM catalog_release_device_installs WHERE device_id = ?')
      .all(existing.id) as { release_id: number }[];
    if (affectedRows.length > 0) {
      recomputeReleaseInstallRollups(affectedRows.map((r) => Number(r.release_id)));
    }
  }

  return getStorageDeviceProfileById(existing.id);
}

export function deleteStorageDeviceProfile(id: string): {
  deleted: boolean;
  affectedReleaseIds: number[];
} {
  const cleanId = sanitizeDeviceProfileId(id);
  if (!cleanId) return { deleted: false, affectedReleaseIds: [] };

  const affectedRows = getDb()
    .prepare('SELECT release_id FROM catalog_release_device_installs WHERE device_id = ?')
    .all(cleanId) as { release_id: number }[];
  const affectedReleaseIds = affectedRows.map((r) => Number(r.release_id));

  const info = getDb().prepare('DELETE FROM storage_device_profiles WHERE id = ?').run(cleanId);
  if (info.changes > 0 && affectedReleaseIds.length > 0) {
    recomputeReleaseInstallRollups(affectedReleaseIds);
  }
  return { deleted: info.changes > 0, affectedReleaseIds };
}

export function getDeviceUninstallTargets(
  deviceId: string,
  releaseIds: number[],
): DeviceUninstallTargetRecord[] {
  const cleanDeviceId = sanitizeDeviceProfileId(deviceId);
  const cleanIds = Array.from(
    new Set(releaseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (!cleanDeviceId || cleanIds.length === 0) {
    return [];
  }

  const byId = new Map<number, DeviceUninstallTargetRecord>();
  const needsFallbackFileIds: number[] = [];

  for (const chunk of chunkNumberIds(cleanIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = getDb()
      .prepare(
        `SELECT
           r.id,
           r.title,
           r.system_name,
           r.release_tags_json,
           r.installed_filename AS rollup_installed_filename,
           di.installed_filename AS device_installed_filename,
           di.installed_paths_json
         FROM catalog_release_device_installs di
         INNER JOIN catalog_releases r ON r.id = di.release_id
         WHERE di.device_id = ? AND di.release_id IN (${placeholders})`,
      )
      .all(cleanDeviceId, ...chunk) as Record<string, unknown>[];

    for (const row of rows) {
      const rid = Number(row.id);
      let releaseTags: string[] = [];
      if (row.release_tags_json) {
        try {
          const parsed = JSON.parse(String(row.release_tags_json));
          if (Array.isArray(parsed)) {
            releaseTags = parsed.map((t) => String(t)).filter(Boolean);
          }
        } catch {
          releaseTags = [];
        }
      }
      let installedPaths: string[] = [];
      if (row.installed_paths_json) {
        try {
          installedPaths = sanitizeInstalledPathsList(JSON.parse(String(row.installed_paths_json)));
        } catch {
          installedPaths = [];
        }
      }
      const installedFilename = row.device_installed_filename
        ? String(row.device_installed_filename)
        : row.rollup_installed_filename
          ? String(row.rollup_installed_filename)
          : null;

      if (installedPaths.length === 0 && !installedFilename) {
        needsFallbackFileIds.push(rid);
      }

      byId.set(rid, {
        id: rid,
        title: String(row.title || `Release #${rid}`),
        systemName: String(row.system_name || ''),
        releaseTags,
        installedFilename,
        fallbackFilename: null,
        installedPaths,
      });
    }
  }

  if (needsFallbackFileIds.length > 0) {
    for (const chunk of chunkNumberIds(needsFallbackFileIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const fileRows = getDb()
        .prepare(
          `SELECT release_id, filename
           FROM catalog_release_files
           WHERE release_id IN (${placeholders})
           ORDER BY id ASC`,
        )
        .all(...chunk) as { release_id: number; filename: string | null }[];
      for (const fileRow of fileRows) {
        const target = byId.get(Number(fileRow.release_id));
        if (target && !target.fallbackFilename && fileRow.filename) {
          target.fallbackFilename = String(fileRow.filename);
        }
      }
    }
  }

  const ordered: DeviceUninstallTargetRecord[] = [];
  for (const id of cleanIds) {
    const match = byId.get(id);
    if (match) ordered.push(match);
  }
  return ordered;
}

export function removeDeviceInstalls(
  deviceId: string,
  releaseIds: number[],
): { removed: number; items: RepositoryItemRecord[] } {
  const cleanDeviceId = sanitizeDeviceProfileId(deviceId);
  const cleanIds = Array.from(
    new Set(releaseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (!cleanDeviceId || cleanIds.length === 0) {
    return { removed: 0, items: [] };
  }

  let totalRemoved = 0;
  const deleteTx = getDb().transaction(() => {
    for (const chunk of chunkNumberIds(cleanIds)) {
      const placeholders = chunk.map(() => '?').join(', ');
      const info = getDb()
        .prepare(
          `DELETE FROM catalog_release_device_installs
           WHERE device_id = ? AND release_id IN (${placeholders})`,
        )
        .run(cleanDeviceId, ...chunk);
      totalRemoved += info.changes;
    }
  });
  deleteTx();

  recomputeReleaseInstallRollups(cleanIds);

  const rows: Record<string, unknown>[] = [];
  for (const chunk of chunkNumberIds(cleanIds)) {
    const placeholders = chunk.map(() => '?').join(', ');
    const chunkRows = getDb()
      .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
      .all(...chunk) as Record<string, unknown>[];
    rows.push(...chunkRows);
  }
  const filesMap = loadFilesByReleaseIds(cleanIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(cleanIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(cleanIds);

  return {
    removed: totalRemoved,
    items: rows.map((r) =>
      mapReleaseRow(
        r,
        filesMap.get(Number(r.id)) || [],
        collectionsMap.get(Number(r.id)) || [],
        deviceInstallsMap.get(Number(r.id)) || [],
      ),
    ),
  };
}

export interface InstalledItemFileMeta {
  fileId?: number | null;
  filename?: string | null;
  paths?: string[];
}

export function setCatalogItemsInstalled(options: {
  ids: number[];
  installed: boolean;
  deviceId?: string | null;
  deviceLabel?: string | null;
  installedFileId?: number | null;
  installedFilename?: string | null;
  itemMeta?: Record<number, InstalledItemFileMeta>;
}): { updated: number; items: RepositoryItemRecord[] } {
  const cleanIds = Array.from(
    new Set(options.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { updated: 0, items: [] };
  }

  const placeholders = cleanIds.map(() => '?').join(', ');
  const existingReleaseRows = getDb()
    .prepare(`SELECT id FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...cleanIds) as { id: number }[];
  const validIds = existingReleaseRows.map((r) => Number(r.id));
  if (validIds.length === 0) {
    return { updated: 0, items: [] };
  }

  const scopedDeviceId = sanitizeDeviceProfileId(options.deviceId);
  let updated = 0;

  if (options.installed) {
    const now = new Date().toISOString();
    const label = options.deviceLabel?.trim() ? options.deviceLabel.trim().slice(0, 120) : null;
    const profile = scopedDeviceId
      ? upsertStorageDeviceProfileOnMount({
          id: scopedDeviceId,
          volumeLabel: label || scopedDeviceId,
          name: label || undefined,
        })
      : label
        ? upsertStorageDeviceProfileOnMount({ volumeLabel: label })
        : upsertStorageDeviceProfileOnMount({
            id: 'dev-storage',
            volumeLabel: 'Storage Device',
            name: 'Storage Device',
          });

    const defaultFileId =
      options.installedFileId !== undefined &&
      options.installedFileId !== null &&
      Number.isInteger(Number(options.installedFileId)) &&
      Number(options.installedFileId) > 0
        ? Number(options.installedFileId)
        : null;
    const defaultFilename = options.installedFilename?.trim()
      ? options.installedFilename.trim().slice(0, 300)
      : null;

    const upsertDeviceInstallStmt = getDb().prepare(
      `INSERT INTO catalog_release_device_installs (
         release_id, device_id, installed_at, installed_file_id, installed_filename, installed_paths_json
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(release_id, device_id) DO UPDATE SET
         installed_at = excluded.installed_at,
         installed_file_id = COALESCE(excluded.installed_file_id, catalog_release_device_installs.installed_file_id),
         installed_filename = COALESCE(excluded.installed_filename, catalog_release_device_installs.installed_filename),
         installed_paths_json = CASE
           WHEN excluded.installed_paths_json != '[]' THEN excluded.installed_paths_json
           ELSE catalog_release_device_installs.installed_paths_json
         END`,
    );

    const tx = getDb().transaction(() => {
      let count = 0;
      for (const id of validIds) {
        const meta = options.itemMeta?.[id];
        const itemFileId =
          meta?.fileId !== undefined &&
          meta?.fileId !== null &&
          Number.isInteger(Number(meta.fileId)) &&
          Number(meta.fileId) > 0
            ? Number(meta.fileId)
            : defaultFileId;
        const itemFilename = meta?.filename?.trim()
          ? meta.filename.trim().slice(0, 300)
          : defaultFilename;
        const cleanPaths = meta?.paths ? sanitizeInstalledPathsList(meta.paths) : [];
        const pathsJson = cleanPaths.length > 0 ? JSON.stringify(cleanPaths) : '[]';
        count += upsertDeviceInstallStmt.run(
          id,
          profile.id,
          now,
          itemFileId,
          itemFilename,
          pathsJson,
        ).changes;
      }
      return count;
    });
    updated = tx();
    recomputeReleaseInstallRollups(validIds);
  } else {
    const validPlaceholders = validIds.map(() => '?').join(', ');
    if (scopedDeviceId) {
      const info = getDb()
        .prepare(
          `DELETE FROM catalog_release_device_installs
           WHERE device_id = ? AND release_id IN (${validPlaceholders})`,
        )
        .run(scopedDeviceId, ...validIds);
      updated = info.changes;
    } else {
      const info = getDb()
        .prepare(
          `DELETE FROM catalog_release_device_installs
           WHERE release_id IN (${validPlaceholders})`,
        )
        .run(...validIds);
      updated = info.changes;
    }
    recomputeReleaseInstallRollups(validIds);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...cleanIds) as Record<string, unknown>[];
  const filesMap = loadFilesByReleaseIds(cleanIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(cleanIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(cleanIds);

  return {
    updated,
    items: rows.map((r) =>
      mapReleaseRow(
        r,
        filesMap.get(Number(r.id)) || [],
        collectionsMap.get(Number(r.id)) || [],
        deviceInstallsMap.get(Number(r.id)) || [],
      ),
    ),
  };
}

export function setCatalogItemsFavorite(options: {
  ids: number[];
  favorite: boolean;
}): { updated: number; items: RepositoryItemRecord[] } {
  const cleanIds = Array.from(
    new Set(options.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { updated: 0, items: [] };
  }

  const placeholders = cleanIds.map(() => '?').join(', ');
  const info = getDb()
    .prepare(`UPDATE catalog_releases SET is_favorite = ? WHERE id IN (${placeholders})`)
    .run(options.favorite ? 1 : 0, ...cleanIds);

  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...cleanIds) as Record<string, unknown>[];
  const filesMap = loadFilesByReleaseIds(cleanIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(cleanIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(cleanIds);

  return {
    updated: info.changes,
    items: rows.map((r) =>
      mapReleaseRow(
        r,
        filesMap.get(Number(r.id)) || [],
        collectionsMap.get(Number(r.id)) || [],
        deviceInstallsMap.get(Number(r.id)) || [],
      ),
    ),
  };
}

export function setCatalogItemsSyncOverride(options: {
  ids: number[];
  syncOverride: SyncOverrideMode;
}): { updated: number; items: RepositoryItemRecord[] } {
  const cleanIds = Array.from(
    new Set(options.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { updated: 0, items: [] };
  }

  const normalized = normalizeSyncOverride(options.syncOverride);
  const placeholders = cleanIds.map(() => '?').join(', ');
  const info = getDb()
    .prepare(`UPDATE catalog_releases SET sync_override = ? WHERE id IN (${placeholders})`)
    .run(normalized, ...cleanIds);

  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...cleanIds) as Record<string, unknown>[];
  const filesMap = loadFilesByReleaseIds(cleanIds);
  const collectionsMap = loadCollectionIdsByReleaseIds(cleanIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(cleanIds);

  return {
    updated: info.changes,
    items: rows.map((r) =>
      mapReleaseRow(
        r,
        filesMap.get(Number(r.id)) || [],
        collectionsMap.get(Number(r.id)) || [],
        deviceInstallsMap.get(Number(r.id)) || [],
      ),
    ),
  };
}

function mapUserCollectionRow(row: Record<string, unknown>): UserCollectionRecord {
  return {
    id: Number(row.id),
    name: String(row.name || ''),
    description: row.description ? String(row.description) : null,
    sortOrder: Number(row.sort_order || 0),
    itemCount: Number(row.item_count || 0),
    downloadedCount: Number(row.downloaded_count || 0),
    installedCount: Number(row.installed_count || 0),
    queueableCount: Number(row.queueable_count || 0),
    estimatedBytes: Number(row.estimated_bytes || 0),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

const USER_COLLECTION_SELECT_SQL = `
  SELECT
    c.id,
    c.name,
    c.description,
    c.sort_order,
    c.created_at,
    c.updated_at,
    COUNT(r.id) AS item_count,
    SUM(CASE WHEN r.status IN ('downloaded', 'skipped') THEN 1 ELSE 0 END) AS downloaded_count,
    SUM(CASE WHEN r.installed_at IS NOT NULL THEN 1 ELSE 0 END) AS installed_count,
    SUM(CASE WHEN r.status IN ('available', 'failed', 'partial') THEN 1 ELSE 0 END) AS queueable_count,
    COALESCE(SUM(COALESCE(r.file_size_bytes, 0)), 0) AS estimated_bytes
  FROM user_collections c
  LEFT JOIN user_collection_items uci ON uci.collection_id = c.id
  LEFT JOIN catalog_releases r ON r.id = uci.release_id
`;

export function listUserCollections(): UserCollectionRecord[] {
  const rows = getDb()
    .prepare(
      `${USER_COLLECTION_SELECT_SQL}
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC, c.id ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map(mapUserCollectionRow);
}

export function getUserCollectionById(id: number): UserCollectionRecord | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = getDb()
    .prepare(
      `${USER_COLLECTION_SELECT_SQL}
       WHERE c.id = ?
       GROUP BY c.id`,
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapUserCollectionRow(row) : null;
}

export function createUserCollection(input: {
  name: string;
  description?: string | null;
}): UserCollectionRecord {
  const cleanName = input.name.trim().slice(0, 80);
  if (!cleanName) {
    throw new Error('Collection name is required');
  }
  const cleanDesc =
    typeof input.description === 'string' && input.description.trim()
      ? input.description.trim().slice(0, 300)
      : null;
  const now = new Date().toISOString();
  const maxOrderRow = getDb()
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM user_collections')
    .get() as { max_order: number };
  const nextOrder = Number(maxOrderRow?.max_order ?? -1) + 1;

  const info = getDb()
    .prepare(
      `INSERT INTO user_collections (name, description, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(cleanName, cleanDesc, nextOrder, now, now);

  const created = getUserCollectionById(Number(info.lastInsertRowid));
  if (!created) {
    throw new Error('Failed to load newly created collection');
  }
  return created;
}

export function updateUserCollection(
  id: number,
  input: { name?: string; description?: string | null },
): UserCollectionRecord | null {
  const existing = getUserCollectionById(id);
  if (!existing) return null;

  const nextName = input.name !== undefined ? input.name.trim().slice(0, 80) : existing.name;
  if (!nextName) {
    throw new Error('Collection name cannot be empty');
  }
  const nextDesc =
    input.description !== undefined
      ? typeof input.description === 'string' && input.description.trim()
        ? input.description.trim().slice(0, 300)
        : null
      : existing.description;
  const now = new Date().toISOString();

  getDb()
    .prepare(
      `UPDATE user_collections
       SET name = ?, description = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(nextName, nextDesc, now, id);

  return getUserCollectionById(id);
}

export function deleteUserCollection(id: number): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const info = getDb().prepare('DELETE FROM user_collections WHERE id = ?').run(id);
  return info.changes > 0;
}

export function addItemsToUserCollection(
  collectionId: number,
  releaseIds: number[],
): { collection: UserCollectionRecord | null; added: number } {
  const existing = getUserCollectionById(collectionId);
  if (!existing) {
    return { collection: null, added: 0 };
  }
  const cleanIds = Array.from(
    new Set(releaseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { collection: existing, added: 0 };
  }

  const now = new Date().toISOString();
  const placeholders = cleanIds.map(() => '?').join(', ');
  const existingReleaseRows = getDb()
    .prepare(`SELECT id FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...cleanIds) as { id: number }[];
  const validReleaseIds = existingReleaseRows.map((r) => Number(r.id));

  const insertStmt = getDb().prepare(
    `INSERT OR IGNORE INTO user_collection_items (collection_id, release_id, added_at)
     VALUES (?, ?, ?)`,
  );
  const touchCollectionStmt = getDb().prepare(
    `UPDATE user_collections SET updated_at = ? WHERE id = ?`,
  );

  const tx = getDb().transaction(() => {
    let added = 0;
    for (const rid of validReleaseIds) {
      added += insertStmt.run(collectionId, rid, now).changes;
    }
    if (added > 0) {
      touchCollectionStmt.run(now, collectionId);
    }
    return added;
  });

  const added = tx();
  return {
    collection: getUserCollectionById(collectionId),
    added,
  };
}

export function removeItemsFromUserCollection(
  collectionId: number,
  releaseIds: number[],
): { collection: UserCollectionRecord | null; removed: number } {
  const existing = getUserCollectionById(collectionId);
  if (!existing) {
    return { collection: null, removed: 0 };
  }
  const cleanIds = Array.from(
    new Set(releaseIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
  );
  if (cleanIds.length === 0) {
    return { collection: existing, removed: 0 };
  }

  const now = new Date().toISOString();
  const placeholders = cleanIds.map(() => '?').join(', ');
  const info = getDb()
    .prepare(
      `DELETE FROM user_collection_items
       WHERE collection_id = ? AND release_id IN (${placeholders})`,
    )
    .run(collectionId, ...cleanIds);

  if (info.changes > 0) {
    getDb().prepare('UPDATE user_collections SET updated_at = ? WHERE id = ?').run(now, collectionId);
  }

  return {
    collection: getUserCollectionById(collectionId),
    removed: info.changes,
  };
}

export function listOutdatedInstalledItems(options?: {
  deviceId?: string | null;
  deviceLabel?: string | null;
}): OutdatedInstalledSummary {
  const scopedDeviceId = sanitizeDeviceProfileId(options?.deviceId);
  const partition = computeInstalledOutdatedPartition(scopedDeviceId);
  if (partition.outdatedIds.length === 0) {
    return {
      total: 0,
      localReadyCount: 0,
      remoteOnlyCount: 0,
      localReadyIds: [],
      remoteOnlyIds: [],
      items: [],
    };
  }

  const conditions: string[] = ['id IN (SELECT value FROM json_each(?))'];
  const args: unknown[] = [JSON.stringify(partition.outdatedIds)];

  if (!scopedDeviceId && options?.deviceLabel && options.deviceLabel.trim()) {
    conditions.push('LOWER(TRIM(installed_device_label)) = LOWER(TRIM(?))');
    args.push(options.deviceLabel.trim());
  }

  const rows = getDb()
    .prepare(
      `SELECT * FROM catalog_releases
       WHERE ${conditions.join(' AND ')}
       ORDER BY COALESCE(downloaded_at, remote_updated_at, installed_at) DESC, title ASC`,
    )
    .all(...args) as Record<string, unknown>[];

  const releaseIds = rows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(releaseIds);
  const deviceInstallsMap = loadDeviceInstallsByReleaseIds(releaseIds);

  const localReadyIds: number[] = [];
  const remoteOnlyIds: number[] = [];
  const items: OutdatedInstalledItemSummary[] = [];

  for (const row of rows) {
    const rid = Number(row.id);
    const deviceInstalls = deviceInstallsMap.get(rid) || [];
    const record = mapReleaseRow(row, filesMap.get(rid) || [], [], deviceInstalls);
    const scopedInstall = scopedDeviceId
      ? deviceInstalls.find((d) => d.deviceId === scopedDeviceId) || null
      : null;

    const effectiveInstalledAt = scopedInstall?.installedAt ?? record.installedAt;
    const effectiveDeviceLabel = scopedInstall?.deviceName ?? record.installedDeviceLabel;
    const effectiveFileId = scopedInstall ? scopedInstall.installedFileId : record.installedFileId;
    const effectiveFilename = scopedInstall ? scopedInstall.installedFilename : record.installedFilename;

    const info = classifyInstalledUpdateState({
      ...record,
      installedAt: effectiveInstalledAt,
      installedDeviceLabel: effectiveDeviceLabel,
      installedFileId: effectiveFileId,
      installedFilename: effectiveFilename,
    });
    if (!info.hasUpdate || !effectiveInstalledAt) continue;

    if (info.readyToUpgradeLocal) {
      localReadyIds.push(record.id);
    } else if (info.needsLocalDownload) {
      remoteOnlyIds.push(record.id);
    }

    items.push({
      id: record.id,
      title: record.title,
      systemName: record.systemName,
      updateState: info.readyToUpgradeLocal ? 'update_ready_local' : 'update_available_remote',
      installedAt: effectiveInstalledAt,
      installedDeviceLabel: effectiveDeviceLabel,
      installedFileId: effectiveFileId,
      installedFilename: effectiveFilename,
      latestLocalDownloadedAt: info.latestLocalDownloadedAt,
      remoteUpdatedAt: record.remoteUpdatedAt,
    });
  }

  return {
    total: items.length,
    localReadyCount: localReadyIds.length,
    remoteOnlyCount: remoteOnlyIds.length,
    localReadyIds,
    remoteOnlyIds,
    items,
  };
}

export function listReleasesNeedingRetry(options?: {
  system?: string;
  ids?: number[];
}): RepositoryItemRecord[] {
  const conditions: string[] = ["status IN ('failed', 'partial')"];
  const args: unknown[] = [];

  if (options?.system && options.system !== 'all') {
    const retrySystems = expandSystemAliases([options.system]);
    if (retrySystems.length === 1) {
      conditions.push('system_name = ?');
      args.push(retrySystems[0]);
    } else if (retrySystems.length > 1) {
      conditions.push(`system_name IN (${retrySystems.map(() => '?').join(', ')})`);
      args.push(...retrySystems);
    }
  }

  if (options?.ids && options.ids.length > 0) {
    const cleanIds = Array.from(
      new Set(options.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (cleanIds.length === 0) {
      return [];
    }
    const placeholders = cleanIds.map(() => '?').join(', ');
    conditions.push(`id IN (${placeholders})`);
    args.push(...cleanIds);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases ${where} ORDER BY id ASC`)
    .all(...args) as Record<string, unknown>[];

  const releaseIds = rows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(releaseIds);
  return rows.map((r) => mapReleaseRow(r, filesMap.get(Number(r.id)) || []));
}

export function getCatalogTotalsAndSystems(): {
  totals: {
    totalCatalogItems: number;
    availableItems: number;
    downloadedItems: number;
    skippedItems: number;
    failedItems: number;
    queuedItems: number;
    installedItems: number;
    outdatedInstalledItems: number;
    outdatedLocalReadyItems: number;
    favoriteItems: number;
    totalBytesMirrored: number;
    totalRuns: number;
  };
  systems: SystemBreakdown[];
  releaseTypes: ReleaseTypeBreakdown[];
} {
  const outdatedPartition = computeInstalledOutdatedPartition();
  const totalsRow = getDb().prepare(`
    SELECT
      COUNT(*) as total_items,
      SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available_items,
      SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_items,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_items,
      SUM(CASE WHEN status IN ('failed', 'partial') THEN 1 ELSE 0 END) as failed_items,
      SUM(CASE WHEN status IN ('queued', 'downloading') THEN 1 ELSE 0 END) as queued_items,
      SUM(CASE WHEN installed_at IS NOT NULL THEN 1 ELSE 0 END) as installed_items,
      SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END) as favorite_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped', 'partial') THEN file_size_bytes ELSE 0 END), 0) as total_bytes
    FROM catalog_releases
  `).get() as Record<string, unknown>;

  const runsRow = getDb().prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };

  const systemRows = getDb().prepare(`
    WITH file_counts AS (
      SELECT
        r2.system_name,
        COUNT(f.id) AS mirrored_files
      FROM catalog_release_files f
      INNER JOIN catalog_releases r2 ON r2.id = f.release_id
      WHERE f.status IN ('downloaded', 'skipped')
      GROUP BY r2.system_name
    )
    SELECT
      r.system_name,
      COUNT(*) as total_items,
      SUM(CASE WHEN r.status = 'available' THEN 1 ELSE 0 END) as available_items,
      SUM(CASE WHEN r.status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_items,
      SUM(CASE WHEN r.status = 'skipped' THEN 1 ELSE 0 END) as skipped_items,
      SUM(CASE WHEN r.status IN ('failed', 'partial') THEN 1 ELSE 0 END) as failed_items,
      SUM(CASE WHEN r.status IN ('queued', 'downloading') THEN 1 ELSE 0 END) as queued_items,
      SUM(CASE WHEN r.installed_at IS NOT NULL THEN 1 ELSE 0 END) as installed_items,
      COALESCE(SUM(CASE WHEN r.status IN ('downloaded', 'skipped', 'partial') THEN r.file_size_bytes ELSE 0 END), 0) as total_bytes,
      MAX(COALESCE(r.downloaded_at, r.discovered_at)) as last_activity_at,
      COALESCE(fc.mirrored_files, 0) as mirrored_files
    FROM catalog_releases r
    LEFT JOIN file_counts fc ON fc.system_name = r.system_name
    GROUP BY r.system_name
    ORDER BY total_items DESC, r.system_name ASC
  `).all() as Record<string, unknown>[];

  const releaseTypeRows = getDb().prepare(`
    WITH normalized_tags AS (
      SELECT
        r.id,
        r.status,
        r.file_size_bytes,
        TRIM(CAST(j.value AS TEXT)) AS tag_name
      FROM catalog_releases r,
        json_each(
          CASE
            WHEN json_valid(r.release_tags_json) AND json_array_length(r.release_tags_json) > 0
            THEN r.release_tags_json
            ELSE json_array(COALESCE(NULLIF(TRIM(r.release_type), ''), 'Retail ROM'))
          END
        ) AS j
      WHERE TRIM(CAST(j.value AS TEXT)) != ''
    )
    SELECT
      tag_name AS type_name,
      COUNT(DISTINCT id) AS total_items,
      COUNT(DISTINCT CASE WHEN status IN ('downloaded', 'skipped') THEN id END) AS downloaded_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped', 'partial') THEN file_size_bytes ELSE 0 END), 0) AS total_bytes
    FROM normalized_tags
    GROUP BY tag_name
    ORDER BY downloaded_items DESC, total_bytes DESC, type_name ASC
  `).all() as Record<string, unknown>[];

  return {
    totals: {
      totalCatalogItems: Number(totalsRow.total_items || 0),
      availableItems: Number(totalsRow.available_items || 0),
      downloadedItems: Number(totalsRow.downloaded_items || 0),
      skippedItems: Number(totalsRow.skipped_items || 0),
      failedItems: Number(totalsRow.failed_items || 0),
      queuedItems: Number(totalsRow.queued_items || 0),
      installedItems: Number(totalsRow.installed_items || 0),
      outdatedInstalledItems: outdatedPartition.outdatedIds.length,
      outdatedLocalReadyItems: outdatedPartition.localReadyIds.length,
      favoriteItems: Number(totalsRow.favorite_items || 0),
      totalBytesMirrored: Number(totalsRow.total_bytes || 0),
      totalRuns: Number(runsRow.count || 0),
    },
    systems: systemRows.map((r) => {
      const downloadedItems = Number(r.downloaded_items || 0);
      const skippedItems = Number(r.skipped_items || 0);
      const rawMirroredFiles = Number(r.mirrored_files || 0);
      return {
        systemName: String(r.system_name),
        totalItems: Number(r.total_items || 0),
        availableItems: Number(r.available_items || 0),
        downloadedItems,
        skippedItems,
        failedItems: Number(r.failed_items || 0),
        queuedItems: Number(r.queued_items || 0),
        installedItems: Number(r.installed_items || 0),
        mirroredFiles: Math.max(rawMirroredFiles, downloadedItems + skippedItems),
        totalBytes: Number(r.total_bytes || 0),
        lastActivityAt: r.last_activity_at ? String(r.last_activity_at) : null,
      };
    }),
    releaseTypes: releaseTypeRows.map((r) => ({
      typeName: String(r.type_name),
      downloadedItems: Number(r.downloaded_items || 0),
      totalItems: Number(r.total_items || 0),
      totalBytes: Number(r.total_bytes || 0),
    })),
  };
}

const SIZE_HISTOGRAM_BUCKETS: ReadonlyArray<{
  bucketKey: string;
  label: string;
  minBytes: number;
  maxBytes: number | null;
}> = [
  { bucketKey: 'lt_1mb', label: '< 1 MB', minBytes: 0, maxBytes: 1024 * 1024 },
  { bucketKey: '1_16mb', label: '1–16 MB', minBytes: 1024 * 1024, maxBytes: 16 * 1024 * 1024 },
  { bucketKey: '16_128mb', label: '16–128 MB', minBytes: 16 * 1024 * 1024, maxBytes: 128 * 1024 * 1024 },
  { bucketKey: '128_512mb', label: '128–512 MB', minBytes: 128 * 1024 * 1024, maxBytes: 512 * 1024 * 1024 },
  { bucketKey: '512mb_2gb', label: '512 MB–2 GB', minBytes: 512 * 1024 * 1024, maxBytes: 2 * 1024 * 1024 * 1024 },
  { bucketKey: 'gt_2gb', label: '> 2 GB', minBytes: 2 * 1024 * 1024 * 1024, maxBytes: null },
];

function extractIsoDay(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? match[1] : null;
}

function queryCompositionStats(columnName: JsonFacetColumn): CompositionStat[] {
  const expr = jsonFacetColumnExpr(columnName);
  const rows = getDb()
    .prepare(
      `SELECT
        TRIM(CAST(je.value AS TEXT)) AS label,
        COUNT(DISTINCT catalog_releases.id) AS total_count,
        COUNT(DISTINCT CASE WHEN catalog_releases.status IN ('downloaded', 'skipped') THEN catalog_releases.id END) AS downloaded_count,
        COALESCE(SUM(CASE WHEN catalog_releases.status IN ('downloaded', 'skipped', 'partial') THEN catalog_releases.file_size_bytes ELSE 0 END), 0) AS mirrored_bytes
      FROM catalog_releases, json_each(${expr}) AS je
      WHERE je.value IS NOT NULL AND TRIM(CAST(je.value AS TEXT)) != ''
      GROUP BY label
      ORDER BY total_count DESC, downloaded_count DESC, label COLLATE NOCASE ASC`,
    )
    .all() as {
    label: string;
    total_count: number;
    downloaded_count: number;
    mirrored_bytes: number;
  }[];

  return rows.map((r) => ({
    label: String(r.label),
    totalCount: Number(r.total_count || 0),
    downloadedCount: Number(r.downloaded_count || 0),
    mirroredBytes: Number(r.mirrored_bytes || 0),
  }));
}

export function getCatalogStatsSnapshot(): CatalogStatsSnapshot {
  const database = getDb();
  const cfg = getPublicConfig();
  const indexState = cfg.systemIndexState || {};

  const releaseRows = database
    .prepare(
      `SELECT
        id,
        system_name,
        status,
        file_size_bytes,
        discovered_at,
        downloaded_at,
        installed_at
      FROM catalog_releases`,
    )
    .all() as {
    id: number;
    system_name: string;
    status: string;
    file_size_bytes: number;
    discovered_at: string;
    downloaded_at: string | null;
    installed_at: string | null;
  }[];

  const growthMap = new Map<
    string,
    { indexedAdded: number; downloadedAdded: number; bytesAdded: number }
  >();
  const ensureGrowthDay = (day: string) => {
    let entry = growthMap.get(day);
    if (!entry) {
      entry = { indexedAdded: 0, downloadedAdded: 0, bytesAdded: 0 };
      growthMap.set(day, entry);
    }
    return entry;
  };

  const dailyFailuresMap = new Map<string, number>();

  const sizeBuckets: SizeBucketStat[] = SIZE_HISTOGRAM_BUCKETS.map((b) => ({
    ...b,
    downloadedCount: 0,
    availableCount: 0,
    downloadedBytes: 0,
    availableBytes: 0,
  }));

  const systemMap = new Map<string, SystemCoverageStat>();
  const ensureSystem = (rawName: string): SystemCoverageStat => {
    const canonical = (canonicalizeSystemSlug(rawName) || rawName).toLowerCase();
    let entry = systemMap.get(canonical);
    if (!entry) {
      const idx = indexState[canonical];
      entry = {
        systemName: canonical,
        totalItems: 0,
        downloadedItems: 0,
        availableItems: 0,
        queuedItems: 0,
        failedItems: 0,
        installedItems: 0,
        mirroredBytes: 0,
        estimatedAvailableBytes: 0,
        indexedPages: idx?.pagesIndexed ?? 0,
        totalPages: idx?.totalPages ?? 0,
        fullyIndexed: Boolean(idx?.fullyIndexed),
      };
      systemMap.set(canonical, entry);
    }
    return entry;
  };

  let totalCatalogItems = 0;
  let downloadedItems = 0;
  let availableItems = 0;
  let queuedItems = 0;
  let failedItems = 0;
  let installedItems = 0;
  let mirroredBytes = 0;
  let estimatedAvailableBytes = 0;
  let installedBytes = 0;

  for (const row of releaseRows) {
    totalCatalogItems += 1;
    const size = Math.max(0, Number(row.file_size_bytes || 0));
    const status = String(row.status || 'available');
    const isDownloaded = status === 'downloaded' || status === 'skipped';
    const isMirroredSize = isDownloaded || status === 'partial';
    const isQueued = status === 'queued' || status === 'downloading';
    const isFailed = status === 'failed' || status === 'partial';
    const isInstalled = Boolean(row.installed_at);

    if (isDownloaded) downloadedItems += 1;
    if (status === 'available') availableItems += 1;
    if (isQueued) queuedItems += 1;
    if (isFailed) failedItems += 1;
    if (isInstalled) {
      installedItems += 1;
      installedBytes += size;
    }

    if (isMirroredSize) {
      mirroredBytes += size;
    } else {
      estimatedAvailableBytes += size;
    }

    const discDay = extractIsoDay(row.discovered_at);
    if (discDay) {
      ensureGrowthDay(discDay).indexedAdded += 1;
    }

    if (isDownloaded || status === 'partial') {
      const dlDay = extractIsoDay(row.downloaded_at) || discDay;
      if (dlDay) {
        const g = ensureGrowthDay(dlDay);
        if (isDownloaded) {
          g.downloadedAdded += 1;
        }
        g.bytesAdded += size;
      }
    }

    if (isFailed && discDay) {
      dailyFailuresMap.set(discDay, (dailyFailuresMap.get(discDay) || 0) + 1);
    }

    const sys = ensureSystem(row.system_name);
    sys.totalItems += 1;
    if (isDownloaded) sys.downloadedItems += 1;
    if (status === 'available') sys.availableItems += 1;
    if (isQueued) sys.queuedItems += 1;
    if (isFailed) sys.failedItems += 1;
    if (isInstalled) sys.installedItems += 1;
    if (isMirroredSize) {
      sys.mirroredBytes += size;
    } else {
      sys.estimatedAvailableBytes += size;
    }

    if (size > 0) {
      const bucket = sizeBuckets.find(
        (b) => size >= b.minBytes && (b.maxBytes === null || size < b.maxBytes),
      );
      if (bucket) {
        if (isMirroredSize) {
          bucket.downloadedCount += 1;
          bucket.downloadedBytes += size;
        } else {
          bucket.availableCount += 1;
          bucket.availableBytes += size;
        }
      }
    }
  }

  for (const [slug, idx] of Object.entries(indexState)) {
    const canonical = (canonicalizeSystemSlug(slug) || slug).toLowerCase();
    const existing = ensureSystem(canonical);
    existing.indexedPages = Math.max(existing.indexedPages, idx?.pagesIndexed ?? 0);
    existing.totalPages = Math.max(existing.totalPages, idx?.totalPages ?? 0);
    existing.fullyIndexed = existing.fullyIndexed || Boolean(idx?.fullyIndexed);
  }

  const growthDates = Array.from(growthMap.keys()).sort((a, b) => a.localeCompare(b));
  let cumIndexed = 0;
  let cumDownloaded = 0;
  let cumBytes = 0;
  const growthTimeline: CatalogGrowthPoint[] = growthDates.map((date) => {
    const g = growthMap.get(date)!;
    cumIndexed += g.indexedAdded;
    cumDownloaded += g.downloadedAdded;
    cumBytes += g.bytesAdded;
    return {
      date,
      indexedAdded: g.indexedAdded,
      downloadedAdded: g.downloadedAdded,
      bytesAdded: g.bytesAdded,
      cumulativeIndexed: cumIndexed,
      cumulativeDownloaded: cumDownloaded,
      cumulativeBytes: cumBytes,
    };
  });

  // Daily file acquisition trends (from catalog_release_files + failed counts)
  const fileRows = database
    .prepare(
      `SELECT status, file_size_bytes, downloaded_at, discovered_at
       FROM catalog_release_files
       WHERE status IN ('downloaded', 'skipped')`,
    )
    .all() as {
    status: string;
    file_size_bytes: number;
    downloaded_at: string | null;
    discovered_at: string;
  }[];

  const dailyFileMap = new Map<string, { filesDownloaded: number; bytesDownloaded: number }>();
  for (const fr of fileRows) {
    const day = extractIsoDay(fr.downloaded_at) || extractIsoDay(fr.discovered_at);
    if (!day) continue;
    const cur = dailyFileMap.get(day) || { filesDownloaded: 0, bytesDownloaded: 0 };
    cur.filesDownloaded += 1;
    cur.bytesDownloaded += Math.max(0, Number(fr.file_size_bytes || 0));
    dailyFileMap.set(day, cur);
  }

  const allTrendDates = Array.from(
    new Set<string>([...dailyFileMap.keys(), ...dailyFailuresMap.keys()]),
  ).sort((a, b) => a.localeCompare(b));

  const daily: DownloadTrendDailyPoint[] = allTrendDates.map((date) => {
    const df = dailyFileMap.get(date);
    return {
      date,
      filesDownloaded: df?.filesDownloaded ?? 0,
      bytesDownloaded: df?.bytesDownloaded ?? 0,
      failedItems: dailyFailuresMap.get(date) ?? 0,
    };
  });

  const runRows = database
    .prepare(
      `SELECT id, trigger_type, mode, dry_run, status, started_at, finished_at,
              downloaded_count, skipped_count, failed_count, bytes_downloaded,
              rate_limit_hits, avg_delay_ms
       FROM sync_runs
       ORDER BY id DESC
       LIMIT 40`,
    )
    .all() as Record<string, unknown>[];

  const runs: DownloadTrendRunPoint[] = runRows.reverse().map((r) => {
    const startedAt = String(r.started_at);
    const finishedAt = r.finished_at ? String(r.finished_at) : null;
    const startMs = Date.parse(startedAt);
    const endMs = finishedAt ? Date.parse(finishedAt) : Date.now();
    const durationSec = Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(1, (endMs - startMs) / 1000)
      : 1;
    const bytesDownloaded = Number(r.bytes_downloaded || 0);
    return {
      id: Number(r.id),
      startedAt,
      triggerType: String(r.trigger_type) as RunTrigger,
      mode: String(r.mode) as RunMode,
      dryRun: Boolean(r.dry_run),
      status: String(r.status) as RunStatus,
      downloadedCount: Number(r.downloaded_count || 0),
      skippedCount: Number(r.skipped_count || 0),
      failedCount: Number(r.failed_count || 0),
      bytesDownloaded,
      durationSec,
      avgBytesPerSec: bytesDownloaded > 0 ? bytesDownloaded / durationSec : 0,
      rateLimitHits: Number(r.rate_limit_hits || 0),
      avgDelayMs: Number(r.avg_delay_ms || 0),
    };
  });

  const mirroredFileCount = Math.max(fileRows.length, downloadedItems);
  const systemCoverage = Array.from(systemMap.values()).sort(
    (a, b) => b.totalItems - a.totalItems || a.systemName.localeCompare(b.systemName),
  );

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalCatalogItems,
      downloadedItems,
      availableItems,
      queuedItems,
      failedItems,
      installedItems,
      mirroredBytes,
      estimatedAvailableBytes,
      avgMirroredFileBytes: mirroredFileCount > 0 ? Math.round(mirroredBytes / mirroredFileCount) : 0,
      installedBytes,
      systemsTracked: systemCoverage.filter((s) => s.totalItems > 0).length,
      fullyIndexedSystems: systemCoverage.filter((s) => s.fullyIndexed).length,
    },
    growthTimeline,
    downloadTrends: {
      daily,
      runs,
    },
    systemCoverage,
    sizeDistribution: sizeBuckets,
    releaseComposition: {
      tags: queryCompositionStats('release_tags_json'),
      regions: queryCompositionStats('regions_json'),
      languages: queryCompositionStats('languages_json'),
      sources: queryCompositionStats('sources_json'),
    },
  };
}

export function appendActivityLog(
  level: LogLevel,
  message: string,
  detail: string | null = null,
  runId: number | null = null,
): ActivityLogRecord {
  const createdAt = new Date().toISOString();
  const info = getDb().prepare(`
    INSERT INTO activity_logs (run_id, level, message, detail, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(runId, level, message, detail, createdAt);

  // Keep rolling ring buffer of latest 2000 logs
  if (Number(info.lastInsertRowid) % 100 === 0) {
    getDb().prepare(`
      DELETE FROM activity_logs
      WHERE id NOT IN (SELECT id FROM activity_logs ORDER BY id DESC LIMIT 2000)
    `).run();
  }

  return {
    id: Number(info.lastInsertRowid),
    runId,
    level,
    message,
    detail,
    createdAt,
  };
}

export function listActivityLogs(level?: string, limit = 150): ActivityLogRecord[] {
  const clampedLimit = Math.min(500, Math.max(1, limit));
  const rows = level && level !== 'all'
    ? (getDb()
        .prepare('SELECT * FROM activity_logs WHERE level = ? ORDER BY id DESC LIMIT ?')
        .all(level, clampedLimit) as Record<string, unknown>[])
    : (getDb()
        .prepare('SELECT * FROM activity_logs ORDER BY id DESC LIMIT ?')
        .all(clampedLimit) as Record<string, unknown>[]);

  return rows.map((row) => ({
    id: Number(row.id),
    runId: row.run_id !== null ? Number(row.run_id) : null,
    level: String(row.level) as LogLevel,
    message: String(row.message),
    detail: row.detail ? String(row.detail) : null,
    createdAt: String(row.created_at),
  }));
}

export function clearActivityLogs(level?: string): number {
  if (!level || level === 'all') {
    const info = getDb().prepare('DELETE FROM activity_logs').run();
    return info.changes;
  }
  const info = getDb().prepare('DELETE FROM activity_logs WHERE level = ?').run(level);
  return info.changes;
}

export function clearSyncRuns(): number {
  const tx = getDb().transaction(() => {
    const info = getDb().prepare(`DELETE FROM sync_runs WHERE status != 'running'`).run();
    const remaining = getDb().prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };
    if (remaining.count === 0) {
      getDb().prepare(`DELETE FROM sqlite_sequence WHERE name = 'sync_runs'`).run();
    }
    return info.changes;
  });
  return tx();
}

export function deleteRepositoryItemsByIds(ids: number[]): RepositoryItemRecord[] {
  const validIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (validIds.length === 0) return [];

  const placeholders = validIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases WHERE id IN (${placeholders})`)
    .all(...validIds) as Record<string, unknown>[];
  const filesMap = loadFilesByReleaseIds(validIds);
  const items = rows.map((r) => mapReleaseRow(r, filesMap.get(Number(r.id)) || []));

  getDb().prepare(`DELETE FROM catalog_releases WHERE id IN (${placeholders})`).run(...validIds);
  if (releaseRuleIndexCache) {
    for (const id of validIds) {
      releaseRuleIndexCache.delete(id);
    }
  }
  if (items.length > 0) {
    invalidateSystemIndexCursors(items.map((item) => item.systemName));
  }
  return items;
}

export function deleteRepositoryItemsByLocalPaths(absPaths: string[]): number {
  let deleted = 0;
  const affectedReleaseIds = new Set<number>();
  const affectedSystemNames = new Set<string>();

  const tx = getDb().transaction(() => {
    for (const target of absPaths) {
      const normalized = path.resolve(target);
      const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;

      const fileRows = getDb()
        .prepare('SELECT id, release_id FROM catalog_release_files WHERE local_path = ? OR local_path LIKE ?')
        .all(normalized, `${prefix}%`) as { id: number; release_id: number }[];

      for (const fr of fileRows) {
        affectedReleaseIds.add(Number(fr.release_id));
      }

      const relRows = getDb()
        .prepare('SELECT system_name FROM catalog_releases WHERE local_path = ? OR local_path LIKE ?')
        .all(normalized, `${prefix}%`) as { system_name: string }[];
      for (const rr of relRows) {
        if (rr.system_name) affectedSystemNames.add(String(rr.system_name));
      }

      const fileInfo = getDb()
        .prepare('DELETE FROM catalog_release_files WHERE local_path = ? OR local_path LIKE ?')
        .run(normalized, `${prefix}%`);

      const relInfo = getDb()
        .prepare('DELETE FROM catalog_releases WHERE local_path = ? OR local_path LIKE ?')
        .run(normalized, `${prefix}%`);

      deleted += Math.max(fileInfo.changes, relInfo.changes);
    }

    for (const releaseId of affectedReleaseIds) {
      const remaining = getDb()
        .prepare('SELECT COUNT(*) as count FROM catalog_release_files WHERE release_id = ?')
        .get(releaseId) as { count: number };
      if (remaining.count === 0) {
        const deletedRelease = getDb()
          .prepare('SELECT system_name FROM catalog_releases WHERE id = ?')
          .get(releaseId) as { system_name?: string } | undefined;
        if (deletedRelease?.system_name) {
          affectedSystemNames.add(String(deletedRelease.system_name));
        }
        getDb().prepare('DELETE FROM catalog_releases WHERE id = ?').run(releaseId);
      } else {
        recomputeReleaseRollup(releaseId);
      }
    }
  });

  tx();
  invalidateReleaseFileRolesCache();
  if (affectedSystemNames.size > 0) {
    invalidateSystemIndexCursors(Array.from(affectedSystemNames));
  }
  return deleted;
}

export function acquireDistributedLock(lockName: string, holderId: string, ttlSeconds = 120): boolean {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
  const nowIso = now.toISOString();

  const tx = getDb().transaction(() => {
    getDb().prepare('DELETE FROM distributed_locks WHERE expires_at <= ?').run(nowIso);
    const existing = getDb()
      .prepare('SELECT holder_id FROM distributed_locks WHERE lock_name = ?')
      .get(lockName) as { holder_id: string } | undefined;

    if (!existing) {
      getDb().prepare(`
        INSERT INTO distributed_locks (lock_name, holder_id, acquired_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(lockName, holderId, nowIso, expiresAt);
      return true;
    }

    if (existing.holder_id === holderId) {
      getDb().prepare(`
        UPDATE distributed_locks SET expires_at = ? WHERE lock_name = ? AND holder_id = ?
      `).run(expiresAt, lockName, holderId);
      return true;
    }

    return false;
  });

  return tx();
}

export function releaseDistributedLock(lockName: string, holderId: string): void {
  getDb().prepare('DELETE FROM distributed_locks WHERE lock_name = ? AND holder_id = ?').run(lockName, holderId);
}

const SYSTEM_DEFAULT_ROM_EXT: Record<string, string> = {
  'nes-roms': '.nes',
  'famicom-disk-system': '.fds',
  'snes-roms': '.sfc',
  'n64-roms': '.z64',
  'gb-roms': '.gb',
  'gbc-roms': '.gbc',
  'gba-roms': '.gba',
  'nds-roms': '.nds',
  '3ds-roms': '.3ds',
  'genesis-roms': '.md',
  'sms-roms': '.sms',
  'game-gear': '.gg',
  'sega-32x-roms': '.32x',
  'sega-cd-isos': '.chd',
  'saturn-isos': '.chd',
  'dreamcast-isos': '.chd',
  'psx-iso': '.chd',
  'ps2-isos': '.chd',
  'psp-isos': '.iso',
  'gamecube-isos': '.rvz',
  'wii-isos': '.rvz',
  'turbografx-16': '.pce',
  'turbografx-cd': '.chd',
  'wonderswan': '.wsc',
  'neo-geo-pocket': '.ngc',
  'atari-2600-roms': '.a26',
  'atari-7800-roms': '.a78',
  'atari-lynx': '.lnx',
  'msx-roms': '.rom',
};

function guessRomExtensionForSample(systemSlug: string, filename?: string | null): string {
  const lower = (filename || '').trim().toLowerCase();
  const romExtMatch = lower.match(
    /\.(nes|fds|sfc|smc|gb|gbc|gba|nds|3ds|cia|z64|n64|v64|md|gen|32x|sms|gg|pce|ngc|ngp|ws|wsc|chd|iso|rvz|cso|pbp|a26|a52|a78|lnx|rom|bin)$/i,
  );
  if (romExtMatch?.[1]) {
    return `.${romExtMatch[1].toLowerCase()}`;
  }
  const canonical = canonicalizeSystemSlug(systemSlug).toLowerCase();
  return SYSTEM_DEFAULT_ROM_EXT[canonical] || '.rom';
}

function safeParseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

/**
 * Picks up to one representative real indexed catalog release per ROM type for
 * Step 02's live preview matrix ("Real Catalog Games" mode). Accepts a rotation seed
 * so clicking Shuffle cycles cleanly across available candidates per type.
 */
export function getCatalogNamingPreviewSamples(seed = 0): {
  samples: Partial<Record<RomNamingTypeKey, RomNamingPreviewSample>>;
  candidateCounts: Partial<Record<RomNamingTypeKey, number>>;
} {
  const safeSeed = Number.isFinite(seed) ? Math.max(0, Math.floor(seed)) : 0;

  const rows = getDb()
    .prepare(`
      SELECT
        r.id,
        r.title,
        r.system_name,
        r.release_type,
        r.release_tags_json,
        r.regions_json,
        r.languages_json,
        r.status,
        (
          SELECT f.filename
          FROM catalog_release_files f
          WHERE f.release_id = r.id
          ORDER BY CASE WHEN f.status = 'downloaded' THEN 0 ELSE 1 END, f.id ASC
          LIMIT 1
        ) AS primary_filename,
        (
          SELECT f.display_label
          FROM catalog_release_files f
          WHERE f.release_id = r.id
          ORDER BY CASE WHEN f.status = 'downloaded' THEN 0 ELSE 1 END, f.id ASC
          LIMIT 1
        ) AS primary_label,
        (
          SELECT f.file_role
          FROM catalog_release_files f
          WHERE f.release_id = r.id
          ORDER BY CASE WHEN f.status = 'downloaded' THEN 0 ELSE 1 END, f.id ASC
          LIMIT 1
        ) AS primary_role
      FROM catalog_releases r
      WHERE r.title IS NOT NULL AND TRIM(r.title) != ''
      ORDER BY
        CASE WHEN r.status = 'downloaded' THEN 0 ELSE 1 END,
        COALESCE(r.downloaded_at, r.discovered_at) DESC,
        r.id DESC
      LIMIT 1200
    `)
    .all() as Array<{
    id: number;
    title: string;
    system_name: string;
    release_type: string;
    release_tags_json: string;
    regions_json: string;
    languages_json: string;
    status: string;
    primary_filename: string | null;
    primary_label: string | null;
    primary_role: string | null;
  }>;

  const buckets = new Map<RomNamingTypeKey, RomNamingPreviewSample[]>();
  const previewSet = new Set<RomNamingTypeKey>(ROM_NAMING_PREVIEW_TYPE_KEYS);

  for (const row of rows) {
    const releaseTags = safeParseJsonStringArray(row.release_tags_json);
    const regions = safeParseJsonStringArray(row.regions_json);
    const languages = safeParseJsonStringArray(row.languages_json);
    const fileRole = (row.primary_role || row.release_type || '').trim();
    const archiveFilename = (row.primary_filename || '').trim();
    const displayLabel = (row.primary_label || '').trim();

    const context = {
      title: String(row.title).trim(),
      systemName: String(row.system_name || '').trim(),
      regions,
      languages,
      releaseTags,
      fileRole,
      archiveFilename: archiveFilename || undefined,
      displayLabel: displayLabel || undefined,
      innerFilename: archiveFilename || undefined,
    };

    const typeKey = classifyRomNamingType(context);
    if (!previewSet.has(typeKey)) continue;

    let list = buckets.get(typeKey);
    if (!list) {
      list = [];
      buckets.set(typeKey, list);
    }
    if (list.length >= 20) continue;

    const sysInfo = resolveSystemDisplayInfo(context.systemName);
    const shortParenMatch = sysInfo.displayName.match(/\(([^)]+)\)$/);
    const conciseSystemLabel = shortParenMatch?.[1] || sysInfo.displayName;
    list.push({
      typeKey,
      source: 'catalog',
      itemId: Number(row.id),
      systemLabel: conciseSystemLabel,
      extension: guessRomExtensionForSample(context.systemName, archiveFilename),
      context,
    });
  }

  const samples: Partial<Record<RomNamingTypeKey, RomNamingPreviewSample>> = {};
  const candidateCounts: Partial<Record<RomNamingTypeKey, number>> = {};

  for (const typeKey of ROM_NAMING_PREVIEW_TYPE_KEYS) {
    const list = buckets.get(typeKey);
    if (list && list.length > 0) {
      candidateCounts[typeKey] = list.length;
      samples[typeKey] = list[safeSeed % list.length]!;
    } else {
      candidateCounts[typeKey] = 0;
    }
  }

  return { samples, candidateCounts };
}

