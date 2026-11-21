import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendNamingToken,
  buildLiveExportDestinations,
  buildScanReviewSummary,
  findActiveNamingPreset,
  findEvaluatedScanMatch,
  shouldAutoExpandAdvancedNaming,
  summarizeNamingOptions,
} from '../src/shared/deviceExportUi.ts';
import { DEFAULT_ROM_NAMING_TEMPLATE } from '../src/shared/romNaming.ts';
import { discoverStorageFolderMappings, type ScannedDirNode } from '../src/shared/storageAutoConfig.ts';
import { createDefaultStorageFolderConfig } from '../src/shared/storageFolderMappings.ts';

test('buildLiveExportDestinations combines console folders, ROM-type subfolders, and naming preset', () => {
  const flatConfig = createDefaultStorageFolderConfig();
  flatConfig.systemFolders['snes-roms'] = 'Roms/SFC';
  flatConfig.systemFolders['gba-roms'] = 'Roms/GBA';
  flatConfig.typeSubfoldersEnabled = false;

  const flatSamples = buildLiveExportDestinations(flatConfig, {
    romNamingTemplate: DEFAULT_ROM_NAMING_TEMPLATE,
    romSanitizeFat32: true,
    romMaxFilenameLen: 0,
  });

  assert.equal(flatSamples.length, 3);
  assert.equal(flatSamples[0]?.folderPath, 'Roms/SFC');
  assert.equal(flatSamples[0]?.fullPath, '/Roms/SFC/Super Mario World (USA).sfc');
  assert.equal(flatSamples[1]?.folderPath, 'Roms/SFC');
  assert.match(flatSamples[1]?.filename || '', /Hack v1\.42/);
  assert.equal(flatSamples[2]?.folderPath, 'Roms/GBA');

  const sortedConfig = {
    ...flatConfig,
    typeSubfoldersEnabled: true,
  };
  const sortedSamples = buildLiveExportDestinations(sortedConfig, {
    romNamingTemplate: '{origName}',
    romSanitizeFat32: true,
    romMaxFilenameLen: 0,
  });

  assert.equal(sortedSamples[0]?.folderPath, 'Roms/SFC');
  assert.equal(sortedSamples[1]?.folderPath, 'Roms/SFC/Hacks');
  assert.equal(sortedSamples[1]?.filename, 'smw_rtdl.sfc');
  assert.equal(sortedSamples[2]?.folderPath, 'Roms/GBA/Translations');
  assert.equal(sortedSamples[2]?.filename, 'mother3_patched.gba');
});

test('naming disclosure helpers keep defaults collapsed and auto-expand custom naming setups', () => {
  assert.equal(
    findActiveNamingPreset(DEFAULT_ROM_NAMING_TEMPLATE)?.id,
    'standard',
  );
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

test('buildScanReviewSummary indexes matches by canonical slug for unified single-list review', () => {
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
  assert.equal(summary.counts.newCount, 1);
  assert.equal(summary.counts.updatesCustomCount, 1);
  assert.equal(summary.counts.unchangedCount, 1);
  assert.equal(summary.counts.actionableCount, 2);
  assert.equal(summary.counts.withSubfoldersCount, 1);
  assert.equal(summary.counts.selectedWithSubfoldersCount, 1);

  assert.equal(findEvaluatedScanMatch(summary, 'snes-roms')?.diff.kind, 'new');
  assert.equal(findEvaluatedScanMatch(summary, 'snes')?.diff.kind, 'new');
  assert.equal(findEvaluatedScanMatch(summary, 'snes-roms')?.detectedSubEntries.length, 1);
  assert.equal(findEvaluatedScanMatch(summary, 'nes-roms')?.diff.kind, 'updates_custom');
  assert.equal(findEvaluatedScanMatch(summary, 'gba-roms')?.diff.kind, 'unchanged');
});
