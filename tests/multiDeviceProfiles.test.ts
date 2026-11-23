import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  findItemInstallForDevice,
  formatInstalledDevicesBadge,
  makeStableDeviceProfileId,
  mergeProfileFolderConfig,
  sanitizeDeviceProfileId,
  sanitizeInstalledPathsList,
  sanitizeInstalledRelativePath,
} from '../src/shared/deviceProfiles.ts';
import {
  DEFAULT_ROM_TYPE_SUBFOLDERS,
  type StorageFolderMappingConfig,
} from '../src/shared/storageFolderMappings.ts';
import {
  LATEST_SCHEMA_VERSION,
  runDatabaseMigrations,
  SCHEMA_MIGRATIONS,
} from '../src/server/migrations.ts';
import type { ReleaseDeviceInstallRecord } from '../src/types.ts';
import {
  checkHandlePermission,
  requestHandlePermission,
} from '../src/utils/deviceHandleStore.ts';
import { isItemInstalledOnMountedDevice } from '../src/utils/deviceInstallView.ts';
import {
  removeRelativePathFromSdCard,
  removeStemFallbackFromSdCard,
  type SdDirectoryHandle,
  type SdFileHandle,
  type SdFileWritableStream,
} from '../src/utils/sdCardFs.ts';

function makeMockFileHandle(fileName: string, content: string): SdFileHandle {
  return {
    kind: 'file',
    name: fileName,
    async createWritable() {
      return {
        locked: false,
        getWriter() {
          throw new Error('not implemented in mock');
        },
        async write() {},
        async close() {},
        async abort() {},
      } as unknown as SdFileWritableStream;
    },
    async getFile() {
      return { size: content.length, name: fileName } as unknown as File;
    },
  };
}

function createMockDirectoryHandle(
  name: string,
  tree: Record<string, unknown>,
  options?: {
    queryPermission?: () => Promise<'granted' | 'prompt' | 'denied'>;
    requestPermission?: () => Promise<'granted' | 'prompt' | 'denied'>;
  },
): SdDirectoryHandle {
  const map = new Map<string, unknown>(Object.entries(tree));

  const makeNotFoundError = (entryName: string) => {
    const err = new Error(`Not found: ${entryName}`);
    err.name = 'NotFoundError';
    return err;
  };

  const dir: SdDirectoryHandle = {
    kind: 'directory',
    name,
    queryPermission: options?.queryPermission,
    requestPermission: options?.requestPermission,
    async getDirectoryHandle(subName: string, opts?: { create?: boolean }) {
      const existing = map.get(subName);
      if (
        existing &&
        typeof existing === 'object' &&
        'kind' in existing &&
        (existing as { kind: string }).kind === 'directory'
      ) {
        return existing as SdDirectoryHandle;
      }
      if (existing && typeof existing === 'object') {
        const child = createMockDirectoryHandle(subName, existing as Record<string, unknown>);
        map.set(subName, child);
        return child;
      }
      if (opts?.create) {
        const child = createMockDirectoryHandle(subName, {});
        map.set(subName, child);
        return child;
      }
      throw makeNotFoundError(subName);
    },
    async getFileHandle(fileName: string) {
      const existing = map.get(fileName);
      if (typeof existing === 'string') {
        return makeMockFileHandle(fileName, existing);
      }
      throw makeNotFoundError(fileName);
    },
    async removeEntry(entryName: string) {
      if (!map.has(entryName)) {
        throw makeNotFoundError(entryName);
      }
      map.delete(entryName);
    },
    async *values() {
      for (const [k, v] of map.entries()) {
        if (typeof v === 'string') {
          yield makeMockFileHandle(k, v);
        } else if (v && typeof v === 'object') {
          const child =
            'kind' in v
              ? (v as SdDirectoryHandle)
              : createMockDirectoryHandle(k, v as Record<string, unknown>);
          map.set(k, child);
          yield child;
        }
      }
    },
  };

  return dir;
}

test('deviceProfiles helpers validate paths, generate stable IDs, merge folder overrides, and format multi-device badges', () => {
  assert.equal(makeStableDeviceProfileId('Miyoo Mini+'), 'dev-miyoo-mini');
  assert.equal(makeStableDeviceProfileId('   '), 'dev-storage');
  assert.equal(sanitizeDeviceProfileId('dev-miyoo-mini'), 'dev-miyoo-mini');
  assert.equal(sanitizeDeviceProfileId('../etc/passwd'), null);
  assert.equal(sanitizeDeviceProfileId('a b c'), null);

  // Path confinement checks
  assert.equal(
    sanitizeInstalledRelativePath('SNES/Translations/Chrono Trigger.sfc'),
    'SNES/Translations/Chrono Trigger.sfc',
  );
  assert.equal(sanitizeInstalledRelativePath('/SNES\\Chrono.sfc'), 'SNES/Chrono.sfc');
  assert.equal(sanitizeInstalledRelativePath('../secret.txt'), null);
  assert.equal(sanitizeInstalledRelativePath('SNES/../../secret.txt'), null);
  assert.equal(sanitizeInstalledRelativePath('./SNES/game.sfc'), null);
  assert.equal(sanitizeInstalledRelativePath('C:\\ROMs\\game.sfc'), null);
  assert.equal(sanitizeInstalledRelativePath('SNES/bad\0name.sfc'), null);
  assert.equal(sanitizeInstalledRelativePath(''), null);

  assert.deepEqual(
    sanitizeInstalledPathsList([
      'SNES/Game.sfc',
      '../escape.sfc',
      'SNES/Game.sfc',
      'GBA/Mother 3.gba',
    ]),
    ['SNES/Game.sfc', 'GBA/Mother 3.gba'],
  );

  // Folder config merging
  const globalCfg: StorageFolderMappingConfig = {
    typeSubfoldersEnabled: true,
    globalTypeSubfolders: { ...DEFAULT_ROM_TYPE_SUBFOLDERS },
    systemFolders: { 'snes-rom': 'CustomSNES', 'gba-rom': 'CustomGBA' },
    systemTypeOverrides: {},
  };
  const profileOverride: StorageFolderMappingConfig = {
    typeSubfoldersEnabled: false,
    globalTypeSubfolders: { ...DEFAULT_ROM_TYPE_SUBFOLDERS },
    systemFolders: { 'snes-rom': 'Roms/SFC' },
    systemTypeOverrides: {},
  };
  const merged = mergeProfileFolderConfig(globalCfg, profileOverride);
  assert.equal(merged.typeSubfoldersEnabled, false);
  assert.equal(merged.systemFolders['snes-rom'], 'Roms/SFC');
  assert.equal(merged.systemFolders['gba-rom'], 'CustomGBA');

  // Badge formatting & active device lookup
  const installs: ReleaseDeviceInstallRecord[] = [
    {
      releaseId: 10,
      deviceId: 'dev-miyoo',
      deviceName: 'Miyoo Mini',
      volumeLabel: 'Roms',
      installedAt: '2026-11-23T01:00:00.000Z',
      installedFileId: 100,
      installedPaths: ['SFC/Chrono.sfc'],
      installedFilename: 'Chrono.sfc',
    },
    {
      releaseId: 10,
      deviceId: 'dev-deck',
      deviceName: 'Steam Deck',
      volumeLabel: 'DeckSD',
      installedAt: '2026-11-23T00:30:00.000Z',
      installedFileId: 100,
      installedPaths: ['snes/Chrono.sfc'],
      installedFilename: 'Chrono.sfc',
    },
  ];
  const multiItem = {
    installedAt: '2026-11-23T01:00:00.000Z',
    installedDeviceLabel: 'Miyoo Mini',
    installedFileId: 100,
    installedFilename: 'Chrono.sfc',
    deviceInstalls: installs,
  };

  const badge = formatInstalledDevicesBadge(multiItem);
  assert.equal(badge?.label, 'Installed · Miyoo Mini +1');
  assert.equal(badge?.tooltip, 'Installed on Miyoo Mini, Steam Deck');
  assert.equal(findItemInstallForDevice(multiItem, 'dev-deck', 'Steam Deck')?.deviceName, 'Steam Deck');
  assert.equal(findItemInstallForDevice(multiItem, 'dev-mister', 'MiSTer'), null);

  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'Steam Deck',
      activeDeviceId: 'dev-deck',
      deviceInstalls: multiItem.deviceInstalls,
      installedAt: multiItem.installedAt,
      installedDeviceLabel: multiItem.installedDeviceLabel,
    }),
    true,
  );
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'MiSTer',
      activeDeviceId: 'dev-mister',
      deviceInstalls: multiItem.deviceInstalls,
      installedAt: multiItem.installedAt,
      installedDeviceLabel: multiItem.installedDeviceLabel,
    }),
    false,
  );
});

test('deviceHandleStore permission checks and path-confined SD uninstall behave safely', async () => {
  const grantedDir = createMockDirectoryHandle(
    'Roms',
    {
      SNES: {
        Translations: {
          'Chrono Trigger (v1.2).sfc': 'ROMDATA',
          'Other Game.sfc': 'KEEPME',
        },
      },
    },
    {
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
    },
  );
  const promptDir = createMockDirectoryHandle(
    'Deck',
    {},
    {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'denied',
    },
  );
  const unsupportedDir = createMockDirectoryHandle('Legacy', {});

  assert.equal(await checkHandlePermission(grantedDir), 'granted');
  assert.equal(await checkHandlePermission(promptDir), 'prompt');
  assert.equal(await requestHandlePermission(promptDir), 'denied');
  assert.equal(await checkHandlePermission(unsupportedDir), 'unsupported');

  // Traversal attempts must be rejected as 'invalid' without touching files
  const escapeResult = await removeRelativePathFromSdCard(
    grantedDir,
    '../SNES/Translations/Other Game.sfc',
  );
  assert.equal(escapeResult.status, 'invalid');
  const driveEscape = await removeRelativePathFromSdCard(
    grantedDir,
    'C:\\Windows\\system32\\cmd.exe',
  );
  assert.equal(driveEscape.status, 'invalid');

  // Valid nested path is cleanly removed
  const removed = await removeRelativePathFromSdCard(
    grantedDir,
    'SNES/Translations/Chrono Trigger (v1.2).sfc',
  );
  assert.equal(removed.status, 'removed');
  assert.equal(removed.path, 'SNES/Translations/Chrono Trigger (v1.2).sfc');

  // Re-removing the same path yields 'not_found' without throwing
  const secondPass = await removeRelativePathFromSdCard(
    grantedDir,
    'SNES/Translations/Chrono Trigger (v1.2).sfc',
  );
  assert.equal(secondPass.status, 'not_found');

  // Sibling file remains untouched, and legacy stem fallback removes matching file
  const fallbackResult = await removeStemFallbackFromSdCard(
    grantedDir,
    'SNES/Translations',
    'Other Game.sfc',
  );
  assert.deepEqual(fallbackResult.removedPaths, ['SNES/Translations/Other Game.sfc']);
  assert.equal(fallbackResult.errors.length, 0);
});

test('SQLite migration v27 backfills legacy installs and supports multi-device CRUD, deviceId scoping, and rollups', async () => {
  assert.ok(
    LATEST_SCHEMA_VERSION >= 27,
    `Expected LATEST_SCHEMA_VERSION >= 27, got ${LATEST_SCHEMA_VERSION}`,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-multidev-db-'));
  const dataDir = path.join(tmpDir, 'data');
  const downloadDir = path.join(tmpDir, 'roms');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  // 1. Test explicit v26 -> v27 backfill migration on an isolated pre-v27 SQLite DB
  const memDb = new Database(':memory:');
  try {
    const preV27Migrations = SCHEMA_MIGRATIONS.filter((m) => m.version <= 26);
    runDatabaseMigrations(
      memDb,
      { dataDir, defaultDownloadDir: downloadDir },
      preV27Migrations,
    );

    memDb
      .prepare(
        `INSERT INTO catalog_releases (
           remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
           title, file_size_bytes, status, discovered_at, installed_at, installed_device_label, installed_filename
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'https://retrogametalk.com/repo/snes-rom/chrono/',
        'snes-rom/chrono',
        'snes-rom/chrono.zip',
        'snes-rom',
        'Retail',
        '["Retail"]',
        'Chrono Trigger',
        4_000_000,
        'downloaded',
        '2026-11-20T00:00:00.000Z',
        '2026-11-22T12:00:00.000Z',
        'Miyoo Mini',
        'Chrono Trigger.sfc',
      );
    memDb
      .prepare(
        `INSERT INTO catalog_releases (
           remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
           title, file_size_bytes, status, discovered_at, installed_at, installed_device_label, installed_filename
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'https://retrogametalk.com/repo/snes-rom/earthbound/',
        'snes-rom/earthbound',
        'snes-rom/earthbound.zip',
        'snes-rom',
        'Retail',
        '["Retail"]',
        'EarthBound',
        3_000_000,
        'downloaded',
        '2026-11-20T00:00:00.000Z',
        '2026-11-22T13:00:00.000Z',
        null,
        'EarthBound.sfc',
      );

    const summary = runDatabaseMigrations(
      memDb,
      { dataDir, defaultDownloadDir: downloadDir },
      SCHEMA_MIGRATIONS,
    );
    assert.ok(
      summary.appliedNow.some((rec) => rec.version === 27),
      'Migration v27 should run on v26 DB',
    );

    const profiles = memDb
      .prepare('SELECT id, name, volume_label FROM storage_device_profiles ORDER BY id ASC')
      .all() as { id: string; name: string; volume_label: string }[];
    assert.equal(profiles.length, 2);
    assert.ok(profiles.some((p) => p.id === 'dev-miyoo-mini' && p.name === 'Miyoo Mini'));
    assert.ok(profiles.some((p) => p.id === 'dev-external-device' && p.name === 'External Device'));

    const backfilledInstalls = memDb
      .prepare(
        'SELECT release_id, device_id, installed_filename FROM catalog_release_device_installs ORDER BY release_id ASC',
      )
      .all() as { release_id: number; device_id: string; installed_filename: string | null }[];
    assert.equal(backfilledInstalls.length, 2);
    assert.equal(backfilledInstalls[0].device_id, 'dev-miyoo-mini');
    assert.equal(backfilledInstalls[0].installed_filename, 'Chrono Trigger.sfc');
    assert.equal(backfilledInstalls[1].device_id, 'dev-external-device');
  } finally {
    memDb.close();
  }

  // 2. Test full db.ts multi-device profile & install APIs in isolated temp DATA_DIR
  const prevDataDir = process.env.DATA_DIR;
  const prevDownloadDir = process.env.DOWNLOAD_DIR;
  process.env.DATA_DIR = dataDir;
  process.env.DOWNLOAD_DIR = downloadDir;

  try {
    const db = await import('../src/server/db.ts');
    const rawDb = db.initDb();

    const insertRelease = rawDb.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
        title, file_size_bytes, status, discovered_at, downloaded_at, remote_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const releaseA = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/snes-rom/chrono/',
        'snes-rom/chrono',
        'snes-rom/chrono.zip',
        'snes-rom',
        'English Translation',
        '["English Translation"]',
        'Chrono Trigger',
        4_000_000,
        'downloaded',
        '2026-11-20T00:00:00.000Z',
        '2026-11-22T00:00:00.000Z',
        '2026-11-21T00:00:00.000Z',
      ).lastInsertRowid,
    );
    const releaseB = Number(
      insertRelease.run(
        'https://retrogametalk.com/repo/gba-roms/mother3/',
        'gba-roms/mother3',
        'gba-roms/mother3.zip',
        'gba-roms',
        'English Translation',
        '["English Translation"]',
        'Mother 3',
        16_000_000,
        'downloaded',
        '2026-11-20T00:00:00.000Z',
        '2026-11-23T05:00:00.000Z',
        '2026-11-23T04:00:00.000Z',
      ).lastInsertRowid,
    );

    const miyoo = db.upsertStorageDeviceProfileOnMount({
      id: 'dev-miyoo',
      name: 'Miyoo Mini+',
      volumeLabel: 'Roms',
    });
    const deck = db.upsertStorageDeviceProfileOnMount({
      id: 'dev-deck',
      name: 'Steam Deck',
      volumeLabel: 'DeckSD',
    });

    // Install releaseA on both Miyoo and Steam Deck with distinct paths
    db.setCatalogItemsInstalled({
      ids: [releaseA],
      installed: true,
      deviceLabel: miyoo.name,
      deviceId: miyoo.id,
      itemMeta: {
        [releaseA]: {
          filename: 'Chrono Trigger.sfc',
          paths: ['SFC/Chrono Trigger.sfc'],
        },
      },
    });
    db.setCatalogItemsInstalled({
      ids: [releaseA],
      installed: true,
      deviceLabel: deck.name,
      deviceId: deck.id,
      itemMeta: {
        [releaseA]: {
          filename: 'Chrono Trigger (T-En).sfc',
          paths: ['snes/Translations/Chrono Trigger (T-En).sfc'],
        },
      },
    });

    // Install releaseB only on Miyoo with an older timestamp so it is outdated (downloaded_at is newer)
    rawDb
      .prepare(
        `INSERT INTO catalog_release_device_installs (release_id, device_id, installed_at, installed_paths_json, installed_filename)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        releaseB,
        miyoo.id,
        '2026-11-21T00:00:00.000Z',
        JSON.stringify(['GBA/Mother 3.gba']),
        'Mother 3.gba',
      );
    db.recomputeReleaseInstallRollups([releaseB]);

    // Verify deviceInstalls hydration on releaseA
    const itemA = db.getRepositoryItemById(releaseA);
    assert.ok(itemA);
    assert.equal(itemA.deviceInstalls?.length, 2);
    assert.ok(
      itemA.deviceInstalls?.some(
        (d) => d.deviceId === 'dev-miyoo' && d.installedPaths[0] === 'SFC/Chrono Trigger.sfc',
      ),
    );
    assert.ok(
      itemA.deviceInstalls?.some(
        (d) =>
          d.deviceId === 'dev-deck' &&
          d.installedPaths[0] === 'snes/Translations/Chrono Trigger (T-En).sfc',
      ),
    );

    // Query scoped to Steam Deck: only releaseA is installed, releaseB is NOT installed, 0 outdated
    const deckInstalled = db.queryRepositoryItems({
      installed: 'only',
      deviceId: deck.id,
      limit: 50,
      offset: 0,
    });
    assert.equal(deckInstalled.total, 1);
    assert.equal(deckInstalled.items[0].id, releaseA);
    assert.equal(deckInstalled.facets.counts?.installed?.installed, 1);
    assert.equal(deckInstalled.facets.counts?.installed?.notInstalled, 1);
    assert.equal(deckInstalled.facets.counts?.installed?.outdated, 0);

    // Query scoped to Miyoo: both releaseA and releaseB are installed, releaseB is outdated
    const miyooOutdated = db.queryRepositoryItems({
      installed: 'outdated',
      deviceId: miyoo.id,
      limit: 50,
      offset: 0,
    });
    assert.equal(miyooOutdated.total, 1);
    assert.equal(miyooOutdated.items[0].id, releaseB);
    assert.equal(miyooOutdated.facets.counts?.installed?.outdated, 1);

    const outdatedSummaryMiyoo = db.listOutdatedInstalledItems({ deviceId: miyoo.id });
    assert.equal(outdatedSummaryMiyoo.total, 1);
    assert.deepEqual(outdatedSummaryMiyoo.localReadyIds, [releaseB]);

    const outdatedSummaryDeck = db.listOutdatedInstalledItems({ deviceId: deck.id });
    assert.equal(outdatedSummaryDeck.total, 0);

    // Rename Miyoo profile & save custom romNaming
    const renamedMiyoo = db.updateStorageDeviceProfile(miyoo.id, {
      name: 'Living Room Miyoo',
      romNaming: { romMaxFilenameLen: 120 },
    });
    assert.equal(renamedMiyoo?.name, 'Living Room Miyoo');
    assert.equal(renamedMiyoo?.romNaming?.romMaxFilenameLen, 120);

    // Remove releaseA from Miyoo only -> Steam Deck remains intact and rollup still reflects Steam Deck
    db.removeDeviceInstalls(miyoo.id, [releaseA]);
    const itemAAfterRemoveMiyoo = db.getRepositoryItemById(releaseA);
    assert.equal(itemAAfterRemoveMiyoo?.deviceInstalls?.length, 1);
    assert.equal(itemAAfterRemoveMiyoo?.deviceInstalls?.[0].deviceId, deck.id);
    assert.equal(itemAAfterRemoveMiyoo?.installedDeviceLabel, deck.name);
    assert.ok(itemAAfterRemoveMiyoo?.installedAt);

    // Delete Steam Deck profile -> cascades install row and clears releaseA rollup completely
    const deleteDeckRes = db.deleteStorageDeviceProfile(deck.id);
    assert.equal(deleteDeckRes.deleted, true);
    assert.deepEqual(deleteDeckRes.affectedReleaseIds, [releaseA]);
    const itemAAfterDeleteDeck = db.getRepositoryItemById(releaseA);
    assert.equal(itemAAfterDeleteDeck?.deviceInstalls?.length ?? 0, 0);
    assert.equal(itemAAfterDeleteDeck?.installedAt, null);
    assert.equal(itemAAfterDeleteDeck?.installedDeviceLabel, null);
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
