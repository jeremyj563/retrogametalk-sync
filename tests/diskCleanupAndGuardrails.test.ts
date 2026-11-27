import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import {
  DEFAULT_MIN_FREE_DISK_GB,
  GIB_BYTES,
  evaluateDiskSpaceGuardrail,
  formatReserveGbLabel,
  minFreeDiskGbToBytes,
  normalizeMinFreeDiskGb,
} from '../src/shared/diskGuardrails.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-disk-cleanup-test-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');
const outsideDir = path.join(tempRoot, 'outside');
fs.mkdirSync(tempDataDir, { recursive: true });
fs.mkdirSync(tempDownloadDir, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;
delete process.env.SCRAPER_MIN_FREE_DISK_GB;

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('evaluateDiskSpaceGuardrail enforces reserve boundary, shortfall, disabled (0 GB), and unknown disk states', () => {
  assert.equal(normalizeMinFreeDiskGb(undefined), DEFAULT_MIN_FREE_DISK_GB);
  assert.equal(normalizeMinFreeDiskGb(-5), DEFAULT_MIN_FREE_DISK_GB);
  assert.equal(normalizeMinFreeDiskGb(2.55), 2.6);
  assert.equal(minFreeDiskGbToBytes(2), 2 * GIB_BYTES);
  assert.equal(formatReserveGbLabel(0), '0 GB');
  assert.equal(formatReserveGbLabel(2), '2 GB');
  assert.equal(formatReserveGbLabel(2.5), '2.5 GB');

  // Sufficient headroom: 10 GiB free, 2 GiB reserve -> 8 GiB usable, 5 GiB estimated -> fits
  const ok = evaluateDiskSpaceGuardrail({
    diskFreeBytes: 10 * GIB_BYTES,
    estimatedBytes: 5 * GIB_BYTES,
    minFreeDiskGb: 2,
  });
  assert.equal(ok.belowReserveNow, false);
  assert.equal(ok.exceedsUsable, false);
  assert.equal(ok.usableBytes, 8 * GIB_BYTES);
  assert.equal(ok.shortfallBytes, 0);

  // Exceeds usable free space: 5 GiB free, 2 GiB reserve -> 3 GiB usable, 4 GiB estimated -> 1 GiB shortfall
  const tight = evaluateDiskSpaceGuardrail({
    diskFreeBytes: 5 * GIB_BYTES,
    estimatedBytes: 4 * GIB_BYTES,
    minFreeDiskGb: 2,
  });
  assert.equal(tight.belowReserveNow, false);
  assert.equal(tight.exceedsUsable, true);
  assert.equal(tight.usableBytes, 3 * GIB_BYTES);
  assert.equal(tight.shortfallBytes, 1 * GIB_BYTES);

  // Already below reserve: 1 GiB free, 2 GiB reserve -> triggers even for 0-byte check
  const low = evaluateDiskSpaceGuardrail({
    diskFreeBytes: 1 * GIB_BYTES,
    estimatedBytes: 0,
    minFreeDiskGb: 2,
  });
  assert.equal(low.belowReserveNow, true);
  assert.equal(low.exceedsUsable, true);
  assert.equal(low.usableBytes, 0);

  // Disabled reserve (0 GB) only triggers if estimated exceeds raw free bytes
  const disabledFit = evaluateDiskSpaceGuardrail({
    diskFreeBytes: 1 * GIB_BYTES,
    estimatedBytes: 512 * 1024 * 1024,
    minFreeDiskGb: 0,
  });
  assert.equal(disabledFit.belowReserveNow, false);
  assert.equal(disabledFit.exceedsUsable, false);

  const disabledShort = evaluateDiskSpaceGuardrail({
    diskFreeBytes: 1 * GIB_BYTES,
    estimatedBytes: 2 * GIB_BYTES,
    minFreeDiskGb: 0,
  });
  assert.equal(disabledShort.belowReserveNow, false);
  assert.equal(disabledShort.exceedsUsable, true);
  assert.equal(disabledShort.shortfallBytes, 1 * GIB_BYTES);

  // Unknown disk telemetry (null) never produces false-positive warnings
  const unknown = evaluateDiskSpaceGuardrail({
    diskFreeBytes: null,
    estimatedBytes: 100 * GIB_BYTES,
    minFreeDiskGb: 2,
  });
  assert.equal(unknown.belowReserveNow, false);
  assert.equal(unknown.exceedsUsable, false);
  assert.equal(unknown.usableBytes, null);
});

test('SQLite v33 migration persists minFreeDiskGb and respects SCRAPER_MIN_FREE_DISK_GB override', async () => {
  const db = await import('../src/server/db.ts');
  const initial = db.getPublicConfig();
  assert.equal(initial.minFreeDiskGb, 2);

  const updated = db.updateConfig({ minFreeDiskGb: 5.5 });
  assert.equal(updated.minFreeDiskGb, 5.5);
  assert.equal(db.getPublicConfig().minFreeDiskGb, 5.5);

  const prevEnv = process.env.SCRAPER_MIN_FREE_DISK_GB;
  try {
    process.env.SCRAPER_MIN_FREE_DISK_GB = '12';
    const overridden = db.getPublicConfig();
    assert.equal(overridden.minFreeDiskGb, 12);
    assert.ok(overridden.envOverrides.includes('SCRAPER_MIN_FREE_DISK_GB'));
  } finally {
    if (prevEnv === undefined) {
      delete process.env.SCRAPER_MIN_FREE_DISK_GB;
    } else {
      process.env.SCRAPER_MIN_FREE_DISK_GB = prevEnv;
    }
  }
});

test('evictLocalFilesForReleaseIds removes archives & .part sidecars, prunes empty dirs, preserves metadata/install history, skips active downloads, and enforces path confinement', async () => {
  const db = await import('../src/server/db.ts');

  // 1. Standard downloaded release with archive + .part + .part.meta.json in dedicated dir (should prune empty dir)
  const rel1Dir = path.join(tempDownloadDir, 'psx-iso', 'Chrono Cross');
  fs.mkdirSync(rel1Dir, { recursive: true });
  const rel1Archive = path.join(rel1Dir, 'Chrono Cross (USA) (Disc 1).chd');
  const rel1Part = `${rel1Archive}.part`;
  const rel1PartMeta = `${rel1Archive}.part.meta.json`;
  fs.writeFileSync(rel1Archive, Buffer.alloc(4096, 0x41));
  fs.writeFileSync(rel1Part, Buffer.alloc(1024, 0x42));
  fs.writeFileSync(rel1PartMeta, JSON.stringify({ totalBytes: 4096 }));

  const rel1 = db.upsertCatalogRelease({
    remoteUrl: 'https://retrogametalk.com/repo/psx-iso/chrono-cross/',
    remotePath: '/repo/psx-iso/chrono-cross/',
    localPath: rel1Dir,
    systemName: 'psx-iso',
    title: 'Chrono Cross',
    status: 'downloaded',
    coverLocalPath: path.join(tempDataDir, 'cache', 'covers', 'chrono.jpg'),
    metadata: {
      title: 'Chrono Cross',
      subtitle: null,
      consoleName: 'PlayStation',
      publisher: 'Square',
      developer: 'Square',
      releaseYear: '2000',
      genres: ['RPG'],
      regions: ['USA'],
      languages: ['English'],
      sources: [],
      releaseTags: ['Retail ROM'],
      downloadsCount: null,
      releasedAgo: null,
      updatedDate: null,
      specs: [],
      descriptionHtml: '',
      descriptionText: 'Classic PlayStation RPG',
      coverUrl: null,
      coverLocalRelPath: null,
      screenshotUrls: [],
      screenshotLocalRelPaths: [],
      sourcePageUrl: 'https://retrogametalk.com/repo/psx-iso/chrono-cross/',
      fetchedAt: '2026-11-25T10:00:00.000Z',
    },
  });
  const { file: rel1File } = db.upsertReleaseFile({
    releaseId: rel1.id,
    remoteUrl: rel1.remoteUrl,
    downloadUrl: 'https://retrogametalk.com/download/chrono-disc1.chd',
    remotePath: '/download/chrono-disc1.chd',
    localPath: rel1Archive,
    filename: 'Chrono Cross (USA) (Disc 1).chd',
    fileSizeBytes: 4096,
    status: 'downloaded',
    downloadedAt: '2026-11-25T10:00:00.000Z',
  });

  // Mark favorite, add to a collection, and record a device install on rel1
  const col = db.createUserCollection({ name: 'PS1 Favorites' });
  db.setCatalogItemsFavorite({ ids: [rel1.id], favorite: true });
  db.addItemsToUserCollection(col.id, [rel1.id]);
  const device = db.upsertStorageDeviceProfileOnMount({
    name: 'Miyoo Mini Plus',
    volumeLabel: 'MIYOO',
  });
  db.setCatalogItemsInstalled({
    ids: [rel1.id],
    installed: true,
    deviceId: device.id,
    deviceLabel: device.name,
    installedFileId: rel1File.id,
    installedFilename: 'Chrono Cross (USA) (Disc 1).chd',
  });

  // 2. Release with cover.jpg & metadata.json inside its release dir (must NOT delete cover/metadata or non-empty dir)
  const rel2Dir = path.join(tempDownloadDir, 'snes-rom', 'Super Metroid');
  fs.mkdirSync(rel2Dir, { recursive: true });
  const rel2Archive = path.join(rel2Dir, 'Super Metroid (USA).zip');
  const rel2Cover = path.join(rel2Dir, 'cover.jpg');
  const rel2Meta = path.join(rel2Dir, 'metadata.json');
  fs.writeFileSync(rel2Archive, Buffer.alloc(2048, 0x43));
  fs.writeFileSync(rel2Cover, Buffer.from('jpeg-bytes'));
  fs.writeFileSync(rel2Meta, JSON.stringify({ title: 'Super Metroid' }));

  const rel2 = db.upsertCatalogRelease({
    remoteUrl: 'https://retrogametalk.com/repo/snes-rom/super-metroid/',
    remotePath: '/repo/snes-rom/super-metroid/',
    localPath: rel2Dir,
    systemName: 'snes-rom',
    title: 'Super Metroid',
    status: 'downloaded',
    coverLocalPath: rel2Cover,
  });
  db.upsertReleaseFile({
    releaseId: rel2.id,
    remoteUrl: rel2.remoteUrl,
    downloadUrl: 'https://retrogametalk.com/download/super-metroid.zip',
    remotePath: '/download/super-metroid.zip',
    localPath: rel2Archive,
    filename: 'Super Metroid (USA).zip',
    fileSizeBytes: 2048,
    status: 'downloaded',
    downloadedAt: '2026-11-25T11:00:00.000Z',
  });

  // 3. Actively downloading release (must be skipped cleanly)
  const rel3Dir = path.join(tempDownloadDir, 'gba-roms', 'Mother 3');
  fs.mkdirSync(rel3Dir, { recursive: true });
  const rel3Archive = path.join(rel3Dir, 'Mother 3.zip');
  fs.writeFileSync(rel3Archive, Buffer.alloc(512, 0x44));
  const rel3 = db.upsertCatalogRelease({
    remoteUrl: 'https://retrogametalk.com/repo/gba-roms/mother-3/',
    remotePath: '/repo/gba-roms/mother-3/',
    localPath: rel3Dir,
    systemName: 'gba-roms',
    title: 'Mother 3',
    status: 'downloading',
  });
  db.upsertReleaseFile({
    releaseId: rel3.id,
    remoteUrl: rel3.remoteUrl,
    downloadUrl: 'https://retrogametalk.com/download/mother3.zip',
    remotePath: '/download/mother3.zip',
    localPath: rel3Archive,
    filename: 'Mother 3.zip',
    fileSizeBytes: 512,
    status: 'downloading',
  });

  // 4. Path traversal attempt pointing outside DOWNLOAD_DIR (must NEVER unlink outside file)
  const outsideSecret = path.join(outsideDir, 'do-not-delete.txt');
  fs.writeFileSync(outsideSecret, 'protected-data');
  const traversalPath = path.join(tempDownloadDir, '..', 'outside', 'do-not-delete.txt');
  const rel4 = db.upsertCatalogRelease({
    remoteUrl: 'https://retrogametalk.com/repo/nes-roms/traversal-test/',
    remotePath: '/repo/nes-roms/traversal-test/',
    localPath: traversalPath,
    systemName: 'nes-roms',
    title: 'Traversal Guard Test',
    status: 'downloaded',
  });
  db.upsertReleaseFile({
    releaseId: rel4.id,
    remoteUrl: rel4.remoteUrl,
    downloadUrl: 'https://retrogametalk.com/download/traversal.zip',
    remotePath: '/download/traversal.zip',
    localPath: traversalPath,
    filename: 'do-not-delete.txt',
    fileSizeBytes: 14,
    status: 'downloaded',
  });

  // Execute bulk eviction with ignoreInSync: true
  const result = db.evictLocalFilesForReleaseIds(
    [rel1.id, rel2.id, rel3.id, rel4.id],
    { ignoreInSync: true, downloadDir: tempDownloadDir },
  );

  // Active download skipped
  assert.deepEqual(result.skippedActiveIds, [rel3.id]);
  assert.equal(fs.existsSync(rel3Archive), true, 'actively downloading archive must remain untouched');

  // Evicted count & reclaimed bytes
  assert.equal(result.evictedItemsCount, 3);
  assert.equal(result.deletedFilesCount, 2); // rel1Archive + rel2Archive (rel4 outside DOWNLOAD_DIR refused)
  assert.equal(result.ignoredInSyncCount, 3);
  assert.ok(result.freedBytes >= 4096 + 1024 + 2048);

  // rel1 files + sidecars removed and empty dir pruned
  assert.equal(fs.existsSync(rel1Archive), false);
  assert.equal(fs.existsSync(rel1Part), false);
  assert.equal(fs.existsSync(rel1PartMeta), false);
  assert.equal(fs.existsSync(rel1Dir), false, 'empty release dir should be pruned');
  assert.equal(fs.existsSync(tempDownloadDir), true, 'DOWNLOAD_DIR root must never be pruned');

  // rel1 DB record preserved with status -> available, syncOverride -> ignore, metadata/collections/device installs intact
  const rel1After = db.getCatalogReleaseById(rel1.id);
  assert.ok(rel1After);
  assert.equal(rel1After.status, 'available');
  assert.equal(rel1After.downloadedAt, null);
  assert.equal(rel1After.syncOverride, 'ignore');
  assert.equal(rel1After.isFavorite, true);
  assert.equal(rel1After.title, 'Chrono Cross');
  assert.equal(rel1After.fileSizeBytes, 4096, 'known file size preserved for future pre-queue guardrail checks');
  assert.equal(rel1After.sizeIsEstimated, true);
  assert.deepEqual(rel1After.collectionIds, [col.id]);
  assert.equal(rel1After.deviceInstalls?.length, 1);
  assert.equal(rel1After.deviceInstalls?.[0]?.deviceId, device.id);
  assert.equal(rel1After.files[0]?.status, 'available');
  assert.equal(rel1After.files[0]?.downloadedAt, null);

  // rel2 archive removed while cover.jpg and metadata.json stay untouched
  assert.equal(fs.existsSync(rel2Archive), false);
  assert.equal(fs.existsSync(rel2Cover), true, 'cover.jpg must be preserved');
  assert.equal(fs.existsSync(rel2Meta), true, 'metadata.json must be preserved');
  assert.equal(fs.existsSync(rel2Dir), true, 'non-empty release dir with cover/metadata must remain');

  // Path-traversal outside file MUST remain untouched
  assert.equal(fs.existsSync(outsideSecret), true, 'file outside DOWNLOAD_DIR must never be deleted');
  assert.equal(fs.readFileSync(outsideSecret, 'utf8'), 'protected-data');
});
