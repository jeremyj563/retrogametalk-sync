import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  formatRatingFilterButtonLabel,
  formatUserRating,
  normalizeCatalogRatingMode,
  normalizeMinRatingFilter,
  normalizeUserRating,
  parseCompactCount,
} from '../src/shared/catalogRating.ts';
import { AdaptiveRateLimiter } from '../src/server/rateLimiter.ts';
import type { ReleaseMetadata } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-catalog-ratings-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

type DbModule = typeof import('../src/server/db.ts');
type RgtClientModule = typeof import('../src/server/rgtClient.ts');
let dbMod: DbModule;
let rgtMod: RgtClientModule;

function makeWpMetadata(title: string, slug: string, overrides: Partial<ReleaseMetadata> = {}): ReleaseMetadata {
  return {
    wpPostId: Math.floor(Math.random() * 100000),
    wpPostType: 'snes-rom',
    title,
    subtitle: null,
    consoleName: 'Super Nintendo',
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
    publishedAt: '2026-11-18T12:00:00Z',
    remoteUpdatedAt: '2026-11-18T12:00:00Z',
    specs: [],
    descriptionHtml: '',
    descriptionText: '',
    coverUrl: null,
    coverLocalRelPath: null,
    screenshotUrls: [],
    screenshotLocalRelPaths: [],
    detailHydrated: false,
    downloadHints: [{ filename: `${title} (USA).zip`, fileSize: '2.0 MB' }],
    sourcePageUrl: `https://retrogametalk.com/repo/snes-rom/${slug}/`,
    fetchedAt: '2026-11-18T12:00:00Z',
    ...overrides,
  };
}

before(async () => {
  fs.mkdirSync(tempDataDir, { recursive: true });
  fs.mkdirSync(tempDownloadDir, { recursive: true });
  dbMod = await import('../src/server/db.ts');
  rgtMod = await import('../src/server/rgtClient.ts');
  dbMod.initDb();
});

after(() => {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // Ignore cleanup race
  }
});

test('catalogRating pure helpers normalize tenths, compact counts, and labels', () => {
  assert.equal(normalizeUserRating('4.9'), 4.9);
  assert.equal(normalizeUserRating(5), 5);
  assert.equal(normalizeUserRating(4.86), 4.9);
  assert.equal(normalizeUserRating('0'), null);
  assert.equal(normalizeUserRating(-1), null);
  assert.equal(normalizeUserRating(5.5), null);
  assert.equal(normalizeUserRating('N/A'), null);

  assert.equal(normalizeMinRatingFilter('4.3'), 4.3);
  assert.equal(normalizeMinRatingFilter(0.2), null);
  assert.equal(normalizeMinRatingFilter(5.0), 5.0);
  assert.equal(normalizeMinRatingFilter(''), null);
  assert.equal(normalizeMinRatingFilter(0), null);

  assert.equal(normalizeCatalogRatingMode('rated'), 'rated');
  assert.equal(normalizeCatalogRatingMode('unrated'), 'unrated');
  assert.equal(normalizeCatalogRatingMode('anything'), 'all');

  assert.equal(parseCompactCount('11.8k'), 11800);
  assert.equal(parseCompactCount('2.4M'), 2400000);
  assert.equal(parseCompactCount('1,234'), 1234);
  assert.equal(parseCompactCount('0'), 0);
  assert.equal(parseCompactCount(null), null);

  assert.equal(formatUserRating(5), '5.0');
  assert.equal(formatUserRating(4.7), '4.7');
  assert.equal(formatUserRating(null), '—');

  assert.equal(formatRatingFilterButtonLabel(null, 'all'), 'Score');
  assert.equal(formatRatingFilterButtonLabel(4.6, 'all'), '≥ 4.6★');
  assert.equal(formatRatingFilterButtonLabel(null, 'rated'), 'Rated');
  assert.equal(formatRatingFilterButtonLabel(null, 'unrated'), 'Unrated');
});

test('parseRgtDatabaseCardsHtml parses live RGT card scores, downloads, and pagination', () => {
  const sampleHtml = `
    <div class="games-grid">
      <div class="game-container">
        <a class="cover-link" href="https://retrogametalk.com/repo/snes-rom/chrono-trigger/">
          <span class="game-title">Chrono Trigger</span>
        </a>
        <div class="score" title="Users Rating"><svg></svg>4.9</div>
        <div class="downloads" title="Total Downloads"><svg></svg>11.8k</div>
      </div>
      <div class="game-container">
        <a class="cover-link" href="/repo/snes-rom/super-metroid/">
          <span class="game-title">Super Metroid</span>
        </a>
        <div class="score" title="Users Rating"><svg></svg>5</div>
        <div class="downloads" title="Total Downloads"><svg></svg>24.1k</div>
      </div>
      <div class="game-container">
        <a class="cover-link" href="https://retrogametalk.com/repo/snes-rom/obscure-proto/">
          <span class="game-title">Obscure Proto</span>
        </a>
        <div class="score" title="Users Rating"><svg></svg>0</div>
        <div class="downloads" title="Total Downloads"><svg></svg>19</div>
      </div>
    </div>
    <nav class="navigation pagination">
      <a class="page-numbers" href="/repo/page/1/?types%5B%5D=snes-rom&orderby=meta__rating">1</a>
      <a class="page-numbers" href="/repo/page/2/?types%5B%5D=snes-rom&orderby=meta__rating">2</a>
      <a class="page-numbers" href="/repo/page/14/?types%5B%5D=snes-rom&orderby=meta__rating">14</a>
      <a class="next page-numbers" href="/repo/page/2/?types%5B%5D=snes-rom&orderby=meta__rating">Next</a>
    </nav>
  `;

  const parsed = rgtMod.parseRgtDatabaseCardsHtml(sampleHtml, 'https://retrogametalk.com/repo/');
  assert.equal(parsed.cards.length, 3);
  assert.equal(parsed.cards.filter((c) => c.userRating !== null).length, 2);
  assert.equal(parsed.totalPages, 14);
  assert.equal(
    parsed.nextPageUrl,
    'https://retrogametalk.com/repo/page/2/?types%5B%5D=snes-rom&orderby=meta__rating',
  );

  assert.equal(parsed.cards[0].userRating, 4.9);
  assert.equal(parsed.cards[0].rgtDownloads, 11800);
  assert.equal(parsed.cards[0].rgtDownloadsText, '11.8k');

  assert.equal(parsed.cards[1].pageUrl, 'https://retrogametalk.com/repo/snes-rom/super-metroid/');
  assert.equal(parsed.cards[1].userRating, 5);
  assert.equal(parsed.cards[1].rgtDownloads, 24100);

  assert.equal(parsed.cards[2].userRating, null);
  assert.equal(parsed.cards[2].rgtDownloads, 19);
});

test('extractReleaseMetadata parses Users Score and vote count from detail page HTML', () => {
  const client = new rgtMod.RetroGameTalkClient(
    new AdaptiveRateLimiter({ baseDelayMs: 0, minDelayMs: 0, maxDelayMs: 100, backoffMultiplier: 1 }),
  );
  const detailHtml = `
    <html>
      <body>
        <h1 class="entry-title">EarthBound</h1>
        <div class="rgt-title-stats">
          <div class="score" title="Users Rating">4.8</div>
          <span data-votes="312">312 votes</span>
        </div>
        <table class="rom-info">
          <tr><th>Publisher</th><td>Nintendo</td></tr>
          <tr><th>Year</th><td>1995</td></tr>
          <tr><th>Users Score</th><td>4.8 / 5 (312 votes)</td></tr>
        </table>
      </body>
    </html>
  `;
  const pageUrl = 'https://retrogametalk.com/repo/snes-rom/earthbound/';
  const meta = client.extractReleaseMetadata(detailHtml, pageUrl, {
    wpPostId: 4001,
    wpPostType: 'snes-rom',
    link: pageUrl,
    title: 'EarthBound',
    originalTitle: 'EarthBound',
    dateGmt: '2026-11-18T12:00:00Z',
    modifiedGmt: '2026-11-18T12:00:00Z',
    publisher: 'Nintendo',
    developer: 'Ape',
    releaseYear: '1995',
    genres: ['RPG'],
    regions: ['USA'],
    languages: ['English'],
    sources: ['No-Intro'],
    formats: ['.sfc'],
    descriptionHtml: '',
    downloadHints: [],
  });
  assert.equal(meta.userRating, 4.8);
  assert.equal(meta.userRatingVotes, 312);
});

test('SQLite v31 batchUpdateReleaseRatings, tenth-step filtering, sorting, facet counts, and re-index preservation', () => {
  assert.equal(dbMod.getDataDir(), tempDataDir);
  const report = dbMod.getSchemaMigrationReport();
  assert.ok(report.currentVersion >= 31, `expected schema >= 31, got ${report.currentVersion}`);

  const r1 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/chrono-trigger/',
    remotePath: 'snes/chrono-trigger',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    metadata: makeWpMetadata('Chrono Trigger', 'chrono-trigger'),
  });
  const r2 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/earthbound/',
    remotePath: 'snes/earthbound',
    localPath: path.join(tempDownloadDir, 'snes', 'earthbound'),
    systemName: 'snes',
    title: 'EarthBound',
    metadata: makeWpMetadata('EarthBound', 'earthbound'),
  });
  const r3 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/pilotwings/',
    remotePath: 'snes/pilotwings',
    localPath: path.join(tempDownloadDir, 'snes', 'pilotwings'),
    systemName: 'snes',
    title: 'Pilotwings',
    metadata: makeWpMetadata('Pilotwings', 'pilotwings'),
  });
  const r4 = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/unrated-gem/',
    remotePath: 'snes/unrated-gem',
    localPath: path.join(tempDownloadDir, 'snes', 'unrated-gem'),
    systemName: 'snes',
    title: 'Aaa Unrated Gem',
    metadata: makeWpMetadata('Aaa Unrated Gem', 'unrated-gem'),
  });
  assert.ok(r1.id && r2.id && r3.id && r4.id);

  // Batch update including URL without trailing slash to test normalization matching
  const res = dbMod.batchUpdateReleaseRatings([
    {
      remoteUrl: 'https://retrogametalk.com/repo/snes-rom/chrono-trigger',
      userRating: 4.9,
      userRatingVotes: 500,
      rgtDownloads: 15000,
      downloadsLabel: '15.0k',
    },
    {
      remoteUrl: 'https://retrogametalk.com/repo/snes-rom/earthbound/',
      userRating: 4.4,
      userRatingVotes: 240,
      rgtDownloads: 8200,
      downloadsLabel: '8.2k',
    },
    {
      remoteUrl: 'https://retrogametalk.com/repo/snes-rom/pilotwings/',
      userRating: 3.7,
      rgtDownloads: 1200,
      downloadsLabel: '1.2k',
    },
    {
      remoteUrl: 'https://retrogametalk.com/repo/snes-rom/unrated-gem/',
      userRating: null,
      rgtDownloads: 42,
      downloadsLabel: '42',
    },
  ]);
  assert.equal(res.matched, 4);
  assert.equal(res.ratedUpdated, 3);

  // Sort highest -> lowest (unrated MUST stay at bottom)
  const desc = dbMod.queryRepositoryItems({ system: 'snes', sort: 'rating_desc', limit: 20 });
  assert.deepEqual(
    desc.items.map((i) => i.title),
    ['Chrono Trigger', 'EarthBound', 'Pilotwings', 'Aaa Unrated Gem'],
  );
  assert.equal(desc.items[0].userRating, 4.9);
  assert.equal(desc.items[0].userRatingVotes, 500);
  assert.equal(desc.items[0].rgtDownloads, 15000);
  assert.equal(desc.items[3].userRating, null);

  // Sort lowest -> highest (unrated MUST STILL stay at bottom)
  const asc = dbMod.queryRepositoryItems({ system: 'snes', sort: 'rating_asc', limit: 20 });
  assert.deepEqual(
    asc.items.map((i) => i.title),
    ['Pilotwings', 'EarthBound', 'Chrono Trigger', 'Aaa Unrated Gem'],
  );

  // Tenth-of-a-star filter: minRating = 4.4
  const gte44 = dbMod.queryRepositoryItems({ system: 'snes', minRating: 4.4, sort: 'rating_desc' });
  assert.deepEqual(
    gte44.items.map((i) => i.title),
    ['Chrono Trigger', 'EarthBound'],
  );

  // Tenth-of-a-star filter: minRating = 4.5 excludes 4.4
  const gte45 = dbMod.queryRepositoryItems({ system: 'snes', minRating: 4.5, sort: 'rating_desc' });
  assert.deepEqual(
    gte45.items.map((i) => i.title),
    ['Chrono Trigger'],
  );

  // Unrated mode
  const unratedOnly = dbMod.queryRepositoryItems({ system: 'snes', ratingMode: 'unrated' });
  assert.deepEqual(
    unratedOnly.items.map((i) => i.title),
    ['Aaa Unrated Gem'],
  );

  // Rated mode
  const ratedOnly = dbMod.queryRepositoryItems({ system: 'snes', ratingMode: 'rated' });
  assert.equal(ratedOnly.total, 3);

  // Facet counts
  const ratingCounts = desc.facets.counts?.ratings;
  assert.ok(ratingCounts);
  assert.equal(ratingCounts.total, 4);
  assert.equal(ratingCounts.rated, 3);
  assert.equal(ratingCounts.unrated, 1);
  assert.equal(ratingCounts.atLeast48, 1);
  assert.equal(ratingCounts.atLeast45, 1);
  assert.equal(ratingCounts.atLeast40, 2);
  assert.equal(ratingCounts.atLeast35, 3);
  assert.equal(ratingCounts.atLeast30, 3);

  // WP REST re-index MUST preserve stored user_rating & metadata.userRating
  const reindexed = dbMod.upsertIndexedWpRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/chrono-trigger/',
    remotePath: 'snes/chrono-trigger',
    localPath: path.join(tempDownloadDir, 'snes', 'chrono-trigger'),
    systemName: 'snes',
    title: 'Chrono Trigger',
    metadata: makeWpMetadata('Chrono Trigger', 'chrono-trigger'),
  });
  assert.equal(reindexed.userRating, 4.9);
  assert.equal(reindexed.metadata?.userRating, 4.9);
});
