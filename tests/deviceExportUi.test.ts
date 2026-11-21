import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  buildScanReviewSummary,
  composeEffectiveStorageFolderConfig,
  findActiveNamingPreset,
  findEvaluatedScanMatch,
  getActiveManualOverrideSlugs,
  resolveConsolePathSource,
  searchConsolesForOverride,
  shouldAutoExpandAdvancedNaming,
  summarizeNamingOptions,
} from '../src/shared/deviceExportUi.ts';
import { DEFAULT_ROM_NAMING_TEMPLATE } from '../src/shared/romNaming.ts';
import {
  discoverStorageFolderMappings,
  type ScannedDirNode,
} from '../src/shared/storageAutoConfig.ts';
import {
  createDefaultStorageFolderConfig,
  resolveTargetStorageFolder,
} from '../src/shared/storageFolderMappings.ts';

test('composeEffectiveStorageFolderConfig enforces 3-layer precedence: defaults -> mounted device -> manual overrides', () => {
  const miyooNodes: ScannedDirNode[] = [
    { relativePath: '', name: 'MIYOO_SD', depth: 0, childDirs: ['Roms'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms', name: 'Roms', depth: 1, childDirs: ['SFC', 'FC', 'GBA'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms/SFC', name: 'SFC', depth: 2, childDirs: ['ROM Hacks'], sampleExtensions: ['sfc'], fileCount: 20 },
    { relativePath: 'Roms/SFC/ROM Hacks', name: 'ROM Hacks', depth: 3, childDirs: [], sampleExtensions: ['sfc'], fileCount: 5 },
    { relativePath: 'Roms/FC', name: 'FC', depth: 2, childDirs: [], sampleExtensions: ['nes'], fileCount: 10 },
    { relativePath: 'Roms/GBA', name: 'GBA', depth: 2, childDirs: [], sampleExtensions: ['gba'], fileCount: 14 },
  ];
  const miyooScan = discoverStorageFolderMappings(miyooNodes, {
    rootLabel: 'MIYOO_SD',
    preferredSlugs: ['snes-roms', 'nes-roms', 'gba-roms'],
  });

  // Saved manual override for NES only; SNES & GBA should inherit auto-detected Miyoo paths
  const savedManual = createDefaultStorageFolderConfig();
  savedManual.systemFolders['nes-roms'] = 'MyPinnedNES';

  const effectiveMiyoo = composeEffectiveStorageFolderConfig(savedManual, miyooScan);
  assert.equal(resolveTargetStorageFolder('snes-roms', 'retail', effectiveMiyoo), 'Roms/SFC');
  assert.equal(
    resolveTargetStorageFolder('snes-roms', 'hack', effectiveMiyoo),
    'Roms/SFC/ROM Hacks',
  );
  assert.equal(resolveTargetStorageFolder('gba-roms', 'retail', effectiveMiyoo), 'Roms/GBA');
  // Manual override wins over auto-detected Roms/FC
  assert.equal(resolveTargetStorageFolder('nes-roms', 'retail', effectiveMiyoo), 'MyPinnedNES');

  assert.equal(resolveConsolePathSource('snes-roms', savedManual, miyooScan), 'auto');
  assert.equal(resolveConsolePathSource('nes-roms', savedManual, miyooScan), 'manual');
  assert.equal(resolveConsolePathSource('n64-roms', savedManual, miyooScan), 'default');

  // Disabling detected subfolders for this session keeps SNES hacks in Roms/SFC
  const effectiveNoSub = composeEffectiveStorageFolderConfig(savedManual, miyooScan, {
    includeTypeSubfolders: false,
  });
  assert.equal(resolveTargetStorageFolder('snes-roms', 'hack', effectiveNoSub), 'Roms/SFC');

  // Ejecting device clears auto-detected paths immediately while preserving saved manual override
  const effectiveEjected = composeEffectiveStorageFolderConfig(savedManual, null);
  assert.equal(resolveTargetStorageFolder('snes-roms', 'retail', effectiveEjected), 'SNES');
  assert.equal(resolveTargetStorageFolder('nes-roms', 'retail', effectiveEjected), 'MyPinnedNES');
});

test('buildLiveExportDestinations adapts to detected mounted device consoles and reports path sources', () => {
  const misterNodes: ScannedDirNode[] = [
    { relativePath: '', name: 'MISTER_SD', depth: 0, childDirs: ['games'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'games', name: 'games', depth: 1, childDirs: ['SNES', 'Genesis'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'games/SNES', name: 'SNES', depth: 2, childDirs: ['Hacks'], sampleExtensions: ['sfc'], fileCount: 30 },
    { relativePath: 'games/SNES/Hacks', name: 'Hacks', depth: 3, childDirs: [], sampleExtensions: ['sfc'], fileCount: 8 },
    { relativePath: 'games/Genesis', name: 'Genesis', depth: 2, childDirs: [], sampleExtensions: ['md'], fileCount: 15 },
  ];
  const misterScan = discoverStorageFolderMappings(misterNodes, {
    rootLabel: 'MISTER_SD',
    preferredSlugs: ['snes-roms', 'genesis-roms'],
  });
  const savedManual = createDefaultStorageFolderConfig();
  const effective = composeEffectiveStorageFolderConfig(savedManual, misterScan);

  const samples = buildLiveExportDestinations(
    effective,
    {
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    },
    {
      savedManualConfig: savedManual,
      autoConfigResult: misterScan,
    },
  );

  assert.equal(samples.length, 3);
  assert.equal(samples[0]?.folderPath, 'games/SNES');
  assert.equal(samples[0]?.source, 'auto');
  assert.equal(samples[1]?.folderPath, 'games/SNES/Hacks');
  assert.equal(samples[1]?.source, 'auto');
  assert.equal(samples[2]?.folderPath, 'games/Genesis');
  assert.equal(samples[2]?.systemLabel, 'Genesis');
  assert.equal(samples[2]?.source, 'auto');
});

test('getActiveManualOverrideSlugs and searchConsolesForOverride power zero-wall manual overrides', () => {
  const emptyConfig = createDefaultStorageFolderConfig();
  assert.deepEqual(getActiveManualOverrideSlugs(emptyConfig), []);

  const customized = createDefaultStorageFolderConfig();
  customized.systemFolders['snes-roms'] = 'CustomSNES';
  customized.systemTypeOverrides['gba-roms'] = { mode: 'enabled' };

  const active = getActiveManualOverrideSlugs(customized);
  assert.deepEqual(active, ['gba-roms', 'snes-roms']);

  const results = searchConsolesForOverride(
    ['snes-roms', 'gba-roms', 'nes-roms', 'psx-iso', 'genesis-roms'],
    'super',
    new Set(active),
    customized,
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.slug, 'snes-roms');
  assert.equal(results[0]?.effectiveBasePath, 'CustomSNES');
  assert.equal(results[0]?.isAlreadyActive, true);

  const psResults = searchConsolesForOverride(
    ['snes-roms', 'gba-roms', 'nes-roms', 'psx-iso', 'genesis-roms'],
    'playstation',
    new Set(active),
    customized,
  );
  assert.equal(psResults.length, 1);
  assert.equal(psResults[0]?.slug, 'psx-iso');
  assert.equal(psResults[0]?.isAlreadyActive, false);
});

test('naming disclosure helpers keep defaults collapsed and auto-expand custom naming setups', () => {
  assert.equal(findActiveNamingPreset(DEFAULT_ROM_NAMING_TEMPLATE)?.id, 'standard');
  assert.equal(findActiveNamingPreset('{title} [{version}]'), null);

  assert.equal(
    shouldAutoExpandAdvancedNaming({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    false,
  );
  assert.equal(
    shouldAutoExpandAdvancedNaming({
      romNamingTemplate: '{title} - {role}',
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    true,
  );
  assert.equal(
    shouldAutoExpandAdvancedNaming({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: false,
      romMaxFilenameLen: 0,
    }),
    true,
  );
  assert.equal(
    shouldAutoExpandAdvancedNaming({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 80,
    }),
    true,
  );

  assert.equal(
    summarizeNamingOptions({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    }),
    'FAT32 safe · Unlimited length',
  );
  assert.equal(
    summarizeNamingOptions({
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: false,
      romMaxFilenameLen: 120,
    }),
    'Raw characters · Max 120 chars',
  );
  assert.equal(appendNamingToken('{title}', '{regionParen}'), '{title}{regionParen}');
});

test('buildScanReviewSummary and findEvaluatedScanMatch resolve canonical and alias slugs cleanly', () => {
  const nodes: ScannedDirNode[] = [
    { relativePath: '', name: 'MIYOO_SD', depth: 0, childDirs: ['Roms'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms', name: 'Roms', depth: 1, childDirs: ['SFC', 'FC', 'GBA'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms/SFC', name: 'SFC', depth: 2, childDirs: ['Hacks'], sampleExtensions: ['sfc'], fileCount: 12 },
    { relativePath: 'Roms/SFC/Hacks', name: 'Hacks', depth: 3, childDirs: [], sampleExtensions: ['sfc'], fileCount: 4 },
    { relativePath: 'Roms/FC', name: 'FC', depth: 2, childDirs: [], sampleExtensions: ['nes'], fileCount: 8 },
    { relativePath: 'Roms/GBA', name: 'GBA', depth: 2, childDirs: [], sampleExtensions: ['gba'], fileCount: 6 },
  ];

  const scanResult = discoverStorageFolderMappings(nodes, {
    rootLabel: 'MIYOO_SD',
    preferredSlugs: ['snes-roms'],
    durationMs: 12,
  });

  const currentConfig = createDefaultStorageFolderConfig();
  currentConfig.systemFolders['nes-roms'] = 'CustomNES';
  currentConfig.systemFolders['gba-roms'] = 'Roms/GBA';

  const summary = buildScanReviewSummary(
    scanResult,
    currentConfig,
    new Set(['snes-roms']),
    {},
    true,
  );

  assert.equal(summary.counts.total, 3);
  assert.equal(findEvaluatedScanMatch(summary, 'snes-roms')?.diff.kind, 'new');
  assert.equal(findEvaluatedScanMatch(summary, 'snes')?.diff.kind, 'new');
  assert.equal(findEvaluatedScanMatch(summary, 'nes-roms')?.diff.kind, 'updates_custom');
  assert.equal(findEvaluatedScanMatch(summary, 'gba-roms')?.diff.kind, 'unchanged');
});
