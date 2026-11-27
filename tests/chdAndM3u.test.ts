import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import yazl from 'yazl';
import {
  DEFAULT_CHD_ELIGIBLE_SYSTEMS,
  createDefaultDiscExportConfig,
  isDiscTargetEligibleForChd,
  normalizeDiscExportConfig,
  replaceExtensionWithChd,
  resolveChdConversionMode,
} from '../src/shared/discExport.ts';
import {
  buildM3uPlaylistContent,
  extractDiscSequenceInfo,
  planMultiDiscExportLayout,
  sanitizeFat32Segment,
} from '../src/shared/multiDiscPlaylist.ts';
import {
  ChdConversionManager,
  clearChdCache,
  computeChdCacheKey,
  convertArchiveDiscToChd,
  getChdCacheDir,
  getChdCacheStats,
  parseChdmanProgressLine,
  pruneChdCache,
  validateExtractedDiscDescriptor,
} from '../src/server/chdService.ts';
import {
  buildConfigBackupSnapshot,
  parseAndValidateConfigBackup,
} from '../src/shared/configBackup.ts';
import { createDefaultStorageFolderConfig } from '../src/shared/storageFolderMappings.ts';
import { resolveItemDeviceInstallState } from '../src/utils/deviceInstallView.ts';
import type { BulkInstallJobState } from '../src/hooks/useBulkStorageInstaller.ts';
import type { ScraperConfigPublic } from '../src/server/types.ts';

function createZipFixture(
  zipPath: string,
  entries: Array<{ name: string; content: string | Buffer }>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile();
    for (const entry of entries) {
      const buf = typeof entry.content === 'string' ? Buffer.from(entry.content, 'utf8') : entry.content;
      zipfile.addBuffer(buf, entry.name);
    }
    const out = fs.createWriteStream(zipPath);
    out.on('close', () => resolve());
    out.on('error', reject);
    zipfile.outputStream.on('error', reject);
    zipfile.outputStream.pipe(out);
    zipfile.end();
  });
}

function createMockChdmanScript(
  dir: string,
  options?: { delayMs?: number; failWithCode?: number },
): string {
  const scriptPath = path.join(dir, `mock-chdman-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  const delayMs = options?.delayMs ?? 15;
  const failCode = options?.failWithCode ?? 0;
  const script = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] === 'help' || args.length === 0) {
  process.stdout.write('chdman - MAME Compressed Hunks of Data (CHD) manager 0.271 (mock)\\n');
  process.exit(0);
}

const subcommand = args[0];
const inputIdx = args.indexOf('-i');
const outputIdx = args.indexOf('-o');
const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : '';
const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : '';

if (!inputPath || !fs.existsSync(inputPath)) {
  process.stderr.write('Error: input file missing: ' + inputPath + '\\n');
  process.exit(2);
}

if (${failCode} !== 0) {
  process.stderr.write('Error: simulated chdman compression failure\\n');
  process.exit(${failCode});
}

let timer = null;
process.on('SIGTERM', () => {
  if (timer) clearTimeout(timer);
  process.exit(143);
});

const steps = [25.0, 62.5, 100.0];
let idx = 0;
function tick() {
  if (idx < steps.length) {
    process.stderr.write('Compressing, ' + steps[idx].toFixed(1) + '% complete... (ratio=54.2%)\\r');
    idx += 1;
    timer = setTimeout(tick, ${delayMs});
    return;
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from('MComprHD:' + subcommand + ':' + path.basename(inputPath)));
  process.stderr.write('\\nCompression complete ... final ratio = 54.2%\\n');
  process.exit(0);
}
tick();
`;
  fs.writeFileSync(scriptPath, script, { encoding: 'utf8', mode: 0o755 });
  fs.chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test('extractDiscSequenceInfo recognizes Disc, CD, Disk, Side A/B, and single-disc titles', () => {
  const d1 = extractDiscSequenceInfo('Final Fantasy VII (USA) (Disc 1).chd');
  assert.equal(d1.isMultiDisc, true);
  assert.equal(d1.discNumber, 1);
  assert.equal(d1.discLabel, 'Disc 1');
  assert.equal(d1.baseTitle, 'Final Fantasy VII (USA)');

  const d3 = extractDiscSequenceInfo('Final Fantasy VII (USA) (Disc 3 of 3).cue');
  assert.equal(d3.isMultiDisc, true);
  assert.equal(d3.discNumber, 3);
  assert.equal(d3.baseTitle, 'Final Fantasy VII (USA)');

  const cd2 = extractDiscSequenceInfo('Metal Gear Solid (USA) (CD 2).chd');
  assert.equal(cd2.isMultiDisc, true);
  assert.equal(cd2.discNumber, 2);
  assert.equal(cd2.baseTitle, 'Metal Gear Solid (USA)');

  const sideB = extractDiscSequenceInfo('Panzer Dragoon Saga (Side B).chd');
  assert.equal(sideB.isMultiDisc, true);
  assert.equal(sideB.discNumber, 2);
  assert.equal(sideB.discLabel, 'Side B');
  assert.equal(sideB.baseTitle, 'Panzer Dragoon Saga');

  const single = extractDiscSequenceInfo('Castlevania - Symphony of the Night (USA).chd');
  assert.equal(single.isMultiDisc, false);
  assert.equal(single.discNumber, 1);
  assert.equal(single.discLabel, null);
});

test('planMultiDiscExportLayout leaves single-disc games untouched and builds ordered subfolder & inline .m3u layouts', () => {
  const entries = [
    {
      id: 'ff7-3',
      gameKey: 'item-100',
      gameTitle: 'Final Fantasy VII',
      outputFilename: 'Final Fantasy VII (USA) (Disc 3).chd',
    },
    {
      id: 'ff7-1',
      gameKey: 'item-100',
      gameTitle: 'Final Fantasy VII',
      outputFilename: 'Final Fantasy VII (USA) (Disc 1).chd',
    },
    {
      id: 'ff7-2',
      gameKey: 'item-100',
      gameTitle: 'Final Fantasy VII',
      outputFilename: 'Final Fantasy VII (USA) (Disc 2).chd',
    },
    {
      id: 'sotn',
      gameKey: 'item-200',
      gameTitle: 'Castlevania - Symphony of the Night',
      outputFilename: 'Castlevania - Symphony of the Night (USA).chd',
    },
  ];

  // Subfolder mode (.multidisc/<Game>/)
  const subPlan = planMultiDiscExportLayout(entries, { layout: 'subfolder' });
  assert.equal(subPlan.singles.length, 1);
  assert.equal(subPlan.singles[0].id, 'sotn');
  assert.equal(subPlan.groups.length, 1);
  const group = subPlan.groups[0];
  assert.equal(group.m3uFilename, 'Final Fantasy VII (USA).m3u');
  assert.deepEqual(group.multidiscSubpathSegments, ['.multidisc', 'Final Fantasy VII (USA)']);
  assert.deepEqual(
    group.entries.map((e) => e.id),
    ['ff7-1', 'ff7-2', 'ff7-3'],
  );
  assert.equal(
    group.m3uContent,
    [
      './.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 1).chd',
      './.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 2).chd',
      './.multidisc/Final Fantasy VII (USA)/Final Fantasy VII (USA) (Disc 3).chd',
      '',
    ].join('\n'),
  );

  // Inline mode (<Game>.m3u beside discs at console root)
  const inlinePlan = planMultiDiscExportLayout(entries, { layout: 'inline' });
  assert.equal(inlinePlan.groups.length, 1);
  assert.deepEqual(inlinePlan.groups[0].multidiscSubpathSegments, []);
  assert.equal(
    inlinePlan.groups[0].m3uContent,
    [
      './Final Fantasy VII (USA) (Disc 1).chd',
      './Final Fantasy VII (USA) (Disc 2).chd',
      './Final Fantasy VII (USA) (Disc 3).chd',
      '',
    ].join('\n'),
  );

  // Unconverted .cue/.bin disc_set subfolders
  const cuePlan = planMultiDiscExportLayout(
    [
      {
        id: 'xeno-2',
        gameKey: 'item-300',
        outputFilename: 'Xenogears (USA) (Disc 2).cue',
        isDiscSetFolder: true,
        discSetFolderName: 'Xenogears (USA) (Disc 2)',
      },
      {
        id: 'xeno-1',
        gameKey: 'item-300',
        outputFilename: 'Xenogears (USA) (Disc 1).cue',
        isDiscSetFolder: true,
        discSetFolderName: 'Xenogears (USA) (Disc 1)',
      },
    ],
    { layout: 'subfolder' },
  );
  assert.equal(cuePlan.groups.length, 1);
  assert.equal(
    cuePlan.groups[0].m3uContent,
    [
      './.multidisc/Xenogears (USA)/Xenogears (USA) (Disc 1)/Xenogears (USA) (Disc 1).cue',
      './.multidisc/Xenogears (USA)/Xenogears (USA) (Disc 2)/Xenogears (USA) (Disc 2).cue',
      '',
    ].join('\n'),
  );

  // FAT32 sanitization & POSIX formatting
  assert.equal(sanitizeFat32Segment('Metal Gear: Solid? (USA).'), 'Metal Gear Solid (USA)');
  assert.equal(
    buildM3uPlaylistContent(['.multidisc\\Game\\Disc 1.chd', './.multidisc/Game/Disc 2.chd']),
    './.multidisc/Game/Disc 1.chd\n./.multidisc/Game/Disc 2.chd\n',
  );
});

test('isDiscTargetEligibleForChd and resolveChdConversionMode respect opt-in defaults, chdman probe, and CD vs DVD mode', () => {
  const defaults = createDefaultDiscExportConfig();
  assert.equal(defaults.chdConvertEnabled, false);
  assert.equal(defaults.m3uPlaylistEnabled, false);
  assert.equal(defaults.m3uLayout, 'subfolder');
  assert.equal(defaults.chdCacheMaxGb, 0);
  assert.ok(DEFAULT_CHD_ELIGIBLE_SYSTEMS.includes('psx-iso'));

  const cueTarget = { kind: 'disc_set' as const, extension: '.cue', sizeBytes: 500 * 1024 * 1024 };
  assert.equal(isDiscTargetEligibleForChd('psx-iso', cueTarget, defaults, true), false);

  const enabledConfig = normalizeDiscExportConfig({
    ...defaults,
    chdConvertEnabled: true,
  });

  // Disabled if chdman binary is unavailable
  assert.equal(isDiscTargetEligibleForChd('psx-iso', cueTarget, enabledConfig, false), false);
  // Enabled for PS1 .cue when chdman is available
  assert.equal(isDiscTargetEligibleForChd('psx-iso', cueTarget, enabledConfig, true), true);
  // Already .chd -> skip recompression
  assert.equal(
    isDiscTargetEligibleForChd('psx-iso', { kind: 'rom', extension: '.chd' }, enabledConfig, true),
    false,
  );
  // Cartridge console -> not eligible
  assert.equal(
    isDiscTargetEligibleForChd('snes-rom', { kind: 'rom', extension: '.sfc' }, enabledConfig, true),
    false,
  );

  assert.equal(resolveChdConversionMode('psx-iso', cueTarget), 'cd');
  assert.equal(
    resolveChdConversionMode('dreamcast-iso', { kind: 'disc_set', extension: '.gdi', sizeBytes: 1_100_000_000 }),
    'cd',
  );
  assert.equal(
    resolveChdConversionMode('ps2-iso', { kind: 'rom', extension: '.iso', sizeBytes: 2_500_000_000 }),
    'dvd',
  );
  assert.equal(
    resolveChdConversionMode('ps2-iso', { kind: 'rom', extension: '.iso', sizeBytes: 550 * 1024 * 1024 }),
    'cd',
  );
  assert.equal(replaceExtensionWithChd('Metal Gear Solid (USA) (Disc 1).cue'), 'Metal Gear Solid (USA) (Disc 1).chd');
  assert.equal(replaceExtensionWithChd('Game.chd'), 'Game.chd');
});

test('parseChdmanProgressLine parses real chdman stderr chunks and clamps percentages', () => {
  assert.equal(parseChdmanProgressLine('Compressing, 42.7% complete... (ratio=61.3%)'), 42.7);
  assert.equal(
    parseChdmanProgressLine('Compressing, 12.1% complete...\rCompressing, 88.9% complete...'),
    88.9,
  );
  assert.equal(parseChdmanProgressLine('Compressing, 100.0% complete...'), 100);
  assert.equal(parseChdmanProgressLine('Compressing, 105.0% complete...'), 100);
  assert.equal(parseChdmanProgressLine('chdman - MAME Compressed Hunks of Data manager'), null);
});

test('validateExtractedDiscDescriptor allows relative tracks, fixes case-insensitive sibling refs, and rejects traversal/absolute paths', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-cue-val-'));
  try {
    // 1. Valid .cue with Windows-case mismatch on Linux -> rewritten cleanly to sibling filename
    const binPath = path.join(workspace, 'game_track01.bin');
    fs.writeFileSync(binPath, Buffer.alloc(64));
    const cuePath = path.join(workspace, 'Game.cue');
    fs.writeFileSync(
      cuePath,
      'FILE "GAME_TRACK01.BIN" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n',
      'utf8',
    );
    validateExtractedDiscDescriptor(cuePath, workspace);
    assert.match(fs.readFileSync(cuePath, 'utf8'), /FILE "game_track01\.bin" BINARY/);

    // 2. Traversal in .cue -> rejected
    const badCueTraversal = path.join(workspace, 'BadTraversal.cue');
    fs.writeFileSync(badCueTraversal, 'FILE "../../etc/passwd" BINARY\n', 'utf8');
    assert.throws(
      () => validateExtractedDiscDescriptor(badCueTraversal, workspace),
      /Path traversal/i,
    );

    // 3. Absolute path in .cue -> rejected
    const badCueAbs = path.join(workspace, 'BadAbs.cue');
    fs.writeFileSync(badCueAbs, 'FILE "/etc/passwd" BINARY\n', 'utf8');
    assert.throws(
      () => validateExtractedDiscDescriptor(badCueAbs, workspace),
      /Unsafe absolute/i,
    );

    // 4. Valid .gdi vs traversal .gdi
    const goodGdi = path.join(workspace, 'Good.gdi');
    fs.writeFileSync(goodGdi, '1\n1 0 4 2352 track01.bin 0\n', 'utf8');
    validateExtractedDiscDescriptor(goodGdi, workspace);

    const badGdi = path.join(workspace, 'Bad.gdi');
    fs.writeFileSync(badGdi, '1\n1 0 4 2352 "../secret.bin" 0\n', 'utf8');
    assert.throws(
      () => validateExtractedDiscDescriptor(badGdi, workspace),
      /Path traversal/i,
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('pruneChdCache evicts oldest-mtime entries first, respects keepFilename, and clearChdCache wipes cache', () => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-chd-cache-'));
  try {
    const f1 = path.join(cacheDir, 'oldest.chd');
    const f2 = path.join(cacheDir, 'middle.chd');
    const f3 = path.join(cacheDir, 'newest.chd');
    fs.writeFileSync(f1, Buffer.alloc(1000));
    fs.writeFileSync(f2, Buffer.alloc(1000));
    fs.writeFileSync(f3, Buffer.alloc(1000));

    const now = Date.now() / 1000;
    fs.utimesSync(f1, now - 300, now - 300);
    fs.utimesSync(f2, now - 200, now - 200);
    fs.utimesSync(f3, now - 100, now - 100);

    const pruned = pruneChdCache(cacheDir, 1500, 'newest.chd');
    assert.equal(pruned.evictedCount, 2);
    assert.equal(pruned.freedBytes, 2000);
    assert.equal(fs.existsSync(f1), false);
    assert.equal(fs.existsSync(f2), false);
    assert.equal(fs.existsSync(f3), true);

    const stats = getChdCacheStats(cacheDir, 1);
    assert.equal(stats.fileCount, 1);
    assert.equal(stats.totalBytes, 1000);

    const cleared = clearChdCache(cacheDir);
    assert.equal(cleared.deletedCount, 1);
    assert.equal(fs.existsSync(f3), false);
  } finally {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
});

test('convertArchiveDiscToChd and ChdConversionManager convert zip disc sets, report progress, reuse cache, and abort cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-chd-e2e-'));
  try {
    const zipPath = path.join(tmpDir, 'FF7_Disc1.zip');
    await createZipFixture(zipPath, [
      {
        name: 'Final Fantasy VII (Disc 1).cue',
        content: 'FILE "Final Fantasy VII (Disc 1).bin" BINARY\n  TRACK 01 MODE2/2352\n    INDEX 01 00:00:00\n',
      },
      {
        name: 'Final Fantasy VII (Disc 1).bin',
        content: Buffer.alloc(2048, 0xab),
      },
    ]);

    const mockChdman = createMockChdmanScript(tmpDir, { delayMs: 10 });
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    // 1. Direct convertArchiveDiscToChd cleans up workspace and writes final .chd
    const workspaceDir = path.join(tmpDir, 'work-direct');
    const outChd = path.join(tmpDir, 'out', 'FF7.chd');
    const phases: Array<{ phase: string; percent: number | null }> = [];
    const directRes = await convertArchiveDiscToChd({
      archivePath: zipPath,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'cd',
      outputChdPath: outChd,
      tempWorkspaceDir: workspaceDir,
      chdmanBin: mockChdman,
      onPhase: (phase, percent) => phases.push({ phase, percent }),
    });

    assert.equal(fs.existsSync(directRes.outputPath), true);
    assert.ok(directRes.outputBytes > 10);
    assert.equal(fs.existsSync(workspaceDir), false, 'Temp workspace must always be cleaned up');
    assert.ok(phases.some((p) => p.phase === 'extracting'));
    assert.ok(phases.some((p) => p.phase === 'converting' && p.percent === 62.5));
    assert.ok(phases.some((p) => p.phase === 'converting' && p.percent === 100));

    // 2. ChdConversionManager with cache enabled -> first run converts, second run hits cache
    const manager = new ChdConversionManager(() => dataDir);
    const job1 = await manager.startOrReuseJob({
      itemId: 77,
      fileId: 701,
      targetId: 'disc-1',
      archivePath: zipPath,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'cd',
      filename: 'Final Fantasy VII (USA) (Disc 1).cue',
      cacheMaxGb: 5,
      chdmanBin: mockChdman,
    });
    assert.equal(job1.cached, false);
    assert.equal(job1.filename, 'Final Fantasy VII (USA) (Disc 1).chd');

    const finalJob1 = await new Promise<typeof job1>((resolve, reject) => {
      const snap = manager.getJobSnapshot(job1.jobId);
      if (snap && (snap.status === 'done' || snap.status === 'error')) {
        resolve(snap);
        return;
      }
      const unsub = manager.subscribeJobEvents(job1.jobId, (s) => {
        if (s.status === 'done' || s.status === 'error' || s.status === 'canceled') {
          unsub?.();
          resolve(s);
        }
      });
      setTimeout(() => {
        unsub?.();
        reject(new Error('Timed out waiting for CHD conversion job'));
      }, 5000);
    });
    assert.equal(finalJob1.status, 'done');
    assert.equal(finalJob1.percent, 100);
    assert.ok((finalJob1.outputBytes ?? 0) > 10);

    const cacheStats = getChdCacheStats(getChdCacheDir(dataDir), 5);
    assert.equal(cacheStats.fileCount, 1);

    // Second request for exact same archive + target -> immediate cache hit
    const job2 = await manager.startOrReuseJob({
      itemId: 77,
      fileId: 701,
      targetId: 'disc-1',
      archivePath: zipPath,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'cd',
      filename: 'Final Fantasy VII (USA) (Disc 1).cue',
      cacheMaxGb: 5,
      chdmanBin: mockChdman,
    });
    assert.equal(job2.status, 'done');
    assert.equal(job2.cached, true);
    assert.equal(job2.percent, 100);

    // Verify deterministic cache key changes if mode changes
    const st = fs.statSync(zipPath);
    const keyCd = computeChdCacheKey({
      archivePath: zipPath,
      archiveSizeBytes: st.size,
      archiveMtimeMs: st.mtimeMs,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'cd',
    });
    const keyDvd = computeChdCacheKey({
      archivePath: zipPath,
      archiveSizeBytes: st.size,
      archiveMtimeMs: st.mtimeMs,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'dvd',
    });
    assert.notEqual(keyCd, keyDvd);

    // 3. Cancellation terminates slow chdman child and transitions job to 'canceled'
    const slowChdman = createMockChdmanScript(tmpDir, { delayMs: 2500 });
    const jobCancel = await manager.startOrReuseJob({
      itemId: 78,
      fileId: 702,
      targetId: 'disc-slow',
      archivePath: zipPath,
      primaryEntry: 'Final Fantasy VII (Disc 1).cue',
      entryPaths: ['Final Fantasy VII (Disc 1).cue', 'Final Fantasy VII (Disc 1).bin'],
      mode: 'dvd',
      filename: 'SlowDisc.cue',
      cacheMaxGb: 0,
      chdmanBin: slowChdman,
    });
    await new Promise((r) => setTimeout(r, 80));
    const canceled = manager.cancelJob(jobCancel.jobId);
    assert.equal(canceled, true);
    const afterCancel = manager.getJobSnapshot(jobCancel.jobId);
    assert.equal(afterCancel?.status, 'canceled');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SQLite migration v34 persists discExportConfig and configBackup round-trips it cleanly', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-chd-db-'));
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
    db.initDb();

    const initial = db.getPublicConfig();
    assert.equal(initial.discExportConfig?.chdConvertEnabled, false);
    assert.equal(initial.discExportConfig?.m3uPlaylistEnabled, false);
    assert.equal(initial.discExportConfig?.m3uLayout, 'subfolder');
    assert.equal(initial.discExportConfig?.chdCacheMaxGb, 0);

    const updated = db.updateConfig({
      discExportConfig: {
        chdConvertEnabled: true,
        chdEligibleSystems: ['psx-iso', 'dreamcast-iso'],
        chdCacheMaxGb: 20,
        m3uPlaylistEnabled: true,
        m3uLayout: 'inline',
      },
    });
    assert.equal(updated.discExportConfig?.chdConvertEnabled, true);
    assert.deepEqual(updated.discExportConfig?.chdEligibleSystems, ['psx-iso', 'dreamcast-iso']);
    assert.equal(updated.discExportConfig?.chdCacheMaxGb, 20);
    assert.equal(updated.discExportConfig?.m3uPlaylistEnabled, true);
    assert.equal(updated.discExportConfig?.m3uLayout, 'inline');

    const snapshot = buildConfigBackupSnapshot(updated as ScraperConfigPublic, '1.48.0');

    const baselineConfig: ScraperConfigPublic = {
      ...updated,
      storageFolderConfig: createDefaultStorageFolderConfig(),
      discExportConfig: createDefaultDiscExportConfig(),
    };
    const parsed = parseAndValidateConfigBackup(snapshot, baselineConfig);
    assert.equal(parsed.valid, true);
    if (parsed.valid) {
      assert.equal(parsed.patch.discExportConfig?.chdConvertEnabled, true);
      assert.equal(parsed.patch.discExportConfig?.m3uPlaylistEnabled, true);
      assert.equal(parsed.patch.discExportConfig?.m3uLayout, 'inline');
      assert.equal(parsed.patch.discExportConfig?.chdCacheMaxGb, 20);
      assert.ok(
        parsed.changes.some((c) => c.section === 'Device Export' && c.label.includes('Disc')),
      );
    }
  } finally {
    if (prevDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prevDataDir;
    if (prevDownloadDir === undefined) delete process.env.DOWNLOAD_DIR;
    else process.env.DOWNLOAD_DIR = prevDownloadDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolveItemDeviceInstallState surfaces live converting_chd progress percentage', () => {
  const job: BulkInstallJobState = {
    jobId: 99,
    mode: 'express',
    phase: 'running',
    itemIds: [55],
    filterContext: {},
    rows: [],
    currentTitle: 'Final Fantasy VII',
    activeTransfer: {
      itemId: 55,
      rowKey: '55-500',
      title: 'Final Fantasy VII',
      stage: 'converting_chd',
      filename: 'Final Fantasy VII (USA) (Disc 1).chd',
      destinationFolder: 'PSX/.multidisc/Final Fantasy VII (USA)',
      bytesWritten: 0,
      totalBytes: null,
      percent: 42,
      bytesPerSec: null,
      fileIndex: 1,
      totalFiles: 3,
    },
    errorMessage: null,
    startedAt: '2026-11-27T00:00:00.000Z',
    finishedAt: null,
  };

  const state = resolveItemDeviceInstallState(
    55,
    job,
    { completedItems: 0, totalItems: 1 },
    'Miyoo Mini',
  );
  assert.equal(state.stage, 'converting_chd');
  assert.equal(state.mode, 'determinate');
  assert.equal(state.percent, 42);
  assert.equal(state.stageLabel, 'Converting to .chd (42%)…');
  assert.equal(state.fileSequenceLabel, 'File 1/3');
});
