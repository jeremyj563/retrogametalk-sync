import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import {
  replaceExtensionWithChd,
  type ChdCacheStats,
  type ChdConversionMode,
  type ChdJobSnapshot,
  type ChdJobStatus,
  type RuntimeCapabilities,
} from '../shared/discExport.ts';
import { sanitizeFat32Filename } from '../shared/romNaming.ts';
import {
  buildContentDispositionAttachment,
  extractArchiveEntriesToDirectory,
  probeArchiveExtractorCapabilities,
} from './archiveService.ts';
import { formatErrorDetails, logServer } from './logger.ts';

const CHDMAN_CANDIDATES = [
  '/usr/bin/chdman',
  '/usr/local/bin/chdman',
  '/opt/homebrew/bin/chdman',
  'chdman',
];

let cachedChdmanProbe: { binPath: string | null; version: string | null } | null = null;
let cachedRuntimeCapabilities: RuntimeCapabilities | null = null;

/**
 * Parse a `chdman` stderr/stdout progress chunk such as:
 *   `Compressing, 42.7% complete... (ratio=61.3%)`
 *   `Compressing, 100.0% complete...`
 * Returns a clamped 0..100 number (rounded to 1 decimal) or null if no progress token is present.
 */
export function parseChdmanProgressLine(chunk: string): number | null {
  if (!chunk) return null;
  // Take the last percentage match in the chunk (chdman updates with `\r` overwrites)
  const matches = Array.from(
    String(chunk).matchAll(/(?:compressing|extracting|verifying|creating)[^0-9\r\n]*(\d{1,3}(?:\.\d+)?)\s*%/gi),
  );
  if (matches.length === 0) {
    // Fallback for terse progress outputs like "42.5% complete"
    const fallback = Array.from(String(chunk).matchAll(/(\d{1,3}(?:\.\d+)?)\s*%\s*complete/gi));
    if (fallback.length === 0) return null;
    const raw = Number.parseFloat(fallback[fallback.length - 1][1]);
    if (!Number.isFinite(raw)) return null;
    return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
  }
  const raw = Number.parseFloat(matches[matches.length - 1][1]);
  if (!Number.isFinite(raw)) return null;
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}

function parseChdmanVersionBanner(output: string): string | null {
  if (!output) return null;
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  const m = firstLine.match(/chdman\s*[-–—]\s*MAME\s+[^\r\n(]+/i) || firstLine.match(/chdman[^\r\n]{0,80}/i);
  if (m) return m[0].trim();
  return firstLine.slice(0, 80);
}

async function testChdmanExecutable(candidate: string): Promise<{ ok: boolean; version: string | null }> {
  if (candidate.includes(path.sep)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      return { ok: false, version: null };
    }
  }
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result: { ok: boolean; version: string | null }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawn(candidate, ['help'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        done({ ok: false, version: null });
      }, 4000);

      child.stdout?.on('data', (d: Buffer | string) => {
        if (stdout.length < 4096) stdout += d.toString();
      });
      child.stderr?.on('data', (d: Buffer | string) => {
        if (stderr.length < 4096) stderr += d.toString();
      });
      child.on('error', () => {
        clearTimeout(timer);
        done({ ok: false, version: null });
      });
      child.on('close', () => {
        clearTimeout(timer);
        const combined = `${stdout}\n${stderr}`;
        if (/chdman/i.test(combined)) {
          done({ ok: true, version: parseChdmanVersionBanner(combined) });
        } else {
          done({ ok: false, version: null });
        }
      });
    } catch {
      done({ ok: false, version: null });
    }
  });
}

export async function probeChdmanBinary(overridePath?: string): Promise<{
  binPath: string | null;
  version: string | null;
}> {
  if (!overridePath && cachedChdmanProbe) {
    return cachedChdmanProbe;
  }

  const candidates = overridePath
    ? [overridePath]
    : [
        ...(process.env.CHDMAN_BIN ? [process.env.CHDMAN_BIN.trim()] : []),
        ...CHDMAN_CANDIDATES,
      ].filter(Boolean);

  for (const candidate of candidates) {
    const res = await testChdmanExecutable(candidate);
    if (res.ok) {
      const found = { binPath: candidate, version: res.version };
      if (!overridePath) {
        cachedChdmanProbe = found;
      }
      return found;
    }
  }

  const missing = { binPath: null, version: null };
  if (!overridePath) {
    cachedChdmanProbe = missing;
  }
  return missing;
}

export function getChdCacheDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'chd-cache');
}

export function getChdTempBaseDir(dataDir: string): string {
  return path.join(path.resolve(dataDir), 'chd-tmp');
}

export function getChdCacheStats(cacheDir: string, maxGb = 0): ChdCacheStats {
  const maxBytes = Math.max(0, Math.round(maxGb * 1024 * 1024 * 1024));
  let fileCount = 0;
  let totalBytes = 0;
  try {
    if (fs.existsSync(cacheDir)) {
      const entries = fs.readdirSync(cacheDir);
      for (const name of entries) {
        if (!name.endsWith('.chd')) continue;
        const fullPath = path.join(cacheDir, name);
        try {
          const st = fs.statSync(fullPath);
          if (st.isFile()) {
            fileCount += 1;
            totalBytes += st.size;
          }
        } catch {
          // Skip vanishing cache entry
        }
      }
    }
  } catch {
    // Cache directory not yet created
  }
  return { fileCount, totalBytes, maxBytes };
}

export async function probeRuntimeCapabilities(
  dataDir: string,
  chdCacheMaxGb = 0,
): Promise<RuntimeCapabilities> {
  const [chdmanProbe, extractors] = await Promise.all([
    probeChdmanBinary(),
    probeArchiveExtractorCapabilities(),
  ]);
  const chdCache = getChdCacheStats(getChdCacheDir(dataDir), chdCacheMaxGb);
  const caps: RuntimeCapabilities = {
    chdman: Boolean(chdmanProbe.binPath),
    chdmanVersion: chdmanProbe.version,
    unrar: extractors.unrar,
    sevenZip: extractors.sevenZip,
    chdCache,
  };
  cachedRuntimeCapabilities = caps;
  return caps;
}

export function getCachedRuntimeCapabilities(
  dataDir: string,
  chdCacheMaxGb = 0,
): RuntimeCapabilities {
  const chdCache = getChdCacheStats(getChdCacheDir(dataDir), chdCacheMaxGb);
  if (cachedRuntimeCapabilities) {
    return {
      ...cachedRuntimeCapabilities,
      chdCache,
    };
  }
  return {
    chdman: false,
    chdmanVersion: null,
    unrar: false,
    sevenZip: false,
    chdCache,
  };
}

/**
 * Compute deterministic SHA-256 cache key for a specific archive target & conversion mode.
 */
export function computeChdCacheKey(params: {
  archivePath: string;
  archiveSizeBytes: number;
  archiveMtimeMs: number;
  primaryEntry: string;
  entryPaths: string[];
  mode: ChdConversionMode;
}): string {
  const payload = JSON.stringify({
    v: 1,
    archivePath: path.resolve(params.archivePath),
    archiveSizeBytes: params.archiveSizeBytes,
    archiveMtimeMs: Math.round(params.archiveMtimeMs),
    primaryEntry: params.primaryEntry,
    entryPaths: [...params.entryPaths].sort(),
    mode: params.mode,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Enforce bounded LRU disk cache under `cacheDir`.
 * Evicts oldest-mtime `.chd` files whenever total cached bytes exceed `maxBytes`.
 * When `maxBytes <= 0`, removes all cached `.chd` files except optional `keepFilename`.
 */
export function pruneChdCache(
  cacheDir: string,
  maxBytes: number,
  keepFilename?: string,
): { evictedCount: number; freedBytes: number; remainingBytes: number } {
  const resolvedCacheDir = path.resolve(cacheDir);
  const cachePrefix = resolvedCacheDir.endsWith(path.sep)
    ? resolvedCacheDir
    : `${resolvedCacheDir}${path.sep}`;

  if (!fs.existsSync(resolvedCacheDir)) {
    return { evictedCount: 0, freedBytes: 0, remainingBytes: 0 };
  }

  const files: Array<{ name: string; absPath: string; sizeBytes: number; mtimeMs: number }> = [];
  for (const name of fs.readdirSync(resolvedCacheDir)) {
    if (!name.endsWith('.chd') && !name.endsWith('.chd.tmp')) continue;
    const absPath = path.resolve(resolvedCacheDir, name);
    if (!absPath.startsWith(cachePrefix)) continue;
    try {
      const st = fs.statSync(absPath);
      if (!st.isFile()) continue;
      // Clean up abandoned `.chd.tmp` files older than 30 minutes
      if (name.endsWith('.chd.tmp')) {
        if (Date.now() - st.mtimeMs > 30 * 60 * 1000) {
          fs.rmSync(absPath, { force: true });
        }
        continue;
      }
      files.push({ name, absPath, sizeBytes: st.size, mtimeMs: st.mtimeMs });
    } catch {
      // ignore vanished entry
    }
  }

  // Sort oldest-first so LRU eviction drops least-recently-used entries first
  files.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  let evictedCount = 0;
  let freedBytes = 0;
  const limit = Math.max(0, maxBytes);

  for (const file of files) {
    if (totalBytes <= limit) break;
    if (keepFilename && file.name === keepFilename) continue;
    try {
      fs.rmSync(file.absPath, { force: true });
      totalBytes -= file.sizeBytes;
      freedBytes += file.sizeBytes;
      evictedCount += 1;
    } catch {
      // ignore unlink error
    }
  }

  return {
    evictedCount,
    freedBytes,
    remainingBytes: Math.max(0, totalBytes),
  };
}

export function clearChdCache(cacheDir: string): { deletedCount: number; freedBytes: number } {
  const result = pruneChdCache(cacheDir, 0);
  return { deletedCount: result.evictedCount, freedBytes: result.freedBytes };
}

/**
 * Validate all `FILE "..."` references inside an extracted `.cue` sheet (and track references in `.gdi`)
 * so that maliciously crafted sheets cannot read files outside the isolated extraction workspace.
 */
export function validateExtractedDiscDescriptor(
  descriptorPath: string,
  workspaceRoot: string,
): void {
  const resolvedRoot = path.resolve(workspaceRoot);
  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  const resolvedDescriptor = path.resolve(descriptorPath);
  if (!resolvedDescriptor.startsWith(rootPrefix)) {
    throw new Error('Disc descriptor path escapes temporary conversion workspace.');
  }

  const ext = path.extname(resolvedDescriptor).toLowerCase();
  if (ext !== '.cue' && ext !== '.gdi') {
    return;
  }

  const descriptorDir = path.dirname(resolvedDescriptor);
  const rawContent = fs.readFileSync(resolvedDescriptor, 'utf8');

  if (ext === '.cue') {
    const lines = rawContent.split(/\r?\n/);
    let rewritten = false;
    const nextLines: string[] = [];

    for (const line of lines) {
      const m = line.match(/^(\s*FILE\s+)(?:"([^"]+)"|(\S+))(\s+.*)$/i);
      if (!m) {
        nextLines.push(line);
        continue;
      }
      const prefix = m[1];
      const rawRef = (m[2] ?? m[3] ?? '').trim();
      const suffix = m[4];

      if (!rawRef || rawRef.includes('\0') || /^[a-zA-Z]:[\\/]/.test(rawRef) || rawRef.startsWith('/') || rawRef.startsWith('\\')) {
        throw new Error(`Unsafe absolute track path in .cue sheet: "${rawRef}"`);
      }

      const normalizedRef = rawRef.replace(/\\/g, '/');
      if (normalizedRef.split('/').some((seg) => seg === '..')) {
        throw new Error(`Path traversal detected in .cue sheet reference: "${rawRef}"`);
      }

      let candidateAbs = path.resolve(descriptorDir, normalizedRef);
      if (!candidateAbs.startsWith(rootPrefix)) {
        throw new Error(`Track path in .cue sheet escapes conversion workspace: "${rawRef}"`);
      }

      // If archive stored tracks with case differences or sibling leaf match, locate strictly inside descriptorDir
      if (!fs.existsSync(candidateAbs)) {
        const leaf = path.posix.basename(normalizedRef);
        const siblingAbs = path.resolve(descriptorDir, leaf);
        if (siblingAbs.startsWith(rootPrefix) && fs.existsSync(siblingAbs)) {
          candidateAbs = siblingAbs;
          nextLines.push(`${prefix}"${leaf}"${suffix}`);
          rewritten = true;
          continue;
        }
        // Case-insensitive filename match inside descriptorDir (common with Windows-authored .cue sheets on Linux)
        try {
          const dirEntries = fs.readdirSync(descriptorDir);
          const ciMatch = dirEntries.find((name) => name.toLowerCase() === leaf.toLowerCase());
          if (ciMatch) {
            const matchedAbs = path.resolve(descriptorDir, ciMatch);
            if (matchedAbs.startsWith(rootPrefix) && fs.existsSync(matchedAbs)) {
              nextLines.push(`${prefix}"${ciMatch}"${suffix}`);
              rewritten = true;
              continue;
            }
          }
        } catch {
          // fall through to original line
        }
      }

      nextLines.push(line);
    }

    if (rewritten) {
      fs.writeFileSync(resolvedDescriptor, nextLines.join('\n'), 'utf8');
    }
    return;
  }

  if (ext === '.gdi') {
    const lines = rawContent.split(/\r?\n/);
    for (let i = 1; i < lines.length; i += 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      // GDI format: trackNo lba type sectorSize filename offset
      const m = trimmed.match(/^\d+\s+\d+\s+\d+\s+\d+\s+(?:"([^"]+)"|(\S+))\s+\d+$/);
      if (!m) continue;
      const rawRef = (m[1] ?? m[2] ?? '').trim();
      if (!rawRef || rawRef.includes('\0') || /^[a-zA-Z]:[\\/]/.test(rawRef) || rawRef.startsWith('/') || rawRef.startsWith('\\')) {
        throw new Error(`Unsafe absolute track path in .gdi sheet: "${rawRef}"`);
      }
      const normalizedRef = rawRef.replace(/\\/g, '/');
      if (normalizedRef.split('/').some((seg) => seg === '..')) {
        throw new Error(`Path traversal detected in .gdi sheet reference: "${rawRef}"`);
      }
      const candidateAbs = path.resolve(descriptorDir, normalizedRef);
      if (!candidateAbs.startsWith(rootPrefix)) {
        throw new Error(`Track path in .gdi sheet escapes conversion workspace: "${rawRef}"`);
      }
    }
  }
}

export interface ConvertArchiveToChdOptions {
  archivePath: string;
  primaryEntry: string;
  entryPaths: string[];
  mode: ChdConversionMode;
  outputChdPath: string;
  tempWorkspaceDir: string;
  chdmanBin?: string;
  signal?: AbortSignal;
  onPhase?: (phase: 'extracting' | 'converting', percent: number | null, detail?: string) => void;
}

/**
 * Extract the target disc entries from an archive into `tempWorkspaceDir`, validate `.cue`/`.gdi`
 * references, run `chdman createcd|createdvd` without a shell, and atomically move the result
 * to `outputChdPath`. Always removes `tempWorkspaceDir` in `finally`.
 */
export async function convertArchiveDiscToChd(
  options: ConvertArchiveToChdOptions,
): Promise<{ outputPath: string; outputBytes: number }> {
  const chdmanBin = options.chdmanBin || (await probeChdmanBinary()).binPath;
  if (!chdmanBin) {
    throw new Error('chdman binary is not installed in this runtime.');
  }

  const workspaceDir = path.resolve(options.tempWorkspaceDir);
  const outputFinal = path.resolve(options.outputChdPath);
  const outputTemp = `${outputFinal}.tmp`;
  fs.mkdirSync(path.dirname(outputFinal), { recursive: true });
  fs.mkdirSync(workspaceDir, { recursive: true });

  try {
    if (options.signal?.aborted) {
      throw new Error('Aborted');
    }

    const entriesToExtract =
      options.entryPaths.length > 0 ? options.entryPaths : [options.primaryEntry];

    options.onPhase?.('extracting', 0, `Extracting ${entriesToExtract.length} disc file(s)…`);

    const extracted = await extractArchiveEntriesToDirectory(
      options.archivePath,
      entriesToExtract,
      workspaceDir,
      {
        signal: options.signal,
        onEntryProgress: (idx, total, entryPath) => {
          const pct = total > 0 ? Math.round((idx / total) * 100) : 0;
          options.onPhase?.('extracting', pct, `Extracting ${path.posix.basename(entryPath)}…`);
        },
      },
    );

    const normalizedPrimary = options.primaryEntry.replace(/\\/g, '/').replace(/^\/+/, '');
    const primaryExtracted =
      extracted.find((e) => e.entryPath === normalizedPrimary) || extracted[0];
    if (!primaryExtracted) {
      throw new Error('No disc entries could be extracted for CHD conversion.');
    }

    validateExtractedDiscDescriptor(primaryExtracted.absPath, workspaceDir);

    if (options.signal?.aborted) {
      throw new Error('Aborted');
    }

    const subcommand = options.mode === 'dvd' ? 'createdvd' : 'createcd';
    const args = [subcommand, '-i', primaryExtracted.absPath, '-o', outputTemp, '--force'];

    options.onPhase?.('converting', 0, `Running chdman ${subcommand}…`);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let killEscalationTimer: ReturnType<typeof setTimeout> | null = null;
      let stderrTail = '';

      const child = spawn(chdmanBin, args, {
        shell: false,
        cwd: path.dirname(primaryExtracted.absPath),
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const cleanupListeners = () => {
        if (killEscalationTimer) {
          clearTimeout(killEscalationTimer);
          killEscalationTimer = null;
        }
        options.signal?.removeEventListener('abort', onAbort);
      };

      const finish = (err?: unknown) => {
        if (settled) return;
        settled = true;
        cleanupListeners();
        if (err) reject(err);
        else resolve();
      };

      const onAbort = () => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        killEscalationTimer = setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 2000);
        finish(new Error('Aborted'));
      };

      if (options.signal) {
        if (options.signal.aborted) {
          onAbort();
          return;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
      }

      const handleOutputChunk = (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (text.length > 0) {
          stderrTail = `${stderrTail}${text}`.slice(-2048);
        }
        const pct = parseChdmanProgressLine(text);
        if (pct !== null) {
          options.onPhase?.('converting', pct, `Compressing to .chd (${Math.round(pct)}%)…`);
        }
      };

      child.stdout?.on('data', handleOutputChunk);
      child.stderr?.on('data', handleOutputChunk);

      child.on('error', (err) => {
        finish(new Error(`Failed to spawn chdman: ${err.message}`));
      });

      child.on('close', (code, sig) => {
        if (options.signal?.aborted) {
          finish(new Error('Aborted'));
          return;
        }
        if (code === 0) {
          options.onPhase?.('converting', 100, 'CHD compression complete');
          finish();
        } else {
          const detail = stderrTail
            .split(/[\r\n]+/)
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(-3)
            .join(' | ');
          finish(
            new Error(
              `chdman ${subcommand} failed (exit ${code ?? 'null'}${sig ? `, signal ${sig}` : ''})${detail ? `: ${detail}` : ''}`,
            ),
          );
        }
      });
    });

    if (!fs.existsSync(outputTemp)) {
      throw new Error('chdman exited cleanly but did not produce an output .chd file.');
    }

    fs.renameSync(outputTemp, outputFinal);
    const stat = fs.statSync(outputFinal);
    return {
      outputPath: outputFinal,
      outputBytes: stat.size,
    };
  } catch (err) {
    try {
      fs.rmSync(outputTemp, { force: true });
    } catch {
      // ignore temp cleanup failure
    }
    throw err;
  } finally {
    try {
      fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore workspace cleanup failure
    }
  }
}

interface ManagedChdJob {
  snapshot: ChdJobSnapshot;
  cacheKey: string;
  outputPath: string;
  ephemeralOutput: boolean;
  controller: AbortController;
  subscribers: Set<(snap: ChdJobSnapshot) => void>;
  createdAtMs: number;
  completedAtMs: number | null;
  streamedCount: number;
}

const JOB_ID_RE = /^[a-f0-9-]{8,64}$/;
const STALE_JOB_TTL_MS = 30 * 60 * 1000;

export function isValidChdJobId(raw: string): boolean {
  return JOB_ID_RE.test(raw);
}

export class ChdConversionManager {
  private readonly jobs = new Map<string, ManagedChdJob>();
  private readonly activeByCacheKey = new Map<string, string>();
  private readonly dataDirProvider: () => string;

  constructor(dataDirProvider: () => string) {
    this.dataDirProvider = dataDirProvider;
  }

  private emitUpdate(job: ManagedChdJob, patch: Partial<ChdJobSnapshot>): void {
    job.snapshot = {
      ...job.snapshot,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    for (const listener of job.subscribers) {
      try {
        listener(job.snapshot);
      } catch {
        // ignore broken subscriber
      }
    }
  }

  cleanupStaleJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.jobs.entries()) {
      const isTerminal =
        job.snapshot.status === 'done' ||
        job.snapshot.status === 'error' ||
        job.snapshot.status === 'canceled';
      if (!isTerminal) continue;
      const refTime = job.completedAtMs ?? job.createdAtMs;
      if (now - refTime < STALE_JOB_TTL_MS) continue;
      if (job.ephemeralOutput && job.outputPath) {
        try {
          fs.rmSync(job.outputPath, { force: true });
        } catch {
          // ignore
        }
      }
      if (this.activeByCacheKey.get(job.cacheKey) === jobId) {
        this.activeByCacheKey.delete(job.cacheKey);
      }
      this.jobs.delete(jobId);
    }
  }

  async startOrReuseJob(params: {
    itemId: number;
    fileId: number;
    targetId: string;
    archivePath: string;
    primaryEntry: string;
    entryPaths: string[];
    mode: ChdConversionMode;
    filename: string;
    cacheMaxGb: number;
    chdmanBin?: string;
  }): Promise<ChdJobSnapshot> {
    this.cleanupStaleJobs();

    const chdmanPath = params.chdmanBin || (await probeChdmanBinary()).binPath;
    if (!chdmanPath) {
      throw new Error('chdman is not installed in this runtime.');
    }

    const archiveStat = fs.statSync(params.archivePath);
    const cacheKey = computeChdCacheKey({
      archivePath: params.archivePath,
      archiveSizeBytes: archiveStat.size,
      archiveMtimeMs: archiveStat.mtimeMs,
      primaryEntry: params.primaryEntry,
      entryPaths: params.entryPaths,
      mode: params.mode,
    });

    const dataDir = this.dataDirProvider();
    const cacheDir = getChdCacheDir(dataDir);
    const tempBaseDir = getChdTempBaseDir(dataDir);
    const useCache = params.cacheMaxGb > 0;
    const cacheFileName = `${cacheKey}.chd`;
    const cachedFilePath = path.join(cacheDir, cacheFileName);

    const safeOutputFilename = replaceExtensionWithChd(
      sanitizeFat32Filename(params.filename || path.posix.basename(params.primaryEntry), 200),
    );

    // 1. Check LRU disk cache hit first
    if (useCache && fs.existsSync(cachedFilePath)) {
      try {
        const st = fs.statSync(cachedFilePath);
        if (st.isFile() && st.size > 0) {
          const nowDate = new Date();
          try {
            fs.utimesSync(cachedFilePath, nowDate, nowDate);
          } catch {
            // non-fatal mtime touch failure
          }
          const jobId = crypto.randomUUID();
          const snap: ChdJobSnapshot = {
            jobId,
            itemId: params.itemId,
            fileId: params.fileId,
            targetId: params.targetId,
            mode: params.mode,
            status: 'done',
            percent: 100,
            cached: true,
            outputBytes: st.size,
            filename: safeOutputFilename,
            detail: 'Reused cached .chd image',
            error: null,
            updatedAt: nowDate.toISOString(),
          };
          this.jobs.set(jobId, {
            snapshot: snap,
            cacheKey,
            outputPath: cachedFilePath,
            ephemeralOutput: false,
            controller: new AbortController(),
            subscribers: new Set(),
            createdAtMs: Date.now(),
            completedAtMs: Date.now(),
            streamedCount: 0,
          });
          logServer(
            'CHD',
            'debug',
            `CHD cache hit for "${safeOutputFilename}"`,
            `key=${cacheKey.slice(0, 12)}, bytes=${st.size}`,
          );
          return snap;
        }
      } catch {
        // Proceed with fresh conversion if stat failed
      }
    }

    // 2. Reuse an in-flight conversion for the exact same cache key
    const existingJobId = this.activeByCacheKey.get(cacheKey);
    if (existingJobId) {
      const existing = this.jobs.get(existingJobId);
      if (
        existing &&
        (existing.snapshot.status === 'queued' ||
          existing.snapshot.status === 'extracting' ||
          existing.snapshot.status === 'converting')
      ) {
        return { ...existing.snapshot };
      }
    }

    // 3. Create new conversion job
    const jobId = crypto.randomUUID();
    const outputPath = useCache
      ? cachedFilePath
      : path.join(tempBaseDir, `${jobId}.chd`);
    const workspaceDir = path.join(tempBaseDir, `work-${jobId}`);

    const initialSnapshot: ChdJobSnapshot = {
      jobId,
      itemId: params.itemId,
      fileId: params.fileId,
      targetId: params.targetId,
      mode: params.mode,
      status: 'queued',
      percent: 0,
      cached: false,
      outputBytes: null,
      filename: safeOutputFilename,
      detail: 'Preparing disc image for CHD conversion…',
      error: null,
      updatedAt: new Date().toISOString(),
    };

    const job: ManagedChdJob = {
      snapshot: initialSnapshot,
      cacheKey,
      outputPath,
      ephemeralOutput: !useCache,
      controller: new AbortController(),
      subscribers: new Set(),
      createdAtMs: Date.now(),
      completedAtMs: null,
      streamedCount: 0,
    };

    this.jobs.set(jobId, job);
    this.activeByCacheKey.set(cacheKey, jobId);

    void (async () => {
      try {
        const result = await convertArchiveDiscToChd({
          archivePath: params.archivePath,
          primaryEntry: params.primaryEntry,
          entryPaths: params.entryPaths,
          mode: params.mode,
          outputChdPath: outputPath,
          tempWorkspaceDir: workspaceDir,
          chdmanBin: chdmanPath,
          signal: job.controller.signal,
          onPhase: (phase, percent, detail) => {
            if (job.controller.signal.aborted) return;
            const nextStatus: ChdJobStatus = phase === 'extracting' ? 'extracting' : 'converting';
            this.emitUpdate(job, {
              status: nextStatus,
              percent,
              detail: detail ?? job.snapshot.detail,
            });
          },
        });

        if (useCache) {
          const maxBytes = Math.round(params.cacheMaxGb * 1024 * 1024 * 1024);
          pruneChdCache(cacheDir, maxBytes, cacheFileName);
        }

        job.completedAtMs = Date.now();
        this.emitUpdate(job, {
          status: 'done',
          percent: 100,
          outputBytes: result.outputBytes,
          detail: 'CHD ready for device export',
          error: null,
        });
        logServer(
          'CHD',
          'info',
          `Converted "${safeOutputFilename}" to .chd (${params.mode})`,
          `bytes=${result.outputBytes}, cached=${useCache}`,
        );
      } catch (err) {
        job.completedAtMs = Date.now();
        const aborted = job.controller.signal.aborted || (err instanceof Error && err.message === 'Aborted');
        if (aborted) {
          this.emitUpdate(job, {
            status: 'canceled',
            detail: 'Conversion canceled',
            error: 'Canceled by user',
          });
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          logServer('CHD', 'warn', `CHD conversion failed for "${safeOutputFilename}"`, formatErrorDetails(err));
          this.emitUpdate(job, {
            status: 'error',
            detail: null,
            error: msg,
          });
        }
        if (job.ephemeralOutput) {
          try {
            fs.rmSync(job.outputPath, { force: true });
          } catch {
            // ignore
          }
        }
      } finally {
        if (this.activeByCacheKey.get(cacheKey) === jobId) {
          this.activeByCacheKey.delete(cacheKey);
        }
      }
    })();

    return { ...initialSnapshot };
  }

  getJobSnapshot(jobId: string): ChdJobSnapshot | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job.snapshot } : null;
  }

  subscribeJobEvents(jobId: string, listener: (snap: ChdJobSnapshot) => void): (() => void) | null {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    job.subscribers.add(listener);
    return () => {
      job.subscribers.delete(listener);
    };
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    const isActive =
      job.snapshot.status === 'queued' ||
      job.snapshot.status === 'extracting' ||
      job.snapshot.status === 'converting';
    if (isActive) {
      job.controller.abort();
      job.completedAtMs = Date.now();
      this.emitUpdate(job, {
        status: 'canceled',
        detail: 'Conversion canceled',
        error: 'Canceled by user',
      });
    }
    if (job.ephemeralOutput) {
      try {
        fs.rmSync(job.outputPath, { force: true });
      } catch {
        // ignore
      }
    }
    if (this.activeByCacheKey.get(job.cacheKey) === jobId) {
      this.activeByCacheKey.delete(job.cacheKey);
    }
    return true;
  }

  async streamJobOutputToResponse(
    jobId: string,
    requestedName: string | undefined,
    res: Response,
  ): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'CHD conversion job not found or expired.' });
      return;
    }
    if (job.snapshot.status !== 'done') {
      res.status(409).json({
        error:
          job.snapshot.status === 'error'
            ? job.snapshot.error || 'CHD conversion failed.'
            : `CHD conversion is not ready yet (status: ${job.snapshot.status}).`,
      });
      return;
    }
    if (!fs.existsSync(job.outputPath)) {
      res.status(404).json({ error: 'Prepared .chd file is no longer on disk.' });
      return;
    }

    const st = fs.statSync(job.outputPath);
    const outName = replaceExtensionWithChd(
      sanitizeFat32Filename(requestedName?.trim() || job.snapshot.filename, 200),
    );
    const disposition = buildContentDispositionAttachment(outName);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition.headerValue);
    res.setHeader('Content-Length', String(st.size));

    const readStream = fs.createReadStream(job.outputPath);
    job.streamedCount += 1;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: unknown) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      readStream.on('error', (err) => {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        } else {
          res.destroy(err);
        }
        done(err);
      });
      res.on('error', (err) => {
        readStream.destroy();
        done(err);
      });
      res.on('close', () => {
        if (!res.writableEnded) {
          readStream.destroy();
        }
        done();
      });
      res.on('finish', () => done());
      readStream.pipe(res);
    });

    // When cache is disabled (`0 GB`), remove the temporary `.chd` right after streaming completes
    if (job.ephemeralOutput) {
      try {
        fs.rmSync(job.outputPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
      this.jobs.delete(jobId);
    }
  }
}
