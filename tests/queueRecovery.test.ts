import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  isCatalogStatusAlreadyQueued,
  isCatalogStatusQueueable,
  summarizeCatalogSelection,
} from '../src/shared/catalogSelection.ts';
import {
  AUTO_RESUME_BACKOFF_SCHEDULE_MS,
  AUTO_RESUME_MAX_ATTEMPTS,
  AUTO_RESUME_STABILITY_WINDOW_MS,
  DEFAULT_QUEUE_RECOVERY_STATE,
  computeAutoResumeBackoffDelayMs,
  formatAutoResumeDuration,
  planStartupQueueAutoResume,
  type PersistedQueueRecoveryState,
} from '../src/shared/queueAutoResume.ts';
import type { ItemStatus } from '../src/types.ts';

test('includePausedQueued treats paused queued items as queueable while keeping downloading active', () => {
  assert.equal(isCatalogStatusQueueable('queued'), false);
  assert.equal(isCatalogStatusQueueable('queued', { includePausedQueued: true }), true);
  assert.equal(isCatalogStatusQueueable('downloading', { includePausedQueued: true }), false);

  assert.equal(isCatalogStatusAlreadyQueued('queued'), true);
  assert.equal(isCatalogStatusAlreadyQueued('queued', { includePausedQueued: true }), false);
  assert.equal(isCatalogStatusAlreadyQueued('downloading', { includePausedQueued: true }), true);

  const statusMap = new Map<number, ItemStatus>([
    [1, 'available'],
    [2, 'queued'],
    [3, 'downloading'],
    [4, 'downloaded'],
  ]);

  const activeSummary = summarizeCatalogSelection([1, 2, 3, 4], statusMap, {
    includePausedQueued: false,
  });
  assert.deepEqual(activeSummary.queueableIds, [1]);
  assert.equal(activeSummary.alreadyQueuedCount, 2);
  assert.equal(activeSummary.notYetDownloadedCount, 3);

  const idleSummary = summarizeCatalogSelection([1, 2, 3, 4], statusMap, {
    includePausedQueued: true,
  });
  assert.deepEqual(idleSummary.queueableIds, [1, 2]);
  assert.equal(idleSummary.alreadyQueuedCount, 1);
  assert.equal(idleSummary.notYetDownloadedCount, 3);
  assert.equal(idleSummary.alreadyDownloadedCount, 1);
});

test('paused queued releases remain queryable, resumable, clearable, and recovered cleanly across restart', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-queue-recovery-test-'));
  const prevDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tmpDir;
  try {
    const db = await import('../src/server/db.ts');
    const sqlite = db.initDb();
    const now = '2026-11-24T21:00:00Z';

    const insertRelease = sqlite.prepare(`
      INSERT INTO catalog_releases (
        remote_url, remote_path, local_path, system_name, title, status, file_size_bytes, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-1',
        'snes-rom/game-1',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-1.zip'),
        'snes-rom',
        'Queued Game 1',
        'queued',
        4096,
        now,
      ).lastInsertRowid,
    );
    const r2 = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-2',
        'snes-rom/game-2',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-2.zip'),
        'snes-rom',
        'Queued Game 2',
        'queued',
        8192,
        now,
      ).lastInsertRowid,
    );
    const rPartial = Number(
      insertRelease.run(
        'https://example.invalid/snes-rom/game-3',
        'snes-rom/game-3',
        path.join(tmpDir, 'repository', 'snes-rom', 'game-3'),
        'snes-rom',
        'Partial Multi-File Game',
        'partial',
        12288,
        now,
      ).lastInsertRowid,
    );

    const insertFile = sqlite.prepare(`
      INSERT INTO catalog_release_files (
        release_id, remote_url, download_url, remote_path, local_path, filename, display_label, status, file_size_bytes, discovered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertFile.run(
      rPartial,
      'https://example.invalid/snes-rom/game-3#f1',
      'https://example.invalid/dl/f1.zip',
      'snes-rom/game-3/disc1.zip',
      path.join(tmpDir, 'repository', 'snes-rom', 'game-3', 'disc1.zip'),
      'disc1.zip',
      'Disc 1',
      'downloaded',
      6144,
      now,
    );
    insertFile.run(
      rPartial,
      'https://example.invalid/snes-rom/game-3#f2',
      'https://example.invalid/dl/f2.zip',
      'snes-rom/game-3/disc2.zip',
      path.join(tmpDir, 'repository', 'snes-rom', 'game-3', 'disc2.zip'),
      'disc2.zip',
      'Disc 2',
      'queued',
      6144,
      now,
    );

    // Without includePausedQueued (active download worker): queued rows are excluded from queueableFiltered
    const activeItemsRes = db.queryRepositoryItems({ system: 'snes-rom' });
    assert.equal(activeItemsRes.total, 3);
    assert.equal(activeItemsRes.facets.counts?.queueableFiltered, 1); // only partial

    // With includePausedQueued (no active download worker): Download Filtered sees all 3 releases!
    const idleItemsRes = db.queryRepositoryItems({
      system: 'snes-rom',
      includePausedQueued: true,
    });
    assert.equal(idleItemsRes.total, 3);
    assert.equal(idleItemsRes.facets.counts?.queueableFiltered, 3);

    const idleIdsRes = db.queryRepositoryItemIds({
      system: 'snes-rom',
      includePausedQueued: true,
    });
    assert.deepEqual(
      [...idleIdsRes.queueableIds].sort((a, b) => a - b),
      [r1, r2, rPartial],
    );
    assert.equal(idleIdsRes.alreadyQueuedCount, 0);

    // listPausedQueuedReleaseIds returns queued releases AND partial releases with queued child files
    assert.deepEqual(db.listPausedQueuedReleaseIds(), [r1, r2, rPartial]);

    // Clearing the paused queue resets queued releases to available and preserves partial rollup
    const cleared = db.clearPausedQueuedReleases();
    assert.equal(cleared.clearedCount, 3);
    assert.deepEqual(db.listPausedQueuedReleaseIds(), []);
    assert.equal(db.getRepositoryItemById(r1)?.status, 'available');
    assert.equal(db.getRepositoryItemById(r2)?.status, 'available');
    assert.equal(db.getRepositoryItemById(rPartial)?.status, 'partial');
    assert.equal(
      db.getRepositoryItemById(rPartial)?.files.find((f) => f.filename === 'disc2.zip')?.status,
      'available',
    );

    // Simulate abrupt SIGKILL during an active download queue run
    const interruptedRun = db.createSyncRun('download', 'incremental', false);
    assert.equal(interruptedRun.status, 'running');
    sqlite.prepare(`UPDATE catalog_releases SET status = 'downloading' WHERE id = ?`).run(r1);
    sqlite.prepare(`UPDATE catalog_releases SET status = 'queued' WHERE id = ?`).run(r2);

    // Simulate container restart startup recovery
    const summary = db.recoverInterruptedRunsOnStartup(sqlite);
    assert.equal(summary.recoveredRunCount, 1);
    assert.equal(summary.recoveredDownloadRunCount, 1);
    assert.equal(summary.recoveredQueuedReleases, 2);

    const persistedAfterCrash = db.getQueueRecoveryState(sqlite);
    assert.equal(persistedAfterCrash.userPaused, false);
    assert.equal(persistedAfterCrash.lastInterruptionCause, 'crash_or_kill');

    const recoveredR1 = db.getRepositoryItemById(r1);
    const recoveredR2 = db.getRepositoryItemById(r2);
    assert.equal(recoveredR1?.status, 'queued');
    assert.equal(recoveredR1?.errorMessage, null);
    assert.equal(recoveredR2?.status, 'queued');
    assert.deepEqual(db.listPausedQueuedReleaseIds(), [r1, r2]);
  } finally {
    if (prevDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = prevDataDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('planStartupQueueAutoResume schedules automatic resume with exponential backoff and trips circuit breaker on crash loops', () => {
  const baseMs = Date.parse('2026-11-26T00:00:00.000Z');

  // 1. Fresh SIGTERM interruption -> schedules attempt 1 with 5s delay
  let state: PersistedQueueRecoveryState = {
    ...DEFAULT_QUEUE_RECOVERY_STATE,
    lastInterruptionCause: 'sigterm',
    lastInterruptedAt: new Date(baseMs - 2_000).toISOString(),
  };

  for (let attempt = 1; attempt <= AUTO_RESUME_MAX_ATTEMPTS; attempt++) {
    const decision = planStartupQueueAutoResume({
      state,
      queuedCount: 12,
      canAuthenticate: true,
      recoveredCrashOnStartup: attempt > 1,
      nowMs: baseMs + attempt * 20_000,
    });
    assert.equal(decision.action, 'schedule');
    assert.equal(decision.attempt, attempt);
    assert.equal(decision.delayMs, AUTO_RESUME_BACKOFF_SCHEDULE_MS[attempt - 1]);
    assert.equal(decision.status.phase, 'scheduled');
    assert.equal(decision.status.attempt, attempt);
    assert.equal(decision.status.maxAttempts, AUTO_RESUME_MAX_ATTEMPTS);

    // Simulate process starting the download queue and crashing 10s later (inside stability window)
    state = {
      ...decision.nextState,
      consecutiveAutoResumes: attempt,
      lastAutoResumeStartedAt: new Date(baseMs + attempt * 20_000 + decision.delayMs).toISOString(),
      lastInterruptedAt: new Date(baseMs + attempt * 20_000 + decision.delayMs + 10_000).toISOString(),
      lastInterruptionCause: 'crash_or_kill',
    };
  }

  // 2. Next rapid restart after exhausting max attempts trips the circuit breaker
  const tripped = planStartupQueueAutoResume({
    state,
    queuedCount: 12,
    canAuthenticate: true,
    recoveredCrashOnStartup: true,
    nowMs: baseMs + 600_000,
  });
  assert.equal(tripped.action, 'circuit_open');
  assert.equal(tripped.status.phase, 'circuit_open');
  assert.equal(tripped.nextState.circuitBreakerTripped, true);
  assert.ok(tripped.status.reason?.includes('restart loop'));
});

test('planStartupQueueAutoResume resets backoff after stability window, respects explicit user Stop, and waits for auth', () => {
  const startMs = Date.parse('2026-11-26T00:00:00.000Z');

  // 1. After surviving >= stability window (e.g. two separate container upgrades 10 minutes apart),
  // backoff resets back to attempt 1 (5s) instead of escalating.
  const stabilized = planStartupQueueAutoResume({
    state: {
      ...DEFAULT_QUEUE_RECOVERY_STATE,
      consecutiveAutoResumes: 3,
      lastAutoResumeStartedAt: new Date(startMs).toISOString(),
      lastInterruptedAt: new Date(startMs + AUTO_RESUME_STABILITY_WINDOW_MS + 60_000).toISOString(),
      lastInterruptionCause: 'sigterm',
    },
    queuedCount: 5,
    canAuthenticate: true,
    recoveredCrashOnStartup: false,
    nowMs: startMs + AUTO_RESUME_STABILITY_WINDOW_MS + 65_000,
  });
  assert.equal(stabilized.action, 'schedule');
  assert.equal(stabilized.attempt, 1);
  assert.equal(stabilized.delayMs, computeAutoResumeBackoffDelayMs(1));

  // 2. Explicit user Stop/Pause stays paused across restarts (does NOT auto-resume)
  const userPaused = planStartupQueueAutoResume({
    state: {
      ...DEFAULT_QUEUE_RECOVERY_STATE,
      userPaused: true,
      lastInterruptionCause: 'user_stopped',
    },
    queuedCount: 8,
    canAuthenticate: true,
    recoveredCrashOnStartup: false,
    nowMs: startMs,
  });
  assert.equal(userPaused.action, 'skip_user_paused');
  assert.equal(userPaused.status.phase, 'user_paused');

  // 3. Missing login blocks auto-resume cleanly without incrementing backoff
  const blockedAuth = planStartupQueueAutoResume({
    state: {
      ...DEFAULT_QUEUE_RECOVERY_STATE,
      lastInterruptionCause: 'sigterm',
    },
    queuedCount: 4,
    canAuthenticate: false,
    recoveredCrashOnStartup: false,
    nowMs: startMs,
  });
  assert.equal(blockedAuth.action, 'blocked_auth');
  assert.equal(blockedAuth.status.phase, 'blocked_auth');
  assert.equal(blockedAuth.nextState.consecutiveAutoResumes, 0);

  // 4. Duration formatting sanity checks
  assert.equal(formatAutoResumeDuration(5_000), '5s');
  assert.equal(formatAutoResumeDuration(120_000), '2m');
  assert.equal(formatAutoResumeDuration(135_000), '2m 15s');
});

