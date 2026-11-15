import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';
import type {
  ActivityLogRecord,
  CatalogFacets,
  ConfigUpdateInput,
  FileItemStatus,
  ItemStatus,
  LogLevel,
  ReleaseFileRecord,
  ReleaseMetadata,
  RepositoryItemRecord,
  RunMode,
  RunStatus,
  RunTrigger,
  ScraperConfigInternal,
  ScraperConfigPublic,
  SyncRunRecord,
  SystemBreakdown,
} from './types.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || '/run/repo');
const DEFAULT_DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || path.join(DATA_DIR, 'repository'));
const DB_PATH = path.join(DATA_DIR, 'scraper.db');
const KEY_PATH = path.join(DATA_DIR, '.keyfile');

let db: Database.Database | null = null;
let cachedKey: Buffer | null = null;

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

export function initDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Migrate existing workspace ./data state once when moving to default /run/repo
  const legacyDataDir = path.resolve('./data');
  if (
    DATA_DIR === '/run/repo' &&
    legacyDataDir !== DATA_DIR &&
    !fs.existsSync(DB_PATH) &&
    fs.existsSync(path.join(legacyDataDir, 'scraper.db'))
  ) {
    try {
      fs.cpSync(legacyDataDir, DATA_DIR, { recursive: true, force: false });
    } catch {
      // Proceed with clean database initialization if legacy migration cannot copy
    }
  }

  fs.mkdirSync(DEFAULT_DOWNLOAD_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

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
      user_agent TEXT NOT NULL DEFAULT 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
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

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id, base_url, login_url, download_dir FROM scraper_config WHERE id = 1').get() as
    | { id: number; base_url: string; login_url: string; download_dir: string }
    | undefined;
  if (!existing) {
    db.prepare(`
      INSERT INTO scraper_config (
        id, base_url, login_url, username, password_enc, download_dir,
        cron_schedule, schedule_enabled, base_delay_ms, min_delay_ms, max_delay_ms,
        backoff_multiplier, max_retries, max_concurrency, request_timeout_ms,
        user_agent, system_filter, last_watermark_at, updated_at
      ) VALUES (
        1, ?, ?, ?, ?, ?, ?, 0, 1500, 750, 60000, 2.0, 5, 1, 30000, ?, ?, NULL, ?
      )
    `).run(
      process.env.RGT_BASE_URL || 'https://retrogametalk.com/repo/',
      process.env.RGT_LOGIN_URL || 'https://retrogametalk.com/login/',
      process.env.RGT_USERNAME || '',
      process.env.RGT_PASSWORD ? encryptSecret(process.env.RGT_PASSWORD) : '',
      DEFAULT_DOWNLOAD_DIR,
      process.env.CRON_SCHEDULE || '0 */6 * * *',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      process.env.SCRAPER_SYSTEM_FILTER || '',
      now,
    );
  } else {
    if (existing.base_url === 'https://retrogametalk.com/repository/') {
      db.prepare('UPDATE scraper_config SET base_url = ? WHERE id = 1').run('https://retrogametalk.com/repo/');
    }
    if (existing.login_url === 'https://retrogametalk.com/wp-login.php') {
      db.prepare('UPDATE scraper_config SET login_url = ? WHERE id = 1').run('https://retrogametalk.com/login/');
    }
    db.prepare(
      'UPDATE scraper_config SET user_agent = ? WHERE id = 1 AND user_agent IN (?, ?)',
    ).run(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );
    const legacyDownloadDir = path.resolve('./data/repository');
    if (DATA_DIR === '/run/repo' && path.resolve(existing.download_dir) === legacyDownloadDir) {
      db.prepare('UPDATE scraper_config SET download_dir = ? WHERE id = 1').run(DEFAULT_DOWNLOAD_DIR);
    }
  }

  const cols = db.prepare('PRAGMA table_info(scraper_config)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'discovered_systems_json')) {
    db.prepare(`ALTER TABLE scraper_config ADD COLUMN discovered_systems_json TEXT NOT NULL DEFAULT '[]'`).run();
  }
  if (!cols.some((c) => c.name === 'last_authenticated_at')) {
    db.prepare(`ALTER TABLE scraper_config ADD COLUMN last_authenticated_at TEXT`).run();
  }

  // Cleanly reset legacy flat catalog index so the next sync imports grouped release entries + WP tags
  if (hadLegacyItemsTable) {
    db.prepare('DROP TABLE IF EXISTS repository_items').run();
    db.prepare('UPDATE scraper_config SET last_watermark_at = NULL WHERE id = 1').run();
  }

  // Recover any stale running jobs left behind by an abrupt container kill
  db.prepare(`
    UPDATE sync_runs
    SET status = 'stopped', finished_at = ?, error_summary = COALESCE(error_summary, 'Interrupted by process restart')
    WHERE status = 'running'
  `).run(now);

  db.prepare(`
    UPDATE catalog_release_files
    SET status = 'failed', error_message = COALESCE(error_message, 'Interrupted by process restart')
    WHERE status = 'downloading'
  `).run();

  db.prepare(`
    UPDATE catalog_releases
    SET status = 'failed', error_message = COALESCE(error_message, 'Interrupted by process restart')
    WHERE status = 'downloading'
  `).run();

  const remainingRuns = db.prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };
  if (remainingRuns.count === 0) {
    db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'sync_runs'`).run();
  }

  return db;
}

function getDb(): Database.Database {
  return db || initDb();
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
  let baseDelayMs = Number(row.base_delay_ms);
  let minDelayMs = Number(row.min_delay_ms);
  let maxDelayMs = Number(row.max_delay_ms);
  let backoffMultiplier = Number(row.backoff_multiplier);
  let maxRetries = Number(row.max_retries);
  let maxConcurrency = Number(row.max_concurrency);
  let requestTimeoutMs = Number(row.request_timeout_ms);
  let userAgent = String(row.user_agent);

  if (process.env.SCRAPER_SCHEDULE_ENABLED !== undefined && process.env.SCRAPER_SCHEDULE_ENABLED !== '') {
    scheduleEnabled = process.env.SCRAPER_SCHEDULE_ENABLED === 'true' || process.env.SCRAPER_SCHEDULE_ENABLED === '1';
    envOverrides.push('SCRAPER_SCHEDULE_ENABLED');
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
      discoveredSystems = parsed.map(String).filter(Boolean);
    }
  } catch {
    discoveredSystems = [];
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
    requestTimeoutMs,
    userAgent,
    systemFilter,
    discoveredSystems,
    lastWatermarkAt: row.last_watermark_at ? String(row.last_watermark_at) : null,
    updatedAt: String(row.updated_at),
    envOverrides,
  };
}

export function getPublicConfig(): ScraperConfigPublic {
  return getInternalConfig();
}

export function saveDiscoveredSystems(systems: string[]): string[] {
  const merged = Array.from(
    new Set(
      [...getInternalConfig().discoveredSystems, ...systems]
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));

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
  const nextPasswordEnc = input.password !== undefined
    ? (input.password === '' ? '' : encryptSecret(input.password))
    : String(current.password_enc || '');

  const currentPasswordPlain = decryptSecret(String(current.password_enc || ''));
  const authCredentialsChanged =
    nextBaseUrl !== String(current.base_url).trim() ||
    nextLoginUrl !== String(current.login_url).trim() ||
    nextUsername !== String(current.username || '').trim() ||
    (input.password !== undefined && input.password !== currentPasswordPlain);

  const minDelay = Math.max(250, Math.min(30000, Number(input.minDelayMs ?? current.min_delay_ms)));
  const maxDelay = Math.max(minDelay, Math.min(300000, Number(input.maxDelayMs ?? current.max_delay_ms)));
  const baseDelay = Math.max(minDelay, Math.min(maxDelay, Number(input.baseDelayMs ?? current.base_delay_ms)));

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
      request_timeout_ms = ?,
      user_agent = ?,
      system_filter = ?,
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
    Math.max(5000, Math.min(180000, Number(input.requestTimeoutMs ?? current.request_timeout_ms))),
    (input.userAgent ?? String(current.user_agent)).trim(),
    (input.systemFilter ?? String(current.system_filter)).trim(),
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

export function createSyncRun(triggerType: RunTrigger, mode: RunMode): SyncRunRecord {
  const startedAt = new Date().toISOString();
  const info = getDb().prepare(`
    INSERT INTO sync_runs (trigger_type, mode, status, started_at)
    VALUES (?, ?, 'running', ?)
  `).run(triggerType, mode, startedAt);

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
  }>,
): SyncRunRecord | null {
  const existing = getSyncRunById(id);
  if (!existing) return null;

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
      error_summary = ?
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
    id,
  );

  return getSyncRunById(id);
}

export function listSyncRuns(limit = 25): SyncRunRecord[] {
  const rows = getDb().prepare('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?').all(limit) as Record<string, unknown>[];
  return rows.map(mapRunRow);
}

function mapRunRow(row: Record<string, unknown>): SyncRunRecord {
  return {
    id: Number(row.id),
    triggerType: String(row.trigger_type) as RunTrigger,
    mode: String(row.mode) as RunMode,
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

function mapReleaseRow(row: Record<string, unknown>, files: ReleaseFileRecord[]): RepositoryItemRecord {
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
    publishedAt: row.published_at ? String(row.published_at) : null,
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
    filesCount: files.length,
    files,
  };
}

function loadFilesByReleaseIds(releaseIds: number[]): Map<number, ReleaseFileRecord[]> {
  const map = new Map<number, ReleaseFileRecord[]>();
  if (releaseIds.length === 0) return map;
  const placeholders = releaseIds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT * FROM catalog_release_files WHERE release_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...releaseIds) as Record<string, unknown>[];
  for (const row of rows) {
    const file = mapFileRow(row);
    const list = map.get(file.releaseId) || [];
    list.push(file);
    map.set(file.releaseId, list);
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
  let skippedCount = 0;
  let failedCount = 0;
  let downloadingCount = 0;
  let firstError: string | null = null;
  let latestDownloadedAt: string | null = row.downloaded_at ? String(row.downloaded_at) : null;

  for (const file of files) {
    if (file.fileSizeBytes > 0) totalBytes += file.fileSizeBytes;
    if (file.status === 'downloaded') downloadedCount += 1;
    else if (file.status === 'skipped') skippedCount += 1;
    else if (file.status === 'failed') {
      failedCount += 1;
      if (!firstError && file.errorMessage) firstError = `${file.filename}: ${file.errorMessage}`;
    } else if (file.status === 'downloading') {
      downloadingCount += 1;
    }
    if (file.downloadedAt && (!latestDownloadedAt || file.downloadedAt > latestDownloadedAt)) {
      latestDownloadedAt = file.downloadedAt;
    }
  }

  let status: ItemStatus = String(row.status) as ItemStatus;
  if (files.length > 0) {
    if (downloadingCount > 0) status = 'downloading';
    else if (failedCount === files.length) status = 'failed';
    else if (failedCount > 0 || downloadedCount + skippedCount < files.length) {
      status = downloadedCount + skippedCount > 0 ? 'partial' : 'queued';
    } else if (skippedCount === files.length) {
      status = 'skipped';
    } else {
      status = 'downloaded';
    }
  }

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
      status = ?,
      error_message = ?,
      downloaded_at = ?,
      metadata_json = ?
    WHERE id = ?
  `).run(
    primaryType,
    JSON.stringify(releaseTags),
    totalBytes,
    status,
    failedCount > 0 ? firstError || `${failedCount} file transfer(s) failed` : null,
    latestDownloadedAt,
    metadataJson,
    releaseId,
  );

  return getCatalogReleaseById(releaseId);
}

export function upsertCatalogRelease(input: {
  remoteUrl: string;
  remotePath: string;
  localPath: string;
  systemName: string;
  title: string;
  publishedAt?: string | null;
  status?: ItemStatus;
  lastRunId?: number | null;
  metadata?: ReleaseMetadata | null;
  coverLocalPath?: string | null;
  screenshotLocalPaths?: string[];
}): RepositoryItemRecord {
  const canonicalUrl = input.remoteUrl.split('#')[0];
  const now = new Date().toISOString();
  const meta = input.metadata ?? null;

  const genres = meta?.genres || [];
  const regions = meta?.regions || [];
  const languages = meta?.languages || [];
  const sources = meta?.sources || [];
  const releaseTags =
    meta?.releaseTags && meta.releaseTags.length > 0
      ? meta.releaseTags
      : deriveReleaseTags({ genres, languages, sources, systemName: input.systemName }, []);
  const primaryType = releaseTags[0] || 'Retail ROM';

  const wpPostId = meta?.wpPostId ?? null;
  const wpPostType = meta?.wpPostType ?? null;
  const publisher = meta?.publisher ?? null;
  const developer = meta?.developer ?? null;
  const releaseYear = meta?.releaseYear ?? null;
  const genresJson = meta ? JSON.stringify(genres) : null;
  const regionsJson = meta ? JSON.stringify(regions) : null;
  const languagesJson = meta ? JSON.stringify(languages) : null;
  const sourcesJson = meta ? JSON.stringify(sources) : null;
  const tagsJson = JSON.stringify(releaseTags);
  const coverLocalPath = input.coverLocalPath ?? null;
  const screenshotsJson = input.screenshotLocalPaths ? JSON.stringify(input.screenshotLocalPaths) : null;
  const metadataJson = meta ? JSON.stringify({ ...meta, releaseTags }) : null;

  getDb().prepare(`
    INSERT INTO catalog_releases (
      remote_url, wp_post_id, wp_post_type, remote_path, local_path, system_name,
      release_type, release_tags_json, title, published_at, status, last_run_id, discovered_at,
      publisher, developer, release_year, genres_json, regions_json, languages_json, sources_json,
      cover_local_path, screenshots_json, metadata_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?,
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
    input.systemName,
    primaryType,
    tagsJson,
    input.title,
    input.publishedAt ?? null,
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

export function upsertReleaseFile(input: {
  releaseId: number;
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
    const byUrl = conn
      .prepare('SELECT id FROM catalog_release_files WHERE remote_url = ?')
      .get(input.remoteUrl) as { id: number } | undefined;
    const byName = conn
      .prepare('SELECT id FROM catalog_release_files WHERE release_id = ? AND filename = ?')
      .get(input.releaseId, input.filename) as { id: number } | undefined;

    const targetId = byUrl?.id ?? byName?.id ?? null;
    if (byUrl && byName && byUrl.id !== byName.id) {
      conn.prepare('DELETE FROM catalog_release_files WHERE id = ?').run(byName.id);
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
          downloaded_at = COALESCE(?, downloaded_at)
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

  const genres = metadata.genres || [];
  const regions = metadata.regions || [];
  const languages = metadata.languages || [];
  const sources = metadata.sources || [];

  const tx = getDb().transaction(() => {
    getDb().prepare(`
      UPDATE catalog_releases SET
        wp_post_id = COALESCE(?, wp_post_id),
        wp_post_type = COALESCE(?, wp_post_type),
        title = COALESCE(NULLIF(?, ''), title),
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
      metadata.wpPostId ?? null,
      metadata.wpPostType ?? null,
      metadata.title,
      metadata.publisher ?? null,
      metadata.developer ?? null,
      metadata.releaseYear ?? null,
      JSON.stringify(genres),
      JSON.stringify(regions),
      JSON.stringify(languages),
      JSON.stringify(sources),
      coverLocalPath,
      JSON.stringify(screenshotLocalPaths),
      JSON.stringify(metadata),
      id,
    );

    // Reclassify child file roles using the refreshed RGT taxonomy context
    for (const file of existing.files) {
      const nextRole = classifyFileRole(file.filename, file.displayLabel, {
        genres,
        languages,
        sources,
        title: metadata.title,
        systemName: existing.systemName,
      });
      getDb().prepare('UPDATE catalog_release_files SET file_role = ? WHERE id = ?').run(nextRole, file.id);
    }
  });

  tx();
  return recomputeReleaseRollup(id);
}

export function getCatalogReleaseById(id: number): RepositoryItemRecord | null {
  const row = getDb().prepare('SELECT * FROM catalog_releases WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  const filesMap = loadFilesByReleaseIds([Number(row.id)]);
  return mapReleaseRow(row, filesMap.get(Number(row.id)) || []);
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
  const filesMap = loadFilesByReleaseIds([Number(row.id)]);
  return mapReleaseRow(row, filesMap.get(Number(row.id)) || []);
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

export function countSiblingItemsInDir(dirPath: string): number {
  const normalized = path.resolve(dirPath);
  const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
  const row = getDb()
    .prepare('SELECT COUNT(*) as count FROM catalog_release_files WHERE local_path LIKE ?')
    .get(`${prefix}%`) as { count: number };
  return Number(row.count || 0);
}

function listDistinctJsonFacet(
  columnName: 'release_tags_json' | 'genres_json' | 'regions_json' | 'languages_json' | 'sources_json',
): string[] {
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT je.value as val FROM catalog_releases, json_each(${columnName}) as je WHERE je.value IS NOT NULL AND je.value != '' ORDER BY je.value ASC`,
    )
    .all() as { val: string }[];
  return rows.map((r) => String(r.val));
}

export function queryRepositoryItems(params: {
  search?: string;
  system?: string;
  status?: string;
  tag?: string;
  genre?: string;
  region?: string;
  language?: string;
  limit?: number;
  offset?: number;
}): { items: RepositoryItemRecord[]; total: number; facets: CatalogFacets } {
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
  if (params.system && params.system !== 'all') {
    conditions.push('system_name = ?');
    args.push(params.system);
  }
  if (params.status && params.status !== 'all') {
    conditions.push('status = ?');
    args.push(params.status);
  }
  if (params.tag && params.tag !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM json_each(release_tags_json) WHERE value = ?)');
    args.push(params.tag);
  }
  if (params.genre && params.genre !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM json_each(genres_json) WHERE value = ?)');
    args.push(params.genre);
  }
  if (params.region && params.region !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM json_each(regions_json) WHERE value = ?)');
    args.push(params.region);
  }
  if (params.language && params.language !== 'all') {
    conditions.push('EXISTS (SELECT 1 FROM json_each(languages_json) WHERE value = ?)');
    args.push(params.language);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  const countRow = getDb().prepare(`SELECT COUNT(*) as count FROM catalog_releases ${where}`).get(...args) as {
    count: number;
  };
  const rows = getDb()
    .prepare(`SELECT * FROM catalog_releases ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Record<string, unknown>[];

  const releaseIds = rows.map((r) => Number(r.id));
  const filesMap = loadFilesByReleaseIds(releaseIds);

  const facets: CatalogFacets = {
    tags: listDistinctJsonFacet('release_tags_json'),
    genres: listDistinctJsonFacet('genres_json'),
    regions: listDistinctJsonFacet('regions_json'),
    languages: listDistinctJsonFacet('languages_json'),
    sources: listDistinctJsonFacet('sources_json'),
  };

  return {
    items: rows.map((r) => mapReleaseRow(r, filesMap.get(Number(r.id)) || [])),
    total: Number(countRow.count),
    facets,
  };
}

export function getCatalogTotalsAndSystems(): {
  totals: {
    totalCatalogItems: number;
    downloadedItems: number;
    skippedItems: number;
    failedItems: number;
    totalBytesMirrored: number;
    totalRuns: number;
  };
  systems: SystemBreakdown[];
} {
  const totalsRow = getDb().prepare(`
    SELECT
      COUNT(*) as total_items,
      SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_items,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_items,
      SUM(CASE WHEN status IN ('failed', 'partial') THEN 1 ELSE 0 END) as failed_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped', 'partial') THEN file_size_bytes ELSE 0 END), 0) as total_bytes
    FROM catalog_releases
  `).get() as Record<string, unknown>;

  const runsRow = getDb().prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };

  const systemRows = getDb().prepare(`
    SELECT
      system_name,
      COUNT(*) as total_items,
      SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_items,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_items,
      SUM(CASE WHEN status IN ('failed', 'partial') THEN 1 ELSE 0 END) as failed_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped', 'partial') THEN file_size_bytes ELSE 0 END), 0) as total_bytes
    FROM catalog_releases
    GROUP BY system_name
    ORDER BY total_items DESC, system_name ASC
  `).all() as Record<string, unknown>[];

  return {
    totals: {
      totalCatalogItems: Number(totalsRow.total_items || 0),
      downloadedItems: Number(totalsRow.downloaded_items || 0),
      skippedItems: Number(totalsRow.skipped_items || 0),
      failedItems: Number(totalsRow.failed_items || 0),
      totalBytesMirrored: Number(totalsRow.total_bytes || 0),
      totalRuns: Number(runsRow.count || 0),
    },
    systems: systemRows.map((r) => ({
      systemName: String(r.system_name),
      totalItems: Number(r.total_items),
      downloadedItems: Number(r.downloaded_items),
      skippedItems: Number(r.skipped_items),
      failedItems: Number(r.failed_items),
      totalBytes: Number(r.total_bytes),
    })),
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
  return items;
}

export function deleteRepositoryItemsByLocalPaths(absPaths: string[]): number {
  let deleted = 0;
  const affectedReleaseIds = new Set<number>();

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
        getDb().prepare('DELETE FROM catalog_releases WHERE id = ?').run(releaseId);
      } else {
        recomputeReleaseRollup(releaseId);
      }
    }
  });

  tx();
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
