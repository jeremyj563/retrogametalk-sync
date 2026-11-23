import { buildUpgradeMatchStem } from '../shared/romNaming';
import {
  DEVICE_MARKER_FILENAME,
  DEVICE_MARKER_MAX_BYTES,
  parseDeviceMarkerJson,
  sanitizeInstalledRelativePath,
  serializeDeviceMarkerJson,
  type DeviceMarkerPayload,
} from '../shared/deviceProfiles';
import {
  IGNORED_SCAN_DIRECTORY_NAMES,
  type ScannedDirNode,
} from '../shared/storageAutoConfig';

export interface SdDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<SdDirectoryHandle | SdFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<SdDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<SdFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  isSameEntry?: (other: SdDirectoryHandle) => Promise<boolean>;
  queryPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
  requestPermission?: (descriptor?: { mode?: 'read' | 'readwrite' }) => Promise<'granted' | 'prompt' | 'denied'>;
}

export interface SdFileWritableStream extends WritableStream<Uint8Array> {
  write(data: Uint8Array | ArrayBuffer | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort(reason?: unknown): Promise<void>;
}

export interface SdFileHandle {
  kind: 'file';
  name: string;
  createWritable(options?: { keepExistingData?: boolean }): Promise<SdFileWritableStream>;
  getFile(): Promise<File>;
}

export interface SdScanFolderResult {
  exactNames: Set<string>;
  exactNamesLower: Map<string, string>;
  entries: { name: string; kind: 'file' | 'directory'; stemInfo: ReturnType<typeof buildUpgradeMatchStem> }[];
}

export interface ScanStorageTreeOptions {
  maxDepth?: number;
  maxDirectories?: number;
  maxSampleFilesPerDir?: number;
  signal?: AbortSignal;
  onProgress?: (progress: { directoriesScanned: number; currentPath: string }) => void;
}

export type FileSystemAccessSupportCode =
  | 'supported'
  | 'insecure_context'
  | 'unsupported_browser';

export interface FileSystemAccessSupportResult {
  supported: boolean;
  code: FileSystemAccessSupportCode;
  origin?: string;
  reason?: string;
}

export function evaluateFileSystemAccessSupport(env: {
  hasWindow: boolean;
  isSecureContext?: boolean;
  hasDirectoryPicker: boolean;
  origin?: string;
}): FileSystemAccessSupportResult {
  if (!env.hasWindow) {
    return {
      supported: false,
      code: 'unsupported_browser',
      reason: 'Browser environment required.',
    };
  }
  if (env.hasDirectoryPicker) {
    return {
      supported: true,
      code: 'supported',
      origin: env.origin,
    };
  }
  if (env.isSecureContext === false) {
    const originHint = env.origin && env.origin !== 'null' ? env.origin : 'this URL';
    return {
      supported: false,
      code: 'insecure_context',
      origin: env.origin,
      reason: `Chrome hides direct folder access on plain HTTP (${originHint}). Serve over HTTPS or add ${originHint} to chrome://flags/#unsafely-treat-insecure-origin-as-secure and relaunch.`,
    };
  }
  return {
    supported: false,
    code: 'unsupported_browser',
    origin: env.origin,
    reason:
      'Direct storage device folder access requires Chrome, Edge, or another Chromium browser. Use Prepared ROM download in Firefox/Safari.',
  };
}

export function isFileSystemAccessSupported(): FileSystemAccessSupportResult {
  if (typeof window === 'undefined') {
    return evaluateFileSystemAccessSupport({
      hasWindow: false,
      hasDirectoryPicker: false,
    });
  }
  const win = window as unknown as {
    showDirectoryPicker?: unknown;
    isSecureContext?: boolean;
    location?: { origin?: string };
  };
  return evaluateFileSystemAccessSupport({
    hasWindow: true,
    isSecureContext: win.isSecureContext,
    hasDirectoryPicker: typeof win.showDirectoryPicker === 'function',
    origin: win.location?.origin,
  });
}

export async function pickSdCardRootDirectory(): Promise<SdDirectoryHandle> {
  const win = window as unknown as {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<SdDirectoryHandle>;
  };
  if (typeof win.showDirectoryPicker !== 'function') {
    throw new Error('This browser does not support File System Access API (showDirectoryPicker).');
  }
  return win.showDirectoryPicker({ mode: 'readwrite', id: 'rgt-sync-sd-card' });
}

export async function resolveOrCreateSubdirectory(
  rootHandle: SdDirectoryHandle,
  relativePath: string,
  create: boolean,
  onDebug?: (message: string, detail?: string) => void,
): Promise<SdDirectoryHandle | null> {
  const segments = relativePath
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..');

  let current = rootHandle;
  for (const seg of segments) {
    try {
      current = await current.getDirectoryHandle(seg, { create });
    } catch (err) {
      const detail =
        err instanceof DOMException
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      onDebug?.(
        `Failed ${create ? 'creating' : 'resolving'} subdirectory segment "${seg}" under "${relativePath}"`,
        detail,
      );
      return null;
    }
  }
  return current;
}

export async function scanTargetFolder(
  rootHandle: SdDirectoryHandle,
  relativeFolder: string,
): Promise<SdScanFolderResult> {
  const exactNames = new Set<string>();
  const exactNamesLower = new Map<string, string>();
  const entries: SdScanFolderResult['entries'] = [];

  const dir = await resolveOrCreateSubdirectory(rootHandle, relativeFolder, false);
  if (!dir) {
    return { exactNames, exactNamesLower, entries };
  }

  for await (const entry of dir.values()) {
    if (entry.name.trim().toLowerCase() === DEVICE_MARKER_FILENAME.toLowerCase()) {
      continue;
    }
    exactNames.add(entry.name);
    exactNamesLower.set(entry.name.toLowerCase(), entry.name);
    entries.push({
      name: entry.name,
      kind: entry.kind,
      stemInfo: buildUpgradeMatchStem(entry.name),
    });
  }

  return { exactNames, exactNamesLower, entries };
}

export interface ReadDeviceMarkerResult {
  found: boolean;
  marker: DeviceMarkerPayload | null;
  reason?: 'not_found' | 'oversized' | 'invalid' | 'error';
  error?: string;
}

/**
 * Reads and strictly validates `.rgt-device.json` from the root of a mounted storage handle.
 * Enforces a hard 4 KB file size cap and returns a clean structured result without throwing.
 */
export async function readDeviceMarkerFromSdCard(
  rootHandle: SdDirectoryHandle,
): Promise<ReadDeviceMarkerResult> {
  try {
    const fileHandle = await rootHandle.getFileHandle(DEVICE_MARKER_FILENAME, { create: false });
    const file = await fileHandle.getFile();
    if (typeof file.size === 'number' && file.size > DEVICE_MARKER_MAX_BYTES) {
      return {
        found: false,
        marker: null,
        reason: 'oversized',
        error: `${DEVICE_MARKER_FILENAME} exceeds ${DEVICE_MARKER_MAX_BYTES} byte safety limit`,
      };
    }
    const text =
      typeof file.text === 'function'
        ? await file.text()
        : await new Response(file).text();
    const marker = parseDeviceMarkerJson(text);
    if (!marker) {
      return {
        found: false,
        marker: null,
        reason: 'invalid',
        error: `${DEVICE_MARKER_FILENAME} is malformed or unsupported`,
      };
    }
    return { found: true, marker };
  } catch (err) {
    const errName = (err as { name?: string } | null)?.name;
    if ((err instanceof DOMException && err.name === 'NotFoundError') || errName === 'NotFoundError') {
      return { found: false, marker: null, reason: 'not_found' };
    }
    return {
      found: false,
      marker: null,
      reason: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface WriteDeviceMarkerResult {
  ok: boolean;
  readOnly: boolean;
  updatedAt: string | null;
  error?: string;
}

/**
 * Writes or updates the hidden `.rgt-device.json` marker at the mounted storage root.
 * Degrades gracefully on read-only media or denied write permission without failing the mount.
 */
export async function writeDeviceMarkerToSdCard(
  rootHandle: SdDirectoryHandle,
  payload: {
    deviceId: string;
    name?: string | null;
    createdAt?: string | null;
  },
): Promise<WriteDeviceMarkerResult> {
  const updatedAt = new Date().toISOString();
  let serialized: string;
  try {
    serialized = serializeDeviceMarkerJson({
      deviceId: payload.deviceId,
      name: payload.name,
      createdAt: payload.createdAt,
      updatedAt,
    });
  } catch (err) {
    return {
      ok: false,
      readOnly: false,
      updatedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let writable: SdFileWritableStream | null = null;
  try {
    const fileHandle = await rootHandle.getFileHandle(DEVICE_MARKER_FILENAME, { create: true });
    writable = await fileHandle.createWritable({ keepExistingData: false });
    await writable.write(serialized);
    await writable.close();
    return { ok: true, readOnly: false, updatedAt };
  } catch (err) {
    if (writable) {
      try {
        await writable.abort();
      } catch {
        // Ignore secondary abort failure
      }
    }
    const errName = (err as { name?: string } | null)?.name || '';
    const msg = err instanceof Error ? err.message : String(err);
    const readOnly =
      errName === 'NotAllowedError' ||
      errName === 'NoModificationAllowedError' ||
      errName === 'SecurityError' ||
      /read[- ]?only|permission|denied|not allowed/i.test(msg);
    return {
      ok: false,
      readOnly,
      updatedAt: null,
      error: msg,
    };
  }
}

function extractFileExtension(filename: string): string {
  const trimmed = filename.trim();
  const dotIdx = trimmed.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === trimmed.length - 1) return '';
  return trimmed.slice(dotIdx + 1).toLowerCase();
}

/**
 * Walks a user-selected FileSystemDirectoryHandle in bounded breadth-first order to build
 * a lightweight directory tree snapshot for Export Device Auto-Configure.
 * Prunes hidden/OS/media/save folders and caps per-directory file sampling so large SD cards
 * finish quickly and remain responsive.
 */
export async function scanStorageDirectoryTree(
  rootHandle: SdDirectoryHandle,
  options: ScanStorageTreeOptions = {},
): Promise<ScannedDirNode[]> {
  const maxDepth = Math.max(1, options.maxDepth ?? 4);
  const maxDirectories = Math.max(20, options.maxDirectories ?? 600);
  const maxSampleFilesPerDir = Math.max(8, options.maxSampleFilesPerDir ?? 48);
  const { signal, onProgress } = options;

  const nodes: ScannedDirNode[] = [];
  const queue: Array<{
    handle: SdDirectoryHandle;
    relativePath: string;
    name: string;
    depth: number;
  }> = [{ handle: rootHandle, relativePath: '', name: rootHandle.name || 'Storage Device', depth: 0 }];

  let lastProgressAt = 0;

  while (queue.length > 0 && nodes.length < maxDirectories) {
    if (signal?.aborted) {
      throw new DOMException('Directory scan canceled by user.', 'AbortError');
    }

    const current = queue.shift()!;
    const childDirs: string[] = [];
    const childHandles: Array<{ name: string; handle: SdDirectoryHandle }> = [];
    const sampleExtensions: string[] = [];
    let fileCount = 0;

    try {
      for await (const entry of current.handle.values()) {
        if (signal?.aborted) {
          throw new DOMException('Directory scan canceled by user.', 'AbortError');
        }
        const entryName = entry.name.trim();
        if (!entryName || entryName.startsWith('.')) continue;

        if (entry.kind === 'directory') {
          childDirs.push(entryName);
          const lowerName = entryName.toLowerCase();
          if (current.depth < maxDepth && !IGNORED_SCAN_DIRECTORY_NAMES.has(lowerName)) {
            childHandles.push({ name: entryName, handle: entry });
          }
        } else if (entry.kind === 'file') {
          fileCount += 1;
          if (sampleExtensions.length < maxSampleFilesPerDir) {
            const ext = extractFileExtension(entryName);
            if (ext) sampleExtensions.push(ext);
          }
          // Generous safety cap against pathological directories while still scanning
          // all normal ROM collections completely so child subfolders are never missed
          if (fileCount >= 25000) {
            break;
          }
        }
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Skip unreadable subdirectories cleanly while continuing scan
    }

    nodes.push({
      relativePath: current.relativePath,
      name: current.name,
      depth: current.depth,
      childDirs,
      sampleExtensions,
      fileCount,
    });

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (onProgress && (nodes.length === 1 || now - lastProgressAt >= 80)) {
      lastProgressAt = now;
      onProgress({
        directoriesScanned: nodes.length,
        currentPath: current.relativePath || current.name,
      });
    }

    if (current.depth < maxDepth) {
      for (const child of childHandles) {
        if (nodes.length + queue.length >= maxDirectories) break;
        const childRelPath = current.relativePath
          ? `${current.relativePath}/${child.name}`
          : child.name;
        queue.push({
          handle: child.handle,
          relativePath: childRelPath,
          name: child.name,
          depth: current.depth + 1,
        });
      }
    }
  }

  onProgress?.({
    directoriesScanned: nodes.length,
    currentPath: '',
  });

  return nodes;
}

export function registerWrittenEntryInScan(
  scan: SdScanFolderResult,
  name: string,
  kind: 'file' | 'directory',
  removedOldName?: string | null,
): void {
  if (removedOldName) {
    unregisterEntryInScan(scan, removedOldName);
  }
  const lower = name.toLowerCase();
  if (!scan.exactNamesLower.has(lower)) {
    scan.exactNames.add(name);
    scan.exactNamesLower.set(lower, name);
    scan.entries.push({
      name,
      kind,
      stemInfo: buildUpgradeMatchStem(name),
    });
  }
}

export function unregisterEntryInScan(
  scan: SdScanFolderResult | undefined,
  name: string,
): void {
  if (!scan || !name) return;
  const lower = name.toLowerCase();
  const actual = scan.exactNamesLower.get(lower) ?? name;
  scan.exactNames.delete(actual);
  scan.exactNames.delete(name);
  scan.exactNamesLower.delete(lower);
  const idx = scan.entries.findIndex((e) => e.name.toLowerCase() === lower);
  if (idx >= 0) scan.entries.splice(idx, 1);
}

export interface SdRemovePathResult {
  status: 'removed' | 'not_found' | 'invalid' | 'error';
  path: string;
  error?: string;
}

/**
 * Safely deletes a single relative file or subfolder strictly inside the mounted storage root.
 * Never traverses upward (`..`), never touches root itself, and never accesses the local mirror.
 */
export async function removeRelativePathFromSdCard(
  rootHandle: SdDirectoryHandle,
  relativePath: string,
  onDebug?: (message: string, detail?: string) => void,
): Promise<SdRemovePathResult> {
  const clean = sanitizeInstalledRelativePath(relativePath);
  if (!clean) {
    return {
      status: 'invalid',
      path: relativePath,
      error: 'Refused to remove unsafe or empty relative path',
    };
  }

  const segments = clean.split('/');
  const leafName = segments[segments.length - 1];
  const parentRel = segments.slice(0, -1).join('/');

  let parentDir: SdDirectoryHandle | null = rootHandle;
  if (parentRel) {
    parentDir = await resolveOrCreateSubdirectory(rootHandle, parentRel, false, onDebug);
    if (!parentDir) {
      return { status: 'not_found', path: clean };
    }
  }

  try {
    await parentDir.removeEntry(leafName, { recursive: true });
    onDebug?.(`Removed "${clean}" from mounted device`);
    return { status: 'removed', path: clean };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return { status: 'not_found', path: clean };
    }
    const errName = (err as { name?: string } | null)?.name;
    if (errName === 'NotFoundError') {
      return { status: 'not_found', path: clean };
    }
    const msg = err instanceof Error ? err.message : String(err);
    onDebug?.(`Failed removing "${clean}" from mounted device`, msg);
    return { status: 'error', path: clean, error: msg };
  }
}

/**
 * Fallback removal for legacy installs that predate `installedPaths` tracking:
 * scans the resolved target folder and removes exact filename or stem+role match(es).
 */
export async function removeStemFallbackFromSdCard(
  rootHandle: SdDirectoryHandle,
  folderRel: string,
  installedFilename: string | null | undefined,
  onDebug?: (message: string, detail?: string) => void,
): Promise<{ removedPaths: string[]; errors: string[] }> {
  const removedPaths: string[] = [];
  const errors: string[] = [];
  const cleanFolder = sanitizeInstalledRelativePath(folderRel);
  const candidateName = (installedFilename || '').trim();
  if (!cleanFolder || !candidateName) {
    return { removedPaths, errors };
  }

  const scan = await scanTargetFolder(rootHandle, cleanFolder);
  const lowerTarget = candidateName.toLowerCase();
  const exact = scan.exactNamesLower.get(lowerTarget);
  const matchedNames = new Set<string>();

  if (exact) {
    matchedNames.add(exact);
  } else {
    const desired = buildUpgradeMatchStem(candidateName);
    if (desired.stem) {
      for (const entry of scan.entries) {
        if (entry.stemInfo.stem !== desired.stem) continue;
        if ((entry.stemInfo.role || null) !== (desired.role || null)) continue;
        matchedNames.add(entry.name);
      }
    }
  }

  for (const name of matchedNames) {
    const relPath = `${cleanFolder}/${name}`;
    const res = await removeRelativePathFromSdCard(rootHandle, relPath, onDebug);
    if (res.status === 'removed') {
      removedPaths.push(res.path);
    } else if (res.status === 'error' && res.error) {
      errors.push(`${relPath}: ${res.error}`);
    }
  }

  return { removedPaths, errors };
}

export function findUpgradeCandidateOnCard(
  targetName: string,
  scan: SdScanFolderResult | undefined,
): { exactMatch: boolean; olderEntryName: string | null } {
  if (!scan) {
    return { exactMatch: false, olderEntryName: null };
  }

  const lower = targetName.toLowerCase();
  if (scan.exactNamesLower.has(lower)) {
    return { exactMatch: true, olderEntryName: null };
  }

  const desired = buildUpgradeMatchStem(targetName);
  if (!desired.stem) {
    return { exactMatch: false, olderEntryName: null };
  }

  for (const existing of scan.entries) {
    if (existing.stemInfo.stem !== desired.stem) continue;
    // Match same role category (e.g., Hack vs Hack, T-En vs T-En) or both retail
    if ((existing.stemInfo.role || null) !== (desired.role || null)) continue;
    if (existing.name.toLowerCase() !== lower) {
      return { exactMatch: false, olderEntryName: existing.name };
    }
  }

  return { exactMatch: false, olderEntryName: null };
}

export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

export type SdStreamStage = 'extracting' | 'writing' | 'finalizing';

export interface SdStreamProgressUpdate {
  bytesWritten: number;
  totalBytes: number | null;
  bytesPerSec: number | null;
}

export async function streamHttpPayloadToSdFile(
  url: string,
  dirHandle: SdDirectoryHandle,
  filename: string,
  options?: {
    signal?: AbortSignal;
    hadExistingFile?: boolean;
    expectedBytes?: number | null;
    onStage?: (stage: SdStreamStage) => void;
    onProgress?: (progress: SdStreamProgressUpdate) => void;
    onDebug?: (message: string, detail?: string) => void;
  },
): Promise<number> {
  const signal = options?.signal;
  const onDebug = options?.onDebug;
  const onStage = options?.onStage;
  const onProgress = options?.onProgress;
  if (signal?.aborted) {
    throw new DOMException('Installation canceled by user.', 'AbortError');
  }

  onDebug?.(`Extracting & streaming "${filename}"`, url);
  onStage?.('extracting');

  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (fetchErr) {
    if (isAbortError(fetchErr)) throw fetchErr;
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    onDebug?.(`HTTP fetch error for "${filename}"`, `${msg} · ${url}`);
    throw new Error(`Network fetch failed for "${filename}": ${msg}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    let cleanErr = errText;
    try {
      const parsed = JSON.parse(errText) as { error?: string };
      if (parsed?.error) cleanErr = parsed.error;
    } catch {
      // Keep raw text when not JSON
    }
    onDebug?.(`HTTP ${res.status} extracting "${filename}"`, cleanErr || url);
    throw new Error(cleanErr || `Extraction failed (HTTP ${res.status})`);
  }

  const rawContentLength = Number(res.headers.get('content-length'));
  const totalBytes =
    Number.isFinite(rawContentLength) && rawContentLength > 0
      ? rawContentLength
      : options?.expectedBytes && options.expectedBytes > 0
        ? options.expectedBytes
        : null;

  let existedBefore = Boolean(options?.hadExistingFile);
  if (!existedBefore) {
    try {
      await dirHandle.getFileHandle(filename, { create: false });
      existedBefore = true;
    } catch {
      existedBefore = false;
    }
  }

  let fileHandle: SdFileHandle;
  try {
    fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  } catch (handleErr) {
    const msg =
      handleErr instanceof DOMException
        ? `${handleErr.name}: ${handleErr.message}`
        : handleErr instanceof Error
          ? handleErr.message
          : String(handleErr);
    onDebug?.(`Failed opening destination file handle "${filename}"`, msg);
    throw new Error(`Cannot create file "${filename}" on device: ${msg}`);
  }

  let writable: SdFileWritableStream;
  try {
    writable = await fileHandle.createWritable({ keepExistingData: false });
  } catch (writableErr) {
    const msg =
      writableErr instanceof DOMException
        ? `${writableErr.name}: ${writableErr.message}`
        : writableErr instanceof Error
          ? writableErr.message
          : String(writableErr);
    onDebug?.(`Failed creating writable stream for "${filename}"`, msg);
    throw new Error(`Cannot open write stream for "${filename}": ${msg}`);
  }

  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let written = 0;
  try {
    if (res.body) {
      const reader = res.body.getReader();
      let startedWritingAt = 0;
      let lastProgressAt = 0;
      let sampleWindowStartAt = 0;
      let sampleWindowStartBytes = 0;
      let smoothedSpeed: number | null = null;
      let reportedWritingStage = false;

      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => undefined);
          throw new DOMException('Installation canceled by user.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (signal?.aborted) {
            await reader.cancel().catch(() => undefined);
            throw new DOMException('Installation canceled by user.', 'AbortError');
          }
          const tNow = nowMs();
          if (!reportedWritingStage) {
            reportedWritingStage = true;
            startedWritingAt = tNow;
            sampleWindowStartAt = tNow;
            sampleWindowStartBytes = 0;
            onStage?.('writing');
          }
          await writable.write(value);
          written += value.byteLength;

          const afterWrite = nowMs();
          const shouldEmit = lastProgressAt === 0 || afterWrite - lastProgressAt >= 100;
          if (shouldEmit && onProgress) {
            lastProgressAt = afterWrite;
            const windowMs = afterWrite - sampleWindowStartAt;
            const totalElapsedMs = afterWrite - startedWritingAt;
            if (windowMs >= 250) {
              const instant = ((written - sampleWindowStartBytes) * 1000) / windowMs;
              smoothedSpeed =
                smoothedSpeed === null ? instant : smoothedSpeed * 0.55 + instant * 0.45;
              sampleWindowStartAt = afterWrite;
              sampleWindowStartBytes = written;
            } else if (smoothedSpeed === null && totalElapsedMs >= 100) {
              smoothedSpeed = (written * 1000) / totalElapsedMs;
            }
            onProgress({
              bytesWritten: written,
              totalBytes,
              bytesPerSec:
                smoothedSpeed !== null && Number.isFinite(smoothedSpeed) && smoothedSpeed > 0
                  ? Math.round(smoothedSpeed)
                  : null,
            });
          }
        }
      }
      onProgress?.({
        bytesWritten: written,
        totalBytes: totalBytes ?? written,
        bytesPerSec:
          smoothedSpeed !== null && Number.isFinite(smoothedSpeed) && smoothedSpeed > 0
            ? Math.round(smoothedSpeed)
            : null,
      });
      onStage?.('finalizing');
      await writable.close();
      onDebug?.(`Wrote "${filename}" (${written} bytes)`);
      return written;
    }

    onStage?.('writing');
    const buf = await res.arrayBuffer();
    if (signal?.aborted) {
      throw new DOMException('Installation canceled by user.', 'AbortError');
    }
    await writable.write(buf);
    written = buf.byteLength;
    onProgress?.({
      bytesWritten: written,
      totalBytes: totalBytes ?? written,
      bytesPerSec: null,
    });
    onStage?.('finalizing');
    await writable.close();
    onDebug?.(`Wrote "${filename}" (${written} bytes)`);
    return written;
  } catch (err) {
    if (!isAbortError(err)) {
      const msg =
        err instanceof DOMException
          ? `${err.name}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      onDebug?.(`Stream write error on "${filename}" after ${written} bytes`, msg);
    }
    try {
      if (typeof writable.abort === 'function') {
        await writable.abort();
      } else {
        await writable.close();
      }
    } catch {
      // Ignore secondary abort/close error
    }
    // Remove newly created 0-byte placeholder file if the transfer aborted or failed before closing
    if (!existedBefore) {
      try {
        await dirHandle.removeEntry(filename);
      } catch (cleanupErr) {
        onDebug?.(
          `Failed removing incomplete file "${filename}"`,
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        );
      }
    }
    throw err;
  }
}
