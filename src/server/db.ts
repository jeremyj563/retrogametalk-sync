import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  ActivityLogRecord,
  ConfigUpdateInput,
  ItemStatus,
  LogLevel,
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
      user_agent TEXT NOT NULL DEFAULT 'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
      system_filter TEXT NOT NULL DEFAULT '',
      discovered_systems_json TEXT NOT NULL DEFAULT '[]',
      last_watermark_at TEXT,
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

    CREATE TABLE IF NOT EXISTS repository_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      remote_url TEXT NOT NULL UNIQUE,
      download_url TEXT NOT NULL,
      remote_path TEXT NOT NULL,
      local_path TEXT NOT NULL,
      filename TEXT NOT NULL,
      system_name TEXT NOT NULL,
      release_type TEXT NOT NULL DEFAULT 'rom',
      title TEXT NOT NULL,
      file_size_bytes INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      last_run_id INTEGER,
      discovered_at TEXT NOT NULL,
      downloaded_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_items_system ON repository_items(system_name);
    CREATE INDEX IF NOT EXISTS idx_items_status ON repository_items(status);
    CREATE INDEX IF NOT EXISTS idx_items_filename ON repository_items(filename);

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
      'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
      process.env.SCRAPER_SYSTEM_FILTER || '',
      now,
    );
  } else {
    // Migrate legacy placeholder URLs to live RetroGameTalk XenForo/Repo endpoints
    if (existing.base_url === 'https://retrogametalk.com/repository/') {
      db.prepare('UPDATE scraper_config SET base_url = ? WHERE id = 1').run('https://retrogametalk.com/repo/');
    }
    if (
      existing.login_url === 'https://retrogametalk.com/wp-login.php' ||
      existing.login_url === 'https://retrogametalk.com/login/login'
    ) {
      db.prepare('UPDATE scraper_config SET login_url = ? WHERE id = 1').run('https://retrogametalk.com/login/');
    }
    const legacyDownloadDir = path.resolve('./data/repository');
    if (DATA_DIR === '/run/repo' && path.resolve(existing.download_dir) === legacyDownloadDir) {
      db.prepare('UPDATE scraper_config SET download_dir = ? WHERE id = 1').run(DEFAULT_DOWNLOAD_DIR);
    }
  }

  // Ensure discovered_systems_json column exists for existing databases
  const cols = db.prepare('PRAGMA table_info(scraper_config)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'discovered_systems_json')) {
    db.prepare(`ALTER TABLE scraper_config ADD COLUMN discovered_systems_json TEXT NOT NULL DEFAULT '[]'`).run();
  }

  // Recover any stale running jobs left behind by an abrupt container kill
  db.prepare(`
    UPDATE sync_runs
    SET status = 'stopped', finished_at = ?, error_summary = COALESCE(error_summary, 'Interrupted by process restart')
    WHERE status = 'running'
  `).run(now);

  db.prepare(`
    UPDATE repository_items
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

export function updateConfig(input: ConfigUpdateInput): ScraperConfigPublic {
  const current = getDb().prepare('SELECT * FROM scraper_config WHERE id = 1').get() as Record<string, unknown>;
  const now = new Date().toISOString();

  const nextDownloadDir = input.downloadDir !== undefined
    ? path.resolve(input.downloadDir.trim() || DEFAULT_DOWNLOAD_DIR)
    : String(current.download_dir);

  fs.mkdirSync(nextDownloadDir, { recursive: true });

  const nextPasswordEnc = input.password !== undefined
    ? (input.password === '' ? '' : encryptSecret(input.password))
    : String(current.password_enc || '');

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
      updated_at = ?
    WHERE id = 1
  `).run(
    (input.baseUrl ?? String(current.base_url)).trim(),
    (input.loginUrl ?? String(current.login_url)).trim(),
    (input.username ?? String(current.username)).trim(),
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
    now,
  );

  return getPublicConfig();
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

export function upsertRepositoryItem(item: {
  remoteUrl: string;
  downloadUrl: string;
  remotePath: string;
  localPath: string;
  filename: string;
  systemName: string;
  releaseType: string;
  title: string;
  fileSizeBytes?: number;
  publishedAt?: string | null;
  status: ItemStatus;
  errorMessage?: string | null;
  lastRunId?: number | null;
  downloadedAt?: string | null;
}): RepositoryItemRecord {
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO repository_items (
      remote_url, download_url, remote_path, local_path, filename, system_name,
      release_type, title, file_size_bytes, published_at, status, error_message,
      last_run_id, discovered_at, downloaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(remote_url) DO UPDATE SET
      download_url = excluded.download_url,
      remote_path = excluded.remote_path,
      local_path = excluded.local_path,
      filename = excluded.filename,
      system_name = excluded.system_name,
      release_type = excluded.release_type,
      title = excluded.title,
      file_size_bytes = CASE WHEN excluded.file_size_bytes > 0 THEN excluded.file_size_bytes ELSE repository_items.file_size_bytes END,
      published_at = COALESCE(excluded.published_at, repository_items.published_at),
      status = excluded.status,
      error_message = excluded.error_message,
      last_run_id = COALESCE(excluded.last_run_id, repository_items.last_run_id),
      downloaded_at = COALESCE(excluded.downloaded_at, repository_items.downloaded_at)
  `).run(
    item.remoteUrl,
    item.downloadUrl,
    item.remotePath,
    item.localPath,
    item.filename,
    item.systemName,
    item.releaseType,
    item.title,
    item.fileSizeBytes ?? 0,
    item.publishedAt ?? null,
    item.status,
    item.errorMessage ?? null,
    item.lastRunId ?? null,
    now,
    item.downloadedAt ?? null,
  );

  const row = getDb().prepare('SELECT * FROM repository_items WHERE remote_url = ?').get(item.remoteUrl) as Record<string, unknown>;
  return mapItemRow(row);
}

export function getRepositoryItemById(id: number): RepositoryItemRecord | null {
  const row = getDb().prepare('SELECT * FROM repository_items WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? mapItemRow(row) : null;
}

export function getRepositoryItemByRemoteUrl(remoteUrl: string): RepositoryItemRecord | null {
  const row = getDb().prepare('SELECT * FROM repository_items WHERE remote_url = ?').get(remoteUrl) as Record<string, unknown> | undefined;
  return row ? mapItemRow(row) : null;
}

export function queryRepositoryItems(params: {
  search?: string;
  system?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): { items: RepositoryItemRecord[]; total: number } {
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim()}%`;
    conditions.push('(title LIKE ? OR filename LIKE ? OR remote_path LIKE ? OR system_name LIKE ?)');
    args.push(q, q, q, q);
  }
  if (params.system && params.system !== 'all') {
    conditions.push('system_name = ?');
    args.push(params.system);
  }
  if (params.status && params.status !== 'all') {
    conditions.push('status = ?');
    args.push(params.status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);

  const countRow = getDb().prepare(`SELECT COUNT(*) as count FROM repository_items ${where}`).get(...args) as { count: number };
  const rows = getDb()
    .prepare(`SELECT * FROM repository_items ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Record<string, unknown>[];

  return {
    items: rows.map(mapItemRow),
    total: Number(countRow.count),
  };
}

function mapItemRow(row: Record<string, unknown>): RepositoryItemRecord {
  return {
    id: Number(row.id),
    remoteUrl: String(row.remote_url),
    downloadUrl: String(row.download_url),
    remotePath: String(row.remote_path),
    localPath: String(row.local_path),
    filename: String(row.filename),
    systemName: String(row.system_name),
    releaseType: String(row.release_type),
    title: String(row.title),
    fileSizeBytes: Number(row.file_size_bytes),
    publishedAt: row.published_at ? String(row.published_at) : null,
    status: String(row.status) as ItemStatus,
    errorMessage: row.error_message ? String(row.error_message) : null,
    lastRunId: row.last_run_id !== null ? Number(row.last_run_id) : null,
    discoveredAt: String(row.discovered_at),
    downloadedAt: row.downloaded_at ? String(row.downloaded_at) : null,
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
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped') THEN file_size_bytes ELSE 0 END), 0) as total_bytes
    FROM repository_items
  `).get() as Record<string, unknown>;

  const runsRow = getDb().prepare('SELECT COUNT(*) as count FROM sync_runs').get() as { count: number };

  const systemRows = getDb().prepare(`
    SELECT
      system_name,
      COUNT(*) as total_items,
      SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded_items,
      SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped_items,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_items,
      COALESCE(SUM(CASE WHEN status IN ('downloaded', 'skipped') THEN file_size_bytes ELSE 0 END), 0) as total_bytes
    FROM repository_items
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
    .prepare(`SELECT * FROM repository_items WHERE id IN (${placeholders})`)
    .all(...validIds) as Record<string, unknown>[];
  const items = rows.map(mapItemRow);

  getDb().prepare(`DELETE FROM repository_items WHERE id IN (${placeholders})`).run(...validIds);
  return items;
}

export function deleteRepositoryItemsByLocalPaths(absPaths: string[]): number {
  let deleted = 0;
  const tx = getDb().transaction(() => {
    for (const target of absPaths) {
      const normalized = path.resolve(target);
      const prefix = normalized.endsWith(path.sep) ? normalized : normalized + path.sep;
      const info = getDb()
        .prepare('DELETE FROM repository_items WHERE local_path = ? OR local_path LIKE ?')
        .run(normalized, `${prefix}%`);
      deleted += info.changes;
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
