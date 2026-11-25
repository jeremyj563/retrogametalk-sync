import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  isCatalogStatusAlreadyQueued,
  isCatalogStatusQueueable,
  summarizeCatalogSelection,
} from '../src/shared/catalogSelection.ts';
import type { ItemStatus } from '../src/types.ts';

test('includePausedQueued treats paused queued items as queueable while keeping downloading active', () => {
  assert.equal(isCatalogStatusQueueable('queued'), false);
  assert.equal(isCatalogStatusQueueable('queued', { includePausedQueued: true }), true);
  assert.equal(isCatalogStatusQueueable('downloading', { includePausedQueued: true }), false);

  assert.equal(isCatalogStatusAlreadyQueued('queued'), true);
  assert.equal(isCatalogStatusAlreadyQueued('queued', { includePausedQueued: true }), false);
  assert.equal(isCatalogStatusAlreadyQueued('downloading', { includePausedQueued: true }), true);

  const statusMap = new Map<number, ItemStatus>([
    [1, 'available'],
    [2, 'queued'],
    [3, 'downloading'],
    [4, 'downloaded'],
  ]);

  const activeSummary = summarizeCatalogSelection([1, 2, 3, 4], statusMap, {
    includePausedQueued: false,
  });
  assert.deepEqual(activeSummary.queueableIds, [1]);
  assert.equal(activeSummary.alreadyQueuedCount, 2);
  assert.equal(activeSummary.notYetDownloadedCount, 3);

  const idleSummary = summarizeCatalogSelection([1, 2, 3, 4], statusMap, {
    includePausedQueued: true,
  });
  assert.deepEqual(idleSummary.queueableIds, [1, 2]);
  assert.equal(idleSummary.alreadyQueuedCount, 1);
  assert.equal(idleSummary.notYetDownloadedCount, 3);
  assert.equal(idleSummary.alreadyDownloadedCount, 1);
});

test('paused queued releases remain queryable, resumable, clearable, and recovered cleanly across restart', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-queue-recovery-test-'));
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
  try {
    const db = await import('../src/server/db.ts');
    const sqlite = db.initDb();
    const now = '2026-11-24T21:00:00Z';

    const insertRelease = sqlite.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, title, status, file_size_bytes, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-1',
        'snes-rom/game-1',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-1.zip'),
        'snes-rom',
        'Queued Game 1',
        'queued',
        4096,
        now,
      ).lastInsertRowid,
    );
    const r2 = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-2',
        'snes-rom/game-2',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-2.zip'),
        'snes-rom',
        'Queued Game 2',
        'queued',
        8192,
        now,
      ).lastInsertRowid,
    );
    const rPartial = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-3',
        'snes-rom/game-3',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-3'),
        'snes-rom',
        'Partial Multi-File Game',
        'partial',
        12288,
        now,
      ).lastInsertRowid,
    );

    const insertFile = sqlite.prepare(`
      INSERT INTO catalog_release_files (
        release_id, remote_url, download_url, remote_path, local_path, filename, display_label, status, file_size_bytes, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertFile.run(
      rPartial,
      'https://example.invalid/snes-rom/game-3#f1',
      'https://example.invalid/dl/f1.zip',
      'snes-rom/game-3/disc1.zip',
      path.join(tmpDir, 'repository', 'snes-rom', 'game-3', 'disc1.zip'),
      'disc1.zip',
      'Disc 1',
      'downloaded',
      6144,
      now,
    );
    insertFile.run(
      rPartial,
      'https://example.invalid/snes-rom/game-3#f2',
      'https://example.invalid/dl/f2.zip',
      'snes-rom/game-3/disc2.zip',
      path.join(tmpDir, 'repository', 'snes-rom', 'game-3', 'disc2.zip'),
      'disc2.zip',
      'Disc 2',
      'queued',
      6144,
      now,
    );

    // Without includePausedQueued (active download worker): queued rows are excluded from queueableFiltered
    const activeItemsRes = db.queryRepositoryItems({ system: 'snes-rom' });
    assert.equal(activeItemsRes.total, 3);
    assert.equal(activeItemsRes.facets.counts?.queueableFiltered, 1); // only partial

    // With includePausedQueued (no active download worker): Download Filtered sees all 3 releases!
    const idleItemsRes = db.queryRepositoryItems({
      system: 'snes-rom',
      includePausedQueued: true,
    });
    assert.equal(idleItemsRes.total, 3);
    assert.equal(idleItemsRes.facets.counts?.queueableFiltered, 3);

    const idleIdsRes = db.queryRepositoryItemIds({
      system: 'snes-rom',
      includePausedQueued: true,
    });
    assert.deepEqual(
      [...idleIdsRes.queueableIds].sort((a, b) => a - b),
      [r1, r2, rPartial],
    );
    assert.equal(idleIdsRes.alreadyQueuedCount, 0);

    // listPausedQueuedReleaseIds returns queued releases AND partial releases with queued child files
    assert.deepEqual(db.listPausedQueuedReleaseIds(), [r1, r2, rPartial]);

    // Clearing the paused queue resets queued releases to available and preserves partial rollup
    const cleared = db.clearPausedQueuedReleases();
    assert.equal(cleared.clearedCount, 3);
    assert.deepEqual(db.listPausedQueuedReleaseIds(), []);
    assert.equal(db.getRepositoryItemById(r1)?.status, 'available');
    assert.equal(db.getRepositoryItemById(r2)?.status, 'available');
    assert.equal(db.getRepositoryItemById(rPartial)?.status, 'partial');
    assert.equal(
      db.getRepositoryItemById(rPartial)?.files.find((f) => f.filename === 'disc2.zip')?.status,
      'available',
    );

    // Simulate abrupt SIGKILL during an active download queue run
    const interruptedRun = db.createSyncRun('download', 'incremental', false);
    assert.equal(interruptedRun.status, 'running');
    sqlite.prepare(`UPDATE catalog_releases SET status = 'downloading' WHERE id = ?`).run(r1);
    sqlite.prepare(`UPDATE catalog_releases SET status = 'queued' WHERE id = ?`).run(r2);

    // Simulate container restart startup recovery
    db.recoverInterruptedRunsOnStartup(sqlite);

    const recoveredR1 = db.getRepositoryItemById(r1);
    const recoveredR2 = db.getRepositoryItemById(r2);
    assert.equal(recoveredR1?.status, 'queued');
    assert.equal(recoveredR1?.errorMessage, null);
    assert.equal(recoveredR2?.status, 'queued');
    assert.deepEqual(db.listPausedQueuedReleaseIds(), [r1, r2]);
  } finally {
    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
