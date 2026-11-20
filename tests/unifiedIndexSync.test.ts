import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  DEFAULT_INDEX_STALE_MS,
  classifySystemIndexFreshness,
  doesCatalogReleaseMatchSyncRules,
  formatSyncRuleScopeSummary,
  normalizeTargetConsoleSlugs,
  resolveTargetConsoleScope,
} from '../src/shared/syncRuleMatcher.ts';
import type { ReleaseMetadata, SyncRunSummarySnapshot } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-unified-sync-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
let dbMod: DbModule;

function makeMetadata(
  title: string,
  consoleName: string,
  releaseTags: string[],
  overrides: Partial<ReleaseMetadata> = {},
): ReleaseMetadata {
  return {
    wpPostId: 3001,
    wpPostType: 'post',
    title,
    subtitle: null,
    consoleName,
    publisher: 'Nintendo',
    developer: 'Nintendo',
    releaseYear: '1995',
    genres: ['Action'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    releaseTags,
    downloadsCount: null,
    releasedAgo: null,
    updatedDate: null,
    publishedAt: '2026-11-18T12:00:00Z',
    remoteUpdatedAt: '2026-11-18T12:00:00Z',
    specs: [],
    descriptionHtml: '',
    descriptionText: '',
    coverUrl: 'https://example.com/cover.jpg',
    coverLocalRelPath: null,
    screenshotUrls: [],
    screenshotLocalRelPaths: [],
    downloadHints: [{ filename: `${title}.zip`, fileSize: '64 MB' }],
    sourcePageUrl: `https://retrogametalk.com/repository/${consoleName}/${encodeURIComponent(title.toLowerCase().replace(/\s+/g, '-'))}/`,
    fetchedAt: '2026-11-18T12:00:00Z',
    ...overrides,
  };
}

before(async () => {
  fs.mkdirSync(tempDataDir, { recursive: true });
  fs.mkdirSync(tempDownloadDir, { recursive: true });
  dbMod = await import('../src/server/db.ts');
  dbMod.initDb();
});

after(() => {
  try {
    dbMod.initDb().close();
  } catch {
    // ignore close errors during test teardown
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('syncRuleMatcher normalizes console aliases, release types, child file roles, and index freshness', () => {
  assert.deepEqual(normalizeTargetConsoleSlugs('snes, gba, gb-roms, '), ['gameboy-roms', 'gba', 'snes']);
  assert.deepEqual(resolveTargetConsoleScope('', ['gba', 'psx', 'snes']), ['gba', 'psx', 'snes']);
  assert.deepEqual(resolveTargetConsoleScope('snes', ['gba', 'psx', 'snes']), ['snes']);

  const nowMs = Date.parse('2026-11-19T18:00:00Z');
  const freshAt = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
  const staleAt = new Date(nowMs - DEFAULT_INDEX_STALE_MS - 60_000).toISOString();

  const freshness = classifySystemIndexFreshness(
    ['snes', 'gba', 'psx', 'n64'],
    {
      snes: { lastIndexedAt: freshAt, fullyIndexed: true },
      gba: { lastIndexedAt: staleAt, fullyIndexed: true },
      psx: { lastIndexedAt: freshAt, fullyIndexed: false },
    },
    nowMs,
  );
  assert.deepEqual(freshness.fresh, ['snes']);
  assert.deepEqual(freshness.stale, ['gba']);
  assert.deepEqual(freshness.unindexed, ['psx', 'n64']);
  assert.equal(freshness.oldestIndexedAt, staleAt);

  // Release matching: console + release type + child file role fallback
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      { systemName: 'snes', releaseType: 'Retail ROM', releaseTags: ['Retail ROM'] },
      { systemFilter: 'snes,gba', allowedReleaseTypes: ['retail'] },
    ),
    true,
  );
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      { systemName: 'snes', releaseType: 'Hack', releaseTags: ['Hack'] },
      { systemFilter: 'snes,gba', allowedReleaseTypes: ['retail'] },
    ),
    false,
  );
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'gba',
        releaseType: 'Other',
        releaseTags: ['Other'],
        fileRoles: ['Translation'],
      },
      { systemFilter: 'snes,gba', allowedReleaseTypes: ['translation'] },
    ),
    true,
  );
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      { systemName: 'psx', releaseType: 'Retail ROM', releaseTags: ['Retail ROM'] },
      { systemFilter: 'snes,gba', allowedReleaseTypes: ['retail'] },
    ),
    false,
  );

  const label = formatSyncRuleScopeSummary('snes,gba', ['retail']);
  assert.ok(label.includes('gba, snes'));
  assert.ok(label.includes('Retail Only'));
});

test('migration v20 persists structured SyncRunSummarySnapshot on sync_runs', () => {
  const report = dbMod.getSchemaMigrationReport();
  assert.ok(report.currentVersion >= 20, `expected schema version >= 20, got ${report.currentVersion}`);

  const run = dbMod.createSyncRun('manual', 'full', true);
  const snapshot: SyncRunSummarySnapshot = {
    strategy: 'index_first',
    ruleScopeLabel: 'snes, gba · Retail ROMs',
    totalRuleMatched: 12,
    wouldDownloadCount: 4,
    alreadyOnDiskCount: 8,
    excludedByRulesCount: 3,
    estimatedDownloadBytes: 256 * 1024 * 1024,
    refreshedConsoles: ['gba'],
    newDeltaDiscoveredCount: 1,
    consoleBreakdown: [
      { systemName: 'snes', pendingCount: 2, estimatedBytes: 128 * 1024 * 1024 },
      { systemName: 'gba', pendingCount: 2, estimatedBytes: 128 * 1024 * 1024 },
    ],
    sampleReleases: [
      {
        id: 1,
        title: 'Super Metroid',
        systemName: 'snes',
        releaseType: 'Retail ROM',
        fileSizeBytes: 64 * 1024 * 1024,
        status: 'available',
      },
    ],
  };

  dbMod.updateSyncRun(run.id, {
    status: 'completed',
    finishedAt: '2026-11-19T18:05:00Z',
    downloadedCount: 0,
    skippedCount: 8,
    summary: snapshot,
  });

  const stored = dbMod.getSyncRunById(run.id);
  assert.ok(stored);
  assert.deepEqual(stored.summary, snapshot);
  const recent = dbMod.listSyncRuns(5).find((r) => r.id === run.id);
  assert.deepEqual(recent?.summary, snapshot);
});

test('Catalog syncRules query, facets, listCatalogReleasesForRuleSync, and computeSyncPreflightSummary share 100% rule parity', () => {
  dbMod.saveDiscoveredSystems(['snes', 'gba', 'psx']);
  dbMod.updateConfig({
    systemFilter: 'snes,gba',
    allowedReleaseTypes: ['retail'],
    autoDownloadNewReleases: true,
  });

  const nowIso = new Date().toISOString();
  const staleIso = new Date(Date.now() - DEFAULT_INDEX_STALE_MS - 3600_000).toISOString();
  dbMod.updateSystemIndexCursor('snes', {
    lastIndexedAt: nowIso,
    totalWpPosts: 2,
    totalPages: 1,
    pagesIndexed: 1,
    fullyIndexed: true,
    scope: 'filtered',
  });
  dbMod.updateSystemIndexCursor('gba', {
    lastIndexedAt: staleIso,
    totalWpPosts: 1,
    totalPages: 1,
    pagesIndexed: 1,
    fullyIndexed: true,
    scope: 'filtered',
  });

  // 1. SNES Retail Available (rule match, pending)
  const snesRetailAvail = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/yoshis-island/',
    remotePath: '/repository/snes/yoshis-island/',
    localPath: path.join(tempDownloadDir, 'snes', 'yoshis-island'),
    systemName: 'snes',
    title: "Yoshi's Island",
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeMetadata("Yoshi's Island", 'snes', ['Retail ROM'], { wpPostId: 4001 }),
  });

  // 2. SNES Retail Downloaded (rule match, on disk)
  const snesRetailDone = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/super-metroid/',
    remotePath: '/repository/snes/super-metroid/',
    localPath: path.join(tempDownloadDir, 'snes', 'super-metroid'),
    systemName: 'snes',
    title: 'Super Metroid',
    estimatedBytes: 3 * 1024 * 1024,
    metadata: makeMetadata('Super Metroid', 'snes', ['Retail ROM'], { wpPostId: 4002 }),
  });
  dbMod.upsertReleaseFile({
    releaseId: snesRetailDone.id,
    remoteUrl: 'https://retrogametalk.com/repository/snes/super-metroid/#rom',
    downloadUrl: 'https://cdn.example.com/sm.zip',
    remotePath: '/repository/snes/super-metroid/',
    localPath: path.join(tempDownloadDir, 'snes', 'super-metroid', 'Super Metroid.zip'),
    filename: 'Super Metroid.zip',
    fileSizeBytes: 3_145_728,
    status: 'downloaded',
    downloadedAt: nowIso,
  });

  // 3. GBA Retail Failed (rule match, retryable pending)
  const gbaRetailFailed = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gba/golden-sun/',
    remotePath: '/repository/gba/golden-sun/',
    localPath: path.join(tempDownloadDir, 'gba', 'golden-sun'),
    systemName: 'gba',
    title: 'Golden Sun',
    estimatedBytes: 8 * 1024 * 1024,
    metadata: makeMetadata('Golden Sun', 'gba', ['Retail ROM'], { wpPostId: 4003 }),
  });
  dbMod.upsertReleaseFile({
    releaseId: gbaRetailFailed.id,
    remoteUrl: 'https://retrogametalk.com/repository/gba/golden-sun/#rom',
    downloadUrl: 'https://cdn.example.com/gs.zip',
    remotePath: '/repository/gba/golden-sun/',
    localPath: path.join(tempDownloadDir, 'gba', 'golden-sun', 'Golden Sun.zip'),
    filename: 'Golden Sun.zip',
    fileSizeBytes: 8 * 1024 * 1024,
    status: 'failed',
    errorMessage: 'timeout',
  });

  // 4. SNES ROM Hack (excluded by release type rule)
  dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/kaizo-mario/',
    remotePath: '/repository/snes/kaizo-mario/',
    localPath: path.join(tempDownloadDir, 'snes', 'kaizo-mario'),
    systemName: 'snes',
    title: 'Kaizo Mario World',
    estimatedBytes: 2 * 1024 * 1024,
    metadata: makeMetadata('Kaizo Mario World', 'snes', ['Hack'], { wpPostId: 4004 }),
  });

  // 5. PSX Retail (excluded by target console filter)
  dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/psx/ridge-racer/',
    remotePath: '/repository/psx/ridge-racer/',
    localPath: path.join(tempDownloadDir, 'psx', 'ridge-racer'),
    systemName: 'psx',
    title: 'Ridge Racer',
    estimatedBytes: 300 * 1024 * 1024,
    metadata: makeMetadata('Ridge Racer', 'psx', ['Retail ROM'], { wpPostId: 4005 }),
  });

  // Catalog queries with syncRules=true must match exact 3 items (Yoshi's Island, Super Metroid, Golden Sun)
  const itemsPage = dbMod.queryRepositoryItems({ syncRules: true, limit: 50, offset: 0 });
  assert.equal(itemsPage.total, 3);
  assert.equal(itemsPage.facets.counts?.syncRulesMatched, 3);

  // When combined with downloaded: 'exclude', only the 2 pending rule matches appear
  const pendingIds = dbMod.queryRepositoryItemIds({ syncRules: true, downloaded: 'exclude' });
  assert.equal(pendingIds.total, 2);
  assert.deepEqual(new Set(pendingIds.queueableIds), new Set([snesRetailAvail.id, gbaRetailFailed.id]));

  // Rule sync list returns exact same 3 items
  const forRuleSync = dbMod.listCatalogReleasesForRuleSync();
  assert.equal(forRuleSync.totalCataloged, 5);
  assert.equal(forRuleSync.excludedByRulesCount, 2);
  assert.equal(forRuleSync.matched.length, 3);

  // Pre-flight summary matches catalog + indexer freshness state
  const preflight = dbMod.computeSyncPreflightSummary();
  assert.equal(preflight.totalCataloged, 5);
  assert.equal(preflight.totalRuleMatched, 3);
  assert.equal(preflight.pendingDownloadCount, 2);
  assert.equal(preflight.availablePendingCount, 1);
  assert.equal(preflight.retryablePendingCount, 1);
  assert.equal(preflight.alreadyDownloadedCount, 1);
  assert.equal(preflight.excludedByRulesCount, 2);
  assert.equal(preflight.estimatedPendingBytes, 4 * 1024 * 1024 + 8 * 1024 * 1024);
  assert.deepEqual(preflight.freshConsoles, ['snes']);
  assert.deepEqual(preflight.staleConsoles, ['gba']);
  assert.deepEqual(preflight.unindexedConsoles, []);
  assert.equal(preflight.topPendingConsoles.length, 2);
  assert.equal(preflight.samplePendingReleases.length, 2);
});
