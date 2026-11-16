import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  getPublicConfig,
  getRepositoryItemById,
  getSchemaMigrationReport,
  initDb,
  listActivityLogs,
  listSyncRuns,
  queryRepositoryItems,
} from './src/server/db.ts';
import { streamCleanDiscZipToResponse, streamExtractedEntryToResponse } from './src/server/archiveService.ts';
import { ScraperOrchestrator } from './src/server/orchestrator.ts';
import { sanitizeFat32Filename } from './src/shared/romNaming.ts';
import type { ConfigUpdateInput, RunMode } from './src/server/types.ts';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function bootstrap() {
  initDb();
  const orchestrator = new ScraperOrchestrator();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // Kubernetes liveness probe
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Kubernetes readiness probe (verifies SQLite + writable DOWNLOAD_DIR)
  app.get('/readyz', (_req, res) => {
    try {
      const snap = orchestrator.getStatusSnapshot();
      const schema = getSchemaMigrationReport();
      if (!snap.storage.writable) {
        res.status(503).json({ status: 'not_ready', reason: 'DOWNLOAD_DIR not writable' });
        return;
      }
      res.status(200).json({ status: 'ready', podId: snap.podId, schemaVersion: schema.currentVersion });
    } catch (err) {
      res.status(503).json({ status: 'not_ready', reason: String(err) });
    }
  });

  // Prometheus metrics endpoint
  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(orchestrator.getPrometheusMetrics());
  });

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

    orchestrator.on('status', onStatus);
    orchestrator.on('log', onLog);
    orchestrator.on('transfer', onTransfer);
    orchestrator.on('catalog_updated', onCatalogUpdated);
    orchestrator.on('logs_cleared', onLogsCleared);
    orchestrator.on('runs_cleared', onRunsCleared);

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
    });
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

  app.post('/api/runs/start', async (req, res) => {
    const requestedMode = String(req.body?.mode || 'incremental') as RunMode;
    const mode: RunMode = ['incremental', 'full', 'dry_run'].includes(requestedMode)
      ? requestedMode
      : 'incremental';

    try {
      const run = await orchestrator.startRun('manual', mode);
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

  // Repository catalog, metadata, local assets, download & retry
  app.get('/api/items', (req, res) => {
    const result = queryRepositoryItems({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      system: parseQueryFilterParam(req.query.system),
      status: parseQueryFilterParam(req.query.status),
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

  app.get('/api/items/:id/asset', (req, res) => {
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: 'Invalid item ID' });
      return;
    }
    const kind = req.query.kind === 'screenshot' ? 'screenshot' : 'cover';
    const index = Number(req.query.index || 0);
    const asset = orchestrator.resolveItemAssetFile(itemId, kind, Number.isNaN(index) ? 0 : index);
    if (!asset) {
      res.status(404).json({ error: 'Artwork asset not found locally' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
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
      res.status(404).json({ error: 'Mirrored ROM archive not found on disk' });
      return;
    }
    res.download(rom.absPath, rom.filename);
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
        res.status(404).json({ error: 'Mirrored archive not found on disk' });
        return;
      }
      res.json({ inspection });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
      inspections: Awaited<ReturnType<typeof orchestrator.inspectItemArchive>>[];
      error: string | null;
    }[] = [];

    for (const itemId of ids.slice(0, 100)) {
      const item = getRepositoryItemById(itemId);
      if (!item) {
        results.push({ itemId, title: `#${itemId}`, systemName: '', inspections: [], error: 'Catalog item not found' });
        continue;
      }
      const availableFiles = item.files.filter((f) => f.status === 'downloaded' || f.status === 'skipped');
      if (availableFiles.length === 0) {
        results.push({
          itemId: item.id,
          title: item.title,
          systemName: item.systemName,
          inspections: [],
          error: 'No downloaded archive on disk yet',
        });
        continue;
      }
      const inspections = [];
      let itemErr: string | null = null;
      for (const file of availableFiles) {
        try {
          const insp = await orchestrator.inspectItemArchive(item.id, file.id);
          if (insp) inspections.push(insp);
        } catch (err) {
          itemErr = err instanceof Error ? err.message : String(err);
        }
      }
      results.push({
        itemId: item.id,
        title: item.title,
        systemName: item.systemName,
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

      if (target.kind === 'disc_set') {
        await streamCleanDiscZipToResponse(ctx.absPath, target.entryPaths, cleanName, res);
      } else {
        await streamExtractedEntryToResponse(ctx.absPath, target.primaryEntry, cleanName, res, target.sizeBytes);
      }
    } catch (err) {
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
        res.status(404).json({ error: 'Mirrored ROM archive not found on disk' });
        return;
      }
      const outName = customName || path.posix.basename(entry);
      await streamExtractedEntryToResponse(ctx.absPath, entry, outName, res);
    } catch (err) {
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
      const item = await orchestrator.fetchItemMetadata(itemId);
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
    if (Array.isArray(req.body?.ids) && (!rawIds || rawIds.length === 0)) {
      res.status(400).json({ error: 'Provide one or more valid catalog release IDs to retry' });
      return;
    }

    try {
      const run = await orchestrator.retryAllFailed({
        system: rawSystem && rawSystem !== 'all' ? rawSystem : undefined,
        itemIds: rawIds,
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
    try {
      const run = await orchestrator.retryItem(itemId, fileId);
      res.status(202).json({ run });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
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

  app.delete('/api/logs', (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'all';
    const cleared = orchestrator.clearLogs(level);
    res.json({ ok: true, level, cleared });
  });

  // Configuration & credential verification
  app.get('/api/config', (_req, res) => {
    res.json({ config: getPublicConfig() });
  });

  app.put('/api/config', (req, res) => {
    try {
      const body = (req.body || {}) as ConfigUpdateInput;
      const updated = orchestrator.updateConfiguration(body);
      res.json({ config: updated });
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
