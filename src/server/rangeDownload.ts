import fs from 'node:fs';
import { Readable } from 'node:stream';

export type ByteRange = [number, number]; // inclusive [start, end]

export interface PartialTransferMeta {
  version: 1;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  totalBytes: number | null;
  completedRanges: ByteRange[];
  updatedAt: string;
}

export interface ParsedContentRange {
  start: number;
  end: number;
  total: number | null;
}

export function getPartialMetaPath(partPath: string): string {
  return `${partPath}.meta.json`;
}

/**
 * Parses an HTTP Content-Range header (e.g. "bytes 0-8388607/104857600" or "bytes 0-99/*").
 */
export function parseContentRange(headerValue: string | null | undefined): ParsedContentRange | null {
  if (!headerValue) return null;
  const match = headerValue.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = match[3] === '*' ? null : Number(match[3]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    return null;
  }
  if (total !== null && (!Number.isFinite(total) || total <= end)) {
    return null;
  }
  return { start, end, total };
}

/**
 * Sorts and merges overlapping or adjacent inclusive byte ranges.
 */
export function mergeByteRanges(ranges: readonly ByteRange[]): ByteRange[] {
  const valid: ByteRange[] = [];
  for (const [rawStart, rawEnd] of ranges) {
    if (
      Number.isFinite(rawStart) &&
      Number.isFinite(rawEnd) &&
      rawStart >= 0 &&
      rawEnd >= rawStart
    ) {
      valid.push([Math.floor(rawStart), Math.floor(rawEnd)]);
    }
  }
  if (valid.length === 0) return [];
  valid.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const merged: ByteRange[] = [[valid[0]![0], valid[0]![1]]];
  for (let i = 1; i < valid.length; i += 1) {
    const [start, end] = valid[i]!;
    const last = merged[merged.length - 1]!;
    if (start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

export function sumByteRanges(ranges: readonly ByteRange[]): number {
  let total = 0;
  for (const [start, end] of mergeByteRanges(ranges)) {
    total += end - start + 1;
  }
  return total;
}

/**
 * Returns uncovered byte intervals within [0, totalBytes - 1].
 */
export function findMissingByteRanges(
  totalBytes: number,
  completedRanges: readonly ByteRange[],
): ByteRange[] {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return [];
  const merged = mergeByteRanges(completedRanges);
  const missing: ByteRange[] = [];
  let cursor = 0;

  for (const [rawStart, rawEnd] of merged) {
    const start = Math.max(0, rawStart);
    const end = Math.min(totalBytes - 1, rawEnd);
    if (end < cursor) continue;
    if (start > cursor) {
      missing.push([cursor, Math.min(totalBytes - 1, start - 1)]);
    }
    cursor = Math.max(cursor, end + 1);
    if (cursor >= totalBytes) break;
  }

  if (cursor < totalBytes) {
    missing.push([cursor, totalBytes - 1]);
  }
  return missing;
}

/**
 * Splits a list of missing byte intervals into bounded work-stealing slices
 * so all range workers finish smoothly without excessive small HTTP requests.
 */
export function splitMissingRangesIntoSlices(
  missingRanges: readonly ByteRange[],
  minSliceBytes: number,
  workerCount: number,
): ByteRange[] {
  const totalMissing = missingRanges.reduce((acc, [s, e]) => acc + (e - s + 1), 0);
  if (totalMissing <= 0) return [];
  if (workerCount <= 1) {
    return missingRanges.map(([s, e]) => [s, e] as ByteRange);
  }

  const targetSliceCount = Math.min(16, Math.max(workerCount * 2, workerCount));
  const idealSliceSize = Math.ceil(totalMissing / targetSliceCount);
  const effectiveSliceSize = Math.max(minSliceBytes, Math.min(32 * 1024 * 1024, idealSliceSize));

  const slices: ByteRange[] = [];
  for (const [rangeStart, rangeEnd] of missingRanges) {
    let cursor = rangeStart;
    while (cursor <= rangeEnd) {
      const remainingInRange = rangeEnd - cursor + 1;
      // Avoid tiny trailing sliver when remainder fits nicely into current slice
      const nextEnd =
        remainingInRange <= Math.round(effectiveSliceSize * 1.35)
          ? rangeEnd
          : Math.min(rangeEnd, cursor + effectiveSliceSize - 1);
      slices.push([cursor, nextEnd]);
      cursor = nextEnd + 1;
    }
  }
  return slices;
}

/**
 * Validates HTTP ETag / Last-Modified validators for safe HTTP Range resume.
 */
export function isValidatorCompatibleForResume(
  saved: Pick<PartialTransferMeta, 'etag' | 'lastModified' | 'totalBytes'>,
  incoming: { etag: string | null; lastModified: string | null; totalBytes: number | null },
): boolean {
  if (
    saved.totalBytes !== null &&
    incoming.totalBytes !== null &&
    saved.totalBytes !== incoming.totalBytes
  ) {
    return false;
  }

  const savedEtag = normalizeEtag(saved.etag);
  const incomingEtag = normalizeEtag(incoming.etag);
  if (savedEtag && incomingEtag) {
    // Reject weak ETags when strict byte-level resume is needed unless identical
    if (savedEtag.startsWith('W/') || incomingEtag.startsWith('W/')) {
      return savedEtag === incomingEtag;
    }
    return savedEtag === incomingEtag;
  }

  if (saved.lastModified && incoming.lastModified) {
    return saved.lastModified.trim() === incoming.lastModified.trim();
  }

  // If neither side provided validators, allow resume only if totalBytes matched explicitly
  return Boolean(
    saved.totalBytes !== null &&
      incoming.totalBytes !== null &&
      saved.totalBytes === incoming.totalBytes,
  );
}

function normalizeEtag(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function pickIfRangeValidator(meta: Pick<PartialTransferMeta, 'etag' | 'lastModified'>): string | null {
  const etag = normalizeEtag(meta.etag);
  if (etag && !etag.startsWith('W/')) return etag;
  if (meta.lastModified && meta.lastModified.trim()) return meta.lastModified.trim();
  return null;
}

export function loadPartialTransferMeta(partPath: string): PartialTransferMeta | null {
  const metaPath = getPartialMetaPath(partPath);
  if (!fs.existsSync(partPath) || !fs.existsSync(metaPath)) {
    return null;
  }
  try {
    const stat = fs.statSync(partPath);
    if (!stat.isFile() || stat.size <= 0) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Partial<PartialTransferMeta>;
    if (raw.version !== 1 || !Array.isArray(raw.completedRanges)) {
      return null;
    }
    const totalBytes =
      typeof raw.totalBytes === 'number' && Number.isFinite(raw.totalBytes) && raw.totalBytes > 0
        ? raw.totalBytes
        : null;
    if (totalBytes !== null && stat.size > totalBytes) {
      return null;
    }
    const ranges: ByteRange[] = [];
    for (const pair of raw.completedRanges) {
      if (
        Array.isArray(pair) &&
        pair.length === 2 &&
        typeof pair[0] === 'number' &&
        typeof pair[1] === 'number' &&
        pair[0] >= 0 &&
        pair[1] >= pair[0] &&
        (totalBytes === null || pair[1] < totalBytes)
      ) {
        ranges.push([pair[0], pair[1]]);
      }
    }
    const merged = mergeByteRanges(ranges);
    if (merged.length === 0) {
      return null;
    }
    return {
      version: 1,
      finalUrl: typeof raw.finalUrl === 'string' ? raw.finalUrl : '',
      etag: typeof raw.etag === 'string' ? raw.etag : null,
      lastModified: typeof raw.lastModified === 'string' ? raw.lastModified : null,
      totalBytes,
      completedRanges: merged,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function savePartialTransferMeta(
  partPath: string,
  meta: PartialTransferMeta,
): Promise<void> {
  const metaPath = getPartialMetaPath(partPath);
  const tmpMetaPath = `${metaPath}.tmp`;
  const payload = JSON.stringify({
    ...meta,
    completedRanges: mergeByteRanges(meta.completedRanges),
    updatedAt: new Date().toISOString(),
  });
  await fs.promises.writeFile(tmpMetaPath, payload, 'utf8');
  await fs.promises.rename(tmpMetaPath, metaPath);
}

export async function removePartialTransferFiles(
  partPath: string,
  options: { keepPartial?: boolean } = {},
): Promise<void> {
  const metaPath = getPartialMetaPath(partPath);
  await fs.promises.unlink(`${metaPath}.tmp`).catch(() => undefined);
  if (!options.keepPartial) {
    await fs.promises.unlink(metaPath).catch(() => undefined);
    await fs.promises.unlink(partPath).catch(() => undefined);
  }
}

/**
 * Rolling throughput tracker that computes speed exclusively from newly received
 * bytes in this attempt (preventing artificial spikes from already-resumed bytes).
 */
export class RollingThroughputMeter {
  private readonly samples: { at: number; bytes: number }[] = [];
  private readonly startedAt = Date.now();
  private totalNewBytes = 0;

  recordBytes(deltaBytes: number): void {
    if (deltaBytes <= 0) return;
    const now = Date.now();
    this.totalNewBytes += deltaBytes;
    this.samples.push({ at: now, bytes: deltaBytes });
    const cutoff = now - 2500;
    while (this.samples.length > 0 && this.samples[0]!.at < cutoff) {
      this.samples.shift();
    }
  }

  getBytesPerSec(): number {
    const now = Date.now();
    const cutoff = now - 2500;
    while (this.samples.length > 0 && this.samples[0]!.at < cutoff) {
      this.samples.shift();
    }
    if (this.samples.length > 0) {
      const windowBytes = this.samples.reduce((sum, s) => sum + s.bytes, 0);
      const oldest = this.samples[0]!.at;
      const spanSec = Math.max(0.25, (now - oldest) / 1000);
      return Math.round(windowBytes / spanSec);
    }
    const elapsedSec = Math.max(0.2, (now - this.startedAt) / 1000);
    return Math.round(this.totalNewBytes / elapsedSec);
  }
}

/**
 * Streams a Web ReadableStream directly into a pre-opened FileHandle starting at
 * `writeOffset`, invoking `onChunk(bytesWritten, sliceWritten)` as buffers hit disk.
 */
export async function streamResponseToFileOffset(
  body: ReadableStream<Uint8Array>,
  fileHandle: fs.promises.FileHandle,
  writeOffset: number,
  expectedMaxBytes: number | null,
  signal: AbortSignal,
  onChunk: (chunkLen: number, totalWrittenInSlice: number) => void,
): Promise<number> {
  const nodeReadable = Readable.fromWeb(body as unknown as import('node:stream/web').ReadableStream);
  let cursor = writeOffset;
  let writtenInSlice = 0;

  return new Promise<number>((resolve, reject) => {
    let settled = false;
    let writing = false;
    let ended = false;
    const queue: Buffer[] = [];

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      nodeReadable.removeAllListeners();
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      nodeReadable.destroy();
      reject(err);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(writtenInSlice);
    };

    const onAbort = () => {
      fail(new DOMException('Aborted', 'AbortError'));
    };

    if (signal.aborted) {
      fail(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });

    const pump = async () => {
      if (writing || settled) return;
      writing = true;
      try {
        while (queue.length > 0 && !settled) {
          if (signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const buf = queue.shift()!;
          let sliceToWrite = buf;
          if (expectedMaxBytes !== null) {
            const remainingAllowed = expectedMaxBytes - writtenInSlice;
            if (remainingAllowed <= 0) {
              continue;
            }
            if (sliceToWrite.length > remainingAllowed) {
              sliceToWrite = sliceToWrite.subarray(0, remainingAllowed);
            }
          }
          let offsetInBuf = 0;
          while (offsetInBuf < sliceToWrite.length) {
            const { bytesWritten } = await fileHandle.write(
              sliceToWrite,
              offsetInBuf,
              sliceToWrite.length - offsetInBuf,
              cursor,
            );
            cursor += bytesWritten;
            writtenInSlice += bytesWritten;
            offsetInBuf += bytesWritten;
          }
          onChunk(sliceToWrite.length, writtenInSlice);
        }
        writing = false;
        if (settled) return;
        if (ended) {
          finish();
        } else if (queue.length < 4) {
          nodeReadable.resume();
        }
      } catch (err) {
        writing = false;
        fail(err);
      }
    };

    nodeReadable.on('data', (raw: Buffer | Uint8Array) => {
      if (settled) return;
      const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buf.length === 0) return;
      queue.push(buf);
      if (queue.length >= 6) {
        nodeReadable.pause();
      }
      void pump();
    });

    nodeReadable.on('error', (err) => {
      fail(err);
    });

    nodeReadable.on('end', () => {
      ended = true;
      if (!writing && queue.length === 0) {
        finish();
      } else {
        void pump();
      }
    });
  });
}
