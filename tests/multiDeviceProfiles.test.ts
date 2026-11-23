import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import {
  DEVICE_MARKER_FILENAME,
  DEVICE_MARKER_MAX_BYTES,
  findItemInstallForDevice,
  formatInstalledDevicesBadge,
  formatMuosDeviceId,
  generateUuidDeviceProfileId,
  guessDefaultDeviceIcon,
  isGenericStorageFolderName,
  makeStableDeviceProfileId,
  mergeProfileFolderConfig,
  parseAutorunInfLabel,
  parseDeviceMarkerJson,
  parseHostnameFromConf,
  resolveSuggestedDeviceIdentity,
  sanitizeDeviceColorKey,
  sanitizeDeviceIconKey,
  sanitizeDeviceProfileId,
  sanitizeInstalledPathsList,
  sanitizeInstalledRelativePath,
  serializeDeviceMarkerJson,
  sortDeviceProfilesForFleet,
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
import type { ReleaseDeviceInstallRecord, StorageDeviceProfile } from '../src/types.ts';
import {
  checkHandlePermission,
  findMatchingStoredDeviceHandle,
  requestHandlePermission,
  type StoredDeviceHandleRecord,
} from '../src/utils/deviceHandleStore.ts';
import { isItemInstalledOnMountedDevice } from '../src/utils/deviceInstallView.ts';
import {
  probeDeviceIdentityHintsFromSdCard,
  readDeviceMarkerFromSdCard,
  removeRelativePathFromSdCard,
  removeStemFallbackFromSdCard,
  scanTargetFolder,
  writeDeviceMarkerToSdCard,
  type SdDirectoryHandle,
  type SdFileHandle,
  type SdFileWritableStream,
} from '../src/utils/sdCardFs.ts';

function makeMockFileHandle(
  fileName: string,
  initialContent: string,
  onWrite?: (nextContent: string) => void,
  readOnly?: boolean,
): SdFileHandle {
  let content = initialContent;
  return {
    kind: 'file',
    name: fileName,
    async createWritable() {
      if (readOnly) {
        const err = new Error('Read-only storage medium');
        err.name = 'NotAllowedError';
        throw err;
      }
      let nextBuffer = '';
      return {
        locked: false,
        getWriter() {
          throw new Error('not implemented in mock');
        },
        async write(data: Uint8Array | ArrayBuffer | Blob | string) {
          if (typeof data === 'string') {
            nextBuffer += data;
          } else if (data instanceof Uint8Array) {
            nextBuffer += new TextDecoder().decode(data);
          } else if (data instanceof ArrayBuffer) {
            nextBuffer += new TextDecoder().decode(new Uint8Array(data));
          }
        },
        async close() {
          content = nextBuffer;
          onWrite?.(content);
        },
        async abort() {},
      } as unknown as SdFileWritableStream;
    },
    async getFile() {
      const snapshot = content;
      return {
        size: Buffer.byteLength(snapshot, 'utf8'),
        name: fileName,
        async text() {
          return snapshot;
        },
      } as unknown as File;
    },
  };
}

function createMockDirectoryHandle(
  name: string,
  tree: Record<string, unknown>,
  options?: {
    readOnly?: boolean;
    entryId?: string;
    isSameEntry?: (other: SdDirectoryHandle) => Promise<boolean>;
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

  const dir: SdDirectoryHandle & { __entryId?: string } = {
    kind: 'directory',
    name,
    __entryId: options?.entryId,
    queryPermission: options?.queryPermission,
    requestPermission: options?.requestPermission,
    isSameEntry:
      options?.isSameEntry ||
      (async (other: SdDirectoryHandle) => {
        if (other === dir) return true;
        const otherId = (other as { __entryId?: string }).__entryId;
        return Boolean(options?.entryId && otherId && options.entryId === otherId);
      }),
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
        const child = createMockDirectoryHandle(subName, existing as Record<string, unknown>, {
          readOnly: options?.readOnly,
        });
        map.set(subName, child);
        return child;
      }
      if (opts?.create) {
        if (options?.readOnly) {
          const err = new Error('Read-only storage medium');
          err.name = 'NotAllowedError';
          throw err;
        }
        const child = createMockDirectoryHandle(subName, {}, { readOnly: options?.readOnly });
        map.set(subName, child);
        return child;
      }
      throw makeNotFoundError(subName);
    },
    async getFileHandle(fileName: string, opts?: { create?: boolean }) {
      const existing = map.get(fileName);
      if (typeof existing === 'string') {
        return makeMockFileHandle(
          fileName,
          existing,
          (next) => map.set(fileName, next),
          options?.readOnly,
        );
      }
      if (opts?.create) {
        if (options?.readOnly) {
          const err = new Error('Read-only storage medium');
          err.name = 'NotAllowedError';
          throw err;
        }
        map.set(fileName, '');
        return makeMockFileHandle(
          fileName,
          '',
          (next) => map.set(fileName, next),
          options?.readOnly,
        );
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
          yield makeMockFileHandle(k, v, (next) => map.set(k, next), options?.readOnly);
        } else if (v && typeof v === 'object') {
          const child =
            'kind' in v
              ? (v as SdDirectoryHandle)
              : createMockDirectoryHandle(k, v as Record<string, unknown>, {
                  readOnly: options?.readOnly,
                });
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

test('device marker validation, SD marker read/write, read-only fallback, and handle isSameEntry matching', async () => {
  // UUID generator and icon/color sanitizers
  const uuidId = generateUuidDeviceProfileId();
  assert.match(uuidId, /^dev_[a-z0-9-]+$/);
  assert.equal(sanitizeDeviceIconKey('clamshell'), 'clamshell');
  assert.equal(sanitizeDeviceIconKey('bogus-icon', 'sdcard'), 'sdcard');
  assert.equal(sanitizeDeviceColorKey('violet'), 'violet');
  assert.equal(sanitizeDeviceColorKey('neon-pink', 'cyan'), 'cyan');
  assert.equal(guessDefaultDeviceIcon('Miyoo Mini+'), 'vertical');
  assert.equal(guessDefaultDeviceIcon('RG35XX SP'), 'clamshell');
  assert.equal(guessDefaultDeviceIcon('MiSTer FPGA'), 'console');
  assert.equal(guessDefaultDeviceIcon('EverDrive N8'), 'sdcard');

  // Protected marker path must never be accepted as a removable ROM path
  assert.equal(sanitizeInstalledRelativePath(DEVICE_MARKER_FILENAME), null);
  assert.equal(sanitizeInstalledRelativePath('/.rgt-device.json'), null);

  // Valid serialize -> parse roundtrip
  const serialized = serializeDeviceMarkerJson({
    deviceId: uuidId,
    name: 'Analogue Pocket',
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T11:00:00.000Z',
  });
  const parsed = parseDeviceMarkerJson(serialized);
  assert.ok(parsed);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.deviceId, uuidId);
  assert.equal(parsed.name, 'Analogue Pocket');
  assert.equal(parsed.createdAt, '2026-11-23T10:00:00.000Z');

  // Reject malformed, oversized, wrong schemaVersion, and unsafe deviceId markers
  assert.equal(parseDeviceMarkerJson('not-json'), null);
  assert.equal(parseDeviceMarkerJson('[]'), null);
  assert.equal(
    parseDeviceMarkerJson(JSON.stringify({ schemaVersion: 2, deviceId: uuidId })),
    null,
  );
  assert.equal(
    parseDeviceMarkerJson(JSON.stringify({ schemaVersion: 1, deviceId: '../escape' })),
    null,
  );
  assert.equal(
    parseDeviceMarkerJson(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: uuidId,
        name: 'x'.repeat(DEVICE_MARKER_MAX_BYTES + 100),
      }),
    ),
    null,
  );

  // SD card marker write + read roundtrip + scanner exclusion + uninstall protection
  const writableCard = createMockDirectoryHandle(
    'Roms',
    { 'Chrono Trigger.sfc': 'ROM' },
    { entryId: 'card-phys-a' },
  );
  const beforeStamp = await readDeviceMarkerFromSdCard(writableCard);
  assert.equal(beforeStamp.found, false);
  assert.equal(beforeStamp.reason, 'not_found');

  const writeRes = await writeDeviceMarkerToSdCard(writableCard, {
    deviceId: uuidId,
    name: 'Living Room Miyoo',
  });
  assert.equal(writeRes.ok, true);
  assert.equal(writeRes.readOnly, false);
  assert.ok(writeRes.updatedAt);

  const afterStamp = await readDeviceMarkerFromSdCard(writableCard);
  assert.equal(afterStamp.found, true);
  assert.equal(afterStamp.marker?.deviceId, uuidId);
  assert.equal(afterStamp.marker?.name, 'Living Room Miyoo');

  // scanTargetFolder must ignore .rgt-device.json
  const scanned = await scanTargetFolder(writableCard, '');
  assert.equal(scanned.exactNames.has(DEVICE_MARKER_FILENAME), false);
  assert.equal(scanned.exactNames.has('Chrono Trigger.sfc'), true);

  // Direct uninstall of .rgt-device.json must be rejected as invalid
  const markerDeleteAttempt = await removeRelativePathFromSdCard(
    writableCard,
    DEVICE_MARKER_FILENAME,
  );
  assert.equal(markerDeleteAttempt.status, 'invalid');

  // Oversized & corrupted markers on disk return clean non-throwing failure reasons
  const oversizedCard = createMockDirectoryHandle('Roms', {
    [DEVICE_MARKER_FILENAME]: 'a'.repeat(DEVICE_MARKER_MAX_BYTES + 64),
  });
  const oversizedRes = await readDeviceMarkerFromSdCard(oversizedCard);
  assert.equal(oversizedRes.found, false);
  assert.equal(oversizedRes.reason, 'oversized');

  const corruptCard = createMockDirectoryHandle('Roms', {
    [DEVICE_MARKER_FILENAME]: '{bad json',
  });
  const corruptRes = await readDeviceMarkerFromSdCard(corruptCard);
  assert.equal(corruptRes.found, false);
  assert.equal(corruptRes.reason, 'invalid');

  // Read-only card degrades gracefully without throwing
  const readOnlyCard = createMockDirectoryHandle('Roms', {}, { readOnly: true });
  const readOnlyWrite = await writeDeviceMarkerToSdCard(readOnlyCard, {
    deviceId: uuidId,
    name: 'Write Protected Card',
  });
  assert.equal(readOnlyWrite.ok, false);
  assert.equal(readOnlyWrite.readOnly, true);

  // isSameEntry matching across stored handles (even with identical volume names & broken handles)
  const pickedCardA = createMockDirectoryHandle('Roms', {}, { entryId: 'card-phys-a' });
  const storedCardB = createMockDirectoryHandle('Roms', {}, { entryId: 'card-phys-b' });
  const brokenHandle = createMockDirectoryHandle('Roms', {}, {
    isSameEntry: async () => {
      throw new Error('Stale handle');
    },
  });
  const records: StoredDeviceHandleRecord[] = [
    {
      deviceId: 'dev_broken',
      volumeName: 'Roms',
      profileName: 'Broken',
      handle: brokenHandle,
      lastMountedAt: '2026-11-23T01:00:00.000Z',
    },
    {
      deviceId: 'dev_card_b',
      volumeName: 'Roms',
      profileName: 'Card B',
      handle: storedCardB,
      lastMountedAt: '2026-11-23T02:00:00.000Z',
    },
    {
      deviceId: 'dev_card_a',
      volumeName: 'Roms',
      profileName: 'Card A',
      handle: writableCard,
      lastMountedAt: '2026-11-23T00:30:00.000Z',
    },
  ];
  const matched = await findMatchingStoredDeviceHandle(pickedCardA, records);
  assert.equal(matched?.deviceId, 'dev_card_a');

  const pickedUnknown = createMockDirectoryHandle('Roms', {}, { entryId: 'card-phys-c' });
  assert.equal(await findMatchingStoredDeviceHandle(pickedUnknown, records), null);

  // Fleet sorting: Mounted -> Active Pinned -> Active Recent -> Archived
  const mkProfile = (overrides: Partial<StorageDeviceProfile>): StorageDeviceProfile => ({
    id: 'dev_x',
    name: 'Device',
    volumeLabel: 'Roms',
    iconKey: 'handheld',
    colorKey: 'phosphor',
    isPinned: false,
    isArchived: false,
    markerVerifiedAt: null,
    folderConfig: null,
    romNaming: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
    lastMountedAt: '2026-11-20T00:00:00.000Z',
    installedCount: 0,
    ...overrides,
  });
  const sorted = sortDeviceProfilesForFleet(
    [
      mkProfile({ id: 'dev_arch', name: 'Old', isArchived: true, lastMountedAt: '2026-11-23T12:00:00.000Z' }),
      mkProfile({ id: 'dev_recent', name: 'Recent', lastMountedAt: '2026-11-23T10:00:00.000Z' }),
      mkProfile({ id: 'dev_pinned', name: 'Pinned', isPinned: true, lastMountedAt: '2026-11-21T00:00:00.000Z' }),
      mkProfile({ id: 'dev_mounted', name: 'Mounted', lastMountedAt: '2026-11-19T00:00:00.000Z' }),
    ],
    'dev_mounted',
  );
  assert.deepEqual(
    sorted.map((p) => p.id),
    ['dev_mounted', 'dev_pinned', 'dev_recent', 'dev_arch'],
  );
});

test('SQLite migration v28 adds fleet metadata, prevents same-volume collisions on createNew, and orders fleet profiles', async () => {
  assert.ok(
    LATEST_SCHEMA_VERSION >= 28,
    `Expected LATEST_SCHEMA_VERSION >= 28, got ${LATEST_SCHEMA_VERSION}`,
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-fleet-v28-'));
  const dataDir = path.join(tmpDir, 'data');
  const downloadDir = path.join(tmpDir, 'roms');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  // 1. Explicit v27 -> v28 migration test on an isolated in-memory DB
  const memDb = new Database(':memory:');
  try {
    const preV28Migrations = SCHEMA_MIGRATIONS.filter((m) => m.version <= 27);
    runDatabaseMigrations(memDb, { dataDir, defaultDownloadDir: downloadDir }, preV28Migrations);

    memDb
      .prepare(
        `INSERT INTO storage_device_profiles (id, name, volume_label, created_at, updated_at, last_mounted_at)
         VALUES ('dev-legacy-miyoo', 'Legacy Miyoo', 'Roms', '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z')`,
      )
      .run();

    const summary = runDatabaseMigrations(
      memDb,
      { dataDir, defaultDownloadDir: downloadDir },
      SCHEMA_MIGRATIONS,
    );
    assert.ok(
      summary.appliedNow.some((rec) => rec.version === 28),
      'Migration v28 should apply cleanly onto v27 DB',
    );

    const row = memDb
      .prepare(
        `SELECT icon_key, color_key, is_pinned, is_archived, marker_verified_at
         FROM storage_device_profiles WHERE id = 'dev-legacy-miyoo'`,
      )
      .get() as {
      icon_key: string;
      color_key: string;
      is_pinned: number;
      is_archived: number;
      marker_verified_at: string | null;
    };
    assert.equal(row.icon_key, 'handheld');
    assert.equal(row.color_key, 'phosphor');
    assert.equal(row.is_pinned, 0);
    assert.equal(row.is_archived, 0);
    assert.equal(row.marker_verified_at, null);
  } finally {
    memDb.close();
  }

  // 2. Test db.ts v28 createNew collision prevention, pin/archive transitions, and icon/color install hydration
  const prevDataDir = process.env.DATA_DIR;
  const prevDownloadDir = process.env.DOWNLOAD_DIR;
  process.env.DATA_DIR = dataDir;
  process.env.DOWNLOAD_DIR = downloadDir;

  try {
    const db = await import('../src/server/db.ts');
    db.initDb();

    // Two different physical cards both mounted with volumeLabel = "Roms"
    const cardA = db.upsertStorageDeviceProfileOnMount({
      createNew: true,
      name: 'Miyoo Mini Plus',
      volumeLabel: 'Roms',
      iconKey: 'vertical',
      colorKey: 'amber',
      isPinned: true,
      markerVerifiedAt: '2026-11-23T12:00:00.000Z',
    });
    const cardB = db.upsertStorageDeviceProfileOnMount({
      createNew: true,
      name: 'Retroid Pocket 5',
      volumeLabel: 'Roms',
      iconKey: 'handheld',
      colorKey: 'cyan',
      isPinned: false,
      markerVerifiedAt: '2026-11-23T12:05:00.000Z',
    });

    assert.notEqual(cardA.id, cardB.id);
    assert.match(cardA.id, /^dev_/);
    assert.match(cardB.id, /^dev_/);
    assert.equal(cardA.iconKey, 'vertical');
    assert.equal(cardA.colorKey, 'amber');
    assert.equal(cardA.isPinned, true);
    assert.equal(cardA.markerVerifiedAt, '2026-11-23T12:00:00.000Z');
    assert.equal(cardB.iconKey, 'handheld');
    assert.equal(cardB.colorKey, 'cyan');

    // Archiving a pinned device automatically unpins it and moves it to the end of listStorageDeviceProfiles
    const archivedA = db.updateStorageDeviceProfile(cardA.id, {
      isArchived: true,
    });
    assert.equal(archivedA?.isArchived, true);
    assert.equal(archivedA?.isPinned, false);

    const listed = db.listStorageDeviceProfiles();
    const idxB = listed.findIndex((p) => p.id === cardB.id);
    const idxA = listed.findIndex((p) => p.id === cardA.id);
    assert.ok(idxB >= 0 && idxA >= 0);
    assert.ok(idxB < idxA, 'Active device should sort before archived device');

    // Re-mounting via explicit hardware marker ID updates the exact profile and restores metadata cleanly
    const remountedB = db.upsertStorageDeviceProfileOnMount({
      id: cardB.id,
      volumeLabel: 'Roms',
      markerVerifiedAt: '2026-11-23T13:00:00.000Z',
    });
    assert.equal(remountedB.id, cardB.id);
    assert.equal(remountedB.name, 'Retroid Pocket 5');
    assert.equal(remountedB.iconKey, 'handheld');
    assert.equal(remountedB.colorKey, 'cyan');
    assert.equal(remountedB.markerVerifiedAt, '2026-11-23T13:00:00.000Z');
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('smart device label probing prefers on-card labels and firmware signatures over generic folder names', async () => {
  // Generic folder / bare drive letter detection
  assert.equal(isGenericStorageFolderName('Roms'), true);
  assert.equal(isGenericStorageFolderName('SDCARD'), true);
  assert.equal(isGenericStorageFolderName('NO NAME'), true);
  assert.equal(isGenericStorageFolderName('E:'), true);
  assert.equal(isGenericStorageFolderName('E:\\'), true);
  assert.equal(isGenericStorageFolderName('MIYOO_MINI'), false);
  assert.equal(isGenericStorageFolderName('SteamDeck_512'), false);

  // Metadata parsers
  assert.equal(parseAutorunInfLabel('[autorun]\nicon=card.ico\nlabel=Retroid Pocket 5\n'), 'Retroid Pocket 5');
  assert.equal(parseAutorunInfLabel('[autorun]\nlabel=Roms\n'), null);
  assert.equal(parseHostnameFromConf('# system.hostname=BATOCERA\nsystem.hostname=LivingRoom-Pi\n'), 'LivingRoom-Pi');
  assert.equal(parseHostnameFromConf('system.hostname=BATOCERA\n'), null);
  assert.equal(formatMuosDeviceId('rg35xx-sp\n'), 'Anbernic RG35XX SP');
  assert.equal(formatMuosDeviceId('trimui-brick'), 'Trimui Brick');

  // 1. autorun.inf explicit label overrides generic E: drive root
  const autorunCard = createMockDirectoryHandle('E:', {
    'autorun.inf': '[autorun]\nlabel=Miyoo Flip 256GB\n',
    Roms: {},
  });
  const autorunHints = await probeDeviceIdentityHintsFromSdCard(autorunCard);
  const autorunResolved = resolveSuggestedDeviceIdentity({
    volumeLabel: 'E:',
    probeHints: autorunHints,
  });
  assert.equal(autorunResolved.suggestedName, 'Miyoo Flip 256GB');
  assert.equal(autorunResolved.detectedHintSource, 'autorun.inf');
  assert.equal(autorunResolved.isGenericFolderName, true);

  // 2. muOS card with MUOS/info/config/device.txt resolves exact model & clamshell icon
  const muosCard = createMockDirectoryHandle('SDCARD', {
    MUOS: { info: { config: { 'device.txt': 'rg35xx-sp\n' } } },
    ROMS: {},
  });
  const muosHints = await probeDeviceIdentityHintsFromSdCard(muosCard);
  const muosResolved = resolveSuggestedDeviceIdentity({
    volumeLabel: 'SDCARD',
    probeHints: muosHints,
  });
  assert.equal(muosResolved.suggestedName, 'Anbernic RG35XX SP');
  assert.equal(muosResolved.suggestedIconKey, 'clamshell');

  // 3. OnionOS root with generic folder name suggests Miyoo Mini (OnionOS) & vertical icon
  const onionCard = createMockDirectoryHandle('SDCARD', {
    '.tmp_update': {},
    Roms: {},
    Emu: {},
  });
  const onionHints = await probeDeviceIdentityHintsFromSdCard(onionCard);
  const onionResolved = resolveSuggestedDeviceIdentity({
    volumeLabel: 'SDCARD',
    probeHints: onionHints,
  });
  assert.equal(onionResolved.suggestedName, 'Miyoo Mini (OnionOS)');
  assert.equal(onionResolved.suggestedIconKey, 'vertical');

  // 4. Non-generic OS mount root (e.g. /Volumes/MIYOO_MINI) keeps the volume label directly
  const macVolumeCard = createMockDirectoryHandle('MIYOO_MINI', {
    Roms: {},
  });
  const macHints = await probeDeviceIdentityHintsFromSdCard(macVolumeCard);
  const macResolved = resolveSuggestedDeviceIdentity({
    volumeLabel: 'MIYOO_MINI',
    probeHints: macHints,
  });
  assert.equal(macResolved.suggestedName, 'MIYOO_MINI');
  assert.equal(macResolved.isGenericFolderName, false);
  assert.equal(macResolved.suggestedIconKey, 'vertical');

  // 5. Plain generic subfolder ("Roms") with no firmware hints leaves suggestedName empty for quick typing
  const plainRomsDir = createMockDirectoryHandle('Roms', {
    SNES: {},
    GBA: {},
  });
  const plainHints = await probeDeviceIdentityHintsFromSdCard(plainRomsDir);
  const plainResolved = resolveSuggestedDeviceIdentity({
    volumeLabel: 'Roms',
    probeHints: plainHints,
  });
  assert.equal(plainResolved.suggestedName, '');
  assert.equal(plainResolved.isGenericFolderName, true);
  assert.equal(plainResolved.detectedHintLabel, null);
});

test('cross-page bulk uninstall queries and deletes >1,000 installed items safely across SQLite chunks', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-bulk-uninstall-test-'));
  const prevDataDir = process.env.DATA_DIR;
  const prevDownloadDir = process.env.DOWNLOAD_DIR;
  try {
    process.env.DATA_DIR = path.join(tmpDir, 'data');
    process.env.DOWNLOAD_DIR = path.join(tmpDir, 'downloads');

    const db = await import(`../src/server/db.ts?bulk-uninstall=${Date.now()}`);
    const rawDb = db.initDb();

    const miyoo = db.upsertStorageDeviceProfileOnMount({
      volumeLabel: 'MIYOO_256GB',
      name: 'MIYOO_256GB',
      createNew: true,
    });
    const deck = db.upsertStorageDeviceProfileOnMount({
      volumeLabel: 'STEAM_DECK',
      name: 'Steam Deck',
      createNew: true,
    });

    // Seed 1,050 SNES releases (exceeds both the 150-row page size and SQLite's 999 variable limit)
    const now = new Date().toISOString();
    const insertRelease = rawDb.prepare(
      `INSERT INTO catalog_releases (
         remote_url, remote_path, local_path, system_name, release_type, release_tags_json,
         title, file_size_bytes, status, discovered_at, downloaded_at
       ) VALUES (?, ?, ?, 'snes-rom', 'Translation', '["Translation"]', ?, 1048576, 'downloaded', ?, ?)`,
    );
    const insertFile = rawDb.prepare(
      `INSERT INTO catalog_release_files (
         release_id, remote_url, download_url, remote_path, local_path, filename,
         display_label, file_role, file_size_bytes, status, discovered_at, downloaded_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ROM', 1048576, 'downloaded', ?, ?)`,
    );

    const allReleaseIds: number[] = [];
    const miyooInstalledIds: number[] = [];
    const seedTx = rawDb.transaction(() => {
      for (let i = 1; i <= 1050; i += 1) {
        const remotePath = `snes-rom/game-${i}`;
        const info = insertRelease.run(
          `https://retrogametalk.com/repo/${remotePath}/`,
          remotePath,
          `${remotePath}.zip`,
          `SNES Game ${i}`,
          now,
          now,
        );
        const rid = Number(info.lastInsertRowid);
        allReleaseIds.push(rid);
        insertFile.run(
          rid,
          `https://retrogametalk.com/repo/${remotePath}/file.zip`,
          `https://retrogametalk.com/repo/${remotePath}/download`,
          `${remotePath}.zip`,
          `${remotePath}.zip`,
          `SNES Game ${i}.zip`,
          `SNES Game ${i}.zip`,
          now,
          now,
        );
        // Install 1,010 of them on MIYOO_256GB (first 1,000 with explicit paths, last 10 legacy without paths)
        if (i <= 1010) {
          miyooInstalledIds.push(rid);
        }
      }
    });
    seedTx();

    // Mark 1,010 installed on MIYOO_256GB
    const insertInstall = rawDb.prepare(
      `INSERT INTO catalog_release_device_installs (
         release_id, device_id, installed_at, installed_filename, installed_paths_json
       ) VALUES (?, ?, ?, ?, ?)`,
    );
    const installTx = rawDb.transaction(() => {
      for (let idx = 0; idx < miyooInstalledIds.length; idx += 1) {
        const rid = miyooInstalledIds[idx];
        const hasPaths = idx < 1000;
        insertInstall.run(
          rid,
          miyoo.id,
          now,
          hasPaths ? `SNES Game ${idx + 1}.sfc` : null,
          hasPaths ? JSON.stringify([`SFC/SNES Game ${idx + 1}.sfc`]) : '[]',
        );
      }
      // Also install the first 5 games on Steam Deck to verify multi-device rollup preservation
      for (let idx = 0; idx < 5; idx += 1) {
        insertInstall.run(
          miyooInstalledIds[idx],
          deck.id,
          now,
          `SNES Game ${idx + 1}.sfc`,
          JSON.stringify([`snes/SNES Game ${idx + 1}.sfc`]),
        );
      }
    });
    installTx();
    db.recomputeReleaseInstallRollups(miyooInstalledIds);

    // 1. queryRepositoryItemIds with mountedDeviceId returns ALL 1,010 installed IDs across pages
    const idResult = db.queryRepositoryItemIds({
      system: 'snes-rom',
      mountedDeviceId: miyoo.id,
    });
    assert.equal(idResult.total, 1050);
    assert.equal(idResult.installedOnMountedIds.length, 1010);

    // Filtered specifically to installed on MIYOO_256GB returns 1,010 matching and 1,010 installedOnMountedIds
    const installedFilterResult = db.queryRepositoryItemIds({
      system: 'snes-rom',
      installed: 'only',
      deviceId: miyoo.id,
      mountedDeviceId: miyoo.id,
    });
    assert.equal(installedFilterResult.total, 1010);
    assert.equal(installedFilterResult.installedOnMountedIds.length, 1010);

    // 2. getDeviceUninstallTargets resolves all 1,010 targets cleanly (including fallbackFilename for legacy rows)
    const targets = db.getDeviceUninstallTargets(miyoo.id, allReleaseIds);
    assert.equal(targets.length, 1010);
    assert.equal(targets[0].id, miyooInstalledIds[0]);
    assert.deepEqual(targets[0].installedPaths, ['SFC/SNES Game 1.sfc']);
    assert.equal(targets[0].installedFilename, 'SNES Game 1.sfc');

    // Legacy item (idx 1005 -> no installedPaths, no installedFilename) resolves fallbackFilename from catalog_release_files
    const legacyTarget = targets[1005];
    assert.deepEqual(legacyTarget.installedPaths, []);
    assert.equal(legacyTarget.installedFilename, null);
    assert.equal(legacyTarget.fallbackFilename, 'SNES Game 1006.zip');

    // 3. removeDeviceInstalls deletes all 1,010 device installs cleanly across SQLite chunks
    const removed = db.removeDeviceInstalls(miyoo.id, miyooInstalledIds);
    assert.equal(removed.removed, 1010);
    assert.equal(removed.items.length, 1010);

    // Verify MIYOO_256GB now has 0 installed SNES games, while Steam Deck retains its 5 games
    const afterMiyoo = db.queryRepositoryItemIds({
      system: 'snes-rom',
      mountedDeviceId: miyoo.id,
    });
    assert.equal(afterMiyoo.installedOnMountedIds.length, 0);

    const afterDeck = db.queryRepositoryItemIds({
      system: 'snes-rom',
      mountedDeviceId: deck.id,
    });
    assert.equal(afterDeck.installedOnMountedIds.length, 5);

    // Verify rollup for a dual-installed item switched cleanly to Steam Deck, while single-device item cleared
    const dualItem = removed.items.find((item: { id: number }) => item.id === miyooInstalledIds[0]);
    const singleItem = removed.items.find((item: { id: number }) => item.id === miyooInstalledIds[10]);
    assert.equal(dualItem?.installedDeviceLabel, 'Steam Deck');
    assert.equal(dualItem?.deviceInstalls.length, 1);
    assert.equal(singleItem?.installedAt, null);
    assert.equal(singleItem?.installedDeviceLabel, null);
    assert.equal(singleItem?.deviceInstalls.length, 0);
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});



