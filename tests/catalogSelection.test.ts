import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  deriveStatusMapFromIdsPayload,
  formatDownloadFilteredTooltip,
  formatInstallSelectedTooltip,
  formatQueueSelectedTooltip,
  isCatalogStatusAlreadyDownloaded,
  isCatalogStatusAlreadyQueued,
  isCatalogStatusInstallable,
  isCatalogStatusQueueable,
  summarizeCatalogSelection,
} from '../src/shared/catalogSelection.ts';
import type { ItemStatus } from '../src/types.ts';

test('classifies every catalog item status consistently for queue and storage install eligibility', () => {
  // Queueable: available, failed, partial
  assert.equal(isCatalogStatusQueueable('available'), true);
  assert.equal(isCatalogStatusQueueable('failed'), true);
  assert.equal(isCatalogStatusQueueable('partial'), true);
  assert.equal(isCatalogStatusQueueable('downloaded'), false);
  assert.equal(isCatalogStatusQueueable('skipped'), false);
  assert.equal(isCatalogStatusQueueable('queued'), false);
  assert.equal(isCatalogStatusQueueable('downloading'), false);

  // Installable on disk: downloaded, skipped, partial
  assert.equal(isCatalogStatusInstallable('downloaded'), true);
  assert.equal(isCatalogStatusInstallable('skipped'), true);
  assert.equal(isCatalogStatusInstallable('partial'), true);
  assert.equal(isCatalogStatusInstallable('available'), false);
  assert.equal(isCatalogStatusInstallable('failed'), false);
  assert.equal(isCatalogStatusInstallable('queued'), false);
  assert.equal(isCatalogStatusInstallable('downloading'), false);

  assert.equal(isCatalogStatusAlreadyDownloaded('downloaded'), true);
  assert.equal(isCatalogStatusAlreadyDownloaded('skipped'), true);
  assert.equal(isCatalogStatusAlreadyDownloaded('partial'), false);

  assert.equal(isCatalogStatusAlreadyQueued('queued'), true);
  assert.equal(isCatalogStatusAlreadyQueued('downloading'), true);
  assert.equal(isCatalogStatusAlreadyQueued('available'), false);
});

test('all-downloaded selection produces zero queueableIds and full installableIds', () => {
  const statusMap = new Map<number, ItemStatus>();
  const selectedIds: number[] = [];
  for (let id = 1; id <= 41; id++) {
    selectedIds.push(id);
    statusMap.set(id, id === 41 ? 'skipped' : 'downloaded');
  }

  const summary = summarizeCatalogSelection(selectedIds, statusMap);
  assert.equal(summary.totalSelected, 41);
  assert.deepEqual(summary.queueableIds, []);
  assert.equal(summary.installableIds.length, 41);
  assert.equal(summary.alreadyDownloadedCount, 41);
  assert.equal(summary.alreadyQueuedCount, 0);
  assert.equal(summary.notYetDownloadedCount, 0);
});

test('mixed selection partitions queueable, installable, partial, and queued items with accurate tooltips', () => {
  const statusMap = new Map<number, ItemStatus>([
    [1, 'available'],
    [2, 'failed'],
    [3, 'partial'],
    [4, 'downloaded'],
    [5, 'skipped'],
    [6, 'queued'],
    [7, 'downloading'],
  ]);

  const summary = summarizeCatalogSelection([1, 2, 3, 4, 5, 6, 7], statusMap);
  assert.equal(summary.totalSelected, 7);
  assert.deepEqual(summary.queueableIds, [1, 2, 3]);
  assert.deepEqual(summary.installableIds, [3, 4, 5]);
  assert.equal(summary.alreadyDownloadedCount, 2);
  assert.equal(summary.alreadyQueuedCount, 2);
  assert.equal(summary.notYetDownloadedCount, 4); // available + failed + queued + downloading

  assert.equal(
    formatQueueSelectedTooltip(summary, true),
    'Queue 3 un-downloaded releases for background download (2 already downloaded, 2 already queued skipped)',
  );
  assert.equal(
    formatQueueSelectedTooltip(summary, false),
    'Verify login in System Settings before queueing downloads',
  );
  assert.equal(
    formatInstallSelectedTooltip('express', summary, false),
    'Mount device if needed and express-install 3 downloaded releases in background (4 not yet downloaded skipped)',
  );
  assert.equal(
    formatInstallSelectedTooltip('review', summary, false),
    'Open interactive installer queue for 3 downloaded releases (4 not yet downloaded skipped)',
  );
  assert.equal(
    formatInstallSelectedTooltip('express', summary, true),
    'A storage installation is currently running in the background',
  );
  assert.equal(
    formatDownloadFilteredTooltip({
      hasCompletedLogin: true,
      hasActiveFilters: true,
      queueableCount: 310,
      totalMatching: 351,
    }),
    'Preview and queue 310 un-downloaded releases matching your active filters (41 already downloaded or queued skipped)',
  );
  assert.equal(
    formatDownloadFilteredTooltip({
      hasCompletedLogin: true,
      hasActiveFilters: false,
      queueableCount: 1,
      totalMatching: 1,
    }),
    'Preview and queue 1 un-downloaded release in the catalog',
  );
});

test('reconstructs cross-page status map from /api/items/ids buckets accurately after unchecking items', () => {
  const statusMap = deriveStatusMapFromIdsPayload({
    ids: [10, 11, 12, 13, 14],
    queueableIds: [10, 12],
    downloadableIds: [11, 12, 14],
    alreadyQueuedIds: [13],
  });

  assert.equal(statusMap.get(10), 'available');
  assert.equal(statusMap.get(11), 'downloaded');
  assert.equal(statusMap.get(12), 'partial');
  assert.equal(statusMap.get(13), 'queued');
  assert.equal(statusMap.get(14), 'downloaded');

  // Simulate user unchecking downloaded #14 and available #10 after Select All Filtered
  const remainingSelection = [11, 12, 13];
  const summary = summarizeCatalogSelection(remainingSelection, statusMap);
  assert.deepEqual(summary.queueableIds, [12]);
  assert.deepEqual(summary.installableIds, [11, 12]);
  assert.equal(summary.alreadyDownloadedCount, 1);
  assert.equal(summary.alreadyQueuedCount, 1);
});

test('queryRepositoryItems returns exact queueableFiltered count and queryRepositoryItemIds returns alreadyQueuedIds', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-catalog-selection-test-'));
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
  try {
    const db = await import('../src/server/db.ts');
    const sqlite = db.initDb();

    const insertStmt = sqlite.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, title, status, file_size_bytes, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = '2026-11-20T18:00:00Z';
    const seedRows: Array<[string, string, string]> = [
      ['Game Gear Downloaded 1', 'game-gear', 'downloaded'],
      ['Game Gear Downloaded 2', 'game-gear', 'skipped'],
      ['Game Gear Available 1', 'game-gear', 'available'],
      ['Game Gear Failed 1', 'game-gear', 'failed'],
      ['Game Gear Partial 1', 'game-gear', 'partial'],
      ['Game Gear Queued 1', 'game-gear', 'queued'],
      ['Game Gear Downloading 1', 'game-gear', 'downloading'],
    ];

    seedRows.forEach(([title, sys, status], idx) => {
      insertStmt.run(
        `https://example.invalid/${sys}/item-${idx}`,
        `${sys}/item-${idx}`,
        path.join(tmpDir, 'repository', sys, `item-${idx}.zip`),
        sys,
        title,
        status,
        1024 * (idx + 1),
        now,
      );
    });

    // All Game Gear releases: 7 total, 3 queueable (available, failed, partial)
    const allRes = db.queryRepositoryItems({ system: 'game-gear' });
    assert.equal(allRes.total, 7);
    assert.equal(allRes.facets.counts?.queueableFiltered, 3);

    // Filtered to Downloaded only: 2 total, 0 queueable
    const dlOnlyRes = db.queryRepositoryItems({ system: 'game-gear', downloaded: 'only' });
    assert.equal(dlOnlyRes.total, 2);
    assert.equal(dlOnlyRes.facets.counts?.queueableFiltered, 0);

    // Filtered to Not Downloaded: 5 total (available, failed, partial, queued, downloading), 3 queueable
    const notDlRes = db.queryRepositoryItems({ system: 'game-gear', downloaded: 'exclude' });
    assert.equal(notDlRes.total, 5);
    assert.equal(notDlRes.facets.counts?.queueableFiltered, 3);

    // Filtered IDs payload includes alreadyQueuedIds matching queued + downloading
    const idsRes = db.queryRepositoryItemIds({ system: 'game-gear' });
    assert.equal(idsRes.total, 7);
    assert.equal(idsRes.queueableIds.length, 3);
    assert.equal(idsRes.downloadableIds.length, 3); // downloaded, skipped, partial
    assert.equal(idsRes.alreadyQueuedIds.length, 2); // queued, downloading
    assert.equal(idsRes.alreadyQueuedCount, 2);
    assert.equal(idsRes.alreadyDownloadedCount, 2);
  } finally {
    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
