import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  buildScanReviewSummary,
  composeEffectiveStorageFolderConfig,
  filterUnmatchedDeviceFolders,
  findActiveNamingPreset,
  findEvaluatedScanMatch,
  getActiveManualOverrideSlugs,
  resolveConsolePathSource,
  searchConsolesForOverride,
  shouldAutoExpandAdvancedNaming,
  summarizeDeviceInferredConventions,
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
  // Existing flat GBA inherits the device's detected ROM Hacks subfolder convention
  assert.equal(resolveTargetStorageFolder('gba-roms', 'hack', effectiveMiyoo), 'Roms/GBA/ROM Hacks');
  // Brand-new N64 console inherits the mounted device's Roms/ root + subfolder convention
  assert.equal(resolveTargetStorageFolder('n64-roms', 'retail', effectiveMiyoo), 'Roms/N64');
  assert.equal(
    resolveTargetStorageFolder('n64-roms', 'hack', effectiveMiyoo),
    'Roms/N64/ROM Hacks',
  );
  // Standalone BIOS is never nested under Roms/
  assert.equal(resolveTargetStorageFolder('bios-files', 'bios', effectiveMiyoo), 'BIOS');
  // Manual override wins over auto-detected Roms/FC
  assert.equal(resolveTargetStorageFolder('nes-roms', 'retail', effectiveMiyoo), 'MyPinnedNES');

  assert.equal(resolveConsolePathSource('snes-roms', savedManual, miyooScan), 'auto');
  assert.equal(resolveConsolePathSource('nes-roms', savedManual, miyooScan), 'manual');
  assert.equal(resolveConsolePathSource('n64-roms', savedManual, miyooScan), 'inferred');
  assert.equal(resolveConsolePathSource('n64-roms', savedManual, null), 'default');

  // Disabling detected subfolders for this session keeps SNES hacks in Roms/SFC and N64 flat in Roms/N64
  const effectiveNoSub = composeEffectiveStorageFolderConfig(savedManual, miyooScan, {
    includeTypeSubfolders: false,
  });
  assert.equal(resolveTargetStorageFolder('snes-roms', 'hack', effectiveNoSub), 'Roms/SFC');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'hack', effectiveNoSub), 'Roms/N64');

  // Ejecting device clears auto-detected and inferred paths immediately while preserving saved manual override
  const effectiveEjected = composeEffectiveStorageFolderConfig(savedManual, null);
  assert.equal(resolveTargetStorageFolder('snes-roms', 'retail', effectiveEjected), 'SNES');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'retail', effectiveEjected), 'N64');
  assert.equal(resolveTargetStorageFolder('nes-roms', 'retail', effectiveEjected), 'MyPinnedNES');
});

test('propagates device subfolder conventions like SNES/hacks and NES/trans across all consoles and matches casing on unseen types', () => {
  const handheldNodes: ScannedDirNode[] = [
    { relativePath: '', name: 'RETRO_SD', depth: 0, childDirs: ['Roms'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms', name: 'Roms', depth: 1, childDirs: ['SNES', 'NES', 'GBA'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms/SNES', name: 'SNES', depth: 2, childDirs: ['hacks'], sampleExtensions: ['sfc'], fileCount: 24 },
    { relativePath: 'Roms/NES', name: 'NES', depth: 2, childDirs: ['trans'], sampleExtensions: ['nes'], fileCount: 16 },
    { relativePath: 'Roms/GBA', name: 'GBA', depth: 2, childDirs: [], sampleExtensions: ['gba'], fileCount: 12 },
  ];
  const scan = discoverStorageFolderMappings(handheldNodes, {
    rootLabel: 'RETRO_SD',
    preferredSlugs: ['snes-roms', 'nes-roms', 'gba-roms'],
  });

  const savedManual = createDefaultStorageFolderConfig();
  // Explicitly force GBA flat via saved manual override
  savedManual.systemTypeOverrides['gba-roms'] = { mode: 'disabled' };

  const effective = composeEffectiveStorageFolderConfig(savedManual, scan);

  // SNES keeps its own hacks, inherits NES's trans, and gets lowercase homebrew
  assert.equal(resolveTargetStorageFolder('snes-roms', 'hack', effective), 'Roms/SNES/hacks');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'translations', effective), 'Roms/SNES/trans');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'homebrew', effective), 'Roms/SNES/homebrew');
  // NES keeps its own trans and inherits SNES's hacks
  assert.equal(resolveTargetStorageFolder('nes-roms', 'translations', effective), 'Roms/NES/trans');
  assert.equal(resolveTargetStorageFolder('nes-roms', 'hack', effective), 'Roms/NES/hacks');
  // Manual flat override on GBA wins over device-wide subfolder inference
  assert.equal(resolveTargetStorageFolder('gba-roms', 'hack', effective), 'Roms/GBA');
  // Brand-new N64 inherits Roms/N64 + hacks/trans + lowercase unseen homebrew & ports
  assert.equal(resolveTargetStorageFolder('n64-roms', 'retail', effective), 'Roms/N64');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'hack', effective), 'Roms/N64/hacks');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'translations', effective), 'Roms/N64/trans');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'homebrew', effective), 'Roms/N64/homebrew');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'port', effective), 'Roms/N64/ports');

  const summary = summarizeDeviceInferredConventions(scan);
  assert.equal(summary.hasAnyInferredConvention, true);
  assert.equal(summary.newConsolePattern, '/Roms/<SYSTEM>');
  assert.equal(summary.unseenCasingLabel, 'lowercase');
  assert.deepEqual(
    summary.observedSubfolders.map((s) => `${s.category}:${s.folder}`),
    ['translations:trans', 'hack:hacks'],
  );

  // Swapping to EmuDeck lowercase console folders creates Emulation/roms/n64
  const deckNodes: ScannedDirNode[] = [
    { relativePath: '', name: 'DECK_SD', depth: 0, childDirs: ['Emulation'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Emulation', name: 'Emulation', depth: 1, childDirs: ['roms'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Emulation/roms', name: 'roms', depth: 2, childDirs: ['snes', 'gba', 'psx'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Emulation/roms/snes', name: 'snes', depth: 3, childDirs: ['HACKS'], sampleExtensions: ['sfc'], fileCount: 10 },
    { relativePath: 'Emulation/roms/gba', name: 'gba', depth: 3, childDirs: [], sampleExtensions: ['gba'], fileCount: 8 },
    { relativePath: 'Emulation/roms/psx', name: 'psx', depth: 3, childDirs: [], sampleExtensions: ['chd'], fileCount: 6 },
  ];
  const deckScan = discoverStorageFolderMappings(deckNodes, { rootLabel: 'DECK_SD' });
  const effectiveDeck = composeEffectiveStorageFolderConfig(createDefaultStorageFolderConfig(), deckScan);
  assert.equal(resolveTargetStorageFolder('n64-roms', 'retail', effectiveDeck), 'Emulation/roms/n64');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'hack', effectiveDeck), 'Emulation/roms/n64/HACKS');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'homebrew', effectiveDeck), 'Emulation/roms/n64/HOMEBREW');
  assert.equal(summarizeDeviceInferredConventions(deckScan).newConsolePattern, '/Emulation/roms/<system>');
});

test('buildLiveExportDestinations adapts to detected mounted device consoles and includes inferred new-console preview', () => {
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

  assert.equal(samples.length, 4);
  assert.equal(samples[0]?.folderPath, 'games/SNES');
  assert.equal(samples[0]?.source, 'auto');
  assert.equal(samples[1]?.folderPath, 'games/SNES/Hacks');
  assert.equal(samples[1]?.source, 'auto');
  assert.equal(samples[2]?.folderPath, 'games/Genesis/Translations');
  assert.equal(samples[2]?.systemLabel, 'Genesis');
  assert.equal(samples[2]?.source, 'auto');
  assert.equal(samples[3]?.id, 'new_console');
  assert.equal(samples[3]?.folderPath, 'games/N64/Homebrew');
  assert.equal(samples[3]?.source, 'inferred');
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

test('filterUnmatchedDeviceFolders excludes folders mapped via manual console overrides (including case and Roms/ prefix variants)', () => {
  const cfg = createDefaultStorageFolderConfig();
  cfg.systemFolders['32x-roms'] = '/MY_CUSTOM_32X';
  cfg.systemFolders['sg-1000'] = 'Roms/MY_SG_DIR';
  cfg.systemFolders['atari-5200-roms'] = 'MY_5200';

  // Direct root mount (unmatched paths have no Roms/ prefix)
  assert.deepEqual(
    filterUnmatchedDeviceFolders(
      ['MY_CUSTOM_32X', 'my_sg_dir', 'STILL_UNKNOWN'],
      cfg,
      '',
    ),
    ['STILL_UNKNOWN'],
  );

  // Nested Roms/ mount (manual override entered without Roms/ prefix still clears Roms/MY_5200)
  assert.deepEqual(
    filterUnmatchedDeviceFolders(
      ['Roms/MY_5200', 'Roms/MY_SG_DIR', 'Roms/OTHER_STUFF'],
      cfg,
      'Roms',
    ),
    ['Roms/OTHER_STUFF'],
  );
});

test('propagates sorting prefix/wrapper conventions like !hacks and !trans to unseen types (!ports, !homebrew) while guarding BIOS, PSX2PSP, and manual overrides', () => {
  const bangNodes: ScannedDirNode[] = [
    { relativePath: '', name: 'SORTED_SD', depth: 0, childDirs: ['Roms'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms', name: 'Roms', depth: 1, childDirs: ['SNES', 'NES', 'GBA'], sampleExtensions: [], fileCount: 0 },
    { relativePath: 'Roms/SNES', name: 'SNES', depth: 2, childDirs: ['!hacks', '!trans'], sampleExtensions: ['sfc'], fileCount: 24 },
    { relativePath: 'Roms/NES', name: 'NES', depth: 2, childDirs: ['!hacks', '!trans'], sampleExtensions: ['nes'], fileCount: 16 },
    { relativePath: 'Roms/GBA', name: 'GBA', depth: 2, childDirs: [], sampleExtensions: ['gba'], fileCount: 12 },
  ];
  const scan = discoverStorageFolderMappings(bangNodes, {
    rootLabel: 'SORTED_SD',
    preferredSlugs: ['snes-roms', 'nes-roms', 'gba-roms'],
  });

  const savedManual = createDefaultStorageFolderConfig();
  const effective = composeEffectiveStorageFolderConfig(savedManual, scan);

  // Existing consoles keep !hacks / !trans and inherit !ports, !homebrew, !undubs, !prototypes, !unlicensed
  assert.equal(resolveTargetStorageFolder('snes-roms', 'hack', effective), 'Roms/SNES/!hacks');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'translations', effective), 'Roms/SNES/!trans');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'port', effective), 'Roms/SNES/!ports');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'homebrew', effective), 'Roms/SNES/!homebrew');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'undub', effective), 'Roms/SNES/!undubs');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'demo_proto', effective), 'Roms/SNES/!prototypes');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'bootleg', effective), 'Roms/SNES/!unlicensed');

  // Existing flat console (GBA) and brand-new console (N64) inherit the same ! convention
  assert.equal(resolveTargetStorageFolder('gba-roms', 'port', effective), 'Roms/GBA/!ports');
  assert.equal(resolveTargetStorageFolder('gba-roms', 'homebrew', effective), 'Roms/GBA/!homebrew');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'retail', effective), 'Roms/N64');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'hack', effective), 'Roms/N64/!hacks');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'translations', effective), 'Roms/N64/!trans');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'port', effective), 'Roms/N64/!ports');
  assert.equal(resolveTargetStorageFolder('n64-roms', 'homebrew', effective), 'Roms/N64/!homebrew');

  // Standalone BIOS and PSX2PSP consoles must never duplicate into BIOS/!bios or PSX2PSP/!psx2psp
  assert.equal(resolveTargetStorageFolder('bios-files', 'bios', effective), 'BIOS');
  assert.equal(resolveTargetStorageFolder('psx2psp-eboots', 'psx2psp', effective), 'Roms/PSX2PSP');

  // Tier 1 manual global subfolder override still wins over inferred !ports
  const withManualPort = createDefaultStorageFolderConfig();
  withManualPort.globalTypeSubfolders.port = 'CustomPorts';
  const effectiveWithManual = composeEffectiveStorageFolderConfig(withManualPort, scan);
  assert.equal(resolveTargetStorageFolder('snes-roms', 'port', effectiveWithManual), 'Roms/SNES/CustomPorts');
  assert.equal(resolveTargetStorageFolder('snes-roms', 'homebrew', effectiveWithManual), 'Roms/SNES/!homebrew');

  // Convention summary & live export preview reflect the inferred /!<type> pattern
  const summary = summarizeDeviceInferredConventions(scan);
  assert.equal(summary.unseenSubfolderPattern, '/!<type>');
  assert.equal(summary.unseenCasingLabel, 'lowercase');

  const preview = buildLiveExportDestinations(
    effective,
    {
      romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
      romSanitizeFat32: true,
      romMaxFilenameLen: 0,
    },
    {
      savedManualConfig: savedManual,
      autoConfigResult: scan,
    },
  );
  assert.equal(preview[3]?.id, 'new_console');
  assert.equal(preview[3]?.folderPath, 'Roms/N64/!homebrew');
  assert.equal(preview[3]?.source, 'inferred');
});

test('propagates alternate sorting conventions (_HACKS, [Hacks], ! Hacks) to unseen ROM types', () => {
  const cases: Array<{
    observed: string[];
    expectedPort: string;
    expectedHomebrew: string;
    expectedPattern: string;
  }> = [
    {
      observed: ['_HACKS', '_TRANS'],
      expectedPort: 'Roms/SNES/_PORTS',
      expectedHomebrew: 'Roms/SNES/_HOMEBREW',
      expectedPattern: '/_<TYPE>',
    },
    {
      observed: ['[Hacks]', '[Translations]'],
      expectedPort: 'Roms/SNES/[Ports]',
      expectedHomebrew: 'Roms/SNES/[Homebrew]',
      expectedPattern: '/[<Type>]',
    },
    {
      observed: ['! Hacks', '! Trans'],
      expectedPort: 'Roms/SNES/! Ports',
      expectedHomebrew: 'Roms/SNES/! Homebrew',
      expectedPattern: '/! <Type>',
    },
  ];

  for (const tc of cases) {
    const nodes: ScannedDirNode[] = [
      { relativePath: '', name: 'TEST_SD', depth: 0, childDirs: ['Roms'], sampleExtensions: [], fileCount: 0 },
      { relativePath: 'Roms', name: 'Roms', depth: 1, childDirs: ['SNES'], sampleExtensions: [], fileCount: 0 },
      { relativePath: 'Roms/SNES', name: 'SNES', depth: 2, childDirs: tc.observed, sampleExtensions: ['sfc'], fileCount: 15 },
    ];
    const scan = discoverStorageFolderMappings(nodes, {
      rootLabel: 'TEST_SD',
      preferredSlugs: ['snes-roms'],
    });
    const effective = composeEffectiveStorageFolderConfig(createDefaultStorageFolderConfig(), scan);
    assert.equal(resolveTargetStorageFolder('snes-roms', 'port', effective), tc.expectedPort);
    assert.equal(resolveTargetStorageFolder('snes-roms', 'homebrew', effective), tc.expectedHomebrew);
    assert.equal(summarizeDeviceInferredConventions(scan).unseenSubfolderPattern, tc.expectedPattern);
  }
});

