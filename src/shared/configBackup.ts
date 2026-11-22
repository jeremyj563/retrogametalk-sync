import type { ConfigUpdateInput, ScraperConfigPublic } from '../server/types.ts';
import {
  canonicalStorageFolderConfigJson,
  normalizeStorageFolderConfig,
  type StorageFolderMappingConfig,
} from './storageFolderMappings.ts';

export const CONFIG_BACKUP_SCHEMA_VERSION = 1;

export interface ConfigBackupSnapshot {
  schemaVersion: 1;
  appVersion: string;
  exportedAt: string;
  settings: {
    mirror: {
      baseUrl: string;
      loginUrl: string;
    };
    syncRules: {
      systemFilter: string;
      allowedReleaseTypes: string[];
      autoDownloadNewReleases: boolean;
      cronSchedule: string;
      scheduleEnabled: boolean;
    };
    pacing: {
      baseDelayMs: number;
      minDelayMs: number;
      maxDelayMs: number;
      backoffMultiplier: number;
      maxRetries: number;
      maxConcurrency: number;
      downloadChunkConcurrency: number;
      downloadChunkMinSizeMb: number;
      requestTimeoutMs: number;
      userAgent: string;
    };
    deviceExport: {
      romNamingTemplate: string;
      romSanitizeFat32: boolean;
      romMaxFilenameLen: number;
      storageFolderConfig: StorageFolderMappingConfig;
    };
  };
}

export interface ConfigBackupChangeItem {
  field: keyof ConfigUpdateInput;
  section: 'Mirror' | 'Sync Rules' | 'Request Pacing' | 'Device Export';
  label: string;
  from: string;
  to: string;
}

export interface ConfigBackupEnvSkipItem {
  field: keyof ConfigUpdateInput;
  envVar: string;
  label: string;
}

export interface ParsedConfigBackupPlan {
  valid: true;
  snapshot: ConfigBackupSnapshot;
  patch: ConfigUpdateInput;
  appliedFields: string[];
  skippedEnvLocked: ConfigBackupEnvSkipItem[];
  changes: ConfigBackupChangeItem[];
  summaryTags: string[];
}

export interface InvalidConfigBackupResult {
  valid: false;
  error: string;
}

export type ConfigBackupValidationResult = ParsedConfigBackupPlan | InvalidConfigBackupResult;

const FORBIDDEN_SECRET_KEYS = new Set([
  'password',
  'password_enc',
  'rgt_password',
  'app_auth_password',
  'session_secret',
  'cookie',
  'cookies',
  'token',
  'secret',
  'encryptionkey',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateHttpUrlString(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error(`${label} must be a non-empty http:// or https:// URL.`);
  }
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} must use http:// or https://.`);
  }
  return parsed.toString();
}

function validateNumberInRange(
  raw: unknown,
  label: string,
  min: number,
  max: number,
  round = true,
): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`${label} must be a finite number.`);
  }
  const value = round ? Math.round(raw) : raw;
  if (value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return value;
}

function normalizeSystemFilterList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function countStorageOverrides(cfg: StorageFolderMappingConfig): number {
  const systemKeys = Object.keys(cfg.systemFolders || {}).length;
  const typeOverrides = Object.keys(cfg.systemTypeOverrides || {}).length;
  return systemKeys + typeOverrides;
}

/**
 * Builds a portable, strictly secret-free JSON configuration snapshot.
 * Deliberately excludes passwords, usernames, session cookies, tokens, and host-specific disk paths.
 */
export function buildConfigBackupSnapshot(
  config: ScraperConfigPublic,
  appVersion: string,
  exportedAt: string = new Date().toISOString(),
): ConfigBackupSnapshot {
  return {
    schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
    appVersion,
    exportedAt,
    settings: {
      mirror: {
        baseUrl: config.baseUrl,
        loginUrl: config.loginUrl,
      },
      syncRules: {
        systemFilter: config.systemFilter,
        allowedReleaseTypes: [...config.allowedReleaseTypes],
        autoDownloadNewReleases: Boolean(config.autoDownloadNewReleases),
        cronSchedule: config.cronSchedule,
        scheduleEnabled: Boolean(config.scheduleEnabled),
      },
      pacing: {
        baseDelayMs: config.baseDelayMs,
        minDelayMs: config.minDelayMs,
        maxDelayMs: config.maxDelayMs,
        backoffMultiplier: config.backoffMultiplier,
        maxRetries: config.maxRetries,
        maxConcurrency: config.maxConcurrency,
        downloadChunkConcurrency: config.downloadChunkConcurrency,
        downloadChunkMinSizeMb: config.downloadChunkMinSizeMb,
        requestTimeoutMs: config.requestTimeoutMs,
        userAgent: config.userAgent,
      },
      deviceExport: {
        romNamingTemplate: config.romNamingTemplate,
        romSanitizeFat32: Boolean(config.romSanitizeFat32),
        romMaxFilenameLen: config.romMaxFilenameLen,
        storageFolderConfig: normalizeStorageFolderConfig(config.storageFolderConfig),
      },
    },
  };
}

/**
 * Strictly validates an imported backup payload against the allowlisted schema,
 * computes a safe `ConfigUpdateInput` patch excluding any env-locked fields,
 * and produces a concise diff summary for preview and audit receipts.
 */
export function parseAndValidateConfigBackup(
  raw: unknown,
  currentConfig: ScraperConfigPublic,
): ConfigBackupValidationResult {
  try {
    if (!isPlainObject(raw)) {
      return { valid: false, error: 'Backup file must contain a JSON object.' };
    }

    if (raw.schemaVersion !== CONFIG_BACKUP_SCHEMA_VERSION) {
      return {
        valid: false,
        error: `Unsupported backup schemaVersion (${String(raw.schemaVersion ?? 'missing')}). Expected ${CONFIG_BACKUP_SCHEMA_VERSION}.`,
      };
    }

    if (!isPlainObject(raw.settings)) {
      return { valid: false, error: 'Backup file is missing the "settings" object.' };
    }

    const appVersion =
      typeof raw.appVersion === 'string' && raw.appVersion.trim()
        ? raw.appVersion.trim().slice(0, 32)
        : 'unknown';
    const exportedAt =
      typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt))
        ? raw.exportedAt
        : new Date().toISOString();

    const rawSettings = raw.settings;
    // Strip/reject any forbidden keys if accidentally embedded at top level of settings
    for (const key of Object.keys(rawSettings)) {
      if (FORBIDDEN_SECRET_KEYS.has(key.toLowerCase())) {
        return {
          valid: false,
          error: `Backup contains disallowed secret field "${key}". Only non-secret configuration backups can be imported.`,
        };
      }
    }

    const mirrorRaw = isPlainObject(rawSettings.mirror) ? rawSettings.mirror : {};
    const syncRaw = isPlainObject(rawSettings.syncRules) ? rawSettings.syncRules : {};
    const pacingRaw = isPlainObject(rawSettings.pacing) ? rawSettings.pacing : {};
    const deviceRaw = isPlainObject(rawSettings.deviceExport) ? rawSettings.deviceExport : {};

    const hasAnySection =
      isPlainObject(rawSettings.mirror) ||
      isPlainObject(rawSettings.syncRules) ||
      isPlainObject(rawSettings.pacing) ||
      isPlainObject(rawSettings.deviceExport);

    if (!hasAnySection) {
      return {
        valid: false,
        error: 'Backup contains no recognized configuration sections (mirror, syncRules, pacing, deviceExport).',
      };
    }

    const normalizedSnapshot: ConfigBackupSnapshot = {
      schemaVersion: CONFIG_BACKUP_SCHEMA_VERSION,
      appVersion,
      exportedAt,
      settings: {
        mirror: {
          baseUrl:
            mirrorRaw.baseUrl !== undefined
              ? validateHttpUrlString(mirrorRaw.baseUrl, 'mirror.baseUrl')
              : currentConfig.baseUrl,
          loginUrl:
            mirrorRaw.loginUrl !== undefined
              ? validateHttpUrlString(mirrorRaw.loginUrl, 'mirror.loginUrl')
              : currentConfig.loginUrl,
        },
        syncRules: {
          systemFilter:
            syncRaw.systemFilter !== undefined
              ? typeof syncRaw.systemFilter === 'string'
                ? syncRaw.systemFilter.trim()
                : (() => {
                    throw new Error('syncRules.systemFilter must be a string.');
                  })()
              : currentConfig.systemFilter,
          allowedReleaseTypes:
            syncRaw.allowedReleaseTypes !== undefined
              ? Array.isArray(syncRaw.allowedReleaseTypes) &&
                syncRaw.allowedReleaseTypes.every((v) => typeof v === 'string')
                ? syncRaw.allowedReleaseTypes.map((v) => v.trim()).filter(Boolean)
                : (() => {
                    throw new Error('syncRules.allowedReleaseTypes must be an array of strings.');
                  })()
              : [...currentConfig.allowedReleaseTypes],
          autoDownloadNewReleases:
            syncRaw.autoDownloadNewReleases !== undefined
              ? typeof syncRaw.autoDownloadNewReleases === 'boolean'
                ? syncRaw.autoDownloadNewReleases
                : (() => {
                    throw new Error('syncRules.autoDownloadNewReleases must be a boolean.');
                  })()
              : Boolean(currentConfig.autoDownloadNewReleases),
          cronSchedule:
            syncRaw.cronSchedule !== undefined
              ? typeof syncRaw.cronSchedule === 'string' && syncRaw.cronSchedule.trim().length > 0
                ? syncRaw.cronSchedule.trim()
                : (() => {
                    throw new Error('syncRules.cronSchedule must be a non-empty cron expression.');
                  })()
              : currentConfig.cronSchedule,
          scheduleEnabled:
            syncRaw.scheduleEnabled !== undefined
              ? typeof syncRaw.scheduleEnabled === 'boolean'
                ? syncRaw.scheduleEnabled
                : (() => {
                    throw new Error('syncRules.scheduleEnabled must be a boolean.');
                  })()
              : Boolean(currentConfig.scheduleEnabled),
        },
        pacing: {
          minDelayMs:
            pacingRaw.minDelayMs !== undefined
              ? validateNumberInRange(pacingRaw.minDelayMs, 'pacing.minDelayMs', 250, 30000)
              : currentConfig.minDelayMs,
          maxDelayMs:
            pacingRaw.maxDelayMs !== undefined
              ? validateNumberInRange(pacingRaw.maxDelayMs, 'pacing.maxDelayMs', 250, 300000)
              : currentConfig.maxDelayMs,
          baseDelayMs:
            pacingRaw.baseDelayMs !== undefined
              ? validateNumberInRange(pacingRaw.baseDelayMs, 'pacing.baseDelayMs', 250, 300000)
              : currentConfig.baseDelayMs,
          backoffMultiplier:
            pacingRaw.backoffMultiplier !== undefined
              ? validateNumberInRange(
                  pacingRaw.backoffMultiplier,
                  'pacing.backoffMultiplier',
                  1.2,
                  5.0,
                  false,
                )
              : currentConfig.backoffMultiplier,
          maxRetries:
            pacingRaw.maxRetries !== undefined
              ? validateNumberInRange(pacingRaw.maxRetries, 'pacing.maxRetries', 0, 15)
              : currentConfig.maxRetries,
          maxConcurrency:
            pacingRaw.maxConcurrency !== undefined
              ? validateNumberInRange(pacingRaw.maxConcurrency, 'pacing.maxConcurrency', 1, 3)
              : currentConfig.maxConcurrency,
          downloadChunkConcurrency:
            pacingRaw.downloadChunkConcurrency !== undefined
              ? validateNumberInRange(
                  pacingRaw.downloadChunkConcurrency,
                  'pacing.downloadChunkConcurrency',
                  1,
                  4,
                )
              : currentConfig.downloadChunkConcurrency,
          downloadChunkMinSizeMb:
            pacingRaw.downloadChunkMinSizeMb !== undefined
              ? validateNumberInRange(
                  pacingRaw.downloadChunkMinSizeMb,
                  'pacing.downloadChunkMinSizeMb',
                  4,
                  128,
                )
              : currentConfig.downloadChunkMinSizeMb,
          requestTimeoutMs:
            pacingRaw.requestTimeoutMs !== undefined
              ? validateNumberInRange(
                  pacingRaw.requestTimeoutMs,
                  'pacing.requestTimeoutMs',
                  5000,
                  180000,
                )
              : currentConfig.requestTimeoutMs,
          userAgent:
            pacingRaw.userAgent !== undefined
              ? typeof pacingRaw.userAgent === 'string' && pacingRaw.userAgent.trim().length > 0
                ? pacingRaw.userAgent.trim().slice(0, 256)
                : (() => {
                    throw new Error('pacing.userAgent must be a non-empty string.');
                  })()
              : currentConfig.userAgent,
        },
        deviceExport: {
          romNamingTemplate:
            deviceRaw.romNamingTemplate !== undefined
              ? typeof deviceRaw.romNamingTemplate === 'string' &&
                deviceRaw.romNamingTemplate.trim().length > 0
                ? deviceRaw.romNamingTemplate.trim().slice(0, 200)
                : (() => {
                    throw new Error('deviceExport.romNamingTemplate must be a non-empty string.');
                  })()
              : currentConfig.romNamingTemplate,
          romSanitizeFat32:
            deviceRaw.romSanitizeFat32 !== undefined
              ? typeof deviceRaw.romSanitizeFat32 === 'boolean'
                ? deviceRaw.romSanitizeFat32
                : (() => {
                    throw new Error('deviceExport.romSanitizeFat32 must be a boolean.');
                  })()
              : Boolean(currentConfig.romSanitizeFat32),
          romMaxFilenameLen:
            deviceRaw.romMaxFilenameLen !== undefined
              ? validateNumberInRange(
                  deviceRaw.romMaxFilenameLen,
                  'deviceExport.romMaxFilenameLen',
                  0,
                  255,
                )
              : currentConfig.romMaxFilenameLen,
          storageFolderConfig:
            deviceRaw.storageFolderConfig !== undefined
              ? isPlainObject(deviceRaw.storageFolderConfig)
                ? normalizeStorageFolderConfig(deviceRaw.storageFolderConfig)
                : (() => {
                    throw new Error('deviceExport.storageFolderConfig must be an object.');
                  })()
              : normalizeStorageFolderConfig(currentConfig.storageFolderConfig),
        },
      },
    };

    // Keep delay ordering consistent
    if (normalizedSnapshot.settings.pacing.maxDelayMs < normalizedSnapshot.settings.pacing.minDelayMs) {
      normalizedSnapshot.settings.pacing.maxDelayMs = normalizedSnapshot.settings.pacing.minDelayMs;
    }
    if (normalizedSnapshot.settings.pacing.baseDelayMs < normalizedSnapshot.settings.pacing.minDelayMs) {
      normalizedSnapshot.settings.pacing.baseDelayMs = normalizedSnapshot.settings.pacing.minDelayMs;
    }
    if (normalizedSnapshot.settings.pacing.baseDelayMs > normalizedSnapshot.settings.pacing.maxDelayMs) {
      normalizedSnapshot.settings.pacing.baseDelayMs = normalizedSnapshot.settings.pacing.maxDelayMs;
    }

    const envLocks = new Set(currentConfig.envOverrides || []);
    const patch: ConfigUpdateInput = {};
    const appliedFields: string[] = [];
    const skippedEnvLocked: ConfigBackupEnvSkipItem[] = [];
    const changes: ConfigBackupChangeItem[] = [];

    const maybeApply = <K extends keyof ConfigUpdateInput>(spec: {
      field: K;
      envVar?: string;
      section: ConfigBackupChangeItem['section'];
      label: string;
      presentInBackup: boolean;
      nextValue: NonNullable<ConfigUpdateInput[K]>;
      changed: boolean;
      fromDisplay: string;
      toDisplay: string;
    }) => {
      if (!spec.presentInBackup) return;
      if (spec.envVar && envLocks.has(spec.envVar)) {
        if (spec.changed) {
          skippedEnvLocked.push({
            field: spec.field,
            envVar: spec.envVar,
            label: spec.label,
          });
        }
        return;
      }
      if (!spec.changed) return;
      (patch as Record<string, unknown>)[spec.field] = spec.nextValue;
      appliedFields.push(spec.field);
      changes.push({
        field: spec.field,
        section: spec.section,
        label: spec.label,
        from: spec.fromDisplay,
        to: spec.toDisplay,
      });
    };

    const s = normalizedSnapshot.settings;

    maybeApply({
      field: 'baseUrl',
      envVar: 'RGT_BASE_URL',
      section: 'Mirror',
      label: 'Repository Base URL',
      presentInBackup: mirrorRaw.baseUrl !== undefined,
      nextValue: s.mirror.baseUrl,
      changed: s.mirror.baseUrl !== currentConfig.baseUrl,
      fromDisplay: currentConfig.baseUrl,
      toDisplay: s.mirror.baseUrl,
    });

    maybeApply({
      field: 'loginUrl',
      envVar: 'RGT_LOGIN_URL',
      section: 'Mirror',
      label: 'Login Endpoint URL',
      presentInBackup: mirrorRaw.loginUrl !== undefined,
      nextValue: s.mirror.loginUrl,
      changed: s.mirror.loginUrl !== currentConfig.loginUrl,
      fromDisplay: currentConfig.loginUrl,
      toDisplay: s.mirror.loginUrl,
    });

    const curSystems = normalizeSystemFilterList(currentConfig.systemFilter);
    const nextSystems = normalizeSystemFilterList(s.syncRules.systemFilter);
    maybeApply({
      field: 'systemFilter',
      envVar: 'SCRAPER_SYSTEM_FILTER',
      section: 'Sync Rules',
      label: 'Target Consoles',
      presentInBackup: syncRaw.systemFilter !== undefined,
      nextValue: s.syncRules.systemFilter,
      changed: s.syncRules.systemFilter !== currentConfig.systemFilter,
      fromDisplay: curSystems.length ? `${curSystems.length} console(s)` : 'All consoles',
      toDisplay: nextSystems.length ? `${nextSystems.length} console(s)` : 'All consoles',
    });

    const curTypes = [...currentConfig.allowedReleaseTypes].sort().join(',');
    const nextTypes = [...s.syncRules.allowedReleaseTypes].sort().join(',');
    maybeApply({
      field: 'allowedReleaseTypes',
      envVar: 'SCRAPER_ALLOWED_RELEASE_TYPES',
      section: 'Sync Rules',
      label: 'Allowed Release Types',
      presentInBackup: syncRaw.allowedReleaseTypes !== undefined,
      nextValue: s.syncRules.allowedReleaseTypes,
      changed: curTypes !== nextTypes,
      fromDisplay:
        currentConfig.allowedReleaseTypes.length > 0
          ? `${currentConfig.allowedReleaseTypes.length} type(s)`
          : 'All types',
      toDisplay:
        s.syncRules.allowedReleaseTypes.length > 0
          ? `${s.syncRules.allowedReleaseTypes.length} type(s)`
          : 'All types',
    });

    maybeApply({
      field: 'autoDownloadNewReleases',
      envVar: 'SCRAPER_AUTO_DOWNLOAD',
      section: 'Sync Rules',
      label: 'Auto-Download New Releases',
      presentInBackup: syncRaw.autoDownloadNewReleases !== undefined,
      nextValue: s.syncRules.autoDownloadNewReleases,
      changed: s.syncRules.autoDownloadNewReleases !== Boolean(currentConfig.autoDownloadNewReleases),
      fromDisplay: currentConfig.autoDownloadNewReleases ? 'Enabled' : 'Disabled',
      toDisplay: s.syncRules.autoDownloadNewReleases ? 'Enabled' : 'Disabled',
    });

    maybeApply({
      field: 'cronSchedule',
      envVar: 'SCRAPER_CRON',
      section: 'Sync Rules',
      label: 'Cron Schedule',
      presentInBackup: syncRaw.cronSchedule !== undefined,
      nextValue: s.syncRules.cronSchedule,
      changed: s.syncRules.cronSchedule !== currentConfig.cronSchedule,
      fromDisplay: currentConfig.cronSchedule,
      toDisplay: s.syncRules.cronSchedule,
    });

    maybeApply({
      field: 'scheduleEnabled',
      envVar: 'SCRAPER_SCHEDULE_ENABLED',
      section: 'Sync Rules',
      label: 'Scheduled Sync',
      presentInBackup: syncRaw.scheduleEnabled !== undefined,
      nextValue: s.syncRules.scheduleEnabled,
      changed: s.syncRules.scheduleEnabled !== Boolean(currentConfig.scheduleEnabled),
      fromDisplay: currentConfig.scheduleEnabled ? 'Enabled' : 'Disabled',
      toDisplay: s.syncRules.scheduleEnabled ? 'Enabled' : 'Disabled',
    });

    maybeApply({
      field: 'baseDelayMs',
      envVar: 'SCRAPER_BASE_DELAY_MS',
      section: 'Request Pacing',
      label: 'Base Delay',
      presentInBackup: pacingRaw.baseDelayMs !== undefined,
      nextValue: s.pacing.baseDelayMs,
      changed: s.pacing.baseDelayMs !== currentConfig.baseDelayMs,
      fromDisplay: `${currentConfig.baseDelayMs} ms`,
      toDisplay: `${s.pacing.baseDelayMs} ms`,
    });

    maybeApply({
      field: 'minDelayMs',
      envVar: 'SCRAPER_MIN_DELAY_MS',
      section: 'Request Pacing',
      label: 'Min Delay',
      presentInBackup: pacingRaw.minDelayMs !== undefined,
      nextValue: s.pacing.minDelayMs,
      changed: s.pacing.minDelayMs !== currentConfig.minDelayMs,
      fromDisplay: `${currentConfig.minDelayMs} ms`,
      toDisplay: `${s.pacing.minDelayMs} ms`,
    });

    maybeApply({
      field: 'maxDelayMs',
      envVar: 'SCRAPER_MAX_DELAY_MS',
      section: 'Request Pacing',
      label: 'Max Cooldown Delay',
      presentInBackup: pacingRaw.maxDelayMs !== undefined,
      nextValue: s.pacing.maxDelayMs,
      changed: s.pacing.maxDelayMs !== currentConfig.maxDelayMs,
      fromDisplay: `${currentConfig.maxDelayMs} ms`,
      toDisplay: `${s.pacing.maxDelayMs} ms`,
    });

    maybeApply({
      field: 'backoffMultiplier',
      envVar: 'SCRAPER_BACKOFF_MULTIPLIER',
      section: 'Request Pacing',
      label: 'Backoff Multiplier',
      presentInBackup: pacingRaw.backoffMultiplier !== undefined,
      nextValue: s.pacing.backoffMultiplier,
      changed: Math.abs(s.pacing.backoffMultiplier - currentConfig.backoffMultiplier) >= 0.001,
      fromDisplay: `${currentConfig.backoffMultiplier}x`,
      toDisplay: `${s.pacing.backoffMultiplier}x`,
    });

    maybeApply({
      field: 'maxRetries',
      envVar: 'SCRAPER_MAX_RETRIES',
      section: 'Request Pacing',
      label: 'Max Retries',
      presentInBackup: pacingRaw.maxRetries !== undefined,
      nextValue: s.pacing.maxRetries,
      changed: s.pacing.maxRetries !== currentConfig.maxRetries,
      fromDisplay: String(currentConfig.maxRetries),
      toDisplay: String(s.pacing.maxRetries),
    });

    maybeApply({
      field: 'maxConcurrency',
      envVar: 'SCRAPER_MAX_CONCURRENCY',
      section: 'Request Pacing',
      label: 'Parallel Workers',
      presentInBackup: pacingRaw.maxConcurrency !== undefined,
      nextValue: s.pacing.maxConcurrency,
      changed: s.pacing.maxConcurrency !== currentConfig.maxConcurrency,
      fromDisplay: String(currentConfig.maxConcurrency),
      toDisplay: String(s.pacing.maxConcurrency),
    });

    maybeApply({
      field: 'downloadChunkConcurrency',
      envVar: 'SCRAPER_DOWNLOAD_CHUNK_CONCURRENCY',
      section: 'Request Pacing',
      label: 'Download Chunk Concurrency',
      presentInBackup: pacingRaw.downloadChunkConcurrency !== undefined,
      nextValue: s.pacing.downloadChunkConcurrency,
      changed: s.pacing.downloadChunkConcurrency !== currentConfig.downloadChunkConcurrency,
      fromDisplay: `${currentConfig.downloadChunkConcurrency}x`,
      toDisplay: `${s.pacing.downloadChunkConcurrency}x`,
    });

    maybeApply({
      field: 'downloadChunkMinSizeMb',
      envVar: 'SCRAPER_DOWNLOAD_CHUNK_MIN_SIZE_MB',
      section: 'Request Pacing',
      label: 'Multi-Chunk Threshold',
      presentInBackup: pacingRaw.downloadChunkMinSizeMb !== undefined,
      nextValue: s.pacing.downloadChunkMinSizeMb,
      changed: s.pacing.downloadChunkMinSizeMb !== currentConfig.downloadChunkMinSizeMb,
      fromDisplay: `${currentConfig.downloadChunkMinSizeMb} MiB`,
      toDisplay: `${s.pacing.downloadChunkMinSizeMb} MiB`,
    });

    maybeApply({
      field: 'requestTimeoutMs',
      envVar: 'SCRAPER_REQUEST_TIMEOUT_MS',
      section: 'Request Pacing',
      label: 'Request Timeout',
      presentInBackup: pacingRaw.requestTimeoutMs !== undefined,
      nextValue: s.pacing.requestTimeoutMs,
      changed: s.pacing.requestTimeoutMs !== currentConfig.requestTimeoutMs,
      fromDisplay: `${currentConfig.requestTimeoutMs} ms`,
      toDisplay: `${s.pacing.requestTimeoutMs} ms`,
    });

    maybeApply({
      field: 'userAgent',
      envVar: 'SCRAPER_USER_AGENT',
      section: 'Request Pacing',
      label: 'HTTP User-Agent',
      presentInBackup: pacingRaw.userAgent !== undefined,
      nextValue: s.pacing.userAgent,
      changed: s.pacing.userAgent !== currentConfig.userAgent,
      fromDisplay: currentConfig.userAgent.slice(0, 36),
      toDisplay: s.pacing.userAgent.slice(0, 36),
    });

    maybeApply({
      field: 'romNamingTemplate',
      section: 'Device Export',
      label: 'ROM Naming Template',
      presentInBackup: deviceRaw.romNamingTemplate !== undefined,
      nextValue: s.deviceExport.romNamingTemplate,
      changed: s.deviceExport.romNamingTemplate !== currentConfig.romNamingTemplate,
      fromDisplay: currentConfig.romNamingTemplate,
      toDisplay: s.deviceExport.romNamingTemplate,
    });

    maybeApply({
      field: 'romSanitizeFat32',
      section: 'Device Export',
      label: 'FAT32 Filename Sanitization',
      presentInBackup: deviceRaw.romSanitizeFat32 !== undefined,
      nextValue: s.deviceExport.romSanitizeFat32,
      changed: s.deviceExport.romSanitizeFat32 !== Boolean(currentConfig.romSanitizeFat32),
      fromDisplay: currentConfig.romSanitizeFat32 ? 'Enabled' : 'Disabled',
      toDisplay: s.deviceExport.romSanitizeFat32 ? 'Enabled' : 'Disabled',
    });

    maybeApply({
      field: 'romMaxFilenameLen',
      section: 'Device Export',
      label: 'Max ROM Filename Length',
      presentInBackup: deviceRaw.romMaxFilenameLen !== undefined,
      nextValue: s.deviceExport.romMaxFilenameLen,
      changed: s.deviceExport.romMaxFilenameLen !== currentConfig.romMaxFilenameLen,
      fromDisplay: currentConfig.romMaxFilenameLen ? `${currentConfig.romMaxFilenameLen} chars` : 'Unlimited',
      toDisplay: s.deviceExport.romMaxFilenameLen ? `${s.deviceExport.romMaxFilenameLen} chars` : 'Unlimited',
    });

    const curStorageJson = canonicalStorageFolderConfigJson(currentConfig.storageFolderConfig);
    const nextStorageJson = canonicalStorageFolderConfigJson(s.deviceExport.storageFolderConfig);
    maybeApply({
      field: 'storageFolderConfig',
      section: 'Device Export',
      label: 'Storage Folder Mappings',
      presentInBackup: deviceRaw.storageFolderConfig !== undefined,
      nextValue: s.deviceExport.storageFolderConfig,
      changed: curStorageJson !== nextStorageJson,
      fromDisplay: `${countStorageOverrides(currentConfig.storageFolderConfig)} override(s)`,
      toDisplay: `${countStorageOverrides(s.deviceExport.storageFolderConfig)} override(s)`,
    });

    const summaryTags: string[] = [];
    summaryTags.push(
      nextSystems.length > 0 ? `${nextSystems.length} target consoles` : 'All consoles',
    );
    summaryTags.push(
      s.syncRules.allowedReleaseTypes.length > 0
        ? `${s.syncRules.allowedReleaseTypes.length} release types`
        : 'All release types',
    );
    const folderOverridesCount = countStorageOverrides(s.deviceExport.storageFolderConfig);
    summaryTags.push(`${folderOverridesCount} folder override${folderOverridesCount === 1 ? '' : 's'}`);
    summaryTags.push(
      s.syncRules.scheduleEnabled ? `Schedule ${s.syncRules.cronSchedule}` : 'Schedule paused',
    );

    return {
      valid: true,
      snapshot: normalizedSnapshot,
      patch,
      appliedFields,
      skippedEnvLocked,
      changes,
      summaryTags,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Invalid configuration backup file.',
    };
  }
}
