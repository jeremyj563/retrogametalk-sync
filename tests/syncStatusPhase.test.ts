import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActiveTransferState, SyncRunRecord } from '../src/types.ts';
import { parseSyncStatusHeader } from '../src/utils/syncStatusPhase.ts';

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

test('keeps steady "Syncing" label and title highlight across warm-up, active download, and handoff', () => {
  const run = makeRun({ triggerType: 'download' });

  // Phase 1: Queue warm-up before binary stream opens
  const warmUp = parseSyncStatusHeader({
    currentPhase: 'Queue (1/3): nes-roms / Just Breed',
    activeRun: run,
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(warmUp.actionPrefix, 'Syncing');
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
  assert.equal(active.actionPrefix, 'Syncing');
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
  assert.equal(handoff.actionPrefix, 'Syncing');
  assert.equal(handoff.subject, 'Just Breed');
  assert.equal(handoff.subjectKind, 'title');
  assert.equal(handoff.systemName, 'nes-roms');
});

test('uses steady "Syncing" + highlighted title across incremental, full sync, and retry phases', () => {
  const fullWarmup = parseSyncStatusHeader({
    currentPhase: 'Full Sync · n64-roms (9/424): The Legend of Zelda: Ocarina of Time',
    activeRun: makeRun({ mode: 'full' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(fullWarmup.actionPrefix, 'Syncing');
  assert.equal(fullWarmup.subject, 'The Legend of Zelda: Ocarina of Time');
  assert.equal(fullWarmup.subjectKind, 'title');
  assert.equal(fullWarmup.progressLabel, '9/424');

  const singleRetry = parseSyncStatusHeader({
    currentPhase: 'Retrying: Chrono Trigger',
    activeRun: makeRun({ triggerType: 'retry' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(singleRetry.actionPrefix, 'Syncing');
  assert.equal(singleRetry.subject, 'Chrono Trigger');
  assert.equal(singleRetry.subjectKind, 'title');

  const batchRetry = parseSyncStatusHeader({
    currentPhase: 'Retry Failed (2/5): snes-roms / EarthBound',
    activeRun: makeRun({ triggerType: 'retry' }),
    activeTransfer: null,
    parallelTransferCount: 0,
  });
  assert.equal(batchRetry.actionPrefix, 'Syncing');
  assert.equal(batchRetry.subject, 'EarthBound');
  assert.equal(batchRetry.subjectKind, 'title');
  assert.equal(batchRetry.progressLabel, '2/5');
});

test('preserves clear global non-game phase prefixes for standby, auth, enumeration, and stopping', () => {
  const idle = parseSyncStatusHeader({
    currentPhase: 'Idle · Waiting for next scheduled run or manual trigger',
    activeRun: null,
    activeTransfer: makeTransfer(), // Idle phase takes priority over any stale transfer
    parallelTransferCount: 0,
  });
  assert.equal(idle.actionPrefix, 'Standby');
  assert.equal(idle.subjectKind, 'idle');

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
});
