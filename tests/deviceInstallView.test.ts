import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BulkInstallJobState,
  ExportQueueRow,
} from '../src/hooks/useBulkStorageInstaller.ts';
import {
  DEFAULT_ROM_TYPE_SUBFOLDERS,
  type StorageFolderMappingConfig,
} from '../src/shared/storageFolderMappings.ts';
import type { PlayableExportTarget } from '../src/types.ts';
import {
  buildInstallModalTitle,
  formatDevicePath,
  groupInstallRowsByGame,
  isItemInstalledOnMountedDevice,
  resolveItemDeviceInstallState,
  summarizeDestinationFolders,
} from '../src/utils/deviceInstallView.ts';
import { registerWrittenEntryInScan, type SdScanFolderResult } from '../src/utils/sdCardFs.ts';
import {
  formatInstallModalCtaLabel,
  formatInstallModalCtaTooltip,
  formatMountDeviceTooltip,
  formatQuickInstallLabel,
  formatQuickInstallTooltip,
  formatRescanDeviceTooltip,
  formatSwitchDeviceTooltip,
} from '../src/utils/storageActionCopy.ts';

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

function makeJob(overrides: Partial<BulkInstallJobState> = {}): BulkInstallJobState {
  return {
    jobId: 42,
    mode: 'express',
    phase: 'running',
    itemIds: [10],
    filterContext: {},
    rows: [makeRow({ itemId: 10, writeState: 'writing' })],
    currentTitle: 'Chrono Trigger',
    activeTransfer: null,
    errorMessage: null,
    startedAt: '2026-11-22T00:00:00.000Z',
    finishedAt: null,
    ...overrides,
  };
}

test('resolveItemDeviceInstallState transitions cleanly from inspecting -> extracting -> writing -> finalizing -> completed', () => {
  const inspectingJob = makeJob({
    activeTransfer: {
      itemId: 10,
      rowKey: '10-placeholder',
      title: 'Chrono Trigger',
      stage: 'inspecting',
      filename: null,
      destinationFolder: null,
      bytesWritten: 0,
      totalBytes: null,
      percent: null,
      bytesPerSec: null,
      fileIndex: 1,
      totalFiles: 1,
    },
  });
  const inspecting = resolveItemDeviceInstallState(
    10,
    inspectingJob,
    { completedItems: 0, totalItems: 1 },
    'Roms',
  );
  assert.equal(inspecting.status, 'active');
  assert.equal(inspecting.isActive, true);
  assert.equal(inspecting.mode, 'preparing');
  assert.equal(inspecting.stage, 'inspecting');
  assert.equal(inspecting.percent, null);

  const extractingJob = makeJob({
    activeTransfer: {
      itemId: 10,
      rowKey: '10-100',
      title: 'Chrono Trigger',
      stage: 'extracting',
      filename: 'Chrono Trigger.chd',
      destinationFolder: 'PSX',
      bytesWritten: 0,
      totalBytes: 500 * 1024 * 1024,
      percent: null,
      bytesPerSec: null,
      fileIndex: 1,
      totalFiles: 1,
    },
  });
  const extracting = resolveItemDeviceInstallState(
    10,
    extractingJob,
    { completedItems: 0, totalItems: 1 },
    'Roms',
  );
  assert.equal(extracting.stage, 'extracting');
  assert.equal(extracting.mode, 'preparing');
  assert.equal(extracting.destinationPath, '/PSX/Chrono Trigger.chd');
  assert.match(extracting.bytesLabel, /500(\.0)? MB/);

  const writingJob = makeJob({
    activeTransfer: {
      itemId: 10,
      rowKey: '10-100',
      title: 'Chrono Trigger',
      stage: 'writing',
      filename: 'Chrono Trigger.chd',
      destinationFolder: 'PSX',
      bytesWritten: 250 * 1024 * 1024,
      totalBytes: 500 * 1024 * 1024,
      percent: 50,
      bytesPerSec: 20 * 1024 * 1024,
      fileIndex: 1,
      totalFiles: 2,
    },
  });
  const writing = resolveItemDeviceInstallState(
    10,
    writingJob,
    { completedItems: 0, totalItems: 1 },
    'Roms',
  );
  assert.equal(writing.status, 'active');
  assert.equal(writing.mode, 'determinate');
  assert.equal(writing.percent, 50);
  assert.equal(writing.fileSequenceLabel, 'File 1/2');
  assert.match(writing.bytesLabel, /250(\.0)? MB \/ 500(\.0)? MB/);
  assert.match(writing.speedLabel, /20(\.0)? MB\/s/);

  const finalizingJob = makeJob({
    activeTransfer: {
      itemId: 10,
      rowKey: '10-100',
      title: 'Chrono Trigger',
      stage: 'finalizing',
      filename: 'Chrono Trigger.chd',
      destinationFolder: 'PSX',
      bytesWritten: 500 * 1024 * 1024,
      totalBytes: 500 * 1024 * 1024,
      percent: 100,
      bytesPerSec: null,
      fileIndex: 1,
      totalFiles: 1,
    },
  });
  const finalizing = resolveItemDeviceInstallState(
    10,
    finalizingJob,
    { completedItems: 0, totalItems: 1 },
    'Roms',
  );
  assert.equal(finalizing.stage, 'finalizing');
  assert.equal(finalizing.mode, 'determinate');
  assert.equal(finalizing.percent, 100);

  const completedJob = makeJob({
    phase: 'completed',
    rows: [
      makeRow({
        itemId: 10,
        writeState: 'written',
        writeDetail: 'Saved to /PSX · 500.0 MB',
        bytesWritten: 500 * 1024 * 1024,
      }),
    ],
    activeTransfer: null,
  });
  const completed = resolveItemDeviceInstallState(
    10,
    completedJob,
    { completedItems: 1, totalItems: 1 },
    'Roms',
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.isActive, false);
  assert.equal(completed.isFinished, true);
  assert.equal(completed.outcomeKind, 'written');
  assert.equal(completed.outcomeSummary, 'Saved to /PSX · 500.0 MB');
  assert.equal(completed.stageLabel, 'Installed to Roms');
});

test('resolveItemDeviceInstallState handles idle review queues, queued batch items, and error/cancel states', () => {
  const readyReview = makeJob({ mode: 'review', phase: 'ready' });
  assert.equal(
    resolveItemDeviceInstallState(10, readyReview, { completedItems: 0, totalItems: 1 }, 'Roms')
      .status,
    'idle',
  );

  const batchJob = makeJob({
    itemIds: [10, 20],
    rows: [
      makeRow({ itemId: 10, writeState: 'writing' }),
      makeRow({ rowKey: '20-200', itemId: 20, title: 'Mother 3', writeState: 'pending' }),
    ],
    activeTransfer: {
      itemId: 10,
      rowKey: '10-100',
      title: 'Chrono Trigger',
      stage: 'writing',
      filename: 'Chrono Trigger.sfc',
      destinationFolder: 'SNES',
      bytesWritten: 1024,
      totalBytes: 4096,
      percent: 25,
      bytesPerSec: 1024,
      fileIndex: 1,
      totalFiles: 1,
    },
  });
  const queuedItem = resolveItemDeviceInstallState(
    20,
    batchJob,
    { completedItems: 0, totalItems: 2 },
    'Roms',
  );
  assert.equal(queuedItem.status, 'queued');
  assert.equal(queuedItem.isActive, true);
  assert.equal(queuedItem.isBatchJob, true);
  assert.match(queuedItem.bytesLabel, /0\/2 games done/);

  const erroredJob = makeJob({
    phase: 'error',
    errorMessage: 'Disk full',
    rows: [makeRow({ itemId: 10, writeState: 'error', writeDetail: 'Disk full' })],
  });
  const errored = resolveItemDeviceInstallState(
    10,
    erroredJob,
    { completedItems: 1, totalItems: 1 },
    'Roms',
  );
  assert.equal(errored.status, 'error');
  assert.equal(errored.outcomeKind, 'error');
  assert.equal(errored.outcomeSummary, 'Disk full');
});

test('storageActionCopy produces unified labels and tooltips across install, mount, switch, and rescan controls', () => {
  assert.equal(
    formatQuickInstallLabel({ mountedDeviceName: 'Roms', compact: true }),
    'Install',
  );
  assert.equal(
    formatQuickInstallLabel({ mountedDeviceName: 'Roms', isReinstall: true, compact: true }),
    'Reinstall',
  );
  assert.equal(
    formatQuickInstallLabel({ mountedDeviceName: 'Roms', count: 5 }),
    'Install to Roms (5)',
  );
  assert.equal(
    formatQuickInstallLabel({ mountedDeviceName: null, count: 5 }),
    'Install to Device (5)',
  );
  assert.equal(
    formatQuickInstallTooltip({ mountedDeviceName: 'Roms' }),
    'Install latest primary ROM directly to Roms',
  );
  assert.equal(
    formatQuickInstallTooltip({ mountedDeviceName: 'Roms', isReinstall: true }),
    'Reinstall latest primary ROM directly to Roms',
  );
  assert.equal(
    formatQuickInstallTooltip({ mountedDeviceName: null }),
    'Mount a storage device and install the latest primary ROM',
  );
  assert.equal(
    formatQuickInstallTooltip({ mountedDeviceName: 'Roms', isOtherBusy: true }),
    'Another storage device install is currently in progress',
  );

  assert.equal(
    formatInstallModalCtaLabel({ mountedDeviceName: null, isSingleGame: true, selectedCount: 1 }),
    'Mount Device & Install',
  );
  assert.equal(
    formatInstallModalCtaLabel({ mountedDeviceName: null, isSingleGame: false, selectedCount: 4 }),
    'Mount Device & Install 4 Games',
  );
  assert.equal(
    formatInstallModalCtaLabel({ mountedDeviceName: 'Roms', isSingleGame: false, selectedCount: 4 }),
    'Install 4 Games to Roms',
  );
  assert.equal(
    formatInstallModalCtaTooltip({ mountedDeviceName: null, isSingleGame: true, selectedCount: 1 }),
    'Mount a storage device and install the selected ROM',
  );
  assert.equal(
    formatMountDeviceTooltip({ supported: true, reason: '' }),
    'Mount a storage device folder (auto-configures console paths immediately)',
  );
  assert.equal(
    formatMountDeviceTooltip({ supported: false, reason: 'HTTPS required' }),
    'HTTPS required',
  );
  assert.equal(
    formatSwitchDeviceTooltip(false),
    'Switch to a different storage device folder (auto-configures console paths immediately)',
  );
  assert.equal(
    formatSwitchDeviceTooltip(true),
    'Finish or cancel the active transfer before switching devices',
  );
  assert.equal(
    formatRescanDeviceTooltip('layout', false),
    'Rescan mounted device folders to refresh auto-configured console paths',
  );
  assert.equal(
    formatRescanDeviceTooltip('folders', false),
    'Rescan mounted device folders to check for existing or older ROM files',
  );
});

test('isItemInstalledOnMountedDevice switches immediately to Reinstall without stale post-unmark stickiness', () => {
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: null,
      installedAt: '2026-11-23T00:00:00.000Z',
      installedDeviceLabel: 'Roms',
    }),
    false,
  );

  // Persisted install on same device (case-insensitive) -> true
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'Roms',
      installedAt: '2026-11-23T00:00:00.000Z',
      installedDeviceLabel: 'roms',
    }),
    true,
  );

  // Persisted install on a different device -> false (shows Install to new device)
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'MIYOO',
      installedAt: '2026-11-23T00:00:00.000Z',
      installedDeviceLabel: 'ANBERNIC',
    }),
    false,
  );

  // Mid-batch completed row before server flush finishes -> true so button never flashes Install
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'Roms',
      installedAt: null,
      installedDeviceLabel: null,
      liveInstallState: { isFinished: true, outcomeKind: 'written' },
      installerIsBusy: true,
    }),
    true,
  );

  // After job completes, if item is later unmarked as not installed -> cleanly reverts to false
  assert.equal(
    isItemInstalledOnMountedDevice({
      mountedDeviceName: 'Roms',
      installedAt: null,
      installedDeviceLabel: null,
      liveInstallState: { isFinished: true, outcomeKind: 'written' },
      installerIsBusy: false,
    }),
    false,
  );
});

