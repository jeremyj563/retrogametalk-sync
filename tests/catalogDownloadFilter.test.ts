import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  migrateLegacyCatalogDownloadPrefs,
  sanitizeStoredDownloadedFilter,
  toggleCatalogDownloadedFilter,
} from '../src/shared/catalogDownloadFilter.ts';
import type { ReleaseMetadata } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-catalog-dl-filter-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
let dbMod: DbModule;

function makeMeta(title: string, systemSlug: string, wpPostId: number): ReleaseMetadata {
  return {
    wpPostId,
    wpPostType: 'post',
    title,
    subtitle: null,
    consoleName: systemSlug.toUpperCase(),
    publisher: 'Nintendo',
    developer: 'Nintendo',
    releaseYear: '1994',
    genres: ['Action'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    releaseTags: ['Retail ROM'],
    downloadsCount: null,
    releasedAgo: null,
    updatedDate: null,
    publishedAt: '2026-11-10T10:00:00Z',
    remoteUpdatedAt: '2026-11-10T10:00:00Z',
    specs: [],
    descriptionHtml: '',
    descriptionText: '',
    coverUrl: null,
    coverLocalRelPath: null,
    screenshotUrls: [],
    screenshotLocalRelPaths: [],
    downloadHints: [],
    sourcePageUrl: `https://retrogametalk.com/repository/${systemSlug}/${encodeURIComponent(title.toLowerCase())}/`,
    fetchedAt: '2026-11-10T10:00:00Z',
  };
}

before(async () => {
  fs.mkdirSync(tempDataDir, { recursive: true });
  fs.mkdirSync(tempDownloadDir, { recursive: true });
  dbMod = await import('../src/server/db.ts');
  const database = dbMod.initDb();

  // SNES: 1 downloaded (installed), 1 skipped (counted as downloaded), 1 available, 1 failed
  const snesDownloaded = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/chrono-trigger/',
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeMeta('Chrono Trigger', 'snes', 4001),
  });
  dbMod.upsertReleaseFile({
    releaseId: snesDownloaded.id,
    remoteUrl: 'https://retrogametalk.com/repository/snes/chrono-trigger/#f1',
    downloadUrl: 'https://cdn.example.com/ct.zip',
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger', 'ct.zip'),
    filename: 'ct.zip',
    fileSizeBytes: 4 * 1024 * 1024,
    status: 'downloaded',
    downloadedAt: '2026-11-12T10:00:00Z',
  });
  dbMod.setCatalogItemsInstalled({
    ids: [snesDownloaded.id],
    installed: true,
    deviceLabel: 'Analogue Pocket',
  });

  const snesSkipped = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/earthbound/',
    remotePath: '/repository/snes/earthbound/',
    localPath: path.join(tempDownloadDir, 'snes', 'earthbound'),
    systemName: 'snes',
    title: 'EarthBound',
    estimatedBytes: 3 * 1024 * 1024,
    metadata: makeMeta('EarthBound', 'snes', 4002),
  });
  database.prepare("UPDATE catalog_releases SET status = 'skipped' WHERE id = ?").run(snesSkipped.id);

  dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/yoshis-island/',
    remotePath: '/repository/snes/yoshis-island/',
    localPath: path.join(tempDownloadDir, 'snes', 'yoshis-island'),
    systemName: 'snes',
    title: "Yoshi's Island",
    estimatedBytes: 2 * 1024 * 1024,
    metadata: makeMeta("Yoshi's Island", 'snes', 4003),
  });

  const snesFailed = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/star-fox/',
    remotePath: '/repository/snes/star-fox/',
    localPath: path.join(tempDownloadDir, 'snes', 'star-fox'),
    systemName: 'snes',
    title: 'Star Fox',
    estimatedBytes: 1 * 1024 * 1024,
    metadata: makeMeta('Star Fox', 'snes', 4004),
  });
  dbMod.upsertReleaseFile({
    releaseId: snesFailed.id,
    remoteUrl: 'https://retrogametalk.com/repository/snes/star-fox/#f1',
    downloadUrl: 'https://cdn.example.com/sf.zip',
    remotePath: '/repository/snes/star-fox/',
    localPath: path.join(tempDownloadDir, 'snes', 'star-fox', 'sf.zip'),
    filename: 'sf.zip',
    fileSizeBytes: 1 * 1024 * 1024,
    status: 'failed',
    errorMessage: 'HTTP 503',
  });

  // GBA: 1 partial, 1 queued, 1 downloading
  const gbaPartial = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gba/golden-sun/',
    remotePath: '/repository/gba/golden-sun/',
    localPath: path.join(tempDownloadDir, 'gba', 'golden-sun'),
    systemName: 'gba',
    title: 'Golden Sun',
    estimatedBytes: 8 * 1024 * 1024,
    metadata: makeMeta('Golden Sun', 'gba', 4005),
  });
  database.prepare("UPDATE catalog_releases SET status = 'partial' WHERE id = ?").run(gbaPartial.id);

  const gbaQueued = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gba/metroid-fusion/',
    remotePath: '/repository/gba/metroid-fusion/',
    localPath: path.join(tempDownloadDir, 'gba', 'metroid-fusion'),
    systemName: 'gba',
    title: 'Metroid Fusion',
    estimatedBytes: 8 * 1024 * 1024,
    metadata: makeMeta('Metroid Fusion', 'gba', 4006),
  });
  database.prepare("UPDATE catalog_releases SET status = 'queued' WHERE id = ?").run(gbaQueued.id);

  const gbaDownloading = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gba/minish-cap/',
    remotePath: '/repository/gba/minish-cap/',
    localPath: path.join(tempDownloadDir, 'gba', 'minish-cap'),
    systemName: 'gba',
    title: 'The Minish Cap',
    estimatedBytes: 8 * 1024 * 1024,
    metadata: makeMeta('The Minish Cap', 'gba', 4007),
  });
  database.prepare("UPDATE catalog_releases SET status = 'downloading' WHERE id = ?").run(gbaDownloading.id);
});

after(() => {
  try {
    dbMod.initDb().close();
  } catch {
    // ignore teardown error
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('toggleCatalogDownloadedFilter and sanitizeStoredDownloadedFilter toggle cleanly', () => {
  assert.equal(sanitizeStoredDownloadedFilter('only'), 'only');
  assert.equal(sanitizeStoredDownloadedFilter('exclude'), 'exclude');
  assert.equal(sanitizeStoredDownloadedFilter('other'), 'all');

  assert.equal(toggleCatalogDownloadedFilter('all', 'only'), 'only');
  assert.equal(toggleCatalogDownloadedFilter('only', 'only'), 'all');
  assert.equal(toggleCatalogDownloadedFilter('only', 'exclude'), 'exclude');
  assert.equal(toggleCatalogDownloadedFilter('exclude', 'exclude'), 'all');
  assert.equal(toggleCatalogDownloadedFilter('exclude', 'only'), 'only');
});

test('migrateLegacyCatalogDownloadPrefs upgrades legacy status-array presets and strips retired status values', () => {
  assert.deepEqual(migrateLegacyCatalogDownloadPrefs(['downloaded'], undefined), {
    downloadedFilter: 'only',
    statuses: [],
  });

  assert.deepEqual(
    migrateLegacyCatalogDownloadPrefs(
      ['available', 'partial', 'failed', 'queued', 'downloading'],
      undefined,
    ),
    {
      downloadedFilter: 'exclude',
      statuses: [],
    },
  );

  assert.deepEqual(migrateLegacyCatalogDownloadPrefs(['available', 'failed'], undefined), {
    downloadedFilter: 'exclude',
    statuses: ['failed'],
  });

  assert.deepEqual(migrateLegacyCatalogDownloadPrefs(['downloaded', 'needs_retry'], 'exclude'), {
    downloadedFilter: 'exclude',
    statuses: ['needs_retry'],
  });
});

test('queryRepositoryItems filters by downloaded=only/exclude and computes context-aware downloaded facets', () => {
  const allRes = dbMod.queryRepositoryItems({ limit: 50, offset: 0 });
  assert.equal(allRes.total, 7);
  assert.deepEqual(allRes.facets.counts?.downloaded, {
    downloaded: 2,
    notDownloaded: 5,
  });

  const onlyDownloaded = dbMod.queryRepositoryItems({
    downloaded: 'only',
    limit: 50,
    offset: 0,
  });
  assert.equal(onlyDownloaded.total, 2);
  assert.deepEqual(onlyDownloaded.facets.counts?.downloaded, {
    downloaded: 2,
    notDownloaded: 5,
  });

  const notDownloaded = dbMod.queryRepositoryItems({
    downloaded: 'exclude',
    limit: 50,
    offset: 0,
  });
  assert.equal(notDownloaded.total, 5);
  assert.deepEqual(notDownloaded.facets.counts?.downloaded, {
    downloaded: 2,
    notDownloaded: 5,
  });

  // Combining Not Downloaded with granular Status (e.g. failed) narrows items while preserving full downloaded facets
  const notDlFailed = dbMod.queryRepositoryItems({
    downloaded: 'exclude',
    status: ['failed'],
    limit: 50,
    offset: 0,
  });
  assert.equal(notDlFailed.total, 1);
  assert.equal(notDlFailed.items[0]?.title, 'Star Fox');
  assert.deepEqual(notDlFailed.facets.counts?.downloaded, {
    downloaded: 2,
    notDownloaded: 5,
  });

  // Filtering by system=snes scopes downloaded facet counts to SNES only (2 downloaded, 2 notDownloaded)
  const snesFiltered = dbMod.queryRepositoryItems({
    system: ['snes'],
    downloaded: 'only',
    limit: 50,
    offset: 0,
  });
  assert.equal(snesFiltered.total, 2);
  assert.deepEqual(snesFiltered.facets.counts?.downloaded, {
    downloaded: 2,
    notDownloaded: 2,
  });

  // Combining system=snes with installed=exclude excludes Chrono Trigger -> 1 downloaded (EarthBound skipped), 2 notDownloaded
  const snesNotInstalled = dbMod.queryRepositoryItems({
    system: ['snes'],
    installed: 'exclude',
    limit: 50,
    offset: 0,
  });
  assert.equal(snesNotInstalled.total, 3);
  assert.deepEqual(snesNotInstalled.facets.counts?.downloaded, {
    downloaded: 1,
    notDownloaded: 2,
  });
});

test('installed_desc sort orders recently installed games first and respects per-device install timestamps', async () => {
  const { CATALOG_SORT_OPTIONS, normalizeCatalogSort } = await import('../src/shared/catalogSort.ts');
  assert.equal(normalizeCatalogSort('installed_desc'), 'installed_desc');
  assert.ok(
    CATALOG_SORT_OPTIONS.some(
      (opt) => opt.value === 'installed_desc' && opt.label === 'Sort: Recently Installed',
    ),
  );

  const database = dbMod.initDb();
  const rows = database
    .prepare('SELECT id, title FROM catalog_releases')
    .all() as { id: number; title: string }[];
  const byTitle = new Map(rows.map((r) => [r.title, r.id]));
  const chronoId = byTitle.get('Chrono Trigger')!;
  const earthboundId = byTitle.get('EarthBound')!;
  const yoshiId = byTitle.get("Yoshi's Island")!;

  const devA = dbMod.upsertStorageDeviceProfileOnMount({
    id: 'dev_miyoo',
    name: 'MIYOO_256GB',
    volumeLabel: 'MIYOO_256GB',
  });
  const devB = dbMod.upsertStorageDeviceProfileOnMount({
    id: 'dev_deck',
    name: 'STEAM_DECK',
    volumeLabel: 'STEAM_DECK',
  });

  // Device A installs: Chrono Trigger (older), EarthBound (newest on A)
  dbMod.setCatalogItemsInstalled({
    ids: [chronoId],
    installed: true,
    deviceId: devA.id,
    deviceLabel: devA.name,
  });
  dbMod.setCatalogItemsInstalled({
    ids: [earthboundId],
    installed: true,
    deviceId: devA.id,
    deviceLabel: devA.name,
  });
  // Device B installs: Yoshi's Island (newest overall), Chrono Trigger (middle)
  dbMod.setCatalogItemsInstalled({
    ids: [chronoId, yoshiId],
    installed: true,
    deviceId: devB.id,
    deviceLabel: devB.name,
  });

  // Set deterministic timestamps to test exact ordering
  database
    .prepare(
      'UPDATE catalog_release_device_installs SET installed_at = ? WHERE release_id = ? AND device_id = ?',
    )
    .run('2026-11-20T10:00:00.000Z', chronoId, devA.id);
  database
    .prepare(
      'UPDATE catalog_release_device_installs SET installed_at = ? WHERE release_id = ? AND device_id = ?',
    )
    .run('2026-11-22T10:00:00.000Z', earthboundId, devA.id);
  database
    .prepare(
      'UPDATE catalog_release_device_installs SET installed_at = ? WHERE release_id = ? AND device_id = ?',
    )
    .run('2026-11-23T10:00:00.000Z', chronoId, devB.id);
  database
    .prepare(
      'UPDATE catalog_release_device_installs SET installed_at = ? WHERE release_id = ? AND device_id = ?',
    )
    .run('2026-11-24T10:00:00.000Z', yoshiId, devB.id);

  // Sync catalog_releases.installed_at to latest across devices
  database
    .prepare('UPDATE catalog_releases SET installed_at = ? WHERE id = ?')
    .run('2026-11-23T10:00:00.000Z', chronoId);
  database
    .prepare('UPDATE catalog_releases SET installed_at = ? WHERE id = ?')
    .run('2026-11-22T10:00:00.000Z', earthboundId);
  database
    .prepare('UPDATE catalog_releases SET installed_at = ? WHERE id = ?')
    .run('2026-11-24T10:00:00.000Z', yoshiId);

  // Global (Any Device): Yoshi (Nov 24) -> Chrono (Nov 23) -> EarthBound (Nov 22) -> uninstalled games last
  const anyDeviceSorted = dbMod.queryRepositoryItems({
    system: ['snes'],
    sort: 'installed_desc',
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(
    anyDeviceSorted.items.map((i) => i.title),
    ["Yoshi's Island", 'Chrono Trigger', 'EarthBound', 'Star Fox'],
  );

  // Scoped to Device A (MIYOO_256GB): EarthBound (Nov 22) -> Chrono (Nov 20) -> games not on Device A last
  const devASorted = dbMod.queryRepositoryItems({
    system: ['snes'],
    deviceId: devA.id,
    sort: 'installed_desc',
    limit: 20,
    offset: 0,
  });
  assert.deepEqual(
    devASorted.items.slice(0, 2).map((i) => i.title),
    ['EarthBound', 'Chrono Trigger'],
  );

  // queryRepositoryItemIds also supports device-scoped installed_desc without SQL binding mismatch
  const devAIds = dbMod.queryRepositoryItemIds({
    system: ['snes'],
    deviceId: devA.id,
    sort: 'installed_desc',
  });
  assert.deepEqual(devAIds.ids.slice(0, 2), [earthboundId, chronoId]);
});
