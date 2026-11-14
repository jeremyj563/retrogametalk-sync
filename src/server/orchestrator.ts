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
  createSyncRun,
  deleteRepositoryItemsByIds,
  deleteRepositoryItemsByLocalPaths,
  getCatalogTotalsAndSystems,
  getDataDir,
  getInternalConfig,
  getRepositoryItemById,
  getRepositoryItemByRemoteUrl,
  listSyncRuns,
  releaseDistributedLock,
  saveDiscoveredSystems,
  setWatermark,
  updateConfig,
  updateSyncRun,
  upsertRepositoryItem,
} from './db.ts';
import { AdaptiveRateLimiter } from './rateLimiter.ts';
import {
  type DiscoveredRelease,
  type LoggerFn,
  RetroGameTalkClient,
  resolveMirroredPaths,
} from './rgtClient.ts';
import type {
  ActiveTransferState,
  AuthTestResult,
  ConfigUpdateInput,
  FsTreeNode,
  LogLevel,
  RunMode,
  RunTrigger,
  ScraperConfigInternal,
  ScraperConfigPublic,
  ServiceStatusSnapshot,
  StorageStats,
  SyncRunRecord,
} from './types.ts';

const POD_ID = process.env.HOSTNAME || os.hostname() || 'rgt-sync-pod';
const MAX_CRAWL_PAGES_PER_RUN = 300;

export class ScraperOrchestrator extends EventEmitter {
  private rateLimiter: AdaptiveRateLimiter;
  private client: RetroGameTalkClient;
  private cronJob: Cron | null = null;
  private activeRun: SyncRunRecord | null = null;
  private activeTransfer: ActiveTransferState | null = null;
  private currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
  private abortController: AbortController | null = null;
  private lockRenewTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

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
    this.reconfigureScheduler(cfg);
  }

  private log(level: LogLevel, message: string, detail: string | null = null, runId: number | null = null): void {
    const entry = appendActivityLog(level, message, detail, runId);
    this.emit('log', entry);
  }

  private emitStatus(): void {
    this.emit('status', this.getStatusSnapshot());
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
    const updated = updateConfig(input);
    this.reconfigureScheduler(getInternalConfig());
    this.log('info', 'Service configuration saved');
    this.emitStatus();
    return updated;
  }

  async testAuth(): Promise<AuthTestResult> {
    const cfg = getInternalConfig();
    this.log('info', `Running connection & authentication probe against ${cfg.baseUrl}`);
    const result = await this.client.testAuthAndDiscovery(cfg);
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
          entry.name === 'cookies.json'
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
      if (!item.localPath) continue;
      const target = path.resolve(item.localPath);
      if (target.startsWith(root + path.sep) && fs.existsSync(target)) {
        try {
          fs.rmSync(target, { recursive: true, force: true });
          filesRemoved += 1;
        } catch {
          // Ignore filesystem removal error if already gone
        }
      }
    }

    if (removedItems.length > 0) {
      this.log('info', `Deleted ${removedItems.length} catalog item(s) (${filesRemoved} file(s) removed from disk)`);
      this.emitStatus();
    }

    return {
      deletedCount: removedItems.length,
      filesRemoved,
    };
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

  getStatusSnapshot(): ServiceStatusSnapshot {
    const cfg = getInternalConfig();
    const { totals, systems } = getCatalogTotalsAndSystems();
    const nextRun = this.cronJob?.nextRun();

    return {
      podId: POD_ID,
      activeRun: this.activeRun,
      activeTransfer: this.activeTransfer,
      currentPhase: this.currentPhase,
      nextScheduledRunAt: cfg.scheduleEnabled && nextRun ? nextRun.toISOString() : null,
      scheduleEnabled: cfg.scheduleEnabled,
      cronSchedule: cfg.cronSchedule,
      lastWatermarkAt: cfg.lastWatermarkAt,
      rateLimiter: this.rateLimiter.getTelemetry(),
      auth: this.client.getAuthStatus(cfg),
      storage: this.getStorageStats(cfg.downloadDir),
      totals,
      systems,
    };
  }

  async startRun(trigger: RunTrigger, mode: RunMode): Promise<SyncRunRecord> {
    if (this.activeRun) {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    const cfg = getInternalConfig();
    const lockKey = cfg.systemFilter
      ? `sync:${cfg.systemFilter.toLowerCase()}`
      : 'sync:global';

    if (!acquireDistributedLock(lockKey, POD_ID, 180)) {
      throw new Error(`Another pod holds distributed lock "${lockKey}"`);
    }

    const run = createSyncRun(trigger, mode);
    this.activeRun = run;
    this.abortController = new AbortController();
    this.currentPhase = `Run #${run.id} initializing (${mode})`;

    this.lockRenewTimer = setInterval(() => {
      acquireDistributedLock(lockKey, POD_ID, 180);
    }, 60_000);

    this.log('info', `Started ${mode} sync run #${run.id} (${trigger})`, `Target: ${cfg.baseUrl}`, run.id);
    this.emitStatus();

    void this.executeRun(run, cfg, lockKey);
    return run;
  }

  async retryItem(itemId: number): Promise<SyncRunRecord> {
    const item = getRepositoryItemById(itemId);
    if (!item) {
      throw new Error(`Repository item #${itemId} not found`);
    }
    if (this.activeRun) {
      throw new Error(`Sync run #${this.activeRun.id} is already in progress`);
    }

    const cfg = getInternalConfig();
    const run = createSyncRun('retry', 'incremental');
    this.activeRun = run;
    this.abortController = new AbortController();
    this.currentPhase = `Retrying ${item.filename}`;
    this.emitStatus();

    void (async () => {
      const signal = this.abortController!.signal;
      const runLogger: LoggerFn = (level, msg, detail) => this.log(level, msg, detail ?? null, run.id);
      try {
        if (cfg.username && cfg.password) {
          await this.client.login(cfg, signal, runLogger);
        }

        const pageUrl = item.remoteUrl.split('#')[0];
        let release: DiscoveredRelease = {
          remoteUrl: item.remoteUrl,
          pageUrl,
          downloadUrl: item.downloadUrl,
          remotePath: item.remotePath,
          filename: item.filename,
          systemName: item.systemName,
          releaseType: item.releaseType,
          title: item.title,
          publishedAt: item.publishedAt,
        };

        // Re-resolve fresh nonce + download.php key from the release page when retrying
        if (pageUrl.startsWith('http') && item.remoteUrl.includes('#')) {
          const pageData = await this.client.fetchPageHtml(pageUrl, cfg, signal, runLogger);
          const fresh = await this.client.extractDynamicReleaseDownloads(
            pageData.html,
            pageData.finalUrl,
            cfg,
            signal,
            runLogger,
          );
          const matched = fresh.find((f) => f.filename === item.filename) || fresh[0];
          if (matched) {
            release = matched;
          }
        }

        const outcome = await this.downloadSingleRelease(release, cfg, run.id, signal, runLogger);
        updateSyncRun(run.id, {
          status: 'completed',
          finishedAt: new Date().toISOString(),
          newFound: 1,
          downloadedCount: outcome.downloaded ? 1 : 0,
          skippedCount: outcome.skipped ? 1 : 0,
          failedCount: outcome.failed ? 1 : 0,
          bytesDownloaded: outcome.bytes,
          avgDelayMs: this.rateLimiter.getTelemetry().currentDelayMs,
        });
      } catch (err) {
        updateSyncRun(run.id, {
          status: signal.aborted ? 'stopped' : 'failed',
          finishedAt: new Date().toISOString(),
          failedCount: 1,
          errorSummary: err instanceof Error ? err.message : String(err),
        });
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
    let newFound = 0;
    let downloadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let bytesDownloaded = 0;
    let newestReleaseIso: string | null = cfg.lastWatermarkAt;

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
      if (cfg.username && cfg.password) {
        this.currentPhase = 'Authenticating with retrogametalk.com';
        this.emitStatus();
        await this.client.login(cfg, signal, runLogger);
      }

      const visitedPages = new Set<string>();
      const visitedReleasePages = new Set<string>();
      const processedReleaseUrls = new Set<string>();

      const indexQueue: string[] = [cfg.baseUrl];
      const watermarkMs = cfg.lastWatermarkAt ? Date.parse(cfg.lastWatermarkAt) : null;

      const handleReleaseList = async (releases: DiscoveredRelease[]) => {
        for (const release of releases) {
          if (signal.aborted) break;
          if (processedReleaseUrls.has(release.remoteUrl)) continue;
          processedReleaseUrls.add(release.remoteUrl);
          newFound += 1;

          if (release.publishedAt) {
            const relMs = Date.parse(release.publishedAt);
            if (!Number.isNaN(relMs) && (!newestReleaseIso || relMs > Date.parse(newestReleaseIso))) {
              newestReleaseIso = new Date(relMs).toISOString();
            }
          }

          if (run.mode === 'dry_run') {
            const expectedLocal = path.resolve(cfg.downloadDir, release.remotePath);
            const alreadyExists = fs.existsSync(expectedLocal) && fs.statSync(expectedLocal).size > 0;
            if (alreadyExists) {
              skippedCount += 1;
            } else {
              runLogger('info', `[Dry Run] Would download ${release.remotePath}`, release.downloadUrl);
            }
            persistCounters();
            continue;
          }

          // Immediately stream/dedupe while the ajax.php download key is fresh
          const outcome = await this.downloadSingleRelease(release, cfg, run.id, signal, runLogger);
          if (outcome.downloaded) downloadedCount += 1;
          if (outcome.skipped) skippedCount += 1;
          if (outcome.failed) failedCount += 1;
          bytesDownloaded += outcome.bytes;
          persistCounters();
        }
      };

      // Crawl index/system/pagination pages & inspect release detail pages as discovered
      while (indexQueue.length > 0 && pagesCrawled < MAX_CRAWL_PAGES_PER_RUN) {
        if (signal.aborted) break;

        const pageUrl = indexQueue.shift()!;
        if (visitedPages.has(pageUrl)) continue;
        visitedPages.add(pageUrl);

        this.currentPhase = `Scanning index (${pagesCrawled + 1}/${MAX_CRAWL_PAGES_PER_RUN}): ${this.formatRelativePhasePath(pageUrl, cfg.baseUrl)}`;
        this.emitStatus();

        let pageData: { html: string; finalUrl: string; status: number };
        try {
          pageData = await this.client.fetchPageHtml(pageUrl, cfg, signal, runLogger);
        } catch (err) {
          if (signal.aborted) break;
          runLogger('warn', `Failed to scan ${pageUrl}`, err instanceof Error ? err.message : String(err));
          continue;
        }

        pagesCrawled += 1;
        if (pageData.status >= 400) {
          runLogger('warn', `HTTP ${pageData.status} on ${pageUrl}`);
          continue;
        }

        const extracted = this.client.extractLinksFromHtml(pageData.html, pageData.finalUrl, cfg);
        if (extracted.systems.length > 0) {
          saveDiscoveredSystems(extracted.systems);
        }

        // If this page itself has an ACF/DLC download widget, extract and process directly
        const inlineDynamic = await this.client.extractDynamicReleaseDownloads(
          pageData.html,
          pageData.finalUrl,
          cfg,
          signal,
          runLogger,
        );
        if (inlineDynamic.length > 0) {
          await handleReleaseList(inlineDynamic);
        }
        if (extracted.downloads.length > 0) {
          await handleReleaseList(extracted.downloads);
        }

        // Process discovered release detail pages on this index page
        let allReleasesOlderAndIndexed =
          extracted.releasePages.length > 0 && run.mode === 'incremental' && watermarkMs !== null;

        for (const relPageUrl of extracted.releasePages) {
          if (signal.aborted || pagesCrawled >= MAX_CRAWL_PAGES_PER_RUN) break;
          if (visitedReleasePages.has(relPageUrl)) continue;
          visitedReleasePages.add(relPageUrl);

          const relTimeStr = extracted.releaseTimes.get(relPageUrl);
          if (relTimeStr && watermarkMs !== null) {
            const relMs = Date.parse(relTimeStr);
            if (!Number.isNaN(relMs) && relMs > watermarkMs) {
              allReleasesOlderAndIndexed = false;
            }
          }

          // Check if we already have a downloaded/skipped record for this release page in incremental mode
          const existingDir = resolveMirroredPaths(cfg.baseUrl, relPageUrl, cfg.downloadDir, 'probe.zip');
          const relFolder = path.dirname(existingDir.localPath);
          const folderHasFiles =
            run.mode === 'incremental' &&
            fs.existsSync(relFolder) &&
            fs.readdirSync(relFolder).some((n) => !n.startsWith('.') && !n.endsWith('.part'));

          if (folderHasFiles) {
            const existingByPrefix = getRepositoryItemByRemoteUrl(relPageUrl);
            if (existingByPrefix?.status === 'downloaded') {
              skippedCount += 1;
              continue;
            }
          }

          allReleasesOlderAndIndexed = false;

          this.currentPhase = `Inspecting release (${pagesCrawled + 1}/${MAX_CRAWL_PAGES_PER_RUN}): ${this.formatRelativePhasePath(relPageUrl, cfg.baseUrl)}`;
          this.emitStatus();

          try {
            const relPage = await this.client.fetchPageHtml(relPageUrl, cfg, signal, runLogger);
            pagesCrawled += 1;
            if (relPage.status >= 400) continue;

            const dynamicReleases = await this.client.extractDynamicReleaseDownloads(
              relPage.html,
              relPage.finalUrl,
              cfg,
              signal,
              runLogger,
            );
            const relExtracted = this.client.extractLinksFromHtml(relPage.html, relPage.finalUrl, cfg);
            const combined = [...dynamicReleases, ...relExtracted.downloads];

            if (combined.length > 0) {
              await handleReleaseList(combined);
            }
          } catch (err) {
            if (signal.aborted) break;
            runLogger('warn', `Error inspecting ${relPageUrl}`, err instanceof Error ? err.message : String(err));
          }
        }

        if (!allReleasesOlderAndIndexed) {
          for (const sub of extracted.subPages) {
            if (!visitedPages.has(sub)) {
              indexQueue.push(sub);
            }
          }
        } else {
          runLogger('info', `Reached watermark boundary on ${pageUrl}; stopping older pagination`);
        }

        persistCounters();
      }

      if (!signal.aborted && run.mode !== 'dry_run') {
        setWatermark(newestReleaseIso || new Date().toISOString());
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

      runLogger(
        'info',
        `Run #${run.id} ${finalStatus}: ${downloadedCount} downloaded, ${skippedCount} skipped, ${failedCount} failed`,
      );
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
      this.activeRun = null;
      this.abortController = null;
      this.currentPhase = 'Idle · Waiting for next scheduled run or manual trigger';
      this.emitStatus();
    }
  }

  private async downloadSingleRelease(
    release: DiscoveredRelease,
    cfg: ScraperConfigInternal,
    runId: number,
    signal: AbortSignal,
    runLogger: LoggerFn,
  ): Promise<{ downloaded: boolean; skipped: boolean; failed: boolean; bytes: number }> {
    const mirrored = resolveMirroredPaths(
      cfg.baseUrl,
      release.pageUrl || release.remoteUrl,
      cfg.downloadDir,
      release.filename,
    );

    const record = upsertRepositoryItem({
      remoteUrl: release.remoteUrl,
      downloadUrl: release.downloadUrl,
      remotePath: release.remotePath || mirrored.remotePath,
      localPath: path.resolve(cfg.downloadDir, release.remotePath || mirrored.remotePath),
      filename: release.filename,
      systemName: release.systemName,
      releaseType: release.releaseType,
      title: release.title,
      publishedAt: release.publishedAt,
      status: 'downloading',
      lastRunId: runId,
    });

    this.currentPhase = `Downloading ${release.systemName} / ${release.filename}`;
    this.activeTransfer = {
      itemId: record.id,
      filename: release.filename,
      systemName: release.systemName,
      remoteUrl: release.remoteUrl,
      localPath: record.localPath,
      bytesReceived: 0,
      totalBytes: null,
      bytesPerSec: 0,
    };
    this.emitStatus();

    try {
      const res = await this.client.downloadFileAtomic(
        release,
        cfg,
        signal,
        (progress) => {
          if (this.activeTransfer) {
            this.activeTransfer.bytesReceived = progress.bytesReceived;
            this.activeTransfer.totalBytes = progress.totalBytes;
            this.activeTransfer.bytesPerSec = progress.bytesPerSec;
            this.emit('transfer', this.activeTransfer);
          }
        },
        runLogger,
      );

      this.activeTransfer = null;

      if (res.outcome === 'skipped') {
        upsertRepositoryItem({
          remoteUrl: release.remoteUrl,
          downloadUrl: release.downloadUrl,
          remotePath: res.remotePath,
          localPath: res.localPath,
          filename: res.filename,
          systemName: release.systemName,
          releaseType: release.releaseType,
          title: release.title,
          fileSizeBytes: res.bytes,
          publishedAt: release.publishedAt,
          status: 'skipped',
          errorMessage: null,
          lastRunId: runId,
        });
        runLogger('info', `Skipped existing file: ${res.remotePath}`);
        return { downloaded: false, skipped: true, failed: false, bytes: 0 };
      }

      upsertRepositoryItem({
        remoteUrl: release.remoteUrl,
        downloadUrl: release.downloadUrl,
        remotePath: res.remotePath,
        localPath: res.localPath,
        filename: res.filename,
        systemName: release.systemName,
        releaseType: release.releaseType,
        title: release.title,
        fileSizeBytes: res.bytes,
        publishedAt: release.publishedAt,
        status: 'downloaded',
        errorMessage: null,
        lastRunId: runId,
        downloadedAt: new Date().toISOString(),
      });
      runLogger('download', `Mirrored ${res.remotePath}`, `${res.bytes} bytes`);
      return { downloaded: true, skipped: false, failed: false, bytes: res.bytes };
    } catch (err) {
      this.activeTransfer = null;
      const errMsg = err instanceof Error ? err.message : String(err);
      upsertRepositoryItem({
        remoteUrl: release.remoteUrl,
        downloadUrl: release.downloadUrl,
        remotePath: release.remotePath,
        localPath: record.localPath,
        filename: release.filename,
        systemName: release.systemName,
        releaseType: release.releaseType,
        title: release.title,
        publishedAt: release.publishedAt,
        status: 'failed',
        errorMessage: errMsg,
        lastRunId: runId,
      });
      if (!signal.aborted) {
        runLogger('error', `Failed ${release.filename}: ${errMsg}`, release.downloadUrl);
      }
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
      '# HELP rgt_items_downloaded_total Total repository items mirrored to local disk',
      '# TYPE rgt_items_downloaded_total gauge',
      `rgt_items_downloaded_total ${snap.totals.downloadedItems}`,
      '# HELP rgt_items_skipped_total Total repository items skipped by filename deduplication',
      '# TYPE rgt_items_skipped_total gauge',
      `rgt_items_skipped_total ${snap.totals.skippedItems}`,
      '# HELP rgt_items_failed_total Total repository items currently in failed state',
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
