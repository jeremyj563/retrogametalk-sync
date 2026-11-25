import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Cron } from 'croner';
import {
  acquireDistributedLock,
  appendActivityLog,
  clearActivityLogs,
  clearPausedQueuedReleases,
  clearSyncRuns,
  countSiblingItemsInDir,
  createSyncRun,
  deleteRepositoryItemsByIds,
  deleteRepositoryItemsByLocalPaths,
  getCatalogReleaseCountsBySystem,
  getCatalogTotalsAndSystems,
  getDataDir,
  getExistingReleaseLocalPaths,
  getInternalConfig,
  getLastAuthenticatedAt,
  getReleaseFileById,
  getRepositoryItemById,
  getRepositoryItemByRemoteUrl,
  getSchemaMigrationReport,
  getSystemIndexState,
  listCatalogReleasesForRuleSync,
  listPausedQueuedReleaseIds,
  listPinnedCatalogReleases,
  listReleasesNeedingRetry,
  listSyncRuns,
  markCatalogItemsQueuedDetailed,
  markCatalogReleaseFailed,
  markCatalogReleaseRemoteChecked,
  mergeCatalogReleaseDetailMetadata,
  persistDiscoveredReleaseDownloadHints,
  queryRepositoryItemIds,
  recomputeReleaseRollup,
  recordSuccessfulLogin,
  releaseDistributedLock,
  saveDiscoveredSystems,
  setWatermark,
  updateCatalogCoverPath,
  updateCatalogReleaseMetadata,
  updateConfig,
  updateSyncRun,
  updateSystemIndexCursor,
  upsertCatalogRelease,
  upsertIndexedWpRelease,
  upsertReleaseFile,
  type CatalogQueryFilterParams,
} from './db.ts';
import { AdaptiveRateLimiter } from './rateLimiter.ts';
import {
  evaluateAchievements,
  getAchievementsSnapshot,
  recordAchievementCounter,
  recordClientAchievementEvent,
  recordNightOwlIfApplicable,
  runSilentBaselineCatchUp,
} from './achievements.ts';
import type { ClientAchievementEventPayload } from '../shared/achievements.ts';
import { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';
import {
  defaultFileExistsWithBytes,
  evaluateReleaseFastSkip,
  isReleaseFullyMirroredForRules,
  partitionAlreadyDownloadedFiles,
} from './syncFastSkip.ts';
import { estimateDownloadHintsBytes } from '../shared/fileSize.ts';
import {
  classifyFileRoleToTypeKeys,
  classifyReleaseTagsToTypeKeys,
  evaluateReleaseTypeMatch,
  formatAllowedReleaseTypesSummary,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter.ts';
import {
  buildUpdatedSystemIndexCursor,
  computeCatalogDeltaCutoffIso,
  planCatalogIndexTargets,
} from '../shared/catalogIndexerPlan.ts';
import {
  classifySystemIndexFreshness,
  DEFAULT_INDEX_STALE_MS,
  diffRuntimeSyncSettings,
  diffSyncRules,
  doesCatalogReleaseMatchSyncRules,
  formatSyncRuleScopeSummary,
  isConsoleAllowedBySyncRules,
  isSyncRunEligibleForLiveRuleReload,
  type LiveSyncReloadReceipt,
  resolveTargetConsoleScope,
  type SyncRuleDiff,
} from '../shared/syncRuleMatcher.ts';
import { normalizeGitRepoUrl } from '../shared/gitUrl.ts';
import { canonicalizeSystemSlug, filterValidSystemSlugs } from '../shared/systemCatalog.ts';
import {
  type DiscoveredRelease,
  type LoggerFn,
  RetroGameTalkClient,
  SCREENSHOT_FULLRES_VERSION,
  type WpPostMetadata,
  resolveMirroredPaths,
} from './rgtClient.ts';
import {
  browseArchiveAtPath,
  detectArchiveFormat,
  inspectArchiveForItem,
  readArchiveTextPreview,
} from './archiveService.ts';
import { formatErrorDetails, isDebugLoggingEnabled, logServer } from './logger.ts';
import type {
  ActiveRunProgress,
  ActiveSyncItemSummary,
  ActiveTransferState,
  ArchiveBrowseListing,
  ArchiveInspectResult,
  ArchiveTextPreviewResult,
  AuthTestResult,
  CatalogIndexerStatus,
  ConfigUpdateInput,
  DryRunConsoleBreakdown,
  DryRunSampleRelease,
  FsTreeNode,
  LogLevel,
  ReleaseFileRecord,
  ReleaseMetadata,
  RepositoryItemRecord,
  RunMode,
  RunTrigger,
  ScraperConfigInternal,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  StorageStats,
  SyncRunRecord,
  SyncRunSummarySnapshot,
  TransferSpeedSample,
} from './types.ts';

const POD_ID = process.env.HOSTNAME || os.hostname() || 'rgt-sync-pod';

const AUTO_INDEX_PRIORITY_SYSTEMS = [
  'nes-roms',
  'snes-roms',
  'n64-roms',
  'gba-roms',
  'gameboy-color-roms',
  'gameboy-roms',
  'nds-roms',
  'psx-iso',
  'psp-iso',
  'genesis-roms',
  'dreamcast-iso',
  'arcade-roms',
];

let cachedLocalGitFallback: {
  version: string;
  gitSha: string;
  gitRef: string | null;
  builtAt: string | null;
} | null = null;

function normalizeBuildTimestamp(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function getLocalGitFallback(): {
  version: string;
  gitSha: string;
  gitRef: string | null;
  builtAt: string | null;
} {
  if (cachedLocalGitFallback) return cachedLocalGitFallback;
  let version = 'dev';
  let gitSha = 'unknown';
  let gitRef: string | null = null;
  let builtAt: string | null = null;
  try {
    const tag = execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (tag) {
      version = tag;
      gitRef = `refs/tags/${tag}`;
    } else {
      try {
        const symbolicRef = execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (symbolicRef) {
          gitRef = symbolicRef;
          version = symbolicRef.replace(/^refs\/heads\//, '');
        }
      } catch {
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        if (branch && branch !== 'HEAD') {
          version = branch;
          gitRef = `refs/heads/${branch}`;
        }
      }
    }
  } catch {
    // No local git repository available (e.g. production container)
  }
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (sha) {
      gitSha = sha;
    }
  } catch {
    // No local git repository available
  }
  try {
    const commitDate = execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    builtAt = normalizeBuildTimestamp(commitDate);
  } catch {
    // No local git repository available
  }
  cachedLocalGitFallback = { version, gitSha, gitRef, builtAt };
  return cachedLocalGitFallback;
}

let cachedPackageVersionFallback: string | null | undefined;

function getPackageVersionFallback(): string | null {
  if (cachedPackageVersionFallback !== undefined) return cachedPackageVersionFallback;
  try {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const raw = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { version?: unknown };
    const ver = typeof raw.version === 'string' ? raw.version.trim() : '';
    if (/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(ver) && ver !== '0.0.0') {
      cachedPackageVersionFallback = ver;
      return cachedPackageVersionFallback;
    }
  } catch {
    // Ignore unreadable package.json
  }
  cachedPackageVersionFallback = null;
  return null;
}

function getDistBuildTimestampFallback(): string | null {
  try {
    const distIndex = path.resolve(process.cwd(), 'dist', 'index.html');
    const stat = fs.statSync(distIndex);
    if (stat.isFile() && Number.isFinite(stat.mtimeMs) && stat.mtimeMs > 0) {
      return stat.mtime.toISOString();
    }
  } catch {
    // No dist build artifact available
  }
  return null;
}

function resolveRuntimeBuildInfo(): {
  version: string;
  gitSha: string;
  gitUrl: string | null;
  gitRef: string | null;
  builtAt: string | null;
} {
  const envVersion = (process.env.APP_VERSION || '').trim();
  const envSha = (process.env.GIT_SHA || '').trim();
  const envGitRef = (process.env.GIT_REF || '').trim();
  const gitUrl = normalizeGitRepoUrl(process.env.GIT_URL);
  const envBuiltAt = normalizeBuildTimestamp(
    process.env.BUILT_AT ||
      process.env.RELEASE_DATE ||
      process.env.BUILD_TIMESTAMP ||
      process.env.BUILD_DATE,
  );
  const fallback =
    !envVersion ||
    envVersion === 'dev' ||
    !envSha ||
    envSha === 'unknown' ||
    !envGitRef ||
    !envBuiltAt
      ? getLocalGitFallback()
      : null;
  const pkgVersion =
    !envVersion || envVersion === 'dev'
      ? getPackageVersionFallback()
      : null;

  const resolvedVersion =
    envVersion && envVersion !== 'dev'
      ? envVersion
      : fallback?.version && fallback.version !== 'dev'
        ? fallback.version
        : pkgVersion || envVersion || fallback?.version || 'dev';

  const resolvedGitRef =
    envGitRef ||
    fallback?.gitRef ||
    (resolvedVersion && resolvedVersion !== 'dev' && resolvedVersion !== 'unknown'
      ? resolvedVersion
      : null);

  return {
    version: resolvedVersion,
    gitSha:
      envSha && envSha !== 'unknown'
        ? envSha
        : fallback?.gitSha && fallback.gitSha !== 'unknown'
          ? fallback.gitSha
          : envSha || 'unknown',
    gitUrl,
    gitRef: resolvedGitRef,
    builtAt: envBuiltAt ?? fallback?.builtAt ?? getDistBuildTimestampFallback(),
  };
}

function isEphemeralPartFile(name: string): boolean {
  return (
    name.endsWith('.part') ||
    name.endsWith('.part.meta.json') ||
    name.endsWith('.part.meta.json.tmp')
  );
}

export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number | (() => number),
  signal: AbortSignal,
  worker: (item: T, index: number) => Promise<void>,
  subscribeConcurrency?: (onChange: () => void) => () => void,
): Promise<void> {
  if (items.length === 0 || signal.aborted) return;

  const getTargetConcurrency = (): number => {
    const raw = typeof concurrency === 'function' ? concurrency() : concurrency;
    return Math.max(1, Math.min(items.length, Math.floor(Number(raw) || 1)));
  };

  return new Promise<void>((resolve, reject) => {
    let nextIdx = 0;
    let activeWorkers = 0;
    let fatalErr: unknown = null;
    let settled = false;
    let unsubscribe: (() => void) | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        unsubscribe?.();
      } catch {
        // Ignore unsubscribe error
      }
      if (fatalErr !== null) {
        reject(fatalErr);
      } else {
        resolve();
      }
    };

    const runWorker = async () => {
      try {
        while (!signal.aborted && fatalErr === null) {
          // Graceful scale-down: if concurrency was lowered mid-batch, excess workers exit cleanly
          if (activeWorkers > getTargetConcurrency()) {
            break;
          }
          const idx = nextIdx;
          if (idx >= items.length) {
            break;
          }
          nextIdx += 1;
          try {
            await worker(items[idx]!, idx);
          } catch (err) {
            if (fatalErr === null) {
              fatalErr = err;
            }
            break;
          }
          // Check if target concurrency increased while this item was in flight
          maybeSpawnWorkers();
        }
      } finally {
        activeWorkers -= 1;
        if (!settled) {
          if (!signal.aborted && fatalErr === null && nextIdx < items.length) {
            maybeSpawnWorkers();
          }
          if (activeWorkers === 0) {
            finish();
          }
        }
      }
    };

    const maybeSpawnWorkers = () => {
      if (settled || signal.aborted || fatalErr !== null) return;
      const target = getTargetConcurrency();
      while (activeWorkers < target && nextIdx < items.length && !signal.aborted && fatalErr === null) {
        activeWorkers += 1;
        void runWorker();
      }
    };

    if (subscribeConcurrency) {
      unsubscribe = subscribeConcurrency(() => {
        maybeSpawnWorkers();
      });
    }

    maybeSpawnWorkers();
    if (activeWorkers === 0) {
      finish();
    }
  });
}

export class ScraperOrchestrator extends EventEmitter {
  private rateLimiter: AdaptiveRateLimiter;
  private client: RetroGameTalkClient;
  private cronJob: Cron | null = null;
  private activeRun: SyncRunRecord | null = null;
  private activeTransfer: ActiveTransferState | null = null;
  private activeTransfers = new Map<string, ActiveTransferState>();
  private activeTransferOrder: string[] = [];
  private activeSyncItem: ActiveSyncItemSummary | null = null;
  private activeRunProgress: ActiveRunProgress | null = null;
  private transferHistory: TransferSpeedSample[] = [];
  private lastTransferSampleMs = 0;
  private currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
  private abortController: AbortController | null = null;
  private lockRenewTimer: NodeJS.Timeout | null = null;
  private syncRulesRevision = 0;
  private runtimeConfigRevision = 0;
  private runtimeConfigListeners = new Set<() => void>();
  private shuttingDown = false;
  private inFlightAssetUpgrades = new Map<number, Promise<RepositoryItemRecord | null>>();
  private inFlightDetailHydrations = new Map<number, Promise<RepositoryItemRecord | null>>();
  private inFlightLazyCovers = new Map<number, Promise<void>>();
  private activeLazyCoverSlots = 0;
  private lazyCoverWaiters: (() => void)[] = [];
  private inFlightLazyScreenshots = new Map<string, Promise<void>>();
  private activeLazyScreenshotSlots = 0;
  private lazyScreenshotWaiters: (() => void)[] = [];
  private indexerState: CatalogIndexerStatus = {
    active: false,
    scope: null,
    mode: null,
    currentSystem: null,
    systemsCompleted: 0,
    systemsTotal: 0,
    currentPage: 0,
    totalPages: 0,
    indexedCount: 0,
    remainingUnindexedSystems: 0,
    lastError: null,
  };
  private indexerAbortController: AbortController | null = null;
  private pendingAutoIndexAfterCurrent = false;
  private runFinishedWaiters: (() => void)[] = [];
  private pendingDownloadQueueIds: number[] = [];
  private pendingDownloadQueueSet = new Set<number>();
  private inFlightDownloadIds = new Set<number>();
  private ruleFilteredDownloadIds = new Set<number>();

  private subscribeRuntimeConfig = (listener: () => void): (() => void) => {
    this.runtimeConfigListeners.add(listener);
    return () => {
      this.runtimeConfigListeners.delete(listener);
    };
  };

  private notifyRuntimeConfigChanged(): void {
    for (const listener of Array.from(this.runtimeConfigListeners)) {
      try {
        listener();
      } catch {
        // Ignore runtime config listener errors
      }
    }
  }

  private diskStatsCache: {
    downloadDir: string;
    collectedAtMs: number;
    storage: StorageStats;
    systemDiskUsage: Map<string, { filesOnDisk: number; bytesOnDisk: number }>;
  } | null = null;
  private diskStatsRefreshPromise: Promise<void> | null = null;
  private diskStatsDirty = true;
  private lastWritableCheck: { downloadDir: string; checkedAtMs: number; writable: boolean } | null = null;

  constructor() {
    super();
    const cfg = getInternalConfig();
    this.rateLimiter = new AdaptiveRateLimiter({
      baseDelayMs: cfg.baseDelayMs,
      minDelayMs: cfg.minDelayMs,
      maxDelayMs: cfg.maxDelayMs,
      backoffMultiplier: cfg.backoffMultiplier,
    });
    this.client = new RetroGameTalkClient(this.rateLimiter, () => getInternalConfig());

    let persistedAuthAt = getLastAuthenticatedAt();
    const hydrated = this.client.hydratePersistedSession(cfg, persistedAuthAt);
    if (hydrated.restoredActiveCookies && !persistedAuthAt) {
      persistedAuthAt = recordSuccessfulLogin();
      this.client.setPersistedLastAuthenticatedAt(persistedAuthAt);
    }

    const reconciled = this.reconcileDiskCatalog(cfg);
    const refreshedCfg = reconciled.releasesImported > 0 ? getInternalConfig() : cfg;
    const { totals } = getCatalogTotalsAndSystems();
    const authSnap = this.client.getAuthStatus(refreshedCfg, persistedAuthAt);
    const authLabel = authSnap.authenticated
      ? 'Active'
      : authSnap.hasCompletedLogin
        ? 'Standby'
        : authSnap.configured
          ? 'Unverified'
          : 'Unset';

    const schemaReport = getSchemaMigrationReport();
    const seededBaseline = runSilentBaselineCatchUp();
    console.log(
      `[${new Date().toISOString()}] [STARTUP] [INFO] Persistence initialized — DATA_DIR="${getDataDir()}", DOWNLOAD_DIR="${refreshedCfg.downloadDir}", schema=v${schemaReport.currentVersion}/v${schemaReport.targetVersion}, auth=${authLabel} (hasCompletedLogin=${authSnap.hasCompletedLogin}, cookies=[${hydrated.cookieNames}]), discoveredSystems=${refreshedCfg.discoveredSystems.length}, catalogReleases=${totals.totalCatalogItems} (reconciledFromDisk=${reconciled.releasesImported}), silentBaselineTrophies=${seededBaseline.length}, debugLogging=${isDebugLoggingEnabled() ? 'enabled' : 'disabled'}`,
    );

    this.reconfigureScheduler(refreshedCfg);
    this.scheduleDiskStatsRefresh(refreshedCfg.downloadDir, true);

    if (authSnap.hasCompletedLogin && refreshedCfg.username && refreshedCfg.password) {
      setTimeout(() => {
        if (!this.shuttingDown && !this.indexerState.active) {
          void this.startCatalogIndex('filtered', { auto: true }).catch(() => undefined);
        }
      }, 1500).unref();
    }
  }

  private reconcileDiskCatalog(cfg: ScraperConfigInternal): { releasesImported: number; filesImported: number } {
    const root = path.resolve(cfg.downloadDir);
    if (!fs.existsSync(root)) {
      return { releasesImported: 0, filesImported: 0 };
    }

    const existingLocalPaths = getExistingReleaseLocalPaths();
    const baseWithSlash = (() => {
      try {
        const u = new URL(cfg.baseUrl);
        if (!u.pathname.endsWith('/')) u.pathname += '/';
        return u.toString();
      } catch {
        return cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`;
      }
    })();

    let sysEntries: fs.Dirent[];
    try {
      sysEntries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return { releasesImported: 0, filesImported: 0 };
    }

    let releasesImported = 0;
    let filesImported = 0;
    const reconciledSystems = new Set<string>();

    for (const sysEntry of sysEntries) {
      if (!sysEntry.isDirectory() || sysEntry.name.startsWith('.') || sysEntry.name === 'screenshots') {
        continue;
      }

      const systemName = sysEntry.name;
      const sysAbs = path.join(root, systemName);
      let relEntries: fs.Dirent[];
      try {
        relEntries = fs.readdirSync(sysAbs, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const relEntry of relEntries) {
        if (!relEntry.isDirectory() || relEntry.name.startsWith('.') || relEntry.name === 'screenshots') {
          continue;
        }

        const releaseSlug = relEntry.name;
        const absReleaseDir = path.resolve(sysAbs, releaseSlug);
        if (existingLocalPaths.has(absReleaseDir)) {
          continue;
        }

        try {
          let meta: ReleaseMetadata | null = null;
          const metaPath = path.join(absReleaseDir, 'metadata.json');
          if (fs.existsSync(metaPath)) {
            try {
              meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as ReleaseMetadata;
            } catch (metaErr) {
              this.log(
                'debug',
                `Disk reconciliation skipped malformed metadata.json in ${systemName}/${releaseSlug}`,
                formatErrorDetails(metaErr),
              );
              meta = null;
            }
          }

          let coverLocalPath: string | null = null;
          const coverCandidates: string[] = [];
          if (meta?.coverLocalRelPath) {
            coverCandidates.push(path.resolve(absReleaseDir, meta.coverLocalRelPath));
          }
          for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif']) {
            coverCandidates.push(path.join(absReleaseDir, `cover${ext}`));
          }
          for (const candidate of coverCandidates) {
            if (
              candidate.startsWith(absReleaseDir + path.sep) &&
              fs.existsSync(candidate) &&
              fs.statSync(candidate).isFile()
            ) {
              coverLocalPath = candidate;
              break;
            }
          }

          const screenshotLocalPaths: string[] = [];
          const shotsDir = path.join(absReleaseDir, 'screenshots');
          if (fs.existsSync(shotsDir) && fs.statSync(shotsDir).isDirectory()) {
            const shotFiles = fs
              .readdirSync(shotsDir)
              .filter((f) => !f.startsWith('.') && !isEphemeralPartFile(f))
              .sort();
            for (const sf of shotFiles) {
              const absShot = path.join(shotsDir, sf);
              if (fs.statSync(absShot).isFile()) {
                screenshotLocalPaths.push(absShot);
              }
            }
          }

          const releaseFiles = fs
            .readdirSync(absReleaseDir, { withFileTypes: true })
            .filter(
              (de) =>
                de.isFile() &&
                !de.name.startsWith('.') &&
                !isEphemeralPartFile(de.name) &&
                de.name !== 'metadata.json' &&
                de.name !== 'scraper.db' &&
                de.name !== 'scraper.db-wal' &&
                de.name !== 'scraper.db-shm' &&
                de.name !== 'cookies.json' &&
                !/^cover\.(jpg|jpeg|png|webp|gif)$/i.test(de.name),
            )
            .map((de) => de.name)
            .sort((a, b) => a.localeCompare(b));

          if (releaseFiles.length === 0 && !meta) {
            continue;
          }

          const canonicalSys = canonicalizeSystemSlug(systemName) || systemName;
          const remotePath = `${systemName}/${releaseSlug}`;
          const remoteUrl =
            meta?.sourcePageUrl && /^https?:\/\//i.test(meta.sourcePageUrl)
              ? meta.sourcePageUrl.split('#')[0]
              : new URL(
                  `${encodeURIComponent(canonicalSys)}/${encodeURIComponent(releaseSlug)}/`,
                  baseWithSlash,
                ).toString();

          const parent = upsertCatalogRelease({
            remoteUrl,
            remotePath,
            localPath: absReleaseDir,
            systemName: canonicalSys,
            title: meta?.title || releaseSlug,
            publishedAt: meta?.publishedAt ?? null,
            remoteUpdatedAt: meta?.remoteUpdatedAt ?? null,
            status: releaseFiles.length > 0 ? 'downloaded' : 'queued',
            metadata: meta,
            coverLocalPath,
            screenshotLocalPaths,
          });
          existingLocalPaths.add(absReleaseDir);
          releasesImported += 1;

          if (canonicalSys !== 'uncategorized' && canonicalSys !== 'root') {
            reconciledSystems.add(canonicalSys);
          }

          for (const filename of releaseFiles) {
            const absFile = path.join(absReleaseDir, filename);
            let sizeBytes = 0;
            let mtimeIso = new Date().toISOString();
            try {
              const st = fs.statSync(absFile);
              sizeBytes = st.size;
              mtimeIso = st.mtime.toISOString();
            } catch (statErr) {
              this.log(
                'debug',
                `Disk reconciliation failed to stat file ${absFile}`,
                formatErrorDetails(statErr),
              );
              continue;
            }

            const fileRemoteUrl = `${remoteUrl}#${encodeURIComponent(filename)}`;
            upsertReleaseFile({
              releaseId: parent.id,
              remoteUrl: fileRemoteUrl,
              downloadUrl: fileRemoteUrl,
              remotePath: `${remotePath}/${filename}`,
              localPath: absFile,
              filename,
              displayLabel: filename,
              fileSizeBytes: sizeBytes,
              status: 'downloaded',
              downloadedAt: mtimeIso,
            });
            filesImported += 1;
          }
        } catch (dirErr) {
          // Skip malformed on-disk directory without blocking startup
          this.log(
            'debug',
            `Disk reconciliation skipped directory ${systemName}/${releaseSlug}`,
            formatErrorDetails(dirErr),
          );
        }
      }
    }

    if (reconciledSystems.size > 0) {
      saveDiscoveredSystems(Array.from(reconciledSystems));
    }

    if (releasesImported > 0) {
      this.log(
        'info',
        `Reconciled ${releasesImported} existing release(s) (${filesImported} file(s)) from local disk into catalog`,
        root,
      );
    }

    return { releasesImported, filesImported };
  }

  private log(level: LogLevel, message: string, detail: string | null = null, runId: number | null = null): void {
    if (level === 'debug') {
      if (!isDebugLoggingEnabled()) return;
      logServer('SCRAPER', 'debug', message, detail);
    }
    const entry = appendActivityLog(level, message, detail, runId);
    this.emit('log', entry);
  }

  recordClientDebugLog(scope: string, message: string, detail: string | null = null): void {
    if (!isDebugLoggingEnabled()) return;
    const cleanScope = scope.trim().toUpperCase() || 'CLIENT';
    logServer(cleanScope, 'debug', message, detail);
    const entry = appendActivityLog('debug', `[${cleanScope}] ${message}`, detail, this.activeRun?.id ?? null);
    this.emit('log', entry);
  }

  private emitStatus(): void {
    this.emit('status', this.getStatusSnapshot());
  }

  private emitCatalogUpdated(reason: string, itemId?: number): void {
    if (reason === 'file_downloaded' || reason === 'deleted' || reason === 'file_skipped') {
      this.diskStatsDirty = true;
    }
    this.emit('catalog_updated', {
      reason,
      itemId: itemId ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  evaluateAndEmitAchievements(): void {
    try {
      const unlocks = evaluateAchievements({ silent: false });
      if (unlocks.length > 0) {
        const snapshot = getAchievementsSnapshot();
        this.emit('achievement_unlocked', {
          unlocks,
          summary: snapshot.summary,
        });
      }
    } catch {
      // Never allow achievement evaluation errors to interrupt sync operations
    }
  }

  recordServerAchievementCounter(
    key: string,
    value = 1,
    mode: 'increment' | 'max' | 'set' = 'increment',
  ): void {
    try {
      recordAchievementCounter(key, value, mode);
      this.evaluateAndEmitAchievements();
    } catch {
      // Non-fatal
    }
  }

  handleClientAchievementEvent(payload: ClientAchievementEventPayload) {
    const result = recordClientAchievementEvent(payload);
    if (result.newlyUnlocked.length > 0) {
      this.emit('achievement_unlocked', {
        unlocks: result.newlyUnlocked,
        summary: result.snapshot.summary,
      });
    }
    return result;
  }

  notifyInstalledStateChanged(): void {
    this.emitCatalogUpdated('installed_updated');
    this.emitStatus();
    this.evaluateAndEmitAchievements();
  }

  private formatRelativePhasePath(targetUrl: string, baseUrl: string): string {
    try {
      const target = new URL(targetUrl);
      const base = new URL(baseUrl);
      if (target.origin === base.origin) {
        const basePrefix = base.pathname.replace(/\/+$/, '');
        let rel = target.pathname;
        if (basePrefix && rel.toLowerCase().startsWith(basePrefix.toLowerCase())) {
          rel = rel.slice(basePrefix.length);
        }
        const suffix = `${rel}${target.search}`;
        return suffix.startsWith('/') ? suffix : `/${suffix}`;
      }
      return `${target.pathname}${target.search}` || '/';
    } catch {
      const stripped = baseUrl.replace(/\/+$/, '');
      if (stripped && targetUrl.startsWith(stripped)) {
        const rest = targetUrl.slice(stripped.length);
        return rest.startsWith('/') ? rest : `/${rest}`;
      }
      return targetUrl;
    }
  }

  private resolveReleaseDir(item: RepositoryItemRecord, root: string): string | null {
    if (item.localPath) {
      const candidate = path.resolve(item.localPath);
      if (candidate.startsWith(root + path.sep) && candidate !== root) {
        try {
          if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
            return path.dirname(candidate);
          }
        } catch {
          // Use candidate path directly
        }
        return candidate;
      }
    }
    const firstFile = item.files.find((f) => Boolean(f.localPath));
    if (firstFile?.localPath) {
      const dir = path.dirname(path.resolve(firstFile.localPath));
      if (dir.startsWith(root + path.sep) && dir !== root) {
        return dir;
      }
    }
    return null;
  }

  reconfigureScheduler(config?: ScraperConfigInternal): void {
    const cfg = config || getInternalConfig();
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    this.rateLimiter.updateBounds({
      baseDelayMs: cfg.baseDelayMs,
      minDelayMs: cfg.minDelayMs,
      maxDelayMs: cfg.maxDelayMs,
      backoffMultiplier: cfg.backoffMultiplier,
    });

    if (cfg.scheduleEnabled && cfg.cronSchedule) {
      try {
        this.cronJob = new Cron(cfg.cronSchedule, () => {
          if (!this.shuttingDown && !this.activeRun) {
            const latestCfg = getInternalConfig();
            const auth = this.client.getAuthStatus(latestCfg, getLastAuthenticatedAt());
            if (!auth.hasCompletedLogin) {
              this.log(
                'warn',
                'Scheduled sync skipped: app has not completed an authenticated login yet',
                'Verify credentials in Operations first',
              );
              return;
            }
            void this.startRun('scheduled', 'incremental');
          }
        });
        const next = this.cronJob.nextRun();
        this.log(
          'info',
          `Cron scheduler active (${cfg.cronSchedule})`,
          next ? `Next run at ${next.toISOString()}` : null,
        );
      } catch (err) {
        this.log('error', `Invalid cron schedule "${cfg.cronSchedule}"`, String(err));
      }
    } else {
      this.log('info', 'Cron scheduler paused; ad-hoc mode only');
    }
    this.emitStatus();
  }

  updateConfiguration(input: ConfigUpdateInput): ScraperConfigPublic {
    return this.updateConfigurationWithMeta(input).config;
  }

  updateConfigurationWithMeta(input: ConfigUpdateInput): {
    config: ScraperConfigPublic;
    liveSyncReload: LiveSyncReloadReceipt | null;
  } {
    const prevCfg = getInternalConfig();
    const prevAuthAt = getLastAuthenticatedAt();
    const updated = updateConfig(input);
    const nextCfg = getInternalConfig();
    const nextAuthAt = getLastAuthenticatedAt();
    if (prevAuthAt && !nextAuthAt) {
      this.client.resetAuthSession(true);
    }
    this.reconfigureScheduler(nextCfg);

    const ruleDiff = diffSyncRules(prevCfg, nextCfg, nextCfg.discoveredSystems);
    const runtimeDiff = diffRuntimeSyncSettings(prevCfg, nextCfg);
    let liveSyncReload: LiveSyncReloadReceipt | null = null;

    if (ruleDiff.changed) {
      this.syncRulesRevision += 1;
    }
    if (ruleDiff.changed || runtimeDiff.changed) {
      this.runtimeConfigRevision += 1;
      this.notifyRuntimeConfigChanged();
    }

    if (this.activeRun) {
      const rulesApplied = ruleDiff.changed && isSyncRunEligibleForLiveRuleReload(this.activeRun);
      const networkRuntimeApplied =
        runtimeDiff.pacingChanged ||
        runtimeDiff.concurrencyChanged ||
        runtimeDiff.chunkingChanged ||
        runtimeDiff.networkChanged;
      const autoDownloadApplied =
        runtimeDiff.autoDownloadChanged &&
        this.activeRun.triggerType === 'scheduled' &&
        this.activeRun.mode !== 'full';
      const runtimeApplied = networkRuntimeApplied || autoDownloadApplied;

      if (rulesApplied || runtimeApplied) {
        const activeMode: 'incremental' | 'full' | 'download' | 'retry' =
          this.activeRun.triggerType === 'download'
            ? 'download'
            : this.activeRun.triggerType === 'retry'
              ? 'retry'
              : this.activeRun.mode === 'full'
                ? 'full'
                : 'incremental';
        const activeDryRun = Boolean(this.activeRun.dryRun || this.activeRun.mode === 'dry_run');
        const kind: 'rules' | 'runtime' | 'both' =
          rulesApplied && runtimeApplied ? 'both' : rulesApplied ? 'rules' : 'runtime';

        const summaryParts: string[] = [];
        if (rulesApplied) summaryParts.push(ruleDiff.changeSummary);
        if (runtimeApplied) summaryParts.push(runtimeDiff.changeSummary);
        const combinedSummary = summaryParts.join(' · ');

        liveSyncReload = {
          applied: true,
          runId: this.activeRun.id,
          runMode: activeMode,
          dryRun: activeDryRun,
          kind,
          changeSummary: combinedSummary,
          scopeSummary: ruleDiff.scopeSummary,
        };

        if (kind === 'rules') {
          this.log(
            'info',
            `[Live Rules] Sync Rules updated mid-run — applying live after current file`,
            `${ruleDiff.changeSummary} · Scope: ${ruleDiff.scopeSummary}`,
            this.activeRun.id,
          );
        } else if (kind === 'runtime') {
          this.log(
            'info',
            `[Live Sync] Runtime pacing & transfer settings updated mid-run — applying live now`,
            runtimeDiff.changeSummary,
            this.activeRun.id,
          );
        } else {
          this.log(
            'info',
            `[Live Sync] Sync Rules & runtime settings updated mid-run — applying live now`,
            `${combinedSummary} · Scope: ${ruleDiff.scopeSummary}`,
            this.activeRun.id,
          );
        }
      }
    }

    if (ruleDiff.changed) {
      this.emitCatalogUpdated('sync_rules_updated');
    }

    // When consoles are added outside an active Full/Incremental Sync, immediately kick off
    // background auto-indexing for any newly added unindexed consoles (or queue it behind an
    // active filtered index / download queue) so Catalog populates right away.
    const activeRunHandlesLiveIndex =
      this.activeRun !== null && isSyncRunEligibleForLiveRuleReload(this.activeRun);
    if (
      ruleDiff.changed &&
      ruleDiff.consolesChanged &&
      !this.shuttingDown &&
      !activeRunHandlesLiveIndex
    ) {
      if (this.indexerState.active) {
        if (this.indexerState.scope === 'filtered') {
          this.pendingAutoIndexAfterCurrent = true;
        }
      } else {
        void this.startCatalogIndex('filtered', { auto: true }).catch(() => undefined);
      }
    }

    if (input.lastWatermarkAt !== undefined) {
      this.log(
        'info',
        updated.lastWatermarkAt
          ? `Incremental cutoff watermark updated to ${updated.lastWatermarkAt}`
          : 'Incremental cutoff watermark cleared (using default 24h lookback)',
      );
    } else if (!liveSyncReload) {
      this.log('info', 'Service configuration saved');
    }
    this.emitStatus();
    try {
      if (input.scheduleEnabled && updated.scheduleEnabled) {
        recordAchievementCounter('autopilot_saved', 1, 'set');
      }
      if (
        (input.systemFilter !== undefined && input.systemFilter.trim().length > 0) ||
        (Array.isArray(input.allowedReleaseTypes) && input.allowedReleaseTypes.length > 0)
      ) {
        recordAchievementCounter('sync_rules_customized', 1, 'set');
      }
      if (input.storageFolderConfig !== undefined) {
        recordAchievementCounter('folder_mappings_customized', 1, 'set');
      }
      if (
        input.baseDelayMs !== undefined ||
        input.minDelayMs !== undefined ||
        input.maxDelayMs !== undefined ||
        input.maxConcurrency !== undefined ||
        input.downloadChunkConcurrency !== undefined ||
        input.downloadChunkMinSizeMb !== undefined
      ) {
        recordAchievementCounter('pacing_customized', 1, 'set');
      }
      this.evaluateAndEmitAchievements();
    } catch {
      // Non-fatal
    }
    return { config: updated, liveSyncReload };
  }

  async testAuth(): Promise<AuthTestResult> {
    const cfg = getInternalConfig();
    this.log('info', `Running connection & authentication probe against ${cfg.baseUrl}`);
    const result = await this.client.testAuthAndDiscovery(cfg);
    if (result.authenticated) {
      const ts = recordSuccessfulLogin();
      this.client.setPersistedLastAuthenticatedAt(ts);
      recordAchievementCounter('auth_verified', 1, 'set');
    }
    if (result.discoveredSystems.length > 0) {
      saveDiscoveredSystems(result.discoveredSystems);
    }
    this.log(
      result.success ? 'info' : 'warn',
      `Probe complete: ${result.message}`,
      `Latency ${result.latencyMs}ms`,
    );
    this.emitStatus();
    if (result.authenticated) {
      this.evaluateAndEmitAchievements();
    }
    if (result.authenticated && !this.shuttingDown) {
      void this.startCatalogIndex('filtered', { auto: true }).catch(() => undefined);
    }
    return result;
  }

  private checkDownloadDirWritable(downloadDir: string, ttlMs = 15_000): boolean {
    const now = Date.now();
    if (
      this.lastWritableCheck &&
      this.lastWritableCheck.downloadDir === downloadDir &&
      now - this.lastWritableCheck.checkedAtMs < ttlMs
    ) {
      return this.lastWritableCheck.writable;
    }
    let writable = false;
    try {
      fs.mkdirSync(downloadDir, { recursive: true });
      const probeFile = path.join(downloadDir, `.probe-${process.pid}`);
      fs.writeFileSync(probeFile, 'ok');
      fs.unlinkSync(probeFile);
      writable = true;
    } catch {
      writable = false;
    }
    this.lastWritableCheck = { downloadDir, checkedAtMs: now, writable };
    return writable;
  }

  private collectLightweightStorageMetadata(downloadDir: string): {
    dataDir: string;
    writable: boolean;
    sqliteBytes: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
  } {
    const dataDir = getDataDir();
    const writable = this.checkDownloadDirWritable(downloadDir);

    let sqliteBytes = 0;
    for (const dbFile of ['scraper.db', 'scraper.db-wal', 'scraper.db-shm']) {
      try {
        const st = fs.statSync(path.join(dataDir, dbFile));
        if (st.isFile()) {
          sqliteBytes += st.size;
        }
      } catch {
        // Ignore absent WAL/SHM files
      }
    }

    let diskFreeBytes: number | null = null;
    let diskTotalBytes: number | null = null;
    try {
      const fsStat = fs.statfsSync(downloadDir);
      diskFreeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
      diskTotalBytes = Number(fsStat.blocks) * Number(fsStat.bsize);
    } catch {
      // Optional on platforms without statfsSync
    }

    return { dataDir, writable, sqliteBytes, diskFreeBytes, diskTotalBytes };
  }

  private async collectStorageAndSystemDiskStatsAsync(downloadDir: string): Promise<{
    storage: StorageStats;
    systemDiskUsage: Map<string, { filesOnDisk: number; bytesOnDisk: number }>;
  }> {
    const { dataDir, writable, sqliteBytes, diskFreeBytes, diskTotalBytes } =
      this.collectLightweightStorageMetadata(downloadDir);

    let totalFilesOnDisk = 0;
    let totalBytesOnDisk = 0;
    const systemDiskUsage = new Map<string, { filesOnDisk: number; bytesOnDisk: number }>();
    let visitedDirs = 0;

    const walk = async (dir: string, depth = 0, topLevelSystem: string | null = null): Promise<void> => {
      if (depth > 6 || this.shuttingDown) return;
      visitedDirs += 1;
      if (visitedDirs % 25 === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (this.shuttingDown) return;
        if (
          entry.name.startsWith('.') ||
          isEphemeralPartFile(entry.name) ||
          entry.name === 'scraper.db' ||
          entry.name === 'scraper.db-wal' ||
          entry.name === 'scraper.db-shm' ||
          entry.name === 'cookies.json' ||
          entry.name === 'metadata.json' ||
          entry.name === 'screenshots' ||
          /^cover\.(jpg|jpeg|png|webp|gif)$/i.test(entry.name)
        ) {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const nextSystem = depth === 0 ? entry.name.toLowerCase() : topLevelSystem;
          await walk(full, depth + 1, nextSystem);
        } else if (entry.isFile()) {
          try {
            const st = await fs.promises.stat(full);
            totalFilesOnDisk += 1;
            totalBytesOnDisk += st.size;
            if (topLevelSystem) {
              const bucket = systemDiskUsage.get(topLevelSystem);
              if (bucket) {
                bucket.filesOnDisk += 1;
                bucket.bytesOnDisk += st.size;
              } else {
                systemDiskUsage.set(topLevelSystem, {
                  filesOnDisk: 1,
                  bytesOnDisk: st.size,
                });
              }
            }
          } catch {
            // Skip unreadable entry
          }
        }
      }
    };

    try {
      await fs.promises.access(downloadDir);
      await walk(downloadDir);
    } catch {
      // Directory does not exist yet
    }

    return {
      storage: {
        downloadDir,
        dataDir,
        writable,
        totalFilesOnDisk,
        totalBytesOnDisk,
        sqliteBytes,
        diskFreeBytes,
        diskTotalBytes,
      },
      systemDiskUsage,
    };
  }

  private scheduleDiskStatsRefresh(downloadDir: string, force = false): void {
    if (this.shuttingDown || this.diskStatsRefreshPromise) return;
    const now = Date.now();
    const cached = this.diskStatsCache;
    const sameDir = cached?.downloadDir === downloadDir;
    const ageMs = cached ? now - cached.collectedAtMs : Infinity;
    const minIntervalMs = this.diskStatsDirty ? 10_000 : 30_000;
    if (!force && sameDir && ageMs < minIntervalMs) {
      return;
    }

    this.diskStatsDirty = false;
    const wasCold = !this.diskStatsCache || this.diskStatsCache.downloadDir !== downloadDir;
    this.diskStatsRefreshPromise = this.collectStorageAndSystemDiskStatsAsync(downloadDir)
      .then((result) => {
        this.diskStatsCache = {
          downloadDir,
          collectedAtMs: Date.now(),
          storage: result.storage,
          systemDiskUsage: result.systemDiskUsage,
        };
        if (wasCold && !this.shuttingDown) {
          this.emitStatus();
        }
      })
      .catch(() => {
        // Keep last good disk stats snapshot on transient I/O errors
      })
      .finally(() => {
        this.diskStatsRefreshPromise = null;
      });
  }

  private collectStorageAndSystemDiskStats(downloadDir: string): {
    storage: StorageStats;
    systemDiskUsage: Map<string, { filesOnDisk: number; bytesOnDisk: number }>;
  } {
    this.scheduleDiskStatsRefresh(downloadDir, false);
    if (this.diskStatsCache && this.diskStatsCache.downloadDir === downloadDir) {
      return {
        storage: {
          ...this.diskStatsCache.storage,
          writable: this.checkDownloadDirWritable(downloadDir),
        },
        systemDiskUsage: this.diskStatsCache.systemDiskUsage,
      };
    }

    const { dataDir, writable, sqliteBytes, diskFreeBytes, diskTotalBytes } =
      this.collectLightweightStorageMetadata(downloadDir);
    return {
      storage: {
        downloadDir,
        dataDir,
        writable,
        totalFilesOnDisk: 0,
        totalBytesOnDisk: 0,
        sqliteBytes,
        diskFreeBytes,
        diskTotalBytes,
      },
      systemDiskUsage: new Map(),
    };
  }

  getReadinessSnapshot(): { podId: string; writable: boolean; schemaVersion: number } {
    const cfg = getInternalConfig();
    const schema = getSchemaMigrationReport();
    return {
      podId: POD_ID,
      writable: this.checkDownloadDirWritable(cfg.downloadDir),
      schemaVersion: schema.currentVersion,
    };
  }

  getStorageStats(downloadDir: string): StorageStats {
    return this.collectStorageAndSystemDiskStats(downloadDir).storage;
  }

  listFsTree(relativeSubpath = ''): { currentPath: string; nodes: FsTreeNode[] } {
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const target = path.resolve(root, relativeSubpath.replace(/^\/+/, ''));

    if (!target.startsWith(root)) {
      throw new Error('Path traversal outside DOWNLOAD_DIR is not allowed');
    }

    if (!fs.existsSync(target)) {
      return { currentPath: relativeSubpath, nodes: [] };
    }

    const entries = fs.readdirSync(target, { withFileTypes: true });
    const nodes: FsTreeNode[] = [];

    for (const entry of entries) {
      if (
        entry.name.startsWith('.') ||
        isEphemeralPartFile(entry.name) ||
        entry.name === 'scraper.db' ||
        entry.name === 'scraper.db-wal' ||
        entry.name === 'scraper.db-shm' ||
        entry.name === 'cookies.json'
      ) {
        continue;
      }
      const full = path.join(target, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      try {
        const st = fs.statSync(full);
        if (entry.isDirectory()) {
          const childrenCount = fs.readdirSync(full).filter((n) => !n.startsWith('.')).length;
          nodes.push({
            name: entry.name,
            relativePath: rel,
            type: 'directory',
            sizeBytes: 0,
            modifiedAt: st.mtime.toISOString(),
            childrenCount,
          });
        } else if (entry.isFile()) {
          const archiveFormat = detectArchiveFormat(full);
          const isArchive = archiveFormat !== 'raw';
          nodes.push({
            name: entry.name,
            relativePath: rel,
            type: 'file',
            sizeBytes: st.size,
            modifiedAt: st.mtime.toISOString(),
            ...(isArchive ? { isArchive: true, archiveFormat } : {}),
          });
        }
      } catch {
        // Skip inaccessible entries
      }
    }

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      currentPath: path.relative(root, target).split(path.sep).join('/'),
      nodes,
    };
  }

  deleteCatalogItems(ids: number[]): { deletedCount: number; filesRemoved: number } {
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const removedItems = deleteRepositoryItemsByIds(ids);
    let filesRemoved = 0;

    for (const item of removedItems) {
      for (const file of item.files) {
        if (!file.localPath) continue;
        const target = path.resolve(file.localPath);
        if (target.startsWith(root + path.sep)) {
          if (fs.existsSync(target)) {
            try {
              fs.rmSync(target, { recursive: true, force: true });
              filesRemoved += 1;
            } catch (rmErr) {
              this.log('debug', `Non-fatal error deleting catalog file ${target}`, formatErrorDetails(rmErr));
            }
          }
          for (const sidecar of [`${target}.part`, `${target}.part.meta.json`, `${target}.part.meta.json.tmp`]) {
            if (fs.existsSync(sidecar)) {
              fs.rmSync(sidecar, { force: true });
            }
          }
        }
      }

      const releaseDir = this.resolveReleaseDir(item, root);
      if (
        releaseDir &&
        releaseDir.startsWith(root + path.sep) &&
        releaseDir !== root &&
        countSiblingItemsInDir(releaseDir) === 0
      ) {
        try {
          fs.rmSync(path.join(releaseDir, 'metadata.json'), { force: true });
          fs.rmSync(path.join(releaseDir, 'screenshots'), { recursive: true, force: true });
          for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']) {
            fs.rmSync(path.join(releaseDir, `cover${ext}`), { force: true });
          }
          if (fs.existsSync(releaseDir) && fs.readdirSync(releaseDir).length === 0) {
            fs.rmdirSync(releaseDir);
          }
        } catch (cleanupErr) {
          this.log('debug', `Non-fatal error cleaning release directory ${releaseDir}`, formatErrorDetails(cleanupErr));
        }
      }
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']) {
        fs.rmSync(path.join(this.getCoverCacheDir(), `${item.id}${ext}`), { force: true });
      }
      fs.rmSync(this.getScreenshotCacheDir(item.id), { recursive: true, force: true });
    }

    if (removedItems.length > 0) {
      this.log(
        'info',
        `Deleted ${removedItems.length} catalog release(s) (${filesRemoved} file(s) removed from disk)`,
      );
      this.emitCatalogUpdated('items_deleted');
      this.emitStatus();
    }

    return {
      deletedCount: removedItems.length,
      filesRemoved,
    };
  }

  private getCoverCacheDir(): string {
    return path.join(getDataDir(), 'cache', 'covers');
  }

  private getScreenshotCacheDir(itemId?: number): string {
    const base = path.join(getDataDir(), 'cache', 'screenshots');
    return itemId !== undefined ? path.join(base, String(itemId)) : base;
  }

  resolveItemAssetFile(
    itemId: number,
    kind: 'cover' | 'screenshot',
    index = 0,
  ): { absPath: string; filename: string } | null {
    const item = getRepositoryItemById(itemId);
    if (!item) return null;
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const cacheDir = path.resolve(this.getCoverCacheDir());
    const releaseDir = this.resolveReleaseDir(item, root);

    if (kind === 'cover') {
      const candidates: string[] = [];
      if (item.coverLocalPath) candidates.push(path.resolve(item.coverLocalPath));
      if (releaseDir && item.metadata?.coverLocalRelPath) {
        candidates.push(path.resolve(releaseDir, item.metadata.coverLocalRelPath));
      }
      if (releaseDir) {
        for (const ext of ['.jpg', '.png', '.webp', '.avif', '.gif', '.bmp']) {
          candidates.push(path.join(releaseDir, `cover${ext}`));
        }
      }
      for (const ext of ['.jpg', '.png', '.webp', '.avif', '.gif', '.bmp']) {
        candidates.push(path.join(cacheDir, `${itemId}${ext}`));
      }
      for (const candidate of candidates) {
        const insideRelease = Boolean(releaseDir && candidate.startsWith(releaseDir + path.sep));
        const insideCache = candidate.startsWith(cacheDir + path.sep);
        if ((insideRelease || insideCache) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { absPath: candidate, filename: path.basename(candidate) };
        }
      }
      return null;
    }

    if (!Number.isInteger(index) || index < 0) return null;

    const validReleaseDir =
      releaseDir && (releaseDir.startsWith(root + path.sep) || releaseDir === root) ? releaseDir : null;
    const knownExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp'];
    const paddedIndex = String(index + 1).padStart(2, '0');

    if (validReleaseDir) {
      const relShots = item.metadata?.screenshotLocalRelPaths || [];
      if (index < relShots.length) {
        const candidate = path.resolve(validReleaseDir, relShots[index]);
        if (candidate.startsWith(validReleaseDir + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { absPath: candidate, filename: path.basename(candidate) };
        }
      }

      const shotsDir = path.join(validReleaseDir, 'screenshots');
      for (const ext of knownExts) {
        const numberedCandidate = path.join(shotsDir, `${paddedIndex}${ext}`);
        if (fs.existsSync(numberedCandidate) && fs.statSync(numberedCandidate).isFile()) {
          return { absPath: numberedCandidate, filename: path.basename(numberedCandidate) };
        }
      }
    }

    const screenshotCacheDir = path.resolve(this.getScreenshotCacheDir(itemId));
    for (const ext of knownExts) {
      const cachedCandidate = path.join(screenshotCacheDir, `${paddedIndex}${ext}`);
      if (
        cachedCandidate.startsWith(screenshotCacheDir + path.sep) &&
        fs.existsSync(cachedCandidate) &&
        fs.statSync(cachedCandidate).isFile()
      ) {
        return { absPath: cachedCandidate, filename: path.basename(cachedCandidate) };
      }
    }

    if (validReleaseDir) {
      const shotsDir = path.join(validReleaseDir, 'screenshots');
      if (fs.existsSync(shotsDir)) {
        const files = fs
          .readdirSync(shotsDir)
          .filter((f) => !f.startsWith('.') && !isEphemeralPartFile(f))
          .sort();
        if (index < files.length) {
          const candidate = path.join(shotsDir, files[index]);
          return { absPath: candidate, filename: files[index] };
        }
      }
    }
    return null;
  }

  private async acquireLazyCoverSlot(): Promise<void> {
    if (this.activeLazyCoverSlots < 2) {
      this.activeLazyCoverSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.lazyCoverWaiters.push(resolve);
    });
    this.activeLazyCoverSlots += 1;
  }

  private releaseLazyCoverSlot(): void {
    this.activeLazyCoverSlots = Math.max(0, this.activeLazyCoverSlots - 1);
    const next = this.lazyCoverWaiters.shift();
    if (next) next();
  }

  async ensureLazyCoverAsset(itemId: number): Promise<void> {
    if (this.resolveItemAssetFile(itemId, 'cover', 0)) return;
    const inflight = this.inFlightLazyCovers.get(itemId);
    if (inflight) return inflight;

    const item = getRepositoryItemById(itemId);
    const coverUrl = item?.metadata?.coverUrl;
    if (!item || !coverUrl) return;

    const task = (async () => {
      await this.acquireLazyCoverSlot();
      try {
        if (this.resolveItemAssetFile(itemId, 'cover', 0)) return;
        const cfg = getInternalConfig();
        const auth = this.client.getAuthStatus(cfg, getLastAuthenticatedAt());
        if (!auth.authenticated && cfg.username && cfg.password) {
          await this.client.login(cfg).catch(() => undefined);
        }
        const cacheDir = this.getCoverCacheDir();
        fs.mkdirSync(cacheDir, { recursive: true });
        const targetBase = path.join(cacheDir, String(itemId));
        const savedPath = await this.client.fetchCoverToFile(
          [coverUrl],
          item.metadata?.sourcePageUrl || cfg.baseUrl,
          targetBase,
          cfg,
        );
        if (savedPath) {
          updateCatalogCoverPath(itemId, savedPath);
        }
      } catch (err) {
        logServer('ASSET', 'debug', `Lazy cover fetch skipped for itemId=${itemId}`, formatErrorDetails(err));
      } finally {
        this.releaseLazyCoverSlot();
        this.inFlightLazyCovers.delete(itemId);
      }
    })();

    this.inFlightLazyCovers.set(itemId, task);
    return task;
  }

  private async acquireLazyScreenshotSlot(): Promise<void> {
    if (this.activeLazyScreenshotSlots < 3) {
      this.activeLazyScreenshotSlots += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.lazyScreenshotWaiters.push(resolve);
    });
    this.activeLazyScreenshotSlots += 1;
  }

  private releaseLazyScreenshotSlot(): void {
    this.activeLazyScreenshotSlots = Math.max(0, this.activeLazyScreenshotSlots - 1);
    const next = this.lazyScreenshotWaiters.shift();
    if (next) next();
  }

  async ensureLazyScreenshotAsset(
    itemId: number,
    index: number,
    isCancelled?: () => boolean,
  ): Promise<void> {
    if (!Number.isInteger(index) || index < 0) return;
    if (this.resolveItemAssetFile(itemId, 'screenshot', index)) return;
    const key = `${itemId}:${index}`;
    const inflight = this.inFlightLazyScreenshots.get(key);
    if (inflight) return inflight;

    const item = getRepositoryItemById(itemId);
    const candidateUrls =
      item?.metadata?.screenshotCandidates?.[index]?.length
        ? item.metadata.screenshotCandidates[index]
        : item?.metadata?.screenshotUrls?.[index]
          ? [item.metadata.screenshotUrls[index]]
          : [];
    if (!item || candidateUrls.length === 0) return;

    const task = (async () => {
      await this.acquireLazyScreenshotSlot();
      try {
        if (isCancelled?.()) return;
        if (this.resolveItemAssetFile(itemId, 'screenshot', index)) return;

        const cfg = getInternalConfig();
        const auth = this.client.getAuthStatus(cfg, getLastAuthenticatedAt());
        if (!auth.authenticated && cfg.username && cfg.password) {
          await this.client.login(cfg).catch(() => undefined);
        }

        const root = path.resolve(cfg.downloadDir);
        const releaseDir = item.status !== 'available' ? this.resolveReleaseDir(item, root) : null;
        const targetDir =
          releaseDir && fs.existsSync(releaseDir)
            ? path.join(releaseDir, 'screenshots')
            : this.getScreenshotCacheDir(itemId);
        fs.mkdirSync(targetDir, { recursive: true });
        const targetBase = path.join(targetDir, String(index + 1).padStart(2, '0'));

        await this.client.fetchCoverToFile(
          candidateUrls,
          item.metadata?.sourcePageUrl || item.remoteUrl || cfg.baseUrl,
          targetBase,
          cfg,
        );
      } catch (err) {
        logServer(
          'ASSET',
          'debug',
          `Lazy screenshot fetch skipped for itemId=${itemId} index=${index}`,
          formatErrorDetails(err),
        );
      } finally {
        this.releaseLazyScreenshotSlot();
        this.inFlightLazyScreenshots.delete(key);
      }
    })();

    this.inFlightLazyScreenshots.set(key, task);
    return task;
  }

  resolveItemFileContext(
    itemId: number,
    fileId?: number,
  ): { item: RepositoryItemRecord; file: ReleaseFileRecord; absPath: string; cfg: ScraperConfigInternal } | null {
    const item = getRepositoryItemById(itemId);
    if (!item) return null;
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);

    let targetFile: ReleaseFileRecord | null = null;
    if (fileId !== undefined && Number.isInteger(fileId) && fileId > 0) {
      targetFile = item.files.find((f) => f.id === fileId) || null;
      if (!targetFile) {
        const direct = getReleaseFileById(fileId);
        if (direct && direct.releaseId === item.id) {
          targetFile = direct;
        }
      }
    } else {
      targetFile =
        item.files.find(
          (f) =>
            (f.status === 'downloaded' || f.status === 'skipped') &&
            f.localPath &&
            fs.existsSync(path.resolve(f.localPath)) &&
            fs.statSync(path.resolve(f.localPath)).isFile(),
        ) ||
        item.files.find(
          (f) =>
            f.localPath &&
            fs.existsSync(path.resolve(f.localPath)) &&
            fs.statSync(path.resolve(f.localPath)).isFile(),
        ) ||
        null;
    }

    if (!targetFile || !targetFile.localPath) {
      logServer(
        'ARCHIVE',
        'debug',
        `resolveItemFileContext: no target file with localPath (itemId=${itemId}, fileId=${fileId ?? 'default'}, files=${item.files.length})`,
      );
      return null;
    }
    const absPath = path.resolve(targetFile.localPath);
    if (!absPath.startsWith(root + path.sep)) {
      logServer(
        'ARCHIVE',
        'debug',
        `resolveItemFileContext: rejected path outside DOWNLOAD_DIR`,
        `itemId=${itemId}, fileId=${targetFile.id}, absPath="${absPath}", root="${root}"`,
      );
      return null;
    }
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
      logServer(
        'ARCHIVE',
        'debug',
        `resolveItemFileContext: file missing or not regular file on disk`,
        `itemId=${itemId}, fileId=${targetFile.id}, absPath="${absPath}"`,
      );
      return null;
    }
    return { item, file: targetFile, absPath, cfg };
  }

  resolveItemRomFile(itemId: number, fileId?: number): { absPath: string; filename: string } | null {
    const ctx = this.resolveItemFileContext(itemId, fileId);
    if (!ctx) return null;
    return { absPath: ctx.absPath, filename: ctx.file.filename || path.basename(ctx.absPath) };
  }

  async inspectItemArchive(itemId: number, fileId?: number): Promise<ArchiveInspectResult | null> {
    const ctx = this.resolveItemFileContext(itemId, fileId);
    if (!ctx) return null;
    try {
      return await inspectArchiveForItem(ctx.item, ctx.file, ctx.absPath, {
        romNamingTemplate: ctx.cfg.romNamingTemplate,
        romNamingTypeOverrides: ctx.cfg.romNamingTypeOverrides,
        romSanitizeFat32: ctx.cfg.romSanitizeFat32,
        romMaxFilenameLen: ctx.cfg.romMaxFilenameLen,
      });
    } catch (err) {
      logServer(
        'ARCHIVE',
        'debug',
        `inspectItemArchive failed for "${ctx.file.filename}" (itemId=${itemId}, fileId=${ctx.file.id})`,
        formatErrorDetails(err),
      );
      throw err;
    }
  }

  resolveFsFilePath(relativePath: string): {
    absPath: string;
    relativePath: string;
    filename: string;
    sizeBytes: number;
  } {
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const cleaned = relativePath.replace(/^\/+/, '');
    if (!cleaned) {
      throw new Error('File relative path is required');
    }
    const target = path.resolve(root, cleaned);
    if (!target.startsWith(root + path.sep)) {
      throw new Error('Path traversal outside DOWNLOAD_DIR is not allowed');
    }
    const rel = path.relative(root, target).split(path.sep).join('/');
    const segments = rel.split('/');
    const leaf = segments[segments.length - 1] || '';
    if (
      segments.some((seg) => !seg || seg.startsWith('.')) ||
      isEphemeralPartFile(leaf) ||
      leaf === 'scraper.db' ||
      leaf === 'scraper.db-wal' ||
      leaf === 'scraper.db-shm' ||
      leaf === 'cookies.json'
    ) {
      throw new Error('Selected file is not downloadable');
    }
    if (!fs.existsSync(target)) {
      throw new Error('File not found on disk');
    }
    const realRoot = fs.realpathSync(root);
    const realTarget = fs.realpathSync(target);
    if (!realTarget.startsWith(realRoot + path.sep)) {
      throw new Error('Path traversal outside DOWNLOAD_DIR is not allowed');
    }
    const st = fs.statSync(realTarget);
    if (!st.isFile()) {
      throw new Error('Selected path is not a file');
    }
    return {
      absPath: realTarget,
      relativePath: rel,
      filename: leaf,
      sizeBytes: st.size,
    };
  }

  resolveFsArchivePath(relativePath: string): { absPath: string; relativePath: string } {
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const cleaned = relativePath.replace(/^\/+/, '');
    if (!cleaned) {
      throw new Error('Archive relative path is required');
    }
    const target = path.resolve(root, cleaned);
    if (!target.startsWith(root + path.sep)) {
      throw new Error('Path traversal outside DOWNLOAD_DIR is not allowed');
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      throw new Error('Archive file not found on disk');
    }
    const format = detectArchiveFormat(target);
    if (format === 'raw') {
      throw new Error('Selected file is not a supported archive (.zip, .7z, .rar, .tar)');
    }
    return {
      absPath: target,
      relativePath: path.relative(root, target).split(path.sep).join('/'),
    };
  }

  async browseFsArchive(relativePath: string): Promise<{ relativePath: string; listing: ArchiveBrowseListing }> {
    const resolved = this.resolveFsArchivePath(relativePath);
    const systemHint = resolved.relativePath.split('/')[0] || null;
    const listing = await browseArchiveAtPath(resolved.absPath, systemHint);
    return { relativePath: resolved.relativePath, listing };
  }

  async previewFsArchiveEntry(relativePath: string, entryPath: string): Promise<ArchiveTextPreviewResult> {
    const resolved = this.resolveFsArchivePath(relativePath);
    return readArchiveTextPreview(resolved.absPath, entryPath);
  }

  async browseItemArchive(
    itemId: number,
    fileId?: number,
  ): Promise<{ itemId: number; fileId: number; listing: ArchiveBrowseListing } | null> {
    const ctx = this.resolveItemFileContext(itemId, fileId);
    if (!ctx) return null;
    const listing = await browseArchiveAtPath(ctx.absPath, ctx.item.systemName);
    return {
      itemId: ctx.item.id,
      fileId: ctx.file.id,
      listing,
    };
  }

  async previewItemArchiveEntry(
    itemId: number,
    entryPath: string,
    fileId?: number,
  ): Promise<ArchiveTextPreviewResult | null> {
    const ctx = this.resolveItemFileContext(itemId, fileId);
    if (!ctx) return null;
    return readArchiveTextPreview(ctx.absPath, entryPath);
  }

  async fetchItemMetadata(
    itemId: number,
    options: { forceRefreshAssets?: boolean } = {},
  ): Promise<RepositoryItemRecord> {
    const item = getRepositoryItemById(itemId);
    if (!item) {
      throw new Error(`Catalog item #${itemId} not found`);
    }
    const pageUrl = item.remoteUrl.split('#')[0];
    if (!pageUrl.startsWith('http')) {
      throw new Error('Catalog item has no remote release URL');
    }

    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null);
    if (cfg.username && cfg.password && !this.client.getAuthStatus(cfg).authenticated) {
      await this.client.login(cfg, undefined, runLogger);
    }

    const pageData = await this.client.fetchPageHtml(pageUrl, cfg, undefined, runLogger);
    if (pageData.status >= 400) {
      throw new Error(`Failed to fetch release page (HTTP ${pageData.status})`);
    }

    const wpPostIdHint = item.wpPostId ?? this.client.extractWpPostIdHint(pageData.html);
    const wpData = await this.client.fetchReleaseWpMetadata(
      pageData.finalUrl,
      wpPostIdHint,
      cfg,
      undefined,
      runLogger,
    );

    const siblingFilenames = Array.from(
      new Set([
        ...item.files.map((f) => f.filename),
        ...(wpData?.downloadHints ?? item.metadata?.downloadHints ?? []).map((h) => h.filename),
      ]),
    );
    const fileRoles = item.files.map((f) =>
      classifyFileRole(f.filename, f.displayLabel, {
        genres: wpData?.genres ?? item.genres,
        languages: wpData?.languages ?? item.languages,
        sources: wpData?.sources ?? item.sources,
        title: wpData?.title ?? item.title,
        systemName: item.systemName,
        siblingFilenames,
      }),
    );

    const extractedMeta = this.client.extractReleaseMetadata(pageData.html, pageData.finalUrl, wpData, fileRoles);
    const hydratedMeta: ReleaseMetadata = {
      ...extractedMeta,
      downloadHints:
        extractedMeta.downloadHints?.length
          ? extractedMeta.downloadHints
          : item.metadata?.downloadHints,
    };
    const releaseDir =
      this.resolveReleaseDir(item, root) ||
      path.dirname(resolveMirroredPaths(cfg.baseUrl, pageData.finalUrl, cfg.downloadDir, 'probe.zip').localPath);

    const mirrored = await this.client.mirrorReleaseAssets(
      hydratedMeta,
      releaseDir,
      cfg,
      undefined,
      runLogger,
      { forceRefresh: options.forceRefreshAssets ?? true },
    );

    const updated = updateCatalogReleaseMetadata(
      item.id,
      mirrored.metadata,
      mirrored.coverAbsPath,
      mirrored.screenshotAbsPaths,
    );
    if (!updated) {
      throw new Error(`Catalog item #${itemId} could not be updated`);
    }

    this.log(
      'info',
      `Mirrored metadata & artwork for ${updated.title}`,
      `${mirrored.coverAbsPath ? 'cover + ' : ''}${mirrored.screenshotAbsPaths.length} full-res screenshots`,
    );
    this.emitCatalogUpdated('metadata_updated', updated.id);
    this.emitStatus();
    return updated;
  }

  async hydrateItemDetails(itemId: number): Promise<RepositoryItemRecord | null> {
    const existing = getRepositoryItemById(itemId);
    if (!existing) return null;
    if (existing.metadata?.detailHydrated) {
      return existing;
    }

    const activePromise = this.inFlightDetailHydrations.get(itemId);
    if (activePromise) {
      return activePromise;
    }

    const hydrationPromise = (async (): Promise<RepositoryItemRecord | null> => {
      try {
        const pageUrl = existing.remoteUrl.split('#')[0];
        if (!pageUrl.startsWith('http')) {
          return existing;
        }

        const cfg = getInternalConfig();
        const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null);
        if (cfg.username && cfg.password && !this.client.getAuthStatus(cfg, getLastAuthenticatedAt()).authenticated) {
          await this.client.login(cfg, undefined, runLogger);
        }

        const pageData = await this.client.fetchPageHtml(pageUrl, cfg, undefined, runLogger);
        if (pageData.status >= 400) {
          throw new Error(`Failed to fetch release page (HTTP ${pageData.status})`);
        }

        const wpPostIdHint = existing.wpPostId ?? this.client.extractWpPostIdHint(pageData.html);
        const needsWpFetch =
          !existing.hasMetadata ||
          !existing.wpPostId ||
          !existing.metadata?.downloadHints?.length;
        const wpData: WpPostMetadata | null = needsWpFetch
          ? await this.client.fetchReleaseWpMetadata(pageData.finalUrl, wpPostIdHint, cfg, undefined, runLogger)
          : {
              wpPostId: existing.wpPostId ?? 0,
              wpPostType: existing.wpPostType ?? 'post',
              link: pageUrl,
              dateGmt: existing.publishedAt,
              modifiedGmt: existing.remoteUpdatedAt,
              title: existing.title,
              originalTitle: null,
              publisher: existing.publisher,
              developer: existing.developer,
              releaseYear: existing.releaseYear,
              genres: existing.genres,
              regions: existing.regions,
              languages: existing.languages,
              sources: existing.sources,
              formats: existing.metadata?.formats ?? [],
              descriptionHtml: existing.metadata?.descriptionHtml ?? '',
              coverUrl: existing.metadata?.coverUrl ?? null,
              screenshotUrls: existing.metadata?.screenshotUrls ?? [],
              downloadHints: existing.metadata?.downloadHints ?? [],
            };

        const roleInputs =
          existing.files.length > 0
            ? existing.files.map((f) => ({ filename: f.filename, displayLabel: f.displayLabel }))
            : (wpData?.downloadHints ?? existing.metadata?.downloadHints ?? []).map((h) => ({
                filename: h.filename,
                displayLabel: '',
              }));
        const roleSiblingFilenames = roleInputs.map((f) => f.filename);
        const fileRoles = roleInputs.map((f) =>
          classifyFileRole(f.filename, f.displayLabel, {
            genres: wpData?.genres ?? existing.genres,
            languages: wpData?.languages ?? existing.languages,
            sources: wpData?.sources ?? existing.sources,
            title: wpData?.title ?? existing.title,
            systemName: existing.systemName,
            siblingFilenames: roleSiblingFilenames,
          }),
        );

        const extractedMeta = this.client.extractReleaseMetadata(
          pageData.html,
          pageData.finalUrl,
          wpData,
          fileRoles,
        );
        const prevMeta = existing.metadata;
        const mergedMeta: ReleaseMetadata = {
          ...extractedMeta,
          detailHydrated: true,
          coverUrl: extractedMeta.coverUrl || prevMeta?.coverUrl || null,
          coverLocalRelPath: prevMeta?.coverLocalRelPath ?? null,
          screenshotUrls:
            extractedMeta.screenshotUrls.length > 0
              ? extractedMeta.screenshotUrls
              : (prevMeta?.screenshotUrls ?? []),
          screenshotLocalRelPaths: prevMeta?.screenshotLocalRelPaths ?? [],
          screenshotsFullResVersion: prevMeta?.screenshotsFullResVersion,
          downloadHints:
            extractedMeta.downloadHints?.length
              ? extractedMeta.downloadHints
              : prevMeta?.downloadHints,
          fetchedAt: prevMeta?.fetchedAt ?? extractedMeta.fetchedAt,
        };

        if (existing.status !== 'available') {
          const root = path.resolve(cfg.downloadDir);
          const releaseDir = this.resolveReleaseDir(existing, root);
          if (releaseDir && fs.existsSync(releaseDir)) {
            const metaPath = path.join(releaseDir, 'metadata.json');
            try {
              const { coverCandidates: _cc, screenshotCandidates: _sc, ...sidecarSafe } = mergedMeta;
              void _cc;
              void _sc;
              await fs.promises.writeFile(metaPath, JSON.stringify(sidecarSafe, null, 2), 'utf8');
            } catch {
              // Non-fatal sidecar write
            }
          }
        }

        const updated = mergeCatalogReleaseDetailMetadata(existing.id, mergedMeta);
        if (!updated) return getRepositoryItemById(itemId);

        this.emitCatalogUpdated('metadata_updated', updated.id);
        return updated;
      } finally {
        this.inFlightDetailHydrations.delete(itemId);
      }
    })();

    this.inFlightDetailHydrations.set(itemId, hydrationPromise);
    return hydrationPromise;
  }

  async ensureFullResItemAssets(itemId: number): Promise<RepositoryItemRecord | null> {
    const existing = getRepositoryItemById(itemId);
    if (!existing) return null;
    if ((existing.metadata?.screenshotsFullResVersion ?? 0) >= SCREENSHOT_FULLRES_VERSION) {
      return existing;
    }

    const activePromise = this.inFlightAssetUpgrades.get(itemId);
    if (activePromise) {
      return activePromise;
    }

    const upgradePromise = (async (): Promise<RepositoryItemRecord | null> => {
      try {
        return await this.fetchItemMetadata(itemId, { forceRefreshAssets: true });
      } catch {
        // Fallback: if release HTML page couldn't be fetched (e.g. session not logged in yet),
        // still attempt direct WordPress -WxH un-resizing on any existing stored metadata URLs.
        const current = getRepositoryItemById(itemId);
        if (!current?.metadata) return current;
        try {
          const cfg = getInternalConfig();
          const root = path.resolve(cfg.downloadDir);
          const releaseDir = this.resolveReleaseDir(current, root);
          if (!releaseDir) return current;
          const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null);
          const mirrored = await this.client.mirrorReleaseAssets(
            current.metadata,
            releaseDir,
            cfg,
            undefined,
            runLogger,
            { forceRefresh: true },
          );
          const updated = updateCatalogReleaseMetadata(
            current.id,
            mirrored.metadata,
            mirrored.coverAbsPath,
            mirrored.screenshotAbsPaths,
          );
          if (updated) {
            this.emitCatalogUpdated('metadata_updated', updated.id);
            this.emitStatus();
            return updated;
          }
        } catch {
          // Non-fatal fallback failure: serve existing local asset
        }
        return getRepositoryItemById(itemId);
      } finally {
        this.inFlightAssetUpgrades.delete(itemId);
      }
    })();

    this.inFlightAssetUpgrades.set(itemId, upgradePromise);
    return upgradePromise;
  }

  deleteFsEntries(relativePaths: string[]): { deletedCount: number; catalogRowsRemoved: number } {
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const deletedAbsPaths: string[] = [];

    for (const rel of relativePaths) {
      const cleaned = rel.replace(/^\/+/, '').trim();
      if (!cleaned) continue;
      const target = path.resolve(root, cleaned);
      if (!target.startsWith(root + path.sep) || target === root) {
        throw new Error(`Unsafe path rejected: ${rel}`);
      }
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        deletedAbsPaths.push(target);
      }
    }

    const catalogRowsRemoved = deletedAbsPaths.length > 0
      ? deleteRepositoryItemsByLocalPaths(deletedAbsPaths)
      : 0;

    if (deletedAbsPaths.length > 0) {
      this.log(
        'info',
        `Deleted ${deletedAbsPaths.length} filesystem entry/entries (${catalogRowsRemoved} catalog record(s) removed)`,
      );
      this.emitCatalogUpdated('fs_deleted');
      this.emitStatus();
    }

    return {
      deletedCount: deletedAbsPaths.length,
      catalogRowsRemoved,
    };
  }

  clearLogs(level = 'all'): number {
    const cleared = clearActivityLogs(level);
    this.emit('logs_cleared', { level });
    return cleared;
  }

  clearRuns(): number {
    const cleared = clearSyncRuns();
    this.emit('runs_cleared', { cleared });
    if (cleared > 0) {
      this.log('info', `Cleared ${cleared} historical sync run(s)`);
    }
    this.emitStatus();
    return cleared;
  }

  private setActiveSyncItemFromRecord(
    item:
      | Pick<RepositoryItemRecord, 'id' | 'title' | 'systemName' | 'coverLocalPath' | 'metadata'>
      | null
      | undefined,
  ): void {
    if (!item || !Number.isInteger(item.id) || item.id <= 0) {
      this.activeSyncItem = null;
      return;
    }
    this.activeSyncItem = {
      itemId: item.id,
      title: (item.title || '').trim(),
      systemName: item.systemName,
      hasCover: Boolean(item.coverLocalPath || item.metadata?.coverUrl),
    };
  }

  private setRunProgress(
    processed: number,
    total: number,
    scope: 'queue' | 'system',
    systemName: string | null = null,
  ): void {
    const cleanTotal = Math.max(0, Math.floor(total));
    if (cleanTotal <= 0) {
      this.activeRunProgress = null;
      return;
    }
    const cleanProcessed = Math.max(0, Math.min(Math.floor(processed), cleanTotal));
    this.activeRunProgress = {
      processed: cleanProcessed,
      total: cleanTotal,
      scope,
      systemName,
    };
  }

  private clearAllActiveTransfers(): void {
    this.activeTransfers.clear();
    this.activeTransferOrder = [];
    this.activeTransfer = null;
    this.activeSyncItem = null;
    this.activeRunProgress = null;
    this.emit('transfer', null);
  }

  private getOrderedActiveTransfers(): ActiveTransferState[] {
    const ordered: ActiveTransferState[] = [];
    const activeWorkers = this.activeTransfers.size;
    for (const key of this.activeTransferOrder) {
      const entry = this.activeTransfers.get(key);
      if (entry) {
        ordered.push({ ...entry, activeWorkers });
      }
    }
    return ordered;
  }

  private syncActiveTransferSnapshot(forceSample = false): void {
    const orderedTransfers = this.getOrderedActiveTransfers();
    if (orderedTransfers.length === 0) {
      this.activeTransfer = null;
      this.emit('transfer', null);
      return;
    }

    let primary: ActiveTransferState | null = null;
    let totalSpeed = 0;
    let totalChunks = 0;
    let anyResumed = false;

    for (const entry of orderedTransfers) {
      totalSpeed += Math.max(0, entry.bytesPerSec || 0);
      totalChunks += Math.max(1, entry.activeChunks ?? 1);
      if (entry.resumed) anyResumed = true;
      if (
        !primary ||
        ((entry.totalBytes ?? 0) > (primary.totalBytes ?? 0)) ||
        (primary.totalBytes === null && entry.bytesReceived > primary.bytesReceived)
      ) {
        primary = entry;
      }
    }

    if (!primary) {
      this.activeTransfer = null;
      this.emit('transfer', null);
      return;
    }

    const activeWorkers = orderedTransfers.length;
    this.activeTransfer = {
      ...primary,
      bytesPerSec: totalSpeed,
      activeChunks: totalChunks,
      activeWorkers,
      resumed: anyResumed || Boolean(primary.resumed),
    };
    this.emit('transfer', {
      ...this.activeTransfer,
      parallelTransfers: orderedTransfers,
    });

    const now = Date.now();
    const isFinished =
      primary.totalBytes !== null &&
      primary.totalBytes > 0 &&
      primary.bytesReceived >= primary.totalBytes;
    if (totalSpeed > 0 && (now - this.lastTransferSampleMs >= 450 || (forceSample && isFinished))) {
      this.lastTransferSampleMs = now;
      this.transferHistory.push({
        timestamp: new Date(now).toISOString(),
        bytesPerSec: Math.round(totalSpeed),
        bytesReceived: primary.bytesReceived,
        totalBytes: primary.totalBytes,
        filename: primary.filename,
        systemName: primary.systemName,
      });
      if (this.transferHistory.length > 90) {
        this.transferHistory.shift();
      }
    }
  }

  private handleTransferProgress(
    workerKey: string,
    progress: {
      bytesReceived: number;
      totalBytes: number | null;
      bytesPerSec: number;
      activeChunks?: number;
      resumed?: boolean;
    },
  ): void {
    const existing = this.activeTransfers.get(workerKey);
    if (!existing) return;
    existing.bytesReceived = progress.bytesReceived;
    existing.totalBytes = progress.totalBytes;
    existing.bytesPerSec = progress.bytesPerSec;
    if (progress.activeChunks !== undefined) {
      existing.activeChunks = progress.activeChunks;
    }
    if (progress.resumed !== undefined) {
      existing.resumed = progress.resumed;
    }
    this.syncActiveTransferSnapshot(true);
  }

  getStatusSnapshot(): ServiceStatusSnapshot {
    const cfg = getInternalConfig();
    const { totals, systems: dbSystems, releaseTypes } = getCatalogTotalsAndSystems();
    const { storage: rawStorage, systemDiskUsage } = this.collectStorageAndSystemDiskStats(cfg.downloadDir);
    const storage: StorageStats =
      !this.diskStatsCache && rawStorage.totalBytesOnDisk === 0 && totals.totalBytesMirrored > 0
        ? {
            ...rawStorage,
            totalBytesOnDisk: totals.totalBytesMirrored,
          }
        : rawStorage;
    const nextRun = this.cronJob?.nextRun();

    const systems = dbSystems.map((sys) => {
      const disk = systemDiskUsage.get(sys.systemName.toLowerCase());
      if (!disk) return sys;
      return {
        ...sys,
        totalBytes: disk.bytesOnDisk > 0 ? disk.bytesOnDisk : sys.totalBytes,
        mirroredFiles: disk.filesOnDisk > 0 ? disk.filesOnDisk : sys.mirroredFiles,
      };
    });

    return {
      podId: POD_ID,
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      debugLogging: isDebugLoggingEnabled(),
      schemaVersion: getSchemaMigrationReport().currentVersion,
      build: resolveRuntimeBuildInfo(),
      activeRun: this.activeRun,
      activeTransfer: this.activeTransfer,
      activeTransfers: this.getOrderedActiveTransfers(),
      activeSyncItem: this.activeSyncItem,
      runProgress: this.activeRunProgress,
      transferHistory: [...this.transferHistory],
      currentPhase: this.currentPhase,
      nextScheduledRunAt: cfg.scheduleEnabled && nextRun ? nextRun.toISOString() : null,
      scheduleEnabled: cfg.scheduleEnabled,
      cronSchedule: cfg.cronSchedule,
      lastWatermarkAt: cfg.lastWatermarkAt,
      rateLimiter: this.rateLimiter.getTelemetry(),
      auth: this.client.getAuthStatus(cfg, getLastAuthenticatedAt()),
      storage,
      indexer: this.getCatalogIndexerStatus(cfg),
      totals,
      systems,
      releaseTypes,
    };
  }

  private getCatalogIndexerStatus(cfg: ScraperConfigInternal): CatalogIndexerStatus {
    return {
      ...this.indexerState,
      remainingUnindexedSystems: this.computeRemainingUnindexedSystemsCount(cfg),
    };
  }

  private computeRemainingUnindexedSystemsCount(cfg: ScraperConfigInternal): number {
    const valid = filterValidSystemSlugs(cfg.discoveredSystems);
    if (valid.length === 0) return 0;
    const state = getSystemIndexState();
    const countsBySystem = getCatalogReleaseCountsBySystem();
    return classifySystemIndexFreshness(
      valid,
      state,
      Date.now(),
      DEFAULT_INDEX_STALE_MS,
      countsBySystem,
    ).unindexed.length;
  }

  private notifyActiveRunFinished(): void {
    const waiters = this.runFinishedWaiters.splice(0, this.runFinishedWaiters.length);
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async waitIfActiveRunBusy(signal: AbortSignal): Promise<void> {
    while (this.activeRun !== null && !signal.aborted && !this.shuttingDown) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          resolve();
        }, 1200);
        this.runFinishedWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  private buildWpReleaseRecordInput(
    post: WpPostMetadata,
    systemSlug: string,
    cfg: ScraperConfigInternal,
    runId?: number | null,
  ) {
    const link = (post.link || '').split('#')[0];
    const canonicalSystem = canonicalizeSystemSlug(systemSlug) || systemSlug;
    const mirrored = resolveMirroredPaths(cfg.baseUrl, link, cfg.downloadDir, 'probe.zip');
    const releaseDir = path.dirname(mirrored.localPath);
    const remotePath = path.relative(path.resolve(cfg.downloadDir), releaseDir).split(path.sep).join('/');
    const hintFilenames = (post.downloadHints || []).map((h) => h.filename);
    const fileRoles = (post.downloadHints || []).map((h) =>
      classifyFileRole(h.filename, '', {
        genres: post.genres,
        languages: post.languages,
        sources: post.sources,
        title: post.title || undefined,
        systemName: canonicalSystem,
        siblingFilenames: hintFilenames,
      }),
    );
    const baseMeta = this.client.extractReleaseMetadata('', link, post, fileRoles);
    const metadata: ReleaseMetadata = {
      ...baseMeta,
      downloadHints: post.downloadHints?.length ? post.downloadHints : baseMeta.downloadHints,
    };
    const estimatedBytes = estimateDownloadHintsBytes(post.downloadHints);
    return {
      remoteUrl: link,
      remotePath,
      localPath: releaseDir,
      systemName: canonicalSystem,
      title: metadata.title,
      publishedAt: metadata.publishedAt ?? null,
      remoteUpdatedAt: metadata.remoteUpdatedAt ?? null,
      estimatedBytes,
      metadata,
      lastRunId: runId ?? null,
    };
  }

  async startCatalogIndex(
    scope: 'filtered' | 'full' = 'filtered',
    options: { auto?: boolean; forceFull?: boolean } = {},
  ): Promise<{ started: boolean; targets: string[]; mode: 'delta' | 'full' | 'mixed' | null }> {
    const cfg = getInternalConfig();
    const auth = this.client.getAuthStatus(cfg, getLastAuthenticatedAt());
    if (!auth.hasCompletedLogin && !auth.authenticated) {
      if (options.auto) return { started: false, targets: [], mode: null };
      throw new Error('Verify RetroGameTalk credentials in System Settings before indexing the catalog.');
    }

    if (this.indexerState.active) {
      const upgradingScope = scope === 'full' && this.indexerState.scope === 'filtered';
      const upgradingToForceFull = Boolean(options.forceFull) && this.indexerState.mode !== 'full';
      if (upgradingScope || upgradingToForceFull) {
        this.indexerAbortController?.abort();
      } else {
        return { started: false, targets: [], mode: this.indexerState.mode ?? null };
      }
    }

    let validDiscovered = filterValidSystemSlugs(cfg.discoveredSystems).map((s) => s.toLowerCase());
    if (validDiscovered.length === 0 && !options.auto) {
      const probe = await this.client.testAuthAndDiscovery(cfg);
      if (probe.discoveredSystems.length > 0) {
        validDiscovered = saveDiscoveredSystems(probe.discoveredSystems).map((s) => s.toLowerCase());
      }
    }

    const indexState = getSystemIndexState();
    const explicitFilters = filterValidSystemSlugs(
      cfg.systemFilter.split(',').map((s) => s.trim()).filter(Boolean),
    ).map((s) => s.toLowerCase());

    let candidateTargets: string[] = [];
    if (scope === 'filtered') {
      if (explicitFilters.length > 0) {
        candidateTargets = explicitFilters;
      } else {
        const prioritized = AUTO_INDEX_PRIORITY_SYSTEMS.filter((s) => validDiscovered.includes(s));
        candidateTargets =
          prioritized.length > 0 ? prioritized.slice(0, 6) : validDiscovered.slice(0, 6);
      }
    } else {
      const seen = new Set<string>();
      for (const s of [...explicitFilters, ...AUTO_INDEX_PRIORITY_SYSTEMS, ...validDiscovered]) {
        const canonical = (canonicalizeSystemSlug(s) || s).toLowerCase();
        if (!validDiscovered.includes(canonical) && !explicitFilters.includes(canonical)) continue;
        if (!seen.has(canonical)) {
          seen.add(canonical);
          candidateTargets.push(canonical);
        }
      }
    }

    const plan = planCatalogIndexTargets({
      candidateTargets,
      indexState,
      scope,
      auto: options.auto,
      forceFull: options.forceFull,
      catalogCountsBySystem: getCatalogReleaseCountsBySystem(),
    });
    const plannedTargets = plan.targets;
    const targetSlugs = plannedTargets.map((t) => t.slug);

    if (plannedTargets.length === 0) {
      this.emitStatus();
      return { started: false, targets: [], mode: null };
    }

    this.indexerAbortController = new AbortController();
    const signal = this.indexerAbortController.signal;
    const runMode = plan.mode ?? 'full';
    this.indexerState = {
      active: true,
      scope,
      mode: runMode,
      currentSystem: plannedTargets[0].slug,
      systemsCompleted: 0,
      systemsTotal: plannedTargets.length,
      currentPage: 0,
      totalPages: 0,
      indexedCount: 0,
      remainingUnindexedSystems: this.computeRemainingUnindexedSystemsCount(cfg),
      lastError: null,
    };
    this.emitStatus();
    const scopeLabel = scope === 'full' ? 'Full Site' : 'Target Consoles';
    const modeLabel =
      options.forceFull
        ? 'Full Re-index'
        : runMode === 'delta'
          ? 'Delta Update'
          : runMode === 'mixed'
            ? 'Smart Index + Delta'
            : 'Initial Index';
    this.log(
      'info',
      `Catalog indexer started (${scopeLabel} · ${modeLabel}): ${plannedTargets.length} console(s)`,
      targetSlugs.join(', '),
    );

    void (async () => {
      const indexerLogger: LoggerFn = (level, msg, detail) => {
        if (level === 'warn' || level === 'error') {
          this.log(level, msg, detail ?? null);
        } else {
          logServer('INDEXER', 'debug', msg, detail ?? null);
        }
      };

      const indexedRestBases = new Set<string>();
      let totalNewDiscovered = 0;
      let totalExistingUpdated = 0;
      try {
        const latestCfg = getInternalConfig();
        if (!this.client.getAuthStatus(latestCfg, getLastAuthenticatedAt()).authenticated) {
          const loginRes = await this.client.login(latestCfg, signal, indexerLogger);
          if (loginRes.authenticated) {
            const ts = recordSuccessfulLogin();
            this.client.setPersistedLastAuthenticatedAt(ts);
          }
        }

        for (let i = 0; i < plannedTargets.length; i += 1) {
          if (signal.aborted || this.shuttingDown) break;
          await this.waitIfActiveRunBusy(signal);
          if (signal.aborted || this.shuttingDown) break;

          const planned = plannedTargets[i];
          const systemSlug = planned.slug;
          const activeCfg = getInternalConfig();
          const restBase = await this.client.resolveWpRestBaseForSystem(systemSlug, activeCfg, signal, indexerLogger);
          if (restBase && indexedRestBases.has(restBase.toLowerCase())) {
            this.indexerState.systemsCompleted = i + 1;
            continue;
          }
          if (restBase) indexedRestBases.add(restBase.toLowerCase());

          this.indexerState = {
            ...this.indexerState,
            currentSystem: systemSlug,
            currentPage: 1,
            totalPages: 1,
          };
          this.emitStatus();

          const scanStartedAtIso = new Date().toISOString();
          let pagesForSystem = 0;
          let postsForSystem = 0;
          let newPostsForSystem = 0;
          const res = await this.client.listConsoleReleasesViaWpRest(systemSlug, activeCfg, {
            modifiedAfterIso: planned.modifiedAfterIso,
            signal,
            log: indexerLogger,
            onPageFetched: (page, totalPages) => {
              pagesForSystem = Math.max(pagesForSystem, page);
              this.indexerState = {
                ...this.indexerState,
                currentSystem: systemSlug,
                currentPage: page,
                totalPages,
              };
              this.emitStatus();
            },
            onPostsPage: async (posts, page, totalPages) => {
              for (const post of posts) {
                if (!post.link) continue;
                const canonicalLink = post.link.split('#')[0];
                const existedBefore =
                  planned.strategy === 'delta'
                    ? Boolean(getRepositoryItemByRemoteUrl(canonicalLink))
                    : false;
                upsertIndexedWpRelease(this.buildWpReleaseRecordInput(post, systemSlug, activeCfg));
                postsForSystem += 1;
                if (planned.strategy === 'delta') {
                  if (existedBefore) {
                    totalExistingUpdated += 1;
                  } else {
                    newPostsForSystem += 1;
                    totalNewDiscovered += 1;
                  }
                }
                this.indexerState.indexedCount += 1;
              }
              this.indexerState.currentPage = page;
              this.indexerState.totalPages = totalPages;
              this.emitCatalogUpdated('indexer_page');
              this.emitStatus();
              await this.waitIfActiveRunBusy(signal);
            },
          });

          if (!signal.aborted && !this.shuttingDown) {
            if (res.supported) {
              const updatedCursor = buildUpdatedSystemIndexCursor({
                existingCursor: planned.existingCursor,
                strategy: planned.strategy,
                scope,
                scanStartedAtIso,
                totalPostsFetched: postsForSystem,
                newPostsDiscovered: newPostsForSystem,
                totalPagesFetched: res.totalPages || res.pagesFetched || pagesForSystem,
                pagesIndexed: res.pagesFetched || pagesForSystem,
                completed: res.completed,
                headerTotalPosts: res.totalWpPosts,
              });
              updateSystemIndexCursor(systemSlug, updatedCursor);
              if (!res.completed) {
                this.log(
                  'warn',
                  `Catalog index incomplete for ${systemSlug} (fetched ${res.pagesFetched}/${res.totalPages} pages${res.truncatedReason ? ` · ${res.truncatedReason}` : ''}); will auto-resume full index on next update`,
                );
              }
            } else {
              this.log(
                'warn',
                `Catalog index could not query WP REST for ${systemSlug}${res.truncatedReason ? ` (${res.truncatedReason})` : ''}; leaving console marked unindexed for retry`,
              );
            }
          }

          this.indexerState.systemsCompleted = i + 1;
          this.emitStatus();
        }

        if (!signal.aborted && !this.shuttingDown) {
          if (runMode === 'delta') {
            const summary =
              this.indexerState.indexedCount === 0
                ? 'already up to date'
                : `${totalNewDiscovered} new, ${totalExistingUpdated} updated`;
            this.log(
              'info',
              `Catalog delta update complete: ${summary} across ${this.indexerState.systemsCompleted} console(s)`,
            );
          } else {
            this.log(
              'info',
              `Catalog indexing complete: ${this.indexerState.indexedCount} release(s) cataloged across ${this.indexerState.systemsCompleted} console(s)`,
            );
          }
        }
      } catch (err) {
        if (!signal.aborted) {
          const msg = err instanceof Error ? err.message : String(err);
          this.indexerState.lastError = msg;
          this.log('warn', `Catalog indexing paused: ${msg}`);
        }
      } finally {
        const shouldChainAutoIndex =
          !signal.aborted && !this.shuttingDown && this.pendingAutoIndexAfterCurrent;
        this.pendingAutoIndexAfterCurrent = false;
        this.indexerState = {
          ...this.indexerState,
          active: false,
          mode: null,
          currentSystem: null,
        };
        this.indexerAbortController = null;
        this.emitCatalogUpdated('indexer_finished');
        this.emitStatus();
        this.evaluateAndEmitAchievements();
        if (shouldChainAutoIndex) {
          void this.startCatalogIndex('filtered', { auto: true }).catch(() => undefined);
        }
      }
    })();

    return { started: true, targets: targetSlugs, mode: runMode };
  }

  stopCatalogIndex(): boolean {
    if (!this.indexerState.active || !this.indexerAbortController) return false;
    this.indexerAbortController.abort();
    this.indexerState = {
      ...this.indexerState,
      active: false,
      mode: null,
      currentSystem: null,
    };
    this.log('info', 'Catalog background indexing paused by user');
    this.emitStatus();
    return true;
  }

  hasActiveDownloadQueue(): boolean {
    return Boolean(this.activeRun && this.activeRun.triggerType === 'download');
  }

  async resumeDownloadQueue(): Promise<{
    run: SyncRunRecord;
    queuedCount: number;
    alreadyQueuedCount: number;
    alreadyDownloadedCount: number;
  }> {
    if (this.hasActiveDownloadQueue()) {
      throw new Error(`Download queue Run #${this.activeRun!.id} is already running.`);
    }
    const pausedIds = listPausedQueuedReleaseIds();
    if (pausedIds.length === 0) {
      throw new Error('No paused queued releases to resume.');
    }
    return this.queueCatalogDownloads({ ids: pausedIds });
  }

  clearDownloadQueue(): { clearedCount: number } {
    if (this.hasActiveDownloadQueue()) {
      throw new Error(
        `Stop the active download queue (Run #${this.activeRun!.id}) before clearing queued releases.`,
      );
    }
    const result = clearPausedQueuedReleases();
    if (result.clearedCount > 0) {
      this.log(
        'info',
        `Cleared ${result.clearedCount} paused queued release${result.clearedCount === 1 ? '' : 's'} back to available`,
      );
      this.emitCatalogUpdated('queue_cleared');
      this.emitStatus();
    }
    return result;
  }

  async queueCatalogDownloads(options: {
    ids?: number[];
    filters?: CatalogQueryFilterParams;
  }): Promise<{
    run: SyncRunRecord;
    queuedCount: number;
    alreadyQueuedCount: number;
    alreadyDownloadedCount: number;
  }> {
    const filterPreview = options.filters
      ? queryRepositoryItemIds({
          ...options.filters,
          includePausedQueued: !this.hasActiveDownloadQueue(),
        })
      : null;
    const resolvedIds = filterPreview
      ? filterPreview.queueableIds
      : Array.from(
          new Set(
            (options.ids || [])
              .map((v) => Number(v))
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
        );

    if (this.activeRun && this.activeRun.triggerType !== 'download') {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    const cfg = getInternalConfig();
    this.assertCanRunSync(cfg);

    // Handle filtered queue request where all matches are already queued/downloaded
    if (filterPreview && resolvedIds.length === 0) {
      if (
        this.activeRun &&
        this.activeRun.triggerType === 'download' &&
        filterPreview.alreadyQueuedCount > 0
      ) {
        return {
          run: this.activeRun,
          queuedCount: 0,
          alreadyQueuedCount: filterPreview.alreadyQueuedCount,
          alreadyDownloadedCount: filterPreview.alreadyDownloadedCount,
        };
      }
      if (filterPreview.alreadyQueuedCount > 0) {
        throw new Error(
          `All ${filterPreview.alreadyQueuedCount} matching release${filterPreview.alreadyQueuedCount === 1 ? ' is' : 's are'} already queued or downloading.`,
        );
      }
      if (filterPreview.alreadyDownloadedCount > 0) {
        throw new Error('All matching releases are already downloaded.');
      }
      throw new Error('No downloadable or pending catalog releases matched your selection.');
    }

    if (resolvedIds.length === 0) {
      throw new Error('No downloadable or pending catalog releases matched your selection.');
    }

    const isRuleScopedQueue = Boolean(options.filters?.syncRules);

    // Append cleanly to an already-active download queue run without duplicating pending or in-flight releases
    if (this.activeRun && this.activeRun.triggerType === 'download') {
      const activeOrPendingIds = new Set<number>([
        ...this.pendingDownloadQueueSet,
        ...this.inFlightDownloadIds,
      ]);
      const marked = markCatalogItemsQueuedDetailed(resolvedIds, this.activeRun.id, {
        activeOrPendingIds,
        allowIncompleteRuleDownloads: isRuleScopedQueue,
      });

      const newlyAddedIds: number[] = [];
      for (const id of marked.queuedIds) {
        if (!this.pendingDownloadQueueSet.has(id) && !this.inFlightDownloadIds.has(id)) {
          this.pendingDownloadQueueSet.add(id);
          this.pendingDownloadQueueIds.push(id);
          if (isRuleScopedQueue) {
            this.ruleFilteredDownloadIds.add(id);
          }
          newlyAddedIds.push(id);
        }
      }

      const alreadyQueuedCount =
        marked.alreadyQueuedIds.length +
        (marked.queuedIds.length - newlyAddedIds.length) +
        (filterPreview?.alreadyQueuedCount ?? 0);
      const alreadyDownloadedCount =
        marked.alreadyDownloadedIds.length + (filterPreview?.alreadyDownloadedCount ?? 0);

      if (newlyAddedIds.length > 0) {
        if (this.activeRunProgress && this.activeRunProgress.scope === 'queue') {
          this.setRunProgress(
            this.activeRunProgress.processed,
            this.activeRunProgress.total + newlyAddedIds.length,
            'queue',
            null,
          );
        }
        this.log(
          'info',
          `Appended ${newlyAddedIds.length} release(s) to active download queue (Run #${this.activeRun.id})${
            alreadyQueuedCount > 0 ? ` (${alreadyQueuedCount} already queued skipped)` : ''
          }`,
          null,
          this.activeRun.id,
        );
        this.emitCatalogUpdated('items_queued');
        this.emitStatus();
      }

      return {
        run: this.activeRun,
        queuedCount: newlyAddedIds.length,
        alreadyQueuedCount,
        alreadyDownloadedCount,
      };
    }

    const lockKey = 'download:queue';
    if (!acquireDistributedLock(lockKey, POD_ID, 180)) {
      throw new Error(`Another pod holds distributed lock "${lockKey}"`);
    }

    const marked = markCatalogItemsQueuedDetailed(resolvedIds, null, {
      allowIncompleteRuleDownloads: isRuleScopedQueue,
    });
    if (marked.queuedIds.length === 0) {
      releaseDistributedLock(lockKey, POD_ID);
      if (marked.alreadyQueuedIds.length > 0) {
        throw new Error('All selected releases are already queued or downloading.');
      }
      throw new Error('All selected releases are already downloaded.');
    }

    const run = createSyncRun('download', 'incremental', false);
    this.pendingDownloadQueueIds = [...marked.queuedIds];
    this.pendingDownloadQueueSet = new Set(marked.queuedIds);
    this.inFlightDownloadIds.clear();
    this.ruleFilteredDownloadIds = isRuleScopedQueue ? new Set(marked.queuedIds) : new Set();
    this.activeRun = run;
    this.setRunProgress(0, marked.queuedIds.length, 'queue', null);
    this.abortController = new AbortController();
    this.currentPhase = `Downloading ${marked.queuedIds.length} queued release${marked.queuedIds.length === 1 ? '' : 's'}`;

    this.lockRenewTimer = setInterval(() => {
      acquireDistributedLock(lockKey, POD_ID, 180);
    }, 60_000);

    this.log(
      'info',
      `Started on-demand download queue Run #${run.id} for ${marked.queuedIds.length} release(s)`,
      null,
      run.id,
    );
    this.emitCatalogUpdated('items_queued');
    this.emitStatus();

    void this.executeDownloadQueue(run, cfg, lockKey);
    return {
      run,
      queuedCount: marked.queuedIds.length,
      alreadyQueuedCount: marked.alreadyQueuedIds.length + (filterPreview?.alreadyQueuedCount ?? 0),
      alreadyDownloadedCount:
        marked.alreadyDownloadedIds.length + (filterPreview?.alreadyDownloadedCount ?? 0),
    };
  }

  private async executeDownloadQueue(
    run: SyncRunRecord,
    cfg: ScraperConfigInternal,
    lockKey: string,
  ): Promise<void> {
    const signal = this.abortController!.signal;
    const root = path.resolve(cfg.downloadDir);
    const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null, run.id);

    let attemptedFiles = 0;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let bytes = 0;

    try {
      if (!cfg.username || !cfg.password) {
        throw new Error('Credentials missing: configure Repository Username and Password before downloading.');
      }
      if (!this.client.getAuthStatus(cfg, getLastAuthenticatedAt()).authenticated) {
        this.currentPhase = 'Authenticating with retrogametalk.com';
        this.emitStatus();
        const loginRes = await this.client.login(cfg, signal, runLogger);
        if (!loginRes.authenticated) {
          throw new Error(loginRes.message);
        }
        const ts = recordSuccessfulLogin();
        this.client.setPersistedLastAuthenticatedAt(ts);
      }

      let processedReleases = 0;
      while (this.pendingDownloadQueueIds.length > 0 && !signal.aborted) {
        const batchIds = this.pendingDownloadQueueIds.splice(0, this.pendingDownloadQueueIds.length);
        const totalInQueue = processedReleases + batchIds.length;

        await runWithConcurrency(
          batchIds,
          () => getInternalConfig().maxConcurrency,
          signal,
          async (itemId) => {
          if (signal.aborted) return;
          this.inFlightDownloadIds.add(itemId);
          this.pendingDownloadQueueSet.delete(itemId);
          const applyReleaseTypeFilter = this.ruleFilteredDownloadIds.has(itemId);
          try {
            const item = getRepositoryItemById(itemId);
            if (!item) return;

            const filesToDownload = item.files.filter(
              (f) =>
                f.status === 'available' ||
                f.status === 'queued' ||
                f.status === 'failed' ||
                f.status === 'downloading' ||
                !f.localPath ||
                !fs.existsSync(f.localPath),
            );

            processedReleases += 1;
            const liveQueueTotal = totalInQueue + this.pendingDownloadQueueIds.length;
            this.setActiveSyncItemFromRecord(item);
            this.setRunProgress(processedReleases, liveQueueTotal, 'queue', null);
            this.currentPhase = `Queue (${processedReleases}/${liveQueueTotal}): ${item.systemName} / ${item.title}`;
            this.emitStatus();

            try {
              const outcome = await this.retryReleaseEntry(
                item,
                filesToDownload,
                cfg,
                run.id,
                root,
                signal,
                runLogger,
                false,
                applyReleaseTypeFilter,
              );
              attemptedFiles += Math.max(
                filesToDownload.length,
                outcome.downloaded + outcome.skipped + outcome.failed,
              );
              downloaded += outcome.downloaded;
              skipped += outcome.skipped;
              failed += outcome.failed;
              bytes += outcome.bytes;
            } catch (itemErr) {
              if (signal.aborted) return;
              const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
              if (/Cloudflare|Authentication|Re-authentication/i.test(errMsg)) {
                throw itemErr;
              }
              if (filesToDownload.length > 0) {
                attemptedFiles += filesToDownload.length;
                for (const f of filesToDownload) {
                  upsertReleaseFile({
                    releaseId: item.id,
                    targetFileId: f.id,
                    remoteUrl: f.remoteUrl,
                    downloadUrl: f.downloadUrl,
                    remotePath: f.remotePath,
                    localPath: f.localPath,
                    filename: f.filename,
                    displayLabel: f.displayLabel,
                    fileRole: f.fileRole,
                    status: 'failed',
                    errorMessage: errMsg,
                    lastRunId: run.id,
                  });
                  failed += 1;
                }
              } else {
                attemptedFiles += 1;
                failed += 1;
                markCatalogReleaseFailed(item.id, errMsg, run.id);
              }
              runLogger('error', `Download failed for ${item.title}: ${errMsg}`, item.remoteUrl);
              this.emitCatalogUpdated('file_failed', item.id);
            }

            this.activeRun = updateSyncRun(run.id, {
              newFound: attemptedFiles,
              downloadedCount: downloaded,
              skippedCount: skipped,
              failedCount: failed,
              bytesDownloaded: bytes,
              avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
            });
            this.emitStatus();
          } finally {
            this.inFlightDownloadIds.delete(itemId);
            this.ruleFilteredDownloadIds.delete(itemId);
          }
        }, this.subscribeRuntimeConfig);
      }

      const finalStatus = signal.aborted ? 'stopped' : 'completed';
      updateSyncRun(run.id, {
        status: finalStatus,
        finishedAt: new Date().toISOString(),
        newFound: attemptedFiles,
        downloadedCount: downloaded,
        skippedCount: skipped,
        failedCount: failed,
        bytesDownloaded: bytes,
        avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
      });
      const queueSummaryMsg =
        finalStatus === 'completed' && downloaded === 0 && skipped > 0 && failed === 0
          ? `Download queue #${run.id} completed: all ${skipped} file${skipped === 1 ? '' : 's'} verified up to date on disk (0 new downloads needed)`
          : `Download queue #${run.id} ${finalStatus}: ${downloaded} downloaded, ${skipped} already on disk, ${failed} failed`;
      runLogger('info', queueSummaryMsg);
      if (finalStatus === 'completed') {
        recordAchievementCounter('runs_completed', 1, 'increment');
        this.evaluateAndEmitAchievements();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncRun(run.id, {
        status: signal.aborted ? 'stopped' : 'failed',
        finishedAt: new Date().toISOString(),
        newFound: attemptedFiles,
        downloadedCount: downloaded,
        skippedCount: skipped,
        failedCount: Math.max(1, failed),
        bytesDownloaded: bytes,
        errorSummary: msg,
      });
      if (!signal.aborted) {
        runLogger('error', `Download queue #${run.id} failed: ${msg}`);
      }
    } finally {
      const remainingUnprocessed = Array.from(
        new Set([
          ...this.pendingDownloadQueueIds,
          ...this.pendingDownloadQueueSet,
          ...this.inFlightDownloadIds,
        ]),
      );
      for (const id of remainingUnprocessed) {
        try {
          recomputeReleaseRollup(id);
        } catch {
          // ignore rollup cleanup errors during teardown
        }
      }
      this.pendingDownloadQueueIds = [];
      this.pendingDownloadQueueSet.clear();
      this.inFlightDownloadIds.clear();
      this.ruleFilteredDownloadIds.clear();
      if (this.lockRenewTimer) {
        clearInterval(this.lockRenewTimer);
        this.lockRenewTimer = null;
      }
      releaseDistributedLock(lockKey, POD_ID);
      this.clearAllActiveTransfers();
      this.activeRun = null;
      this.abortController = null;
      this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
      this.emitCatalogUpdated('queue_finished');
      this.emitStatus();
      this.notifyActiveRunFinished();
    }
  }

  private assertCanRunSync(cfg: ScraperConfigInternal): void {
    const auth = this.client.getAuthStatus(cfg, getLastAuthenticatedAt());
    if (!auth.hasCompletedLogin) {
      throw new Error(
        'Login required: verify RetroGameTalk credentials via "Test Login & Discover Consoles" in Operations before running a sync.',
      );
    }
  }

  async startRun(
    trigger: RunTrigger,
    mode: RunMode,
    options?: {
      dryRun?: boolean;
      refreshStaleIndexes?: boolean;
      legacyFullCrawl?: boolean;
    },
  ): Promise<SyncRunRecord> {
    if (this.activeRun) {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    const cfg = getInternalConfig();
    this.assertCanRunSync(cfg);

    const lockKey = cfg.systemFilter
      ? `sync:${cfg.systemFilter.toLowerCase()}`
      : 'sync:global';

    if (!acquireDistributedLock(lockKey, POD_ID, 180)) {
      throw new Error(`Another pod holds distributed lock "${lockKey}"`);
    }

    const effectiveScope: 'incremental' | 'full' = mode === 'full' ? 'full' : 'incremental';
    const isDryRun = mode === 'dry_run' || Boolean(options?.dryRun);
    const run = createSyncRun(trigger, effectiveScope, isDryRun);
    const modeLabel = isDryRun
      ? `Dry Run · ${effectiveScope === 'full' ? 'Full Sync' : 'Incremental'}`
      : effectiveScope === 'full'
        ? (options?.legacyFullCrawl ? 'Full Sync (Legacy Crawl)' : 'Full Sync')
        : 'Incremental';

    this.activeRun = run;
    this.abortController = new AbortController();
    this.currentPhase = `Run #${run.id} initializing (${modeLabel})`;

    this.lockRenewTimer = setInterval(() => {
      acquireDistributedLock(lockKey, POD_ID, 180);
    }, 60_000);

    this.log(
      'info',
      `Started ${modeLabel} sync run #${run.id} (${trigger})`,
      isDryRun ? `Target: ${cfg.baseUrl} · Simulation mode (0 bytes written to disk)` : `Target: ${cfg.baseUrl}`,
      run.id,
    );
    this.emitStatus();

    void this.executeRun(run, cfg, lockKey, options);
    return run;
  }

  private async retryReleaseEntry(
    item: RepositoryItemRecord,
    filesToRetry: ReleaseFileRecord[],
    cfg: ScraperConfigInternal,
    runId: number,
    root: string,
    signal: AbortSignal,
    runLogger: LoggerFn,
    isDryRun = false,
    applyReleaseTypeFilter = false,
  ): Promise<{ downloaded: number; skipped: number; failed: number; bytes: number; wouldRecover: number }> {
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let bytes = 0;
    let wouldRecover = 0;

    const pageUrl = item.remoteUrl.split('#')[0];
    let freshDownloads: DiscoveredRelease[] = [];

    if (pageUrl.startsWith('http')) {
      const pageData = await this.client.fetchPageHtml(pageUrl, cfg, signal, runLogger);
      if (pageData.status >= 400) {
        throw new Error(`HTTP ${pageData.status} fetching release page ${pageData.finalUrl}`);
      }
      const wpPostIdHint = item.wpPostId ?? this.client.extractWpPostIdHint(pageData.html);
      const wpData = await this.client.fetchReleaseWpMetadata(
        pageData.finalUrl,
        wpPostIdHint,
        cfg,
        signal,
        runLogger,
      );
      const dynamic = await this.client.extractDynamicReleaseDownloads(
        pageData.html,
        pageData.finalUrl,
        cfg,
        signal,
        runLogger,
      );
      const linked = this.client.extractLinksFromHtml(pageData.html, pageData.finalUrl, cfg).downloads;
      const deduped = new Map<string, DiscoveredRelease>();
      for (const candidate of [...dynamic, ...linked]) {
        const key = candidate.filename.toLowerCase();
        if (!deduped.has(key)) {
          deduped.set(key, candidate);
        }
      }
      freshDownloads = Array.from(deduped.values());

      if (!isDryRun) {
        const allRoleInputs = freshDownloads.length > 0 ? freshDownloads : item.files;
        const allRoleFilenames = allRoleInputs.map((f) => f.filename);
        const fileRoles = allRoleInputs.map((f) =>
          classifyFileRole(f.filename, f.displayLabel || f.filename, {
            genres: wpData?.genres ?? item.genres,
            languages: wpData?.languages ?? item.languages,
            sources: wpData?.sources ?? item.sources,
            title: wpData?.title ?? item.title,
            systemName: item.systemName,
            siblingFilenames: allRoleFilenames,
          }),
        );

        try {
          const freshMeta = this.client.extractReleaseMetadata(
            pageData.html,
            pageData.finalUrl,
            wpData,
            fileRoles,
          );
          const releaseDir =
            this.resolveReleaseDir(item, root) ||
            path.dirname(resolveMirroredPaths(cfg.baseUrl, pageData.finalUrl, root, 'probe.zip').localPath);
          if (releaseDir) {
            const mirrored = await this.client.mirrorReleaseAssets(
              freshMeta,
              releaseDir,
              cfg,
              signal,
              runLogger,
            );
            updateCatalogReleaseMetadata(
              item.id,
              mirrored.metadata,
              mirrored.coverAbsPath,
              mirrored.screenshotAbsPaths,
            );
          }
        } catch (assetErr) {
          if (signal.aborted) throw assetErr;
          runLogger(
            'warn',
            `Metadata/artwork refresh skipped during retry for ${item.title}`,
            assetErr instanceof Error ? assetErr.message : String(assetErr),
          );
        }
      }
    }

    // Release was interrupted mid-metadata before any child file rows were created, OR was queued
    // via Sync Rules with additional policy-eligible sibling files to fetch: seed & download discovered archives.
    if (filesToRetry.length === 0) {
      if (freshDownloads.length === 0) {
        throw new Error(`No downloadable archive files found on release page ${pageUrl}`);
      }

      let targetDownloads = freshDownloads;
      if (applyReleaseTypeFilter) {
        const liveAllowedTypes = normalizeAllowedReleaseTypes(getInternalConfig().allowedReleaseTypes);
        if (liveAllowedTypes.length > 0) {
          const latestItem = getRepositoryItemById(item.id) || item;
          const siblingFilenames = Array.from(
            new Set([
              ...freshDownloads.map((d) => (d.filename || '').trim()).filter(Boolean),
              ...latestItem.files.map((f) => (f.filename || '').trim()).filter(Boolean),
            ]),
          );
          const roleCtx = {
            genres: latestItem.genres,
            languages: latestItem.languages,
            sources: latestItem.sources,
            title: latestItem.title,
            systemName: latestItem.systemName,
            siblingFilenames,
          };
          const freshRoles = freshDownloads.map((d) =>
            classifyFileRole(d.filename, d.displayLabel || d.filename, roleCtx),
          );
          const baseMetaTags = deriveReleaseTags(
            {
              genres: latestItem.genres,
              languages: latestItem.languages,
              sources: latestItem.sources,
              systemName: latestItem.systemName,
            },
            freshRoles,
          );
          targetDownloads = freshDownloads.filter((rel, idx) => {
            const fileTypeKeys = classifyFileRoleToTypeKeys(
              freshRoles[idx],
              baseMetaTags,
              latestItem.systemName,
            );
            const match = evaluateReleaseTypeMatch(fileTypeKeys, liveAllowedTypes);
            if (!match.allowed) {
              runLogger(
                'info',
                `[Type Filter] Skipped ${rel.filename}`,
                `Detected type: ${match.detectedLabels.join(', ') || freshRoles[idx]} (excluded by policy)`,
              );
              return false;
            }
            return true;
          });
          if (targetDownloads.length === 0) {
            if (!isDryRun) {
              persistDiscoveredReleaseDownloadHints(
                pageUrl,
                freshDownloads.map((d) => ({ filename: d.filename, fileSize: null })),
                { replace: true },
              );
              if (!signal.aborted) {
                markCatalogReleaseRemoteChecked(item.id);
              }
              recomputeReleaseRollup(item.id);
              if (!signal.aborted) {
                this.emitCatalogUpdated('release_verified', item.id);
              }
            }
            return { downloaded, skipped, failed, bytes, wouldRecover };
          }
        }
      }

      await runWithConcurrency(
        targetDownloads,
        () => getInternalConfig().maxConcurrency,
        signal,
        async (release) => {
        if (signal.aborted) return;
        if (isDryRun) {
          const mirrored = resolveMirroredPaths(cfg.baseUrl, release.pageUrl || pageUrl, cfg.downloadDir, release.filename);
          const remotePath = release.remotePath || mirrored.remotePath;
          const expectedLocal = path.resolve(cfg.downloadDir, remotePath);
          const alreadyExists = fs.existsSync(expectedLocal) && fs.statSync(expectedLocal).size > 0;
          if (alreadyExists) {
            skipped += 1;
          } else {
            wouldRecover += 1;
            runLogger(
              'info',
              `[Dry Run · Retry] Verified fresh download link for ${remotePath}`,
              release.downloadUrl,
            );
          }
          return;
        }
        const outcome = await this.downloadReleaseFile(
          item.id,
          release,
          cfg,
          runId,
          signal,
          runLogger,
          getRepositoryItemById(item.id) || item,
        );
        if (outcome.downloaded) downloaded += 1;
        if (outcome.skipped) skipped += 1;
        if (outcome.failed) failed += 1;
        bytes += outcome.bytes;
      }, this.subscribeRuntimeConfig);
      if (!isDryRun) {
        if (freshDownloads.length > 0) {
          persistDiscoveredReleaseDownloadHints(
            pageUrl,
            freshDownloads.map((d) => ({ filename: d.filename, fileSize: null })),
            { replace: true },
          );
        }
        if (!signal.aborted && failed === 0) {
          markCatalogReleaseRemoteChecked(item.id);
        }
        recomputeReleaseRollup(item.id);
        if (!signal.aborted && failed === 0 && downloaded === 0) {
          this.emitCatalogUpdated('release_verified', item.id);
        }
      }
      return { downloaded, skipped, failed, bytes, wouldRecover };
    }

    const matchFreshDownload = (targetFile: ReleaseFileRecord): DiscoveredRelease | undefined => {
      if (freshDownloads.length === 0) return undefined;
      const lowerFilename = targetFile.filename.toLowerCase();
      const lowerLabel = (targetFile.displayLabel || '').toLowerCase();

      const direct =
        freshDownloads.find((f) => f.filename === targetFile.filename) ||
        freshDownloads.find((f) => f.filename.toLowerCase() === lowerFilename) ||
        freshDownloads.find((f) => f.remoteUrl === targetFile.remoteUrl) ||
        (lowerLabel ? freshDownloads.find((f) => (f.displayLabel || '').toLowerCase() === lowerLabel) : undefined);
      if (direct) return direct;

      if (freshDownloads.length === 1 && item.files.length <= 1) {
        return freshDownloads[0];
      }

      if (filesToRetry.length === 1) {
        const alreadyOkFilenames = new Set(
          item.files
            .filter((f) => f.id !== targetFile.id && (f.status === 'downloaded' || f.status === 'skipped'))
            .map((f) => f.filename.toLowerCase()),
        );
        const unmatched = freshDownloads.filter((fd) => !alreadyOkFilenames.has(fd.filename.toLowerCase()));
        if (unmatched.length === 1) {
          return unmatched[0];
        }
      }

      return undefined;
    };

    await runWithConcurrency(
      filesToRetry,
      () => getInternalConfig().maxConcurrency,
      signal,
      async (targetFile, fileIdx) => {
      if (signal.aborted) return;
      const matched = matchFreshDownload(targetFile);

      // If no fresh download link was extracted and stored downloadUrl is just the page URL itself, fail explicitly
      const storedUrlClean = (targetFile.downloadUrl || '').split('#')[0];
      const targetAlreadyOnDisk = Boolean(
        targetFile.localPath && fs.existsSync(targetFile.localPath) && fs.statSync(targetFile.localPath).size > 0,
      );
      if (!matched) {
        runLogger(
          'debug',
          `[Retry] No exact fresh link match for "${targetFile.filename}" on ${pageUrl}`,
          `freshCandidates=${freshDownloads.length} [${freshDownloads.map((d) => d.filename).slice(0, 6).join(', ')}], onDisk=${targetAlreadyOnDisk}`,
        );
      }
      if (!matched && !targetAlreadyOnDisk && (!storedUrlClean.startsWith('http') || storedUrlClean === pageUrl)) {
        if (isDryRun) {
          runLogger(
            'warn',
            `[Dry Run · Retry] Could not resolve fresh download link for ${targetFile.filename}`,
            pageUrl,
          );
          failed += 1;
          return;
        }
        upsertReleaseFile({
          releaseId: item.id,
          targetFileId: targetFile.id,
          remoteUrl: targetFile.remoteUrl,
          downloadUrl: targetFile.downloadUrl,
          remotePath: targetFile.remotePath,
          localPath: targetFile.localPath,
          filename: targetFile.filename,
          displayLabel: targetFile.displayLabel,
          fileRole: targetFile.fileRole,
          status: 'failed',
          errorMessage: `Could not resolve a fresh download link from ${pageUrl}`,
          lastRunId: runId,
        });
        runLogger('error', `Could not resolve fresh download link for ${targetFile.filename}`, pageUrl);
        this.emitCatalogUpdated('file_failed', item.id);
        failed += 1;
        return;
      }

      const release: DiscoveredRelease = matched || {
        remoteUrl: targetFile.remoteUrl,
        pageUrl,
        downloadUrl: targetFile.downloadUrl,
        remotePath: targetFile.remotePath,
        filename: targetFile.filename,
        displayLabel: targetFile.displayLabel,
        systemName: item.systemName,
        releaseType: targetFile.fileRole,
        title: item.title,
        publishedAt: item.publishedAt,
      };

      if (isDryRun) {
        if (targetAlreadyOnDisk) {
          skipped += 1;
        } else {
          wouldRecover += 1;
          runLogger(
            'info',
            `[Dry Run · Retry] Verified fresh download link for ${release.remotePath || release.filename}`,
            release.downloadUrl,
          );
        }
        return;
      }

      const latestRetryItem = getRepositoryItemById(item.id) || item;
      const retryFoundIdx = latestRetryItem.files.findIndex((f) => f.id === targetFile.id);
      const retryItemTotal = Math.max(latestRetryItem.files.length, filesToRetry.length, 1);
      const outcome = await this.downloadReleaseFile(
        item.id,
        release,
        cfg,
        runId,
        signal,
        runLogger,
        latestRetryItem,
        targetFile.id,
        {
          index: retryFoundIdx >= 0 ? retryFoundIdx + 1 : fileIdx + 1,
          total: retryItemTotal,
        },
      );
      if (outcome.downloaded) downloaded += 1;
      if (outcome.skipped) skipped += 1;
      if (outcome.failed) failed += 1;
      bytes += outcome.bytes;
    }, this.subscribeRuntimeConfig);

    if (!isDryRun && !signal.aborted && failed === 0) {
      if (freshDownloads.length > 0) {
        persistDiscoveredReleaseDownloadHints(
          pageUrl,
          freshDownloads.map((d) => ({ filename: d.filename, fileSize: null })),
          { replace: true },
        );
      }
      markCatalogReleaseRemoteChecked(item.id);
    }

    return { downloaded, skipped, failed, bytes, wouldRecover };
  }

  async retryItem(
    itemId: number,
    fileId?: number,
    options?: { dryRun?: boolean },
  ): Promise<SyncRunRecord> {
    const item = getRepositoryItemById(itemId);
    if (!item) {
      throw new Error(`Catalog release #${itemId} not found`);
    }
    if (this.activeRun) {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    let filesToRetry: ReleaseFileRecord[] = [];
    if (fileId !== undefined && Number.isInteger(fileId) && fileId > 0) {
      const targetFile = item.files.find((f) => f.id === fileId);
      if (!targetFile) {
        throw new Error(`File #${fileId} does not belong to catalog release #${itemId}`);
      }
      filesToRetry = [targetFile];
    } else {
      filesToRetry = item.files.filter(
        (f) =>
          f.status === 'failed' ||
          f.status === 'downloading' ||
          f.status === 'queued' ||
          !f.localPath ||
          !fs.existsSync(f.localPath),
      );
      if (filesToRetry.length === 0 && item.files.length > 0) {
        filesToRetry = item.files;
      }
    }

    const pageUrl = item.remoteUrl.split('#')[0];
    if (filesToRetry.length === 0 && !pageUrl.startsWith('http')) {
      throw new Error(`Catalog release #${itemId} has no remote release page or files to retry`);
    }

    const cfg = getInternalConfig();
    this.assertCanRunSync(cfg);
    const root = path.resolve(cfg.downloadDir);
    const isDryRun = Boolean(options?.dryRun);
    const run = createSyncRun('retry', 'incremental', isDryRun);
    const actionPrefix = isDryRun ? 'Dry Run (Retry)' : 'Retrying';
    this.activeRun = run;
    this.abortController = new AbortController();
    this.setActiveSyncItemFromRecord(item);
    this.currentPhase = `${actionPrefix}: ${item.title}`;
    this.emitStatus();

    void (async () => {
      const signal = this.abortController!.signal;
      const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null, run.id);
      let attemptedFiles = filesToRetry.length;
      let downloaded = 0;
      let skipped = 0;
      let failed = 0;
      let bytes = 0;
      let wouldRecover = 0;

      try {
        if (!cfg.username || !cfg.password) {
          throw new Error('Credentials missing: configure Repository Username and Password before retrying downloads.');
        }
        if (!this.client.getAuthStatus(cfg, getLastAuthenticatedAt()).authenticated) {
          const loginRes = await this.client.login(cfg, signal, runLogger);
          if (!loginRes.authenticated) {
            throw new Error(loginRes.message);
          }
          const ts = recordSuccessfulLogin();
          this.client.setPersistedLastAuthenticatedAt(ts);
        }

        const outcome = await this.retryReleaseEntry(
          item,
          filesToRetry,
          cfg,
          run.id,
          root,
          signal,
          runLogger,
          isDryRun,
        );
        downloaded = outcome.downloaded;
        skipped = outcome.skipped;
        failed = outcome.failed;
        bytes = outcome.bytes;
        wouldRecover = outcome.wouldRecover;
        attemptedFiles = Math.max(attemptedFiles, downloaded + wouldRecover + skipped + failed);

        const resolvedAny = downloaded > 0 || wouldRecover > 0 || skipped > 0;
        if (!signal.aborted && !resolvedAny) {
          const latestItem = getRepositoryItemById(item.id);
          const detailErr = !isDryRun ? latestItem?.errorMessage : null;
          throw new Error(detailErr || `${isDryRun ? 'Dry-run retry' : 'Retry'} failed for all ${Math.max(1, failed)} file(s)`);
        }

        const finalStatus = signal.aborted ? 'stopped' : 'completed';
        updateSyncRun(run.id, {
          status: finalStatus,
          finishedAt: new Date().toISOString(),
          newFound: attemptedFiles,
          downloadedCount: downloaded,
          skippedCount: skipped,
          failedCount: failed,
          bytesDownloaded: bytes,
          avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
        });
        if (isDryRun) {
          runLogger(
            'info',
            `Retry dry run #${run.id} ${finalStatus} for ${item.title}: ${wouldRecover} link(s) verified, ${skipped} already on disk, ${failed} unresolved`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!signal.aborted && !isDryRun) {
          const latestItem = getRepositoryItemById(item.id);
          if (filesToRetry.length > 0) {
            for (const f of filesToRetry) {
              const currentFile = latestItem?.files.find((cf) => cf.id === f.id);
              if (currentFile && (currentFile.status === 'downloaded' || currentFile.status === 'skipped')) {
                continue;
              }
              upsertReleaseFile({
                releaseId: item.id,
                targetFileId: f.id,
                remoteUrl: f.remoteUrl,
                downloadUrl: f.downloadUrl,
                remotePath: f.remotePath,
                localPath: f.localPath,
                filename: f.filename,
                displayLabel: f.displayLabel,
                fileRole: f.fileRole,
                status: 'failed',
                errorMessage: msg,
                lastRunId: run.id,
              });
            }
          } else {
            markCatalogReleaseFailed(item.id, msg, run.id);
          }
          this.emitCatalogUpdated('file_failed', item.id);
        }
        updateSyncRun(run.id, {
          status: signal.aborted ? 'stopped' : 'failed',
          finishedAt: new Date().toISOString(),
          newFound: Math.max(1, attemptedFiles),
          downloadedCount: downloaded,
          skippedCount: skipped,
          failedCount: Math.max(1, failed),
          bytesDownloaded: bytes,
          errorSummary: msg,
        });
        if (!signal.aborted) {
          runLogger('error', `${isDryRun ? 'Retry dry run' : 'Retry run'} #${run.id} failed: ${msg}`);
        }
      } finally {
        this.clearAllActiveTransfers();
        this.activeRun = null;
        this.abortController = null;
        this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
        this.emitStatus();
        this.notifyActiveRunFinished();
      }
    })();

    return run;
  }

  async retryAllFailed(options?: {
    system?: string;
    itemIds?: number[];
    dryRun?: boolean;
  }): Promise<SyncRunRecord> {
    if (this.activeRun) {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    const cfg = getInternalConfig();
    this.assertCanRunSync(cfg);

    const targets = listReleasesNeedingRetry({
      system: options?.system,
      ids: options?.itemIds,
    });
    if (targets.length === 0) {
      throw new Error('No failed or partial releases found to retry');
    }

    const lockKey = 'retry:failed';
    if (!acquireDistributedLock(lockKey, POD_ID, 180)) {
      throw new Error(`Another pod holds distributed lock "${lockKey}"`);
    }

    const root = path.resolve(cfg.downloadDir);
    const isDryRun = Boolean(options?.dryRun);
    const run = createSyncRun('retry', 'incremental', isDryRun);
    const phasePrefix = isDryRun ? 'Dry Run (Retry)' : 'Retry Failed';
    this.activeRun = run;
    this.abortController = new AbortController();
    this.activeSyncItem = null;
    this.currentPhase = `${phasePrefix}: ${targets.length} failed/partial release${targets.length === 1 ? '' : 's'}`;

    this.lockRenewTimer = setInterval(() => {
      acquireDistributedLock(lockKey, POD_ID, 180);
    }, 60_000);

    this.log(
      'info',
      `Started ${isDryRun ? 'dry-run batch retry' : 'batch retry'} run #${run.id} for ${targets.length} failed/partial release(s)`,
      [
        options?.system && options.system !== 'all' ? `System filter: ${options.system}` : null,
        isDryRun ? 'Simulation mode (verifying fresh download links only)' : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      run.id,
    );
    this.emitStatus();

    void (async () => {
      const signal = this.abortController!.signal;
      const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null, run.id);
      let attemptedFiles = 0;
      let downloaded = 0;
      let skipped = 0;
      let failed = 0;
      let bytes = 0;
      let wouldRecover = 0;

      try {
        if (!cfg.username || !cfg.password) {
          throw new Error('Credentials missing: configure Repository Username and Password before retrying downloads.');
        }
        if (!this.client.getAuthStatus(cfg, getLastAuthenticatedAt()).authenticated) {
          const loginRes = await this.client.login(cfg, signal, runLogger);
          if (!loginRes.authenticated) {
            throw new Error(loginRes.message);
          }
          const ts = recordSuccessfulLogin();
          this.client.setPersistedLastAuthenticatedAt(ts);
        }

        let retryCompletedTargets = 0;
        await runWithConcurrency(
          targets,
          () => getInternalConfig().maxConcurrency,
          signal,
          async (target, idx) => {
          if (signal.aborted) return;
          const item = getRepositoryItemById(target.id) || target;
          let filesToRetry = item.files.filter(
            (f) =>
              f.status === 'failed' ||
              f.status === 'downloading' ||
              f.status === 'queued' ||
              !f.localPath ||
              !fs.existsSync(f.localPath),
          );
          if (filesToRetry.length === 0 && item.files.length > 0) {
            filesToRetry = item.files;
          }
          const hasPageUrl = item.remoteUrl.split('#')[0].startsWith('http');
          if (filesToRetry.length === 0 && !hasPageUrl) {
            return;
          }

          retryCompletedTargets += 1;
          this.setActiveSyncItemFromRecord(item);
          this.setRunProgress(retryCompletedTargets, targets.length, 'queue', null);
          this.currentPhase = `${phasePrefix} (${Math.min(retryCompletedTargets, targets.length)}/${targets.length}): ${item.systemName} / ${item.title}`;
          this.emitStatus();

          try {
            const outcome = await this.retryReleaseEntry(
              item,
              filesToRetry,
              cfg,
              run.id,
              root,
              signal,
              runLogger,
              isDryRun,
            );
            attemptedFiles += Math.max(
              filesToRetry.length,
              outcome.downloaded + outcome.wouldRecover + outcome.skipped + outcome.failed,
            );
            downloaded += outcome.downloaded;
            wouldRecover += outcome.wouldRecover;
            skipped += outcome.skipped;
            failed += outcome.failed;
            bytes += outcome.bytes;
          } catch (itemErr) {
            if (signal.aborted) return;
            const errMsg = itemErr instanceof Error ? itemErr.message : String(itemErr);
            if (/Cloudflare|Authentication|Re-authentication/i.test(errMsg)) {
              throw itemErr;
            }
            if (isDryRun) {
              const count = Math.max(1, filesToRetry.length);
              attemptedFiles += count;
              failed += count;
              runLogger('warn', `[Dry Run · Retry] Failed to verify ${item.title}: ${errMsg}`, item.remoteUrl);
            } else {
              if (filesToRetry.length > 0) {
                attemptedFiles += filesToRetry.length;
                for (const f of filesToRetry) {
                  upsertReleaseFile({
                    releaseId: item.id,
                    targetFileId: f.id,
                    remoteUrl: f.remoteUrl,
                    downloadUrl: f.downloadUrl,
                    remotePath: f.remotePath,
                    localPath: f.localPath,
                    filename: f.filename,
                    displayLabel: f.displayLabel,
                    fileRole: f.fileRole,
                    status: 'failed',
                    errorMessage: errMsg,
                    lastRunId: run.id,
                  });
                  failed += 1;
                }
              } else {
                attemptedFiles += 1;
                failed += 1;
                markCatalogReleaseFailed(item.id, errMsg, run.id);
              }
              runLogger('error', `Batch retry failed for ${item.title}: ${errMsg}`, item.remoteUrl);
              this.emitCatalogUpdated('file_failed', item.id);
            }
          }

          updateSyncRun(run.id, {
            newFound: attemptedFiles,
            downloadedCount: downloaded,
            skippedCount: skipped,
            failedCount: failed,
            bytesDownloaded: bytes,
            avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
          });
          this.emitStatus();
          void idx;
        }, this.subscribeRuntimeConfig);

        if (!signal.aborted && failed > 0 && downloaded === 0 && wouldRecover === 0 && skipped === 0) {
          throw new Error(`${isDryRun ? 'Dry-run batch retry' : 'Batch retry'} failed for all ${failed} file(s)`);
        }

        const finalStatus = signal.aborted ? 'stopped' : 'completed';
        updateSyncRun(run.id, {
          status: finalStatus,
          finishedAt: new Date().toISOString(),
          newFound: attemptedFiles,
          downloadedCount: downloaded,
          skippedCount: skipped,
          failedCount: failed,
          bytesDownloaded: bytes,
          avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
        });
        runLogger(
          'info',
          isDryRun
            ? `Batch retry dry run #${run.id} ${finalStatus}: ${wouldRecover} fresh link(s) verified, ${skipped} already on disk, ${failed} unresolved`
            : `Batch retry run #${run.id} ${finalStatus}: ${downloaded} recovered, ${skipped} skipped, ${failed} failed`,
        );
        if (finalStatus === 'completed' && !isDryRun && downloaded > 0) {
          recordAchievementCounter('retry_recovered', downloaded, 'increment');
          this.evaluateAndEmitAchievements();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateSyncRun(run.id, {
          status: signal.aborted ? 'stopped' : 'failed',
          finishedAt: new Date().toISOString(),
          newFound: attemptedFiles,
          downloadedCount: downloaded,
          skippedCount: skipped,
          failedCount: Math.max(1, failed),
          bytesDownloaded: bytes,
          errorSummary: msg,
        });
        if (!signal.aborted) {
          runLogger('error', `${isDryRun ? 'Batch retry dry run' : 'Batch retry run'} #${run.id} failed: ${msg}`);
        }
      } finally {
        if (this.lockRenewTimer) {
          clearInterval(this.lockRenewTimer);
          this.lockRenewTimer = null;
        }
        releaseDistributedLock(lockKey, POD_ID);
        this.clearAllActiveTransfers();
        this.activeRun = null;
        this.abortController = null;
        this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
        this.emitStatus();
        this.notifyActiveRunFinished();
      }
    })();

    return run;
  }

  stopActiveRun(): boolean {
    if (!this.activeRun || !this.abortController) return false;
    this.activeSyncItem = null;
    this.currentPhase = `Stopping run #${this.activeRun.id}...`;
    this.log('warn', `Abort requested for run #${this.activeRun.id}`, null, this.activeRun.id);
    this.abortController.abort();
    this.emitStatus();
    return true;
  }

  private async executeRun(
    run: SyncRunRecord,
    cfg: ScraperConfigInternal,
    lockKey: string,
    options?: {
      dryRun?: boolean;
      refreshStaleIndexes?: boolean;
      legacyFullCrawl?: boolean;
    },
  ): Promise<void> {
    const signal = this.abortController!.signal;
    const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null, run.id);
    const startRateHits = this.rateLimiter.getTelemetry().rateLimitHits;

    let pagesCrawled = 0;
    let successfulPages = 0;
    let lastCrawlError: string | null = null;
    let newFound = 0;
    let downloadedCount = 0;
    let skippedCount = 0;
    let skippedByTypeCount = 0;
    let failedCount = 0;
    let bytesDownloaded = 0;
    let newestReleaseIso: string | null = null;
    let runSummarySnapshot: SyncRunSummarySnapshot | null = null;
    let liveCfg: ScraperConfigInternal = cfg;
    let liveAllowedReleaseTypes = normalizeAllowedReleaseTypes(liveCfg.allowedReleaseTypes);
    let liveHasReleaseTypeFilter = liveAllowedReleaseTypes.length > 0;
    let observedRuleRevision = this.syncRulesRevision;
    let observedRuntimeRevision = this.runtimeConfigRevision;
    let appliedRuleVersion = 0;
    let lastWidenedRuleVersion = 0;
    let lastAppliedRuleDiff: SyncRuleDiff | null = null;
    let knownDiscoveredSystems: string[] = filterValidSystemSlugs(liveCfg.discoveredSystems).map((s) =>
      s.toLowerCase(),
    );
    let liveTargetSystems: string[] = [];
    const typeSkippedReleaseUrls = new Set<string>();
    const typeSkippedFileUrls = new Set<string>();

    const inferSystemFromUrl = (rawUrl: string): string => {
      try {
        return resolveMirroredPaths(liveCfg.baseUrl, rawUrl, liveCfg.downloadDir, 'probe.zip').systemName;
      } catch {
        return '';
      }
    };

    const recordObservedTimestamp = (raw: string | null | undefined) => {
      if (!raw) return;
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) return;
      if (!newestReleaseIso || ms > Date.parse(newestReleaseIso)) {
        newestReleaseIso = new Date(ms).toISOString();
      }
    };

    const persistCounters = () => {
      const rl = this.rateLimiter.getTelemetry();
      this.activeRun = updateSyncRun(run.id, {
        pagesCrawled,
        newFound,
        downloadedCount,
        skippedCount,
        failedCount,
        bytesDownloaded,
        rateLimitHits: Math.max(0, rl.rateLimitHits - startRateHits),
        avgDelayMs: rl.currentDelayMs,
      });
      this.emitStatus();
    };

    try {
      if (!cfg.username || !cfg.password) {
        throw new Error('Credentials missing: configure Repository Username and Repository Password before syncing.');
      }
      if (!this.client.getAuthStatus(cfg, getLastAuthenticatedAt()).authenticated) {
        this.currentPhase = 'Authenticating with retrogametalk.com';
        this.emitStatus();
        const loginRes = await this.client.login(cfg, signal, runLogger);
        if (!loginRes.authenticated) {
          throw new Error(loginRes.message);
        }
        const ts = recordSuccessfulLogin();
        this.client.setPersistedLastAuthenticatedAt(ts);
      }

      const runStartedAt = new Date().toISOString();
      const isDryRun = Boolean(run.dryRun) || run.mode === 'dry_run';
      const isDeltaMode = run.mode !== 'full';
      const dryRunScopeTag = isDeltaMode ? 'Incremental' : 'Full';
      const usingDefaultLookback = !cfg.lastWatermarkAt;
      const effectiveCutoffIso = isDeltaMode
        ? (cfg.lastWatermarkAt || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        : null;
      const cutoffMs = effectiveCutoffIso ? Date.parse(effectiveCutoffIso) : null;

      if (isDeltaMode && effectiveCutoffIso) {
        runLogger(
          'info',
          `${isDryRun ? 'Dry Run (Incremental)' : 'Incremental'} cutoff active: ${effectiveCutoffIso}`,
          isDryRun
            ? 'Simulating delta sync since cutoff (no files downloaded or watermark changes)'
            : usingDefaultLookback
              ? 'Default 24h lookback (no prior watermark)'
              : 'Syncing releases created or updated since cutoff',
        );
      } else if (isDryRun) {
        runLogger(
          'info',
          'Dry Run (Full Sync) active: simulating uncapped mirror across target scope',
          'Inspecting all releases in scope without downloading archives or modifying catalog rows',
        );
      } else {
        runLogger('info', 'Full Sync mode active: uncapped mirror of every release in target scope');
      }

      if (liveHasReleaseTypeFilter) {
        runLogger(
          'info',
          `Release Type Filter active: ${formatAllowedReleaseTypesSummary(liveAllowedReleaseTypes)}`,
          'Releases and archives outside the enabled categories will be skipped before download link resolution',
        );
      }

      const visitedPages = new Set<string>();
      const visitedReleasePages = new Set<string>();
      const processedFileUrls = new Set<string>();

      const syncLiveRules = (): SyncRuleDiff | null => {
        const rulesChanged = this.syncRulesRevision !== observedRuleRevision;
        const runtimeChanged = this.runtimeConfigRevision !== observedRuntimeRevision;
        if (!rulesChanged && !runtimeChanged) {
          return null;
        }
        const freshCfg = getInternalConfig();
        observedRuntimeRevision = this.runtimeConfigRevision;

        if (!rulesChanged) {
          liveCfg = freshCfg;
          return null;
        }

        const combinedDiscovered = filterValidSystemSlugs([
          ...knownDiscoveredSystems,
          ...freshCfg.discoveredSystems,
        ]).map((s) => s.toLowerCase());
        knownDiscoveredSystems = combinedDiscovered;

        const diff = diffSyncRules(liveCfg, freshCfg, combinedDiscovered);
        observedRuleRevision = this.syncRulesRevision;
        liveCfg = freshCfg;
        liveAllowedReleaseTypes = normalizeAllowedReleaseTypes(freshCfg.allowedReleaseTypes);
        liveHasReleaseTypeFilter = liveAllowedReleaseTypes.length > 0;
        liveTargetSystems = resolveTargetConsoleScope(freshCfg.systemFilter, combinedDiscovered);

        if (diff.changed) {
          appliedRuleVersion += 1;
          lastAppliedRuleDiff = diff;
          if (diff.releaseTypesWidened) {
            lastWidenedRuleVersion = appliedRuleVersion;
          }
        }

        if (diff.releaseTypesWidened) {
          for (const url of typeSkippedReleaseUrls) {
            visitedReleasePages.delete(url);
          }
          typeSkippedReleaseUrls.clear();
          for (const fileUrl of typeSkippedFileUrls) {
            processedFileUrls.delete(fileUrl);
          }
          typeSkippedFileUrls.clear();
        }
        return diff;
      };

      const baseWithSlash = (() => {
        try {
          const u = new URL(cfg.baseUrl);
          if (!u.pathname.endsWith('/')) u.pathname += '/';
          return u.toString();
        } catch {
          return cfg.baseUrl.endsWith('/') ? cfg.baseUrl : `${cfg.baseUrl}/`;
        }
      })();

      const processDiscoveredReleasePage = async (
        pageUrl: string,
        rawReleases: DiscoveredRelease[],
        preloadedMeta?: ReleaseMetadata,
      ) => {
        if (signal.aborted || rawReleases.length === 0) return;

        // Deduplicate downloads within this release page by filename & remoteUrl
        const uniqueReleases: DiscoveredRelease[] = [];
        const seenKeys = new Set<string>();
        for (const rel of rawReleases) {
          const key = rel.filename.toLowerCase();
          if (seenKeys.has(key) || processedFileUrls.has(rel.remoteUrl)) continue;
          seenKeys.add(key);
          uniqueReleases.push(rel);
        }
        if (uniqueReleases.length === 0) return;

        const canonicalPageUrl = pageUrl.split('#')[0];
        const sampleRel = uniqueReleases[0];
        const mirroredProbe = resolveMirroredPaths(
          cfg.baseUrl,
          canonicalPageUrl,
          cfg.downloadDir,
          sampleRel.filename,
        );
        const releaseLocalDir = path.dirname(mirroredProbe.localPath);
        const releaseRemoteDir = path.posix.dirname(mirroredProbe.remotePath);
        const systemName = canonicalizeSystemSlug(sampleRel.systemName || mirroredProbe.systemName);

        recordObservedTimestamp(preloadedMeta?.publishedAt);
        recordObservedTimestamp(preloadedMeta?.remoteUpdatedAt);
        for (const rel of uniqueReleases) {
          recordObservedTimestamp(rel.publishedAt);
        }

        // Reconcile releaseTags using all discovered files on the page + WP taxonomy metadata
        const pageFilenames = uniqueReleases.map((r) => r.filename);
        let effectiveMeta = preloadedMeta;
        if (effectiveMeta) {
          const fileRoles = uniqueReleases.map((r) =>
            classifyFileRole(r.filename, r.displayLabel || r.filename, {
              genres: effectiveMeta!.genres,
              languages: effectiveMeta!.languages,
              sources: effectiveMeta!.sources,
              title: effectiveMeta!.title,
              systemName,
              siblingFilenames: pageFilenames,
            }),
          );
          const mergedHintsByKey = new Map<string, { filename: string; fileSize: string }>();
          for (const existingHint of effectiveMeta.downloadHints || []) {
            const key = existingHint.filename.trim().toLowerCase();
            if (key) mergedHintsByKey.set(key, existingHint);
          }
          for (const rel of uniqueReleases) {
            const key = rel.filename.trim().toLowerCase();
            if (key && !mergedHintsByKey.has(key)) {
              mergedHintsByKey.set(key, { filename: rel.filename, fileSize: '' });
            }
          }
          effectiveMeta = {
            ...effectiveMeta,
            downloadHints: Array.from(mergedHintsByKey.values()),
            releaseTags: deriveReleaseTags(
              {
                genres: effectiveMeta.genres,
                languages: effectiveMeta.languages,
                sources: effectiveMeta.sources,
                systemName: effectiveMeta.consoleName || systemName,
              },
              fileRoles,
            ),
          };
        }

        // Persist discovered filenames into SQLite metadata_json.downloadHints so future Full Syncs
        // know concrete per-file roles even when all files on the page are excluded by Type Filter
        if (!isDryRun) {
          persistDiscoveredReleaseDownloadHints(
            canonicalPageUrl,
            uniqueReleases.map((r) => ({ filename: r.filename })),
          );
        }

        // Re-check live Sync Rules & per-game Sync Override before per-file filtering or catalog writes
        syncLiveRules();
        const existingGroupItem = getRepositoryItemByRemoteUrl(canonicalPageUrl);
        const groupSyncOverride = existingGroupItem?.syncOverride ?? 'default';
        if (groupSyncOverride === 'ignore') {
          skippedCount += uniqueReleases.length;
          runLogger(
            'info',
            `[Sync Override] Skipped ignored release ${effectiveMeta?.title || canonicalPageUrl}`,
            'Excluded by per-game Ignore override',
          );
          persistCounters();
          return;
        }
        if (groupSyncOverride !== 'pin' && !isConsoleAllowedBySyncRules(systemName, liveCfg)) {
          skippedCount += uniqueReleases.length;
          runLogger(
            'info',
            `[Live Rules] Skipped ${effectiveMeta?.title || canonicalPageUrl}`,
            `Console "${systemName}" was removed from Target Consoles mid-run`,
          );
          persistCounters();
          return;
        }

        // Evaluate per-file release type allowlist before creating catalog rows or downloading archives
        const eligibleReleases: DiscoveredRelease[] = [];
        if (liveHasReleaseTypeFilter && groupSyncOverride !== 'pin') {
          const baseMetaTags = effectiveMeta?.releaseTags || [];
          for (const rel of uniqueReleases) {
            const role = classifyFileRole(rel.filename, rel.displayLabel || rel.filename, {
              genres: effectiveMeta?.genres,
              languages: effectiveMeta?.languages,
              sources: effectiveMeta?.sources,
              title: effectiveMeta?.title || rel.title,
              systemName,
              siblingFilenames: pageFilenames,
            });
            const fileTypeKeys = classifyFileRoleToTypeKeys(role, baseMetaTags, systemName);
            const match = evaluateReleaseTypeMatch(fileTypeKeys, liveAllowedReleaseTypes);
            if (!match.allowed) {
              processedFileUrls.add(rel.remoteUrl);
              typeSkippedFileUrls.add(rel.remoteUrl);
              typeSkippedReleaseUrls.add(canonicalPageUrl);
              newFound += 1;
              skippedCount += 1;
              skippedByTypeCount += 1;
              runLogger(
                'info',
                `${isDryRun ? `[Dry Run · ${dryRunScopeTag}] ` : ''}[Type Filter] Skipped ${rel.filename}`,
                `Detected type: ${match.detectedLabels.join(', ')} (excluded by policy)`,
              );
              persistCounters();
            } else {
              eligibleReleases.push(rel);
            }
          }
          if (eligibleReleases.length === 0) {
            return;
          }
        } else {
          eligibleReleases.push(...uniqueReleases);
        }

        if (isDryRun) {
          for (const rel of eligibleReleases) {
            if (signal.aborted) break;
            processedFileUrls.add(rel.remoteUrl);
            newFound += 1;
            const mirrored = resolveMirroredPaths(
              cfg.baseUrl,
              rel.pageUrl || canonicalPageUrl,
              cfg.downloadDir,
              rel.filename,
            );
            const remotePath = rel.remotePath || mirrored.remotePath;
            const expectedLocal = path.resolve(cfg.downloadDir, remotePath);
            const alreadyExists = fs.existsSync(expectedLocal) && fs.statSync(expectedLocal).size > 0;
            if (alreadyExists) {
              skippedCount += 1;
            } else {
              runLogger(
                'info',
                `[Dry Run · ${dryRunScopeTag}] Would download ${remotePath}`,
                rel.displayLabel && rel.displayLabel !== rel.filename
                  ? `${rel.displayLabel} · ${rel.downloadUrl}`
                  : rel.downloadUrl,
              );
            }
            persistCounters();
          }
          return;
        }

        // Level 2 file-level pre-check: skip files already marked Downloaded in SQLite and verified on disk
        const preExistingParent = getRepositoryItemByRemoteUrl(canonicalPageUrl);
        const { alreadyDownloaded, toDownload } = partitionAlreadyDownloadedFiles(
          preExistingParent?.files || [],
          eligibleReleases,
          (rel) => {
            const m = resolveMirroredPaths(
              cfg.baseUrl,
              rel.pageUrl || canonicalPageUrl,
              cfg.downloadDir,
              rel.filename,
            );
            return path.resolve(cfg.downloadDir, rel.remotePath || m.remotePath);
          },
        );

        for (const skippedEntry of alreadyDownloaded) {
          processedFileUrls.add(skippedEntry.release.remoteUrl);
          newFound += 1;
          skippedCount += 1;
          runLogger(
            'debug',
            `[Fast Skip] File already downloaded & verified on disk: ${skippedEntry.existingFile.remotePath || skippedEntry.release.filename}`,
          );
        }

        if (toDownload.length === 0) {
          // Every eligible file is already downloaded & verified on disk — avoid flipping status to 'downloading'
          if (preExistingParent && !signal.aborted) {
            if (uniqueReleases.length > 0) {
              persistDiscoveredReleaseDownloadHints(
                canonicalPageUrl,
                uniqueReleases.map((r) => ({ filename: r.filename, fileSize: null })),
                { replace: true },
              );
            }
            markCatalogReleaseRemoteChecked(preExistingParent.id);
            let emittedUpdate = false;
            if (effectiveMeta && !preExistingParent.metadata?.detailHydrated) {
              try {
                const mirroredAssets = await this.client.mirrorReleaseAssets(
                  effectiveMeta,
                  releaseLocalDir,
                  liveCfg,
                  signal,
                  runLogger,
                );
                updateCatalogReleaseMetadata(
                  preExistingParent.id,
                  mirroredAssets.metadata,
                  mirroredAssets.coverAbsPath,
                  mirroredAssets.screenshotAbsPaths,
                );
                this.emitCatalogUpdated('metadata_mirrored', preExistingParent.id);
                emittedUpdate = true;
              } catch (err) {
                if (signal.aborted) throw err;
                runLogger('warn', `Metadata/artwork sync incomplete for ${preExistingParent.title}`, String(err));
              }
            }
            if (!emittedUpdate) {
              this.emitCatalogUpdated('release_verified', preExistingParent.id);
            }
          }
          persistCounters();
          return;
        }

        let parent = upsertCatalogRelease({
          remoteUrl: canonicalPageUrl,
          remotePath: releaseRemoteDir,
          localPath: releaseLocalDir,
          systemName,
          title: effectiveMeta?.title || sampleRel.title || path.basename(releaseRemoteDir),
          publishedAt: effectiveMeta?.publishedAt ?? eligibleReleases.find((r) => r.publishedAt)?.publishedAt ?? null,
          remoteUpdatedAt: effectiveMeta?.remoteUpdatedAt ?? null,
          status: 'downloading',
          lastRunId: run.id,
          metadata: effectiveMeta ?? null,
        });
        this.setActiveSyncItemFromRecord(parent);
        this.emitCatalogUpdated('release_discovered', parent.id);
        this.emitStatus();

        // Mirror cover art, screenshots, and metadata.json once per release page
        if (effectiveMeta) {
          try {
            const mirroredAssets = await this.client.mirrorReleaseAssets(
              effectiveMeta,
              releaseLocalDir,
              liveCfg,
              signal,
              runLogger,
            );
            parent =
              updateCatalogReleaseMetadata(
                parent.id,
                mirroredAssets.metadata,
                mirroredAssets.coverAbsPath,
                mirroredAssets.screenshotAbsPaths,
              ) || parent;
            this.setActiveSyncItemFromRecord(parent);
            this.emitCatalogUpdated('metadata_mirrored', parent.id);
            this.emitStatus();
          } catch (err) {
            if (signal.aborted) throw err;
            runLogger('warn', `Metadata/artwork sync incomplete for ${parent.title}`, String(err));
          }
        }

        // Stream only the files that are not already verified on disk
        const knownParentFiles = (getRepositoryItemById(parent.id) || parent).files;
        const releaseTotalFiles = new Set<string>([
          ...knownParentFiles.map((f) => f.remoteUrl),
          ...eligibleReleases.map((r) => r.remoteUrl),
        ]).size;

        let pageFailedCount = 0;
        await runWithConcurrency(
          toDownload,
          () => {
            syncLiveRules();
            return liveCfg.maxConcurrency;
          },
          signal,
          async (rel, fileIdx) => {
          if (signal.aborted) return;

          // Gracefully enforce live Sync Rule updates right before starting each next file
          // (in-flight transfers finish cleanly; newly excluded remaining files are skipped immediately)
          syncLiveRules();
          if (groupSyncOverride !== 'pin' && !isConsoleAllowedBySyncRules(systemName, liveCfg)) {
            skippedCount += 1;
            runLogger(
              'info',
              `[Live Rules] Skipped ${rel.filename}`,
              `Console "${systemName}" was removed from Target Consoles mid-run`,
            );
            persistCounters();
            return;
          }
          if (liveHasReleaseTypeFilter && groupSyncOverride !== 'pin') {
            const role = classifyFileRole(rel.filename, rel.displayLabel || rel.filename, {
              genres: effectiveMeta?.genres,
              languages: effectiveMeta?.languages,
              sources: effectiveMeta?.sources,
              title: effectiveMeta?.title || rel.title,
              systemName,
              siblingFilenames: pageFilenames,
            });
            const fileTypeKeys = classifyFileRoleToTypeKeys(
              role,
              effectiveMeta?.releaseTags || [],
              systemName,
            );
            const match = evaluateReleaseTypeMatch(fileTypeKeys, liveAllowedReleaseTypes);
            if (!match.allowed) {
              processedFileUrls.add(rel.remoteUrl);
              typeSkippedFileUrls.add(rel.remoteUrl);
              typeSkippedReleaseUrls.add(canonicalPageUrl);
              skippedCount += 1;
              skippedByTypeCount += 1;
              runLogger(
                'info',
                `[Live Rules] Skipped ${rel.filename}`,
                `Detected type: ${match.detectedLabels.join(', ')} (excluded by updated Sync Rules)`,
              );
              persistCounters();
              return;
            }
          }

          processedFileUrls.add(rel.remoteUrl);
          newFound += 1;

          const currentParent = getRepositoryItemById(parent.id) || parent;
          const outcome = await this.downloadReleaseFile(
            parent.id,
            rel,
            liveCfg,
            run.id,
            signal,
            runLogger,
            currentParent,
            undefined,
            {
              index: alreadyDownloaded.length + fileIdx + 1,
              total: Math.max(releaseTotalFiles, eligibleReleases.length),
            },
          );
          if (outcome.downloaded) downloadedCount += 1;
          if (outcome.skipped) skippedCount += 1;
          if (outcome.failed) {
            failedCount += 1;
            pageFailedCount += 1;
          }
          bytesDownloaded += outcome.bytes;
          persistCounters();
        }, this.subscribeRuntimeConfig);

        if (!signal.aborted && pageFailedCount === 0) {
          if (uniqueReleases.length > 0) {
            persistDiscoveredReleaseDownloadHints(
              canonicalPageUrl,
              uniqueReleases.map((r) => ({ filename: r.filename, fileSize: null })),
              { replace: true },
            );
          }
          markCatalogReleaseRemoteChecked(parent.id);
        }
      };

      const inspectAndProcessReleasePage = async (
        relPageUrl: string,
        preloadedWpData?: WpPostMetadata | null,
        enforceCutoffMs?: number | null,
      ): Promise<{ newerThanCutoff: boolean }> => {
        syncLiveRules();
        const canonicalRelUrl = relPageUrl.split('#')[0];
        if (visitedReleasePages.has(canonicalRelUrl)) {
          return { newerThanCutoff: false };
        }
        const existingPageItem = getRepositoryItemByRemoteUrl(canonicalRelUrl);
        const pageSyncOverride = existingPageItem?.syncOverride ?? 'default';
        if (pageSyncOverride === 'ignore') {
          visitedReleasePages.add(canonicalRelUrl);
          skippedCount += 1;
          runLogger(
            'info',
            `[Sync Override] Skipped ignored release ${existingPageItem?.title || canonicalRelUrl}`,
            'Excluded by per-game Ignore override',
          );
          persistCounters();
          return { newerThanCutoff: false };
        }
        const preFetchSys = inferSystemFromUrl(canonicalRelUrl);
        if (pageSyncOverride !== 'pin' && preFetchSys && !isConsoleAllowedBySyncRules(preFetchSys, liveCfg)) {
          runLogger(
            'info',
            `[Live Rules] Skipped ${canonicalRelUrl}`,
            `Console "${preFetchSys}" was removed from Target Consoles mid-run`,
          );
          return { newerThanCutoff: false };
        }
        visitedReleasePages.add(canonicalRelUrl);

        try {
          const relPage = await this.client.fetchPageHtml(canonicalRelUrl, liveCfg, signal, runLogger);
          pagesCrawled += 1;
          if (relPage.status >= 400) {
            runLogger(
              'debug',
              `[Scrape] Skipping release page ${canonicalRelUrl} (HTTP ${relPage.status})`,
              `finalUrl=${relPage.finalUrl}`,
            );
            persistCounters();
            return { newerThanCutoff: false };
          }
          successfulPages += 1;

          const wpData =
            preloadedWpData !== undefined
              ? preloadedWpData
              : await this.client.fetchReleaseWpMetadata(
                  relPage.finalUrl,
                  this.client.extractWpPostIdHint(relPage.html),
                  liveCfg,
                  signal,
                  runLogger,
                );

          // In delta fallback mode, verify RGT creation/modification timestamp BEFORE resolving download nonces
          const inferredSys = inferSystemFromUrl(relPage.finalUrl);
          syncLiveRules();
          if (pageSyncOverride !== 'pin' && inferredSys && !isConsoleAllowedBySyncRules(inferredSys, liveCfg)) {
            runLogger(
              'info',
              `[Live Rules] Skipped ${wpData?.title || canonicalRelUrl}`,
              `Console "${inferredSys}" was removed from Target Consoles mid-run`,
            );
            return { newerThanCutoff: false };
          }

          const prelimHintFilenames = (wpData?.downloadHints || []).map((h) => h.filename);
          const prelimHintRoles = (wpData?.downloadHints || []).map((h) =>
            classifyFileRole(h.filename, '', {
              genres: wpData?.genres,
              languages: wpData?.languages,
              sources: wpData?.sources,
              title: wpData?.title || undefined,
              systemName: inferredSys,
              siblingFilenames: prelimHintFilenames,
            }),
          );
          const prelimMeta = this.client.extractReleaseMetadata(
            relPage.html,
            relPage.finalUrl,
            wpData,
            prelimHintRoles,
          );
          if (enforceCutoffMs !== null && enforceCutoffMs !== undefined) {
            const pubMs = prelimMeta.publishedAt ? Date.parse(prelimMeta.publishedAt) : NaN;
            const updMs = prelimMeta.remoteUpdatedAt ? Date.parse(prelimMeta.remoteUpdatedAt) : NaN;
            const latestMs = Math.max(
              Number.isNaN(pubMs) ? -Infinity : pubMs,
              Number.isNaN(updMs) ? -Infinity : updMs,
            );
            if (!Number.isFinite(latestMs) || latestMs <= enforceCutoffMs) {
              runLogger(
                'debug',
                `[Scrape] Release older than cutoff: ${prelimMeta.title || canonicalRelUrl}`,
                `published=${prelimMeta.publishedAt ?? 'null'}, modified=${prelimMeta.remoteUpdatedAt ?? 'null'}, cutoff=${new Date(enforceCutoffMs).toISOString()}`,
              );
              persistCounters();
              return { newerThanCutoff: false };
            }
          }

          // Pre-nonce Release Type Allowlist gate: skip disallowed releases before resolving download links
          if (liveHasReleaseTypeFilter && pageSyncOverride !== 'pin') {
            const prelimSystem = prelimMeta.consoleName || inferredSys;
            const prelimTags = prelimMeta.releaseTags || [];
            const prelimTypeKeys =
              prelimHintRoles.length > 0
                ? Array.from(
                    new Set(
                      prelimHintRoles.flatMap((role) =>
                        classifyFileRoleToTypeKeys(role, prelimTags, prelimSystem),
                      ),
                    ),
                  )
                : classifyReleaseTagsToTypeKeys(prelimTags, prelimSystem);
            const match = evaluateReleaseTypeMatch(prelimTypeKeys, liveAllowedReleaseTypes);
            if (!match.allowed) {
              typeSkippedReleaseUrls.add(canonicalRelUrl);
              recordObservedTimestamp(prelimMeta.publishedAt);
              recordObservedTimestamp(prelimMeta.remoteUpdatedAt);
              newFound += 1;
              skippedCount += 1;
              skippedByTypeCount += 1;
              runLogger(
                'info',
                `${isDryRun ? `[Dry Run · ${dryRunScopeTag}] ` : ''}[Type Filter] Skipped ${prelimMeta.title || canonicalRelUrl}`,
                `Detected type: ${match.detectedLabels.join(', ')} (excluded before resolving download links)`,
              );
              persistCounters();
              return { newerThanCutoff: true };
            }
          }

          const dynamicReleases = await this.client.extractDynamicReleaseDownloads(
            relPage.html,
            relPage.finalUrl,
            cfg,
            signal,
            runLogger,
          );
          const relExtracted = this.client.extractLinksFromHtml(relPage.html, relPage.finalUrl, cfg);

          const combinedMap = new Map<string, DiscoveredRelease>();
          for (const d of [...dynamicReleases, ...relExtracted.downloads]) {
            const key = d.filename.toLowerCase();
            if (!combinedMap.has(key)) {
              combinedMap.set(key, d);
            }
          }
          const combined = Array.from(combinedMap.values());
          const combinedFilenames = combined.map((r) => r.filename);

          const fileRoles = combined.map((r) =>
            classifyFileRole(r.filename, r.displayLabel || r.filename, {
              genres: wpData?.genres,
              languages: wpData?.languages,
              sources: wpData?.sources,
              title: wpData?.title || r.title,
              systemName: r.systemName,
              siblingFilenames: combinedFilenames,
            }),
          );
          const releaseMeta = this.client.extractReleaseMetadata(
            relPage.html,
            relPage.finalUrl,
            wpData,
            fileRoles,
          );

          if (combined.length > 0) {
            await processDiscoveredReleasePage(relPage.finalUrl, combined, releaseMeta);
          } else {
            runLogger(
              'debug',
              `[Scrape] Release page yielded 0 dynamic/HTML download links: ${canonicalRelUrl}`,
              `wpPostId=${wpData?.wpPostId ?? 'none'}, dynamic=${dynamicReleases.length}, htmlLinks=${relExtracted.downloads.length}, htmlLen=${relPage.html.length}`,
            );
            persistCounters();
          }

          return { newerThanCutoff: true };
        } catch (err) {
          if (signal.aborted) throw err;
          const errMsg = err instanceof Error ? err.message : String(err);
          if (/Cloudflare|Authentication|Re-authentication/i.test(errMsg)) {
            throw err;
          }
          runLogger('debug', `[Scrape] Exception inspecting release page ${canonicalRelUrl}`, formatErrorDetails(err));
          runLogger('warn', `Error inspecting ${canonicalRelUrl}`, errMsg);
          return { newerThanCutoff: false };
        }
      };

      const crawlHtmlScope = async (
        seedUrls: string[],
        scopeSystemSlug: string | null,
        preloadedFirstPage?: { url: string; html: string; finalUrl: string },
      ) => {
        const queue = [...seedUrls];

        while (queue.length > 0) {
          if (signal.aborted) break;
          syncLiveRules();
          if (scopeSystemSlug && !isConsoleAllowedBySyncRules(scopeSystemSlug, liveCfg)) {
            runLogger(
              'info',
              `[Live Rules] Stopping HTML crawl for ${scopeSystemSlug} — console removed from Target Consoles`,
            );
            break;
          }
          const scopedCfg: ScraperConfigInternal = scopeSystemSlug
            ? { ...liveCfg, systemFilter: scopeSystemSlug }
            : liveCfg;
          const pageUrl = queue.shift()!;
          if (visitedPages.has(pageUrl)) continue;
          visitedPages.add(pageUrl);

          let pageData: { html: string; finalUrl: string; status: number };
          if (preloadedFirstPage && preloadedFirstPage.url === pageUrl) {
            pageData = {
              html: preloadedFirstPage.html,
              finalUrl: preloadedFirstPage.finalUrl,
              status: 200,
            };
          } else {
            this.activeSyncItem = null;
            this.currentPhase = `Scanning page (${pagesCrawled + 1}): ${this.formatRelativePhasePath(pageUrl, liveCfg.baseUrl)}`;
            this.emitStatus();
            try {
              pageData = await this.client.fetchPageHtml(pageUrl, liveCfg, signal, runLogger);
            } catch (err) {
              if (signal.aborted) break;
              const errMsg = err instanceof Error ? err.message : String(err);
              lastCrawlError = errMsg;
              runLogger('debug', `[Crawl] Exception fetching listing page ${pageUrl}`, formatErrorDetails(err));
              if (
                pageUrl === cfg.baseUrl ||
                /Cloudflare|Authentication|Re-authentication/i.test(errMsg)
              ) {
                throw err;
              }
              runLogger('warn', `Failed to scan ${pageUrl}: ${errMsg}`);
              continue;
            }

            pagesCrawled += 1;
            if (pageData.status >= 400) {
              const httpErr = `HTTP ${pageData.status} on ${pageData.finalUrl}`;
              lastCrawlError = httpErr;
              if (
                pageUrl === cfg.baseUrl ||
                pageData.status === 401 ||
                pageData.status === 403
              ) {
                throw new Error(httpErr);
              }
              runLogger('warn', httpErr);
              continue;
            }
            successfulPages += 1;
          }

          visitedPages.add(pageData.finalUrl);
          const extracted = this.client.extractLinksFromHtml(pageData.html, pageData.finalUrl, scopedCfg);
          if (extracted.systems.length > 0) {
            saveDiscoveredSystems(extracted.systems);
          }

          // Inline ACF/DLC download widgets on the page itself
          const inlineDynamic = await this.client.extractDynamicReleaseDownloads(
            pageData.html,
            pageData.finalUrl,
            scopedCfg,
            signal,
            runLogger,
          );
          if (inlineDynamic.length > 0) {
            const wpPostIdHint = this.client.extractWpPostIdHint(pageData.html);
            const wpData = await this.client.fetchReleaseWpMetadata(
              pageData.finalUrl,
              wpPostIdHint,
              liveCfg,
              signal,
              runLogger,
            );
            const inlineFilenames = inlineDynamic.map((r) => r.filename);
            const inlineRoles = inlineDynamic.map((r) =>
              classifyFileRole(r.filename, r.displayLabel || r.filename, {
                genres: wpData?.genres,
                languages: wpData?.languages,
                sources: wpData?.sources,
                title: wpData?.title || r.title,
                systemName: r.systemName,
                siblingFilenames: inlineFilenames,
              }),
            );
            const inlineMeta = this.client.extractReleaseMetadata(
              pageData.html,
              pageData.finalUrl,
              wpData,
              inlineRoles,
            );
            const inlineLatestMs = Math.max(
              inlineMeta.publishedAt ? Date.parse(inlineMeta.publishedAt) : -Infinity,
              inlineMeta.remoteUpdatedAt ? Date.parse(inlineMeta.remoteUpdatedAt) : -Infinity,
            );
            if (cutoffMs === null || (Number.isFinite(inlineLatestMs) && inlineLatestMs > cutoffMs)) {
              await processDiscoveredReleasePage(pageData.finalUrl, inlineDynamic, inlineMeta);
            }
          }

          if (extracted.downloads.length > 0) {
            const groupedByPage = new Map<string, DiscoveredRelease[]>();
            for (const rel of extracted.downloads) {
              if (cutoffMs !== null) {
                const relMs = rel.publishedAt ? Date.parse(rel.publishedAt) : NaN;
                if (Number.isNaN(relMs) || relMs <= cutoffMs) {
                  continue;
                }
              }
              const key = (rel.pageUrl || rel.remoteUrl).split('#')[0];
              const list = groupedByPage.get(key) || [];
              list.push(rel);
              groupedByPage.set(key, list);
            }
            for (const [groupPageUrl, groupFiles] of groupedByPage.entries()) {
              await processDiscoveredReleasePage(groupPageUrl, groupFiles);
            }
          }

          let foundNewerReleaseOnPage = false;
          const releaseCandidates: string[] = [];
          for (const relPageUrl of extracted.releasePages) {
            if (signal.aborted) break;
            if (cutoffMs !== null) {
              const cardTimeStr = extracted.releaseTimes.get(relPageUrl);
              if (cardTimeStr) {
                const cardMs = Date.parse(cardTimeStr);
                if (!Number.isNaN(cardMs) && cardMs <= cutoffMs) {
                  continue;
                }
              }
            }
            releaseCandidates.push(relPageUrl);
          }

          await runWithConcurrency(
            releaseCandidates,
            () => {
              syncLiveRules();
              return liveCfg.maxConcurrency;
            },
            signal,
            async (relPageUrl) => {
              if (signal.aborted) return;
              syncLiveRules();
              if (scopeSystemSlug && !isConsoleAllowedBySyncRules(scopeSystemSlug, liveCfg)) {
                return;
              }
              const inspectPrefix = isDryRun
                ? `Dry Run (${dryRunScopeTag}) inspecting`
                : isDeltaMode
                  ? 'Inspecting delta candidate'
                  : 'Full Sync inspecting';
              this.currentPhase = `${inspectPrefix}: ${this.formatRelativePhasePath(relPageUrl, liveCfg.baseUrl)}`;
              this.emitStatus();

              const res = await inspectAndProcessReleasePage(relPageUrl, undefined, cutoffMs);
              if (res.newerThanCutoff) {
                foundNewerReleaseOnPage = true;
              }
            },
            this.subscribeRuntimeConfig,
          );

          const shouldFollowPagination =
            cutoffMs === null ||
            extracted.releasePages.length === 0 ||
            foundNewerReleaseOnPage;

          if (shouldFollowPagination) {
            for (const sub of extracted.subPages) {
              if (!visitedPages.has(sub)) {
                queue.push(sub);
              }
            }
          } else {
            runLogger('info', `Reached cutoff boundary on ${pageUrl}; stopping older pagination`);
          }

          persistCounters();
        }
      };

      // Resolve target console slugs (either user's Console Filter or all discovered RGT consoles)
      const explicitFilters = liveCfg.systemFilter
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      let targetSystems: string[] = [];
      let preloadedRootPage: { url: string; html: string; finalUrl: string } | undefined;

      if (explicitFilters.length > 0) {
        targetSystems = filterValidSystemSlugs(explicitFilters).map((s) => s.toLowerCase());
      } else {
        this.activeSyncItem = null;
        this.currentPhase = `Scanning repository index: ${this.formatRelativePhasePath(liveCfg.baseUrl, liveCfg.baseUrl)}`;
        this.emitStatus();
        const rootPage = await this.client.fetchPageHtml(liveCfg.baseUrl, liveCfg, signal, runLogger);
        pagesCrawled += 1;
        if (rootPage.status >= 400) {
          throw new Error(`HTTP ${rootPage.status} on ${rootPage.finalUrl}`);
        }
        successfulPages += 1;
        preloadedRootPage = { url: liveCfg.baseUrl, html: rootPage.html, finalUrl: rootPage.finalUrl };

        const rootExtracted = this.client.extractLinksFromHtml(
          rootPage.html,
          rootPage.finalUrl,
          { ...liveCfg, systemFilter: '' },
        );
        const liveValidSystems =
          rootExtracted.systems.length > 0
            ? await this.client.filterLiveSystems(rootExtracted.systems, liveCfg, signal, runLogger)
            : [];
        if (liveValidSystems.length > 0) {
          saveDiscoveredSystems(liveValidSystems);
        }

        knownDiscoveredSystems = filterValidSystemSlugs([
          ...knownDiscoveredSystems,
          ...getInternalConfig().discoveredSystems,
          ...liveValidSystems,
        ]).map((s) => s.toLowerCase());
        targetSystems = [...knownDiscoveredSystems];
      }

      liveTargetSystems = [...targetSystems];

      runLogger(
        'debug',
        `[Crawl] Resolved ${liveTargetSystems.length} target system(s)`,
        `systems=[${liveTargetSystems.join(', ')}], mode=${run.mode}, dryRun=${isDryRun}, cutoff=${effectiveCutoffIso ?? 'none'}`,
      );

      const buildWpMetaHintFromItem = (item: RepositoryItemRecord): WpPostMetadata | undefined => {
        if (!item.wpPostId && !item.metadata) return undefined;
        return {
          wpPostId: item.wpPostId ?? item.metadata?.wpPostId ?? 0,
          wpPostType: item.wpPostType ?? item.metadata?.wpPostType ?? item.systemName,
          link: item.remoteUrl,
          title: item.title,
          originalTitle: item.metadata?.subtitle || null,
          dateGmt: item.publishedAt,
          modifiedGmt: item.remoteUpdatedAt,
          descriptionHtml: item.metadata?.descriptionHtml || '',
          genres: item.genres || [],
          regions: item.regions || [],
          languages: item.languages || [],
          sources: item.sources || [],
          formats: item.metadata?.formats || [],
          publisher: item.publisher,
          developer: item.developer,
          releaseYear: item.releaseYear,
          coverUrl: item.metadata?.coverUrl || null,
          screenshotUrls: item.metadata?.screenshotUrls || [],
          downloadHints: item.metadata?.downloadHints || [],
        };
      };

      const isIndexFirstFullSync = !isDeltaMode && !options?.legacyFullCrawl && liveTargetSystems.length > 0;

      if (liveTargetSystems.length === 0) {
        await crawlHtmlScope([liveCfg.baseUrl], null, preloadedRootPage);
      } else if (isIndexFirstFullSync) {
        if (preloadedRootPage) {
          visitedPages.add(preloadedRootPage.url);
          visitedPages.add(preloadedRootPage.finalUrl);
        }

        const shouldRefreshIndexes = options?.refreshStaleIndexes !== false;
        const refreshedConsoles: string[] = [];
        const refreshedConsolesSet = new Set<string>();
        const scannedRestBases = new Set<string>();
        let newDeltaDiscoveredCount = 0;
        const htmlFallbackSystemsSet = new Set<string>();
        const crawledHtmlFallbackSet = new Set<string>();
        const dryRunSimulatedPosts: { systemSlug: string; post: WpPostMetadata }[] = [];
        const checkedOrMirroredUrls = new Set<string>();
        const verifiedOnDiskUrls = new Set<string>();

        let summaryTotalRuleMatched = 0;
        let summaryExcludedByRules = 0;
        let summaryAlreadyOnDisk = 0;
        let summaryWouldDownload = 0;
        let dryRunEstimatedBytes = 0;
        const consoleBreakdownMap = new Map<string, DryRunConsoleBreakdown>();
        const sampleReleases: DryRunSampleRelease[] = [];

        const recordPendingSummaryItem = (
          sysSlug: string,
          sample: DryRunSampleRelease,
          estBytes: number,
        ) => {
          dryRunEstimatedBytes += estBytes;
          const key = (canonicalizeSystemSlug(sysSlug) || sysSlug).toLowerCase();
          const cur = consoleBreakdownMap.get(key);
          if (cur) {
            cur.pendingCount += 1;
            cur.estimatedBytes += estBytes;
          } else {
            consoleBreakdownMap.set(key, {
              systemName: key,
              pendingCount: 1,
              estimatedBytes: estBytes,
            });
          }
          if (sampleReleases.length < 12) {
            sampleReleases.push(sample);
          }
        };

        const initialFreshness = classifySystemIndexFreshness(
          liveTargetSystems,
          getSystemIndexState(),
          Date.now(),
          DEFAULT_INDEX_STALE_MS,
          getCatalogReleaseCountsBySystem(),
        );
        runLogger(
          'info',
          `${isDryRun ? '[Dry Run · Index-First Full] ' : ''}Index-first mirror across ${liveTargetSystems.length} target console(s)`,
          `${initialFreshness.fresh.length} fresh · ${initialFreshness.stale.length} stale · ${initialFreshness.unindexed.length} unindexed · refreshStale=${shouldRefreshIndexes}`,
        );

        const MAX_CONVERGENCE_PASSES = 25;
        let observedFullWidenedVersion = lastWidenedRuleVersion;
        for (let pass = 0; pass < MAX_CONVERGENCE_PASSES && !signal.aborted; pass += 1) {
          syncLiveRules();
          if (lastWidenedRuleVersion !== observedFullWidenedVersion) {
            observedFullWidenedVersion = lastWidenedRuleVersion;
            for (const u of checkedOrMirroredUrls) {
              if (!verifiedOnDiskUrls.has(u) && !visitedReleasePages.has(u)) {
                checkedOrMirroredUrls.delete(u);
              }
            }
          }

          // Phase 1: Ensure any unrefreshed target consoles (including newly added ones) are indexed/delta-checked
          if (shouldRefreshIndexes) {
            let phase1Guard = 0;
            while (!signal.aborted && phase1Guard < 200) {
              phase1Guard += 1;
              syncLiveRules();

              const pendingRefreshConsoles = liveTargetSystems.filter((slug) => {
                const canonical = canonicalizeSystemSlug(slug).toLowerCase();
                return !refreshedConsolesSet.has(canonical);
              });
              if (pendingRefreshConsoles.length === 0) break;

              const systemSlug = pendingRefreshConsoles[0];
              const canonicalSlug = canonicalizeSystemSlug(systemSlug).toLowerCase();
              refreshedConsolesSet.add(canonicalSlug);

              const systemIndexState = getSystemIndexState();
              const countsBySystem = getCatalogReleaseCountsBySystem();
              const freshness = classifySystemIndexFreshness(
                [canonicalSlug],
                systemIndexState,
                Date.now(),
                DEFAULT_INDEX_STALE_MS,
                countsBySystem,
              );
              const needsFullIndex = freshness.unindexed.length > 0 || freshness.stale.length > 0;
              const existingCursor = systemIndexState[canonicalSlug] ?? systemIndexState[systemSlug];
              const deltaCutoffIso =
                !needsFullIndex && existingCursor?.lastIndexedAt
                  ? computeCatalogDeltaCutoffIso(existingCursor.lastIndexedAt)
                  : null;

              const resolvedRestBase = await this.client.resolveWpRestBaseForSystem(systemSlug, liveCfg, signal, runLogger);
              if (resolvedRestBase) {
                const restBaseKey = resolvedRestBase.toLowerCase();
                if (scannedRestBases.has(restBaseKey)) {
                  continue;
                }
                scannedRestBases.add(restBaseKey);
              }

              const completedCount = refreshedConsolesSet.size;
              const totalActiveConsoles = Math.max(completedCount, liveTargetSystems.length);
              this.activeSyncItem = null;
              this.activeRunProgress = null;
              this.currentPhase = needsFullIndex
                ? `${isDryRun ? 'Dry Run · ' : ''}Indexing ${systemSlug} (${completedCount}/${totalActiveConsoles})`
                : `${isDryRun ? 'Dry Run · ' : ''}Delta check ${systemSlug} (${completedCount}/${totalActiveConsoles})`;
              this.emitStatus();

              const phase1ScanStartedAtIso = new Date().toISOString();
              let upsertedForConsole = 0;
              let postsWithLinkForConsole = 0;
              const wpRes = await this.client.listConsoleReleasesViaWpRest(systemSlug, liveCfg, {
                modifiedAfterIso: deltaCutoffIso,
                signal,
                log: runLogger,
                onPageFetched: (wpPage, wpTotalPages) => {
                  pagesCrawled += 1;
                  successfulPages += 1;
                  this.currentPhase = needsFullIndex
                    ? `${isDryRun ? 'Dry Run · ' : ''}Indexing ${systemSlug} · WP page ${wpPage}/${wpTotalPages}`
                    : `${isDryRun ? 'Dry Run · ' : ''}Delta ${systemSlug} · WP page ${wpPage}/${wpTotalPages}`;
                  persistCounters();
                },
                onPostsPage: isDryRun
                  ? undefined
                  : (pagePosts) => {
                      let pageUpserted = 0;
                      for (const post of pagePosts) {
                        recordObservedTimestamp(post.dateGmt);
                        recordObservedTimestamp(post.modifiedGmt);
                        if (!post.link) continue;
                        const existingItem = getRepositoryItemByRemoteUrl(post.link.split('#')[0]);
                        upsertIndexedWpRelease(this.buildWpReleaseRecordInput(post, systemSlug, liveCfg, run.id));
                        postsWithLinkForConsole += 1;
                        if (!existingItem) {
                          upsertedForConsole += 1;
                          pageUpserted += 1;
                        }
                      }
                      if (pageUpserted > 0 || pagePosts.length > 0) {
                        this.emitCatalogUpdated('sync_indexed');
                      }
                    },
              });

              if (signal.aborted) break;

              if (wpRes.supported) {
                successfulPages += 1;
                if (needsFullIndex && wpRes.posts.length === 0) {
                  htmlFallbackSystemsSet.add(systemSlug);
                } else {
                  if (isDryRun) {
                    for (const post of wpRes.posts) {
                      recordObservedTimestamp(post.dateGmt);
                      recordObservedTimestamp(post.modifiedGmt);
                      if (post.link) {
                        dryRunSimulatedPosts.push({ systemSlug: canonicalSlug, post });
                      }
                    }
                    if (needsFullIndex || wpRes.posts.length > 0) {
                      refreshedConsoles.push(canonicalSlug);
                    }
                  } else {
                    if (upsertedForConsole > 0) {
                      newDeltaDiscoveredCount += upsertedForConsole;
                    }
                    const hasExplicitFilterNow = liveCfg.systemFilter.trim().length > 0;
                    updateSystemIndexCursor(
                      canonicalSlug,
                      buildUpdatedSystemIndexCursor({
                        existingCursor,
                        strategy: needsFullIndex ? 'full' : 'delta',
                        scope: hasExplicitFilterNow ? 'filtered' : 'full',
                        scanStartedAtIso: phase1ScanStartedAtIso,
                        totalPostsFetched: postsWithLinkForConsole || wpRes.posts.length,
                        newPostsDiscovered: upsertedForConsole,
                        totalPagesFetched: wpRes.totalPages,
                        pagesIndexed: wpRes.pagesFetched,
                        completed: wpRes.completed,
                        headerTotalPosts: wpRes.totalWpPosts,
                      }),
                    );
                    if (!wpRes.completed) {
                      runLogger(
                        'warn',
                        `Catalog index incomplete for ${systemSlug} (fetched ${wpRes.pagesFetched}/${wpRes.totalPages} pages${wpRes.truncatedReason ? ` · ${wpRes.truncatedReason}` : ''}); will auto-resume full index on next run`,
                      );
                    }
                    if (needsFullIndex || wpRes.posts.length > 0) {
                      refreshedConsoles.push(canonicalSlug);
                    }
                  }
                }
              } else {
                htmlFallbackSystemsSet.add(systemSlug);
              }
            }
          }

          if (signal.aborted) break;

          // Phase 2: Query latest rule-matched releases from SQLite using liveCfg
          syncLiveRules();
          const { matched, excludedByRulesCount, totalCataloged } = listCatalogReleasesForRuleSync(liveCfg);
          if (totalCataloged > 0) {
            successfulPages = Math.max(successfulPages, 1);
          }

          summaryTotalRuleMatched = matched.length;
          summaryExcludedByRules = excludedByRulesCount;

          if (isDryRun) {
            summaryAlreadyOnDisk = 0;
            summaryWouldDownload = 0;
            dryRunEstimatedBytes = 0;
            consoleBreakdownMap.clear();
            sampleReleases.length = 0;
          }

          const seenMatchedUrls = new Set(matched.map((item) => item.remoteUrl.split('#')[0]));
          const pendingLiveItems: RepositoryItemRecord[] = [];
          let passVerifiedOnDisk = 0;

          for (const item of matched) {
            if (signal.aborted) break;
            const canonicalUrl = item.remoteUrl.split('#')[0];
            if (!isDryRun && checkedOrMirroredUrls.has(canonicalUrl)) {
              continue;
            }
            const files = item.files || [];
            const mirroredCheck = isReleaseFullyMirroredForRules(
              item,
              item.syncOverride === 'pin' ? [] : liveAllowedReleaseTypes,
              defaultFileExistsWithBytes,
            );

            if (mirroredCheck.satisfied) {
              if (!verifiedOnDiskUrls.has(canonicalUrl)) {
                verifiedOnDiskUrls.add(canonicalUrl);
                checkedOrMirroredUrls.add(canonicalUrl);
                const countUnits = Math.max(1, mirroredCheck.verifiedFilesCount || files.length);
                newFound += countUnits;
                skippedCount += countUnits;
                summaryAlreadyOnDisk += 1;
                passVerifiedOnDisk += 1;
              }
              continue;
            }

            if (isDryRun) {
              const estBytes =
                item.fileSizeBytes > 0
                  ? item.fileSizeBytes
                  : estimateDownloadHintsBytes(item.metadata?.downloadHints);
              newFound += 1;
              summaryWouldDownload += 1;
              recordPendingSummaryItem(
                item.systemName,
                {
                  id: item.id,
                  title: item.title,
                  systemName: (canonicalizeSystemSlug(item.systemName) || item.systemName).toLowerCase(),
                  releaseType: item.releaseType || 'Retail ROM',
                  fileSizeBytes: estBytes,
                  status: item.status,
                },
                estBytes,
              );
            } else {
              pendingLiveItems.push(item);
            }
          }

          // Include simulated newly refreshed remote posts in Dry Run without writing to SQLite
          if (isDryRun && dryRunSimulatedPosts.length > 0) {
            for (const sim of dryRunSimulatedPosts) {
              if (!sim.post.link) continue;
              const canonicalUrl = sim.post.link.split('#')[0];
              if (seenMatchedUrls.has(canonicalUrl)) continue;
              seenMatchedUrls.add(canonicalUrl);
              if (getRepositoryItemByRemoteUrl(canonicalUrl)) continue;

              const simHintFilenames = (sim.post.downloadHints || []).map((h) => h.filename);
              const hintRoles = (sim.post.downloadHints || []).map((h) =>
                classifyFileRole(h.filename, '', {
                  genres: sim.post.genres,
                  languages: sim.post.languages,
                  sources: sim.post.sources,
                  title: sim.post.title || undefined,
                  systemName: sim.systemSlug,
                  siblingFilenames: simHintFilenames,
                }),
              );
              const wpTags = deriveReleaseTags(
                {
                  genres: sim.post.genres,
                  languages: sim.post.languages,
                  sources: sim.post.sources,
                  systemName: sim.systemSlug,
                },
                hintRoles,
              );
              const matches = doesCatalogReleaseMatchSyncRules(
                {
                  systemName: sim.systemSlug,
                  releaseType: wpTags[0] || 'Retail ROM',
                  releaseTags: wpTags,
                  fileRoles: hintRoles,
                },
                liveCfg,
              );
              if (!matches) {
                summaryExcludedByRules += 1;
                continue;
              }
              summaryTotalRuleMatched += 1;
              newDeltaDiscoveredCount += 1;
              const estBytes = estimateDownloadHintsBytes(sim.post.downloadHints);
              newFound += 1;
              summaryWouldDownload += 1;
              recordPendingSummaryItem(
                sim.systemSlug,
                {
                  title: sim.post.title || canonicalUrl,
                  systemName: sim.systemSlug,
                  releaseType: wpTags[0] || 'Retail ROM',
                  fileSizeBytes: estBytes,
                  status: 'available',
                },
                estBytes,
              );
            }
          }

          if (passVerifiedOnDisk > 0) {
            runLogger(
              'info',
              `${isDryRun ? '[Dry Run · Index-First] ' : ''}Verified ${passVerifiedOnDisk} already-downloaded rule-matched release(s) on disk`,
            );
          }

          let rulesChangedDuringMirror = false;
          const mirrorPassRuleVersion = appliedRuleVersion;
          if (!isDryRun && pendingLiveItems.length > 0) {
            runLogger(
              'info',
              pass === 0
                ? `Full Sync mirroring ${pendingLiveItems.length} pending rule-matched release(s) from SQLite catalog`
                : `[Live Rules] Full Sync expanded queue with ${pendingLiveItems.length} newly matched release(s)`,
              summaryExcludedByRules > 0 ? `${summaryExcludedByRules} cataloged release(s) excluded by Sync Rules` : null,
            );
            let mirroredProgressCount = 0;
            this.setRunProgress(0, pendingLiveItems.length, 'queue', null);
            await runWithConcurrency(
              pendingLiveItems,
              () => {
                syncLiveRules();
                return liveCfg.maxConcurrency;
              },
              signal,
              async (item) => {
                if (signal.aborted || rulesChangedDuringMirror) return;

                syncLiveRules();
                if (appliedRuleVersion !== mirrorPassRuleVersion) {
                  if (!rulesChangedDuringMirror) {
                    runLogger(
                      'info',
                      `[Live Rules] Reloaded active Full Sync queue`,
                      `${lastAppliedRuleDiff?.changeSummary || 'Sync Rules updated'} · Recalculating pending matches`,
                    );
                  }
                  rulesChangedDuringMirror = true;
                  return;
                }

                if (!item.remoteUrl || !item.remoteUrl.startsWith('http')) return;
                const canonicalUrl = item.remoteUrl.split('#')[0];

                const workerSiblingFilenames = Array.from(
                  new Set([
                    ...(item.files || []).map((f) => f.filename),
                    ...(item.metadata?.downloadHints || []).map((h) => h.filename),
                  ]),
                );
                const workerHintRoles = (item.metadata?.downloadHints || []).map((h) =>
                  classifyFileRole(h.filename, '', {
                    genres: item.genres,
                    languages: item.languages,
                    sources: item.sources,
                    title: item.title,
                    systemName: item.systemName,
                    siblingFilenames: workerSiblingFilenames,
                  }),
                );
                const workerFileRoles = Array.from(
                  new Set([...(item.files || []).map((f) => f.fileRole), ...workerHintRoles]),
                );

                if (
                  !doesCatalogReleaseMatchSyncRules(
                    {
                      systemName: item.systemName,
                      releaseType: item.releaseType,
                      releaseTags: item.releaseTags,
                      fileRoles: workerFileRoles,
                      syncOverride: item.syncOverride,
                    },
                    liveCfg,
                  )
                ) {
                  skippedCount += 1;
                  return;
                }

                checkedOrMirroredUrls.add(canonicalUrl);
                mirroredProgressCount += 1;
                this.setActiveSyncItemFromRecord(item);
                this.setRunProgress(mirroredProgressCount, pendingLiveItems.length, 'queue', null);
                this.currentPhase = `Full Sync · ${item.systemName} (${Math.min(mirroredProgressCount, pendingLiveItems.length)}/${pendingLiveItems.length}): ${item.title}`;
                this.emitStatus();
                await inspectAndProcessReleasePage(item.remoteUrl, buildWpMetaHintFromItem(item), null);
              },
              this.subscribeRuntimeConfig,
            );
          }

          // Fallback HTML crawl for currently allowed consoles without WP REST CPT support
          for (const fallbackSlug of htmlFallbackSystemsSet) {
            if (signal.aborted) break;
            if (crawledHtmlFallbackSet.has(fallbackSlug)) continue;
            syncLiveRules();
            if (appliedRuleVersion !== mirrorPassRuleVersion) {
              rulesChangedDuringMirror = true;
              break;
            }
            if (!isConsoleAllowedBySyncRules(fallbackSlug, liveCfg)) {
              continue;
            }
            crawledHtmlFallbackSet.add(fallbackSlug);
            const consoleHtmlUrl = new URL(`${encodeURIComponent(fallbackSlug)}/`, baseWithSlash).toString();
            runLogger('debug', `[Crawl] "${fallbackSlug}" falling back to HTML Full Sync crawl`, consoleHtmlUrl);
            await crawlHtmlScope([consoleHtmlUrl], fallbackSlug);
          }

          syncLiveRules();
          if (appliedRuleVersion !== mirrorPassRuleVersion) {
            rulesChangedDuringMirror = true;
          }

          const hasUnrefreshedTarget =
            shouldRefreshIndexes &&
            liveTargetSystems.some(
              (slug) => !refreshedConsolesSet.has(canonicalizeSystemSlug(slug).toLowerCase()),
            );

          if (!rulesChangedDuringMirror && !hasUnrefreshedTarget) {
            break;
          }
        }

        skippedByTypeCount += summaryExcludedByRules;
        runSummarySnapshot = {
          strategy: 'index_first',
          ruleScopeLabel: formatSyncRuleScopeSummary(liveCfg.systemFilter, liveCfg.allowedReleaseTypes),
          totalRuleMatched: summaryTotalRuleMatched,
          wouldDownloadCount: isDryRun ? summaryWouldDownload : downloadedCount,
          alreadyOnDiskCount: summaryAlreadyOnDisk,
          excludedByRulesCount: summaryExcludedByRules,
          estimatedDownloadBytes: dryRunEstimatedBytes,
          refreshedConsoles,
          newDeltaDiscoveredCount,
          consoleBreakdown: Array.from(consoleBreakdownMap.values())
            .sort((a, b) => b.pendingCount - a.pendingCount || b.estimatedBytes - a.estimatedBytes)
            .slice(0, 10),
          sampleReleases,
        };

        persistCounters();
      } else {
        if (preloadedRootPage) {
          visitedPages.add(preloadedRootPage.url);
          visitedPages.add(preloadedRootPage.finalUrl);
        }

        const refreshedDeltaConsoles: string[] = [];
        let deltaNewDiscoveredCount = 0;
        let deltaMatchedCount = 0;
        let deltaAlreadyOnDiskCount = 0;
        let deltaWouldDownloadCount = 0;
        let deltaEstimatedBytes = 0;
        const deltaConsoleMap = new Map<string, DryRunConsoleBreakdown>();
        const deltaSamples: DryRunSampleRelease[] = [];

        const existingIndexState = getSystemIndexState();
        const scannedRestBases = new Set<string>();
        const scannedConsolesSet = new Set<string>();
        const cachedDeltaPostsByConsole = new Map<
          string,
          {
            systemSlug: string;
            canonicalSlug: string;
            posts: WpPostMetadata[];
            preUpsertExistingByUrl: Map<string, RepositoryItemRecord | null>;
          }
        >();

        const processDeltaPostsForConsole = async (
          systemSlug: string,
          canonicalSlug: string,
          posts: WpPostMetadata[],
          preUpsertExistingByUrl: Map<string, RepositoryItemRecord | null>,
          isReplayPass: boolean,
        ): Promise<{ fastSkippedReleasesCount: number; fastSkippedFilesCount: number; rulesWidened: boolean }> => {
          let fastSkippedReleasesCount = 0;
          let fastSkippedFilesCount = 0;
          let rulesWidened = false;

          const shouldSkipWpPostBeforeHtml = (post: WpPostMetadata): boolean => {
            if (!liveHasReleaseTypeFilter) return false;
            const hintFilenames = (post.downloadHints || []).map((h) => h.filename);
            const hintRoles = (post.downloadHints || []).map((h) =>
              classifyFileRole(h.filename, '', {
                genres: post.genres,
                languages: post.languages,
                sources: post.sources,
                title: post.title || undefined,
                systemName: systemSlug,
                siblingFilenames: hintFilenames,
              }),
            );
            const wpTags = deriveReleaseTags(
              {
                genres: post.genres,
                languages: post.languages,
                sources: post.sources,
                systemName: systemSlug,
              },
              hintRoles,
            );
            const wpTypeKeys =
              hintRoles.length > 0
                ? Array.from(
                    new Set(
                      hintRoles.flatMap((role) =>
                        classifyFileRoleToTypeKeys(role, wpTags, systemSlug),
                      ),
                    ),
                  )
                : classifyReleaseTagsToTypeKeys(wpTags, systemSlug);
            const match = evaluateReleaseTypeMatch(wpTypeKeys, liveAllowedReleaseTypes);
            if (!match.allowed) {
              if (post.link) {
                typeSkippedReleaseUrls.add(post.link.split('#')[0]);
              }
              newFound += 1;
              skippedCount += 1;
              skippedByTypeCount += 1;
              runLogger(
                'info',
                `${isDryRun ? `[Dry Run · ${dryRunScopeTag}] ` : ''}[Type Filter] Skipped ${post.title || post.link || `#${post.wpPostId}`}`,
                `Detected type: ${match.detectedLabels.join(', ')} (excluded before fetching release page)`,
              );
              return true;
            }
            return false;
          };

          const tryFastSkipWpPost = (post: WpPostMetadata, isPinned: boolean): boolean => {
            if (!post.link) return false;
            const canonicalLink = post.link.split('#')[0];
            const existing = preUpsertExistingByUrl.get(canonicalLink) ?? null;
            const check = evaluateReleaseFastSkip({
              existing,
              post,
              systemSlug,
              allowedReleaseTypes: isPinned ? [] : liveAllowedReleaseTypes,
            });
            if (!check.skip) {
              if (existing && existing.status === 'downloaded') {
                runLogger(
                  'debug',
                  `[Fast Skip] Re-inspecting downloaded release "${post.title || canonicalLink}" (${check.reason})`,
                );
              }
              return false;
            }
            visitedReleasePages.add(canonicalLink);
            newFound += check.verifiedFilesCount;
            skippedCount += check.verifiedFilesCount;
            fastSkippedReleasesCount += 1;
            fastSkippedFilesCount += check.verifiedFilesCount;
            deltaAlreadyOnDiskCount += 1;
            runLogger(
              'debug',
              `[Fast Skip] Already downloaded & verified on disk: ${post.title || canonicalLink} (${check.verifiedFilesCount} file(s))`,
            );
            persistCounters();
            return true;
          };

          let consoleRemovedMidPass = false;
          let deltaProgressCount = 0;
          const deltaPassWidenedVersion = lastWidenedRuleVersion;
          await runWithConcurrency(
            posts,
            () => {
              syncLiveRules();
              return liveCfg.maxConcurrency;
            },
            signal,
            async (post) => {
              if (signal.aborted || consoleRemovedMidPass) return;
              syncLiveRules();
              if (lastWidenedRuleVersion !== deltaPassWidenedVersion) {
                rulesWidened = true;
              }
              if (!post.link) return;
              const canonicalLink = post.link.split('#')[0];
              const existingForOverride =
                preUpsertExistingByUrl.get(canonicalLink) ?? getRepositoryItemByRemoteUrl(canonicalLink);
              const postSyncOverride = existingForOverride?.syncOverride ?? 'default';

              if (postSyncOverride === 'ignore') {
                visitedReleasePages.add(canonicalLink);
                skippedCount += 1;
                skippedByTypeCount += 1;
                runLogger(
                  'info',
                  `${isDryRun ? `[Dry Run · ${dryRunScopeTag}] ` : ''}[Sync Override] Skipped ignored release ${post.title || canonicalLink}`,
                  'Excluded by per-game Ignore override',
                );
                persistCounters();
                return;
              }

              if (postSyncOverride !== 'pin' && !isConsoleAllowedBySyncRules(systemSlug, liveCfg)) {
                if (!consoleRemovedMidPass) {
                  consoleRemovedMidPass = true;
                  runLogger(
                    'info',
                    `[Live Rules] Stopping remaining releases in ${systemSlug}`,
                    'Console was removed from Target Consoles mid-run',
                  );
                }
                return;
              }

              if (isReplayPass && visitedReleasePages.has(canonicalLink)) {
                return;
              }

              recordObservedTimestamp(post.dateGmt);
              recordObservedTimestamp(post.modifiedGmt);
              if (postSyncOverride !== 'pin' && shouldSkipWpPostBeforeHtml(post)) {
                persistCounters();
                return;
              }
              deltaMatchedCount += 1;
              if (tryFastSkipWpPost(post, postSyncOverride === 'pin')) {
                return;
              }
              if (isDeltaMode && isDryRun) {
                const estBytes = estimateDownloadHintsBytes(post.downloadHints);
                deltaWouldDownloadCount += 1;
                deltaEstimatedBytes += estBytes;
                const cEntry = deltaConsoleMap.get(canonicalSlug);
                if (cEntry) {
                  cEntry.pendingCount += 1;
                  cEntry.estimatedBytes += estBytes;
                } else {
                  deltaConsoleMap.set(canonicalSlug, {
                    systemName: canonicalSlug,
                    pendingCount: 1,
                    estimatedBytes: estBytes,
                  });
                }
                if (deltaSamples.length < 12) {
                  deltaSamples.push({
                    title: post.title || post.link,
                    systemName: canonicalSlug,
                    releaseType: 'Delta Release',
                    fileSizeBytes: estBytes,
                    status: 'available',
                  });
                }
              }
              deltaProgressCount += 1;
              this.setActiveSyncItemFromRecord(getRepositoryItemByRemoteUrl(canonicalLink));
              this.setRunProgress(deltaProgressCount, posts.length, 'system', systemSlug);
              this.currentPhase = isDeltaMode
                ? `${isDryRun ? 'Dry Run (Incremental)' : 'Incremental'} · ${systemSlug} (${Math.min(deltaProgressCount, posts.length)}/${posts.length}): ${post.title || this.formatRelativePhasePath(post.link, liveCfg.baseUrl)}`
                : `${isDryRun ? 'Dry Run (Full)' : 'Full Sync'} · ${systemSlug} (${Math.min(deltaProgressCount, posts.length)}/${posts.length}): ${post.title || this.formatRelativePhasePath(post.link, liveCfg.baseUrl)}`;
              this.emitStatus();
              await inspectAndProcessReleasePage(post.link, post, isDeltaMode ? cutoffMs : null);
            },
            this.subscribeRuntimeConfig,
          );

          return { fastSkippedReleasesCount, fastSkippedFilesCount, rulesWidened };
        };

        const MAX_DELTA_PASSES = 25;
        let pendingReplayForWidenedTypes = false;
        let observedDeltaWidenedVersion = lastWidenedRuleVersion;

        for (let pass = 0; pass < MAX_DELTA_PASSES && !signal.aborted; pass += 1) {
          syncLiveRules();
          if (lastWidenedRuleVersion !== observedDeltaWidenedVersion) {
            observedDeltaWidenedVersion = lastWidenedRuleVersion;
            pendingReplayForWidenedTypes = true;
          }

          let scannedAnyInPass = false;
          let consoleGuard = 0;
          while (!signal.aborted && consoleGuard < 200) {
            consoleGuard += 1;
            syncLiveRules();
            if (lastWidenedRuleVersion !== observedDeltaWidenedVersion) {
              observedDeltaWidenedVersion = lastWidenedRuleVersion;
              pendingReplayForWidenedTypes = true;
            }

            const nextSlug = liveTargetSystems.find(
              (slug) => !scannedConsolesSet.has(canonicalizeSystemSlug(slug).toLowerCase()),
            );
            if (!nextSlug) break;

            scannedAnyInPass = true;
            const systemSlug = nextSlug;
            const canonicalSlug = canonicalizeSystemSlug(systemSlug).toLowerCase();
            scannedConsolesSet.add(canonicalSlug);

            const scopeLabel = `${scannedConsolesSet.size}/${Math.max(scannedConsolesSet.size, liveTargetSystems.length)}`;
            const prevNewFound = newFound;
            const prevSkipped = skippedCount;

            const resolvedRestBase = await this.client.resolveWpRestBaseForSystem(systemSlug, liveCfg, signal, runLogger);
            if (resolvedRestBase) {
              const restBaseKey = resolvedRestBase.toLowerCase();
              if (scannedRestBases.has(restBaseKey)) {
                runLogger(
                  'debug',
                  `[Crawl] Skipping duplicate target "${systemSlug}" (WP REST "${resolvedRestBase}" already scanned in this run)`,
                );
                continue;
              }
              scannedRestBases.add(restBaseKey);
            }

            this.activeSyncItem = null;
            this.activeRunProgress = null;
            this.currentPhase = isDeltaMode
              ? `${isDryRun ? 'Dry Run (Incremental)' : 'Checking'} ${systemSlug} (${scopeLabel}) since ${effectiveCutoffIso!.slice(0, 16).replace('T', ' ')} UTC`
              : `${isDryRun ? 'Dry Run (Full)' : 'Full Sync'} (${scopeLabel}): enumerating ${systemSlug}`;
            this.emitStatus();

            const deltaScanStartedAtIso = new Date().toISOString();
            const wpRes = await this.client.listConsoleReleasesViaWpRest(systemSlug, liveCfg, {
              modifiedAfterIso: effectiveCutoffIso,
              signal,
              log: runLogger,
              onPageFetched: (wpPage, wpTotalPages) => {
                pagesCrawled += 1;
                successfulPages += 1;
                this.currentPhase = isDeltaMode
                  ? `${isDryRun ? 'Dry Run (Incremental)' : 'Checking'} ${systemSlug} (${scopeLabel}) · WP page ${wpPage}/${wpTotalPages}`
                  : `${isDryRun ? 'Dry Run (Full)' : 'Full Sync'} (${scopeLabel}): ${systemSlug} · WP page ${wpPage}/${wpTotalPages}`;
                persistCounters();
              },
            });

            runLogger(
              'debug',
              `[Crawl] System "${systemSlug}" WP REST scan`,
              `supported=${wpRes.supported}, posts=${wpRes.posts.length}, completed=${wpRes.completed}`,
            );

            let fastSkippedReleasesCount = 0;
            let fastSkippedFilesCount = 0;

            if (wpRes.supported) {
              successfulPages += 1;
              const preUpsertExistingByUrl = new Map<string, RepositoryItemRecord | null>();
              for (const post of wpRes.posts) {
                if (!post.link) continue;
                const canonicalLink = post.link.split('#')[0];
                if (!preUpsertExistingByUrl.has(canonicalLink)) {
                  preUpsertExistingByUrl.set(
                    canonicalLink,
                    getRepositoryItemByRemoteUrl(canonicalLink),
                  );
                }
              }

              let consoleNewDiscovered = 0;
              if (!isDryRun && wpRes.posts.length > 0) {
                for (const post of wpRes.posts) {
                  if (!post.link) continue;
                  const canonicalLink = post.link.split('#')[0];
                  if (!preUpsertExistingByUrl.get(canonicalLink)) {
                    deltaNewDiscoveredCount += 1;
                    consoleNewDiscovered += 1;
                  }
                  upsertIndexedWpRelease(this.buildWpReleaseRecordInput(post, systemSlug, liveCfg, run.id));
                }
                this.emitCatalogUpdated('sync_indexed');
              } else if (isDryRun && wpRes.posts.length > 0) {
                for (const post of wpRes.posts) {
                  if (!post.link) continue;
                  if (!preUpsertExistingByUrl.get(post.link.split('#')[0])) {
                    deltaNewDiscoveredCount += 1;
                  }
                }
              }

              if (!isDryRun) {
                const prevCursor = existingIndexState[canonicalSlug] ?? existingIndexState[systemSlug];
                if (prevCursor?.fullyIndexed) {
                  updateSystemIndexCursor(
                    canonicalSlug,
                    buildUpdatedSystemIndexCursor({
                      existingCursor: prevCursor,
                      strategy: 'delta',
                      scope: prevCursor.scope ?? (liveCfg.systemFilter.trim().length > 0 ? 'filtered' : 'full'),
                      scanStartedAtIso: deltaScanStartedAtIso,
                      totalPostsFetched: wpRes.posts.length,
                      newPostsDiscovered: consoleNewDiscovered,
                      totalPagesFetched: wpRes.totalPages,
                      pagesIndexed: wpRes.pagesFetched,
                      completed: wpRes.completed,
                      headerTotalPosts: wpRes.totalWpPosts,
                    }),
                  );
                }
                if (wpRes.posts.length > 0) {
                  refreshedDeltaConsoles.push(canonicalSlug);
                }
              }

              if (wpRes.posts.length > 0) {
                cachedDeltaPostsByConsole.set(canonicalSlug, {
                  systemSlug,
                  canonicalSlug,
                  posts: wpRes.posts,
                  preUpsertExistingByUrl,
                });
              }

              syncLiveRules();
              const isIndexOnlyScheduled =
                isDeltaMode && run.triggerType === 'scheduled' && !liveCfg.autoDownloadNewReleases;

              if (isIndexOnlyScheduled && !isDryRun) {
                if (wpRes.posts.length > 0) {
                  for (const post of wpRes.posts) {
                    if (!post.link) continue;
                    recordObservedTimestamp(post.dateGmt);
                    recordObservedTimestamp(post.modifiedGmt);
                    newFound += 1;
                  }
                  runLogger(
                    'info',
                    `[Scheduled Index] Cataloged ${wpRes.posts.length} new/updated release(s) in ${systemSlug} as Available (auto-download paused)`,
                  );
                }
              } else if (isDeltaMode) {
                if (wpRes.posts.length > 0) {
                  runLogger(
                    'info',
                    `${isDryRun ? '[Dry Run · Incremental] ' : ''}Found ${wpRes.posts.length} new/updated release(s) in ${systemSlug} since cutoff`,
                  );
                }
                const res = await processDeltaPostsForConsole(
                  systemSlug,
                  canonicalSlug,
                  wpRes.posts,
                  preUpsertExistingByUrl,
                  false,
                );
                fastSkippedReleasesCount = res.fastSkippedReleasesCount;
                fastSkippedFilesCount = res.fastSkippedFilesCount;
                if (res.rulesWidened) pendingReplayForWidenedTypes = true;
              } else if (wpRes.posts.length > 0) {
                runLogger(
                  'info',
                  isDryRun
                    ? `[Dry Run · Full] Inspecting ${wpRes.posts.length} release(s) in ${systemSlug}`
                    : `Full Sync mirroring ${wpRes.posts.length} release(s) in ${systemSlug}`,
                );
                const res = await processDeltaPostsForConsole(
                  systemSlug,
                  canonicalSlug,
                  wpRes.posts,
                  preUpsertExistingByUrl,
                  false,
                );
                fastSkippedReleasesCount = res.fastSkippedReleasesCount;
                fastSkippedFilesCount = res.fastSkippedFilesCount;
                if (res.rulesWidened) pendingReplayForWidenedTypes = true;
              } else {
                const consoleHtmlUrl = new URL(`${encodeURIComponent(systemSlug)}/`, baseWithSlash).toString();
                runLogger('debug', `[Crawl] "${systemSlug}" WP REST returned 0 posts in Full Sync; falling back to HTML`, consoleHtmlUrl);
                await crawlHtmlScope([consoleHtmlUrl], systemSlug);
              }
            } else {
              const consoleHtmlUrl = new URL(`${encodeURIComponent(systemSlug)}/`, baseWithSlash).toString();
              runLogger('debug', `[Crawl] "${systemSlug}" has no WP REST CPT; falling back to HTML crawl`, consoleHtmlUrl);
              await crawlHtmlScope([consoleHtmlUrl], systemSlug);
            }

            if (!isDryRun && !signal.aborted && fastSkippedReleasesCount > 0) {
              runLogger(
                'info',
                `${isDeltaMode ? 'Incremental Sync' : 'Full Sync'} (${systemSlug}): fast-skipped ${fastSkippedReleasesCount} already-downloaded release(s) (${fastSkippedFilesCount} verified file(s) on disk)`,
              );
            }

            if (isDryRun && !signal.aborted && newFound > prevNewFound) {
              const sysDiscovered = newFound - prevNewFound;
              const sysSkipped = skippedCount - prevSkipped;
              const sysWouldDownload = Math.max(0, sysDiscovered - sysSkipped);
              runLogger(
                'info',
                `[Dry Run · ${dryRunScopeTag}] ${systemSlug} summary: ${sysWouldDownload} would download, ${sysSkipped} skipped (on disk or filtered)`,
              );
            }

            persistCounters();
          }

          // If release types were widened mid-run, re-evaluate cached delta posts for still-allowed consoles
          syncLiveRules();
          if (lastWidenedRuleVersion !== observedDeltaWidenedVersion) {
            observedDeltaWidenedVersion = lastWidenedRuleVersion;
            pendingReplayForWidenedTypes = true;
          }

          if (pendingReplayForWidenedTypes && !signal.aborted) {
            pendingReplayForWidenedTypes = false;
            for (const entry of cachedDeltaPostsByConsole.values()) {
              if (signal.aborted) break;
              if (!isConsoleAllowedBySyncRules(entry.systemSlug, liveCfg)) continue;
              const res = await processDeltaPostsForConsole(
                entry.systemSlug,
                entry.canonicalSlug,
                entry.posts,
                entry.preUpsertExistingByUrl,
                true,
              );
              if (res.rulesWidened) {
                pendingReplayForWidenedTypes = true;
              }
            }
          }

          const hasUnscannedTarget = liveTargetSystems.some(
            (slug) => !scannedConsolesSet.has(canonicalizeSystemSlug(slug).toLowerCase()),
          );
          if (!hasUnscannedTarget && !pendingReplayForWidenedTypes && this.syncRulesRevision === observedRuleRevision && !scannedAnyInPass) {
            break;
          }
          if (!hasUnscannedTarget && !pendingReplayForWidenedTypes && this.syncRulesRevision === observedRuleRevision) {
            break;
          }
        }

        // Also keep Pinned releases synced even when their console is outside Target Consoles
        const isScheduledIndexOnlyDelta =
          isDeltaMode && run.triggerType === 'scheduled' && !liveCfg.autoDownloadNewReleases;
        if (!signal.aborted && !isScheduledIndexOnlyDelta) {
          const pinnedItems = listPinnedCatalogReleases();
          for (const pinnedItem of pinnedItems) {
            if (signal.aborted) break;
            if (!pinnedItem.remoteUrl || !pinnedItem.remoteUrl.startsWith('http')) continue;
            const canonicalUrl = pinnedItem.remoteUrl.split('#')[0];
            if (visitedReleasePages.has(canonicalUrl)) continue;
            const mirroredCheck = isReleaseFullyMirroredForRules(
              pinnedItem,
              [],
              defaultFileExistsWithBytes,
            );
            if (mirroredCheck.satisfied) {
              continue;
            }
            deltaMatchedCount += 1;
            if (isDryRun) {
              const estBytes =
                pinnedItem.fileSizeBytes > 0
                  ? pinnedItem.fileSizeBytes
                  : estimateDownloadHintsBytes(pinnedItem.metadata?.downloadHints);
              deltaWouldDownloadCount += 1;
              deltaEstimatedBytes += estBytes;
              const pinnedSys = (canonicalizeSystemSlug(pinnedItem.systemName) || pinnedItem.systemName).toLowerCase();
              const cEntry = deltaConsoleMap.get(pinnedSys);
              if (cEntry) {
                cEntry.pendingCount += 1;
                cEntry.estimatedBytes += estBytes;
              } else {
                deltaConsoleMap.set(pinnedSys, {
                  systemName: pinnedSys,
                  pendingCount: 1,
                  estimatedBytes: estBytes,
                });
              }
              if (deltaSamples.length < 12) {
                deltaSamples.push({
                  id: pinnedItem.id,
                  title: pinnedItem.title,
                  systemName: pinnedSys,
                  releaseType: pinnedItem.releaseType || 'Pinned Release',
                  fileSizeBytes: estBytes,
                  status: pinnedItem.status,
                });
              }
              newFound += 1;
              continue;
            }
            this.setActiveSyncItemFromRecord(pinnedItem);
            this.currentPhase = `Pinned Sync · ${pinnedItem.systemName}: ${pinnedItem.title}`;
            this.emitStatus();
            await inspectAndProcessReleasePage(pinnedItem.remoteUrl, buildWpMetaHintFromItem(pinnedItem), null);
          }
        }

        if (isDeltaMode || options?.legacyFullCrawl) {
          runSummarySnapshot = {
            strategy: options?.legacyFullCrawl ? 'legacy_crawl' : 'incremental_delta',
            ruleScopeLabel: formatSyncRuleScopeSummary(liveCfg.systemFilter, liveCfg.allowedReleaseTypes),
            totalRuleMatched: deltaMatchedCount,
            wouldDownloadCount: isDryRun ? Math.max(deltaWouldDownloadCount, Math.max(0, newFound - skippedCount)) : downloadedCount,
            alreadyOnDiskCount: deltaAlreadyOnDiskCount,
            excludedByRulesCount: skippedByTypeCount,
            estimatedDownloadBytes: deltaEstimatedBytes,
            refreshedConsoles: refreshedDeltaConsoles,
            newDeltaDiscoveredCount: deltaNewDiscoveredCount,
            consoleBreakdown: Array.from(deltaConsoleMap.values())
              .sort((a, b) => b.pendingCount - a.pendingCount || b.estimatedBytes - a.estimatedBytes)
              .slice(0, 10),
            sampleReleases: deltaSamples,
          };
        }
      }

      if (!signal.aborted) {
        if (successfulPages === 0) {
          throw new Error(lastCrawlError || 'Sync failed: no repository pages could be fetched.');
        }
        if (failedCount > 0 && downloadedCount === 0 && skippedCount === 0) {
          throw new Error(`Sync failed: all ${failedCount} file download(s) failed`);
        }
        if (!isDryRun) {
          const runStartMs = Date.parse(runStartedAt);
          const newestObsMs = newestReleaseIso ? Date.parse(newestReleaseIso) : NaN;
          const nextWatermarkIso =
            !Number.isNaN(newestObsMs) && newestObsMs > runStartMs
              ? new Date(newestObsMs).toISOString()
              : runStartedAt;
          setWatermark(nextWatermarkIso);
          runLogger('info', `Advanced incremental cutoff watermark to ${nextWatermarkIso}`);
        }
      }

      const finalStatus = signal.aborted ? 'stopped' : 'completed';
      const rl = this.rateLimiter.getTelemetry();
      updateSyncRun(run.id, {
        status: finalStatus,
        finishedAt: new Date().toISOString(),
        pagesCrawled,
        newFound,
        downloadedCount,
        skippedCount,
        failedCount,
        bytesDownloaded,
        rateLimitHits: Math.max(0, rl.rateLimitHits - startRateHits),
        avgDelayMs: rl.currentDelayMs,
        summary: runSummarySnapshot,
      });

      const typeSkipDetail = skippedByTypeCount > 0 ? ` (${skippedByTypeCount} filtered by type)` : '';
      if (isDryRun) {
        const wouldDownloadTotal = Math.max(0, newFound - skippedCount);
        runLogger(
          'info',
          `Run #${run.id} ${finalStatus} (Dry Run · ${dryRunScopeTag}): ${newFound} discovered, ${wouldDownloadTotal} would download, ${skippedCount} skipped${typeSkipDetail}`,
        );
      } else {
        runLogger(
          'info',
          `Run #${run.id} ${finalStatus}: ${downloadedCount} downloaded, ${skippedCount} skipped${typeSkipDetail}, ${failedCount} failed`,
        );
      }
      if (finalStatus === 'completed') {
        recordAchievementCounter('runs_completed', 1, 'increment');
        if (isDryRun) {
          recordAchievementCounter('dry_runs_completed', 1, 'increment');
        } else if (run.mode === 'full') {
          recordAchievementCounter('full_runs_completed', 1, 'increment');
        }
        if (run.triggerType === 'scheduled') {
          recordAchievementCounter('cron_runs_completed', 1, 'increment');
        }
        this.evaluateAndEmitAchievements();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateSyncRun(run.id, {
        status: signal.aborted ? 'stopped' : 'failed',
        finishedAt: new Date().toISOString(),
        pagesCrawled,
        newFound,
        downloadedCount,
        skippedCount,
        failedCount,
        bytesDownloaded,
        errorSummary: msg,
      });
      runLogger('error', `Run #${run.id} failed: ${msg}`);
    } finally {
      if (this.lockRenewTimer) {
        clearInterval(this.lockRenewTimer);
        this.lockRenewTimer = null;
      }
      releaseDistributedLock(lockKey, POD_ID);
      this.clearAllActiveTransfers();
      this.activeRun = null;
      this.abortController = null;
      this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
      this.emitStatus();
      this.notifyActiveRunFinished();
    }
  }

  private async downloadReleaseFile(
    releaseId: number,
    release: DiscoveredRelease,
    cfg: ScraperConfigInternal,
    runId: number,
    signal: AbortSignal,
    runLogger: LoggerFn,
    parentContext?: RepositoryItemRecord,
    targetFileId?: number,
    fileSequence?: { index: number; total: number },
  ): Promise<{ downloaded: boolean; skipped: boolean; failed: boolean; bytes: number }> {
    const mirrored = resolveMirroredPaths(
      cfg.baseUrl,
      release.pageUrl || release.remoteUrl,
      cfg.downloadDir,
      release.filename,
    );
    const remotePath = release.remotePath || mirrored.remotePath;
    const expectedLocalPath = path.resolve(cfg.downloadDir, remotePath);
    const displayLabel = release.displayLabel || release.filename;
    const siblingFilenames = Array.from(
      new Set([
        release.filename,
        ...(parentContext?.files || []).map((f) => f.filename),
        ...(parentContext?.metadata?.downloadHints || []).map((h) => h.filename),
      ]),
    );
    const fileRole = classifyFileRole(release.filename, displayLabel, {
      genres: parentContext?.genres,
      languages: parentContext?.languages,
      sources: parentContext?.sources,
      title: parentContext?.title || release.title,
      systemName: parentContext?.systemName || release.systemName,
      siblingFilenames,
    });

    const initial = upsertReleaseFile({
      releaseId,
      targetFileId,
      remoteUrl: release.remoteUrl,
      downloadUrl: release.downloadUrl,
      remotePath,
      localPath: expectedLocalPath,
      filename: release.filename,
      displayLabel,
      fileRole,
      status: 'downloading',
      lastRunId: runId,
    });

    const completedInItem = initial.release.files.filter(
      (f) => f.id !== initial.file.id && (f.status === 'downloaded' || f.status === 'skipped'),
    ).length;
    const totalInItem = Math.max(fileSequence?.total ?? 0, initial.release.files.length, 1);

    const resolvedItemTitle = (
      parentContext?.title ||
      initial.release.title ||
      release.title ||
      release.filename
    ).trim();

    const resolvedHasCover = Boolean(
      parentContext?.coverLocalPath ||
        parentContext?.metadata?.coverUrl ||
        initial.release.coverLocalPath ||
        initial.release.metadata?.coverUrl,
    );

    const workerKey = `${releaseId}:${initial.file.id}`;
    const transferEntry: ActiveTransferState = {
      workerKey,
      itemId: releaseId,
      itemTitle: resolvedItemTitle,
      hasCover: resolvedHasCover,
      fileId: initial.file.id,
      fileIndex: fileSequence?.index ?? null,
      totalFiles: totalInItem,
      completedFiles: completedInItem,
      filename: release.filename,
      systemName: release.systemName,
      remoteUrl: release.remoteUrl,
      localPath: initial.file.localPath,
      bytesReceived: 0,
      totalBytes: null,
      bytesPerSec: 0,
      activeChunks: 1,
      activeWorkers: this.activeTransfers.size + 1,
      resumed: false,
    };

    const unregisterWorker = () => {
      this.activeTransfers.delete(workerKey);
      this.activeTransferOrder = this.activeTransferOrder.filter((k) => k !== workerKey);
      this.syncActiveTransferSnapshot(true);
      const remaining = this.getOrderedActiveTransfers();
      if (remaining.length > 0 && this.activeTransfer) {
        const primary = this.activeTransfer;
        if (primary.itemId && primary.itemId > 0) {
          this.activeSyncItem = {
            itemId: primary.itemId,
            title: (primary.itemTitle || primary.filename).trim(),
            systemName: primary.systemName,
            hasCover: Boolean(primary.hasCover),
          };
        }
        this.currentPhase =
          remaining.length > 1
            ? `Downloading ${remaining.length} files in parallel (primary: ${primary.systemName} / ${primary.filename})`
            : `Downloading ${primary.systemName} / ${primary.filename}`;
        this.emitStatus();
      } else if (this.activeRun && !signal.aborted) {
        this.activeSyncItem = {
          itemId: releaseId,
          title: resolvedItemTitle,
          systemName: transferEntry.systemName,
          hasCover: resolvedHasCover,
        };
        this.currentPhase = `Syncing · ${transferEntry.systemName}: ${resolvedItemTitle}`;
        this.emitStatus();
      }
    };

    this.activeTransfers.set(workerKey, transferEntry);
    this.activeTransferOrder.push(workerKey);
    this.syncActiveTransferSnapshot(false);
    const primary = this.activeTransfer ?? transferEntry;
    if (primary.itemId && primary.itemId > 0) {
      this.activeSyncItem = {
        itemId: primary.itemId,
        title: (primary.itemTitle || primary.filename).trim(),
        systemName: primary.systemName,
        hasCover: Boolean(primary.hasCover),
      };
    }
    this.currentPhase =
      this.activeTransfers.size > 1
        ? `Downloading ${this.activeTransfers.size} files in parallel (primary: ${primary.systemName} / ${primary.filename})`
        : `Downloading ${primary.systemName} / ${primary.filename}`;
    this.emitCatalogUpdated('file_downloading', releaseId);
    this.emitStatus();

    const preDownloadRateHits = this.rateLimiter.getTelemetry().rateLimitHits;
    let sawThrottleLog = false;
    let sawResume = false;
    const downloadLogger: LoggerFn = (level, message, detail) => {
      if (level === 'throttle') {
        sawThrottleLog = true;
      }
      runLogger(level, message, detail);
    };

    try {
      let activeRelease: DiscoveredRelease = { ...release, remotePath };
      let res: Awaited<ReturnType<RetroGameTalkClient['downloadFileAtomic']>>;
      try {
        res = await this.client.downloadFileAtomic(
          activeRelease,
          cfg,
          signal,
          (progress) => {
            if (progress.resumed) sawResume = true;
            this.handleTransferProgress(workerKey, progress);
          },
          downloadLogger,
        );
      } catch (firstErr) {
        const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const pageUrl = (release.pageUrl || '').split('#')[0];
        const isCloudflareErr = /cloudflare/i.test(firstMsg);
        const isRateLimitErr = /\b(?:429|503)\b|rate limit/i.test(firstMsg);
        const isAuthOrExpiredErr =
          !isCloudflareErr &&
          !isRateLimitErr &&
          /401|403|unauthorized|forbidden|authentication|login|nonce may have expired|expected archive binary/i.test(
            firstMsg,
          );
        const canRefreshLink =
          !signal.aborted &&
          !isCloudflareErr &&
          pageUrl.startsWith('http') &&
          (isAuthOrExpiredErr || /timed ?out|timedout|body|decode|econnreset|socket/i.test(firstMsg));
        runLogger(
          'debug',
          `[Download] First attempt failed for "${release.filename}"`,
          `canRefreshLink=${canRefreshLink}, isAuthOrExpired=${isAuthOrExpiredErr}, error=${formatErrorDetails(firstErr)}`,
        );
        if (!canRefreshLink) {
          throw firstErr;
        }

        let didReauthenticate = false;
        if (isAuthOrExpiredErr && cfg.username && cfg.password) {
          runLogger('warn', `Session or download token expired for ${release.filename}; re-authenticating`);
          const authRes = await this.client.login(cfg, signal, runLogger);
          if (authRes.authenticated) {
            const ts = recordSuccessfulLogin();
            this.client.setPersistedLastAuthenticatedAt(ts);
            didReauthenticate = true;
          }
        }

        // Re-fetch release page to mint a fresh nonce & signed download key, then retry once
        const pageData = await this.client.fetchPageHtml(pageUrl, cfg, signal, runLogger);
        if (pageData.status >= 400) {
          runLogger('debug', `[Download] Link refresh aborted for "${release.filename}" (page HTTP ${pageData.status})`, pageUrl);
          throw firstErr;
        }
        const dynamic = await this.client.extractDynamicReleaseDownloads(
          pageData.html,
          pageData.finalUrl,
          cfg,
          signal,
          runLogger,
        );
        const linked = this.client.extractLinksFromHtml(pageData.html, pageData.finalUrl, cfg).downloads;
        const freshCandidates = [...dynamic, ...linked];
        const matchedFresh =
          freshCandidates.find((f) => f.filename.toLowerCase() === release.filename.toLowerCase()) ||
          freshCandidates.find((f) => f.remoteUrl === release.remoteUrl) ||
          (freshCandidates.length === 1 ? freshCandidates[0] : undefined);

        if (!matchedFresh || (!didReauthenticate && matchedFresh.downloadUrl === activeRelease.downloadUrl)) {
          runLogger(
            'debug',
            `[Download] Link refresh found no updated URL for "${release.filename}"`,
            `candidates=${freshCandidates.length}, matched=${Boolean(matchedFresh)}, didReauth=${didReauthenticate}`,
          );
          throw firstErr;
        }

        runLogger(
          'warn',
          `Refreshing download key and retrying ${release.filename}`,
          firstMsg,
        );
        activeRelease = { ...matchedFresh, remotePath };
        res = await this.client.downloadFileAtomic(
          activeRelease,
          cfg,
          signal,
          (progress) => {
            if (progress.resumed) sawResume = true;
            this.handleTransferProgress(workerKey, progress);
          },
          downloadLogger,
        );
      }

      unregisterWorker();

      if (res.outcome === 'skipped') {
        let existingMtimeIso: string | null = null;
        try {
          existingMtimeIso = fs.statSync(res.localPath).mtime.toISOString();
        } catch {
          existingMtimeIso = null;
        }
        upsertReleaseFile({
          releaseId,
          targetFileId: initial.file.id,
          remoteUrl: activeRelease.remoteUrl,
          downloadUrl: activeRelease.downloadUrl,
          remotePath: res.remotePath,
          localPath: res.localPath,
          filename: res.filename,
          displayLabel,
          fileRole,
          fileSizeBytes: res.bytes,
          status: 'downloaded',
          errorMessage: null,
          lastRunId: runId,
          downloadedAt: existingMtimeIso || new Date().toISOString(),
          preserveExistingDownloadedAt: true,
        });
        runLogger('info', `Verified existing file on disk (kept as Downloaded): ${res.remotePath}`);
        this.emitCatalogUpdated('file_skipped', releaseId);
        return { downloaded: false, skipped: true, failed: false, bytes: 0 };
      }

      upsertReleaseFile({
        releaseId,
        targetFileId: initial.file.id,
        remoteUrl: activeRelease.remoteUrl,
        downloadUrl: activeRelease.downloadUrl,
        remotePath: res.remotePath,
        localPath: res.localPath,
        filename: res.filename,
        displayLabel,
        fileRole,
        fileSizeBytes: res.bytes,
        status: 'downloaded',
        errorMessage: null,
        lastRunId: runId,
        downloadedAt: new Date().toISOString(),
      });
      runLogger('download', `Mirrored ${res.remotePath}`, `${res.bytes} bytes`);
      this.emitCatalogUpdated('file_downloaded', releaseId);
      try {
        if (sawResume) {
          recordAchievementCounter('resumes_completed', 1, 'increment');
        }
        if (sawThrottleLog || this.rateLimiter.getTelemetry().rateLimitHits > preDownloadRateHits) {
          recordAchievementCounter('throttles_survived', 1, 'increment');
        }
        recordNightOwlIfApplicable();
        this.evaluateAndEmitAchievements();
      } catch {
        // Non-fatal
      }
      return { downloaded: true, skipped: false, failed: false, bytes: res.bytes };
    } catch (err) {
      unregisterWorker();
      if (signal.aborted) {
        const abortedStatus = this.activeRun?.triggerType === 'download' ? 'queued' : 'available';
        upsertReleaseFile({
          releaseId,
          targetFileId: initial.file.id,
          remoteUrl: release.remoteUrl,
          downloadUrl: release.downloadUrl,
          remotePath,
          localPath: initial.file.localPath,
          filename: release.filename,
          displayLabel,
          fileRole,
          status: abortedStatus,
          errorMessage: null,
          lastRunId: runId,
        });
        this.emitCatalogUpdated('file_aborted', releaseId);
        return { downloaded: false, skipped: false, failed: false, bytes: 0 };
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      upsertReleaseFile({
        releaseId,
        targetFileId: initial.file.id,
        remoteUrl: release.remoteUrl,
        downloadUrl: release.downloadUrl,
        remotePath,
        localPath: initial.file.localPath,
        filename: release.filename,
        displayLabel,
        fileRole,
        status: 'failed',
        errorMessage: errMsg,
        lastRunId: runId,
      });
      runLogger('debug', `[Download] Failure details for "${release.filename}"`, `localPath="${expectedLocalPath}", ${formatErrorDetails(err)}`);
      runLogger('error', `Failed ${release.filename}: ${errMsg}`, release.downloadUrl);
      this.emitCatalogUpdated('file_failed', releaseId);
      return { downloaded: false, skipped: false, failed: true, bytes: 0 };
    }
  }

  getPrometheusMetrics(): string {
    const snap = this.getStatusSnapshot();
    const runs = listSyncRuns(100);
    const totalRateHits = runs.reduce((acc, r) => acc + r.rateLimitHits, 0);
    return [
      '# HELP rgt_active_run Whether a scrape sync run is currently active (1=running, 0=idle)',
      '# TYPE rgt_active_run gauge',
      `rgt_active_run{pod="${snap.podId}"} ${snap.activeRun ? 1 : 0}`,
      '# HELP rgt_items_downloaded_total Total repository releases mirrored to local disk',
      '# TYPE rgt_items_downloaded_total gauge',
      `rgt_items_downloaded_total ${snap.totals.downloadedItems}`,
      '# HELP rgt_items_skipped_total Total repository releases skipped by filename deduplication',
      '# TYPE rgt_items_skipped_total gauge',
      `rgt_items_skipped_total ${snap.totals.skippedItems}`,
      '# HELP rgt_items_failed_total Total repository releases currently in failed/partial state',
      '# TYPE rgt_items_failed_total gauge',
      `rgt_items_failed_total ${snap.totals.failedItems}`,
      '# HELP rgt_bytes_mirrored_total Total bytes stored in local repository mirror',
      '# TYPE rgt_bytes_mirrored_total gauge',
      `rgt_bytes_mirrored_total ${snap.storage.totalBytesOnDisk}`,
      '# HELP rgt_current_delay_ms Current adaptive rate limiter inter-request delay in milliseconds',
      '# TYPE rgt_current_delay_ms gauge',
      `rgt_current_delay_ms ${snap.rateLimiter.currentDelayMs}`,
      '# HELP rgt_rate_limit_hits_total Cumulative upstream rate limit events encountered',
      '# TYPE rgt_rate_limit_hits_total counter',
      `rgt_rate_limit_hits_total ${totalRateHits}`,
      '# HELP rgt_db_schema_version Current SQLite database schema migration version',
      '# TYPE rgt_db_schema_version gauge',
      `rgt_db_schema_version ${getSchemaMigrationReport().currentVersion}`,
      '',
    ].join('\n');
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
    if (this.indexerAbortController) {
      this.indexerAbortController.abort();
    }
    if (this.activeRun && this.abortController) {
      this.log('warn', 'SIGTERM received; gracefully halting active sync run');
      this.abortController.abort();
      await new Promise((r) => setTimeout(r, 500));
    }
    this.notifyActiveRunFinished();
  }
}
