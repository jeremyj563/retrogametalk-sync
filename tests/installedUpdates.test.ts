import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  classifyInstalledUpdateState,
  formatInstalledUpdateComparison,
  hasActionableRemoteUpdate,
  hasUnmirroredRemoteDownloadHints,
  INSTALL_UPDATE_GRACE_MS,
  normalizeUpdateFilenameKey,
} from '../src/shared/deviceInstallUpdates.ts';
import { resolveGameDetailFooterPlan } from '../src/utils/gameDetailActions.ts';
import {
  formatQuickInstallLabel,
  formatQuickInstallTooltip,
} from '../src/utils/storageActionCopy.ts';
import { LATEST_SCHEMA_VERSION } from '../src/server/migrations.ts';

test('classifyInstalledUpdateState handles not_installed, grace window, local updates, file-id swaps, and remote updates', () => {
  assert.equal(
    classifyInstalledUpdateState({
      status: 'downloaded',
      installedAt: null,
      downloadedAt: '2026-11-20T12:00:00.000Z',
      remoteUpdatedAt: '2026-11-21T12:00:00.000Z',
      files: [],
    }).state,
    'not_installed',
  );

  // Downloaded 30s after install is within the 60s grace window -> up_to_date
  const withinGrace = classifyInstalledUpdateState({
    status: 'downloaded',
    installedAt: '2026-11-20T12:00:00.000Z',
    downloadedAt: new Date(Date.parse('2026-11-20T12:00:00.000Z') + INSTALL_UPDATE_GRACE_MS - 15_000).toISOString(),
    remoteUpdatedAt: '2026-11-19T12:00:00.000Z',
    files: [],
  });
  assert.equal(withinGrace.state, 'up_to_date');
  assert.equal(withinGrace.hasUpdate, false);

  // Local mirror downloaded 10 minutes after install -> update_ready_local
  const localReady = classifyInstalledUpdateState({
    status: 'downloaded',
    installedAt: '2026-11-20T12:00:00.000Z',
    installedDeviceLabel: 'MIYOO',
    installedFileId: 10,
    installedFilename: 'Game (v1.0).sfc',
    downloadedAt: '2026-11-20T12:10:00.000Z',
    remoteUpdatedAt: '2026-11-20T12:05:00.000Z',
    files: [
      {
        id: 11,
        filename: 'Game (v1.1).zip',
        status: 'downloaded',
        downloadedAt: '2026-11-20T12:10:00.000Z',
      },
    ],
  });
  assert.equal(localReady.state, 'update_ready_local');
  assert.equal(localReady.hasUpdate, true);
  assert.equal(localReady.readyToUpgradeLocal, true);
  assert.equal(localReady.needsLocalDownload, false);
  assert.equal(localReady.summaryLabel, 'Update ready');
  assert.equal(localReady.newerLocalFile?.id, 11);
  assert.match(formatInstalledUpdateComparison(localReady) || '', /Installed .* · Downloaded /);

  // Different fileId downloaded 10s after install -> update_ready_local even inside grace window
  const swappedFile = classifyInstalledUpdateState({
    status: 'downloaded',
    installedAt: '2026-11-20T12:00:00.000Z',
    installedFileId: 10,
    installedFilename: 'Game (v1.0).sfc',
    downloadedAt: '2026-11-20T12:00:10.000Z',
    remoteUpdatedAt: '2026-11-19T00:00:00.000Z',
    files: [
      {
        id: 12,
        filename: 'Game (v1.2).zip',
        status: 'downloaded',
        downloadedAt: '2026-11-20T12:00:10.000Z',
      },
    ],
  });
  assert.equal(swappedFile.state, 'update_ready_local');
  assert.equal(swappedFile.newerLocalFile?.id, 12);

  // Upstream updated on RGT after install and after last local download (no downloadHints) -> update_available_remote
  const remoteOnly = classifyInstalledUpdateState({
    status: 'downloaded',
    installedAt: '2026-11-10T12:00:00.000Z',
    installedDeviceLabel: 'SDCARD',
    downloadedAt: '2026-11-10T11:55:00.000Z',
    remoteUpdatedAt: '2026-11-20T09:00:00.000Z',
    files: [
      {
        id: 20,
        filename: 'Hack (v1.0).zip',
        status: 'downloaded',
        downloadedAt: '2026-11-10T11:55:00.000Z',
      },
    ],
  });
  assert.equal(remoteOnly.state, 'update_available_remote');
  assert.equal(remoteOnly.hasUpdate, true);
  assert.equal(remoteOnly.readyToUpgradeLocal, false);
  assert.equal(remoteOnly.needsLocalDownload, true);
  assert.equal(remoteOnly.summaryLabel, 'Update on RGT');
  assert.match(formatInstalledUpdateComparison(remoteOnly) || '', /Installed .* · Updated on RGT /);
});

test('downloadHints filename matching and remoteCheckedAt eliminate WordPress metadata-only false positives', () => {
  assert.equal(
    normalizeUpdateFilenameKey('Chrono%20Trigger:%20Crimson%20Echoes.zip'),
    normalizeUpdateFilenameKey('/roms/snes/Chrono Trigger_ Crimson Echoes.zip'),
  );

  // All downloadHints already mirrored locally (with URL encoding & sanitized char differences)
  assert.equal(
    hasUnmirroredRemoteDownloadHints(
      [{ filename: 'Chrono%20Trigger:%20Crimson%20Echoes.zip', fileSize: '4.1 MB' }],
      [
        {
          id: 1,
          filename: 'Chrono Trigger_ Crimson Echoes.zip',
          status: 'downloaded',
          downloadedAt: '2026-11-10T09:00:00.000Z',
        },
      ],
    ),
    false,
  );

  // WordPress bumped remoteUpdatedAt for tags/description, but downloadHints match local files -> up_to_date
  const wpMetadataOnly = {
    status: 'downloaded',
    installedAt: '2026-11-10T10:00:00.000Z',
    downloadedAt: '2026-11-10T09:00:00.000Z',
    remoteUpdatedAt: '2026-11-20T09:00:00.000Z',
    metadata: {
      downloadHints: [{ filename: 'Hack (v1.0).zip', fileSize: '2.0 MB' }],
    },
    files: [
      {
        id: 30,
        filename: 'Hack (v1.0).zip',
        status: 'downloaded',
        downloadedAt: '2026-11-10T09:00:00.000Z',
      },
    ],
  };
  assert.equal(classifyInstalledUpdateState(wpMetadataOnly).state, 'up_to_date');
  assert.equal(hasActionableRemoteUpdate(wpMetadataOnly), false);

  // Genuine remote update: downloadHints includes a newer archive not yet downloaded locally
  const realRemoteUpdate = {
    ...wpMetadataOnly,
    metadata: {
      downloadHints: [
        { filename: 'Hack (v1.0).zip', fileSize: '2.0 MB' },
        { filename: 'Hack (v1.1).zip', fileSize: '2.1 MB' },
      ],
    },
  };
  assert.equal(classifyInstalledUpdateState(realRemoteUpdate).state, 'update_available_remote');
  assert.equal(hasActionableRemoteUpdate(realRemoteUpdate), true);

  // Live verification recorded via remoteCheckedAt >= remoteUpdatedAt clears remote alert without bumping downloadedAt
  const verifiedRemote = {
    status: 'downloaded',
    installedAt: '2026-11-10T10:00:00.000Z',
    downloadedAt: '2026-11-10T09:00:00.000Z',
    remoteUpdatedAt: '2026-11-20T09:00:00.000Z',
    remoteCheckedAt: '2026-11-20T09:00:00.000Z',
    files: [
      {
        id: 31,
        filename: 'Hack (v1.0).zip',
        status: 'downloaded',
        downloadedAt: '2026-11-10T09:00:00.000Z',
      },
    ],
  };
  assert.equal(classifyInstalledUpdateState(verifiedRemote).state, 'up_to_date');
  assert.equal(hasActionableRemoteUpdate(verifiedRemote), false);

  // Subsequent newer remoteUpdatedAt after remoteCheckedAt re-triggers detection
  const newerRemoteAfterCheck = {
    ...verifiedRemote,
    remoteUpdatedAt: '2026-11-21T09:00:00.000Z',
  };
  assert.equal(classifyInstalledUpdateState(newerRemoteAfterCheck).state, 'update_available_remote');
  assert.equal(hasActionableRemoteUpdate(newerRemoteAfterCheck), true);
});

test('GameDetailFooterPlan and storageActionCopy promote update labels when local update is ready', () => {
  const mountedPlan = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'downloaded',
    hasFailedFiles: false,
    mountedDeviceName: 'ANBERNIC',
    canInstallToDevice: true,
    installedAt: '2026-11-10T12:00:00.000Z',
    installedDeviceLabel: 'ANBERNIC',
    isUpdateReadyLocal: true,
  });
  assert.equal(mountedPlan.primaryAction, 'install_mounted');
  assert.equal(mountedPlan.isUpdateOnMountedDevice, true);
  assert.equal(mountedPlan.installButtonLabel, 'Update on ANBERNIC');

  assert.equal(
    formatQuickInstallLabel({
      mountedDeviceName: 'ANBERNIC',
      isUpdateAvailable: true,
      compact: true,
    }),
    'Update',
  );
  assert.equal(
    formatQuickInstallLabel({
      mountedDeviceName: 'ANBERNIC',
      isUpdateAvailable: true,
      count: 4,
    }),
    'Update on ANBERNIC (4)',
  );
  assert.match(
    formatQuickInstallTooltip({
      mountedDeviceName: 'ANBERNIC',
      isUpdateAvailable: true,
    }),
    /Upgrade to latest local ROM on ANBERNIC/,
  );
});

test('SQLite migration v26, downloadHints filtering, remote_checked_at verification, and outdated queries/facets/totals stay aligned', async () => {
  assert.ok(LATEST_SCHEMA_VERSION >= 26, `Expected LATEST_SCHEMA_VERSION >= 26, got ${LATEST_SCHEMA_VERSION}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-upd-db-'));
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
    const cols = rawDb
      .prepare('PRAGMA table_info(catalog_releases)')
      .all() as { name: string }[];
    const colNames = new Set(cols.map((c) => c.name));
    assert.ok(colNames.has('installed_file_id'), 'installed_file_id column must exist');
    assert.ok(colNames.has('installed_filename'), 'installed_filename column must exist');
    assert.ok(colNames.has('remote_checked_at'), 'remote_checked_at column must exist');

    const insertRelease = rawDb.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
        title, file_size_bytes, status, discovered_at, downloaded_at, remote_updated_at,
        installed_at, installed_device_label, installed_file_id, installed_filename, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFile = rawDb.prepare(`
      INSERT INTO catalog_release_files (
        release_id, remote_url, download_url, remote_path, local_path,
        filename, display_label, file_role, file_size_bytes, status, discovered_at, downloaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // 1. Up-to-date installed game
    const idUpToDate = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/up-to-date/',
        'snes-rom/up-to-date',
        '/tmp/roms/snes-rom/up-to-date',
        'snes-rom',
        'Retail ROM',
        '["Retail ROM"]',
        'Up To Date Quest',
        1024,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-10T10:00:00.000Z',
        '2026-11-05T00:00:00.000Z',
        '2026-11-10T10:05:00.000Z',
        'MIYOO',
        101,
        'Up To Date Quest.sfc',
        null,
      ).lastInsertRowid,
    );

    // 2. Local-ready update (downloaded 1 hour after installed)
    const idLocalReady = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/local-ready/',
        'snes-rom/local-ready',
        '/tmp/roms/snes-rom/local-ready',
        'snes-rom',
        'Hack',
        '["Hack"]',
        'Super Hack Redux',
        2048,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-15T12:00:00.000Z',
        '2026-11-15T11:00:00.000Z',
        '2026-11-10T10:00:00.000Z',
        'MIYOO',
        201,
        'Super Hack Redux v1.0.sfc',
        null,
      ).lastInsertRowid,
    );

    // 3. Remote-only update (RGT updated after both download and install, no downloadHints yet)
    const idRemoteOnly = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/remote-only/',
        'snes-rom/remote-only',
        '/tmp/roms/snes-rom/remote-only',
        'snes-rom',
        'English Translation',
        '["English Translation"]',
        'Translated JRPG',
        4096,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-10T09:00:00.000Z',
        '2026-11-20T09:00:00.000Z',
        '2026-11-10T10:00:00.000Z',
        'MIYOO',
        301,
        'Translated JRPG v1.0.sfc',
        null,
      ).lastInsertRowid,
    );

    // 4. WordPress metadata-only edit: remote_updated_at bumped, but downloadHints already match mirrored file!
    const idMetadataOnlyBump = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/meta-only-bump/',
        'snes-rom/meta-only-bump',
        '/tmp/roms/snes-rom/meta-only-bump',
        'snes-rom',
        'Retail ROM',
        '["Retail ROM"]',
        'Metadata Edited Classic',
        3072,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-10T09:00:00.000Z',
        '2026-11-21T15:00:00.000Z',
        '2026-11-10T10:00:00.000Z',
        'MIYOO',
        401,
        'Metadata Edited Classic (USA).sfc',
        JSON.stringify({
          downloadHints: [{ filename: 'Metadata Edited Classic (USA).zip', fileSize: '3.0 KB' }],
        }),
      ).lastInsertRowid,
    );
    insertFile.run(
      idMetadataOnlyBump,
      'https://retrogametalk.com/repo/snes-rom/meta-only-bump/#f1',
      'https://retrogametalk.com/dl/meta-only-bump.zip',
      'snes-rom/meta-only-bump/Metadata Edited Classic (USA).zip',
      '/tmp/roms/snes-rom/meta-only-bump/Metadata Edited Classic (USA).zip',
      'Metadata Edited Classic (USA).zip',
      'Metadata Edited Classic (USA).zip',
      'ROM',
      3072,
      'downloaded',
      '2026-11-10T09:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
    );

    // 5. Genuine remote update with downloadHints advertising a new file not yet mirrored locally
    const idRemoteWithNewHint = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/remote-new-hint/',
        'snes-rom/remote-new-hint',
        '/tmp/roms/snes-rom/remote-new-hint',
        'snes-rom',
        'Hack',
        '["Hack"]',
        'New Version Hack',
        5120,
        'downloaded',
        '2026-11-01T00:00:00.000Z',
        '2026-11-10T09:00:00.000Z',
        '2026-11-21T16:00:00.000Z',
        '2026-11-10T10:00:00.000Z',
        'MIYOO',
        501,
        'New Version Hack v1.0.sfc',
        JSON.stringify({
          downloadHints: [{ filename: 'New Version Hack v2.0.zip', fileSize: '5.0 KB' }],
        }),
      ).lastInsertRowid,
    );
    insertFile.run(
      idRemoteWithNewHint,
      'https://retrogametalk.com/repo/snes-rom/remote-new-hint/#f1',
      'https://retrogametalk.com/dl/new-version-v1.zip',
      'snes-rom/remote-new-hint/New Version Hack v1.0.zip',
      '/tmp/roms/snes-rom/remote-new-hint/New Version Hack v1.0.zip',
      'New Version Hack v1.0.zip',
      'New Version Hack v1.0.zip',
      'ROM',
      5120,
      'downloaded',
      '2026-11-10T09:00:00.000Z',
      '2026-11-10T09:00:00.000Z',
    );

    // 6. Not installed game
    insertRelease.run(
      'https://retrogametalk.com/repo/snes-rom/uninstalled/',
      'snes-rom/uninstalled',
      '/tmp/roms/snes-rom/uninstalled',
      'snes-rom',
      'Retail ROM',
      '["Retail ROM"]',
      'Uninstalled Classic',
      512,
      'downloaded',
      '2026-11-01T00:00:00.000Z',
      '2026-11-20T10:00:00.000Z',
      '2026-11-19T10:00:00.000Z',
      null,
      null,
      null,
      null,
      null,
    );

    // Query outdated filter & facet counts (must exclude idMetadataOnlyBump!)
    const outdatedQuery = db.queryRepositoryItems({ installed: 'outdated', limit: 20, offset: 0 });
    assert.equal(outdatedQuery.total, 3);
    assert.deepEqual(
      outdatedQuery.items.map((i) => i.id).sort((a, b) => a - b),
      [idLocalReady, idRemoteOnly, idRemoteWithNewHint].sort((a, b) => a - b),
    );
    assert.equal(outdatedQuery.facets.counts?.installed?.installed, 5);
    assert.equal(outdatedQuery.facets.counts?.installed?.notInstalled, 1);
    assert.equal(outdatedQuery.facets.counts?.installed?.outdated, 3);

    // Verify status totals match Catalog query & facets 100%
    const { totals } = db.getCatalogTotalsAndSystems();
    assert.equal(totals.installedItems, 5);
    assert.equal(totals.outdatedInstalledItems, 3);
    assert.equal(totals.outdatedLocalReadyItems, 1);

    // Verify listOutdatedInstalledItems matches JS classification
    const summary = db.listOutdatedInstalledItems();
    assert.equal(summary.total, 3);
    assert.equal(summary.localReadyCount, 1);
    assert.equal(summary.remoteOnlyCount, 2);
    assert.deepEqual(summary.localReadyIds, [idLocalReady]);
    assert.deepEqual(
      summary.remoteOnlyIds.slice().sort((a, b) => a - b),
      [idRemoteOnly, idRemoteWithNewHint].sort((a, b) => a - b),
    );

    // Verify markCatalogItemsQueuedDetailed queues genuine remote updates, skips up-to-date AND metadata-only bumps
    const queued = db.markCatalogItemsQueuedDetailed([
      idUpToDate,
      idMetadataOnlyBump,
      idRemoteOnly,
      idRemoteWithNewHint,
    ]);
    assert.deepEqual(
      queued.queuedIds.slice().sort((a, b) => a - b),
      [idRemoteOnly, idRemoteWithNewHint].sort((a, b) => a - b),
    );
    assert.deepEqual(
      queued.alreadyDownloadedIds.slice().sort((a, b) => a - b),
      [idUpToDate, idMetadataOnlyBump].sort((a, b) => a - b),
    );

    // Simulate download queue verifying idRemoteOnly on live RGT with 0 new files (all skipped on disk):
    // markCatalogReleaseRemoteChecked clears remote alert without bumping downloaded_at (must NOT become update_ready_local!)
    rawDb.prepare("UPDATE catalog_releases SET status = 'downloaded' WHERE id = ?").run(idRemoteOnly);
    db.markCatalogReleaseRemoteChecked(idRemoteOnly, '2026-11-20T08:50:00.000Z'); // intentionally slightly earlier to test clock-skew clamping
    const verifiedRecord = db.getRepositoryItemById(idRemoteOnly);
    assert.ok(verifiedRecord);
    assert.equal(verifiedRecord.downloadedAt, '2026-11-10T09:00:00.000Z');
    assert.equal(verifiedRecord.remoteCheckedAt, '2026-11-20T09:00:00.000Z');
    assert.equal(classifyInstalledUpdateState(verifiedRecord).state, 'up_to_date');

    // Re-queueing the verified release must NOT loop!
    const reQueueAttempt = db.markCatalogItemsQueuedDetailed([idRemoteOnly]);
    assert.deepEqual(reQueueAttempt.queuedIds, []);
    assert.deepEqual(reQueueAttempt.alreadyDownloadedIds, [idRemoteOnly]);

    // Totals, facets, query, and listOutdatedInstalledItems all drop by 1 immediately
    const afterVerifyTotals = db.getCatalogTotalsAndSystems().totals;
    assert.equal(afterVerifyTotals.outdatedInstalledItems, 2);
    assert.equal(afterVerifyTotals.outdatedLocalReadyItems, 1);
    assert.equal(db.queryRepositoryItems({ installed: 'outdated', limit: 20, offset: 0 }).total, 2);
    assert.equal(db.listOutdatedInstalledItems().remoteOnlyCount, 1);

    // If RGT later publishes a genuinely newer timestamp past remote_checked_at, it re-triggers detection
    rawDb
      .prepare('UPDATE catalog_releases SET remote_updated_at = ? WHERE id = ?')
      .run('2026-11-22T12:00:00.000Z', idRemoteOnly);
    const afterLaterBump = db.getRepositoryItemById(idRemoteOnly);
    assert.equal(classifyInstalledUpdateState(afterLaterBump).state, 'update_available_remote');
    assert.equal(db.listOutdatedInstalledItems().remoteOnlyCount, 2);

    // Verify setCatalogItemsInstalled persists itemMeta and clears outdated state after upgrade
    const upgraded = db.setCatalogItemsInstalled({
      ids: [idLocalReady],
      installed: true,
      deviceLabel: 'MIYOO',
      itemMeta: {
        [idLocalReady]: { fileId: 202, filename: 'Super Hack Redux v2.0.sfc' },
      },
    });
    assert.equal(upgraded.updated, 1);
    assert.equal(upgraded.items[0]?.installedFileId, 202);
    assert.equal(upgraded.items[0]?.installedFilename, 'Super Hack Redux v2.0.sfc');
    assert.equal(classifyInstalledUpdateState(upgraded.items[0]).state, 'up_to_date');

    const afterUpgradeSummary = db.listOutdatedInstalledItems();
    assert.equal(afterUpgradeSummary.localReadyCount, 0);
    assert.deepEqual(afterUpgradeSummary.localReadyIds, []);

    // Clearing installed flag clears installed_file_id and installed_filename too
    const cleared = db.setCatalogItemsInstalled({
      ids: [idLocalReady],
      installed: false,
    });
    assert.equal(cleared.items[0]?.installedAt, null);
    assert.equal(cleared.items[0]?.installedFileId, null);
    assert.equal(cleared.items[0]?.installedFilename, null);
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
