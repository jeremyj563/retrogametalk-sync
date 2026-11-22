import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  doesCatalogReleaseMatchSyncRules,
  normalizeSyncOverride,
} from '../src/shared/syncRuleMatcher.ts';
import { LATEST_SCHEMA_VERSION } from '../src/server/migrations.ts';

test('normalizeSyncOverride and doesCatalogReleaseMatchSyncRules enforce pin and ignore precedence', () => {
  assert.equal(normalizeSyncOverride('pin'), 'pin');
  assert.equal(normalizeSyncOverride('PIN'), 'pin');
  assert.equal(normalizeSyncOverride('ignore'), 'ignore');
  assert.equal(normalizeSyncOverride('unknown'), 'default');
  assert.equal(normalizeSyncOverride(null), 'default');

  const rules = {
    systemFilter: 'snes-rom',
    allowedReleaseTypes: ['English Translation'],
  };

  // Default behavior: non-target console and wrong release type do not match
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'gba-rom',
        releaseType: 'Hack',
        releaseTags: ['Hack'],
        syncOverride: 'default',
      },
      rules,
    ),
    false,
  );

  // Pin overrides both console filter and release-type filter
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'gba-rom',
        releaseType: 'Hack',
        releaseTags: ['Hack'],
        syncOverride: 'pin',
      },
      rules,
    ),
    true,
  );

  // Ignore excludes even a release that matches both target console and allowed release type
  assert.equal(
    doesCatalogReleaseMatchSyncRules(
      {
        systemName: 'snes-rom',
        releaseType: 'English Translation',
        releaseTags: ['English Translation'],
        syncOverride: 'ignore',
      },
      rules,
    ),
    false,
  );
});

test('SQLite migration v25, favorites, custom collections CRUD & cascade deletes, and sync rule override parity', async () => {
  assert.ok(
    LATEST_SCHEMA_VERSION >= 25,
    `Expected LATEST_SCHEMA_VERSION >= 25, got ${LATEST_SCHEMA_VERSION}`,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-curate-db-'));
  const dataDir = path.join(tmpDir, 'data');
  const downloadDir = path.join(tmpDir, 'roms');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const prevDataDir = process.env.DATA_DIR;
  const prevDownloadDir = process.env.DOWNLOAD_DIR;
  process.env.DATA_DIR = dataDir;
  process.env.DOWNLOAD_DIR = downloadDir;

  try {
    const db = await import('../src/server/db.ts');
    const rawDb = db.initDb();

    // Verify migration v25 columns and tables exist
    const cols = rawDb
      .prepare('PRAGMA table_info(catalog_releases)')
      .all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    assert.ok(colNames.has('is_favorite'), 'is_favorite column must exist');
    assert.ok(colNames.has('sync_override'), 'sync_override column must exist');

    const tables = rawDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as { name: string }[];
    const tableNames = new Set(tables.map((t) => t.name));
    assert.ok(tableNames.has('user_collections'), 'user_collections table must exist');
    assert.ok(tableNames.has('user_collection_items'), 'user_collection_items table must exist');

    // Configure global sync rules: target console = snes-rom, allowed type = English Translation
    db.updateConfig({
      systemFilter: 'snes-rom',
      allowedReleaseTypes: ['English Translation'],
    });

    const insertRelease = rawDb.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
        title, file_size_bytes, status, discovered_at, downloaded_at, installed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Matches global rules (snes-rom + English Translation) -> will be IGNORED
    const idIgnoredSnes = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/ignored-jrpg/',
        'snes-rom/ignored-jrpg',
        '/tmp/roms/snes-rom/ignored-jrpg',
        'snes-rom',
        'English Translation',
        '["English Translation"]',
        'Ignored SNES Translation',
        4096,
        'available',
        '2026-11-01T00:00:00.000Z',
        null,
        null,
      ).lastInsertRowid,
    );

    // 2. Matches global rules (snes-rom + English Translation) -> stays DEFAULT
    const idMatchedSnes = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/matched-jrpg/',
        'snes-rom/matched-jrpg',
        '/tmp/roms/snes-rom/matched-jrpg',
        'snes-rom',
        'English Translation',
        '["English Translation"]',
        'Matched SNES Translation',
        2048,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z',
        '2026-11-03T00:00:00.000Z',
      ).lastInsertRowid,
    );

    rawDb
      .prepare(
        `INSERT INTO catalog_release_files (
          release_id, remote_url, download_url, remote_path, local_path, filename,
          display_label, file_role, file_size_bytes, status, discovered_at, downloaded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        idMatchedSnes,
        'https://retrogametalk.com/repo/snes-rom/matched-jrpg/',
        'https://retrogametalk.com/repo/snes-rom/matched-jrpg/download/',
        'snes-rom/matched-jrpg/Matched (English).zip',
        '/tmp/roms/snes-rom/matched-jrpg/Matched (English).zip',
        'Matched (English).zip',
        'Matched (English).zip',
        'English Translation',
        2048,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z',
      );

    // 3. Outside global rules (gba-rom + Hack) -> will be PINNED
    const idPinnedGba = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/gba-rom/pinned-hack/',
        'gba-rom/pinned-hack',
        '/tmp/roms/gba-rom/pinned-hack',
        'gba-rom',
        'Hack',
        '["Hack"]',
        'Pinned GBA Hack',
        8192,
        'available',
        '2026-11-01T00:00:00.000Z',
        null,
        null,
      ).lastInsertRowid,
    );

    // 4. Outside global rules (gba-rom + Retail ROM) -> stays DEFAULT
    const idUnmatchedGba = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/gba-rom/unmatched-retail/',
        'gba-rom/unmatched-retail',
        '/tmp/roms/gba-rom/unmatched-retail',
        'gba-rom',
        'Retail ROM',
        '["Retail ROM"]',
        'Unmatched GBA Retail',
        1024,
        'available',
        '2026-11-01T00:00:00.000Z',
        null,
        null,
      ).lastInsertRowid,
    );

    // --- Test Favorites ---
    const favResult = db.setCatalogItemsFavorite({ ids: [idMatchedSnes, idPinnedGba], favorite: true });
    assert.equal(favResult.updated, 2);
    assert.ok(favResult.items.every((i) => i.isFavorite === true));

    const favQuery = db.queryRepositoryItems({ favoriteOnly: true, limit: 20, offset: 0 });
    assert.equal(favQuery.total, 2);
    assert.equal(favQuery.facets.counts?.favorites, 2);
    assert.deepEqual(
      favQuery.items.map((i) => i.id).sort((a, b) => a - b),
      [idMatchedSnes, idPinnedGba].sort((a, b) => a - b),
    );
    assert.equal(db.getCatalogTotalsAndSystems().totals.favoriteItems, 2);

    // --- Test Custom Collections CRUD, case-insensitive uniqueness, membership, & cascade delete ---
    const colA = db.createUserCollection({ name: 'Miyoo Mini Travel', description: 'Short flights' });
    assert.equal(colA.name, 'Miyoo Mini Travel');
    assert.equal(colA.itemCount, 0);

    // Case-insensitive duplicate name should throw SQLite UNIQUE error
    assert.throws(() => db.createUserCollection({ name: 'miyoo mini travel' }));

    const added = db.addItemsToUserCollection(colA.id, [idMatchedSnes, idPinnedGba]);
    assert.equal(added.added, 2);

    const listedCols = db.listUserCollections();
    assert.equal(listedCols.length, 1);
    assert.equal(listedCols[0].itemCount, 2);
    assert.equal(listedCols[0].downloadedCount, 1);
    assert.equal(listedCols[0].installedCount, 1);
    assert.equal(listedCols[0].queueableCount, 1);
    assert.equal(listedCols[0].estimatedBytes, 2048 + 8192);

    // Query items filtered by collectionId & verify item.collectionIds hydration
    const colItems = db.queryRepositoryItems({ collectionId: colA.id, limit: 20, offset: 0 });
    assert.equal(colItems.total, 2);
    for (const item of colItems.items) {
      assert.deepEqual(item.collectionIds, [colA.id]);
    }

    // Rename collection
    const renamed = db.updateUserCollection(colA.id, { name: 'Miyoo Carry-On' });
    assert.equal(renamed?.name, 'Miyoo Carry-On');

    // Remove one item from collection
    const removed = db.removeItemsFromUserCollection(colA.id, [idPinnedGba]);
    assert.equal(removed.removed, 1);
    assert.equal(db.getUserCollectionById(colA.id)?.itemCount, 1);

    // Deleting a release cascades its collection membership row cleanly
    const colB = db.createUserCollection({ name: 'Temp Cascade Check' });
    db.addItemsToUserCollection(colB.id, [idUnmatchedGba]);
    assert.equal(db.getUserCollectionById(colB.id)?.itemCount, 1);
    db.deleteRepositoryItemsByIds([idUnmatchedGba]);
    assert.equal(db.getUserCollectionById(colB.id)?.itemCount, 0);

    // Deleting a collection removes membership rows without deleting the releases
    assert.equal(db.deleteUserCollection(colA.id), true);
    assert.equal(db.getUserCollectionById(colA.id), null);
    assert.ok(db.getCatalogReleaseById(idMatchedSnes), 'Release must remain intact after collection deletion');
    assert.deepEqual(db.getCatalogReleaseById(idMatchedSnes)?.collectionIds, []);

    // --- Test Per-Game Sync Rule Overrides & Cross-System Parity ---
    db.setCatalogItemsSyncOverride({ ids: [idIgnoredSnes], syncOverride: 'ignore' });
    db.setCatalogItemsSyncOverride({ ids: [idPinnedGba], syncOverride: 'pin' });

    // 1. Catalog syncRules=true query must include matched SNES + pinned GBA, exclude ignored SNES
    const syncCatalog = db.queryRepositoryItems({ syncRules: true, limit: 20, offset: 0 });
    assert.deepEqual(
      syncCatalog.items.map((i) => i.id).sort((a, b) => a - b),
      [idMatchedSnes, idPinnedGba].sort((a, b) => a - b),
    );
    assert.equal(syncCatalog.facets.counts?.syncRulesMatched, 2);
    assert.equal(syncCatalog.facets.counts?.syncOverrides?.pinned, 1);
    assert.equal(syncCatalog.facets.counts?.syncOverrides?.ignored, 1);

    // 2. queryRepositoryItemIds(syncRules: true) must match identically
    const syncIds = db.queryRepositoryItemIds({ syncRules: true });
    assert.deepEqual(
      syncIds.ids.sort((a, b) => a - b),
      [idMatchedSnes, idPinnedGba].sort((a, b) => a - b),
    );

    // 3. listCatalogReleasesForRuleSync (used by Full Sync) must match identically
    const forRuleSync = db.listCatalogReleasesForRuleSync(db.getPublicConfig());
    assert.deepEqual(
      forRuleSync.matched.map((r) => r.id).sort((a, b) => a - b),
      [idMatchedSnes, idPinnedGba].sort((a, b) => a - b),
    );

    // 4. computeSyncPreflightSummary must report exact same counts (2 matched, 1 already mirrored, 1 pending)
    const preflight = db.computeSyncPreflightSummary();
    assert.equal(preflight.totalRuleMatched, 2);
    assert.equal(preflight.alreadyDownloadedCount, 1);
    assert.equal(preflight.pendingDownloadCount, 1);

    // 5. listPinnedCatalogReleases returns only pinned releases
    const pinnedList = db.listPinnedCatalogReleases();
    assert.deepEqual(pinnedList.map((r) => r.id), [idPinnedGba]);

    // 6. syncOverride filter in queryRepositoryItems works for both 'pin' and 'ignore'
    const onlyPinned = db.queryRepositoryItems({ syncOverride: 'pin', limit: 20, offset: 0 });
    assert.deepEqual(onlyPinned.items.map((i) => i.id), [idPinnedGba]);
    const onlyIgnored = db.queryRepositoryItems({ syncOverride: 'ignore', limit: 20, offset: 0 });
    assert.deepEqual(onlyIgnored.items.map((i) => i.id), [idIgnoredSnes]);
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
