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
  clearSyncRuns,
  countSiblingItemsInDir,
  createSyncRun,
  deleteRepositoryItemsByIds,
  deleteRepositoryItemsByLocalPaths,
  getCatalogTotalsAndSystems,
  getDataDir,
  getExistingReleaseLocalPaths,
  getInternalConfig,
  getLastAuthenticatedAt,
  getReleaseFileById,
  getRepositoryItemById,
  getSchemaMigrationReport,
  listReleasesNeedingRetry,
  listSyncRuns,
  markCatalogReleaseFailed,
  recordSuccessfulLogin,
  releaseDistributedLock,
  saveDiscoveredSystems,
  setWatermark,
  updateCatalogReleaseMetadata,
  updateConfig,
  updateSyncRun,
  upsertCatalogRelease,
  upsertReleaseFile,
} from './db.ts';
import { AdaptiveRateLimiter } from './rateLimiter.ts';
import { classifyFileRole, deriveReleaseTags } from './releaseTags.ts';
import {
  classifyFileRoleToTypeKeys,
  classifyReleaseTagsToTypeKeys,
  evaluateReleaseTypeMatch,
  formatAllowedReleaseTypesSummary,
  normalizeAllowedReleaseTypes,
} from '../shared/releaseTypeFilter.ts';
import { filterValidSystemSlugs } from '../shared/systemCatalog.ts';
import {
  type DiscoveredRelease,
  type LoggerFn,
  RetroGameTalkClient,
  SCREENSHOT_FULLRES_VERSION,
  type WpPostMetadata,
  resolveMirroredPaths,
} from './rgtClient.ts';
import { inspectArchiveForItem } from './archiveService.ts';
import type {
  ActiveTransferState,
  ArchiveInspectResult,
  AuthTestResult,
  ConfigUpdateInput,
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
  TransferSpeedSample,
} from './types.ts';

const POD_ID = process.env.HOSTNAME || os.hostname() || 'rgt-sync-pod';

let cachedLocalGitFallback: { version: string; gitSha: string } | null = null;

function getLocalGitFallback(): { version: string; gitSha: string } {
  if (cachedLocalGitFallback) return cachedLocalGitFallback;
  let version = 'dev';
  let gitSha = 'unknown';
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
    } else {
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (branch && branch !== 'HEAD') {
        version = branch;
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
  cachedLocalGitFallback = { version, gitSha };
  return cachedLocalGitFallback;
}

function resolveRuntimeBuildInfo(): { version: string; gitSha: string } {
  const envVersion = (process.env.APP_VERSION || '').trim();
  const envSha = (process.env.GIT_SHA || '').trim();
  const fallback =
    !envVersion || !envSha || envSha === 'unknown' ? getLocalGitFallback() : null;

  return {
    version: envVersion || fallback?.version || 'dev',
    gitSha:
      envSha && envSha !== 'unknown'
        ? envSha
        : fallback?.gitSha && fallback.gitSha !== 'unknown'
          ? fallback.gitSha
          : envSha || 'unknown',
  };
}

export class ScraperOrchestrator extends EventEmitter {
  private rateLimiter: AdaptiveRateLimiter;
  private client: RetroGameTalkClient;
  private cronJob: Cron | null = null;
  private activeRun: SyncRunRecord | null = null;
  private activeTransfer: ActiveTransferState | null = null;
  private transferHistory: TransferSpeedSample[] = [];
  private lastTransferSampleMs = 0;
  private currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
  private abortController: AbortController | null = null;
  private lockRenewTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private inFlightAssetUpgrades = new Map<number, Promise<RepositoryItemRecord | null>>();

  constructor() {
    super();
    const cfg = getInternalConfig();
    this.rateLimiter = new AdaptiveRateLimiter({
      baseDelayMs: cfg.baseDelayMs,
      minDelayMs: cfg.minDelayMs,
      maxDelayMs: cfg.maxDelayMs,
      backoffMultiplier: cfg.backoffMultiplier,
    });
    this.client = new RetroGameTalkClient(this.rateLimiter);

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
    console.log(
      `[${new Date().toISOString()}] [STARTUP] [INFO] Persistence initialized — DATA_DIR="${getDataDir()}", DOWNLOAD_DIR="${refreshedCfg.downloadDir}", schema=v${schemaReport.currentVersion}/v${schemaReport.targetVersion}, auth=${authLabel} (hasCompletedLogin=${authSnap.hasCompletedLogin}, cookies=[${hydrated.cookieNames}]), discoveredSystems=${refreshedCfg.discoveredSystems.length}, catalogReleases=${totals.totalCatalogItems} (reconciledFromDisk=${reconciled.releasesImported})`,
    );

    this.reconfigureScheduler(refreshedCfg);
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
            } catch {
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
              .filter((f) => !f.startsWith('.') && !f.endsWith('.part'))
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
                !de.name.endsWith('.part') &&
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

          const remotePath = `${systemName}/${releaseSlug}`;
          const remoteUrl =
            meta?.sourcePageUrl && /^https?:\/\//i.test(meta.sourcePageUrl)
              ? meta.sourcePageUrl.split('#')[0]
              : new URL(
                  `${encodeURIComponent(systemName)}/${encodeURIComponent(releaseSlug)}/`,
                  baseWithSlash,
                ).toString();

          const parent = upsertCatalogRelease({
            remoteUrl,
            remotePath,
            localPath: absReleaseDir,
            systemName,
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

          if (systemName !== 'uncategorized' && systemName !== 'root') {
            reconciledSystems.add(systemName);
          }

          for (const filename of releaseFiles) {
            const absFile = path.join(absReleaseDir, filename);
            let sizeBytes = 0;
            let mtimeIso = new Date().toISOString();
            try {
              const st = fs.statSync(absFile);
              sizeBytes = st.size;
              mtimeIso = st.mtime.toISOString();
            } catch {
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
        } catch {
          // Skip malformed on-disk directory without blocking startup
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
    const entry = appendActivityLog(level, message, detail, runId);
    this.emit('log', entry);
  }

  private emitStatus(): void {
    this.emit('status', this.getStatusSnapshot());
  }

  private emitCatalogUpdated(reason: string, itemId?: number): void {
    this.emit('catalog_updated', {
      reason,
      itemId: itemId ?? null,
      timestamp: new Date().toISOString(),
    });
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
    const prevAuthAt = getLastAuthenticatedAt();
    const updated = updateConfig(input);
    const nextAuthAt = getLastAuthenticatedAt();
    if (prevAuthAt && !nextAuthAt) {
      this.client.resetAuthSession(true);
    }
    this.reconfigureScheduler(getInternalConfig());
    if (input.lastWatermarkAt !== undefined) {
      this.log(
        'info',
        updated.lastWatermarkAt
          ? `Incremental cutoff watermark updated to ${updated.lastWatermarkAt}`
          : 'Incremental cutoff watermark cleared (using default 24h lookback)',
      );
    } else {
      this.log('info', 'Service configuration saved');
    }
    this.emitStatus();
    return updated;
  }

  async testAuth(): Promise<AuthTestResult> {
    const cfg = getInternalConfig();
    this.log('info', `Running connection & authentication probe against ${cfg.baseUrl}`);
    const result = await this.client.testAuthAndDiscovery(cfg);
    if (result.authenticated) {
      const ts = recordSuccessfulLogin();
      this.client.setPersistedLastAuthenticatedAt(ts);
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
    return result;
  }

  getStorageStats(downloadDir: string): StorageStats {
    const dataDir = getDataDir();
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

    let totalFilesOnDisk = 0;
    let totalBytesOnDisk = 0;

    const walk = (dir: string, depth = 0) => {
      if (depth > 6) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (
          entry.name.startsWith('.') ||
          entry.name.endsWith('.part') ||
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
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          try {
            const st = fs.statSync(full);
            totalFilesOnDisk += 1;
            totalBytesOnDisk += st.size;
          } catch {
            // Skip unreadable entry
          }
        }
      }
    };

    if (fs.existsSync(downloadDir)) {
      walk(downloadDir);
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

    return {
      downloadDir,
      dataDir,
      writable,
      totalFilesOnDisk,
      totalBytesOnDisk,
      diskFreeBytes,
      diskTotalBytes,
    };
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
        entry.name.endsWith('.part') ||
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
          nodes.push({
            name: entry.name,
            relativePath: rel,
            type: 'file',
            sizeBytes: st.size,
            modifiedAt: st.mtime.toISOString(),
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
        if (target.startsWith(root + path.sep) && fs.existsSync(target)) {
          try {
            fs.rmSync(target, { recursive: true, force: true });
            filesRemoved += 1;
          } catch {
            // Ignore filesystem removal error if already gone
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
        } catch {
          // Non-fatal cleanup
        }
      }
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

  resolveItemAssetFile(
    itemId: number,
    kind: 'cover' | 'screenshot',
    index = 0,
  ): { absPath: string; filename: string } | null {
    const item = getRepositoryItemById(itemId);
    if (!item) return null;
    const cfg = getInternalConfig();
    const root = path.resolve(cfg.downloadDir);
    const releaseDir = this.resolveReleaseDir(item, root);
    if (!releaseDir || (!releaseDir.startsWith(root + path.sep) && releaseDir !== root)) return null;

    if (kind === 'cover') {
      const candidates: string[] = [];
      if (item.coverLocalPath) candidates.push(path.resolve(item.coverLocalPath));
      if (item.metadata?.coverLocalRelPath) {
        candidates.push(path.resolve(releaseDir, item.metadata.coverLocalRelPath));
      }
      for (const ext of ['.jpg', '.png', '.webp', '.avif', '.gif', '.bmp']) {
        candidates.push(path.join(releaseDir, `cover${ext}`));
      }
      for (const candidate of candidates) {
        if (candidate.startsWith(releaseDir + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return { absPath: candidate, filename: path.basename(candidate) };
        }
      }
      return null;
    }

    const relShots = item.metadata?.screenshotLocalRelPaths || [];
    if (index >= 0 && index < relShots.length) {
      const candidate = path.resolve(releaseDir, relShots[index]);
      if (candidate.startsWith(releaseDir + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return { absPath: candidate, filename: path.basename(candidate) };
      }
    }

    const shotsDir = path.join(releaseDir, 'screenshots');
    if (fs.existsSync(shotsDir)) {
      const files = fs
        .readdirSync(shotsDir)
        .filter((f) => !f.startsWith('.') && !f.endsWith('.part'))
        .sort();
      if (index >= 0 && index < files.length) {
        const candidate = path.join(shotsDir, files[index]);
        return { absPath: candidate, filename: files[index] };
      }
    }
    return null;
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

    if (!targetFile || !targetFile.localPath) return null;
    const absPath = path.resolve(targetFile.localPath);
    if (!absPath.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) return null;
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
    return inspectArchiveForItem(ctx.item, ctx.file, ctx.absPath, {
      romNamingTemplate: ctx.cfg.romNamingTemplate,
      romSanitizeFat32: ctx.cfg.romSanitizeFat32,
      romMaxFilenameLen: ctx.cfg.romMaxFilenameLen,
    });
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

    const fileRoles = item.files.map((f) =>
      classifyFileRole(f.filename, f.displayLabel, {
        genres: wpData?.genres ?? item.genres,
        languages: wpData?.languages ?? item.languages,
        sources: wpData?.sources ?? item.sources,
        title: wpData?.title ?? item.title,
        systemName: item.systemName,
      }),
    );

    const extractedMeta = this.client.extractReleaseMetadata(pageData.html, pageData.finalUrl, wpData, fileRoles);
    const releaseDir =
      this.resolveReleaseDir(item, root) ||
      path.dirname(resolveMirroredPaths(cfg.baseUrl, pageData.finalUrl, cfg.downloadDir, 'probe.zip').localPath);

    const mirrored = await this.client.mirrorReleaseAssets(
      extractedMeta,
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

  private handleTransferProgress(progress: {
    bytesReceived: number;
    totalBytes: number | null;
    bytesPerSec: number;
  }): void {
    if (!this.activeTransfer) return;
    this.activeTransfer.bytesReceived = progress.bytesReceived;
    this.activeTransfer.totalBytes = progress.totalBytes;
    this.activeTransfer.bytesPerSec = progress.bytesPerSec;
    this.emit('transfer', this.activeTransfer);

    const now = Date.now();
    const isFinished =
      progress.totalBytes !== null && progress.totalBytes > 0 && progress.bytesReceived >= progress.totalBytes;
    if (progress.bytesPerSec > 0 && (now - this.lastTransferSampleMs >= 450 || isFinished)) {
      this.lastTransferSampleMs = now;
      this.transferHistory.push({
        timestamp: new Date(now).toISOString(),
        bytesPerSec: Math.round(progress.bytesPerSec),
        bytesReceived: progress.bytesReceived,
        totalBytes: progress.totalBytes,
        filename: this.activeTransfer.filename,
        systemName: this.activeTransfer.systemName,
      });
      if (this.transferHistory.length > 90) {
        this.transferHistory.shift();
      }
    }
  }

  getStatusSnapshot(): ServiceStatusSnapshot {
    const cfg = getInternalConfig();
    const { totals, systems, releaseTypes } = getCatalogTotalsAndSystems();
    const nextRun = this.cronJob?.nextRun();

    return {
      podId: POD_ID,
      build: resolveRuntimeBuildInfo(),
      activeRun: this.activeRun,
      activeTransfer: this.activeTransfer,
      transferHistory: [...this.transferHistory],
      currentPhase: this.currentPhase,
      nextScheduledRunAt: cfg.scheduleEnabled && nextRun ? nextRun.toISOString() : null,
      scheduleEnabled: cfg.scheduleEnabled,
      cronSchedule: cfg.cronSchedule,
      lastWatermarkAt: cfg.lastWatermarkAt,
      rateLimiter: this.rateLimiter.getTelemetry(),
      auth: this.client.getAuthStatus(cfg, getLastAuthenticatedAt()),
      storage: this.getStorageStats(cfg.downloadDir),
      totals,
      systems,
      releaseTypes,
    };
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
    options?: { dryRun?: boolean },
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
        ? 'Full Sync'
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

    void this.executeRun(run, cfg, lockKey);
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
        const fileRoles = allRoleInputs.map((f) =>
          classifyFileRole(f.filename, f.displayLabel || f.filename, {
            genres: wpData?.genres ?? item.genres,
            languages: wpData?.languages ?? item.languages,
            sources: wpData?.sources ?? item.sources,
            title: wpData?.title ?? item.title,
            systemName: item.systemName,
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

    // Release was interrupted mid-metadata before any child file rows were created: seed & download all discovered archives
    if (filesToRetry.length === 0) {
      if (freshDownloads.length === 0) {
        throw new Error(`No downloadable archive files found on release page ${pageUrl}`);
      }
      for (const release of freshDownloads) {
        if (signal.aborted) break;
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
          continue;
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

    for (let fileIdx = 0; fileIdx < filesToRetry.length; fileIdx += 1) {
      const targetFile = filesToRetry[fileIdx]!;
      if (signal.aborted) break;
      const matched = matchFreshDownload(targetFile);

      // If no fresh download link was extracted and stored downloadUrl is just the page URL itself, fail explicitly
      const storedUrlClean = (targetFile.downloadUrl || '').split('#')[0];
      const targetAlreadyOnDisk = Boolean(
        targetFile.localPath && fs.existsSync(targetFile.localPath) && fs.statSync(targetFile.localPath).size > 0,
      );
      if (!matched && !targetAlreadyOnDisk && (!storedUrlClean.startsWith('http') || storedUrlClean === pageUrl)) {
        if (isDryRun) {
          runLogger(
            'warn',
            `[Dry Run · Retry] Could not resolve fresh download link for ${targetFile.filename}`,
            pageUrl,
          );
          failed += 1;
          continue;
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
        continue;
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
        continue;
      }

      const outcome = await this.downloadReleaseFile(
        item.id,
        release,
        cfg,
        runId,
        signal,
        runLogger,
        getRepositoryItemById(item.id) || item,
        targetFile.id,
        { index: fileIdx + 1, total: filesToRetry.length },
      );
      if (outcome.downloaded) downloaded += 1;
      if (outcome.skipped) skipped += 1;
      if (outcome.failed) failed += 1;
      bytes += outcome.bytes;
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
    this.currentPhase =
      filesToRetry.length === 1
        ? `${actionPrefix}: ${filesToRetry[0].filename}`
        : `${actionPrefix}: ${item.title}${filesToRetry.length > 0 ? ` (${filesToRetry.length} files)` : ''}`;
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
        this.activeTransfer = null;
        this.activeRun = null;
        this.abortController = null;
        this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
        this.emitStatus();
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

        for (let idx = 0; idx < targets.length; idx += 1) {
          if (signal.aborted) break;
          const item = getRepositoryItemById(targets[idx].id) || targets[idx];
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
            continue;
          }

          this.currentPhase = `${phasePrefix} (${idx + 1}/${targets.length}): ${item.systemName} / ${item.title}`;
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
            if (signal.aborted) break;
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
        }

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
        this.activeTransfer = null;
        this.activeRun = null;
        this.abortController = null;
        this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
        this.emitStatus();
      }
    })();

    return run;
  }

  stopActiveRun(): boolean {
    if (!this.activeRun || !this.abortController) return false;
    this.currentPhase = `Stopping run #${this.activeRun.id}...`;
    this.log('warn', `Abort requested for run #${this.activeRun.id}`, null, this.activeRun.id);
    this.abortController.abort();
    this.emitStatus();
    return true;
  }

  private async executeRun(run: SyncRunRecord, cfg: ScraperConfigInternal, lockKey: string): Promise<void> {
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
    const allowedReleaseTypes = normalizeAllowedReleaseTypes(cfg.allowedReleaseTypes);
    const hasReleaseTypeFilter = allowedReleaseTypes.length > 0;

    const inferSystemFromUrl = (rawUrl: string): string => {
      try {
        return resolveMirroredPaths(cfg.baseUrl, rawUrl, cfg.downloadDir, 'probe.zip').systemName;
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

      if (hasReleaseTypeFilter) {
        runLogger(
          'info',
          `Release Type Filter active: ${formatAllowedReleaseTypesSummary(allowedReleaseTypes)}`,
          'Releases and archives outside the enabled categories will be skipped before download link resolution',
        );
      }

      const visitedPages = new Set<string>();
      const visitedReleasePages = new Set<string>();
      const processedFileUrls = new Set<string>();

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
        const systemName = sampleRel.systemName || mirroredProbe.systemName;

        recordObservedTimestamp(preloadedMeta?.publishedAt);
        recordObservedTimestamp(preloadedMeta?.remoteUpdatedAt);
        for (const rel of uniqueReleases) {
          recordObservedTimestamp(rel.publishedAt);
        }

        // Reconcile releaseTags using all discovered files on the page + WP taxonomy metadata
        let effectiveMeta = preloadedMeta;
        if (effectiveMeta) {
          const fileRoles = uniqueReleases.map((r) =>
            classifyFileRole(r.filename, r.displayLabel || r.filename, {
              genres: effectiveMeta!.genres,
              languages: effectiveMeta!.languages,
              sources: effectiveMeta!.sources,
              title: effectiveMeta!.title,
              systemName,
            }),
          );
          effectiveMeta = {
            ...effectiveMeta,
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

        // Evaluate per-file release type allowlist before creating catalog rows or downloading archives
        const eligibleReleases: DiscoveredRelease[] = [];
        if (hasReleaseTypeFilter) {
          const baseMetaTags = effectiveMeta?.releaseTags || [];
          for (const rel of uniqueReleases) {
            const role = classifyFileRole(rel.filename, rel.displayLabel || rel.filename, {
              genres: effectiveMeta?.genres,
              languages: effectiveMeta?.languages,
              sources: effectiveMeta?.sources,
              title: effectiveMeta?.title || rel.title,
              systemName,
            });
            const fileTypeKeys = classifyFileRoleToTypeKeys(role, baseMetaTags, systemName);
            const match = evaluateReleaseTypeMatch(fileTypeKeys, allowedReleaseTypes);
            if (!match.allowed) {
              processedFileUrls.add(rel.remoteUrl);
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
        this.emitCatalogUpdated('release_discovered', parent.id);

        // Mirror cover art, screenshots, and metadata.json once per release page
        if (effectiveMeta) {
          try {
            const mirroredAssets = await this.client.mirrorReleaseAssets(
              effectiveMeta,
              releaseLocalDir,
              cfg,
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
            this.emitCatalogUpdated('metadata_mirrored', parent.id);
          } catch (err) {
            if (signal.aborted) throw err;
            runLogger('warn', `Metadata/artwork sync incomplete for ${parent.title}`, String(err));
          }
        }

        // Stream or deduplicate all allowed archive files belonging to this release page
        for (let fileIdx = 0; fileIdx < eligibleReleases.length; fileIdx += 1) {
          const rel = eligibleReleases[fileIdx]!;
          if (signal.aborted) break;
          processedFileUrls.add(rel.remoteUrl);
          newFound += 1;

          const outcome = await this.downloadReleaseFile(
            parent.id,
            rel,
            cfg,
            run.id,
            signal,
            runLogger,
            parent,
            undefined,
            { index: fileIdx + 1, total: eligibleReleases.length },
          );
          if (outcome.downloaded) downloadedCount += 1;
          if (outcome.skipped) skippedCount += 1;
          if (outcome.failed) failedCount += 1;
          bytesDownloaded += outcome.bytes;
          persistCounters();
        }
      };

      const inspectAndProcessReleasePage = async (
        relPageUrl: string,
        preloadedWpData?: WpPostMetadata | null,
        enforceCutoffMs?: number | null,
      ): Promise<{ newerThanCutoff: boolean }> => {
        const canonicalRelUrl = relPageUrl.split('#')[0];
        if (visitedReleasePages.has(canonicalRelUrl)) {
          return { newerThanCutoff: false };
        }
        visitedReleasePages.add(canonicalRelUrl);

        try {
          const relPage = await this.client.fetchPageHtml(canonicalRelUrl, cfg, signal, runLogger);
          pagesCrawled += 1;
          if (relPage.status >= 400) {
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
                  cfg,
                  signal,
                  runLogger,
                );

          // In delta fallback mode, verify RGT creation/modification timestamp BEFORE resolving download nonces
          const inferredSys = inferSystemFromUrl(relPage.finalUrl);
          const prelimHintRoles = (wpData?.downloadHints || []).map((h) =>
            classifyFileRole(h.filename, '', {
              genres: wpData?.genres,
              languages: wpData?.languages,
              sources: wpData?.sources,
              title: wpData?.title || undefined,
              systemName: inferredSys,
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
              persistCounters();
              return { newerThanCutoff: false };
            }
          }

          // Pre-nonce Release Type Allowlist gate: skip disallowed releases before resolving download links
          if (hasReleaseTypeFilter) {
            const prelimTypeKeys = classifyReleaseTagsToTypeKeys(
              prelimMeta.releaseTags || [],
              prelimMeta.consoleName || inferredSys,
            );
            const match = evaluateReleaseTypeMatch(prelimTypeKeys, allowedReleaseTypes);
            if (!match.allowed) {
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

          const fileRoles = combined.map((r) =>
            classifyFileRole(r.filename, r.displayLabel || r.filename, {
              genres: wpData?.genres,
              languages: wpData?.languages,
              sources: wpData?.sources,
              title: wpData?.title || r.title,
              systemName: r.systemName,
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
            persistCounters();
          }

          return { newerThanCutoff: true };
        } catch (err) {
          if (signal.aborted) throw err;
          const errMsg = err instanceof Error ? err.message : String(err);
          if (/Cloudflare|Authentication|Re-authentication/i.test(errMsg)) {
            throw err;
          }
          runLogger('warn', `Error inspecting ${canonicalRelUrl}`, errMsg);
          return { newerThanCutoff: false };
        }
      };

      const crawlHtmlScope = async (
        seedUrls: string[],
        scopeSystemSlug: string | null,
        preloadedFirstPage?: { url: string; html: string; finalUrl: string },
      ) => {
        const scopedCfg: ScraperConfigInternal = scopeSystemSlug
          ? { ...cfg, systemFilter: scopeSystemSlug }
          : cfg;
        const queue = [...seedUrls];

        while (queue.length > 0) {
          if (signal.aborted) break;
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
            this.currentPhase = `Scanning page (${pagesCrawled + 1}): ${this.formatRelativePhasePath(pageUrl, cfg.baseUrl)}`;
            this.emitStatus();
            try {
              pageData = await this.client.fetchPageHtml(pageUrl, cfg, signal, runLogger);
            } catch (err) {
              if (signal.aborted) break;
              const errMsg = err instanceof Error ? err.message : String(err);
              lastCrawlError = errMsg;
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
              cfg,
              signal,
              runLogger,
            );
            const inlineRoles = inlineDynamic.map((r) =>
              classifyFileRole(r.filename, r.displayLabel || r.filename, {
                genres: wpData?.genres,
                languages: wpData?.languages,
                sources: wpData?.sources,
                title: wpData?.title || r.title,
                systemName: r.systemName,
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

            const inspectPrefix = isDryRun
              ? `Dry Run (${dryRunScopeTag}) inspecting`
              : isDeltaMode
                ? 'Inspecting delta candidate'
                : 'Full Sync inspecting';
            this.currentPhase = `${inspectPrefix}: ${this.formatRelativePhasePath(relPageUrl, cfg.baseUrl)}`;
            this.emitStatus();

            const res = await inspectAndProcessReleasePage(relPageUrl, undefined, cutoffMs);
            if (res.newerThanCutoff) {
              foundNewerReleaseOnPage = true;
            }
          }

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
      const explicitFilters = cfg.systemFilter
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      let targetSystems: string[] = [];
      let preloadedRootPage: { url: string; html: string; finalUrl: string } | undefined;

      if (explicitFilters.length > 0) {
        targetSystems = explicitFilters;
      } else {
        this.currentPhase = `Scanning repository index: ${this.formatRelativePhasePath(cfg.baseUrl, cfg.baseUrl)}`;
        this.emitStatus();
        const rootPage = await this.client.fetchPageHtml(cfg.baseUrl, cfg, signal, runLogger);
        pagesCrawled += 1;
        if (rootPage.status >= 400) {
          throw new Error(`HTTP ${rootPage.status} on ${rootPage.finalUrl}`);
        }
        successfulPages += 1;
        preloadedRootPage = { url: cfg.baseUrl, html: rootPage.html, finalUrl: rootPage.finalUrl };

        const rootExtracted = this.client.extractLinksFromHtml(
          rootPage.html,
          rootPage.finalUrl,
          { ...cfg, systemFilter: '' },
        );
        const liveValidSystems =
          rootExtracted.systems.length > 0
            ? await this.client.filterLiveSystems(rootExtracted.systems, cfg, signal, runLogger)
            : [];
        if (liveValidSystems.length > 0) {
          saveDiscoveredSystems(liveValidSystems);
        }

        targetSystems = filterValidSystemSlugs([
          ...getInternalConfig().discoveredSystems,
          ...liveValidSystems,
        ]).map((s) => s.toLowerCase());
      }

      if (targetSystems.length === 0) {
        await crawlHtmlScope([cfg.baseUrl], null, preloadedRootPage);
      } else {
        if (preloadedRootPage) {
          visitedPages.add(preloadedRootPage.url);
          visitedPages.add(preloadedRootPage.finalUrl);
        }

        for (let sysIdx = 0; sysIdx < targetSystems.length; sysIdx += 1) {
          if (signal.aborted) break;
          const systemSlug = targetSystems[sysIdx];
          const scopeLabel = `${sysIdx + 1}/${targetSystems.length}`;
          const prevNewFound = newFound;
          const prevSkipped = skippedCount;

          this.currentPhase = isDeltaMode
            ? `${isDryRun ? 'Dry Run (Incremental)' : 'Checking'} ${systemSlug} (${scopeLabel}) since ${effectiveCutoffIso!.slice(0, 16).replace('T', ' ')} UTC`
            : `${isDryRun ? 'Dry Run (Full)' : 'Full Sync'} (${scopeLabel}): enumerating ${systemSlug}`;
          this.emitStatus();

          const wpRes = await this.client.listConsoleReleasesViaWpRest(systemSlug, cfg, {
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

          const shouldSkipWpPostBeforeHtml = (post: WpPostMetadata): boolean => {
            if (!hasReleaseTypeFilter) return false;
            const hintRoles = (post.downloadHints || []).map((h) =>
              classifyFileRole(h.filename, '', {
                genres: post.genres,
                languages: post.languages,
                sources: post.sources,
                title: post.title || undefined,
                systemName: systemSlug,
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
            const wpTypeKeys = classifyReleaseTagsToTypeKeys(wpTags, systemSlug);
            const match = evaluateReleaseTypeMatch(wpTypeKeys, allowedReleaseTypes);
            if (!match.allowed) {
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

          if (wpRes.supported) {
            if (isDeltaMode) {
              if (wpRes.posts.length > 0) {
                runLogger(
                  'info',
                  `${isDryRun ? '[Dry Run · Incremental] ' : ''}Found ${wpRes.posts.length} new/updated release(s) in ${systemSlug} since cutoff`,
                );
              }
              for (let pIdx = 0; pIdx < wpRes.posts.length; pIdx += 1) {
                if (signal.aborted) break;
                const post = wpRes.posts[pIdx];
                if (!post.link) continue;
                recordObservedTimestamp(post.dateGmt);
                recordObservedTimestamp(post.modifiedGmt);
                if (shouldSkipWpPostBeforeHtml(post)) {
                  persistCounters();
                  continue;
                }
                this.currentPhase = `${isDryRun ? 'Dry Run (Incremental)' : 'Incremental'} · ${systemSlug} (${pIdx + 1}/${wpRes.posts.length}): ${post.title || this.formatRelativePhasePath(post.link, cfg.baseUrl)}`;
                this.emitStatus();
                await inspectAndProcessReleasePage(post.link, post, cutoffMs);
              }
            } else if (wpRes.posts.length > 0) {
              runLogger(
                'info',
                isDryRun
                  ? `[Dry Run · Full] Inspecting ${wpRes.posts.length} release(s) in ${systemSlug}`
                  : `Full Sync mirroring ${wpRes.posts.length} release(s) in ${systemSlug}`,
              );
              for (let pIdx = 0; pIdx < wpRes.posts.length; pIdx += 1) {
                if (signal.aborted) break;
                const post = wpRes.posts[pIdx];
                if (!post.link) continue;
                recordObservedTimestamp(post.dateGmt);
                recordObservedTimestamp(post.modifiedGmt);
                if (shouldSkipWpPostBeforeHtml(post)) {
                  persistCounters();
                  continue;
                }
                this.currentPhase = `${isDryRun ? 'Dry Run (Full)' : 'Full Sync'} · ${systemSlug} (${pIdx + 1}/${wpRes.posts.length}): ${post.title || this.formatRelativePhasePath(post.link, cfg.baseUrl)}`;
                this.emitStatus();
                await inspectAndProcessReleasePage(post.link, post, null);
              }
            } else {
              // Console CPT returned 0 posts; verify HTML listing in Full Sync in case of static links
              const consoleHtmlUrl = new URL(`${encodeURIComponent(systemSlug)}/`, baseWithSlash).toString();
              await crawlHtmlScope([consoleHtmlUrl], systemSlug);
            }
          } else {
            const consoleHtmlUrl = new URL(`${encodeURIComponent(systemSlug)}/`, baseWithSlash).toString();
            await crawlHtmlScope([consoleHtmlUrl], systemSlug);
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
      this.activeTransfer = null;
      this.emit('transfer', null);
      this.activeRun = null;
      this.abortController = null;
      this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
      this.emitStatus();
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
    const fileRole = classifyFileRole(release.filename, displayLabel, {
      genres: parentContext?.genres,
      languages: parentContext?.languages,
      sources: parentContext?.sources,
      title: parentContext?.title || release.title,
      systemName: parentContext?.systemName || release.systemName,
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

    this.currentPhase = `Downloading ${release.systemName} / ${release.filename}`;
    this.activeTransfer = {
      itemId: releaseId,
      fileId: initial.file.id,
      fileIndex: fileSequence?.index ?? null,
      totalFiles: fileSequence?.total ?? null,
      filename: release.filename,
      systemName: release.systemName,
      remoteUrl: release.remoteUrl,
      localPath: initial.file.localPath,
      bytesReceived: 0,
      totalBytes: null,
      bytesPerSec: 0,
    };
    this.emit('transfer', this.activeTransfer);
    this.emitCatalogUpdated('file_downloading', releaseId);
    this.emitStatus();

    try {
      let activeRelease: DiscoveredRelease = { ...release, remotePath };
      let res: Awaited<ReturnType<RetroGameTalkClient['downloadFileAtomic']>>;
      try {
        res = await this.client.downloadFileAtomic(
          activeRelease,
          cfg,
          signal,
          (progress) => {
            this.handleTransferProgress(progress);
          },
          runLogger,
        );
      } catch (firstErr) {
        const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        const pageUrl = (release.pageUrl || '').split('#')[0];
        const isCloudflareErr = /cloudflare/i.test(firstMsg);
        const isAuthOrExpiredErr =
          !isCloudflareErr &&
          /401|403|unauthorized|forbidden|authentication|login|nonce may have expired|expected archive binary/i.test(
            firstMsg,
          );
        const canRefreshLink =
          !signal.aborted &&
          !isCloudflareErr &&
          pageUrl.startsWith('http') &&
          (isAuthOrExpiredErr || /timed ?out|timedout|body|decode|econnreset|socket/i.test(firstMsg));
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
            this.handleTransferProgress(progress);
          },
          runLogger,
        );
      }

      this.activeTransfer = null;
      this.emit('transfer', null);

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
      return { downloaded: true, skipped: false, failed: false, bytes: res.bytes };
    } catch (err) {
      this.activeTransfer = null;
      this.emit('transfer', null);
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
      if (!signal.aborted) {
        runLogger('error', `Failed ${release.filename}: ${errMsg}`, release.downloadUrl);
      }
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
    if (this.activeRun && this.abortController) {
      this.log('warn', 'SIGTERM received; gracefully halting active sync run');
      this.abortController.abort();
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
