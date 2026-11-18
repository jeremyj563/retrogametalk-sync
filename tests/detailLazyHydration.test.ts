import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { AdaptiveRateLimiter } from '../src/server/rateLimiter.ts';
import { RetroGameTalkClient } from '../src/server/rgtClient.ts';
import type { ReleaseMetadata } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-lazy-detail-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
let dbMod: DbModule;

function makeWpIndexMetadata(title: string, overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    wpPostId: 3001,
    wpPostType: 'snes',
    title,
    subtitle: null,
    consoleName: 'Super Nintendo',
    publisher: 'Square',
    developer: 'Square',
    releaseYear: '1995',
    genres: ['RPG'],
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
    coverUrl: 'https://retrogametalk.com/wp-content/uploads/2026/01/chrono-cover.jpg',
    coverLocalRelPath: null,
    screenshotUrls: [],
    screenshotLocalRelPaths: [],
    detailHydrated: false,
    downloadHints: [{ filename: `${title} (USA).zip`, fileSize: '4.0 MB' }],
    sourcePageUrl: 'https://retrogametalk.com/repository/snes/chrono-trigger/',
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

test('extractReleaseMetadata sets detailHydrated=false on empty HTML and extracts screenshots/specs on full HTML', () => {
  const rateLimiter = new AdaptiveRateLimiter({
    baseDelayMs: 100,
    minDelayMs: 50,
    maxDelayMs: 1000,
    backoffMultiplier: 2,
  });
  const client = new RetroGameTalkClient(rateLimiter);
  const pageUrl = 'https://retrogametalk.com/repository/snes/chrono-trigger/';

  const wpOnlyMeta = client.extractReleaseMetadata('', pageUrl, {
    wpPostId: 3001,
    wpPostType: 'snes',
    link: pageUrl,
    title: 'Chrono Trigger',
    originalTitle: 'Chrono Trigger',
    publisher: 'Square',
    developer: 'Square',
    releaseYear: '1995',
    genres: ['RPG'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    coverUrl: 'https://retrogametalk.com/wp-content/uploads/2026/01/chrono-cover.jpg',
    screenshotUrls: [],
    descriptionHtml: '<p>Short WP excerpt.</p>',
    dateGmt: '2026-11-18T12:00:00Z',
    modifiedGmt: '2026-11-18T12:00:00Z',
    downloadHints: [{ filename: 'Chrono Trigger (USA).zip', fileSize: '4.0 MB' }],
  });

  assert.equal(wpOnlyMeta.detailHydrated, false);
  assert.deepEqual(wpOnlyMeta.screenshotUrls, []);
  assert.deepEqual(wpOnlyMeta.specs, []);
  assert.deepEqual(wpOnlyMeta.downloadHints, [{ filename: 'Chrono Trigger (USA).zip', fileSize: '4.0 MB' }]);

  const fullHtml = `
    <!doctype html>
    <html>
      <body>
        <div id="acf-content-wrapper" data-id="3001"></div>
        <h1 class="rgt-title-name">Chrono Trigger</h1>
        <div class="rgt-title-sub">Square · 1995</div>
        <dl class="rgt-title-stats">
          <div><dt>Downloads</dt><dd>12,480</dd></div>
          <div><dt>Released</dt><dd>3 years ago</dd></div>
          <div><dt>Updated</dt><dd>Nov 18, 2026</dd></div>
        </dl>
        <table class="rom-info">
          <tbody>
            <tr><th>Console</th><td>Super Nintendo</td></tr>
            <tr><th>Players</th><td>1 Player</td></tr>
            <tr><th>Genre</th><td><a href="/genre/rpg/">RPG</a></td></tr>
          </tbody>
        </table>
        <div id="lightgallery">
          <a data-src="https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-1-300x225.jpg">
            <img src="https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-1-300x225.jpg" />
          </a>
          <a href="https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-2.png">
            <img src="https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-2-300x225.png" />
          </a>
        </div>
        <div id="custom-description">
          <h2>Game Description</h2>
          <p>Travel across eras to stop Lavos from destroying the world.</p>
        </div>
      </body>
    </html>
  `;

  const hydratedMeta = client.extractReleaseMetadata(fullHtml, pageUrl, {
    wpPostId: 3001,
    wpPostType: 'snes',
    link: pageUrl,
    title: 'Chrono Trigger',
    originalTitle: 'Chrono Trigger',
    publisher: 'Square',
    developer: 'Square',
    releaseYear: '1995',
    genres: ['RPG'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    coverUrl: 'https://retrogametalk.com/wp-content/uploads/2026/01/chrono-cover.jpg',
    screenshotUrls: [],
    descriptionHtml: '',
    dateGmt: '2026-11-18T12:00:00Z',
    modifiedGmt: '2026-11-18T12:00:00Z',
    downloadHints: [{ filename: 'Chrono Trigger (USA).zip', fileSize: '4.0 MB' }],
  });

  assert.equal(hydratedMeta.detailHydrated, true);
  assert.equal(hydratedMeta.downloadsCount, '12,480');
  assert.equal(hydratedMeta.releasedAgo, '3 years ago');
  assert.equal(hydratedMeta.updatedDate, 'Nov 18, 2026');
  assert.equal(hydratedMeta.specs.some((s) => s.label === 'Players' && s.value === '1 Player'), true);
  assert.equal(hydratedMeta.screenshotUrls.length, 2);
  assert.ok(
    hydratedMeta.descriptionText.includes('Travel across eras to stop Lavos'),
    `unexpected descriptionText: ${hydratedMeta.descriptionText}`,
  );
  assert.deepEqual(hydratedMeta.downloadHints, [{ filename: 'Chrono Trigger (USA).zip', fileSize: '4.0 MB' }]);
});

test('mergeCatalogReleaseDetailMetadata enriches available items without clobbering status, cached cover, or estimated size', () => {
  const url = 'https://retrogametalk.com/repository/snes/chrono-trigger/';
  const initial = dbMod.upsertIndexedWpRelease({
    remoteUrl: url,
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeWpIndexMetadata('Chrono Trigger'),
  });

  // Simulate lazy cover already cached prior to detail drawer open
  const cachedCoverPath = path.join(tempDataDir, 'cache', 'covers', `${initial.id}.jpg`);
  dbMod.updateCatalogCoverPath(initial.id, cachedCoverPath);

  const enrichedMeta: ReleaseMetadata = {
    ...initial.metadata!,
    detailHydrated: true,
    downloadsCount: '12,480',
    releasedAgo: '3 years ago',
    updatedDate: 'Nov 18, 2026',
    specs: [
      { label: 'Console', value: 'Super Nintendo' },
      { label: 'Players', value: '1 Player' },
    ],
    screenshotUrls: [
      'https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-1.jpg',
      'https://retrogametalk.com/wp-content/uploads/2026/01/chrono-shot-2.png',
    ],
    descriptionHtml: '<p>Travel across eras to stop Lavos from destroying the world.</p>',
    descriptionText: 'Travel across eras to stop Lavos from destroying the world.',
  };

  const merged = dbMod.mergeCatalogReleaseDetailMetadata(initial.id, enrichedMeta)!;
  assert.equal(merged.status, 'available');
  assert.equal(merged.sizeIsEstimated, true);
  assert.equal(merged.fileSizeBytes, 4 * 1024 * 1024);
  assert.equal(merged.coverLocalPath, cachedCoverPath);
  assert.equal(merged.screenshotsCount, 0);
  assert.equal(merged.metadata?.detailHydrated, true);
  assert.equal(merged.metadata?.downloadsCount, '12,480');
  assert.equal(merged.metadata?.screenshotUrls.length, 2);
  assert.equal(merged.metadata?.specs.length, 2);
  assert.deepEqual(merged.metadata?.downloadHints, [{ filename: 'Chrono Trigger (USA).zip', fileSize: '4.0 MB' }]);

  // Subsequent background WP re-index with empty HTML/screenshots must preserve hydrated HTML details
  const afterReindex = dbMod.upsertIndexedWpRelease({
    remoteUrl: url,
    remotePath: '/repository/snes/chrono-trigger/',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    estimatedBytes: 4 * 1024 * 1024,
    metadata: makeWpIndexMetadata('Chrono Trigger'),
  });

  assert.equal(afterReindex.status, 'available');
  assert.equal(afterReindex.coverLocalPath, cachedCoverPath);
  assert.equal(afterReindex.metadata?.detailHydrated, true);
  assert.equal(afterReindex.metadata?.downloadsCount, '12,480');
  assert.equal(afterReindex.metadata?.updatedDate, 'Nov 18, 2026');
  assert.equal(afterReindex.metadata?.screenshotUrls.length, 2);
  assert.equal(afterReindex.metadata?.specs.length, 2);
  assert.ok(afterReindex.metadata?.descriptionHtml.includes('Travel across eras'));
});
