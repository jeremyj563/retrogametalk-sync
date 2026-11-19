import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { estimateDownloadHintsBytes, parseHumanFileSizeToBytes } from '../src/shared/fileSize.ts';
import type { ReleaseMetadata } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-decoupled-catalog-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
let dbMod: DbModule;

function makeMetadata(title: string, overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    wpPostId: 1001,
    wpPostType: 'post',
    title,
    subtitle: null,
    consoleName: 'Super Nintendo',
    publisher: 'Nintendo',
    developer: 'Nintendo',
    releaseYear: '1994',
    genres: ['Platformer'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    releaseTags: ['Retail ROM'],
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
    downloadHints: [{ filename: `${title}.zip`, fileSize: '480 MB' }],
    sourcePageUrl: `https://retrogametalk.com/repository/snes/${encodeURIComponent(title.toLowerCase())}/`,
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

test('fileSize helpers parse human-readable sizes and estimate download hints', () => {
  assert.equal(parseHumanFileSizeToBytes(null), 0);
  assert.equal(parseHumanFileSizeToBytes(''), 0);
  assert.equal(parseHumanFileSizeToBytes('1,024 B'), 1024);
  assert.equal(parseHumanFileSizeToBytes('480 MB'), 480 * 1024 * 1024);
  assert.equal(parseHumanFileSizeToBytes('1.2 GiB'), Math.round(1.2 * 1024 * 1024 * 1024));

  const total = estimateDownloadHintsBytes([
    { filename: 'disc1.chd', fileSize: '512 MB' },
    { filename: 'disc2.chd', fileSize: '1.5 GiB' },
    { filename: 'readme.txt', fileSize: 'unknown' },
  ]);
  assert.equal(total, 512 * 1024 * 1024 + Math.round(1.5 * 1024 * 1024 * 1024));
});

test('migration v18 applies cleanly with autoDownloadNewReleases default enabled', () => {
  const report = dbMod.getSchemaMigrationReport();
  assert.ok(report.currentVersion >= 18, `expected schema version >= 18, got ${report.currentVersion}`);

  const cfg = dbMod.getPublicConfig();
  assert.equal(cfg.autoDownloadNewReleases, true);
  assert.deepEqual(cfg.systemIndexState ?? {}, {});
});

test('upsertIndexedWpRelease creates available item and preserves downloaded status & real size on re-index', () => {
  const url = 'https://retrogametalk.com/repository/snes/chrono-trigger/';
  const initial = dbMod.upsertIndexedWpRelease({
    remoteUrl: url,
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeMetadata('Chrono Trigger', { wpPostId: 2001 }),
  });

  assert.equal(initial.status, 'available');
  assert.equal(initial.fileSizeBytes, 4 * 1024 * 1024);
  assert.equal(initial.sizeIsEstimated, true);

  // Transition release to downloaded with real disk size
  dbMod.upsertReleaseFile({
    releaseId: initial.id,
    remoteUrl: `${url}#file-1`,
    downloadUrl: 'https://cdn.example.com/chrono.zip',
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger', 'Chrono Trigger.zip'),
    filename: 'Chrono Trigger.zip',
    fileSizeBytes: 3_145_728,
    status: 'downloaded',
    downloadedAt: '2026-11-18T13:00:00Z',
  });

  const downloaded = dbMod.getCatalogReleaseById(initial.id)!;
  assert.equal(downloaded.status, 'downloaded');
  assert.equal(downloaded.fileSizeBytes, 3_145_728);
  assert.equal(downloaded.sizeIsEstimated, false);

  // Re-index same WP post with a larger estimate -> must NOT overwrite downloaded status or real bytes
  const reindexed = dbMod.upsertIndexedWpRelease({
    remoteUrl: url,
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger (Updated Metadata)',
    estimatedBytes: 9 * 1024 * 1024,
    metadata: makeMetadata('Chrono Trigger (Updated Metadata)', { wpPostId: 2001 }),
  });

  assert.equal(reindexed.status, 'downloaded');
  assert.equal(reindexed.fileSizeBytes, 3_145_728);
  assert.equal(reindexed.sizeIsEstimated, false);
  assert.equal(reindexed.title, 'Chrono Trigger (Updated Metadata)');
});

test('recomputeReleaseRollup keeps available rollup for un-downloaded files and computes partial/downloaded/failed', () => {
  const url = 'https://retrogametalk.com/repository/psx/xenogears/';
  const rel = dbMod.upsertIndexedWpRelease({
    remoteUrl: url,
    remotePath: '/repository/psx/xenogears/',
    localPath: path.join(tempDownloadDir, 'psx', 'xenogears'),
    systemName: 'psx',
    title: 'Xenogears',
    estimatedBytes: 900 * 1024 * 1024,
    metadata: makeMetadata('Xenogears', { wpPostId: 2002 }),
  });

  const availFile1 = dbMod.upsertReleaseFile({
    releaseId: rel.id,
    remoteUrl: `${url}#disc1`,
    downloadUrl: 'https://cdn.example.com/xeno1.chd',
    remotePath: '/repository/psx/xenogears/',
    localPath: path.join(tempDownloadDir, 'psx', 'xenogears', 'Xenogears (Disc 1).chd'),
    filename: 'Xenogears (Disc 1).chd',
    fileSizeBytes: 450 * 1024 * 1024,
    status: 'available',
  });
  dbMod.upsertReleaseFile({
    releaseId: rel.id,
    remoteUrl: `${url}#disc2`,
    downloadUrl: 'https://cdn.example.com/xeno2.chd',
    remotePath: '/repository/psx/xenogears/',
    localPath: path.join(tempDownloadDir, 'psx', 'xenogears', 'Xenogears (Disc 2).chd'),
    filename: 'Xenogears (Disc 2).chd',
    fileSizeBytes: 450 * 1024 * 1024,
    status: 'available',
  });
  assert.equal(dbMod.getCatalogReleaseById(rel.id)!.status, 'available');

  // Disc 1 downloads, Disc 2 still available -> partial
  dbMod.upsertReleaseFile({
    releaseId: rel.id,
    targetFileId: availFile1.file.id,
    remoteUrl: `${url}#disc1`,
    downloadUrl: 'https://cdn.example.com/xeno1.chd',
    remotePath: '/repository/psx/xenogears/',
    localPath: path.join(tempDownloadDir, 'psx', 'xenogears', 'Xenogears (Disc 1).chd'),
    filename: 'Xenogears (Disc 1).chd',
    fileSizeBytes: 450 * 1024 * 1024,
    status: 'downloaded',
    downloadedAt: '2026-11-18T13:15:00Z',
  });
  assert.equal(dbMod.getCatalogReleaseById(rel.id)!.status, 'partial');

  // Disc 2 downloads -> downloaded
  dbMod.upsertReleaseFile({
    releaseId: rel.id,
    remoteUrl: `${url}#disc2`,
    downloadUrl: 'https://cdn.example.com/xeno2.chd',
    remotePath: '/repository/psx/xenogears/',
    localPath: path.join(tempDownloadDir, 'psx', 'xenogears', 'Xenogears (Disc 2).chd'),
    filename: 'Xenogears (Disc 2).chd',
    fileSizeBytes: 450 * 1024 * 1024,
    status: 'downloaded',
    downloadedAt: '2026-11-18T13:20:00Z',
  });
  assert.equal(dbMod.getCatalogReleaseById(rel.id)!.status, 'downloaded');

  // Single-file failed release keeps failed rollup
  const failedRel = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/earthbound/',
    remotePath: '/repository/snes/earthbound/',
    localPath: path.join(tempDownloadDir, 'snes', 'earthbound'),
    systemName: 'snes',
    title: 'EarthBound',
    estimatedBytes: 3 * 1024 * 1024,
    metadata: makeMetadata('EarthBound', { wpPostId: 2003 }),
  });
  dbMod.upsertReleaseFile({
    releaseId: failedRel.id,
    remoteUrl: 'https://retrogametalk.com/repository/snes/earthbound/#file',
    downloadUrl: 'https://cdn.example.com/eb.zip',
    remotePath: '/repository/snes/earthbound/',
    localPath: path.join(tempDownloadDir, 'snes', 'earthbound', 'EarthBound.zip'),
    filename: 'EarthBound.zip',
    fileSizeBytes: 3 * 1024 * 1024,
    status: 'failed',
    errorMessage: 'HTTP 503',
  });
  assert.equal(dbMod.getCatalogReleaseById(failedRel.id)!.status, 'failed');
});

test('queryRepositoryItemIds and getCatalogTotalsAndSystems separate available, failed, and mirrored items', () => {
  const availGba = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gba/metroid-fusion/',
    remotePath: '/repository/gba/metroid-fusion/',
    localPath: path.join(tempDownloadDir, 'gba', 'metroid-fusion'),
    systemName: 'gba',
    title: 'Metroid Fusion',
    estimatedBytes: 8 * 1024 * 1024,
    metadata: makeMetadata('Metroid Fusion', { wpPostId: 2004 }),
  });

  const allQuery = dbMod.queryRepositoryItemIds({});
  // Catalog now holds: Chrono Trigger (snes, downloaded, 3_145_728), Xenogears (psx, downloaded, 900 MiB),
  // EarthBound (snes, failed, 3 MiB), Metroid Fusion (gba, available, 8 MiB)
  assert.equal(allQuery.total, 4);
  assert.equal(allQuery.alreadyDownloadedCount, 2);
  assert.equal(allQuery.downloadableIds.length, 2);
  assert.equal(allQuery.queueableIds.length, 2);
  assert.ok(allQuery.queueableIds.includes(availGba.id));
  assert.equal(allQuery.estimatedQueueBytes, 3 * 1024 * 1024 + 8 * 1024 * 1024);

  const availableOnly = dbMod.queryRepositoryItemIds({ status: 'available' });
  assert.deepEqual(availableOnly.ids, [availGba.id]);
  assert.deepEqual(availableOnly.queueableIds, [availGba.id]);
  assert.equal(availableOnly.alreadyDownloadedCount, 0);
  assert.equal(availableOnly.estimatedQueueBytes, 8 * 1024 * 1024);

  const snesOnly = dbMod.queryRepositoryItemIds({ system: 'snes' });
  assert.equal(snesOnly.total, 2);
  assert.equal(snesOnly.alreadyDownloadedCount, 1);
  assert.equal(snesOnly.queueableIds.length, 1);

  const summary = dbMod.getCatalogTotalsAndSystems();
  assert.equal(summary.totals.totalCatalogItems, 4);
  assert.equal(summary.totals.availableItems, 1);
  assert.equal(summary.totals.downloadedItems, 2);
  assert.equal(summary.totals.failedItems, 1);
  // Available items and failed items are excluded from totalBytesMirrored
  assert.equal(summary.totals.totalBytesMirrored, 3_145_728 + 900 * 1024 * 1024);

  const gbaSystem = summary.systems.find((s) => s.systemName === 'gba');
  assert.ok(gbaSystem, 'expected gba system breakdown');
  assert.equal(gbaSystem.availableItems, 1);
  assert.equal(gbaSystem.failedItems, 0);
  assert.equal(gbaSystem.totalBytes, 0);
});

test('markCatalogItemsQueuedDetailed deduplicates pending/in-flight & downloaded releases and queryRepositoryItemIds counts alreadyQueuedCount', () => {
  const freshN64 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/n64/f-zero-x/',
    remotePath: '/repository/n64/f-zero-x/',
    localPath: path.join(tempDownloadDir, 'n64', 'f-zero-x'),
    systemName: 'n64',
    title: 'F-Zero X',
    estimatedBytes: 16 * 1024 * 1024,
    metadata: makeMetadata('F-Zero X', { wpPostId: 2005 }),
  });

  const before = dbMod.queryRepositoryItemIds({});
  assert.equal(before.alreadyQueuedCount, 0);

  // First queue pass: mix of fresh available + already-downloaded items
  const allIds = before.ids;
  const firstPass = dbMod.markCatalogItemsQueuedDetailed(allIds, null);
  assert.ok(firstPass.queuedIds.includes(freshN64.id));
  assert.equal(firstPass.alreadyQueuedIds.length, 0);
  assert.equal(firstPass.alreadyDownloadedIds.length, 2);

  // Filtered preview now reports queued items separately from downloaded items
  const whileQueued = dbMod.queryRepositoryItemIds({});
  assert.equal(whileQueued.queueableIds.length, 0);
  assert.equal(whileQueued.alreadyQueuedCount, firstPass.queuedIds.length);
  assert.equal(whileQueued.alreadyDownloadedCount, 2);

  // Re-queueing the same selection while items are pending/in-flight skips all active IDs cleanly
  const activeOrPendingIds = new Set<number>(firstPass.queuedIds);
  const secondPass = dbMod.markCatalogItemsQueuedDetailed(allIds, null, { activeOrPendingIds });
  assert.equal(secondPass.queuedIds.length, 0);
  assert.equal(secondPass.alreadyQueuedIds.length, firstPass.queuedIds.length);
  assert.equal(secondPass.alreadyDownloadedIds.length, 2);
});
