import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import Database from 'better-sqlite3';
import { SCHEMA_MIGRATIONS } from '../src/server/migrations.ts';
import { AdaptiveRateLimiter } from '../src/server/rateLimiter.ts';
import { decodeHtmlEntities, hasHtmlEntities } from '../src/server/releaseTags.ts';
import {
  buildHtmlEntityDecodedDownloadUrl,
  isDownloadCandidateUrl,
  RetroGameTalkClient,
  type DiscoveredRelease,
} from '../src/server/rgtClient.ts';
import { createDefaultStorageFolderConfig } from '../src/shared/storageFolderMappings.ts';
import type { ScraperConfigInternal } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-entity-fallback-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');
fs.mkdirSync(tempDataDir, { recursive: true });
fs.mkdirSync(tempDownloadDir, { recursive: true });

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function makeConfig(): ScraperConfigInternal {
  return {
    baseUrl: 'https://retrogametalk.com/repository/',
    loginUrl: 'https://retrogametalk.com/login/',
    dataDir: tempDataDir,
    downloadDir: tempDownloadDir,
    username: 'tester',
    password: 'secret',
    hasPassword: true,
    cronSchedule: '0 */6 * * *',
    scheduleEnabled: false,
    userAgent: 'RetroGameTalk-Sync-Test/1.0',
    minDelayMs: 10,
    baseDelayMs: 20,
    maxDelayMs: 5_000,
    backoffMultiplier: 1.5,
    requestTimeoutMs: 15_000,
    maxRetries: 1,
    maxConcurrency: 1,
    downloadChunkConcurrency: 1,
    downloadChunkMinSizeMb: 32,
    systemFilter: '',
    allowedReleaseTypes: [],
    discoveredSystems: ['snes-rom'],
    lastWatermarkAt: null,
    romNamingTemplate: '{filename}',
    romSanitizeFat32: true,
    romMaxFilenameLen: 180,
    storageFolderConfig: createDefaultStorageFolderConfig(),
    autoDownloadNewReleases: true,
    updatedAt: new Date().toISOString(),
    envOverrides: [],
  };
}

test('decodeHtmlEntities decodes single, double, and numeric HTML entities safely', () => {
  assert.equal(hasHtmlEntities('Traverse - Starlight &amp; Prairie'), true);
  assert.equal(hasHtmlEntities('Traverse - Starlight & Prairie'), false);
  assert.equal(decodeHtmlEntities('Traverse - Starlight &amp; Prairie'), 'Traverse - Starlight & Prairie');
  assert.equal(decodeHtmlEntities('Traverse - Starlight &amp;amp; Prairie'), 'Traverse - Starlight & Prairie');
  assert.equal(decodeHtmlEntities('Sonic &#038; Knuckles &#8217;94'), 'Sonic & Knuckles \u201994');
  assert.equal(decodeHtmlEntities('&lt;Beta&gt; &amp;amp; Demo'), '<Beta> & Demo');
  assert.equal(decodeHtmlEntities('Mario & Luigi'), 'Mario & Luigi');
});

test('buildHtmlEntityDecodedDownloadUrl rewrites only the entity-encoded file= parameter using PHP rawurlencode format', () => {
  const failingUrl =
    'https://meryl.retrogametalk.com/download.php?file=Traverse%20-%20Starlight%20%26amp%3B%20Prairie%20%28Japan%29.zip&id=298249&platform=snes-rom&exp=1795173397&u=78412&w=0&key=23e0ef1154baca8f0fa84b7fe6f4252e';
  const expectedUrl =
    'https://meryl.retrogametalk.com/download.php?file=Traverse%20-%20Starlight%20%26%20Prairie%20%28Japan%29.zip&id=298249&platform=snes-rom&exp=1795173397&u=78412&w=0&key=23e0ef1154baca8f0fa84b7fe6f4252e';

  assert.equal(buildHtmlEntityDecodedDownloadUrl(failingUrl), expectedUrl);
  assert.equal(buildHtmlEntityDecodedDownloadUrl(expectedUrl), null);
  assert.equal(buildHtmlEntityDecodedDownloadUrl('https://meryl.retrogametalk.com/download.php?id=123'), null);

  const doubleEncoded =
    'https://meryl.retrogametalk.com/download.php?file=Bob%26amp%3Bamp%3BAlice%20%28USA%29%21.zip&id=1&key=abc';
  assert.equal(
    buildHtmlEntityDecodedDownloadUrl(doubleEncoded),
    'https://meryl.retrogametalk.com/download.php?file=Bob%26Alice%20%28USA%29%21.zip&id=1&key=abc',
  );
});

function makeRateLimiter(): AdaptiveRateLimiter {
  return new AdaptiveRateLimiter({
    baseDelayMs: 20,
    minDelayMs: 10,
    maxDelayMs: 5_000,
    backoffMultiplier: 1.5,
  });
}

test('downloadFileAtomic automatically retries HTTP 404 with entity-decoded file= parameter and succeeds', async () => {
  const rateLimiter = makeRateLimiter();
  const client = new RetroGameTalkClient(rateLimiter);
  const config = makeConfig();
  const payload = Buffer.from('PK\x03\x04mock-zip-archive-bytes');

  const failingUrl =
    'https://meryl.retrogametalk.com/download.php?file=Traverse%20-%20Starlight%20%26amp%3B%20Prairie%20%28Japan%29.zip&id=298249&platform=snes-rom&exp=1795173397&u=78412&w=0&key=23e0ef1154baca8f0fa84b7fe6f4252e';
  const decodedUrl =
    'https://meryl.retrogametalk.com/download.php?file=Traverse%20-%20Starlight%20%26%20Prairie%20%28Japan%29.zip&id=298249&platform=snes-rom&exp=1795173397&u=78412&w=0&key=23e0ef1154baca8f0fa84b7fe6f4252e';

  const requestedUrls: string[] = [];
  (client as unknown as { fetchWithRedirects: (...args: unknown[]) => Promise<unknown> }).fetchWithRedirects = async (
    url: unknown,
  ) => {
    const reqUrl = String(url);
    requestedUrls.push(reqUrl);
    if (reqUrl === failingUrl) {
      return {
        response: new Response('Not Found', { status: 404 }),
        finalUrl: reqUrl,
      };
    }
    if (reqUrl === decodedUrl) {
      return {
        response: new Response(payload, {
          status: 200,
          headers: {
            'content-type': 'application/zip',
            'content-length': String(payload.length),
          },
        }),
        finalUrl: reqUrl,
      };
    }
    throw new Error(`Unexpected URL requested: ${reqUrl}`);
  };

  const release: DiscoveredRelease = {
    remoteUrl: 'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/#Traverse.zip',
    pageUrl: 'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/',
    downloadUrl: failingUrl,
    remotePath: 'snes-rom/traverse-starlight-prairie/Traverse - Starlight & Prairie (Japan).zip',
    filename: 'Traverse - Starlight & Prairie (Japan).zip',
    displayLabel: 'Traverse - Starlight & Prairie (Japan).zip',
    systemName: 'snes-rom',
    releaseType: 'Retail ROM',
    title: 'Traverse - Starlight & Prairie',
    publishedAt: null,
  };

  const result = await client.downloadFileAtomic(
    release,
    config,
    new AbortController().signal,
    () => undefined,
  );

  assert.equal(result.outcome, 'downloaded');
  assert.equal(result.bytes, payload.length);
  assert.deepEqual(requestedUrls, [failingUrl, decodedUrl]);
  assert.deepEqual(fs.readFileSync(result.localPath), payload);
});

test('downloadFileAtomic preserves authenticated session if entity-decoded fallback returns HTTP 403', async () => {
  const rateLimiter = makeRateLimiter();
  const client = new RetroGameTalkClient(rateLimiter);
  const config = makeConfig();

  // Seed authenticated session state
  (client as unknown as { setAuthState: (s: unknown) => void }).setAuthState({
    configured: true,
    authenticated: true,
    cookieCount: 3,
    lastMessage: 'Authenticated',
  });

  const failingUrl =
    'https://meryl.retrogametalk.com/download.php?file=Other%20%26amp%3B%20Game.zip&id=1&platform=snes-rom&key=sig';
  const decodedUrl =
    'https://meryl.retrogametalk.com/download.php?file=Other%20%26%20Game.zip&id=1&platform=snes-rom&key=sig';

  (client as unknown as { fetchWithRedirects: (...args: unknown[]) => Promise<unknown> }).fetchWithRedirects = async (
    url: unknown,
  ) => {
    const reqUrl = String(url);
    if (reqUrl === failingUrl) {
      return { response: new Response('Not Found', { status: 404 }), finalUrl: reqUrl };
    }
    if (reqUrl === decodedUrl) {
      return { response: new Response('Invalid signature', { status: 403 }), finalUrl: reqUrl };
    }
    throw new Error(`Unexpected URL: ${reqUrl}`);
  };

  const release: DiscoveredRelease = {
    remoteUrl: 'https://retrogametalk.com/repository/snes-rom/other-game/#Other.zip',
    pageUrl: 'https://retrogametalk.com/repository/snes-rom/other-game/',
    downloadUrl: failingUrl,
    remotePath: 'snes-rom/other-game/Other & Game.zip',
    filename: 'Other & Game.zip',
    displayLabel: 'Other & Game.zip',
    systemName: 'snes-rom',
    releaseType: 'Retail ROM',
    title: 'Other & Game',
    publishedAt: null,
  };

  await assert.rejects(
    () =>
      client.downloadFileAtomic(
        release,
        config,
        new AbortController().signal,
        () => undefined,
      ),
    /Upstream RetroGameTalk mirror link bug \(HTTP 404\):.*HTTP 403 signature mismatch/,
  );

  // WordPress auth state must still be authenticated
  assert.equal(client.getAuthStatus(config).authenticated, true);
});

test('parseWpPostObject decodes HTML entities in ACF game_name, original_title, and download_links', () => {
  const client = new RetroGameTalkClient(makeRateLimiter());
  const parsed = (
    client as unknown as {
      parseWpPostObject: (post: Record<string, unknown>, fallback: string) => {
        title: string | null;
        originalTitle: string | null;
        downloadHints: { filename: string; fileSize: string }[];
      } | null;
    }
  ).parseWpPostObject(
    {
      id: 298249,
      type: 'snes-rom',
      link: 'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/',
      title: { rendered: 'Traverse &#8211; Starlight &amp; Prairie' },
      acf: {
        game_name: 'Traverse - Starlight &amp; Prairie',
        original_title: 'Starlight &amp;amp; Prairie',
        download_links: [
          {
            file_name: 'Traverse - Starlight &amp; Prairie (Japan).zip',
            file_size: '2.1 MB',
          },
        ],
      },
    },
    'snes-rom',
  );

  assert.ok(parsed);
  assert.equal(parsed.title, 'Traverse - Starlight & Prairie');
  assert.equal(parsed.originalTitle, 'Starlight & Prairie');
  assert.equal(parsed.downloadHints[0]?.filename, 'Traverse - Starlight & Prairie (Japan).zip');
});

test('SQLite migration v21 decodes stored HTML entities without mutating local_path or filename', () => {
  const db = new Database(':memory:');
  const ctx = { dataDir: tempDataDir, defaultDownloadDir: tempDownloadDir };

  // Apply schema migrations 1..20
  for (const migration of SCHEMA_MIGRATIONS.filter((m) => m.version <= 20)) {
    migration.up(db, ctx);
  }

  const now = new Date().toISOString();
  const relInsert = db
    .prepare(
      `INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, title,
        publisher, developer, discovered_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/',
      'snes-rom/traverse-starlight-prairie',
      '/downloads/snes-rom/traverse-starlight-prairie',
      'snes-rom',
      'Traverse - Starlight &amp; Prairie',
      'Banpresto &amp; Co',
      'Pandora&#038;Box',
      now,
      JSON.stringify({
        title: 'Traverse - Starlight &amp; Prairie',
        subtitle: 'Banpresto &amp; Co · 1996',
        publisher: 'Banpresto &amp; Co',
        downloadHints: [
          { filename: 'Traverse - Starlight &amp; Prairie (Japan).zip', fileSize: '2.1 MB' },
        ],
      }),
    );

  const releaseId = Number(relInsert.lastInsertRowid);
  const originalLocalPath = '/downloads/snes-rom/Traverse - Starlight &amp; Prairie (Japan).zip';
  db.prepare(
    `INSERT INTO catalog_release_files (
      release_id, remote_url, download_url, remote_path, local_path,
      filename, display_label, file_role, status, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    releaseId,
    'https://retrogametalk.com/repository/snes-rom/traverse-starlight-prairie/#file1',
    'https://meryl.retrogametalk.com/download.php?file=Traverse.zip',
    'snes-rom/Traverse - Starlight &amp; Prairie (Japan).zip',
    originalLocalPath,
    'Traverse - Starlight &amp; Prairie (Japan).zip',
    'Traverse - Starlight &amp; Prairie (Japan).zip',
    'ROM',
    'downloaded',
    now,
  );

  // Run migration v21
  const v21 = SCHEMA_MIGRATIONS.find((m) => m.version === 21);
  assert.ok(v21, 'migration v21 should exist');
  v21.up(db, ctx);

  const relRow = db
    .prepare('SELECT title, publisher, developer, metadata_json FROM catalog_releases WHERE id = ?')
    .get(releaseId) as {
    title: string;
    publisher: string;
    developer: string;
    metadata_json: string;
  };
  assert.equal(relRow.title, 'Traverse - Starlight & Prairie');
  assert.equal(relRow.publisher, 'Banpresto & Co');
  assert.equal(relRow.developer, 'Pandora&Box');
  const parsedMeta = JSON.parse(relRow.metadata_json) as {
    title: string;
    subtitle: string;
    publisher: string;
    downloadHints: { filename: string }[];
  };
  assert.equal(parsedMeta.title, 'Traverse - Starlight & Prairie');
  assert.equal(parsedMeta.subtitle, 'Banpresto & Co · 1996');
  assert.equal(parsedMeta.downloadHints[0]?.filename, 'Traverse - Starlight & Prairie (Japan).zip');

  const fileRow = db
    .prepare('SELECT local_path, filename, display_label FROM catalog_release_files WHERE release_id = ?')
    .get(releaseId) as { local_path: string; filename: string; display_label: string };
  assert.equal(fileRow.display_label, 'Traverse - Starlight & Prairie (Japan).zip');
  assert.equal(fileRow.local_path, originalLocalPath);
  assert.equal(fileRow.filename, 'Traverse - Starlight &amp; Prairie (Japan).zip');

  db.close();
});

test('isDownloadCandidateUrl and extractLinksFromHtml ignore HTML navigation links whose text says "Download"', () => {
  // False positive from Populous page: navigation link with "Download" in anchor text
  assert.equal(
    isDownloadCandidateUrl(
      new URL('https://retrogametalk.com/repo/turbografx-16/download-japan/'),
      'TurboGrafx-16 Japanese Download',
      false,
    ),
    false,
  );
  assert.equal(
    isDownloadCandidateUrl(
      new URL('https://retrogametalk.com/repository/turbografx-16/download-guide/'),
      'How to Download',
      false,
    ),
    false,
  );

  // Genuine download endpoints and archive links must still match
  assert.equal(
    isDownloadCandidateUrl(
      new URL('https://snake.retrogametalk.com/download.php?file=Populous%20%28Japan%29.zip&id=1&key=abc'),
      'Download',
      false,
    ),
    true,
  );
  assert.equal(
    isDownloadCandidateUrl(
      new URL('https://retrogametalk.com/files/Populous.zip'),
      'Populous',
      false,
    ),
    true,
  );
  assert.equal(
    isDownloadCandidateUrl(
      new URL('https://retrogametalk.com/repository/turbografx-16/populous/?wpdmdl=99'),
      'Download',
      false,
    ),
    true,
  );

  const client = new RetroGameTalkClient(makeRateLimiter());
  const config = makeConfig();
  const html = `
    <html>
      <body>
        <h1>Populous</h1>
        <nav>
          <a href="https://retrogametalk.com/repo/turbografx-16/download-japan/">TurboGrafx-16 Japanese Download</a>
        </nav>
        <div class="downloads">
          <a href="https://snake.retrogametalk.com/download.php?file=Populous%20%28Japan%29.zip&id=123&platform=turbografx-16&key=abc">Download</a>
        </div>
      </body>
    </html>
  `;
  const extracted = client.extractLinksFromHtml(
    html,
    'https://retrogametalk.com/repository/turbografx-16/populous-japan/',
    config,
  );
  assert.equal(extracted.downloads.length, 1);
  assert.equal(extracted.downloads[0]?.filename, 'Populous (Japan).zip');
});

test('SQLite migration v22 prunes false-positive HTML webpage file rows and heals parent release status', () => {
  const db = new Database(':memory:');
  const ctx = { dataDir: tempDataDir, defaultDownloadDir: tempDownloadDir };

  for (const migration of SCHEMA_MIGRATIONS.filter((m) => m.version <= 21)) {
    migration.up(db, ctx);
  }

  const now = new Date().toISOString();
  const relInsert = db
    .prepare(
      `INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, title,
        status, error_message, file_size_bytes, discovered_at, downloaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'https://retrogametalk.com/repository/turbografx-16/populous-japan/',
      'turbografx-16/populous-japan',
      '/downloads/turbografx-16/populous-japan',
      'turbografx-16',
      'Populous',
      'partial',
      'TurboGrafx-16 Japanese Download.zip: Expected archive binary but received HTML',
      409600,
      now,
      now,
    );
  const releaseId = Number(relInsert.lastInsertRowid);

  // Real downloaded ROM file
  db.prepare(
    `INSERT INTO catalog_release_files (
      release_id, remote_url, download_url, remote_path, local_path,
      filename, display_label, file_role, file_size_bytes, status, discovered_at, downloaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    releaseId,
    'https://retrogametalk.com/repository/turbografx-16/populous-japan/#Populous.zip',
    'https://snake.retrogametalk.com/download.php?file=Populous%20%28Japan%29.zip&id=1&key=abc',
    'turbografx-16/Populous (Japan).zip',
    '/downloads/turbografx-16/Populous (Japan).zip',
    'Populous (Japan).zip',
    'Populous (Japan).zip',
    'ROM',
    409600,
    'downloaded',
    now,
    now,
  );

  // False-positive failed HTML page link
  db.prepare(
    `INSERT INTO catalog_release_files (
      release_id, remote_url, download_url, remote_path, local_path,
      filename, display_label, file_role, file_size_bytes, status, error_message, discovered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    releaseId,
    'https://retrogametalk.com/repo/turbografx-16/download-japan/',
    'https://retrogametalk.com/repo/turbografx-16/download-japan/',
    'turbografx-16/TurboGrafx-16 Japanese Download.zip',
    '/downloads/turbografx-16/TurboGrafx-16 Japanese Download.zip',
    'TurboGrafx-16 Japanese Download.zip',
    'TurboGrafx-16 Japanese Download',
    'ROM',
    0,
    'failed',
    'Expected archive binary but received HTML (https://retrogametalk.com/repo/turbografx-16/download-japan/); session or nonce may have expired',
    now,
  );

  const v22 = SCHEMA_MIGRATIONS.find((m) => m.version === 22);
  assert.ok(v22, 'migration v22 should exist');
  v22.up(db, ctx);

  const remainingFiles = db
    .prepare('SELECT filename, status FROM catalog_release_files WHERE release_id = ?')
    .all(releaseId) as { filename: string; status: string }[];
  assert.equal(remainingFiles.length, 1);
  assert.equal(remainingFiles[0]?.filename, 'Populous (Japan).zip');

  const updatedRelease = db
    .prepare('SELECT status, error_message, file_size_bytes FROM catalog_releases WHERE id = ?')
    .get(releaseId) as { status: string; error_message: string | null; file_size_bytes: number };
  assert.equal(updatedRelease.status, 'downloaded');
  assert.equal(updatedRelease.error_message, null);
  assert.equal(updatedRelease.file_size_bytes, 409600);

  db.close();
});
