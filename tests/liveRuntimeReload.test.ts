import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptiveRateLimiter } from '../src/server/rateLimiter.ts';
import { runWithConcurrency } from '../src/server/orchestrator.ts';
import {
  diffRuntimeSyncSettings,
  formatLiveReloadRunLabel,
} from '../src/shared/syncRuleMatcher.ts';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('AdaptiveRateLimiter.updateBounds immediately reflects slower and faster pacing when healthy', () => {
  const rl = new AdaptiveRateLimiter({
    baseDelayMs: 2500,
    minDelayMs: 1200,
    maxDelayMs: 90000,
    backoffMultiplier: 2.0,
  });
  assert.equal(rl.getTelemetry().currentDelayMs, 2500);

  // Speed up mid-run (Gentle -> Brisk) when healthy: immediately drops to new baseDelayMs
  rl.updateBounds({
    baseDelayMs: 1200,
    minDelayMs: 600,
    maxDelayMs: 45000,
    backoffMultiplier: 1.6,
  });
  assert.equal(rl.getTelemetry().currentDelayMs, 1200);

  // Slow down mid-run (Brisk -> Gentle): immediately raises to new baseDelayMs
  rl.updateBounds({
    baseDelayMs: 3000,
    minDelayMs: 1500,
    maxDelayMs: 120000,
    backoffMultiplier: 2.2,
  });
  assert.equal(rl.getTelemetry().currentDelayMs, 3000);
});

test('AdaptiveRateLimiter.updateBounds preserves active 429 throttle backoff while honoring reduced maxDelayMs cap', () => {
  const rl = new AdaptiveRateLimiter({
    baseDelayMs: 2500,
    minDelayMs: 1200,
    maxDelayMs: 90000,
    backoffMultiplier: 2.0,
  });

  rl.recordThrottle(20, 120);
  const afterThrottle = rl.getTelemetry();
  assert.ok(afterThrottle.currentDelayMs >= 20000);
  assert.ok(afterThrottle.cooldownUntilMs !== null);

  // User speeds up baseDelayMs during active cooldown: keep protective backoff, but cap at new maxDelayMs
  rl.updateBounds({
    baseDelayMs: 1000,
    minDelayMs: 500,
    maxDelayMs: 15000,
    backoffMultiplier: 1.6,
  });
  const afterCap = rl.getTelemetry();
  assert.equal(afterCap.currentDelayMs, 15000);
  assert.ok(rl.getCooldownRemainingMs() <= 15000);
});

test('runWithConcurrency scales UP dynamically mid-batch when maxConcurrency increases', async () => {
  const items = [0, 1, 2, 3, 4, 5];
  const gates = items.map(() => createDeferred<void>());
  let targetConcurrency = 1;
  const listeners: (() => void)[] = [];
  let unsubscribed = false;

  let inFlight = 0;
  let peakInFlight = 0;
  const started: number[] = [];
  const completed: number[] = [];

  const controller = new AbortController();
  const runPromise = runWithConcurrency(
    items,
    () => targetConcurrency,
    controller.signal,
    async (item) => {
      started.push(item);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await gates[item]!.promise;
      inFlight -= 1;
      completed.push(item);
    },
    (cb) => {
      listeners.push(cb);
      return () => {
        unsubscribed = true;
      };
    },
  );

  // Allow microtasks to launch worker 1
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(started, [0]);
  assert.equal(inFlight, 1);

  // Scale UP from 1 -> 3 while item 0 is still running!
  targetConcurrency = 3;
  for (const cb of listeners) cb();
  await new Promise((r) => setTimeout(r, 10));

  assert.deepEqual(started, [0, 1, 2]);
  assert.equal(inFlight, 3);
  assert.equal(peakInFlight, 3);

  // Release all gates
  for (const g of gates) g.resolve();
  await runPromise;

  assert.equal(unsubscribed, true);
  assert.deepEqual([...completed].sort((a, b) => a - b), items);
});

test('runWithConcurrency scales DOWN gracefully mid-batch when maxConcurrency decreases', async () => {
  const items = [0, 1, 2, 3, 4, 5];
  const gates = items.map(() => createDeferred<void>());
  let targetConcurrency = 3;
  let inFlight = 0;
  let postScaleDownMaxInFlight = 0;
  let scaledDown = false;
  const completed: number[] = [];

  const controller = new AbortController();
  const runPromise = runWithConcurrency(
    items,
    () => targetConcurrency,
    controller.signal,
    async (item) => {
      inFlight += 1;
      if (scaledDown) {
        postScaleDownMaxInFlight = Math.max(postScaleDownMaxInFlight, inFlight);
      }
      await gates[item]!.promise;
      inFlight -= 1;
      completed.push(item);
    },
  );

  // Wait for 3 parallel workers to start items 0, 1, 2
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(inFlight, 3);

  // Scale DOWN from 3 -> 1 mid-batch
  targetConcurrency = 1;
  scaledDown = true;

  // Finish items 0, 1, 2 — excess workers should exit cleanly so only 1 worker runs items 3, 4, 5
  gates[0]!.resolve();
  gates[1]!.resolve();
  gates[2]!.resolve();
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(inFlight, 1);
  assert.equal(postScaleDownMaxInFlight, 1);

  gates[3]!.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(inFlight, 1);
  gates[4]!.resolve();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(inFlight, 1);
  gates[5]!.resolve();

  await runPromise;
  assert.deepEqual([...completed].sort((a, b) => a - b), items);
  assert.equal(postScaleDownMaxInFlight, 1);
});

test('diffRuntimeSyncSettings detects pacing, worker, chunking, timeout, retry, UA, and auto-download changes', () => {
  const base = {
    baseDelayMs: 2500,
    minDelayMs: 1200,
    maxDelayMs: 90000,
    backoffMultiplier: 2.0,
    maxRetries: 5,
    maxConcurrency: 1,
    downloadChunkConcurrency: 1,
    downloadChunkMinSizeMb: 32,
    requestTimeoutMs: 30000,
    userAgent: 'Mozilla/5.0 (compatible; RetroGameTalkSync/1.0)',
    autoDownloadNewReleases: true,
  };

  assert.equal(diffRuntimeSyncSettings(base, { ...base }).changed, false);

  const diff = diffRuntimeSyncSettings(base, {
    ...base,
    baseDelayMs: 1200,
    maxConcurrency: 3,
    downloadChunkConcurrency: 2,
    downloadChunkMinSizeMb: 16,
    maxRetries: 3,
    requestTimeoutMs: 45000,
    userAgent: 'CustomAgent/2.0',
    autoDownloadNewReleases: false,
  });

  assert.equal(diff.changed, true);
  assert.equal(diff.pacingChanged, true);
  assert.equal(diff.concurrencyChanged, true);
  assert.equal(diff.chunkingChanged, true);
  assert.equal(diff.networkChanged, true);
  assert.equal(diff.autoDownloadChanged, true);
  assert.match(diff.changeSummary, /Delay 2500ms→1200ms/);
  assert.match(diff.changeSummary, /Workers 1→3/);
  assert.match(diff.changeSummary, /Chunks 1x→2x/);
  assert.match(diff.changeSummary, /Timeout 30s→45s/);
  assert.match(diff.changeSummary, /Retries 5→3/);
  assert.match(diff.changeSummary, /User-Agent updated/);
  assert.match(diff.changeSummary, /Scheduled auto-download paused/);
});

test('formatLiveReloadRunLabel formats all run types and dry-run modes cleanly', () => {
  assert.equal(formatLiveReloadRunLabel({ runMode: 'full', dryRun: false }), 'Full Sync');
  assert.equal(formatLiveReloadRunLabel({ runMode: 'incremental', dryRun: true }), 'Incremental Sync Dry Run');
  assert.equal(formatLiveReloadRunLabel({ runMode: 'download', dryRun: false }), 'Download Queue');
  assert.equal(formatLiveReloadRunLabel({ runMode: 'retry', dryRun: true }), 'Retry Failed Dry Run');
  assert.equal(formatLiveReloadRunLabel({ triggerType: 'download', mode: 'incremental' }), 'Download Queue');
});
