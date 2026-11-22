import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  addItemsToUserCollection,
  computeSyncPreflightSummary,
  createUserCollection,
  deleteUserCollection,
  getCatalogStatsSnapshot,
  getPublicConfig,
  getRepositoryItemById,
  getSchemaMigrationReport,
  getUserCollectionById,
  initDb,
  listActivityLogs,
  listOutdatedInstalledItems,
  listSyncRuns,
  listUserCollections,
  queryRepositoryItemIds,
  queryRepositoryItems,
  removeItemsFromUserCollection,
  setCatalogItemsFavorite,
  setCatalogItemsInstalled,
  setCatalogItemsSyncOverride,
  updateUserCollection,
} from './src/server/db.ts';
import {
  buildContentDispositionAttachment,
  listArchiveEntries,
  streamCleanDiscZipToResponse,
  streamExtractedEntryToResponse,
} from './src/server/archiveService.ts';
import { formatErrorDetails, isDebugLoggingEnabled, logServer } from './src/server/logger.ts';
import { AppAuthManager } from './src/server/appAuth.ts';
import { ScraperOrchestrator } from './src/server/orchestrator.ts';
import { getAchievementsSnapshot, markAchievementsSeen } from './src/server/achievements.ts';
import type { ClientAchievementEventPayload } from './src/shared/achievements.ts';
import {
  buildConfigBackupSnapshot,
  parseAndValidateConfigBackup,
} from './src/shared/configBackup.ts';
import { sanitizeFat32Filename } from './src/shared/romNaming.ts';
import type { ConfigUpdateInput, RunMode } from './src/server/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function bootstrap() {
  initDb();
  const orchestrator = new ScraperOrchestrator();
  const appAuth = new AppAuthManager();
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Kubernetes liveness probe
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Kubernetes readiness probe (verifies SQLite + writable DOWNLOAD_DIR without walking disk)
  app.get('/readyz', (_req, res) => {
    try {
      const readiness = orchestrator.getReadinessSnapshot();
      if (!readiness.writable) {
        res.status(503).json({ status: 'not_ready', reason: 'DOWNLOAD_DIR not writable' });
        return;
      }
      res.status(200).json({
        status: 'ready',
        podId: readiness.podId,
        schemaVersion: readiness.schemaVersion,
      });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', reason: String(err) });
    }
  });

  // Prometheus metrics endpoint
  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(orchestrator.getPrometheusMetrics());
  });

  // Optional environment-driven App Authentication routes (always reachable)
  app.get('/api/app-auth/status', appAuth.handleStatus);
  app.post('/api/app-auth/login', appAuth.handleLogin);
  app.post('/api/app-auth/logout', appAuth.handleLogout);

  // Enforce App Authentication + CSRF protection on all remaining /api/* routes when APP_AUTH_PASSWORD is set
  app.use('/api', appAuth.requireAuthMiddleware);

  // Service snapshot
  app.get('/api/status', (_req, res) => {
    res.json(orchestrator.getStatusSnapshot());
  });

  // SQLite schema version & applied migration history
  app.get('/api/schema', (_req, res) => {
    res.json(getSchemaMigrationReport());
  });

  // Server-Sent Events stream for live operational updates
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('status', orchestrator.getStatusSnapshot());

    const onStatus = (snap: unknown) => sendEvent('status', snap);
    const onLog = (entry: unknown) => sendEvent('log', entry);
    const onTransfer = (transfer: unknown) => sendEvent('transfer', transfer);
    const onCatalogUpdated = (payload: unknown) => sendEvent('catalog_updated', payload);
    const onLogsCleared = (payload: unknown) => sendEvent('logs_cleared', payload);
    const onRunsCleared = (payload: unknown) => sendEvent('runs_cleared', payload);
    const onAchievementUnlocked = (payload: unknown) => sendEvent('achievement_unlocked', payload);

    orchestrator.on('status', onStatus);
    orchestrator.on('log', onLog);
    orchestrator.on('transfer', onTransfer);
    orchestrator.on('catalog_updated', onCatalogUpdated);
    orchestrator.on('logs_cleared', onLogsCleared);
    orchestrator.on('runs_cleared', onRunsCleared);
    orchestrator.on('achievement_unlocked', onAchievementUnlocked);

    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      orchestrator.off('status', onStatus);
      orchestrator.off('log', onLog);
      orchestrator.off('transfer', onTransfer);
      orchestrator.off('catalog_updated', onCatalogUpdated);
      orchestrator.off('logs_cleared', onLogsCleared);
      orchestrator.off('runs_cleared', onRunsCleared);
      orchestrator.off('achievement_unlocked', onAchievementUnlocked);
    });
  });

  // Console-style Trophy & Achievements API
  app.get('/api/achievements', (_req, res) => {
    res.json(getAchievementsSnapshot());
  });

  app.post('/api/achievements/event', (req, res) => {
    const type = typeof req.body?.type === 'string' ? req.body.type.trim() : '';
    if (!type) {
      res.status(400).json({ error: 'Missing achievement event type' });
      return;
    }
    const payload: ClientAchievementEventPayload = {
      type: type as ClientAchievementEventPayload['type'],
      value: typeof req.body?.value === 'number' ? req.body.value : undefined,
      localHour: typeof req.body?.localHour === 'number' ? req.body.localHour : undefined,
    };
    const result = orchestrator.handleClientAchievementEvent(payload);
    res.json(result);
  });

  app.post('/api/achievements/seen', (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map((id: unknown) => String(id)).filter(Boolean)
      : undefined;
    const summary = markAchievementsSeen(ids);
    res.json({ ok: true, summary });
  });

  // Sync runs endpoints
  app.get('/api/runs', (req, res) => {
    const limit = Number(req.query.limit || 25);
    res.json({ runs: listSyncRuns(limit) });
  });

  app.delete('/api/runs', (_req, res) => {
    const cleared = orchestrator.clearRuns();
    res.json({ ok: true, cleared });
  });

  app.get('/api/sync/preflight', (_req, res) => {
    res.json(computeSyncPreflightSummary());
  });

  app.post('/api/runs/start', async (req, res) => {
    const requestedMode = String(req.body?.mode || 'incremental') as RunMode;
    const mode: RunMode = ['incremental', 'full', 'dry_run'].includes(requestedMode)
      ? requestedMode
      : 'incremental';
    const dryRun = Boolean(req.body?.dryRun) || mode === 'dry_run';
    const normalizedMode: RunMode = mode === 'dry_run' ? 'incremental' : mode;
    const refreshStaleIndexes =
      req.body?.refreshStaleIndexes === undefined ? true : Boolean(req.body.refreshStaleIndexes);
    const legacyFullCrawl = Boolean(req.body?.legacyFullCrawl);

    try {
      const run = await orchestrator.startRun('manual', normalizedMode, {
        dryRun,
        refreshStaleIndexes,
        legacyFullCrawl,
      });
      res.status(202).json({ run });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/runs/stop', (_req, res) => {
    const stopped = orchestrator.stopActiveRun();
    if (!stopped) {
      res.status(404).json({ error: 'No active sync run to stop' });
      return;
    }
    res.json({ ok: true });
  });

  const parseQueryFilterParam = (raw: unknown): string | string[] | undefined => {
    if (Array.isArray(raw)) return raw.map((v) => String(v));
    if (typeof raw === 'string') return raw;
    return undefined;
  };

  const parseOptionalPositiveInt = (raw: unknown): number | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };

  const parseOptionalSyncOverride = (raw: unknown): 'default' | 'pin' | 'ignore' | undefined => {
    if (raw === 'default' || raw === 'pin' || raw === 'ignore') return raw;
    return undefined;
  };

  // Repository catalog, metadata, local assets, download & retry
  app.get('/api/items', (req, res) => {
    const result = queryRepositoryItems({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      system: parseQueryFilterParam(req.query.system),
      status: parseQueryFilterParam(req.query.status),
      downloaded: typeof req.query.downloaded === 'string' ? req.query.downloaded : undefined,
      installed: typeof req.query.installed === 'string' ? req.query.installed : undefined,
      syncRules: req.query.syncRules === 'true' || req.query.syncRules === '1',
      favoriteOnly: req.query.favoriteOnly === 'true' || req.query.favoriteOnly === '1',
      collectionId: parseOptionalPositiveInt(req.query.collectionId),
      syncOverride: parseOptionalSyncOverride(req.query.syncOverride),
      tag: parseQueryFilterParam(req.query.tag),
      tagMode: typeof req.query.tagMode === 'string' ? req.query.tagMode : undefined,
      genre: parseQueryFilterParam(req.query.genre),
      genreMode: typeof req.query.genreMode === 'string' ? req.query.genreMode : undefined,
      region: parseQueryFilterParam(req.query.region),
      regionMode: typeof req.query.regionMode === 'string' ? req.query.regionMode : undefined,
      language: parseQueryFilterParam(req.query.language),
      languageMode: typeof req.query.languageMode === 'string' ? req.query.languageMode : undefined,
      source: parseQueryFilterParam(req.query.source),
      sourceMode: typeof req.query.sourceMode === 'string' ? req.query.sourceMode : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
      limit: Number(req.query.limit || 50),
      offset: Number(req.query.offset || 0),
    });
    res.json(result);
  });

  app.get('/api/items/ids', (req, res) => {
    const result = queryRepositoryItemIds({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      system: parseQueryFilterParam(req.query.system),
      status: parseQueryFilterParam(req.query.status),
      downloaded: typeof req.query.downloaded === 'string' ? req.query.downloaded : undefined,
      installed: typeof req.query.installed === 'string' ? req.query.installed : undefined,
      syncRules: req.query.syncRules === 'true' || req.query.syncRules === '1',
      favoriteOnly: req.query.favoriteOnly === 'true' || req.query.favoriteOnly === '1',
      collectionId: parseOptionalPositiveInt(req.query.collectionId),
      syncOverride: parseOptionalSyncOverride(req.query.syncOverride),
      tag: parseQueryFilterParam(req.query.tag),
      tagMode: typeof req.query.tagMode === 'string' ? req.query.tagMode : undefined,
      genre: parseQueryFilterParam(req.query.genre),
      genreMode: typeof req.query.genreMode === 'string' ? req.query.genreMode : undefined,
      region: parseQueryFilterParam(req.query.region),
      regionMode: typeof req.query.regionMode === 'string' ? req.query.regionMode : undefined,
      language: parseQueryFilterParam(req.query.language),
      languageMode: typeof req.query.languageMode === 'string' ? req.query.languageMode : undefined,
      source: parseQueryFilterParam(req.query.source),
      sourceMode: typeof req.query.sourceMode === 'string' ? req.query.sourceMode : undefined,
      sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
    });
    res.json(result);
  });

  app.get('/api/items/outdated', (req, res) => {
    const deviceLabel =
      typeof req.query.deviceLabel === 'string' && req.query.deviceLabel.trim()
        ? req.query.deviceLabel.trim()
        : null;
    res.json(listOutdatedInstalledItems({ deviceLabel }));
  });

  app.get('/api/catalog/stats', (_req, res) => {
    res.json(getCatalogStatsSnapshot());
  });

  app.post('/api/catalog/index', async (req, res) => {
    const scope = req.body?.scope === 'full' ? 'full' : 'filtered';
    const forceFull = Boolean(req.body?.forceFull);
    try {
      const result = await orchestrator.startCatalogIndex(scope, { forceFull });
      res.status(202).json({
        ...result,
        status: orchestrator.getStatusSnapshot(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = /Verify RetroGameTalk/i.test(msg) ? 400 : 409;
      res.status(code).json({ error: msg });
    }
  });

  app.post('/api/catalog/index/stop', (_req, res) => {
    const stopped = orchestrator.stopCatalogIndex();
    res.json({
      ok: true,
      stopped,
      status: orchestrator.getStatusSnapshot(),
    });
  });

  app.post('/api/items/download', async (req, res) => {
    const rawIds: unknown[] | undefined = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
    const rawFilters =
      req.body?.filters && typeof req.body.filters === 'object' ? (req.body.filters as Record<string, unknown>) : undefined;

    if (!rawIds && !rawFilters) {
      res.status(400).json({ error: 'Provide either item ids or catalog filters to queue downloads' });
      return;
    }

    try {
      if (rawFilters) {
        const filters = {
          search: typeof rawFilters.search === 'string' ? rawFilters.search : undefined,
          system: parseQueryFilterParam(rawFilters.system),
          status: parseQueryFilterParam(rawFilters.status),
          downloaded: typeof rawFilters.downloaded === 'string' ? rawFilters.downloaded : undefined,
          installed: typeof rawFilters.installed === 'string' ? rawFilters.installed : undefined,
          syncRules: Boolean(rawFilters.syncRules),
          favoriteOnly: Boolean(rawFilters.favoriteOnly),
          collectionId: parseOptionalPositiveInt(rawFilters.collectionId),
          syncOverride: parseOptionalSyncOverride(rawFilters.syncOverride),
          tag: parseQueryFilterParam(rawFilters.tag),
          tagMode: typeof rawFilters.tagMode === 'string' ? rawFilters.tagMode : undefined,
          genre: parseQueryFilterParam(rawFilters.genre),
          genreMode: typeof rawFilters.genreMode === 'string' ? rawFilters.genreMode : undefined,
          region: parseQueryFilterParam(rawFilters.region),
          regionMode: typeof rawFilters.regionMode === 'string' ? rawFilters.regionMode : undefined,
          language: parseQueryFilterParam(rawFilters.language),
          languageMode: typeof rawFilters.languageMode === 'string' ? rawFilters.languageMode : undefined,
          source: parseQueryFilterParam(rawFilters.source),
          sourceMode: typeof rawFilters.sourceMode === 'string' ? rawFilters.sourceMode : undefined,
          sort: typeof rawFilters.sort === 'string' ? rawFilters.sort : undefined,
        };
        const result = await orchestrator.queueCatalogDownloads({ filters });
        if (result.queuedCount > 0) {
          orchestrator.recordServerAchievementCounter('on_demand_queued', result.queuedCount, 'increment');
        }
        res.status(202).json({
          ...result,
          skippedCount: result.alreadyQueuedCount + result.alreadyDownloadedCount,
        });
        return;
      }

      const cleanIds = Array.from(
        new Set(
          (rawIds || []).map((v) => Number(v)).filter((id) => Number.isInteger(id) && id > 0),
        ),
      );
      if (cleanIds.length === 0) {
        res.status(400).json({ error: 'Provide one or more valid catalog release IDs to download' });
        return;
      }
      const result = await orchestrator.queueCatalogDownloads({ ids: cleanIds });
      if (result.queuedCount > 0) {
        orchestrator.recordServerAchievementCounter('on_demand_queued', result.queuedCount, 'increment');
      }
      res.status(202).json({
        ...result,
        skippedCount: result.alreadyQueuedCount + result.alreadyDownloadedCount,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusCode = /No downloadable|already downloaded|already queued|Provide/i.test(msg) ? 400 : 409;
      res.status(statusCode).json({ error: msg });
    }
  });

  app.get('/api/items/:id', (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const item = getRepositoryItemById(itemId);
    if (!item) {
      res.status(404).json({ error: 'Catalog item not found' });
      return;
    }
    res.json({ item });
  });

  app.get('/api/items/:id/asset', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const kind = req.query.kind === 'screenshot' ? 'screenshot' : 'cover';
    const index = Number(req.query.index || 0);
    const wantFullRes = req.query.full === '1';
    const wantLazy = req.query.lazy === '1';

    let item = getRepositoryItemById(itemId);
    if (wantFullRes && !wantLazy && item && item.status !== 'available' && (item.metadata?.screenshotsFullResVersion ?? 0) < 1) {
      item = (await orchestrator.ensureFullResItemAssets(itemId)) ?? item;
    }

    let asset = orchestrator.resolveItemAssetFile(itemId, kind, Number.isNaN(index) ? 0 : index);
    if (!asset && kind === 'cover' && wantLazy && item?.metadata?.coverUrl) {
      await orchestrator.ensureLazyCoverAsset(itemId);
      asset = orchestrator.resolveItemAssetFile(itemId, 'cover', 0);
    } else if (
      !asset &&
      kind === 'screenshot' &&
      wantLazy &&
      Number.isInteger(index) &&
      index >= 0 &&
      item?.metadata?.screenshotUrls?.[index]
    ) {
      await orchestrator.ensureLazyScreenshotAsset(itemId, index, () => req.destroyed);
      asset = orchestrator.resolveItemAssetFile(itemId, 'screenshot', index);
    }
    if (!asset) {
      res.status(404).json({ error: 'Artwork asset not found locally' });
      return;
    }

    const isFullResVerified = (item?.metadata?.screenshotsFullResVersion ?? 0) >= 1;
    res.setHeader(
      'Cache-Control',
      isFullResVerified || kind === 'cover' || wantLazy ? 'public, max-age=3600' : 'no-cache',
    );
    res.sendFile(asset.absPath);
  });

  app.get('/api/items/:id/download', (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    const rom = orchestrator.resolveItemRomFile(itemId, fileId);
    if (!rom) {
      logServer('HTTP', 'debug', `Download failed: archive missing on disk`, `itemId=${itemId}, fileId=${fileId ?? 'default'}`);
      res.status(404).json({ error: 'Mirrored ROM archive not found on disk' });
      return;
    }
    const disposition = buildContentDispositionAttachment(rom.filename);
    res.setHeader('Content-Disposition', disposition.headerValue);
    res.sendFile(rom.absPath, (err) => {
      if (err) {
        logServer('HTTP', 'debug', `Error streaming raw archive "${rom.filename}" (itemId=${itemId})`, formatErrorDetails(err));
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      }
    });
  });

  app.get('/api/items/:id/inspect', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    try {
      const inspection = await orchestrator.inspectItemArchive(itemId, fileId);
      if (!inspection) {
        logServer('HTTP', 'debug', `Inspect failed: archive missing on disk`, `itemId=${itemId}, fileId=${fileId ?? 'default'}`);
        res.status(404).json({ error: 'Mirrored archive not found on disk' });
        return;
      }
      orchestrator.recordServerAchievementCounter('archive_inspections', 1, 'increment');
      res.json({ inspection });
    } catch (err) {
      logServer('HTTP', 'debug', `Inspect error for itemId=${itemId}`, formatErrorDetails(err));
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/items/:id/archive', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    try {
      const result = await orchestrator.browseItemArchive(itemId, fileId);
      if (!result) {
        res.status(404).json({ error: 'Mirrored archive not found on disk' });
        return;
      }
      orchestrator.recordServerAchievementCounter('archive_inspections', 1, 'increment');
      res.json(result);
    } catch (err) {
      logServer('HTTP', 'debug', `Archive browse error for itemId=${itemId}`, formatErrorDetails(err));
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/items/:id/archive/preview', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    const entryPath = typeof req.query.entry === 'string' ? req.query.entry.trim() : '';
    if (!entryPath) {
      res.status(400).json({ error: 'Missing entry query parameter' });
      return;
    }
    try {
      const preview = await orchestrator.previewItemArchiveEntry(itemId, entryPath, fileId);
      if (!preview) {
        res.status(404).json({ error: 'Mirrored archive not found on disk' });
        return;
      }
      res.json({ preview });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/items/:id/archive/entry', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    const entryPath = typeof req.query.entry === 'string' ? req.query.entry.trim() : '';
    if (!entryPath) {
      res.status(400).json({ error: 'Missing entry query parameter' });
      return;
    }
    try {
      const resolved = orchestrator.resolveItemRomFile(itemId, fileId);
      if (!resolved) {
        res.status(404).json({ error: 'Mirrored archive not found on disk' });
        return;
      }
      const { entries } = await listArchiveEntries(resolved.absPath);
      const normalizedTarget = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const matched = entries.find(
        (e) => e.entryPath.replace(/\\/g, '/').replace(/^\/+/, '') === normalizedTarget,
      );
      if (!matched) {
        res.status(404).json({ error: 'Entry not found inside archive' });
        return;
      }
      const leafName = path.posix.basename(matched.entryPath) || 'archive-entry';
      await streamExtractedEntryToResponse(
        resolved.absPath,
        matched.entryPath,
        leafName,
        res,
        matched.sizeBytes,
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  app.post('/api/items/inspect-batch', async (req, res) => {
    const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids: number[] = Array.from(
      new Set<number>(rawIds.map((v) => Number(v)).filter((id) => Number.isInteger(id) && id > 0)),
    );
    if (ids.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid catalog release IDs' });
      return;
    }

    const results: {
      itemId: number;
      title: string;
      systemName: string;
      releaseTags: string[];
      languages: string[];
      regions: string[];
      inspections: NonNullable<Awaited<ReturnType<typeof orchestrator.inspectItemArchive>>>[];
      error: string | null;
    }[] = [];

    for (const itemId of ids.slice(0, 100)) {
      const item = getRepositoryItemById(itemId);
      if (!item) {
        results.push({
          itemId,
          title: `#${itemId}`,
          systemName: '',
          releaseTags: [],
          languages: [],
          regions: [],
          inspections: [],
          error: 'Catalog item not found',
        });
        continue;
      }
      const availableFiles = item.files.filter((f) => f.status === 'downloaded' || f.status === 'skipped');
      if (availableFiles.length === 0) {
        results.push({
          itemId: item.id,
          title: item.title,
          systemName: item.systemName,
          releaseTags: item.releaseTags || [],
          languages: item.languages || [],
          regions: item.regions || [],
          inspections: [],
          error: 'No downloaded archive on disk yet',
        });
        continue;
      }
      const inspections: NonNullable<Awaited<ReturnType<typeof orchestrator.inspectItemArchive>>>[] = [];
      let itemErr: string | null = null;
      for (const file of availableFiles) {
        try {
          const insp = await orchestrator.inspectItemArchive(item.id, file.id);
          if (insp) inspections.push(insp);
        } catch (err) {
          itemErr = err instanceof Error ? err.message : String(err);
          logServer('HTTP', 'debug', `Batch inspect error for itemId=${item.id} fileId=${file.id} ("${file.filename}")`, formatErrorDetails(err));
        }
      }
      results.push({
        itemId: item.id,
        title: item.title,
        systemName: item.systemName,
        releaseTags: item.releaseTags || [],
        languages: item.languages || [],
        regions: item.regions || [],
        inspections,
        error: inspections.length === 0 ? (itemErr || 'Mirrored archive missing on disk') : null,
      });
    }

    res.json({ results });
  });

  app.get('/api/items/:id/download-rom', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }

    try {
      const ctx = orchestrator.resolveItemFileContext(itemId, fileId);
      if (!ctx) {
        res.status(404).json({ error: 'Mirrored ROM archive not found on disk' });
        return;
      }
      const inspection = await orchestrator.inspectItemArchive(itemId, fileId);
      if (!inspection || inspection.playableTargets.length === 0) {
        res.status(404).json({
          error: inspection?.patchOnly
            ? 'Archive contains patch files only; download the raw archive instead.'
            : 'No playable ROM files found inside archive.',
        });
        return;
      }

      const requestedTargetId = typeof req.query.targetId === 'string' ? req.query.targetId : undefined;
      const target =
        (requestedTargetId
          ? inspection.playableTargets.find((t) => t.id === requestedTargetId || t.primaryEntry === requestedTargetId)
          : undefined) || inspection.playableTargets[0];

      const customName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
      const cleanName = customName
        ? sanitizeFat32Filename(customName, ctx.cfg.romMaxFilenameLen)
        : target.kind === 'disc_set'
          ? target.suggestedArchiveName
          : target.suggestedFilename;

      orchestrator.recordServerAchievementCounter('prepared_downloads', 1, 'increment');
      if (target.kind === 'disc_set') {
        await streamCleanDiscZipToResponse(ctx.absPath, target.entryPaths, cleanName, res);
      } else {
        await streamExtractedEntryToResponse(ctx.absPath, target.primaryEntry, cleanName, res, target.sizeBytes);
      }
    } catch (err) {
      logServer('HTTP', 'debug', `Prepared ROM download error for itemId=${itemId} fileId=${fileId ?? 'default'}`, formatErrorDetails(err));
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  app.get('/api/items/:id/extract-entry', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    const entry = typeof req.query.entry === 'string' ? req.query.entry : '';
    const customName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!entry) {
      res.status(400).json({ error: 'Missing entry path' });
      return;
    }

    try {
      const ctx = orchestrator.resolveItemFileContext(itemId, fileId);
      if (!ctx) {
        logServer('HTTP', 'debug', `Extract-entry failed: archive missing on disk`, `itemId=${itemId}, fileId=${fileId ?? 'default'}, entry="${entry}"`);
        res.status(404).json({ error: 'Mirrored ROM archive not found on disk' });
        return;
      }
      const outName = customName || path.posix.basename(entry);
      await streamExtractedEntryToResponse(ctx.absPath, entry, outName, res);
    } catch (err) {
      logServer(
        'HTTP',
        'debug',
        `Extract-entry error for itemId=${itemId} fileId=${fileId ?? 'default'} entry="${entry}" outName="${customName || path.posix.basename(entry)}"`,
        formatErrorDetails(err),
      );
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  app.post('/api/items/:id/metadata', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    try {
      if (req.query.lazy === '1') {
        const item = await orchestrator.hydrateItemDetails(itemId);
        if (!item) {
          res.status(404).json({ error: 'Catalog item not found' });
          return;
        }
        res.json({ item });
        return;
      }
      if (req.query.upgradeAssets === '1') {
        const item = await orchestrator.ensureFullResItemAssets(itemId);
        if (!item) {
          res.status(404).json({ error: 'Catalog item not found' });
          return;
        }
        res.json({ item });
        return;
      }
      const item = await orchestrator.fetchItemMetadata(itemId, { forceRefreshAssets: true });
      res.json({ item });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/items/retry-failed', async (req, res) => {
    const rawSystem = typeof req.body?.system === 'string' ? req.body.system.trim() : undefined;
    const rawIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : undefined;
    const dryRun = Boolean(req.body?.dryRun ?? (req.query.dryRun === 'true'));
    if (Array.isArray(req.body?.ids) && (!rawIds || rawIds.length === 0)) {
      res.status(400).json({ error: 'Provide one or more valid catalog release IDs to retry' });
      return;
    }

    try {
      const run = await orchestrator.retryAllFailed({
        system: rawSystem && rawSystem !== 'all' ? rawSystem : undefined,
        itemIds: rawIds,
        dryRun,
      });
      res.status(202).json({ run });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusCode = /No failed or partial releases/i.test(msg) ? 400 : 409;
      res.status(statusCode).json({ error: msg });
    }
  });

  app.post('/api/items/:id/retry', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const rawFileId = req.query.fileId ?? req.body?.fileId;
    const fileId = rawFileId !== undefined ? Number(rawFileId) : undefined;
    if (fileId !== undefined && (!Number.isInteger(fileId) || fileId <= 0)) {
      res.status(400).json({ error: 'Invalid fileId' });
      return;
    }
    const dryRun = Boolean(req.body?.dryRun ?? (req.query.dryRun === 'true'));
    try {
      const run = await orchestrator.retryItem(itemId, fileId, { dryRun });
      res.status(202).json({ run });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/items/:id/download-queue', async (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    try {
      const result = await orchestrator.queueCatalogDownloads({ ids: [itemId] });
      if (result.queuedCount > 0) {
        orchestrator.recordServerAchievementCounter('on_demand_queued', result.queuedCount, 'increment');
      }
      res.status(202).json({
        ...result,
        skippedCount: result.queuedCount > 0 ? 0 : 1,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const statusCode = /No downloadable|already downloaded/i.test(msg) ? 400 : 409;
      res.status(statusCode).json({ error: msg });
    }
  });

  app.post('/api/items/installed', (req, res) => {
    const rawIds = Array.isArray(req.body?.ids)
      ? req.body.ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    if (rawIds.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid catalog item IDs' });
      return;
    }
    const installed = req.body?.installed !== false;
    const deviceLabel =
      typeof req.body?.deviceLabel === 'string' && req.body.deviceLabel.trim()
        ? req.body.deviceLabel.trim()
        : null;
    const rawFileId = Number(req.body?.installedFileId);
    const installedFileId = Number.isInteger(rawFileId) && rawFileId > 0 ? rawFileId : null;
    const installedFilename =
      typeof req.body?.installedFilename === 'string' && req.body.installedFilename.trim()
        ? req.body.installedFilename.trim().slice(0, 300)
        : null;

    let itemMeta: Record<number, { fileId?: number | null; filename?: string | null }> | undefined;
    if (req.body?.itemMeta && typeof req.body.itemMeta === 'object' && !Array.isArray(req.body.itemMeta)) {
      const sanitized: Record<number, { fileId?: number | null; filename?: string | null }> = {};
      for (const [key, val] of Object.entries(req.body.itemMeta as Record<string, unknown>)) {
        const idNum = Number(key);
        if (!Number.isInteger(idNum) || idNum <= 0 || !val || typeof val !== 'object') continue;
        const entry = val as Record<string, unknown>;
        const fid = Number(entry.fileId);
        sanitized[idNum] = {
          fileId: Number.isInteger(fid) && fid > 0 ? fid : null,
          filename:
            typeof entry.filename === 'string' && entry.filename.trim()
              ? entry.filename.trim().slice(0, 300)
              : null,
        };
      }
      if (Object.keys(sanitized).length > 0) {
        itemMeta = sanitized;
      }
    }

    const result = setCatalogItemsInstalled({
      ids: rawIds,
      installed,
      deviceLabel,
      installedFileId,
      installedFilename,
      itemMeta,
    });
    orchestrator.notifyInstalledStateChanged();
    res.json(result);
  });

  app.post('/api/items/favorite', (req, res) => {
    const rawIds: number[] = Array.isArray(req.body?.ids)
      ? Array.from(
          new Set<number>(
            req.body.ids
              .map(Number)
              .filter((id: number) => Number.isInteger(id) && id > 0),
          ),
        ).slice(0, 5000)
      : [];
    if (rawIds.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid catalog item IDs' });
      return;
    }
    const favorite = req.body?.favorite !== false;
    const result = setCatalogItemsFavorite({ ids: rawIds, favorite });
    orchestrator.notifyInstalledStateChanged();
    res.json(result);
  });

  app.post('/api/items/sync-override', (req, res) => {
    const rawIds: number[] = Array.isArray(req.body?.ids)
      ? Array.from(
          new Set<number>(
            req.body.ids
              .map(Number)
              .filter((id: number) => Number.isInteger(id) && id > 0),
          ),
        ).slice(0, 5000)
      : [];
    if (rawIds.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid catalog item IDs' });
      return;
    }
    const syncOverride = req.body?.syncOverride;
    if (syncOverride !== 'default' && syncOverride !== 'pin' && syncOverride !== 'ignore') {
      res.status(400).json({ error: "syncOverride must be 'default', 'pin', or 'ignore'" });
      return;
    }
    const result = setCatalogItemsSyncOverride({ ids: rawIds, syncOverride });
    orchestrator.notifyInstalledStateChanged();
    res.json(result);
  });

  // User Collections CRUD & membership
  app.get('/api/collections', (_req, res) => {
    res.json({ collections: listUserCollections() });
  });

  app.post('/api/collections', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      res.status(400).json({ error: 'Collection name must be between 1 and 80 characters' });
      return;
    }
    const description =
      typeof req.body?.description === 'string' ? req.body.description.trim().slice(0, 300) : null;
    try {
      const collection = createUserCollection({ name, description });
      res.status(201).json({ collection });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConflict = /UNIQUE constraint/i.test(msg);
      res.status(isConflict ? 409 : 400).json({
        error: isConflict ? `A collection named "${name}" already exists` : msg,
      });
    }
  });

  app.patch('/api/collections/:id', (req, res) => {
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ error: 'Invalid collection ID' });
      return;
    }
    const existing = getUserCollectionById(collectionId);
    if (!existing) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    const hasName = req.body?.name !== undefined;
    const hasDesc = req.body?.description !== undefined;
    const name = hasName ? (typeof req.body.name === 'string' ? req.body.name.trim() : '') : undefined;
    if (hasName && (!name || name.length > 80)) {
      res.status(400).json({ error: 'Collection name must be between 1 and 80 characters' });
      return;
    }
    const description = hasDesc
      ? typeof req.body.description === 'string'
        ? req.body.description.trim().slice(0, 300)
        : null
      : undefined;
    try {
      const collection = updateUserCollection(collectionId, { name, description });
      res.json({ collection });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConflict = /UNIQUE constraint/i.test(msg);
      res.status(isConflict ? 409 : 400).json({
        error: isConflict ? `A collection named "${name}" already exists` : msg,
      });
    }
  });

  app.delete('/api/collections/:id', (req, res) => {
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ error: 'Invalid collection ID' });
      return;
    }
    const deleted = deleteUserCollection(collectionId);
    if (!deleted) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json({ ok: true, id: collectionId });
  });

  app.post('/api/collections/:id/items', (req, res) => {
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ error: 'Invalid collection ID' });
      return;
    }
    const rawList = Array.isArray(req.body?.releaseIds)
      ? req.body.releaseIds
      : Array.isArray(req.body?.ids)
        ? req.body.ids
        : [];
    const releaseIds: number[] = Array.from(
      new Set<number>(
        rawList.map(Number).filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    ).slice(0, 5000);
    if (releaseIds.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid releaseIds to add' });
      return;
    }
    const result = addItemsToUserCollection(collectionId, releaseIds);
    if (!result.collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/collections/:id/items', (req, res) => {
    const collectionId = Number(req.params.id);
    if (!Number.isInteger(collectionId) || collectionId <= 0) {
      res.status(400).json({ error: 'Invalid collection ID' });
      return;
    }
    const rawList = Array.isArray(req.body?.releaseIds)
      ? req.body.releaseIds
      : Array.isArray(req.body?.ids)
        ? req.body.ids
        : [];
    const releaseIds: number[] = Array.from(
      new Set<number>(
        rawList.map(Number).filter((id: number) => Number.isInteger(id) && id > 0),
      ),
    ).slice(0, 5000);
    if (releaseIds.length === 0) {
      res.status(400).json({ error: 'Provide one or more valid releaseIds to remove' });
      return;
    }
    const result = removeItemsFromUserCollection(collectionId, releaseIds);
    if (!result.collection) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }
    res.json(result);
  });

  app.delete('/api/items', (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    if (ids.length === 0) {
      res.status(400).json({ error: 'Provide one or more item IDs to delete' });
      return;
    }
    res.json(orchestrator.deleteCatalogItems(ids));
  });

  app.delete('/api/items/:id', (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    res.json(orchestrator.deleteCatalogItems([itemId]));
  });

  // Local filesystem tree browser & deletion inside DOWNLOAD_DIR
  app.get('/api/fs/tree', (req, res) => {
    const subpath = typeof req.query.path === 'string' ? req.query.path : '';
    try {
      res.json(orchestrator.listFsTree(subpath));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/fs/archive', async (req, res) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    try {
      const result = await orchestrator.browseFsArchive(relPath);
      orchestrator.recordServerAchievementCounter('archive_inspections', 1, 'increment');
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/fs/archive/preview', async (req, res) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const entryPath = typeof req.query.entry === 'string' ? req.query.entry.trim() : '';
    if (!entryPath) {
      res.status(400).json({ error: 'Missing entry query parameter' });
      return;
    }
    try {
      const preview = await orchestrator.previewFsArchiveEntry(relPath, entryPath);
      res.json({ preview });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get('/api/fs/archive/entry', async (req, res) => {
    const relPath = typeof req.query.path === 'string' ? req.query.path : '';
    const entryPath = typeof req.query.entry === 'string' ? req.query.entry.trim() : '';
    if (!entryPath) {
      res.status(400).json({ error: 'Missing entry query parameter' });
      return;
    }
    try {
      const resolved = orchestrator.resolveFsArchivePath(relPath);
      const { entries } = await listArchiveEntries(resolved.absPath);
      const normalizedTarget = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
      const matched = entries.find(
        (e) => e.entryPath.replace(/\\/g, '/').replace(/^\/+/, '') === normalizedTarget,
      );
      if (!matched) {
        res.status(404).json({ error: 'Entry not found inside archive' });
        return;
      }
      const leafName = path.posix.basename(matched.entryPath) || 'archive-entry';
      await streamExtractedEntryToResponse(
        resolved.absPath,
        matched.entryPath,
        leafName,
        res,
        matched.sizeBytes,
      );
    } catch (err) {
      if (!res.headersSent) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  app.delete('/api/fs/entry', (req, res) => {
    const paths = Array.isArray(req.body?.paths)
      ? req.body.paths.map(String)
      : (typeof req.body?.path === 'string' ? [req.body.path] : []);
    if (paths.length === 0) {
      res.status(400).json({ error: 'Provide one or more relative paths to delete' });
      return;
    }
    try {
      res.json(orchestrator.deleteFsEntries(paths));
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Activity logs
  app.get('/api/logs', (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'all';
    const limit = Number(req.query.limit || 150);
    res.json({ logs: listActivityLogs(level, limit) });
  });

  app.post('/api/logs/debug', (req, res) => {
    if (!isDebugLoggingEnabled()) {
      res.status(204).end();
      return;
    }
    const scope = typeof req.body?.scope === 'string' && req.body.scope.trim() ? req.body.scope.trim().slice(0, 32) : 'CLIENT';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 400) : '';
    const detail = typeof req.body?.detail === 'string' && req.body.detail.trim() ? req.body.detail.trim().slice(0, 800) : null;
    if (!message) {
      res.status(400).json({ error: 'Missing debug log message' });
      return;
    }
    orchestrator.recordClientDebugLog(scope, message, detail);
    res.status(204).end();
  });

  app.delete('/api/logs', (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'all';
    const cleared = orchestrator.clearLogs(level);
    res.json({ ok: true, level, cleared });
  });

  // Configuration & credential verification
  app.get('/api/config', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ config: getPublicConfig() });
  });

  app.put('/api/config', (req, res) => {
    try {
      const body = (req.body || {}) as ConfigUpdateInput;
      const result = orchestrator.updateConfigurationWithMeta(body);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ config: result.config, liveSyncReload: result.liveSyncReload });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Secret-free Configuration Backup & Restore
  app.get('/api/backup/export', (_req, res) => {
    const config = getPublicConfig();
    const version = orchestrator.getStatusSnapshot().build.version || '1.0.0';
    const snapshot = buildConfigBackupSnapshot(config, version);
    const dateStamp = snapshot.exportedAt.slice(0, 10);
    const filename = `rgt-sync-backup-${dateStamp}.json`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', buildContentDispositionAttachment(filename).headerValue);
    res.status(200).send(`${JSON.stringify(snapshot, null, 2)}\n`);
  });

  app.post('/api/backup/import', (req, res) => {
    try {
      const current = getPublicConfig();
      const validation = parseAndValidateConfigBackup(req.body, current);
      if (!validation.valid) {
        res.status(400).json({ error: validation.error });
        return;
      }

      if (validation.appliedFields.length === 0) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
          ok: true,
          config: current,
          liveSyncReload: null,
          appliedFields: [],
          skippedEnvLocked: validation.skippedEnvLocked.map((item) => item.envVar),
          changesCount: 0,
        });
        return;
      }

      const result = orchestrator.updateConfigurationWithMeta(validation.patch);
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({
        ok: true,
        config: result.config,
        liveSyncReload: result.liveSyncReload,
        appliedFields: validation.appliedFields,
        skippedEnvLocked: validation.skippedEnvLocked.map((item) => item.envVar),
        changesCount: validation.changes.length,
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/auth/test', async (_req, res) => {
    try {
      const result = await orchestrator.testAuth();
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({
        success: false,
        statusCode: null,
        authenticated: false,
        cookieCount: 0,
        discoveredSystems: [],
        sampleReleaseUrls: [],
        message: err instanceof Error ? err.message : String(err),
        latencyMs: 0,
      });
    }
  });

  app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  // Frontend mounting: Vite middleware in development, static dist/ in production
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/healthz' || req.path === '/readyz' || req.path === '/metrics') {
        next();
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production bundle missing. Run npm run build.');
      }
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`RetroGameTalk Sync service listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'development'})`);
  });

  const handleSignal = async (signal: string) => {
    console.log(`Received ${signal}; shutting down gracefully...`);
    await orchestrator.shutdown();
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on('SIGTERM', () => void handleSignal('SIGTERM'));
  process.on('SIGINT', () => void handleSignal('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
