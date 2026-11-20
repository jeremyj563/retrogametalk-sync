import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActiveSyncItemSummary, ActiveTransferState, SyncRunRecord } from '../src/types.ts';
import {
  computeHeroCoverFrameWidthPx,
  deriveSyncReleaseIdentityKey,
  getHeroSwapDurationMs,
  parseSyncStatusHeader,
  resolveActiveSyncTargetCover,
} from '../src/utils/syncStatusPhase.ts';

function makeRun(overrides: Partial<SyncRunRecord> = {}): SyncRunRecord {
  return {
    id: 42,
    triggerType: 'manual',
    mode: 'incremental',
    dryRun: false,
    status: 'running',
    startedAt: '2026-11-18T10:00:00Z',
    finishedAt: null,
    pagesCrawled: 1,
    newFound: 1,
    downloadedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    bytesDownloaded: 0,
    rateLimitHits: 0,
    avgDelayMs: 750,
    errorSummary: null,
    ...overrides,
  };
}

function makeTransfer(overrides: Partial<ActiveTransferState> = {}): ActiveTransferState {
  return {
    workerKey: '10:20',
    itemId: 10,
    itemTitle: 'Just Breed',
    fileId: 20,
    fileIndex: 1,
    totalFiles: 2,
    completedFiles: 0,
    filename: 'Just Breed (English v1.0).zip',
    systemName: 'nes-roms',
    remoteUrl: 'https://retrogametalk.com/repository/nes-roms/just-breed/',
    localPath: '/downloads/nes-roms/Just Breed (English v1.0).zip',
    bytesReceived: 1024,
    totalBytes: 4096,
    bytesPerSec: 2048,
    activeChunks: 2,
    activeWorkers: 2,
    resumed: false,
    ...overrides,
  };
}

test('omits redundant "Syncing" prefix and keeps highlighted title steady across warm-up, active download, and handoff', () => {
  const run = makeRun({ triggerType: 'download' });

  // Phase 1: Queue warm-up before binary stream opens
  const warmUp = parseSyncStatusHeader({
    currentPhase: 'Queue (1/3): nes-roms / Just Breed',
    activeRun: run,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(warmUp.actionPrefix, null);
  assert.equal(warmUp.subject, 'Just Breed');
  assert.equal(warmUp.subjectKind, 'title');
  assert.equal(warmUp.systemName, 'nes-roms');
  assert.equal(warmUp.progressLabel, '1/3');

  // Phase 2: Binary stream active (2 parallel workers, 2 chunks) — still highlights clean game title
  const active = parseSyncStatusHeader({
    currentPhase: 'Downloading 2 files in parallel (primary: nes-roms / Just Breed (English v1.0).zip)',
    activeRun: run,
    activeTransfer: makeTransfer(),
    parallelTransferCount: 2,
  });
  assert.equal(active.actionPrefix, null);
  assert.equal(active.subject, 'Just Breed');
  assert.equal(active.subjectKind, 'title');
  assert.equal(active.systemName, 'nes-roms');
  assert.equal(active.workerCount, 2);

  // Phase 3: Inter-file handoff when worker 1 finishes and worker 2 spins up
  const handoff = parseSyncStatusHeader({
    currentPhase: 'Syncing · nes-roms: Just Breed',
    activeRun: run,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(handoff.actionPrefix, null);
  assert.equal(handoff.subject, 'Just Breed');
  assert.equal(handoff.subjectKind, 'title');
  assert.equal(handoff.systemName, 'nes-roms');
});

test('omits redundant "Syncing" prefix across incremental, full sync, and retry phases', () => {
  const fullWarmup = parseSyncStatusHeader({
    currentPhase: 'Full Sync · n64-roms (9/424): The Legend of Zelda: Ocarina of Time',
    activeRun: makeRun({ mode: 'full' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(fullWarmup.actionPrefix, null);
  assert.equal(fullWarmup.subject, 'The Legend of Zelda: Ocarina of Time');
  assert.equal(fullWarmup.subjectKind, 'title');
  assert.equal(fullWarmup.progressLabel, '9/424');

  const singleRetry = parseSyncStatusHeader({
    currentPhase: 'Retrying: Chrono Trigger',
    activeRun: makeRun({ triggerType: 'retry' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(singleRetry.actionPrefix, null);
  assert.equal(singleRetry.subject, 'Chrono Trigger');
  assert.equal(singleRetry.subjectKind, 'title');

  const batchRetry = parseSyncStatusHeader({
    currentPhase: 'Retry Failed (2/5): snes-roms / EarthBound',
    activeRun: makeRun({ triggerType: 'retry' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(batchRetry.actionPrefix, null);
  assert.equal(batchRetry.subject, 'EarthBound');
  assert.equal(batchRetry.subjectKind, 'title');
  assert.equal(batchRetry.progressLabel, '2/5');
});

test('omits redundant Standby prefix on idle while preserving distinct phase prefixes for stopping and indexing', () => {
  const idle = parseSyncStatusHeader({
    currentPhase: 'Idle · Waiting for next scheduled run or manual trigger',
    activeRun: null,
    activeTransfer: makeTransfer(), // Idle phase takes priority over any stale transfer
    parallelTransferCount: 0,
  });
  assert.equal(idle.actionPrefix, null);
  assert.equal(idle.subject, 'Waiting for next scheduled run or manual trigger');
  assert.equal(idle.subjectKind, 'idle');

  const fallbackIdle = parseSyncStatusHeader({
    currentPhase: '',
    activeRun: null,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(fallbackIdle.actionPrefix, null);
  assert.equal(fallbackIdle.subject, 'Ready');

  const stopping = parseSyncStatusHeader({
    currentPhase: 'Stopping run #42...',
    activeRun: makeRun(),
    activeTransfer: makeTransfer(),
    parallelTransferCount: 1,
  });
  assert.equal(stopping.actionPrefix, 'Stopping');
  assert.equal(stopping.subject, 'Aborting run #42');

  const enumerating = parseSyncStatusHeader({
    currentPhase: 'Full Sync (1/3): snes-roms · WP page 2/8',
    activeRun: makeRun({ mode: 'full' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(enumerating.actionPrefix, 'Enumerating');
  assert.equal(enumerating.subjectKind, 'detail');

  const indexFirstConsole = parseSyncStatusHeader({
    currentPhase: 'Indexing nes-roms (1/4)',
    activeRun: makeRun({ mode: 'full' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(indexFirstConsole.actionPrefix, 'Enumerating');
  assert.equal(indexFirstConsole.systemName, 'nes-roms');
  assert.equal(indexFirstConsole.progressLabel, 'System 1/4');

  const indexFirstDeltaPage = parseSyncStatusHeader({
    currentPhase: 'Dry Run · Delta snes-roms · WP page 2/5',
    activeRun: makeRun({ mode: 'full', dryRun: true }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(indexFirstDeltaPage.actionPrefix, 'Checking');
  assert.equal(indexFirstDeltaPage.systemName, 'snes-roms');
  assert.equal(indexFirstDeltaPage.progressLabel, 'WP 2/5');
});

test('keeps steady highlighted title with no redundant prefix across Index-First Full Sync warm-up and active transfer', () => {
  const fullRun = makeRun({ mode: 'full' });

  // Both canonical and alternate Index-First warm-up formats must render highlighted title with no prefix flicker
  const canonicalWarmup = parseSyncStatusHeader({
    currentPhase: 'Full Sync · nes-roms (98/110): Parallel World',
    activeRun: fullRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(canonicalWarmup.actionPrefix, null);
  assert.equal(canonicalWarmup.subject, 'Parallel World');
  assert.equal(canonicalWarmup.subjectKind, 'title');
  assert.equal(canonicalWarmup.systemName, 'nes-roms');
  assert.equal(canonicalWarmup.progressLabel, '98/110');

  const altWarmup = parseSyncStatusHeader({
    currentPhase: 'Full Sync (98/110): nes-roms · Parallel World',
    activeRun: fullRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(altWarmup.actionPrefix, null);
  assert.equal(altWarmup.subject, 'Parallel World');
  assert.equal(altWarmup.subjectKind, 'title');
  assert.equal(altWarmup.systemName, 'nes-roms');
  assert.equal(altWarmup.progressLabel, '98/110');

  const downloading = parseSyncStatusHeader({
    currentPhase: 'Downloading nes-roms / Parallel World.zip',
    activeRun: fullRun,
    activeTransfer: makeTransfer({
      itemTitle: 'Parallel World',
      filename: 'Parallel World.zip',
      systemName: 'nes-roms',
    }),
    parallelTransferCount: 1,
  });
  assert.equal(downloading.actionPrefix, null);
  assert.equal(downloading.subject, 'Parallel World');
  assert.equal(downloading.subjectKind, 'title');
  assert.equal(downloading.systemName, 'nes-roms');
});

test('resolves active sync cover thumbnail cleanly across warm-up, download, handoff, Dry Run, and Standby', () => {
  const fullRun = makeRun({ mode: 'full' });
  const dryRun = makeRun({ mode: 'full', dryRun: true });
  const syncItem: ActiveSyncItemSummary = {
    itemId: 101,
    title: 'Parallel World',
    systemName: 'nes-roms',
    hasCover: true,
  };

  // 1. Standby / Idle -> never render cover thumbnail
  const idleHeader = parseSyncStatusHeader({
    currentPhase: 'Idle · Waiting for next scheduled run or manual trigger',
    activeRun: null,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(
    resolveActiveSyncTargetCover({
      parsedHeader: idleHeader,
      activeRun: null,
      activeTransfer: null,
      activeSyncItem: syncItem,
    }),
    null,
  );

  // 2. Non-game phases (Enumerating, Stopping, Authenticating) -> never render cover thumbnail
  const enumHeader = parseSyncStatusHeader({
    currentPhase: 'Indexing nes-roms (1/4)',
    activeRun: fullRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(
    resolveActiveSyncTargetCover({
      parsedHeader: enumHeader,
      activeRun: fullRun,
      activeTransfer: null,
      activeSyncItem: syncItem,
    }),
    null,
  );

  const stoppingHeader = parseSyncStatusHeader({
    currentPhase: 'Stopping run #42...',
    activeRun: fullRun,
    activeTransfer: makeTransfer({ itemId: 101, hasCover: true }),
    parallelTransferCount: 1,
  });
  assert.equal(
    resolveActiveSyncTargetCover({
      parsedHeader: stoppingHeader,
      activeRun: fullRun,
      activeTransfer: makeTransfer({ itemId: 101, hasCover: true }),
      activeSyncItem: syncItem,
    }),
    null,
  );

  // 3. Warm-up phase before binary transfer opens -> uses activeSyncItem
  const warmupHeader = parseSyncStatusHeader({
    currentPhase: 'Full Sync · nes-roms (98/110): Parallel World',
    activeRun: fullRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  const warmupTarget = resolveActiveSyncTargetCover({
    parsedHeader: warmupHeader,
    activeRun: fullRun,
    activeTransfer: null,
    activeSyncItem: syncItem,
  });
  assert.deepEqual(warmupTarget, {
    itemId: 101,
    title: 'Parallel World',
    systemName: 'nes-roms',
    hasCoverHint: true,
    coverUrl: '/api/items/101/asset?kind=cover&lazy=1&cv=1',
  });

  // 4. Active binary transfer -> prefers activeTransfer.itemId and hasCover
  const transfer = makeTransfer({
    itemId: 202,
    itemTitle: 'Chrono Trigger',
    systemName: 'snes-roms',
    hasCover: true,
  });
  const transferHeader = parseSyncStatusHeader({
    currentPhase: 'Downloading snes-roms / Chrono Trigger.zip',
    activeRun: fullRun,
    activeTransfer: transfer,
    parallelTransferCount: 1,
  });
  const transferTarget = resolveActiveSyncTargetCover({
    parsedHeader: transferHeader,
    activeRun: fullRun,
    activeTransfer: transfer,
    activeSyncItem: syncItem,
  });
  assert.deepEqual(transferTarget, {
    itemId: 202,
    title: 'Chrono Trigger',
    systemName: 'snes-roms',
    hasCoverHint: true,
    coverUrl: '/api/items/202/asset?kind=cover&lazy=1&cv=1',
  });

  // 5. Inter-file handoff (activeTransfer momentarily null) -> stays pinned via activeSyncItem
  const handoffHeader = parseSyncStatusHeader({
    currentPhase: 'Syncing · snes-roms: Chrono Trigger',
    activeRun: fullRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  const handoffTarget = resolveActiveSyncTargetCover({
    parsedHeader: handoffHeader,
    activeRun: fullRun,
    activeTransfer: null,
    activeSyncItem: { itemId: 202, title: 'Chrono Trigger', systemName: 'snes-roms', hasCover: false },
  });
  assert.deepEqual(handoffTarget, {
    itemId: 202,
    title: 'Chrono Trigger',
    systemName: 'snes-roms',
    hasCoverHint: false,
    coverUrl: '/api/items/202/asset?kind=cover&lazy=1',
  });

  // 6. Dry Run / newly discovered release without catalog itemId yet -> keeps CRT placeholder slot
  const dryHeader = parseSyncStatusHeader({
    currentPhase: 'Dry Run (Incremental) · nes-roms (1/5): Unindexed Homebrew',
    activeRun: dryRun,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  const dryPlaceholderTarget = resolveActiveSyncTargetCover({
    parsedHeader: dryHeader,
    activeRun: dryRun,
    activeTransfer: null,
    activeSyncItem: null,
  });
  assert.deepEqual(dryPlaceholderTarget, {
    itemId: null,
    title: 'Unindexed Homebrew',
    systemName: 'nes-roms',
    hasCoverHint: false,
    coverUrl: null,
  });
});

test('computes bounded adaptive Hero Showcase cover frame widths across portrait, square, landscape, compact, and fallback inputs', () => {
  // Missing or invalid natural dimensions fall back cleanly to steady 3:4 CRT placeholder width
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: null,
      naturalHeight: null,
      compact: false,
      isDesktop: true,
    }),
    72,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 0,
      naturalHeight: 400,
      compact: false,
      isDesktop: false,
    }),
    64,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: undefined,
      naturalHeight: undefined,
      compact: true,
      isDesktop: true,
    }),
    56,
  );

  // Desktop standard height (90px): portrait PS2/GBA (~0.71), square DS (1:1), landscape SNES (~1.42)
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 355,
      naturalHeight: 500,
      compact: false,
      isDesktop: true,
    }),
    64,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 500,
      naturalHeight: 500,
      compact: false,
      isDesktop: true,
    }),
    90,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 710,
      naturalHeight: 500,
      compact: false,
      isDesktop: true,
    }),
    128,
  );

  // Extreme ultra-wide and ultra-tall scans stay safely clamped within showcase bounds
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 2000,
      naturalHeight: 400,
      compact: false,
      isDesktop: true,
    }),
    144,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 2000,
      naturalHeight: 400,
      compact: false,
      isDesktop: false,
    }),
    124,
  );
  assert.equal(
    computeHeroCoverFrameWidthPx({
      naturalWidth: 100,
      naturalHeight: 1000,
      compact: true,
      isDesktop: true,
    }),
    50,
  );
});

test('maps Living UI Motion tiers to progressive Hero Showcase swap durations and derives stable release identity keys', () => {
  assert.equal(getHeroSwapDurationMs('off'), 0);
  assert.equal(getHeroSwapDurationMs('low'), 200);
  assert.equal(getHeroSwapDurationMs('medium'), 240);
  assert.equal(getHeroSwapDurationMs('high'), 260);
  assert.equal(getHeroSwapDurationMs('ultra'), 300);

  assert.equal(deriveSyncReleaseIdentityKey(null), null);
  assert.equal(
    deriveSyncReleaseIdentityKey({
      itemId: 404,
      title: 'Chrono Trigger',
      systemName: 'snes-roms',
      hasCoverHint: true,
      coverUrl: '/api/items/404/asset?kind=cover&lazy=1&cv=1',
    }),
    'item:404',
  );
  // Same itemId produces identical identity key even if display title formatting changes during handoff
  assert.equal(
    deriveSyncReleaseIdentityKey({
      itemId: 404,
      title: 'Chrono Trigger (USA)',
      systemName: 'snes-roms',
      hasCoverHint: true,
      coverUrl: '/api/items/404/asset?kind=cover&lazy=1&cv=1',
    }),
    'item:404',
  );
  // Unindexed Dry Run fallback normalizes system + title cleanly
  assert.equal(
    deriveSyncReleaseIdentityKey({
      itemId: null,
      title: '  Unindexed Homebrew  ',
      systemName: 'NES-ROMS',
      hasCoverHint: false,
      coverUrl: null,
    }),
    'title:nes-roms:unindexed homebrew',
  );
});


