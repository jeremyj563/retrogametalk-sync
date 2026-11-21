import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArchiveInspectResult, PlayableExportTarget, ReleaseFileRecord } from '../src/types';
import {
  buildPreparedRomDownloadUrl,
  formatDeviceActionLabel,
  resolveGameDetailFooterPlan,
  resolveRomDownloadOutcome,
  selectPrimaryDownloadFile,
  shouldShowPerFileDownloadButton,
} from '../src/utils/gameDetailActions';

function makeTarget(overrides: Partial<PlayableExportTarget> = {}): PlayableExportTarget {
  return {
    id: 'target-1',
    kind: 'rom',
    displayName: 'Super Mario World (USA).sfc',
    entryPaths: ['Super Mario World (USA).sfc'],
    primaryEntry: 'Super Mario World (USA).sfc',
    extension: '.sfc',
    sizeBytes: 524_288,
    suggestedFilename: 'Super Mario World (USA).sfc',
    suggestedArchiveName: 'Super Mario World (USA).zip',
    detectedVersion: null,
    roleBadge: null,
    ...overrides,
  };
}

function makeInspection(overrides: Partial<ArchiveInspectResult> = {}): ArchiveInspectResult {
  return {
    itemId: 42,
    fileId: 7,
    sourceFilename: 'Super Mario World (USA).zip',
    archiveFormat: 'zip',
    playableTargets: [makeTarget()],
    ignoredEntriesCount: 1,
    ignoredSample: ['readme.txt'],
    patchOnly: false,
    notes: [],
    ...overrides,
  };
}

test('resolveRomDownloadOutcome triggers instant download for single playable ROM', () => {
  const inspection = makeInspection();
  const outcome = resolveRomDownloadOutcome(42, inspection);

  assert.equal(outcome.kind, 'instant_download');
  if (outcome.kind === 'instant_download') {
    assert.equal(outcome.fileId, 7);
    assert.equal(outcome.filename, 'Super Mario World (USA).sfc');
    assert.equal(
      outcome.url,
      '/api/items/42/download-rom?fileId=7&targetId=target-1&name=Super+Mario+World+%28USA%29.sfc',
    );
  }
});

test('resolveRomDownloadOutcome triggers instant clean zip download for single disc set', () => {
  const discTarget = makeTarget({
    id: 'disc-1',
    kind: 'disc_set',
    displayName: 'Chrono Cross (Disc 1).cue',
    extension: '.cue',
    suggestedFilename: 'Chrono Cross (Disc 1).cue',
    suggestedArchiveName: 'Chrono Cross (Disc 1).zip',
  });
  const outcome = resolveRomDownloadOutcome(
    99,
    makeInspection({ itemId: 99, fileId: 12, playableTargets: [discTarget] }),
  );

  assert.equal(outcome.kind, 'instant_download');
  if (outcome.kind === 'instant_download') {
    assert.equal(outcome.filename, 'Chrono Cross (Disc 1).zip');
    assert.ok(outcome.url.includes('name=Chrono+Cross+%28Disc+1%29.zip'));
  }
});

test('resolveRomDownloadOutcome returns variant picker ordered latest-version-first for archives with 2+ playable ROMs', () => {
  const targets = [
    makeTarget({ id: 'rev-a', displayName: 'Game (Rev 1).sfc', suggestedFilename: 'Game (Rev 1).sfc' }),
    makeTarget({ id: 'rev-b', displayName: 'Game (Rev 2).sfc', suggestedFilename: 'Game (Rev 2).sfc' }),
  ];
  const outcome = resolveRomDownloadOutcome(42, makeInspection({ playableTargets: targets }));

  assert.equal(outcome.kind, 'variant_picker');
  if (outcome.kind === 'variant_picker') {
    assert.equal(outcome.targets.length, 2);
    assert.equal(outcome.fileId, 7);
    assert.equal(outcome.targets[0].id, 'rev-b');
    assert.equal(outcome.targets[1].id, 'rev-a');
  }
});

test('resolveRomDownloadOutcome returns patch-only fallback when 0 playable ROMs exist', () => {
  const outcome = resolveRomDownloadOutcome(
    42,
    makeInspection({
      playableTargets: [],
      patchOnly: true,
      sourceFilename: 'Translation-v2.zip',
    }),
  );

  assert.equal(outcome.kind, 'patch_only_fallback');
  if (outcome.kind === 'patch_only_fallback') {
    assert.equal(outcome.patchOnly, true);
    assert.equal(outcome.sourceFilename, 'Translation-v2.zip');
  }
});

test('resolveGameDetailFooterPlan prioritizes Install to Device when mounted', () => {
  const plan = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'downloaded',
    hasFailedFiles: false,
    mountedDeviceName: 'Roms',
    canInstallToDevice: true,
    installedAt: null,
    installedDeviceLabel: null,
  });

  assert.equal(plan.primaryAction, 'install_mounted');
  assert.equal(plan.secondaryAction, 'download_rom');
  assert.equal(plan.installButtonLabel, 'Install to Roms');
  assert.equal(plan.isReinstallOnMountedDevice, false);
  assert.equal(plan.showReviewDeviceInstallInMore, true);
  assert.equal(plan.showRetryInMore, false);
});

test('resolveGameDetailFooterPlan uses Reinstall label only when already installed on same mounted device', () => {
  const sameDevice = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'downloaded',
    hasFailedFiles: false,
    mountedDeviceName: 'MiyooMini',
    canInstallToDevice: true,
    installedAt: '2026-11-21T01:00:00Z',
    installedDeviceLabel: 'MiyooMini',
  });
  assert.equal(sameDevice.installButtonLabel, 'Reinstall to MiyooMini');
  assert.equal(sameDevice.isReinstallOnMountedDevice, true);

  const differentDevice = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'downloaded',
    hasFailedFiles: false,
    mountedDeviceName: 'AnaloguePocket',
    canInstallToDevice: true,
    installedAt: '2026-11-21T01:00:00Z',
    installedDeviceLabel: 'MiyooMini',
  });
  assert.equal(differentDevice.installButtonLabel, 'Install to AnaloguePocket');
  assert.equal(differentDevice.isReinstallOnMountedDevice, false);
});

test('resolveGameDetailFooterPlan prioritizes Download ROM when no device is mounted', () => {
  const plan = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'downloaded',
    hasFailedFiles: false,
    mountedDeviceName: null,
    canInstallToDevice: true,
    installedAt: null,
    installedDeviceLabel: null,
  });

  assert.equal(plan.primaryAction, 'download_rom');
  assert.equal(plan.secondaryAction, 'install_unmounted');
  assert.equal(plan.installButtonLabel, 'Install to Device');
  assert.equal(plan.showReviewDeviceInstallInMore, false);
});

test('resolveGameDetailFooterPlan handles catalog-only, failed, partial, and queued states cleanly', () => {
  const available = resolveGameDetailFooterPlan({
    hasDownloadedFile: false,
    canQueueRelease: true,
    status: 'available',
    hasFailedFiles: false,
    mountedDeviceName: 'Roms',
    canInstallToDevice: true,
    installedAt: null,
    installedDeviceLabel: null,
  });
  assert.equal(available.primaryAction, 'queue_release');
  assert.equal(available.secondaryAction, null);

  const failed = resolveGameDetailFooterPlan({
    hasDownloadedFile: false,
    canQueueRelease: true,
    status: 'failed',
    hasFailedFiles: true,
    mountedDeviceName: 'Roms',
    canInstallToDevice: true,
    installedAt: null,
    installedDeviceLabel: null,
  });
  assert.equal(failed.primaryAction, 'retry_failed');
  assert.equal(failed.secondaryAction, null);

  const partial = resolveGameDetailFooterPlan({
    hasDownloadedFile: true,
    canQueueRelease: false,
    status: 'partial',
    hasFailedFiles: true,
    mountedDeviceName: 'Roms',
    canInstallToDevice: true,
    installedAt: null,
    installedDeviceLabel: null,
  });
  assert.equal(partial.primaryAction, 'install_mounted');
  assert.equal(partial.secondaryAction, 'download_rom');
  assert.equal(partial.showRetryInMore, true);

  const downloading = resolveGameDetailFooterPlan({
    hasDownloadedFile: false,
    canQueueRelease: false,
    status: 'downloading',
    hasFailedFiles: false,
    mountedDeviceName: null,
    canInstallToDevice: false,
    installedAt: null,
    installedDeviceLabel: null,
  });
  assert.equal(downloading.primaryAction, 'status_only');
  assert.equal(downloading.secondaryAction, null);
});

test('shouldShowPerFileDownloadButton suppresses redundant row buttons on single-file releases', () => {
  assert.equal(shouldShowPerFileDownloadButton(0), false);
  assert.equal(shouldShowPerFileDownloadButton(1), false);
  assert.equal(shouldShowPerFileDownloadButton(2), true);
  assert.equal(shouldShowPerFileDownloadButton(4), true);
});

test('formatDeviceActionLabel truncates long volume labels cleanly', () => {
  assert.equal(formatDeviceActionLabel('Roms'), 'Roms');
  assert.equal(formatDeviceActionLabel('   '), 'Device');
  assert.equal(formatDeviceActionLabel('RETRO_HANDHELD_SD_256GB', 16), 'RETRO_HANDHELD_…');
});

test('buildPreparedRomDownloadUrl encodes target id and filename safely', () => {
  const { url, filename } = buildPreparedRomDownloadUrl(
    15,
    3,
    makeTarget({ id: 'folder/game #1.sfc', suggestedFilename: 'Game [v1.2].sfc' }),
  );
  assert.equal(filename, 'Game [v1.2].sfc');
  assert.equal(
    url,
    '/api/items/15/download-rom?fileId=3&targetId=folder%2Fgame+%231.sfc&name=Game+%5Bv1.2%5D.sfc',
  );
});

function makeFile(overrides: Partial<ReleaseFileRecord> = {}): ReleaseFileRecord {
  return {
    id: 1,
    releaseId: 42,
    remoteUrl: 'https://retrogametalk.com/dl/1',
    downloadUrl: 'https://retrogametalk.com/dl/1',
    remotePath: 'snes-rom/game/Game (v1.0).zip',
    localPath: '/run/repo/snes-rom/game/Game (v1.0).zip',
    filename: 'Game (v1.0).zip',
    displayLabel: 'Game (v1.0).zip',
    fileRole: 'Hack',
    fileSizeBytes: 1_000_000,
    status: 'downloaded',
    errorMessage: null,
    lastRunId: 1,
    discoveredAt: '2026-01-01T00:00:00.000Z',
    downloadedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('selectPrimaryDownloadFile picks the latest semantic, bare dotted, revision, and maturity version', () => {
  const semverPick = selectPrimaryDownloadFile({
    files: [
      makeFile({ id: 10, filename: 'Super Mario World Redux (v1.2).zip', displayLabel: 'Super Mario World Redux (v1.2).zip' }),
      makeFile({ id: 11, filename: 'Super Mario World Redux (v1.10).zip', displayLabel: 'Super Mario World Redux (v1.10).zip' }),
      makeFile({ id: 12, filename: 'Super Mario World Redux (v1.9).zip', displayLabel: 'Super Mario World Redux (v1.9).zip' }),
      makeFile({ id: 13, filename: 'Super Mario World Redux (v2.0).zip', status: 'failed' }),
    ],
  });
  assert.equal(semverPick?.id, 11);

  const bareDottedPick = selectPrimaryDownloadFile({
    files: [
      makeFile({ id: 20, filename: 'Pokemon Unbound (1.2).zip', displayLabel: 'Pokemon Unbound (1.2).zip' }),
      makeFile({ id: 21, filename: 'Pokemon Unbound (2.1.1).zip', displayLabel: 'Pokemon Unbound (2.1.1).zip' }),
    ],
  });
  assert.equal(bareDottedPick?.id, 21);

  const stagePick = selectPrimaryDownloadFile({
    files: [
      makeFile({ id: 30, filename: 'Chrono Trigger+ (v2.0 Beta 2).zip', displayLabel: 'v2.0 Beta 2' }),
      makeFile({ id: 31, filename: 'Chrono Trigger+ (v2.0).zip', displayLabel: 'v2.0' }),
      makeFile({ id: 32, filename: 'Chrono Trigger+ (v2.0 Final).zip', displayLabel: 'v2.0 Final' }),
    ],
  });
  assert.equal(stagePick?.id, 32);

  const revPick = selectPrimaryDownloadFile({
    files: [
      makeFile({ id: 40, filename: 'Legend of Zelda (USA) (Rev 1).zip', fileRole: 'ROM' }),
      makeFile({ id: 41, filename: 'Legend of Zelda (USA) (Rev 2).zip', fileRole: 'ROM' }),
    ],
  });
  assert.equal(revPick?.id, 41);
});

test('selectPrimaryDownloadFile prefers latest modified playable ROM over bundled Original ROM, standalone patches, or legacy files', () => {
  const picked = selectPrimaryDownloadFile({
    files: [
      makeFile({ id: 1, filename: 'Mother 3 (Japan) (v2.0).zip', displayLabel: 'Original ROM', fileRole: 'Original ROM' }),
      makeFile({ id: 2, filename: 'Mother 3 (English v1.2).zip', displayLabel: 'Mother 3 (English v1.2)', fileRole: 'English Translation' }),
      makeFile({ id: 3, filename: 'Mother 3 (English v1.3).zip', displayLabel: 'Mother 3 (English v1.3)', fileRole: 'English Translation' }),
      makeFile({ id: 4, filename: 'Mother 3 (English v1.4).bps', displayLabel: 'Mother 3 Patch v1.4', fileRole: 'Patch' }),
      makeFile({ id: 5, filename: 'Mother 3 (Old v1.9).zip', displayLabel: 'Old archive', fileRole: 'English Translation' }),
    ],
  });
  assert.equal(picked?.id, 3);
});

test('selectPrimaryDownloadFile prefers newer downloadedAt and higher id when unversioned', () => {
  const picked = selectPrimaryDownloadFile({
    files: [
      makeFile({
        id: 100,
        filename: 'Castlevania (USA).zip',
        displayLabel: 'Castlevania (USA).zip',
        downloadedAt: '2026-01-01T00:00:00.000Z',
      }),
      makeFile({
        id: 101,
        filename: 'Castlevania (USA) (Fixed).zip',
        displayLabel: 'Castlevania (USA) (Fixed).zip',
        downloadedAt: '2026-06-15T00:00:00.000Z',
      }),
    ],
  });
  assert.equal(picked?.id, 101);
});
