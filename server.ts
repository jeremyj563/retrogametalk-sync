import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {
  getPublicConfig,
  getRepositoryItemById,
  initDb,
  listActivityLogs,
  listSyncRuns,
  queryRepositoryItems,
} from './src/server/db.ts';
import { ScraperOrchestrator } from './src/server/orchestrator.ts';
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
      if (!snap.storage.writable) {
        res.status(503).json({ status: 'not_ready', reason: 'DOWNLOAD_DIR not writable' });
        return;
      }
      res.status(200).json({ status: 'ready', podId: snap.podId });
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
    const onLogsCleared = (payload: unknown) => sendEvent('logs_cleared', payload);
    const onRunsCleared = (payload: unknown) => sendEvent('runs_cleared', payload);

    orchestrator.on('status', onStatus);
    orchestrator.on('log', onLog);
    orchestrator.on('transfer', onTransfer);
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

  // Repository catalog, metadata, local assets, download & retry
  app.get('/api/items', (req, res) => {
    const result = queryRepositoryItems({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      system: typeof req.query.system === 'string' ? req.query.system : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
      genre: typeof req.query.genre === 'string' ? req.query.genre : undefined,
      region: typeof req.query.region === 'string' ? req.query.region : undefined,
      language: typeof req.query.language === 'string' ? req.query.language : undefined,
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
