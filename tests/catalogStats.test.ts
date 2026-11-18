import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { ReleaseMetadata } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-catalog-stats-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
let dbMod: DbModule;

function makeMeta(title: string, overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    wpPostId: Math.floor(Math.random() * 100000),
    wpPostType: 'post',
    title,
    subtitle: null,
    consoleName: 'Game Boy',
    publisher: 'Nintendo',
    developer: 'Nintendo',
    releaseYear: '1993',
    genres: ['Action'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.gb'],
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
    sourcePageUrl: `https://retrogametalk.com/repository/gameboy-roms/${encodeURIComponent(title.toLowerCase())}/`,
    fetchedAt: '2026-11-10T10:00:00Z',
    ...overrides,
  };
}

before(async () => {
  fs.mkdirSync(tempDataDir, { recursive: true });
  fs.mkdirSync(tempDownloadDir, { recursive: true });
  dbMod = await import('../src/server/db.ts');
  const database = dbMod.initDb();

  // Seed multi-day catalog releases spanning available, downloaded, failed, installed, alias slugs, & size buckets
  const rel1 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gameboy-roms/links-awakening/',
    remotePath: '/repository/gameboy-roms/links-awakening/',
    localPath: path.join(tempDownloadDir, 'gameboy-roms', 'links-awakening'),
    systemName: 'gameboy-roms',
    title: "Link's Awakening",
    estimatedBytes: 512 * 1024,
    metadata: makeMeta("Link's Awakening", {
      wpPostId: 3001,
      genres: ['Adventure'],
      regions: ['Japan', 'USA'],
      languages: ['English Patched'],
      sources: ['No-Intro'],
    }),
  });
  database
    .prepare('UPDATE catalog_releases SET discovered_at = ? WHERE id = ?')
    .run('2026-11-10T09:00:00Z', rel1.id);

  dbMod.upsertReleaseFile({
    releaseId: rel1.id,
    remoteUrl: 'https://retrogametalk.com/repository/gameboy-roms/links-awakening/#f1',
    downloadUrl: 'https://cdn.example.com/la.zip',
    remotePath: '/repository/gameboy-roms/links-awakening/',
    localPath: path.join(tempDownloadDir, 'gameboy-roms', 'links-awakening', 'la.zip'),
    filename: 'la.zip',
    fileSizeBytes: 524_288, // 512 KB (< 1 MB bucket)
    status: 'downloaded',
    downloadedAt: '2026-11-12T14:00:00Z',
  });
  dbMod.setCatalogItemsInstalled({
    ids: [rel1.id],
    installed: true,
    deviceLabel: 'Miyoo Mini+',
  });

  // Alias system slug `gb_roms` should canonicalize to `gameboy-roms`
  const rel2 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/gameboy-roms/tetris/',
    remotePath: '/repository/gameboy-roms/tetris/',
    localPath: path.join(tempDownloadDir, 'gameboy-roms', 'tetris'),
    systemName: 'gb_roms',
    title: 'Tetris',
    estimatedBytes: 2 * 1024 * 1024, // 2 MiB (1-16 MB bucket)
    metadata: makeMeta('Tetris', {
      wpPostId: 3002,
      releaseTags: ['Retail ROM'],
      regions: ['World'],
      languages: ['English'],
      sources: ['No-Intro'],
    }),
  });
  database
    .prepare('UPDATE catalog_releases SET discovered_at = ? WHERE id = ?')
    .run('2026-11-11T10:00:00Z', rel2.id);

  // Larger downloaded PSX release (600 MiB -> 512 MB - 2 GB bucket)
  const rel3 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/psx/vagrant-story/',
    remotePath: '/repository/psx/vagrant-story/',
    localPath: path.join(tempDownloadDir, 'psx', 'vagrant-story'),
    systemName: 'psx',
    title: 'Vagrant Story',
    estimatedBytes: 600 * 1024 * 1024,
    metadata: makeMeta('Vagrant Story', {
      wpPostId: 3003,
      releaseTags: ['Retail ROM'],
      regions: ['USA'],
      languages: ['English'],
      sources: ['Redump'],
    }),
  });
  database
    .prepare('UPDATE catalog_releases SET discovered_at = ? WHERE id = ?')
    .run('2026-11-11T11:00:00Z', rel3.id);

  dbMod.upsertReleaseFile({
    releaseId: rel3.id,
    remoteUrl: 'https://retrogametalk.com/repository/psx/vagrant-story/#f1',
    downloadUrl: 'https://cdn.example.com/vs.chd',
    remotePath: '/repository/psx/vagrant-story/',
    localPath: path.join(tempDownloadDir, 'psx', 'vagrant-story', 'Vagrant Story.chd'),
    filename: 'Vagrant Story.chd',
    fileSizeBytes: 600 * 1024 * 1024,
    status: 'downloaded',
    downloadedAt: '2026-11-14T16:00:00Z',
  });

  // Failed SNES release (4 MiB -> 1-16 MB bucket)
  const rel4 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repository/snes/super-metroid/',
    remotePath: '/repository/snes/super-metroid/',
    localPath: path.join(tempDownloadDir, 'snes', 'super-metroid'),
    systemName: 'snes',
    title: 'Super Metroid',
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeMeta('Super Metroid', {
      wpPostId: 3004,
      genres: ['Hack'],
      regions: ['Japan'],
      languages: ['Japanese'],
      sources: ['RHDN'],
    }),
  });
  database
    .prepare('UPDATE catalog_releases SET discovered_at = ? WHERE id = ?')
    .run('2026-11-12T08:00:00Z', rel4.id);

  dbMod.upsertReleaseFile({
    releaseId: rel4.id,
    remoteUrl: 'https://retrogametalk.com/repository/snes/super-metroid/#f1',
    downloadUrl: 'https://cdn.example.com/sm.zip',
    remotePath: '/repository/snes/super-metroid/',
    localPath: path.join(tempDownloadDir, 'snes', 'super-metroid', 'sm.zip'),
    filename: 'sm.zip',
    fileSizeBytes: 4 * 1024 * 1024,
    status: 'failed',
    errorMessage: 'HTTP 503',
  });

  // Seed sync_runs history
  const run1 = dbMod.createSyncRun('manual', 'incremental', false);
  database
    .prepare(
      `UPDATE sync_runs
       SET status = 'completed',
           started_at = '2026-11-12T13:55:00Z',
           finished_at = '2026-11-12T14:00:00Z',
           downloaded_count = 1,
           skipped_count = 0,
           failed_count = 1,
           bytes_downloaded = 524288,
           rate_limit_hits = 1,
           avg_delay_ms = 900
       WHERE id = ?`,
    )
    .run(run1.id);

  dbMod.updateSystemIndexCursor('gameboy-roms', {
    lastIndexedAt: '2026-11-11T10:00:00Z',
    totalWpPosts: 2,
    totalPages: 1,
    pagesIndexed: 1,
    fullyIndexed: true,
    scope: 'filtered',
  });
});

after(() => {
  try {
    dbMod.initDb().close();
  } catch {
    // ignore teardown error
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('getCatalogStatsSnapshot computes summary, growth timeline, download trends, canonical coverage, size buckets, and composition', () => {
  const stats = dbMod.getCatalogStatsSnapshot();

  assert.equal(stats.summary.totalCatalogItems, 4);
  assert.equal(stats.summary.downloadedItems, 2);
  assert.equal(stats.summary.availableItems, 1);
  assert.equal(stats.summary.failedItems, 1);
  assert.equal(stats.summary.installedItems, 1);
  assert.equal(stats.summary.mirroredBytes, 524_288 + 600 * 1024 * 1024);
  assert.equal(stats.summary.estimatedAvailableBytes, 2 * 1024 * 1024 + 4 * 1024 * 1024);
  assert.equal(stats.summary.systemsTracked, 3);
  assert.equal(stats.summary.fullyIndexedSystems, 1);

  // Growth timeline should be chronologically sorted and monotonically cumulative
  assert.equal(stats.growthTimeline.length, 4);
  assert.deepEqual(
    stats.growthTimeline.map((p) => p.date),
    ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-14'],
  );
  const lastGrowth = stats.growthTimeline[stats.growthTimeline.length - 1]!;
  assert.equal(lastGrowth.cumulativeIndexed, 4);
  assert.equal(lastGrowth.cumulativeDownloaded, 2);
  assert.equal(lastGrowth.cumulativeBytes, 524_288 + 600 * 1024 * 1024);

  // Download trends daily + runs
  const day12 = stats.downloadTrends.daily.find((d) => d.date === '2026-11-12');
  assert.ok(day12, 'expected 2026-11-12 daily trend');
  assert.equal(day12.filesDownloaded, 1);
  assert.equal(day12.bytesDownloaded, 524_288);
  assert.equal(day12.failedItems, 1);

  assert.equal(stats.downloadTrends.runs.length, 1);
  assert.equal(stats.downloadTrends.runs[0]!.durationSec, 300);
  assert.ok(stats.downloadTrends.runs[0]!.avgBytesPerSec > 0);

  // System coverage canonicalizes gb_roms into gameboy-roms
  const gbCoverage = stats.systemCoverage.find((s) => s.systemName === 'gameboy-roms');
  assert.ok(gbCoverage, 'expected canonical gameboy-roms coverage');
  assert.equal(gbCoverage.totalItems, 2);
  assert.equal(gbCoverage.downloadedItems, 1);
  assert.equal(gbCoverage.availableItems, 1);
  assert.equal(gbCoverage.installedItems, 1);
  assert.equal(gbCoverage.fullyIndexed, true);

  // Size distribution buckets
  const lt1Mb = stats.sizeDistribution.find((b) => b.bucketKey === 'lt_1mb')!;
  const mb1To16 = stats.sizeDistribution.find((b) => b.bucketKey === '1_16mb')!;
  const mb512To2Gb = stats.sizeDistribution.find((b) => b.bucketKey === '512mb_2gb')!;
  assert.equal(lt1Mb.downloadedCount, 1);
  assert.equal(mb1To16.availableCount, 2); // Tetris available (2 MB) + Super Metroid failed (4 MB)
  assert.equal(mb512To2Gb.downloadedCount, 1);

  // Release composition tags & regions
  const retailTag = stats.releaseComposition.tags.find((t) => t.label === 'Retail ROM');
  const translationTag = stats.releaseComposition.tags.find((t) => t.label === 'English Translation');
  const hackTag = stats.releaseComposition.tags.find((t) => t.label === 'Hack');
  assert.ok(retailTag);
  assert.ok(translationTag);
  assert.ok(hackTag);
  assert.equal(retailTag.totalCount, 2);
  assert.equal(retailTag.downloadedCount, 1);
  assert.equal(translationTag.totalCount, 1);
  assert.equal(hackTag.totalCount, 1);
});
