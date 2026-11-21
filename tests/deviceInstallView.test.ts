import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExportQueueRow } from '../src/hooks/useBulkStorageInstaller.ts';
import {
  DEFAULT_ROM_TYPE_SUBFOLDERS,
  type StorageFolderMappingConfig,
} from '../src/shared/storageFolderMappings.ts';
import type { PlayableExportTarget } from '../src/types.ts';
import {
  buildInstallModalTitle,
  formatDevicePath,
  groupInstallRowsByGame,
  summarizeDestinationFolders,
} from '../src/utils/deviceInstallView.ts';
import { registerWrittenEntryInScan, type SdScanFolderResult } from '../src/utils/sdCardFs.ts';

const baseStorageConfig: StorageFolderMappingConfig = {
  typeSubfoldersEnabled: true,
  globalTypeSubfolders: { ...DEFAULT_ROM_TYPE_SUBFOLDERS },
  systemFolders: { 'snes-rom': 'SNES', 'gba-roms': 'GBA' },
  systemTypeOverrides: {},
};

function makeTarget(overrides: Partial<PlayableExportTarget> = {}): PlayableExportTarget {
  return {
    id: 't1',
    kind: 'rom',
    displayName: 'Chrono Trigger (English v1.2).sfc',
    suggestedFilename: 'Chrono Trigger (English v1.2).sfc',
    suggestedArchiveName: 'Chrono Trigger (English v1.2).zip',
    primaryEntry: 'Chrono Trigger (English v1.2).sfc',
    entryPaths: ['Chrono Trigger (English v1.2).sfc'],
    extension: '.sfc',
    sizeBytes: 4 * 1024 * 1024,
    detectedVersion: 'v1.2',
    roleBadge: 'Translation',
    ...overrides,
  };
}

function makeRow(overrides: Partial<ExportQueueRow> = {}): ExportQueueRow {
  const target = makeTarget();
  return {
    rowKey: '10-100',
    itemId: 10,
    fileId: 100,
    title: 'Chrono Trigger',
    systemName: 'snes-rom',
    releaseTags: ['English Translation'],
    sourceFilename: 'Chrono Trigger (English v1.2).zip',
    fileRole: 'English Translation',
    targets: [target],
    selectedTargetIds: [target.id],
    recommendedTargetIds: [target.id],
    smartReasonsByTargetId: { [target.id]: 'Latest v1.2' },
    isMultiChoiceItem: false,
    outputNamesByTargetId: { [target.id]: target.suggestedFilename },
    replaceOlderByTargetId: { [target.id]: true },
    overwriteExisting: false,
    error: null,
    patchOnly: false,
    ignoredEntriesCount: 0,
    writeState: 'pending',
    writeDetail: null,
    bytesWritten: 0,
    ...overrides,
  };
}

test('groupInstallRowsByGame collapses multi-archive rows into one game ordered recommended & newest first', () => {
  const olderTarget = makeTarget({
    id: 'old',
    displayName: 'Chrono Trigger (T-En) (v1.0).sfc',
    suggestedFilename: 'Chrono Trigger (T-En) (v1.0).sfc',
    detectedVersion: 'v1.0',
  });
  const midTarget = makeTarget({
    id: 'mid',
    displayName: 'Chrono Trigger (T-En) (v1.2).sfc',
    suggestedFilename: 'Chrono Trigger (T-En) (v1.2).sfc',
    detectedVersion: 'v1.2',
  });
  const latestTarget = makeTarget({
    id: 'latest',
    displayName: 'Chrono Trigger (T-En) (v1.4).sfc',
    suggestedFilename: 'Chrono Trigger (T-En) (v1.4).sfc',
    detectedVersion: 'v1.4',
    sizeBytes: 4_500_000,
  });

  const rows: ExportQueueRow[] = [
    makeRow({
      rowKey: '10-101',
      fileId: 101,
      sourceFilename: 'Chrono Trigger (English v1.0).zip',
      targets: [olderTarget],
      selectedTargetIds: [],
      recommendedTargetIds: [],
      smartReasonsByTargetId: {},
      isMultiChoiceItem: true,
      outputNamesByTargetId: { old: olderTarget.suggestedFilename },
    }),
    makeRow({
      rowKey: '10-102',
      fileId: 102,
      sourceFilename: 'Chrono Trigger (English v1.2-1.4).zip',
      targets: [midTarget, latestTarget],
      selectedTargetIds: ['latest'],
      recommendedTargetIds: ['latest'],
      smartReasonsByTargetId: { latest: 'Latest v1.4' },
      isMultiChoiceItem: true,
      outputNamesByTargetId: {
        mid: midTarget.suggestedFilename,
        latest: latestTarget.suggestedFilename,
      },
    }),
  ];

  const snesTranslationsScan: SdScanFolderResult = {
    exactNames: new Set(),
    exactNamesLower: new Map(),
    entries: [],
  };
  registerWrittenEntryInScan(
    snesTranslationsScan,
    'Chrono Trigger (T-En) (v1.1).sfc',
    'file',
  );
  const folderScans: Record<string, SdScanFolderResult> = {
    'SNES/Translations': snesTranslationsScan,
  };

  const games = groupInstallRowsByGame({
    rows,
    storageConfig: baseStorageConfig,
    filterContext: {},
    folderScans,
    deviceName: 'Roms',
  });

  assert.equal(games.length, 1);
  const game = games[0];
  assert.equal(game.options.length, 3);
  assert.equal(game.hasMultipleOptions, true);
  assert.equal(game.hasMultipleArchives, true);
  assert.deepEqual(
    game.options.map((o) => o.target.id),
    ['latest', 'mid', 'old'],
  );
  assert.equal(game.selectedOptions.length, 1);
  assert.equal(game.selectedOptions[0].target.id, 'latest');
  assert.equal(
    game.selectedOptions[0].fullDestinationPath,
    'Roms/SNES/Translations/Chrono Trigger (T-En) (v1.4).sfc',
  );
  assert.equal(game.selectedOptions[0].deviceStatus, 'upgrade');
  assert.equal(
    game.selectedOptions[0].replacesEntryName,
    'Chrono Trigger (T-En) (v1.1).sfc',
  );
  assert.equal(game.hasUpgradeOnDevice, true);
});

test('summarizeDestinationFolders aggregates selected games and bytes per destination folder', () => {
  const g1 = makeRow({ itemId: 1, title: 'Game A', systemName: 'snes-rom' });
  const g2Target = makeTarget({
    id: 'g2',
    displayName: 'Game B.sfc',
    suggestedFilename: 'Game B.sfc',
    sizeBytes: 2_000_000,
  });
  const g2 = makeRow({
    rowKey: '2-200',
    itemId: 2,
    fileId: 200,
    title: 'Game B',
    systemName: 'snes-rom',
    targets: [g2Target],
    selectedTargetIds: ['g2'],
    recommendedTargetIds: ['g2'],
    outputNamesByTargetId: { g2: 'Game B.sfc' },
  });
  const g3Target = makeTarget({
    id: 'g3',
    displayName: 'Mother 3 (English).gba',
    suggestedFilename: 'Mother 3 (English).gba',
    sizeBytes: 16_000_000,
  });
  const g3 = makeRow({
    rowKey: '3-300',
    itemId: 3,
    fileId: 300,
    title: 'Mother 3',
    systemName: 'gba-roms',
    targets: [g3Target],
    selectedTargetIds: ['g3'],
    recommendedTargetIds: ['g3'],
    outputNamesByTargetId: { g3: 'Mother 3 (English).gba' },
  });

  const games = groupInstallRowsByGame({
    rows: [g1, g2, g3],
    storageConfig: baseStorageConfig,
    filterContext: {},
    folderScans: {},
    deviceName: 'Roms',
  });

  const summary = summarizeDestinationFolders(games);
  assert.equal(summary.length, 2);
  assert.equal(summary[0].folder, 'SNES/Translations');
  assert.equal(summary[0].gameCount, 2);
  assert.equal(summary[1].folder, 'GBA/Translations');
  assert.equal(summary[1].gameCount, 1);
});

test('buildInstallModalTitle and formatDevicePath produce clean human-friendly headings and paths', () => {
  assert.equal(
    buildInstallModalTitle({ phase: 'ready', itemCount: 1, deviceName: 'Roms' }),
    'Install to Roms',
  );
  assert.equal(
    buildInstallModalTitle({ phase: 'ready', itemCount: 1, deviceName: null }),
    'Install to Device',
  );
  assert.equal(
    buildInstallModalTitle({ phase: 'ready', itemCount: 14, deviceName: 'MiSTer' }),
    'Install 14 Games to MiSTer',
  );
  assert.equal(
    buildInstallModalTitle({ phase: 'running', itemCount: 14, deviceName: 'MiSTer' }),
    'Installing to MiSTer',
  );
  assert.equal(
    buildInstallModalTitle({ phase: 'completed', itemCount: 14, deviceName: 'MiSTer' }),
    'Installed to MiSTer',
  );

  assert.equal(
    formatDevicePath('Roms', 'SNES/Translations', 'Chrono Trigger.sfc'),
    'Roms/SNES/Translations/Chrono Trigger.sfc',
  );
  assert.equal(
    formatDevicePath(null, 'SNES/Translations', 'Chrono Trigger.sfc'),
    '/SNES/Translations/Chrono Trigger.sfc',
  );
  assert.equal(
    formatDevicePath('Roms', 'PS1', 'Final Fantasy VII.zip', true),
    'Roms/PS1/Final Fantasy VII/',
  );
});
