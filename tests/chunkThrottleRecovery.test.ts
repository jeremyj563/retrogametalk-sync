import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { AdaptiveRateLimiter } from '../src/server/rateLimiter.ts';
import { RetroGameTalkClient, type DiscoveredRelease } from '../src/server/rgtClient.ts';
import { createDefaultStorageFolderConfig } from '../src/shared/storageFolderMappings.ts';
import type { ScraperConfigInternal } from '../src/server/types.ts';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rgt-chunk-throttle-'));
const tempDataDir = path.join(tempRoot, 'data');
const tempDownloadDir = path.join(tempRoot, 'downloads');
fs.mkdirSync(tempDataDir, { recursive: true });
fs.mkdirSync(tempDownloadDir, { recursive: true });

process.env.DATA_DIR = tempDataDir;
process.env.DOWNLOAD_DIR = tempDownloadDir;

after(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<ScraperConfigInternal> = {}): ScraperConfigInternal {
  return {
    baseUrl: 'https://retrogametalk.com/repository/',
    loginUrl: 'https://retrogametalk.com/login/',
    dataDir: tempDataDir,
    downloadDir: tempDownloadDir,
    minFreeDiskGb: 2,
    username: 'tester',
    password: 'secret',
    hasPassword: true,
    cronSchedule: '0 */6 * * *',
    scheduleEnabled: false,
    userAgent: 'RetroGameTalk-Sync-Test/1.0',
    minDelayMs: 50,
    baseDelayMs: 100,
    maxDelayMs: 30_000,
    backoffMultiplier: 1.8,
    requestTimeoutMs: 15_000,
    maxRetries: 2,
    maxConcurrency: 1,
    downloadChunkConcurrency: 3,
    downloadChunkMinSizeMb: 4,
    systemFilter: '',
    allowedReleaseTypes: [],
    discoveredSystems: ['n64-roms'],
    lastWatermarkAt: null,
    romNamingTemplate: '{filename}',
    romSanitizeFat32: true,
    romMaxFilenameLen: 180,
    storageFolderConfig: createDefaultStorageFolderConfig(),
    autoDownloadNewReleases: true,
    updatedAt: new Date().toISOString(),
    envOverrides: [],
    ...overrides,
  };
}

function makePatternBuffer(sizeBytes: number): Buffer {
  const buf = Buffer.allocUnsafe(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 4) {
    buf.writeUInt32BE((i * 2654435761) >>> 0, i);
  }
  return buf;
}

function parseRangeHeader(header: string | null, totalBytes: number): [number, number] {
  if (!header) return [0, totalBytes - 1];
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  assert.ok(m, `unexpected Range header: ${header}`);
  const start = Number(m[1]);
  const end = m[2] ? Math.min(totalBytes - 1, Number(m[2])) : totalBytes - 1;
  return [start, end];
}

function makeChunkedStream(
  slice: Buffer,
  options: {
    chunkSize?: number;
    delayMs?: number;
    signal?: AbortSignal;
    onComplete?: () => void;
    onAbort?: () => void;
  } = {},
): ReadableStream<Uint8Array> {
  const chunkSize = options.chunkSize ?? 256 * 1024;
  const delayMs = options.delayMs ?? 0;
  let offset = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.signal?.aborted) {
        options.onAbort?.();
        controller.error(new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (offset >= slice.length) {
        options.onComplete?.();
        controller.close();
        return;
      }
      if (delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
      if (options.signal?.aborted) {
        options.onAbort?.();
        controller.error(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const end = Math.min(slice.length, offset + chunkSize);
      controller.enqueue(new Uint8Array(slice.subarray(offset, end)));
      offset = end;
    },
    cancel() {
      if (offset < slice.length) {
        options.onAbort?.();
      }
    },
  });
}

function makeMockResponse(
  status: number,
  headersInit: Record<string, string>,
  body: ReadableStream<Uint8Array> | null,
) {
  const headers = new Headers(headersInit);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body,
    text: async () => '',
  };
}

test('AdaptiveRateLimiter.recordThrottle keeps global AIMD untouched for local mirror settles up to 20s', () => {
  const limiter = new AdaptiveRateLimiter({
    baseDelayMs: 250,
    minDelayMs: 100,
    maxDelayMs: 30_000,
    backoffMultiplier: 1.8,
  });

  limiter.recordSuccess(40);
  limiter.recordSuccess(45);
  const before = limiter.getTelemetry();
  assert.equal(before.currentDelayMs, 250);
  assert.equal(before.consecutiveSuccesses, 2);
  assert.equal(before.rateLimitHits, 0);

  const settle1 = limiter.recordThrottle(undefined, 120, { escalateGlobalDelay: false, localSettleMs: 3500 });
  const settle2 = limiter.recordThrottle(undefined, 120, { escalateGlobalDelay: false, localSettleMs: 7000 });
  const settle3 = limiter.recordThrottle(undefined, 120, { escalateGlobalDelay: false, localSettleMs: 14_000 });
  const settle4 = limiter.recordThrottle(undefined, 120, { escalateGlobalDelay: false, localSettleMs: 25_000 });

  assert.equal(settle1, 3500);
  assert.equal(settle2, 7000);
  assert.equal(settle3, 14_000);
  assert.equal(settle4, 20_000, 'local mirror settle should clamp at 20s');

  const after = limiter.getTelemetry();
  assert.equal(after.currentDelayMs, 250, 'global AIMD delay must remain unchanged');
  assert.equal(after.cooldownUntilMs, null, 'global cooldown must remain unset');
  assert.equal(after.rateLimitHits, 0, 'global rateLimitHits must remain unchanged');
  assert.equal(after.consecutiveSuccesses, 2, 'global consecutiveSuccesses must remain unchanged');
});

test('downloadFileAtomic preserves Worker 0 primary stream on sibling 503 and isolates post-burst 503 from global AIMD', async () => {
  const totalBytes = 8 * 1024 * 1024; // 8 MiB with 4 MiB threshold -> 3 workers (1 primary + 2 siblings)
  const sourcePayload = makePatternBuffer(totalBytes);
  const limiter = new AdaptiveRateLimiter({
    baseDelayMs: 100,
    minDelayMs: 50,
    maxDelayMs: 30_000,
    backoffMultiplier: 1.8,
  });
  const client = new RetroGameTalkClient(limiter);
  const config = makeConfig({
    downloadChunkConcurrency: 3,
    downloadChunkMinSizeMb: 4,
    maxRetries: 2,
  });

  const logs: Array<{ level: string; message: string; details?: string | null }> = [];
  let primaryCompleted = false;
  let primaryAborted = false;
  let requestCounter = 0;
  let sibling503Count = 0;
  let postBurst1x503Injected = false;

  (client as unknown as { httpClient: { fetch: (...args: unknown[]) => Promise<unknown> } }).httpClient = {
    fetch: async (_url: unknown, init: unknown) => {
      requestCounter += 1;
      const opts = (init ?? {}) as { headers?: Headers; signal?: AbortSignal };
      const rangeHeader = opts.headers instanceof Headers ? opts.headers.get('Range') : null;
      const [start, end] = parseRangeHeader(rangeHeader, totalBytes);

      // Request 1: initial 206 probe for Worker 0 (drip chunks so siblings fire while Worker 0 is mid-stream)
      if (requestCounter === 1) {
        const sliceBuf = sourcePayload.subarray(start, end + 1);
        const body = makeChunkedStream(sliceBuf, {
          chunkSize: 512 * 1024, // 8 chunks * 25ms ~= 200ms active stream
          delayMs: 25,
          signal: opts.signal,
          onComplete: () => {
            primaryCompleted = true;
          },
          onAbort: () => {
            primaryAborted = true;
          },
        });
        return makeMockResponse(
          206,
          {
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${totalBytes}`,
            'content-length': String(sliceBuf.length),
            etag: '"test-etag-1"',
          },
          body,
        );
      }

      // While Worker 0 is still streaming its initial 206 slice, sibling workers get mirror 503
      if (!primaryCompleted) {
        sibling503Count += 1;
        return makeMockResponse(503, { 'content-type': 'text/plain' }, null);
      }

      // After Worker 0 finished and stepped down to 1x, inject one lingering mirror cooldown 503
      if (!postBurst1x503Injected) {
        postBurst1x503Injected = true;
        return makeMockResponse(503, { 'content-type': 'text/plain' }, null);
      }

      // Mirror recovered: serve remaining 1x byte ranges cleanly
      const sliceBuf = sourcePayload.subarray(start, end + 1);
      return makeMockResponse(
        206,
        {
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${totalBytes}`,
          'content-length': String(sliceBuf.length),
          etag: '"test-etag-1"',
        },
        makeChunkedStream(sliceBuf, { chunkSize: 1024 * 1024, delayMs: 0, signal: opts.signal }),
      );
    },
  };

  const release: DiscoveredRelease = {
    remoteUrl: 'https://retrogametalk.com/repository/n64-roms/perfect-dark-test/',
    systemName: 'n64-roms',
    releaseType: 'Hack',
    title: 'Perfect Dark Test',
    publishedAt: null,
    filename: 'Perfect Dark Test.7z',
    remotePath: 'n64-roms/perfect-dark-test/Perfect Dark Test.7z',
    downloadUrl: 'https://alucard.retrogametalk.com/download.php?file=Perfect%20Dark%20Test.7z&id=1&platform=n64-roms&key=abc',
    pageUrl: 'https://retrogametalk.com/repository/n64-roms/perfect-dark-test/',
  };

  const controller = new AbortController();
  const result = await client.downloadFileAtomic(
    release,
    config,
    controller.signal,
    () => undefined,
    (level, message, details) => {
      logs.push({ level, message, details });
    },
  );

  assert.equal(result.outcome, 'downloaded');
  assert.equal(result.bytes, totalBytes);
  assert.ok(sibling503Count >= 1, 'expected at least one sibling 503 during multi-chunk wave');
  assert.equal(primaryCompleted, true, 'Worker 0 primary stream must complete cleanly despite sibling 503');
  assert.equal(primaryAborted, false, 'Worker 0 primary stream must never be aborted by sibling 503');
  assert.equal(postBurst1x503Injected, true, 'expected post-burst 1x 503 recovery path to execute');

  const written = fs.readFileSync(result.localPath);
  assert.equal(Buffer.compare(written, sourcePayload), 0, 'downloaded file bytes must match source payload');

  // Global AIMD rate limiter must remain completely unpoisoned
  const telemetry = limiter.getTelemetry();
  assert.equal(telemetry.currentDelayMs, 100, 'global AIMD currentDelayMs must not escalate from mirror 503 burst');
  assert.equal(telemetry.rateLimitHits, 0, 'global rateLimitHits must stay 0 for local mirror 503s');

  // Verify host cap was persisted to 1x
  const capped = (client as unknown as {
    getEffectiveHostChunkConcurrency: (u: string, c: number) => number;
  }).getEffectiveHostChunkConcurrency(release.downloadUrl, 3);
  assert.equal(capped, 1, 'host chunk concurrency must be capped to 1x after sibling 503');

  // Verify accurate log copy (primary preservation + 1x retry wording, never misleading step-down)
  const throttleLogs = logs.filter((l) => l.level === 'throttle');
  assert.equal(throttleLogs.length, 2, `expected 2 throttle logs, got ${JSON.stringify(throttleLogs)}`);
  assert.match(throttleLogs[0]!.message, /preserved primary slice \(4\.0 MB\), stepping down to 1x stream/);
  assert.match(throttleLogs[1]!.message, /HTTP 503 limit on 1x transfer.*before 1x retry/);
  assert.doesNotMatch(throttleLogs[1]!.message, /stepping directly down to 1x stream/);
  assert.match(throttleLogs[1]!.details ?? '', /Wave throttle 1\/3 · local mirror limit/);
});

test('downloadFileAtomic wave throttle exhaustion caps at N/N without off-by-one 6/5 logs and resumes cleanly on next attempt', async () => {
  const totalBytes = 6 * 1024 * 1024; // 6 MiB
  const sourcePayload = makePatternBuffer(totalBytes);
  const limiter = new AdaptiveRateLimiter({
    baseDelayMs: 40,
    minDelayMs: 20,
    maxDelayMs: 80,
    backoffMultiplier: 1.5,
  });
  const client = new RetroGameTalkClient(limiter);
  const config = makeConfig({
    minDelayMs: 20,
    baseDelayMs: 40,
    maxDelayMs: 80,
    backoffMultiplier: 1.5,
    maxRetries: 1, // maxWaveThrottleRetries = Math.max(2, 1 + 1) = 2, maxStreamAttempts = 2
    downloadChunkConcurrency: 2,
    downloadChunkMinSizeMb: 4,
  });

  const logs: Array<{ level: string; message: string; details?: string | null }> = [];
  let attempt1Slice429Count = 0;
  let initialProbes = 0;

  (client as unknown as { httpClient: { fetch: (...args: unknown[]) => Promise<unknown> } }).httpClient = {
    fetch: async (_url: unknown, init: unknown) => {
      const opts = (init ?? {}) as { headers?: Headers; signal?: AbortSignal };
      const rangeHeader = opts.headers instanceof Headers ? opts.headers.get('Range') : null;
      const [start, end] = parseRangeHeader(rangeHeader, totalBytes);

      // Initial probe for Attempt 1 (bytes=0-4194303) succeeds immediately
      if (start === 0 && initialProbes === 0) {
        initialProbes += 1;
        const sliceBuf = sourcePayload.subarray(start, end + 1);
        return makeMockResponse(
          206,
          {
            'content-type': 'application/octet-stream',
            'accept-ranges': 'bytes',
            'content-range': `bytes ${start}-${end}/${totalBytes}`,
            'content-length': String(sliceBuf.length),
            etag: '"test-etag-2"',
          },
          makeChunkedStream(sliceBuf, { chunkSize: 1024 * 1024, delayMs: 0, signal: opts.signal }),
        );
      }

      // First 3 requests for the tail slice return HTTP 429 (2 wave retries + 1 exhaustion throw)
      if (attempt1Slice429Count < 3) {
        attempt1Slice429Count += 1;
        return makeMockResponse(429, { 'content-type': 'text/plain' }, null);
      }

      // Attempt 2 resumes from byte 4194304 and completes cleanly
      const sliceBuf = sourcePayload.subarray(start, end + 1);
      return makeMockResponse(
        206,
        {
          'content-type': 'application/octet-stream',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${start}-${end}/${totalBytes}`,
          'content-length': String(sliceBuf.length),
          etag: '"test-etag-2"',
        },
        makeChunkedStream(sliceBuf, { chunkSize: 1024 * 1024, delayMs: 0, signal: opts.signal }),
      );
    },
  };

  const release: DiscoveredRelease = {
    remoteUrl: 'https://retrogametalk.com/repository/n64-roms/exhaustion-test/',
    systemName: 'n64-roms',
    releaseType: 'Hack',
    title: 'Exhaustion Test',
    publishedAt: null,
    filename: 'Exhaustion Test.7z',
    remotePath: 'n64-roms/exhaustion-test/Exhaustion Test.7z',
    downloadUrl: 'https://squall.retrogametalk.com/download.php?file=Exhaustion%20Test.7z&id=2&platform=n64-roms&key=def',
    pageUrl: 'https://retrogametalk.com/repository/n64-roms/exhaustion-test/',
  };

  const result = await client.downloadFileAtomic(
    release,
    config,
    new AbortController().signal,
    () => undefined,
    (level, message, details) => {
      logs.push({ level, message, details });
    },
  );

  assert.equal(result.outcome, 'downloaded');
  assert.equal(result.bytes, totalBytes);
  assert.equal(Buffer.compare(fs.readFileSync(result.localPath), sourcePayload), 0);

  const throttleLogs = logs.filter((l) => l.level === 'throttle');
  assert.equal(throttleLogs.length, 3, `expected 3 throttle logs (1/2, 2/2, exhausted), got ${JSON.stringify(throttleLogs)}`);
  assert.match(throttleLogs[0]!.details ?? '', /Wave throttle 1\/2/);
  assert.match(throttleLogs[1]!.details ?? '', /Wave throttle 2\/2/);
  assert.match(throttleLogs[1]!.message, /HTTP 429 limit on 1x transfer.*before 1x retry/);
  assert.match(throttleLogs[2]!.message, /exhausted wave retries \(2\/2\), handing off to stream resume/);
  assert.ok(
    throttleLogs.every((l) => !(l.details ?? '').includes('3/2')),
    'must never emit off-by-one Wave throttle 3/2 log',
  );
});
